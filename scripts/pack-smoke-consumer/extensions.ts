import {
  defineMarkdownEditorExtension,
  type MarkdownEditorTokenizerRule,
} from "markora/extension-api";

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;
type InlineRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "inline" }
>["createRule"]>;

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function createCalloutRule(openType: string, closeType: string): BlockRule {
  return (state, startLine, endLine, silent) => {
    if (lineText(state, startLine).trim() !== ":::note") {
      return false;
    }

    let closeLine = startLine + 1;

    while (closeLine < endLine && lineText(state, closeLine).trim() !== ":::") {
      closeLine += 1;
    }

    if (closeLine >= endLine) {
      return false;
    }

    if (silent) {
      return true;
    }

    const open = state.push(openType, "aside", 1);
    open.map = [startLine, closeLine + 1];
    const parentType = state.parentType;
    state.parentType = "blockquote";
    state.md.block.tokenize(state, startLine + 1, closeLine);
    state.parentType = parentType;
    state.push(closeType, "aside", -1);
    state.line = closeLine + 1;
    return true;
  };
}

function createHighlightRule(openType: string, closeType: string): InlineRule {
  return (state, silent) => {
    const start = state.pos;

    if (!state.src.startsWith("==", start)) {
      return false;
    }

    const end = state.src.indexOf("==", start + 2);
    const content = end < 0 ? "" : state.src.slice(start + 2, end);

    if (!content || content.trim() !== content) {
      return false;
    }

    state.pos = end + 2;

    if (!silent) {
      state.push(openType, "mark", 1).markup = "==";
      state.push("text", "", 0).content = content;
      state.push(closeType, "mark", -1).markup = "==";
    }

    return true;
  };
}

export const packedCalloutExtension = defineMarkdownEditorExtension({
  name: "@pack-smoke/callout",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    nodes: [{
      name: "pack_callout",
      before: "blockquote",
      spec: {
        content: "block+",
        defining: true,
        group: "block",
        parseDOM: [{ tag: "aside[data-pack-callout]" }],
        toDOM: () => ["aside", { "data-pack-callout": "note" }, 0],
      },
    }],
    managedBlocks: ["pack_callout"],
  },
  markdown: {
    tokenizerRules: [{
      id: "container",
      phase: "block",
      before: ["@markora/foundation/block/fence"],
      createRule: ({ token }) => createCalloutRule(
        token("container_open"),
        token("container_close"),
      ),
    }],
    parserTokens: { container: { block: "pack_callout" } },
    serializer: {
      nodes: {
        pack_callout(state, node) {
          state.write(":::note");
          state.ensureNewLine();
          state.renderContent(node);
          state.ensureNewLine();
          state.write(":::");
          state.closeBlock(node);
        },
      },
    },
  },
});

export const packedHighlightExtension = defineMarkdownEditorExtension({
  name: "@pack-smoke/highlight",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    marks: [{
      name: "pack_highlight",
      spec: {
        parseDOM: [{ tag: "mark" }],
        toDOM: () => ["mark", 0],
      },
    }],
  },
  markdown: {
    tokenizerRules: [{
      id: "delimiter",
      phase: "inline",
      before: ["@markora/foundation/inline/emphasis"],
      createRule: ({ token }) => createHighlightRule(
        token("delimiter_open"),
        token("delimiter_close"),
      ),
    }],
    parserTokens: { delimiter: { mark: "pack_highlight" } },
    serializer: {
      marks: {
        pack_highlight: {
          open: "==",
          close: "==",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    },
  },
});
