import { blurElement, getEditorRootActiveElement as getActiveElement } from "./editorDom";
import type { Node as ProseMirrorNode, ResolvedPos, Schema } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { createElementNavigation } from "./elementNavigation";
import { horizontalArrowLogicalSide, probeVisualRangeMotion } from "./physicalArrow";
import { createDocumentRange, DocumentRangeSelection } from "./documentRangeSelection";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema, type ManagedBlockBoundary } from "./managedBlockCursor";

/** Shared ordering for caret traversal, document ranges, and gap input. */
export function createElementInteractionPlugins(managedBlocks: ReadonlySet<string>, boundaries: CreateManagedBlockBoundaryPluginOptions) {
  return [
    createElementNavigationPlugin(managedBlocks),
    createElementSelectionPlugin(managedBlocks),
    createManagedBlockBoundaryPlugin(boundaries),
  ];
}

export function createElementNavigationPlugin(managedBlocks: ReadonlySet<string>) {
  const navigation = createElementNavigation(managedBlocks);
  const dispatch = (view: EditorView, selection: Selection) => {
    if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  };
  return new Plugin({ props: {
    decorations(state) {
      const { selection } = state;
      return selection instanceof NodeSelection && navigation.isElement(selection.node)
        ? DecorationSet.create(state.doc, [Decoration.node(selection.from, selection.to, { class: "mdw-element-selected" })])
        : null;
    },
    handleKeyDown(view, event) {
      if (view.composing || event.isComposing || event.keyCode === 229
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      const { selection, doc } = view.state;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const physical = event.key === "ArrowLeft" ? "left" : "right";
        const inside = selection instanceof TextSelection && selection.empty ? navigation.containing(selection.$head) : null;
        if (inside?.node.type.spec.elementNavigation?.textArrows === "custom") return false;
        // Embedded text keeps native visual/bidi motion. Only an actual exit
        // crosses into the shared document-order traversal states.
        const motion = inside ? probeVisualRangeMotion(view, physical, inside.pos, inside.pos + inside.node.nodeSize) : null;
        if (inside && (motion === "before" || motion === "after")) {
          return dispatch(view, navigation.boundary(doc, motion === "before" ? inside.pos : inside.pos + inside.node.nodeSize));
        }
        const direction = horizontalArrowLogicalSide(view, physical, inside ? view.nodeDOM(inside.pos) : undefined) === "before" ? -1 : 1;
        const next = navigation.step(selection, direction);
        if (inside && motion === "inside" && next && !(next instanceof NodeSelection)) return false;
        return next ? dispatch(view, next) : false;
      }
      if (event.key === "Escape" && selection instanceof TextSelection) {
        const inside = navigation.containing(selection.$head);
        if (inside) return dispatch(view, NodeSelection.create(doc, inside.pos));
      }
      if (!(selection instanceof NodeSelection) || !navigation.isElement(selection.node)) return false;
      if (event.key === "Enter" && !selection.node.isAtom) {
        const inside = Selection.findFrom(doc.resolve(selection.from + 1), 1, true);
        if (inside && inside.to < selection.to) return dispatch(view, inside);
      }
      if (view.editable && (event.key === "Backspace" || event.key === "Delete")) {
        const tr = view.state.tr.deleteSelection();
        tr.setSelection(navigation.boundary(tr.doc, Math.min(selection.from, tr.doc.content.size)));
        view.dispatch(closeHistory(tr).scrollIntoView());
        return true;
      }
      return false;
    },
  } });
}

type ElementBoundary = { node: ProseMirrorNode; pos: number };

/** Document selections crossing an embedded editing surface keep their anchor.
 * Selection within that surface remains owned by CodeMirror, tables, or the host
 * extension. This uses schema registration, not a list of extension names. */
