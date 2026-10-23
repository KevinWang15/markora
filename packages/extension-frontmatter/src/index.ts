import {
  MarkdownEditorExtensionError,
  Plugin,
  closeHistory,
  defineMarkdownEditorExtension,
  sliceMarkdownEditorOriginalSourceLines,
  type Command,
  type DOMOutputSpec,
  type MarkdownEditorExtensionRuntime,
  type MarkdownEditorTokenizerRule,
  type Node as ProseMirrorNode,
  type NodeType,
} from "markora/extension-api";
import {
  defaultFrontmatterMessages,
  normalizeFrontmatterMessages,
  type FrontmatterMessageOverrides,
  type FrontmatterMessages,
} from "./messages";
import { createFrontmatterNodeView } from "./nodeView";
import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  analyzeFrontmatterSource,
  frontmatterAtHead,
  frontmatterDiagnosticCodes,
  hasFrontmatterEnvelope,
  isFrontmatterPlacementTransactionAllowed,
  isFrontmatterMappingLine,
  type FrontmatterDiagnostic,
  type FrontmatterDiagnosticCode,
  type FrontmatterSnapshot,
} from "./source";

export {
  FRONTMATTER_MAX_SOURCE_BYTES,
  defaultFrontmatterMessages,
  frontmatterDiagnosticCodes,
};
export type {
  FrontmatterDiagnostic,
  FrontmatterDiagnosticCode,
  FrontmatterMessageOverrides,
  FrontmatterMessages,
  FrontmatterSnapshot,
};

export type FrontmatterEditRequest = Readonly<{
  diagnostics: readonly FrontmatterDiagnostic[];
  remove(): boolean;
  source: string;
  update(nextSource: string): boolean;
}>;

export type FrontmatterExtensionOptions = Readonly<{
  messages?: FrontmatterMessageOverrides;
  onEditSource?: (request: FrontmatterEditRequest) => void;
}>;

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;

type FrontmatterTokenMeta = {
  source?: string;
};

type FrontmatterCommands = Readonly<{
  insert(source?: string): boolean;
  remove(): boolean;
  update(source: string): boolean;
}>;

type FrontmatterState = Readonly<{
  canInsert(): boolean;
  getDiagnostics(): readonly FrontmatterDiagnostic[];
  getSnapshot(): FrontmatterSnapshot | null;
  getSource(): string | null;
  isPresent(): boolean;
}>;

const DEFAULT_FRONTMATTER_SOURCE = "---\ntitle: \n---";

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function createFrontmatterRule(tokenType: string): BlockRule {
  return (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.level !== 0 || state.blkIndent !== 0) {
      return false;
    }

    const opener = lineText(state, startLine).replace(/^\uFEFF/, "");

    if (!/^---[ \t]*$/.test(opener)) {
      return false;
    }

    let closingLine = startLine + 1;
    let hasMappingEntry = false;

    while (
      closingLine < endLine
      && !/^(?:---|\.\.\.)[ \t]*$/.test(lineText(state, closingLine))
    ) {
      hasMappingEntry ||= isFrontmatterMappingLine(lineText(state, closingLine));
      closingLine += 1;
    }

    if (closingLine >= endLine || !hasMappingEntry) {
      return false;
    }

    if (silent) {
      return true;
    }

    const end = closingLine + 1;
    const exactSource = sliceMarkdownEditorOriginalSourceLines(
      state.env,
      startLine,
      end,
    );
    const source = exactSource ?? state
      .getLines(startLine, end, state.blkIndent, false)
      .replace(/(?:\r\n|\r|\n)$/, "");
    const token = state.push(tokenType, "", 0);
    token.map = [startLine, end];
    token.meta = {
      ...(token.meta as FrontmatterTokenMeta | null),
      source,
    } satisfies FrontmatterTokenMeta;
    state.line = end;
    return true;
  };
}

function readNodeSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : "";
}

