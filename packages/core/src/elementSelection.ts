import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection, Plugin, Selection, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { horizontalArrowLogicalSide } from "./physicalArrow";
import { createDocumentRange, DocumentRangeSelection } from "./documentRangeSelection";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "./managedBlockCursor";

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
