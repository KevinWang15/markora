import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { MarkdownEditor } from "markora";
import type { DocumentController } from "./DocumentController";
import type { SourceEditorHandle } from "./SourceEditor";
import type { createSearchExtension } from "./searchExtension";
import { findTextMatches, type SearchOptions, type SearchResults } from "./search";

const EMPTY_SEARCH: SearchResults = { matches: [], truncated: false };

/** Search state belongs to the document; adapters apply it to the active view. */
export function useDocumentSearch({ controller, editorRef, sourceEditorRef, sourceMode,
  sourceModeRef, searchExtension, markdown, documentRevision, savingCopy }: {
  controller: DocumentController;
  editorRef: RefObject<MarkdownEditor | null>;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
  sourceMode: boolean;
  sourceModeRef: RefObject<boolean>;
  searchExtension: ReturnType<typeof createSearchExtension>;
  markdown: string;
  documentRevision: number;
  savingCopy: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({ query: "", caseSensitive: false, wholeWord: false });
  const [replacement, setReplacement] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const sourceMatches = useMemo(() => searchOpen && sourceMode
    ? findTextMatches(markdown.replace(/\r\n?/gu, "\n"), searchOptions) : EMPTY_SEARCH,
  [markdown, searchOptions, searchOpen, sourceMode]);
  const searchResults = sourceMode ? sourceMatches : editorRef.current?.extensions.get(searchExtension).state.getMatches() ?? EMPTY_SEARCH;

  useEffect(() => {
    editorRef.current?.extensions.get(searchExtension).commands.configure(searchOpen && !sourceMode ? searchOptions : null);
    setSearchIndex(-1);
  }, [searchOpen, sourceMode, searchOptions]);
  useEffect(() => {
    if (sourceMode) sourceEditorRef.current?.setSearch(searchOpen ? sourceMatches.matches : [], searchIndex);
  }, [sourceMode, searchOpen, sourceMatches, searchIndex, documentRevision]);

  const openSearch = useCallback(() => {
    if (document.querySelector("dialog[open]")) return;
    setSearchOpen(true);
    setSearchFocusRequest(value => value + 1);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (sourceModeRef.current) sourceEditorRef.current?.focus();
    else editorRef.current?.focus();
  }, []);
  const nextMatch = (direction: 1 | -1) => {
    const handle = editorRef.current?.extensions.get(searchExtension);
    if (!sourceModeRef.current) handle?.commands.configure(searchOptions);
    const result = sourceModeRef.current ? sourceMatches : handle?.state.getMatches() ?? EMPTY_SEARCH;
    if (!result.matches.length) return;
    const index = (searchIndex < 0 ? direction > 0 ? 0 : result.matches.length - 1 : searchIndex + direction + result.matches.length) % result.matches.length;
    setSearchIndex(index);
    if (sourceModeRef.current) sourceEditorRef.current?.selectMatch(result.matches[index]);
    else handle?.commands.select(index);
  };
  const replaceMatches = (all: boolean) => {
    if (savingCopy || sourceEditorRef.current?.isComposing() || editorRef.current?.view.composing) return;
    controller.history.breakGroup();
    if (sourceModeRef.current) {
      const matches = findTextMatches(sourceEditorRef.current?.getMarkdown() ?? "", searchOptions);
      if (all && matches.truncated) return;
      sourceEditorRef.current?.replaceMatches(all ? matches.matches : matches.matches.slice(searchIndex, searchIndex + 1), replacement);
    } else {
      const handle = editorRef.current?.extensions.get(searchExtension);
      handle?.commands.configure(searchOptions);
      handle?.commands.replace(replacement, all ? undefined : searchIndex);
      editorRef.current?.flushChange();
    }
    controller.history.breakGroup();
    setSearchIndex(-1);
  };

  return { searchOpen, searchOptions, setSearchOptions, replacement, setReplacement,
    searchIndex, setSearchIndex, searchFocusRequest, searchResults, openSearch,
    closeSearch, nextMatch, replaceMatches };
}
