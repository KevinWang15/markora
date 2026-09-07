import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { ChangeSet, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
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
import type { SearchMatch } from "./search";
import { mapTextPosition, textChange } from "./textChanges";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const searchEffect = StateEffect.define<{ matches: readonly SearchMatch[]; index: number }>();
const searchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(searchEffect)) {
      const { matches, index } = effect.value;
      const visible = matches.slice(0, 1000);
      if (index >= 1000 && matches[index]) visible.push(matches[index]);
      value = Decoration.set(visible.map(match => Decoration.mark({
        class: match === matches[index] ? "app-search-match app-search-current" : "app-search-match",
      }).range(match.from, match.to)), true);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

export type SourceViewState = Readonly<{
  markdown: string;
  selection: { anchor: number; head: number };
  scroll: ReturnType<EditorView["scrollSnapshot"]>;
}>;

export type SourceEditorHandle = Readonly<{
  isComposing: () => boolean;
  getMarkdown: () => string;
  setSearch: (matches: readonly SearchMatch[], index: number) => void;
  selectMatch: (match: SearchMatch) => void;
  replaceMatches: (matches: readonly SearchMatch[], replacement: string) => void;
  captureView: () => SourceViewState | undefined;
  getSelection: () => { anchor: number; head: number } | undefined;
  setMarkdown: (markdown: string, selection?: { anchor: number; head: number }) => void;
  focus: () => void;
  revealOffset: (offset: number) => void;
}>;

type SourceEditorProps = Readonly<{
  markdown: string;
  savedView?: SourceViewState;
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
  { markdown: initialMarkdown, savedView, onChange, onHistoryChange },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onHistoryChangeRef = useRef(onHistoryChange);

  onChangeRef.current = onChange;
  onHistoryChangeRef.current = onHistoryChange;

  useImperativeHandle(forwardedRef, () => ({
    captureView: () => {
      const view = viewRef.current;
      if (!view) return;
      const { anchor, head } = view.state.selection.main;
      return { markdown: view.state.doc.toString(), selection: { anchor, head }, scroll: view.scrollSnapshot() };
    },
    getMarkdown: () => viewRef.current?.state.doc.toString() ?? "",
    setSearch: (matches, index) => viewRef.current?.dispatch({ effects: searchEffect.of({ matches, index }) }),
    selectMatch: match => viewRef.current?.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: "center" }) }),
    replaceMatches: (matches, replacement) => {
      const view = viewRef.current;
      if (!view || view.composing) return;
      view.dispatch({ changes: matches.map(match => ({ from: match.from, to: match.to, insert: replacement })) });
    },
    isComposing: () => viewRef.current?.composing ?? false,
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
        changes: current !== markdown ? textChange(current, markdown) : undefined,
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

    const sourceMarkdown = initialMarkdown.replace(/\r\n?/gu, "\n");
    const change = savedView ? textChange(savedView.markdown, sourceMarkdown) : undefined;
    const selection = savedView && change ? {
      anchor: mapTextPosition(savedView.selection.anchor, change),
      head: mapTextPosition(savedView.selection.head, change),
    } : undefined;
    const view = new EditorView({
      parent: host,
      scrollTo: savedView && change ? savedView.scroll.map(ChangeSet.of(change, savedView.markdown.length)) : undefined,
      state: EditorState.create({
        doc: sourceMarkdown,
        selection,
        extensions: [
          searchField,
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
    const frame = window.requestAnimationFrame(() => {
      view.focus();

    });

    return () => {
      cancelAnimationFrame(frame);
      view.scrollDOM.removeEventListener("focus", focusEditorFromScroller);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div className="app-source-editor" ref={hostRef} />;
});
