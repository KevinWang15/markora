import type { EditorState, Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkdownEditor } from "./editorApi";
import type { createEditorEventDispatcher, MarkdownEditorSelectionSnapshot } from "./editorEvents";
import type { MarkdownEditorChangeOrigin } from "./transactionOrigin";

/** State, selection, then document update. Each subscriber may synchronously
 * dispatch or destroy, so validity must be checked between deliveries. */
export function createStateEventEmitter(options: {
  getEditor(): MarkdownEditor | undefined;
  getView(): EditorView;
  isActive(): boolean;
  dispatcher: ReturnType<typeof createEditorEventDispatcher>;
  snapshotSelection(selection: Selection): MarkdownEditorSelectionSnapshot;
}) {
  const { dispatcher, snapshotSelection } = options;
  return (previous: EditorState, next: EditorState, changed: boolean, origin: MarkdownEditorChangeOrigin) => {
    const editor = options.getEditor();
    if (!options.isActive() || !editor) return;
    const view = options.getView();
    const active = () => options.isActive() && !view.isDestroyed;
    const current = () => active() && view.state === next;
    if (current() && dispatcher.has("state")) {
      dispatcher.emit("state", {
        type: "state", editor, origin,
        docChanged: changed,
        selectionChanged: !previous.selection.eq(next.selection),
        selection: snapshotSelection(next.selection),
      }, current);
    }
    if (current() && !previous.selection.eq(next.selection) && dispatcher.has("selection")) {
      dispatcher.emit("selection", {
        type: "selection", editor, origin,
        previousSelection: snapshotSelection(previous.selection),
        selection: snapshotSelection(next.selection),
      }, () => active() && view.state.selection.eq(next.selection));
    }
    if (active() && changed && view.state.doc.eq(next.doc) && dispatcher.has("update")) {
      dispatcher.emit("update", {
        type: "update", editor, origin,
        selection: snapshotSelection(view.state.selection),
      }, () => active() && view.state.doc.eq(next.doc));
    }
  };
}
