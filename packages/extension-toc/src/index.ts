import {
  MarkdownEditorExtensionError,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  closeHistory,
  defineMarkdownEditorExtension,
  type Command,
  type DOMOutputSpec,
  type EditorState,
  type MarkdownEditorExtensionRuntime,
  type Node as ProseMirrorNode,
  type NodeType,
  type Transaction,
} from "markora/extension-api";
import {
  defaultTocMessages,
  normalizeTocMessages,
  type TocMessageOverrides,
  type TocMessages,
} from "./messages";
import {
  applyTocIndexTransaction,
  buildTocIndex,
  findTocTransactionIssue,
  type TocHeadingLevel,
  type TocHeadingSnapshot,
  type TocIndex,
  type TocNodeSnapshot,
  type TocNodeTypes,
  type TocSnapshot,
} from "./model";
import {
  createTocNodeView,
  type TocRuntimeStorage,
} from "./nodeView";
import { createTocBlockRule } from "./tokenizer";

export { defaultTocMessages };
export type {
  TocHeadingLevel,
  TocHeadingSnapshot,
  TocMessageOverrides,
  TocMessages,
  TocNodeSnapshot,
  TocSnapshot,
};

export type TocExtensionOptions = Readonly<{
  messages?: TocMessageOverrides;
}>;

export type TocCommands = Readonly<{
  insert(): boolean;
  remove(): boolean;
}>;

export type TocState = Readonly<{
  canInsert(): boolean;
  canRemove(): boolean;
  getSnapshot(): TocSnapshot;
  isActive(): boolean;
}>;

const canonicalMarker = "[TOC]";
const markerPattern = /^[\t ]*\[toc\][\t ]*$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOptions(options: TocExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({ messages: defaultTocMessages });
  }

  if (!isPlainObject(options)) {
    throw new TypeError("TOC extension options must be a plain object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "messages") {
      throw new TypeError(`Unknown TOC extension option "${key}".`);
    }
  }

  return Object.freeze({ messages: normalizeTocMessages(options.messages) });
}

function staticTocDom(): DOMOutputSpec {
  return [
    "div",
    {
      class: "mdw-toc-source",
      contenteditable: "false",
      "data-mdw-toc": "",
    },
    ["span", { "data-mdw-toc-source": "" }, canonicalMarker],
  ];
}

function selectedToc(state: EditorState, nodeType: NodeType) {
  const { selection } = state;

  return selection instanceof NodeSelection && selection.node.type === nodeType
    ? Object.freeze({ node: selection.node, position: selection.from })
    : null;
}

function findInsertedNode(transaction: Transaction, inserted: ProseMirrorNode) {
  let position: number | null = null;

  transaction.doc.descendants((node, nodePosition) => {
    if (position !== null) return false;

    if (node === inserted) {
      position = nodePosition;
      return false;
    }

    return true;
  });
  return position;
}

function createInsertTransaction(state: EditorState, nodeType: NodeType) {
  if (selectedToc(state, nodeType)) {
    return null;
  }

  const inserted = nodeType.create();
  let transaction = state.tr.replaceSelectionWith(inserted);
  const position = findInsertedNode(transaction, inserted);

  if (position === null || transaction.doc.resolve(position).depth !== 0) {
    return null;
  }

  transaction = transaction.setSelection(NodeSelection.create(
    transaction.doc,
    position,
  ));
  return transaction;
}

