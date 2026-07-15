import { toggleMark, wrapIn } from "prosemirror-commands";
import { InputRule } from "prosemirror-inputrules";
import { Plugin, PluginKey, type Command } from "prosemirror-state";
import {
  defineMarkdownEditorExtension,
  type PrototypeBlockTokenizerRule,
  type PrototypeInlineTokenizerRule,
} from "./contract";

const CALLOUT_KINDS = new Set(["note", "tip", "warning"]);
type BlockTokenizerRule = ReturnType<PrototypeBlockTokenizerRule["createRule"]>;
type InlineTokenizerRule = ReturnType<PrototypeInlineTokenizerRule["createRule"]>;

function lineText(
  state: Parameters<BlockTokenizerRule>[0],
  line: number,
) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function isIndentedCode(
  state: Parameters<BlockTokenizerRule>[0],
  line: number,
) {
  return state.sCount[line] - state.blkIndent >= 4;
}

const opaqueDirectiveRule: BlockTokenizerRule = (
  state,
  startLine,
  endLine,
  silent,
) => {
  if (
    isIndentedCode(state, startLine)
    || !/^:::[a-z][\w-]*(?:\s|$)/i.test(lineText(state, startLine))
  ) {
    return false;
  }

  let closeLine = startLine + 1;

  while (closeLine < endLine) {
    if (
      !isIndentedCode(state, closeLine)
      && /^:::\s*$/.test(lineText(state, closeLine))
    ) {
      break;
    }

    closeLine += 1;
  }

  if (closeLine >= endLine) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push("code_block", "code", 0);
  token.content = state.getLines(
    startLine,
    closeLine + 1,
    state.sCount[startLine],
    false,
  );
  token.map = [startLine, closeLine + 1];
  state.line = closeLine + 1;
  return true;
};

function createCalloutRule(
  openTokenName: string,
  closeTokenName: string,
): BlockTokenizerRule {
  return (state, startLine, endLine, silent) => {
    if (isIndentedCode(state, startLine)) {
      return false;
    }

    const opening = /^:::(note|tip|warning)(?:[ \t]+(.+?))?[ \t]*$/.exec(
      lineText(state, startLine),
    );

    if (!opening) {
      return false;
    }

    let closeLine = startLine + 1;

    while (closeLine < endLine) {
      if (
        !isIndentedCode(state, closeLine)
        && /^:::[ \t]*$/.test(lineText(state, closeLine))
      ) {
        break;
      }

      closeLine += 1;
    }

    if (closeLine >= endLine) {
      return false;
    }

    if (silent) {
      return true;
    }

    const openToken = state.push(openTokenName, "aside", 1);
    openToken.map = [startLine, closeLine + 1];
    openToken.meta = {
      kind: opening[1],
      title: opening[2]?.trim() || null,
    };

    const previousParentType = state.parentType;
    state.parentType = "blockquote";
    state.md.block.tokenize(state, startLine + 1, closeLine);
    state.parentType = previousParentType;

    const closeToken = state.push(closeTokenName, "aside", -1);
    closeToken.map = [startLine, closeLine + 1];
    state.line = closeLine + 1;
    return true;
  };
}