export function createElementSelectionPlugin(managedBlocks: ReadonlySet<string>) {
  const isElement = (node: ProseMirrorNode | null | undefined): node is ProseMirrorNode =>
    !!node && isManagedBlockNodeFromSchema(node.type.schema, node, managedBlocks);

  function containing($pos: ResolvedPos): ElementBoundary | null {
    for (let depth = 1; depth <= $pos.depth; depth++) {
      const node = $pos.node(depth);
      if (isElement(node)) return { node, pos: $pos.before(depth) };
    }
    return null;
  }

  function adjacent($pos: ResolvedPos, direction: -1 | 1): ElementBoundary | null {
    if (direction < 0 ? $pos.parentOffset !== 0 : $pos.parentOffset !== $pos.parent.content.size) return null;
    for (let depth = $pos.depth; depth > 0; depth--) {
      const boundary = direction < 0 ? $pos.before(depth) : $pos.after(depth);
      const $boundary = $pos.doc.resolve(boundary);
      const node = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
      if (isElement(node)) return { node, pos: direction < 0 ? boundary - node.nodeSize : boundary };
      if (node) return null;
      // No sibling: continue across the enclosing list or container boundary.
    }
    return null;
  }

  function endpoint($edge: ResolvedPos, direction: -1 | 1): number {
    const next = direction < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    // Consecutive embedded blocks are selected one at a time.
    if (isElement(next)) return $edge.pos;
    return Selection.findFrom($edge, direction, true)?.head ?? $edge.pos;
  }

  function collapsedAt($edge: ResolvedPos, direction: -1 | 1): Selection {
    const node = direction < 0 ? $edge.nodeAfter : $edge.nodeBefore;
    if (!$edge.parent.inlineContent && isElement(node)) {
      const blockPos = direction < 0 ? $edge.pos : $edge.pos - node.nodeSize;
      return ManagedBlockCursor.create($edge.doc, blockPos, direction < 0 ? "before" : "after", isElement)!;
    }
    return Selection.near($edge, direction);
  }

  function extend(view: EditorView, event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey
      || event.isComposing || event.keyCode === 229 || view.composing) return false;
    const { selection, doc } = view.state;
    if (!(selection instanceof TextSelection || selection instanceof DocumentRangeSelection || selection instanceof ManagedBlockCursor)) return false;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!horizontal && event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    const direction = horizontal
      ? horizontalArrowLogicalSide(view, event.key === "ArrowLeft" ? "left" : "right") === "before" ? -1 : 1
      : event.key === "ArrowUp" ? -1 : 1;
    if (!event.shiftKey) {
      if (!(selection instanceof DocumentRangeSelection)) return false;
      const edge = direction < 0 ? selection.from : selection.to;
      const collapsed = collapsedAt(doc.resolve(edge), direction);
      view.dispatch(view.state.tr.setSelection(collapsed).scrollIntoView());
      return true;
    }
    const inside = containing(selection.$head);
    let target = inside;
    if (!target && !selection.$head.parent.inlineContent) {
      const node = direction < 0 ? selection.$head.nodeBefore : selection.$head.nodeAfter;
      if (isElement(node)) target = { node, pos: direction < 0 ? selection.head - node.nodeSize : selection.head };
      // At the document edge an outward Shift-arrow must preserve the range.
      else if (selection.head === 0 || selection.head === doc.content.size) return true;
      else {
        const head = endpoint(selection.$head, direction);
        view.dispatch(view.state.tr.setSelection(createDocumentRange(doc, selection.anchor, head)).scrollIntoView());
        return true;
      }
    }
    if (!target) {
      // Vertical arrows use visual line edges; horizontal arrows use text edges.
      if (!horizontal && !view.endOfTextblock(direction < 0 ? "up" : "down")) return false;
      const $edge = horizontal ? selection.$head : doc.resolve(direction < 0 ? selection.$head.start() : selection.$head.end());
      target = adjacent($edge, direction);
    }
    if (!target) return false;
    const end = target.pos + target.node.nodeSize;
    if (selection.anchor > target.pos && selection.anchor < end) return false;
    const edge = direction < 0 ? target.pos : end;
    const head = endpoint(doc.resolve(edge), direction);
    const range = head === selection.anchor
      ? collapsedAt(doc.resolve(head), direction)
      : createDocumentRange(doc, selection.anchor, head);
    if (!range.eq(selection)) view.dispatch(view.state.tr.setSelection(range).scrollIntoView());
    return true;
  }

  function extendToAtom(view: EditorView, event: MouseEvent) {
    if (!event.shiftKey || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || view.composing) return false;
    const ElementClass = view.dom.ownerDocument.defaultView?.Element;
    if (ElementClass && event.target instanceof ElementClass && event.target.closest("button, input, textarea, select")) return false;
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit || hit.inside < 0) return false;
    const { doc, selection } = view.state;
    const node = doc.nodeAt(hit.inside);
    if (!node?.isAtom) return false;
    const direction = selection.anchor <= hit.inside ? 1 : -1;
    const edge = direction < 0 ? hit.inside : hit.inside + node.nodeSize;
    const $edge = doc.resolve(edge);
    const head = $edge.parent.inlineContent ? edge : endpoint($edge, direction);
    event.preventDefault();
    view.dispatch(view.state.tr.setSelection(createDocumentRange(doc, selection.anchor, head)));
    if (!view.isDestroyed) view.focus();
    return true;
  }

  return new Plugin({ props: {
    decorations(state) {
      const { selection, doc } = state;
      if (selection.empty || selection instanceof NodeSelection) return null;
      const decorations: Decoration[] = [];
      for (const { $from, $to } of selection.ranges) {
        doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (node.isText) return false;
          if ((node.isAtom || isElement(node)) && pos >= $from.pos && pos + node.nodeSize <= $to.pos) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "mdw-document-selected" }));
            return false;
          }
          return !node.isAtom;
        });
      }
      return decorations.length ? DecorationSet.create(doc, decorations) : null;
    },
    handleKeyDown: extend,
    createSelectionBetween(_view, $anchor, $head) {
      if ($anchor.pos === $head.pos || ($anchor.parent.inlineContent && $head.parent.inlineContent)) return null;
      return createDocumentRange($anchor.doc, $anchor.pos, $head.pos);
    },
    handleDOMEvents: {
      mousedown: extendToAtom,
      beforeinput(view, event) {
        const { selection } = view.state;
        if (!view.editable || event.inputType !== "insertText" || !event.data || view.composing
          || !(selection instanceof DocumentRangeSelection || selection instanceof ManagedBlockCursor)) return false;
        const { from, to } = selection;
        const handled = view.someProp("handleTextInput", handler => handler(
          view, from, to, event.data!, () => view.state.tr.insertText(event.data!, from, to),
        ));
        if (handled) event.preventDefault();
        return !!handled;
      },
      compositionstart(view) {
        if (!view.editable || !(view.state.selection instanceof DocumentRangeSelection)) return false;
        view.dispatch(view.state.tr.deleteSelection());
        return false;
      },
    },
    handleTextInput(view, _from, _to, text) {
      const { selection } = view.state;
      if (!view.editable || !(selection instanceof DocumentRangeSelection)) return false;
      view.dispatch(view.state.tr.insertText(text, selection.from, selection.to).scrollIntoView());
      return true;
    },
  } });
}

