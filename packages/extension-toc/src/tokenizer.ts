import type { MarkdownEditorTokenizerRule } from "markora/extension-api";

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;

export type TocTokenMeta = Readonly<{
  canonicalMarker: "[TOC]";
}>;

const markerPattern = /^[\t ]*\[toc\][\t ]*$/i;
const tokenMeta: TocTokenMeta = Object.freeze({ canonicalMarker: "[TOC]" });

function blockLine(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

/**
 * Claim one root-level Typora-style TOC marker before Markdown-it folds it into
 * a paragraph. Nested container parsing deliberately remains ordinary Markdown.
 */
export function createTocBlockRule(tokenType: string): BlockRule {
  return (state, startLine, _endLine, silent) => {
    if (
      // During paragraph interruption Markdown-it temporarily reports the
      // parent type as `paragraph`. Token nesting and block indentation are the
      // stable root-container boundary across ordinary and silent calls.
      state.level !== 0
      || state.blkIndent !== 0
      || state.sCount[startLine] - state.blkIndent >= 4
      || !markerPattern.test(blockLine(state, startLine))
    ) {
      return false;
    }

    if (silent) {
      return true;
    }

    const token = state.push(tokenType, "nav", 0);
    token.block = true;
    token.content = "[TOC]";
    token.map = [startLine, startLine + 1];
    token.markup = "[TOC]";
    token.meta = tokenMeta;
    state.line = startLine + 1;
    return true;
  };
}
