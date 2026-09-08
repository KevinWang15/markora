import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MarkdownEditor } from "markora";
import type { DocumentController } from "./DocumentController";
import type { SourceEditorHandle, SourceViewState } from "./SourceEditor";

/** Owns the rich/source transition and its view checkpoint. Failed parsing and
 * conversion review leave the current editing surface active. */
export function useSourceMode({ controller, editorRef, sourceEditorRef, viewportRef,
  finishEditing, onSourceEntry, onError }: {
  controller: DocumentController;
  editorRef: RefObject<MarkdownEditor | null>;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  finishEditing(): boolean;
  onSourceEntry(markdown: string): void;
  onError(cause: unknown, fallback: string): void;
}) {
  const sourceModeRef = useRef(false);
  const baseline = useRef(controller.markdown);
  const savedView = useRef<SourceViewState | undefined>(undefined);
  const richScroll = useRef(0);
  const focusFrame = useRef<number | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => () => {
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
  }, []);

  const toggleSourceMode = useCallback((acceptConversion = false) => {
    acceptConversion = acceptConversion === true;
    if (editorRef.current?.view.composing || sourceEditorRef.current?.isComposing()) return;
    if (document.querySelector("dialog[open]") && !acceptConversion) return;
    controller.history.breakGroup();
    if (sourceModeRef.current) {
      savedView.current = sourceEditorRef.current?.captureView();
      try {
        if (controller.markdown !== baseline.current) {
          editorRef.current?.commands.reconcileMarkdown(controller.markdown);
        }
      } catch (cause) {
        onError(cause, "The Markdown source could not be rendered.");
        return;
      }
      sourceModeRef.current = false;
      setSourceMode(false);
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
      focusFrame.current = window.requestAnimationFrame(() => {
        focusFrame.current = null;
        if (sourceModeRef.current) return;
        editorRef.current?.focus();
        if (viewportRef.current) viewportRef.current.scrollTop = richScroll.current;
      });
      return;
    }
    const editor = editorRef.current;
    if (!finishEditing()) return;
    const issues = editor?.state.tableIssues() ?? [];
    if (issues.length && !acceptConversion) {
      setWarning([...new Set(issues.map(issue => issue.message))].join(" "));
      return;
    }
    richScroll.current = viewportRef.current?.scrollTop ?? 0;
    editor?.flushChange();
    onSourceEntry(controller.markdown);
    baseline.current = controller.markdown;
    sourceModeRef.current = true;
    setSourceMode(true);
  }, [controller, editorRef, sourceEditorRef, viewportRef, finishEditing, onSourceEntry, onError]);

  return {
    sourceMode, sourceModeRef, savedView: savedView.current,
    warning, dismissWarning: () => setWarning(null), toggleSourceMode,
    resetDocument(markdown: string) {
      baseline.current = markdown;
      savedView.current = undefined;
      richScroll.current = 0;
    },
    setRichBaseline(markdown: string) { baseline.current = markdown; },
    restoreSource(markdown: string, savedMarkdown: string) {
      sourceModeRef.current = true;
      onSourceEntry(markdown);
      baseline.current = savedMarkdown;
      setSourceMode(true);
    },
  };
}