function getEditorRoot(view: EditorView) {
  return view.dom.getRootNode() as Node & {
    activeElement?: Element | null;
    host?: Element;
  };
}

function isNeutralFocusAfterInternalBlur(view: EditorView, activeElement: Element | null) {
  const root = getEditorRoot(view);
  return (
    !activeElement
    || activeElement === view.dom.ownerDocument.body
    || (root.nodeType === 11 && activeElement === root.host)
  );
}

function focusOuterViewForManagedCursor(view: EditorView) {
  const activeElement = getActiveElement(view);

  if (!activeElement || !view.dom.contains(activeElement)) {
    return;
  }

  if (!activeElement.closest(".cm-editor")) {
    return;
  }

  queueMicrotask(() => {
    if (view.isDestroyed) {
      return;
    }

    if (!(view.state.selection instanceof ManagedBlockCursor)) {
      return;
    }

    const nextActiveElement = getActiveElement(view);

    // The transaction that installed the managed cursor may have notified host
    // subscribers before this microtask. Respect any focus handoff they made;
    // only move focus when CodeMirror still owns it.
    if (
      !nextActiveElement
      || !view.dom.contains(nextActiveElement)
      || !nextActiveElement.closest(".cm-editor")
    ) {
      return;
    }

    blurElement(nextActiveElement);

    const activeAfterBlur = getActiveElement(view);

    if (
      activeAfterBlur !== view.dom
      && !isNeutralFocusAfterInternalBlur(view, activeAfterBlur)
    ) {
      return;
    }

    view.dom.focus({ preventScroll: true });
  });
}

