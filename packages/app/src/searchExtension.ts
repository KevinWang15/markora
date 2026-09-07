import { Decoration, DecorationSet, Plugin, PluginKey, TextSelection, closeHistory, defineMarkdownEditorExtension } from "markora/extension-api";
import { findRichMatches, type SearchOptions, type SearchResults } from "./search";

type SearchState = SearchResults & { options: SearchOptions | null; decorations: DecorationSet };
export function createSearchExtension() {
  const key = new PluginKey<SearchState>("markora-app-search");
  return defineMarkdownEditorExtension({
    name: "markora-app-search", version: "0.0.1",
    compatibility: { extensionApi: "^1.1.0", markora: "^0.0.1" },
    createRuntime({ getState, dispatch }) {
      let configured: SearchOptions | null = null;
      const current = () => key.getState(getState())!;
      return {
        state: { getMatches: (): SearchResults => current() },
        commands: {
          configure(options: SearchOptions | null) {
            if (configured === options) return false;
            configured = options;
            return dispatch(getState().tr.setMeta(key, { options }).setMeta("addToHistory", false));
          },
          select(index: number) {
            const match = current().matches[index];
            if (!match) return false;
            return dispatch(getState().tr.setSelection(TextSelection.create(getState().doc, match.from, match.to)).scrollIntoView().setMeta("addToHistory", false));
          },
          replace(replacement: string, index?: number) {
            const result = current();
            if (result.truncated && index === undefined) return false;
            const matches = index === undefined ? result.matches : result.matches.slice(index, index + 1);
            if (!matches.length) return false;
            const transaction = closeHistory(getState().tr);
            for (const match of [...matches].reverse()) transaction.insertText(replacement, match.from, match.to);
            return dispatch(transaction);
          },
        },
        plugins: [{ id: "matches", create: () => new Plugin<SearchState>({
          key,
          state: {
            init: (_configuration, state) => {
              const result = configured ? findRichMatches(state.doc, configured) : { matches: [], truncated: false };
              return { ...result, options: configured, decorations: DecorationSet.create(state.doc,
                result.matches.slice(0, 1000).map(match => Decoration.inline(match.from, match.to, { class: "app-search-match" }))) };
            },
            apply(transaction, previous) {
              const meta = transaction.getMeta(key) as { options: SearchOptions | null } | undefined;
              if (!meta && !transaction.docChanged) return previous;
              const options = meta ? meta.options : previous.options;
              const result = options ? findRichMatches(transaction.doc, options) : { matches: [], truncated: false };
              return { ...result, options, decorations: DecorationSet.create(transaction.doc,
                result.matches.slice(0, 1000).map(match => Decoration.inline(match.from, match.to, { class: "app-search-match" }))) };
            },
          },
          props: { decorations(state) {
            const result = key.getState(state)!;
            const selected = result.matches.find(match => match.from === state.selection.from && match.to === state.selection.to);
            return selected ? result.decorations.add(state.doc, [Decoration.inline(selected.from, selected.to, { class: "app-search-current" })]) : result.decorations;
          } },
        }) }],
      };
    },
  });
}