function isEscaped(source: string, index: number) {
  let backslashes = 0;

  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

function createHighlightRule(
  openTokenName: string,
  closeTokenName: string,
): InlineTokenizerRule {
  return (state, silent) => {
    const start = state.pos;

    if (!state.src.startsWith("==", start) || isEscaped(state.src, start)) {
      return false;
    }

    let end = state.src.indexOf("==", start + 2);

    while (end >= 0 && isEscaped(state.src, end)) {
      end = state.src.indexOf("==", end + 2);
    }

    if (end < 0) {
      return false;
    }

    const content = state.src.slice(start + 2, end);

    if (!content || content.trim() !== content) {
      return false;
    }

    state.pos = end + 2;

    if (silent) {
      return true;
    }

    const openToken = state.push(openTokenName, "mark", 1);
    openToken.markup = "==";

    const nestedTokens: typeof state.tokens = [];
    state.md.inline.parse(content, state.md, state.env, nestedTokens);

    for (const token of nestedTokens) {
      token.level += state.level;
      state.tokens.push(token);
      state.tokens_meta.push(null);
    }

    const closeToken = state.push(closeTokenName, "mark", -1);
    closeToken.markup = "==";
    return true;
  };
}

export const calloutActivityKey = new PluginKey<number>(
  "rfc-prototype-callout-activity",
);

export const highlightActivityKey = new PluginKey<number>(
  "rfc-prototype-highlight-activity",
);

function createActivityPlugin(key: PluginKey<number>) {
  return new Plugin<number>({
    key,
    state: {
      init: () => 0,
      apply(transaction, value) {
        return transaction.docChanged ? value + 1 : value;
      },
    },
  });
}

export const opaqueDirectiveFallbackExtension = defineMarkdownEditorExtension({
  name: "@example/opaque-fallback",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  markdown: {
    tokenizerRules: [
      {
        id: "colon-directive",
        phase: "block",
        before: ["@markora/foundation/block/fence"],
        createRule: () => opaqueDirectiveRule,
        options: {
          alt: ["paragraph", "reference", "blockquote", "list"],
        },
      },
    ],
  },
  createRuntime: () => ({
    commands: {},
    state: {},
  }),
});

export const calloutExtension = defineMarkdownEditorExtension({
  name: "@example/callout",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    nodes: [
      {
        name: "callout",
        before: "blockquote",
        spec: {
          attrs: {
            kind: { default: "note" },
            title: { default: null },
          },
          content: "block+",
          defining: true,
          group: "block",
          parseDOM: [
            {
              tag: "aside[data-rfc-callout]",
              getAttrs(dom) {
                if (typeof dom === "string") {
                  return false;
                }

                const kind = dom.getAttribute("data-rfc-callout");
                return {
                  kind: kind && CALLOUT_KINDS.has(kind) ? kind : "note",
                  title: dom.getAttribute("data-rfc-callout-title"),
                };
              },
            },
          ],
          toDOM(node) {
            const kind = typeof node.attrs.kind === "string" && CALLOUT_KINDS.has(node.attrs.kind)
              ? node.attrs.kind
              : "note";
            const title = typeof node.attrs.title === "string" && node.attrs.title
              ? node.attrs.title
              : null;

            return [
              "aside",
              {
                "data-rfc-callout": kind,
                ...(title ? { "data-rfc-callout-title": title } : {}),
              },
              0,
            ];
          },
        },
      },
    ],
  },
  markdown: {
    tokenizerRules: [
      {
        id: "container",
        phase: "block",
        before: [
          {
            id: "@example/opaque-fallback/colon-directive",
            optional: true,
          },
          "@markora/foundation/block/fence",
        ],
        createRule: ({ token }) => createCalloutRule(
          token("container_open"),
          token("container_close"),
        ),
        options: {
          alt: ["paragraph", "reference", "blockquote", "list"],
        },
      },
    ],
    parserTokens: {
      container: {
        block: "callout",
        getAttrs(token) {
          const meta = token.meta as { kind?: unknown; title?: unknown } | null;
          const kind = typeof meta?.kind === "string" && CALLOUT_KINDS.has(meta.kind)
            ? meta.kind
            : "note";

          return {
            kind,
            title: typeof meta?.title === "string" && meta.title
              ? meta.title
              : null,
          };
        },
      },
    },
    serializer: {
      nodes: {
        callout(state, node) {
          const kind = typeof node.attrs.kind === "string" && CALLOUT_KINDS.has(node.attrs.kind)
            ? node.attrs.kind
            : "note";
          const title = typeof node.attrs.title === "string" && node.attrs.title
            ? ` ${node.attrs.title}`
            : "";

          state.write(`:::${kind}${title}`);
          state.ensureNewLine();
          state.renderContent(node);
          state.ensureNewLine();
          state.write(":::");
          state.closeBlock(node);
        },
      },
    },
  },
  createStorage: () => ({ commandRuns: 0 }),
  createRuntime: ({ runCommand, schema, storage }) => {
    const wrapCallout = wrapIn(schema.nodes.callout, {
      kind: "warning",
      title: "Deploy",
    });
    const wrapWarningCallout: Command = (state, dispatch, view) => wrapCallout(
      state,
      dispatch
        ? (transaction) => {
            storage.commandRuns += 1;
            dispatch(transaction);
          }
        : undefined,
      view,
    );

    return {
      commands: {
        wrapWarningCallout: () => runCommand(wrapWarningCallout),
      },
      state: {
        commandRuns: () => storage.commandRuns,
      },
      plugins: [
        {
          id: "activity",
          create: () => createActivityPlugin(calloutActivityKey),
        },
      ],
      keymaps: [
        {
          id: "wrap-warning-callout",
          key: "Ctrl-Alt-c",
          create: () => wrapWarningCallout,
        },
      ],
    };
  },
});

export const highlightExtension = defineMarkdownEditorExtension({
  name: "@example/highlight",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    marks: [
      {
        name: "highlight",
        spec: {
          parseDOM: [{ tag: "mark" }],
          toDOM: () => ["mark", 0],
        },
      },
    ],
  },
  markdown: {
    tokenizerRules: [
      {
        id: "delimiter",
        phase: "inline",
        before: ["@markora/foundation/inline/emphasis"],
        createRule: ({ token }) => createHighlightRule(
          token("delimiter_open"),
          token("delimiter_close"),
        ),
      },
    ],
    parserTokens: {
      delimiter: { mark: "highlight" },
    },
    serializer: {
      marks: {
        highlight: {
          open: "==",
          close: "==",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    },
  },
  createRuntime: ({ runCommand, schema, storage }) => {
    const noStorage: undefined = storage;
    const toggleHighlight = toggleMark(schema.marks.highlight);
    void noStorage;

    return {
      commands: {
        toggleHighlight: () => runCommand(toggleHighlight),
      },
      state: {},
      inputRules: [
        {
          id: "highlight-delimiters",
          create: () => new InputRule(
            /==([^=\n]+)==$/,
            (state, match, start, end) => {
              const content = match[1];

              if (!content || content.trim() !== content) {
                return null;
              }

              return state.tr.replaceWith(
                start,
                end,
                schema.text(content, [schema.marks.highlight.create()]),
              );
            },
          ),
        },
      ],
      plugins: [
        {
          id: "activity",
          create: () => createActivityPlugin(highlightActivityKey),
        },
      ],
      keymaps: [
        {
          id: "toggle-highlight",
          key: "Ctrl-Shift-h",
          create: () => toggleHighlight,
        },
      ],
    };
  },
});

export const prototypeExtensions = [
  opaqueDirectiveFallbackExtension,
  calloutExtension,
  highlightExtension,
] as const;