export type CreateManagedBlockBoundaryPluginOptions = {
  isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => boolean;
  getManagedBlockBoundary: (state: EditorView["state"]) => ManagedBlockBoundary | null;
  insertParagraphAtManagedBlockBoundary: (
    view: EditorView,
    boundary: ManagedBlockBoundary,
    text?: string,
    scheduleFocus?: boolean,
  ) => boolean;
  removeManagedBlockAtBoundary: (view: EditorView, boundary: ManagedBlockBoundary) => boolean;
};

export function createManagedBlockBoundaryPlugin(options: CreateManagedBlockBoundaryPluginOptions) {
  const handleManagedBlockKeyDown = (view: EditorView, event: KeyboardEvent) => {
    if (view.composing || event.isComposing || event.keyCode === 229) {
      return false;
    }

    const commandModified = event.altKey || event.ctrlKey || event.metaKey;
    const plainKey = !commandModified && !event.shiftKey;
    const boundary = options.getManagedBlockBoundary(view.state);

    if (!boundary) {
      return false;
    }

    if (plainKey && event.key === "Enter") {

      const handled = options.insertParagraphAtManagedBlockBoundary(view, boundary);

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    if (!commandModified && (event.key === "Backspace" || event.key === "Delete")) {
      const backwards = event.key === "Backspace";
      const $pos = view.state.doc.resolve(boundary.pos);
      const target = backwards ? $pos.nodeBefore : $pos.nodeAfter;
      if (!target || !options.isManagedBlockNode(target)) return true;
      const handled = options.removeManagedBlockAtBoundary(view, {
        node: target, pos: boundary.pos,
        blockPos: backwards ? boundary.pos - target.nodeSize : boundary.pos,
        side: backwards ? "after" : "before",
      });

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    return false;
  };

  return new Plugin({
    props: {
      decorations(state) {
        const selection = state.selection;

        if (!(selection instanceof ManagedBlockCursor)) {
          return null;
        }

        const block = state.doc.nodeAt(selection.blockPos);

        if (!block || !options.isManagedBlockNode(block)) {
          return null;
        }

        // Chromium may move a caret beside a terminal contenteditable=false
        // node back to the first paragraph on its next selectionchange. Give
        // it an editable DOM anchor without inserting a model paragraph.
        const caret = [Decoration.widget(selection.head, view => {
          const dom = view.dom.ownerDocument.createElement("span");
          dom.setAttribute("aria-hidden", "true");
          dom.className = "mdw-atom-caret-anchor";
          dom.style.cssText = "display:block;height:0;overflow:hidden";
          dom.appendChild(view.dom.ownerDocument.createElement("br"));
          return dom;
        }, { key: "managed-atom-caret", raw: true })];
        return DecorationSet.create(state.doc, [
          ...caret,
          Decoration.node(selection.blockPos, selection.blockPos + block.nodeSize, {
            class: `mdw-managed-block-cursor mdw-managed-block-cursor-${selection.side}`,
          }),
        ]);
      },
      handleKeyDown(view, event) {

        return handleManagedBlockKeyDown(view, event);
      },
      handleTextInput(view, _from, _to, text) {
        const boundary = options.getManagedBlockBoundary(view.state);

        if (!boundary) {
          return false;
        }

        return options.insertParagraphAtManagedBlockBoundary(view, boundary, text);
      },
      handleDOMEvents: {
        compositionstart(view) {
          const boundary = options.getManagedBlockBoundary(view.state);

          if (!boundary) {
            return false;
          }

          options.insertParagraphAtManagedBlockBoundary(view, boundary, "", false);
          return false;
        },
      },
    },
    view(editorView) {
      const className = "mdw-has-managed-block-cursor";
      const sync = (view: EditorView) => {
        const hasManagedBlockCursor = view.state.selection instanceof ManagedBlockCursor;
        view.dom.classList.toggle(className, hasManagedBlockCursor);

        if (hasManagedBlockCursor) {
          focusOuterViewForManagedCursor(view);
        }

      };

      sync(editorView);

      return {
        update(view) {
          sync(view);
        },
        destroy() {
          editorView.dom.classList.remove(className);
        },
      };
    },
  });
}

export type CreateManagedBlockBoundaryHelpersOptions = {
  schema: Schema;
  isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode;
};

export function createManagedBlockBoundaryHelpers(options: CreateManagedBlockBoundaryHelpersOptions) {
  const {
    schema,
    isManagedBlockNode,
  } = options;

  const navigation = createElementNavigation();

  function insertParagraphAtManagedBlockBoundary(
    view: EditorView,
    boundary: ManagedBlockBoundary,
    text = "",
    scheduleFocus = true,
  ) {
    if (!view.editable) return false;
    const insertPos = boundary.side === "before" ? boundary.blockPos : boundary.blockPos + boundary.node.nodeSize;
    const paragraph = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const $insert = view.state.doc.resolve(insertPos);
    if (!$insert.parent.canReplaceWith($insert.index(), $insert.index(), paragraph.type)) return false;
    const tr = view.state.tr.insert(insertPos, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1 + text.length));
    view.dispatch(tr.scrollIntoView());

    if (scheduleFocus) {
      focusViewAfterManagedBlockMutation(view);
    }

    return true;
  }

  function focusViewAfterManagedBlockMutation(view: EditorView) {
    const ownerWindow = view.dom.ownerDocument.defaultView;

    if (!ownerWindow) {
      return;
    }

    const requestFrame = typeof ownerWindow.requestAnimationFrame === "function"
      ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
      : ((callback: FrameRequestCallback) => ownerWindow.setTimeout(() => callback(Date.now()), 16));

    requestFrame(() => {
      if (view.isDestroyed) {
        return;
      }

      if (view.state.selection instanceof ManagedBlockCursor) {
        view.dom.focus({ preventScroll: true });
      } else {
        view.focus();
      }
    });
  }

  function removeManagedBlockAtBoundary(view: EditorView, boundary: ManagedBlockBoundary) {
    if (!view.editable || view.composing) return false;
    const { state } = view;
    const $block = state.doc.resolve(boundary.blockPos);
    const blockIndex = $block.index();
    const parent = $block.parent;
    let tr = state.tr;

    if (parent.childCount === 1 && parent.canReplaceWith(blockIndex, blockIndex + 1, schema.nodes.paragraph)) {
      tr = tr.replaceWith(boundary.blockPos, boundary.blockPos + boundary.node.nodeSize, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, boundary.blockPos + 1));
      view.dispatch(closeHistory(tr).scrollIntoView());
      focusViewAfterManagedBlockMutation(view);
      return true;
    }

    tr = tr.delete(boundary.blockPos, boundary.blockPos + boundary.node.nodeSize);

    const nextPos = Math.min(boundary.blockPos, tr.doc.content.size);
    tr.setSelection(navigation.boundary(tr.doc, nextPos));

    view.dispatch(closeHistory(tr).scrollIntoView());
    focusViewAfterManagedBlockMutation(view);
    return true;
  }

  function getManagedBlockBoundary(state: EditorState): ManagedBlockBoundary | null {
    if (!(state.selection instanceof ManagedBlockCursor)) {
      return null;
    }

    const node = state.doc.nodeAt(state.selection.blockPos);

    if (!node || !isManagedBlockNode(node)) {
      return null;
    }

    return {
      blockPos: state.selection.blockPos,
      pos: state.selection.head,
      side: state.selection.side,
      node,
    };
  }

  return {
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
  };
}