function assertSource(source: unknown): asserts source is string {
  if (typeof source !== "string") {
    throw new TypeError("Front matter source must be a string.");
  }
}

function invalidSourceError(
  phase: "command" | "serialize",
  messages: FrontmatterMessages,
) {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_FRONTMATTER_INVALID_SOURCE",
    contribution: "source",
    extension: "markora-extension-frontmatter",
    message: messages.invalidStructureDiagnostic,
    phase,
  });
}

function createInsertCommand(nodeType: NodeType, source: string): Command {
  return (state, dispatch, view) => {
    if (
      view?.composing
      || frontmatterAtHead(state.doc, nodeType)
      || !hasFrontmatterEnvelope(source)
    ) {
      return false;
    }

    const node = nodeType.create({ source });

    if (dispatch) {
      dispatch(closeHistory(state.tr.insert(0, node)));
    }

    return true;
  };
}

function createUpdateCommand(nodeType: NodeType, source: string): Command {
  return (state, dispatch, view) => {
    const node = frontmatterAtHead(state.doc, nodeType);

    if (
      view?.composing
      || !node
      || readNodeSource(node) === source
      || !hasFrontmatterEnvelope(source)
    ) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(state.tr.setNodeMarkup(
        0,
        nodeType,
        { ...node.attrs, source },
        node.marks,
      )));
    }

    return true;
  };
}

function createRemoveCommand(nodeType: NodeType): Command {
  return (state, dispatch, view) => {
    const node = frontmatterAtHead(state.doc, nodeType);

    if (view?.composing || !node) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(state.tr.delete(0, node.nodeSize)));
    }

    return true;
  };
}

function createFrontmatterDom(
  node: ProseMirrorNode,
  messages: FrontmatterMessages,
): DOMOutputSpec {
  return [
    "div",
    {
      "aria-label": messages.sourceLabel,
      "class": "mdw-frontmatter",
      "contenteditable": "false",
      "data-mdw-frontmatter": "yaml",
      "data-mdw-frontmatter-label": messages.kindLabel,
      "role": "region",
    },
    ["div", { class: "mdw-frontmatter__header" }, [
      "span",
      { class: "mdw-frontmatter__kind" },
      messages.kindLabel,
    ]],
    ["pre", { class: "mdw-frontmatter__pre" }, [
      "code",
      {
        class: "mdw-frontmatter__source",
        "data-mdw-frontmatter-source": "",
      },
      readNodeSource(node),
    ]],
  ];
}

function normalizeOptions(options: FrontmatterExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({
      messages: defaultFrontmatterMessages,
      onEditSource: undefined,
    });
  }

  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("Front matter extension options must be a plain object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "messages" && key !== "onEditSource") {
      throw new TypeError(`Unknown front matter extension option "${key}".`);
    }
  }

  if (
    options.onEditSource !== undefined
    && typeof options.onEditSource !== "function"
  ) {
    throw new TypeError("Front matter onEditSource must be a function.");
  }

  return Object.freeze({
    messages: normalizeFrontmatterMessages(options.messages),
    onEditSource: options.onEditSource,
  });
}

