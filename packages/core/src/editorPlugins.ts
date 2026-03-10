import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { ImageEditorOverlay, LinkEditorOverlay, TableToolbarOverlay } from "./uiTypes";
import { DEFAULT_IMAGE_PROTOCOLS, sanitizeStoredUrl } from "./urlUtils";
import type { MarkInfo, MarkName } from "./editorCommands";

export type RevealMarkConfig = {
  markName: MarkName;
  getMarkers: (markInfo: MarkInfo) => { start: string; end: string };
};

function getHorizontalRuleMarkup(text: string) {
  const trimmed = text.trim();

  if (/^-{3,}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\*{3,}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^_{3,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function createHorizontalRulePlugin(options: {
  schema: Schema;
  createManagedBlockCursor: (doc: EditorState["doc"], blockPos: number, side: "before" | "after") => Selection | null;
  isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => boolean;
}) {
  const { createManagedBlockCursor, isManagedBlockNode, schema } = options;

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { selection } = state;

        if (event.key === "Enter" && selection.empty) {
          const { $from } = selection;
          const parent = $from.parent;

          if (parent.type === schema.nodes.paragraph) {
            const markup = getHorizontalRuleMarkup(parent.textContent);

            if (markup) {
              event.preventDefault();
              const blockStart = $from.before();
              const blockEnd = $from.after();
              const horizontalRule = schema.nodes.horizontal_rule.create({ markup });
              const paragraph = schema.nodes.paragraph.create();
              const tr = state.tr.replaceWith(blockStart, blockEnd, [horizontalRule, paragraph]);
              tr.setSelection(TextSelection.create(tr.doc, blockStart + horizontalRule.nodeSize + 1));
              view.dispatch(tr);
              return true;
            }
          }
        }

        if (event.key === "Backspace" && selection.empty) {
          const { $from } = selection;

          if ($from.parent.type === schema.nodes.paragraph && $from.parentOffset === 0) {
            const parent = $from.parent;
            const blockStart = $from.before();
            const blockEnd = $from.after();
            const beforePos = $from.before();
            const beforeResolved = state.doc.resolve(beforePos);
            const previousNode = beforeResolved.nodeBefore;

            if (previousNode?.type === schema.nodes.horizontal_rule) {
              event.preventDefault();
              view.dispatch(state.tr.delete(beforePos - previousNode.nodeSize, beforePos));
              return true;
            }

            const nextResolved = state.doc.resolve(blockEnd);
            const nextNode = nextResolved.nodeAfter;

            if (!previousNode && parent.content.size === 0 && nextNode && isManagedBlockNode(nextNode)) {
              const tr = state.tr.delete(blockStart, blockEnd);
              const boundarySelection = createManagedBlockCursor(tr.doc, blockStart, "before");

              if (!boundarySelection) {
                return false;
              }

              event.preventDefault();
              view.dispatch(tr.setSelection(boundarySelection).scrollIntoView());
              return true;
            }
          }
        }

        if (event.key === "ArrowUp" && selection.empty) {
          const { $from } = selection;

          if ($from.parent.type === schema.nodes.paragraph && $from.parentOffset === 0) {
            const beforePos = $from.before();
            const beforeResolved = state.doc.resolve(beforePos);
            const previousNode = beforeResolved.nodeBefore;

            if (previousNode?.type === schema.nodes.horizontal_rule) {
              event.preventDefault();
              view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, beforePos - previousNode.nodeSize)));
              return true;
            }
          }
        }

        if ((event.key === "ArrowDown" || event.key === "Enter") && selection instanceof NodeSelection) {
          const selectedNode = selection.node;

          if (selectedNode.type === schema.nodes.horizontal_rule) {
            event.preventDefault();
            const afterPos = selection.from + selectedNode.nodeSize;
            const nextSelection = Selection.near(state.doc.resolve(afterPos), 1);
            view.dispatch(state.tr.setSelection(nextSelection));
            return true;
          }
        }

        return false;
      },
    },
  });
}

function getImageMatch(text: string) {
  return text.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
}

