import type { Node as MarkdownNode } from "markora/extension-api";
export type SearchOptions = Readonly<{ query: string; caseSensitive: boolean; wholeWord: boolean }>;
export type SearchMatch = Readonly<{ from: number; to: number }>;
export type SearchResults = Readonly<{ matches: readonly SearchMatch[]; truncated: boolean }>;
export const SEARCH_LIMIT = 10_000;
const wordEnd = /[\p{L}\p{N}\p{M}_]$/u;
const wordStart = /^[\p{L}\p{N}\p{M}_]/u;

export function findTextMatches(text: string, options: SearchOptions, offset = 0, limit = SEARCH_LIMIT): SearchResults {
  const matches: SearchMatch[] = [];
  if (!options.query || options.query.includes("\0")) return { matches, truncated: false };
  const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(escaped, options.caseSensitive ? "gu" : "giu");
  for (const match of text.matchAll(pattern)) {
    const from = match.index!, to = from + match[0].length;
    if (options.wholeWord && (wordEnd.test(text.slice(Math.max(0, from - 2), from)) || wordStart.test(text.slice(to, to + 2)))) continue;
    if (matches.length === limit) return { matches, truncated: true };
    matches.push({ from: from + offset, to: to + offset });
  }
  return { matches, truncated: false };
}

/** Inline mark boundaries remain searchable; block and atom boundaries do not. */
export function findRichMatches(doc: MarkdownNode, options: SearchOptions): SearchResults {
  const matches: SearchMatch[] = [];
  let truncated = false;
  doc.descendants((node, position) => {
    if (truncated) return false;
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach(child => { text += child.isText ? child.text : "\0".repeat(child.nodeSize); });
    const result = findTextMatches(text, options, position + 1, SEARCH_LIMIT - matches.length);
    matches.push(...result.matches);
    truncated = result.truncated;
    return false;
  });
  return { matches, truncated };
}
