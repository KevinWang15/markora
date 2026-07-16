import {
  InputRule,
  defineMarkdownEditorExtension,
  toggleMark,
  wrapIn,
  type Command,
  type MarkdownEditorTokenizerRule,
  type Node as ProseMirrorNode,
} from "markora/extension-api";

const calloutKinds = new Set(["note", "tip", "warning"]);

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

function isIndentedCode(state: Parameters<BlockRule>[0], line: number) {
  return state.sCount[line] - state.blkIndent >= 4;
}

function createCalloutRule(openType: string, closeType: string): BlockRule {
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
      if (!isIndentedCode(state, closeLine) && /^:::[ \t]*$/.test(lineText(state, closeLine))) {
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

    const open = state.push(openType, "aside", 1);
    open.map = [startLine, closeLine + 1];
    open.meta = {
      kind: opening[1],
      title: opening[2]?.trim() || null,
    };
    const previousParentType = state.parentType;
    state.parentType = "blockquote";
    state.md.block.tokenize(state, startLine + 1, closeLine);
    state.parentType = previousParentType;
    const close = state.push(closeType, "aside", -1);
    close.map = [startLine, closeLine + 1];
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

function createHighlightRule(openType: string, closeType: string): InlineRule {
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

    const open = state.push(openType, "mark", 1);
    open.markup = "==";
    const nestedTokens: typeof state.tokens = [];
    state.md.inline.parse(content, state.md, state.env, nestedTokens);

    for (const token of nestedTokens) {
      token.level += state.level;
      state.tokens.push(token);
      state.tokens_meta.push(null);
    }

    const close = state.push(closeType, "mark", -1);
    close.markup = "==";
    return true;
  };
}

export const publicCalloutExtension = defineMarkdownEditorExtension({
  name: "@markora-demo/callout",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    nodes: [{
      name: "demo_callout",
      before: "blockquote",
      spec: {
        attrs: {
          kind: { default: "note" },
          title: { default: null },
        },
        content: "block+",
        defining: true,
        group: "block",
        parseDOM: [{ tag: "aside[data-demo-callout]" }],
        toDOM(node) {
          return ["aside", {
            "data-demo-callout": node.attrs.kind,
            ...(node.attrs.title ? { "data-demo-callout-title": node.attrs.title } : {}),
          }, 0];
        },
      },
    }],
    managedBlocks: ["demo_callout"],
  },
  markdown: {
    tokenizerRules: [{
      id: "container",
      phase: "block",
      before: [
        { id: "@markora/opaque/directive", optional: true },
        "@markora/foundation/block/fence",
      ],
      createRule: ({ token }) => createCalloutRule(
        token("container_open"),
        token("container_close"),
      ),
    }],
    parserTokens: {
      container: {
        block: "demo_callout",
        getAttrs(token) {
          const meta = token.meta as { kind?: unknown; title?: unknown } | null;
          return {
            kind: typeof meta?.kind === "string" && calloutKinds.has(meta.kind)
              ? meta.kind
              : "note",
            title: typeof meta?.title === "string" && meta.title ? meta.title : null,
          };
        },
      },
    },
    serializer: {
      nodes: {
        demo_callout(state, node) {
          const kind = typeof node.attrs.kind === "string" && calloutKinds.has(node.attrs.kind)
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
  createStorage: () => ({
    cleanupRuns: 0,
    commandRuns: 0,
    nodeViewDestroys: 0,
    setupActive: false,
    setupRuns: 0,
  }),
  createRuntime: ({ getState, ownerDocument, runCommand, schema, storage }) => {
    const wrapWarning = wrapIn(schema.nodes.demo_callout, {
      kind: "warning",
      title: "Deploy",
    });
    const command: Command = (state, dispatch, view) => wrapWarning(
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
        wrapWarning: () => runCommand(command),
      },
      state: {
        canWrapWarning: () => wrapWarning(getState()),
      },
      keymaps: [{
        id: "wrap-warning",
        key: "Ctrl-Alt-c",
        create: () => command,
      }],
      nodeViews: [{
        id: "callout",
        node: "demo_callout",
        create: () => (node: ProseMirrorNode) => {
          const dom = ownerDocument.createElement("aside");
          const label = ownerDocument.createElement("strong");
          const contentDOM = ownerDocument.createElement("div");

          dom.className = "demo-extension-callout";
          dom.dataset.demoCalloutNodeView = "true";
          dom.setAttribute("role", "note");
          label.className = "demo-extension-callout__label";
          label.contentEditable = "false";
          contentDOM.className = "demo-extension-callout__content";
          dom.append(label, contentDOM);

          const updateAttributes = (kindValue: unknown, titleValue: unknown) => {
            const kind = typeof kindValue === "string" && calloutKinds.has(kindValue)
              ? kindValue
              : "note";
            const title = typeof titleValue === "string" && titleValue ? titleValue : null;
            const visibleLabel = title ? `${kind}: ${title}` : kind;
            dom.dataset.demoCallout = kind;
            dom.setAttribute("aria-label", `${kind} callout${title ? `: ${title}` : ""}`);
            label.textContent = visibleLabel;
          };

          updateAttributes(node.attrs.kind, node.attrs.title);

          return {
            contentDOM,
            dom,
            update(nextNode: ProseMirrorNode) {
              if (nextNode.type !== node.type) {
                return false;
              }

              updateAttributes(nextNode.attrs.kind, nextNode.attrs.title);
              return true;
            },
            destroy() {
              storage.nodeViewDestroys += 1;
            },
          };
        },
      }],
      ui: [{
        id: "wrap-warning",
        group: "blocks",
        defaultLabel: "Wrap selection in warning callout",
        command: "wrapWarning",
        enabled: "canWrapWarning",
      }],
      setup() {
        storage.setupActive = true;
        storage.setupRuns += 1;

        return () => {
          storage.setupActive = false;
          storage.cleanupRuns += 1;
        };
      },
    };
  },
});

export const publicHighlightExtension = defineMarkdownEditorExtension({
  name: "@markora-demo/highlight",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    marks: [{
      name: "demo_highlight",
      spec: {
        parseDOM: [{ tag: "mark[data-demo-highlight]" }],
        toDOM: () => ["mark", { "data-demo-highlight": "true" }, 0],
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
    parserTokens: {
      delimiter: { mark: "demo_highlight" },
    },
    serializer: {
      marks: {
        demo_highlight: {
          open: "==",
          close: "==",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    },
  },
  createRuntime: ({ getState, runCommand, schema }) => {
    const command = toggleMark(schema.marks.demo_highlight);

    return {
      commands: {
        toggle: () => runCommand(command),
      },
      state: {
        isActive: () => Boolean(schema.marks.demo_highlight.isInSet(
          getState().storedMarks ?? getState().selection.$from.marks(),
        )),
      },
      inputRules: [{
        id: "delimiters",
        create: () => new InputRule(/==([^=\n]+)==$/, (state, match, start, end) => {
          const content = match[1];
          return content && content.trim() === content
            ? state.tr.replaceWith(
                start,
                end,
                schema.text(content, [schema.marks.demo_highlight.create()]),
              )
            : null;
        }),
      }],
      keymaps: [{
        id: "toggle",
        key: "Ctrl-Shift-h",
        create: () => command,
      }],
    };
  },
});

export const publicClipboardExtension = defineMarkdownEditorExtension({
  name: "@markora-demo/clipboard",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  createRuntime: () => ({
    clipboard: {
      transforms: [{
        id: "nested-code-text",
        kind: "text",
        surface: "nested-code",
        create: () => (value: string) => value
          .split("NESTEDCLIPBOARDINPUT")
          .join("NESTEDCLIPBOARDSTAGE"),
      }, {
        id: "both-text",
        kind: "text",
        surface: "both",
        create: () => (value: string) => value
          .split("NESTEDCLIPBOARDSTAGE")
          .join("nested-then-both-output")
          .split("BOTHCLIPBOARDINPUT")
          .join("both-clipboard-output"),
      }],
    },
  }),
});

export const publicExampleExtensions = [
  publicCalloutExtension,
  publicHighlightExtension,
  publicClipboardExtension,
] as const;