export function createImagePlugin(options: { schema: Schema }) {
  const { schema } = options;

  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const { selection } = newState;

      if (!selection.empty) {
        return null;
      }

      const { $from } = selection;
      const parent = $from.parent;

      if (parent.type !== schema.nodes.paragraph) {
        return null;
      }

      const match = getImageMatch(parent.textContent);

      if (!match) {
        return null;
      }

      const alt = typeof match[1] === "string" ? match[1] : "";
      const rawSrc = match[2];
      const title = typeof match[3] === "string" ? match[3] : null;

      if (typeof rawSrc !== "string") {
        return null;
      }

      const src = sanitizeStoredUrl(rawSrc, DEFAULT_IMAGE_PROTOCOLS);

      if (!src) {
        return null;
      }

      const image = schema.nodes.image.create({ src, alt: alt || null, title });
      const paragraphPos = $from.before();
      const tr = newState.tr.replaceWith(paragraphPos + 1, paragraphPos + 1 + parent.content.size, image);
      tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 1), 1));
      return tr;
    },
  });
}

export function createHeadingEditingPlugin(options: {
  schema: Schema;
  convertPipeTable: (view: EditorView) => boolean;
  updateHeadingLevel: (view: EditorView, nextLevel: number | null) => boolean;
}) {
  const { convertPipeTable, schema, updateHeadingLevel } = options;

  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "#") {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        const { $from } = selection;
        const parent = $from.parent;

        if (
          !selection.empty ||
          from !== to ||
          parent.type !== schema.nodes.heading ||
          $from.parentOffset !== 0
        ) {
          return false;
        }

        const currentLevel = parent.attrs.level;

        if (typeof currentLevel !== "number" || currentLevel >= 6) {
          return false;
        }

        return updateHeadingLevel(view, currentLevel + 1);
      },
      handleKeyDown(view, event) {
        if (event.key === "Enter" && convertPipeTable(view)) {
          return true;
        }

        if (event.key !== "Backspace") {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        const { $from } = selection;
        const parent = $from.parent;

        if (!selection.empty || parent.type !== schema.nodes.heading || $from.parentOffset !== 0) {
          return false;
        }

        event.preventDefault();

        const currentLevel = parent.attrs.level;

        if (typeof currentLevel !== "number") {
          return true;
        }

        if (currentLevel <= 1) {
          return updateHeadingLevel(view, null);
        }

        return updateHeadingLevel(view, currentLevel - 1);
      },
    },
  });
}

export function createMarkBoundaryPlugin(options: {
  linkEditor: LinkEditorOverlay;
  imageEditor: ImageEditorOverlay;
  tableToolbar: TableToolbarOverlay;
  enableDefaultUi: boolean;
  convertFenceToCodeBlock: (view: EditorView) => boolean;
  maybeExtendSelectionAcrossCodeBlock: (view: EditorView, direction: -1 | 1) => boolean;
  escapeBoundaryMark: (view: EditorView, direction: "left" | "right") => boolean;
  maybeToggleTaskListItem: (view: EditorView, pos: number, event: MouseEvent) => boolean;
  maybeOpenImage: (event: MouseEvent) => boolean;
  maybeOpenLink: (view: EditorView, event: MouseEvent) => boolean;
  maybeEditActiveImage: (view: EditorView, event: MouseEvent, imageEditor: ImageEditorOverlay) => boolean;
  maybeEditActiveLink: (view: EditorView, event: MouseEvent, linkEditor: LinkEditorOverlay) => boolean;
  getMarkInfo: (state: EditorState, markName: MarkName) => MarkInfo | null;
  getActiveImageInfo: (state: EditorState) => unknown;
}) {
  const {
    convertFenceToCodeBlock,
    enableDefaultUi,
    escapeBoundaryMark,
    getActiveImageInfo,
    getMarkInfo,
    imageEditor,
    linkEditor,
    maybeEditActiveImage,
    maybeEditActiveLink,
    maybeExtendSelectionAcrossCodeBlock,
    maybeOpenImage,
    maybeOpenLink,
    maybeToggleTaskListItem,
    tableToolbar,
  } = options;

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Enter" && convertFenceToCodeBlock(view)) {
          return true;
        }

        if (event.shiftKey && event.key === "ArrowUp" && maybeExtendSelectionAcrossCodeBlock(view, -1)) {
          return true;
        }

        if (event.shiftKey && event.key === "ArrowDown" && maybeExtendSelectionAcrossCodeBlock(view, 1)) {
          return true;
        }

        if (event.key === "ArrowLeft") {
          return escapeBoundaryMark(view, "left");
        }

        if (event.key === "ArrowRight") {
          return escapeBoundaryMark(view, "right");
        }

        return false;
      },
      handleClick(view, pos, event) {
        return (
          maybeToggleTaskListItem(view, pos, event) ||
          maybeOpenImage(event) ||
          maybeOpenLink(view, event) ||
          (enableDefaultUi && maybeEditActiveImage(view, event, imageEditor)) ||
          (enableDefaultUi && maybeEditActiveLink(view, event, linkEditor))
        );
      },
    },
    view(editorView) {
      tableToolbar.update(editorView);

      return {
        update(updatedView) {
          if (!getMarkInfo(updatedView.state, "link")) {
            linkEditor.close(false);
          }

          if (!getActiveImageInfo(updatedView.state)) {
            imageEditor.close(false);
          }

          tableToolbar.update(updatedView);
        },
        destroy() {
          linkEditor.close(false);
          imageEditor.close(false);
          tableToolbar.destroy();
        },
      };
    },
  });
}

