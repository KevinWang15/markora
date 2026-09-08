import type { MarkdownEditor } from "markora";

type EditorView = MarkdownEditor["view"];

/** Flush pending native input before a UI control takes focus and captures the
 * model selection. A keyboard context menu can precede selectionchange from the
 * previous arrow key. ProseMirror has no public flush API, so keep this dependency
 * on its DOM observer isolated and covered by browser ordering regressions. */
export function flushProseMirrorInput(view: EditorView): void {
  const observer = (view as EditorView & {
    domObserver: { forceFlush(): void; flush(): void };
  }).domObserver;
  observer.forceFlush();
  observer.flush();
}
