import type { EditorView } from "prosemirror-view";
import type { MarkdownEditor } from "./editorApi";
import type { createEditorEventDispatcher } from "./editorEvents";
import { getEditorRootActiveElement, isActiveElementInsideEditor } from "./editorDom";

/** Treat nested editing surfaces as one focus boundary. Deliver after the native
 * focus stack returns so a subscriber can safely destroy ProseMirror/CodeMirror. */
export function observeEditorFocus(options: {
  view: EditorView;
  getEditor(): MarkdownEditor | undefined;
  isActive(): boolean;
  dispatcher: ReturnType<typeof createEditorEventDispatcher>;
}) {
  const { view, dispatcher } = options;
  const win = view.dom.ownerDocument.defaultView!;
  let focused = false;
  let version = 0;
  let disposed = false;
  const active = () => !disposed && options.isActive() && !view.isDestroyed;

  const focusIn = (nativeEvent: FocusEvent) => {
    version += 1;
    if (!active() || focused || !options.getEditor()) return;
    focused = true;
    win.queueMicrotask(() => {
      const editor = options.getEditor();
      if (editor && active() && focused && dispatcher.has("focus")) {
        dispatcher.emit("focus", { editor, nativeEvent, type: "focus" }, active);
      }
    });
  };
  const focusOut = (nativeEvent: FocusEvent) => {
    const expectedVersion = ++version;
    win.queueMicrotask(() => {
      if (!active() || !focused || version !== expectedVersion) return;
      if (isActiveElementInsideEditor(view, getEditorRootActiveElement(view))) return;
      focused = false;
      const editor = options.getEditor();
      if (editor && dispatcher.has("blur")) {
        dispatcher.emit("blur", { editor, nativeEvent, type: "blur" }, active);
      }
    });
  };
  view.dom.addEventListener("focusin", focusIn);
  view.dom.addEventListener("focusout", focusOut);
  return () => {
    disposed = true;
    version += 1;
    view.dom.removeEventListener("focusin", focusIn);
    view.dom.removeEventListener("focusout", focusOut);
  };
}