export function createFrontmatterExtension(
  options?: FrontmatterExtensionOptions,
) {
  const { messages, onEditSource } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-frontmatter",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.5.0", markora: "^0.1.2" },
    schema: {
      nodes: [{
        name: "frontmatter",
        before: "horizontal_rule",
        spec: {
          atom: true,
          attrs: { source: { default: "" } },
          defining: true,
          group: "block",
          isolating: true,
          leafText: readNodeSource,
          parseDOM: [{
            tag: '[data-mdw-frontmatter="yaml"]',
            getAttrs(dom) {
              const source = dom.querySelector("[data-mdw-frontmatter-source]")?.textContent
                ?? dom.textContent
                ?? "";
              return hasFrontmatterEnvelope(source) ? { source } : false;
            },
          }],
          selectable: true,
          toDOM: (node) => createFrontmatterDom(node, messages),
        },
      }],
      managedBlocks: ["frontmatter"],
    },
    markdown: {
      tokenizerRules: [{
        id: "block",
        phase: "block",
        before: [
          { id: "@markora/opaque/frontmatter", optional: true },
          "@markora/foundation/block/hr",
        ],
        createRule: ({ token }) => createFrontmatterRule(token("block")),
      }],
      parserTokens: {
        block: {
          node: "frontmatter",
          getAttrs(token) {
            const meta = token.meta as FrontmatterTokenMeta | null;
            return { source: typeof meta?.source === "string" ? meta.source : "" };
          },
        },
      },
      serializer: {
        nodes: {
          frontmatter(state, node, parent, index) {
            const source = readNodeSource(node);

            if (
              parent.type !== parent.type.schema.topNodeType
              || index !== 0
              || !hasFrontmatterEnvelope(source)
            ) {
              throw invalidSourceError("serialize", messages);
            }

            state.write(source);
            state.closeBlock(node);
          },
        },
      },
    },
    createRuntime({ dispatch, getState, reportError, runCommand, schema }) {
      const nodeType = schema.nodes.frontmatter;
      const refreshers = new Set<() => void>();
      const snapshot = (): FrontmatterSnapshot | null => {
        const node = frontmatterAtHead(getState().doc, nodeType);

        if (!node) {
          return null;
        }

        const source = readNodeSource(node);
        return Object.freeze({
          diagnostics: analyzeFrontmatterSource(source, messages),
          source,
        });
      };
      const runtime = {
        commands: {
          insert(source = DEFAULT_FRONTMATTER_SOURCE) {
            assertSource(source);

            if (!hasFrontmatterEnvelope(source)) {
              reportError(invalidSourceError("command", messages));
              return false;
            }

            return runCommand(createInsertCommand(nodeType, source));
          },
          update(source: string) {
            assertSource(source);

            if (!hasFrontmatterEnvelope(source)) {
              reportError(invalidSourceError("command", messages));
              return false;
            }

            return runCommand(createUpdateCommand(nodeType, source));
          },
          remove() {
            return runCommand(createRemoveCommand(nodeType));
          },
        },
        state: {
          isPresent: () => Boolean(frontmatterAtHead(getState().doc, nodeType)),
          canInsert: () => !frontmatterAtHead(getState().doc, nodeType),
          getSource: () => snapshot()?.source ?? null,
          getDiagnostics: () => snapshot()?.diagnostics ?? Object.freeze([]),
          getSnapshot: snapshot,
        },
        plugins: [{
          id: "invariant",
          create: () => new Plugin({
            filterTransaction(transaction) {
              if (
                isFrontmatterPlacementTransactionAllowed(transaction, nodeType)
              ) {
                return true;
              }

              reportError(
                new MarkdownEditorExtensionError({
                  code: "EXTENSION_FRONTMATTER_DOCUMENT_INVARIANT",
                  contribution: "document-invariant",
                  extension: "markora-extension-frontmatter",
                  message: messages.documentInvariantDiagnostic,
                  phase: "plugin",
                }),
              );
              return false;
            },
            view() {
              return {
                update() {
                  for (const refresh of [...refreshers]) {
                    refresh();
                  }
                },
                destroy() {
                  refreshers.clear();
                },
              };
            },
          }),
        }],
        ui: [{
          id: "insert",
          group: "document",
          defaultLabel: messages.insertFrontmatter,
          command: "insert",
          enabled: "canInsert",
        }],
        nodeViews: [{
          id: "source",
          node: "frontmatter",
          create: () => createFrontmatterNodeView({
            dispatch,
            messages,
            nodeType,
            onEditSource,
            refreshers,
            reportError,
          }),
        }],
      } satisfies MarkdownEditorExtensionRuntime<
        undefined,
        FrontmatterCommands,
        FrontmatterState
      >;

      return runtime;
    },
  });
}

export type FrontmatterExtension = ReturnType<typeof createFrontmatterExtension>;