function createInsertCommand(nodeType: NodeType): Command {
  return (state, dispatch, view) => {
    if (view?.composing) {
      return false;
    }

    const transaction = createInsertTransaction(state, nodeType);

    if (!transaction) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function createRemoveCommand(nodeType: NodeType): Command {
  return (state, dispatch, view) => {
    const selected = selectedToc(state, nodeType);

    if (view?.composing || !selected) {
      return false;
    }

    let transaction = state.tr.delete(
      selected.position,
      selected.position + selected.node.nodeSize,
    );
    const target = Math.min(selected.position, transaction.doc.content.size);
    const bias = target >= transaction.doc.content.size ? -1 : 1;
    transaction = transaction.setSelection(Selection.near(
      transaction.doc.resolve(target),
      bias,
    ));

    if (dispatch) {
      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function placementError(
  messages: TocMessages,
  phase: "plugin" | "serialize",
) {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_TOC_INVALID_DOCUMENT",
    contribution: "document-invariant",
    extension: "markora-extension-toc",
    message: messages.invalidPlacementDiagnostic,
    phase,
  });
}

function currentIndex(
  key: PluginKey<TocIndex>,
  state: EditorState,
  nodeTypes: TocNodeTypes,
  messages: TocMessages,
) {
  return key.getState(state) ?? buildTocIndex(state.doc, nodeTypes, messages);
}

export function createTocExtension(options?: TocExtensionOptions) {
  const { messages } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-toc",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.1.0", markora: "^0.0.1" },
    schema: {
      nodes: [{
        name: "toc",
        before: "horizontal_rule",
        spec: {
          atom: true,
          createGapCursor: true,
          defining: true,
          group: "block",
          isolating: true,
          leafText: () => canonicalMarker,
          parseDOM: [{
            tag: "div[data-mdw-toc]",
            getAttrs(dom) {
              const source = dom.querySelector("[data-mdw-toc-source]")?.textContent
                ?? dom.textContent
                ?? "";
              return markerPattern.test(source) ? null : false;
            },
          }],
          selectable: true,
          toDOM: staticTocDom,
        },
      }],
      managedBlocks: ["toc"],
    },
    markdown: {
      tokenizerRules: [{
        id: "block",
        phase: "block",
        before: ["@markora/foundation/block/hr"],
        options: { alt: ["paragraph", "reference", "blockquote", "list"] },
        createRule: ({ token }) => createTocBlockRule(token("block")),
      }],
      parserTokens: {
        block: { node: "toc" },
      },
      serializer: {
        nodes: {
          toc(state, node, parent) {
            if (parent.type !== parent.type.schema.topNodeType) {
              throw placementError(messages, "serialize");
            }

            state.write(canonicalMarker);
            state.closeBlock(node);
          },
        },
      },
    },
    createRuntime({ getState, reportError, runCommand, schema }) {
      const nodeTypes: TocNodeTypes = Object.freeze({
        heading: schema.nodes.heading,
        toc: schema.nodes.toc,
      });
      const indexKey = new PluginKey<TocIndex>("markoraTocIndex");
      const storage: TocRuntimeStorage = Object.freeze({
        refreshers: new Set<() => void>(),
      });
      const insertCommand = createInsertCommand(nodeTypes.toc);
      const removeCommand = createRemoveCommand(nodeTypes.toc);
      const commands: TocCommands = {
        insert: () => runCommand(insertCommand),
        remove: () => runCommand(removeCommand),
      };
      const state: TocState = {
        canInsert: () => Boolean(createInsertTransaction(getState(), nodeTypes.toc)),
        canRemove: () => Boolean(selectedToc(getState(), nodeTypes.toc)),
        getSnapshot: () => currentIndex(
          indexKey,
          getState(),
          nodeTypes,
          messages,
        ).snapshot,
        isActive: () => Boolean(selectedToc(getState(), nodeTypes.toc)),
      };

      return {
        commands,
        state,
        plugins: [{
          id: "index",
          create: () => new Plugin<TocIndex>({
            key: indexKey,
            filterTransaction(transaction) {
              const issue = findTocTransactionIssue(transaction, nodeTypes);

              if (!issue) {
                return true;
              }

              reportError(placementError(messages, "plugin"));
              return false;
            },
            state: {
              init: (_configuration, editorState) => buildTocIndex(
                editorState.doc,
                nodeTypes,
                messages,
              ),
              apply: (transaction, previous) => applyTocIndexTransaction(
                previous,
                transaction,
                nodeTypes,
                messages,
              ),
            },
            view() {
              // NodeViews are constructed while the EditorView is still
              // establishing document positions. Refresh once plugin views
              // are live so initial outlines never depend on constructor
              // timing, and so a hard state reset can reattach retained views.
              for (const refresh of [...storage.refreshers]) {
                refresh();
              }

              return {
                update(view, previousState) {
                  const next = indexKey.getState(view.state);
                  const previous = indexKey.getState(previousState);

                  if (
                    next === previous
                    || next?.renderIdentity === previous?.renderIdentity
                  ) {
                    return;
                  }

                  for (const refresh of [...storage.refreshers]) {
                    refresh();
                  }
                },
                // Each NodeView owns its refresher registration. Do not clear
                // the shared set here: ProseMirror may recreate plugin views
                // across a hard state reset while retaining document views.
                destroy() {},
              };
            },
          }),
        }],
        nodeViews: [{
          id: "toc",
          node: "toc",
          create: () => createTocNodeView({
            indexKey,
            messages,
            nodeTypes,
            storage,
          }),
        }],
        ui: [
          {
            id: "insert",
            group: "document",
            defaultLabel: messages.insertToc,
            command: "insert",
            enabled: "canInsert",
          },
          {
            id: "remove",
            group: "document",
            defaultLabel: messages.removeToc,
            command: "remove",
            enabled: "canRemove",
            active: "isActive",
          },
        ],
      } satisfies MarkdownEditorExtensionRuntime<
        undefined,
        TocCommands,
        TocState
      >;
    },
  });
}

export type TocExtension = ReturnType<typeof createTocExtension>;