function createMarker(doc: Document, className: string, text: string) {
  const marker = doc.createElement("span");
  marker.className = `mdw-marker ${className}`;
  marker.textContent = text;
  return marker;
}

export function createCodeBlockOuterSelectionPlugin(options: { schema: Schema }) {
  const { schema } = options;

  return new Plugin({
    props: {
      decorations(state) {
        const { selection, doc } = state;

        if (selection.empty) {
          return null;
        }

        const decorations: Decoration[] = [];

        doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.code_block) {
            return true;
          }

          const codeStart = pos + 1;
          const codeEnd = pos + node.nodeSize - 1;
          const selectionInside = selection.from >= codeStart && selection.to <= codeEnd;
          const selectionOverlaps = selection.from <= codeEnd && selection.to >= codeStart;

          if (selectionOverlaps && !selectionInside) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: "mdw-code-block-outer-selection",
              }),
            );
          }

          return true;
        });

        return decorations.length > 0 ? DecorationSet.create(doc, decorations) : null;
      },
    },
  });
}

export function createMarkdownRevealPlugin(options: {
  revealMarkConfigs: RevealMarkConfig[];
  getMarkInfo: (state: EditorState, markName: MarkName) => MarkInfo | null;
  isEscapedOutsideBoundary: (state: EditorState, markName: MarkName, markInfo: MarkInfo) => boolean;
  getActiveListItemInfo: (state: EditorState) => { from: number; to: number } | null;
  getActiveLineMarker: (state: EditorState) => { pos: number; marker: string; className: string } | null;
}) {
  const { getActiveLineMarker, getActiveListItemInfo, getMarkInfo, isEscapedOutsideBoundary, revealMarkConfigs } = options;

  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];

        for (const config of revealMarkConfigs) {
          const markInfo = getMarkInfo(state, config.markName);

          if (!markInfo || isEscapedOutsideBoundary(state, config.markName, markInfo)) {
            continue;
          }

          const markers = config.getMarkers(markInfo);

          decorations.push(
            Decoration.widget(
              markInfo.start,
              view => createMarker(view.dom.ownerDocument, `mdw-marker-${config.markName} mdw-marker-${config.markName}-start`, markers.start),
              { side: -1 },
            ),
          );
          decorations.push(
            Decoration.widget(
              markInfo.end,
              view => createMarker(view.dom.ownerDocument, `mdw-marker-${config.markName} mdw-marker-${config.markName}-end`, markers.end),
              { side: 1 },
            ),
          );
        }

        const activeListItem = getActiveListItemInfo(state);

        if (activeListItem) {
          decorations.push(
            Decoration.node(activeListItem.from, activeListItem.to, {
              class: "mdw-active-list-item",
            }),
          );
        }

        const activeLineMarker = getActiveLineMarker(state);

        if (activeLineMarker) {
          decorations.push(
            Decoration.widget(
              activeLineMarker.pos,
              view => createMarker(view.dom.ownerDocument, activeLineMarker.className, activeLineMarker.marker),
              { side: -1 },
            ),
          );
        }

        return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
      },
    },
  });
}
