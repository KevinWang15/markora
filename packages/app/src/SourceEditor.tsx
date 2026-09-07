import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type SourceEditorHandle = Readonly<{
  getSelection: () => { anchor: number; head: number } | undefined;
  setMarkdown: (markdown: string, selection?: { anchor: number; head: number }) => void;
  focus: () => void;
  revealOffset: (offset: number) => void;
}>;

type SourceEditorProps = Readonly<{
  markdown: string;
  onChange: (markdown: string) => void;
  onHistoryChange: () => void;
}>;

const sourceHighlightStyle = HighlightStyle.define([
  { tag: [tags.meta, tags.comment], color: "var(--app-syntax-comment)" },
  { tag: [tags.link, tags.url], color: "var(--app-syntax-link)", textDecoration: "underline" },
  { tag: tags.heading, color: "var(--app-text)", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.monospace, tags.string], color: "var(--app-syntax-string)" },
  { tag: [tags.contentSeparator, tags.list, tags.quote], color: "var(--app-syntax-punctuation)" },
  { tag: [tags.keyword, tags.atom, tags.bool, tags.number], color: "var(--app-syntax-keyword)" },
  { tag: tags.invalid, color: "var(--app-danger)" },
]);

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor(
  { markdown: initialMarkdown, onChange, onHistoryChange },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onHistoryChangeRef = useRef(onHistoryChange);

  onChangeRef.current = onChange;
  onHistoryChangeRef.current = onHistoryChange;

  useImperativeHandle(forwardedRef, () => ({
    getSelection: () => {
      const selection = viewRef.current?.state.selection.main;
      return selection ? { anchor: selection.anchor, head: selection.head } : undefined;
    },
    setMarkdown: (markdown, selection) => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      const bound = (position: number) => Math.max(0, Math.min(markdown.length, position));
      if (current !== markdown || selection) view.dispatch({
        changes: current !== markdown ? { from: 0, to: view.state.doc.length, insert: markdown } : undefined,
        selection: selection ? { anchor: bound(selection.anchor), head: bound(selection.head) } : undefined,
      });
    },
    focus: () => viewRef.current?.focus(),
    revealOffset: (offset) => {
      const view = viewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(offset, view.state.doc.length));
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      });
      view.focus();
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialMarkdown,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          markdown(),
          syntaxHighlighting(sourceHighlightStyle),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
          EditorView.editorAttributes.of({ "data-markora-source-editor": "true" }),
          keymap.of([...defaultKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onChangeRef.current(update.state.doc.toString());
            onHistoryChangeRef.current();
          }),
        ],
      }),
    });
    viewRef.current = view;
    const focusEditorFromScroller = (event: FocusEvent) => {
      if (event.target === view.scrollDOM) view.focus();
    };
    view.scrollDOM.tabIndex = 0;
    view.scrollDOM.addEventListener("focus", focusEditorFromScroller);
    window.requestAnimationFrame(() => view.focus());

    return () => {
      view.scrollDOM.removeEventListener("focus", focusEditorFromScroller);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div className="app-source-editor" ref={hostRef} />;
});
