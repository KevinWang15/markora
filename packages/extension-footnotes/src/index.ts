import {
  Fragment,
  MarkdownEditorExtensionError,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  Slice,
  closeHistory,
  defineMarkdownEditorExtension,
  type Command,
  type DOMOutputSpec,
  type MarkdownEditorExtensionRuntime,
  type Node as ProseMirrorNode,
  type NodeType,
} from "markora/extension-api";
import {
  defaultFootnotesMessages,
  normalizeFootnotesMessages,
  type FootnotesMessageOverrides,
  type FootnotesMessages,
} from "./messages";
import {
  applyFootnoteIndexTransaction,
  buildFootnoteIndex,
  findFootnoteDocumentIssue,
  footnoteDiagnosticCodes,
  transactionChangesFootnoteStructure,
  type FootnoteDefinitionSnapshot,
  type FootnoteDiagnostic,
  type FootnoteDiagnosticCode,
  type FootnoteIndex,
  type FootnoteNodeTypes,
  type FootnoteReferenceSnapshot,
  type FootnotesSnapshot,
} from "./model";
import {
  createFootnoteDefinitionNodeView,
  createFootnoteReferenceNodeView,
  createFootnoteScopeId,
} from "./nodeViews";
import {
  assertFootnoteLabel,
  createFootnoteContextRule,
  createFootnoteDefinitionRule,
  createFootnoteMathShieldRule,
  createFootnoteReferenceRule,
  normalizeFootnoteLabel,
  type FootnoteTokenMeta,
} from "./tokenizer";

export {
  defaultFootnotesMessages,
  footnoteDiagnosticCodes,
};
export type {
  FootnoteDefinitionSnapshot,
  FootnoteDiagnostic,
  FootnoteDiagnosticCode,
  FootnoteReferenceSnapshot,
  FootnotesMessageOverrides,
  FootnotesMessages,
  FootnotesSnapshot,
};

export type FootnoteDefinitionTarget = Readonly<{
  label: string;
  occurrence?: number;
}>;

export type FootnoteRenameOptions = Readonly<{
  references: "preserve" | "rename";
}>;

export type FootnoteRemoveOptions = Readonly<{
  references: "preserve" | "remove";
}>;

export type FootnotesExtensionOptions = Readonly<{
  messages?: FootnotesMessageOverrides;
}>;

export type FootnotesCommands = Readonly<{
  insertDefinition(label: string): boolean;
  insertReference(label: string): boolean;
  navigateToDefinition(label: string, occurrence?: number): boolean;
  navigateToReference(label: string, occurrence?: number): boolean;
  removeDefinition(target: FootnoteDefinitionTarget, options: FootnoteRemoveOptions): boolean;
  renameDefinition(
    target: FootnoteDefinitionTarget,
    nextLabel: string,
    options: FootnoteRenameOptions,
  ): boolean;
}>;

export type FootnotesState = Readonly<{
  getDefinition(target: FootnoteDefinitionTarget): FootnoteDefinitionSnapshot | null;
  getDiagnostics(): readonly FootnoteDiagnostic[];
  getReferences(label?: string): readonly FootnoteReferenceSnapshot[];
  getSnapshot(): FootnotesSnapshot;
}>;

function readLabel(node: ProseMirrorNode) {
  return typeof node.attrs.label === "string" ? node.attrs.label : "";
}

function validNodeLabel(node: ProseMirrorNode) {
  const label = readLabel(node);
  return normalizeFootnoteLabel(label) === label ? label : null;
}

function serializerLabel(node: ProseMirrorNode, messages: FootnotesMessages) {
  const label = validNodeLabel(node);

  if (!label) {
    throw new MarkdownEditorExtensionError({
      code: "EXTENSION_FOOTNOTES_INVALID_DOCUMENT",
      contribution: "label",
      extension: "markora-extension-footnotes",
      message: messages.invalidDocumentDiagnostic(readLabel(node).trim()),
      phase: "serialize",
    });
  }

  return label;
}

function tokenLabel(token: { meta: unknown }) {
  const meta = token.meta as FootnoteTokenMeta | null;
  const label = typeof meta?.label === "string"
    ? normalizeFootnoteLabel(meta.label)
    : null;

  if (!label) {
    throw new TypeError("Footnote tokenizer emitted an invalid label.");
  }

  return { label };
}

function createReferenceDom(
  node: ProseMirrorNode,
  messages: FootnotesMessages,
): DOMOutputSpec {
  const label = validNodeLabel(node) ?? readLabel(node);
  return [
    "sup",
    {
      class: "mdw-footnote-reference",
      contenteditable: "false",
      "data-mdw-footnote-label": label,
      "data-mdw-footnote-reference": "",
    },
    [
      "span",
      {
        "aria-label": messages.referenceSourceLabel(label),
        class: "mdw-footnote-reference__action",
        // Static schema DOM is also used for rich clipboard output, where no
        // NodeView listeners exist. Keep it truthful and noninteractive; the
        // live NodeView promotes a resolved standalone marker to role=link.
        role: "note",
      },
      `[^${label}]`,
    ],
  ];
}

function createDefinitionDom(
  node: ProseMirrorNode,
  messages: FootnotesMessages,
): DOMOutputSpec {
  const label = validNodeLabel(node) ?? readLabel(node);
  const accessibleLabel = messages.definitionSourceLabel(label);
  return [
    "section",
    {
      "aria-label": accessibleLabel,
      class: "mdw-footnote-definition",
      "data-mdw-footnote-definition": "",
      "data-mdw-footnote-label": label,
      role: "group",
    },
    [
      "div",
      {
        class: "mdw-footnote-definition__header",
        contenteditable: "false",
      },
      ["span", { class: "mdw-footnote-definition__label" }, accessibleLabel],
    ],
    [
      "div",
      {
        class: "mdw-footnote-definition__content",
        "data-mdw-footnote-content": "",
      },
      0,
    ],
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOccurrence(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }

  return value as number;
}

function normalizeTarget(target: FootnoteDefinitionTarget) {
  if (!isPlainObject(target)) {
    throw new TypeError("A footnote definition target must be a plain object.");
  }

  for (const key of Object.keys(target)) {
    if (key !== "label" && key !== "occurrence") {
      throw new TypeError(`Unknown footnote definition target key "${key}".`);
    }
  }

  return Object.freeze({
    label: assertFootnoteLabel(target.label),
    occurrence: target.occurrence === undefined
      ? 1
      : assertOccurrence(target.occurrence, "Footnote definition occurrence"),
  });
}

function normalizeRenameOptions(options: FootnoteRenameOptions) {
  if (!isPlainObject(options)) {
    throw new TypeError("Footnote rename options must be a plain object.");
  }

  if (
    Object.keys(options).length !== 1
    || (options.references !== "preserve" && options.references !== "rename")
  ) {
    throw new TypeError(
      'Footnote rename options must set references to "preserve" or "rename".',
    );
  }

  return options.references;
}

function normalizeRemoveOptions(options: FootnoteRemoveOptions) {
  if (!isPlainObject(options)) {
    throw new TypeError("Footnote remove options must be a plain object.");
  }

  if (
    Object.keys(options).length !== 1
    || (options.references !== "preserve" && options.references !== "remove")
  ) {
    throw new TypeError(
      'Footnote remove options must set references to "preserve" or "remove".',
    );
  }

  return options.references;
}

function findDefinition(
  index: FootnoteIndex,
  target: Readonly<{ label: string; occurrence: number }>,
) {
  return index.definitionsByLabel.get(target.label)?.[target.occurrence - 1] ?? null;
}

function createInsertReferenceCommand(nodeType: NodeType, label: string): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;

    if (
      view?.composing
      || !state.selection.empty
      || !$from.parent.inlineContent
      || $from.parent.type.spec.code
    ) {
      return false;
    }

    const node = nodeType.create({ label });

    if (dispatch) {
      dispatch(closeHistory(
        state.tr.replaceSelectionWith(node, false).scrollIntoView(),
      ));
    }

    return true;
  };
}

function createInsertDefinitionCommand(
  nodeType: NodeType,
  label: string,
  indexKey: PluginKey<FootnoteIndex>,
): Command {
  return (state, dispatch, view) => {
    const index = indexKey.getState(state);

    if (view?.composing || index?.definitionsByLabel.has(label)) {
      return false;
    }

    const node = nodeType.createAndFill({ label });

    if (!node) {
      return false;
    }

    if (dispatch) {
      const position = state.doc.content.size;
      let transaction = state.tr.insert(position, node);
      const selection = Selection.findFrom(
        transaction.doc.resolve(position + 1),
        1,
        true,
      );

      if (selection) {
        transaction = transaction.setSelection(selection);
      }

      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function createRenameDefinitionCommand(
  indexKey: PluginKey<FootnoteIndex>,
  nodeTypes: FootnoteNodeTypes,
  target: Readonly<{ label: string; occurrence: number }>,
  nextLabel: string,
  referencePolicy: FootnoteRenameOptions["references"],
): Command {
  return (state, dispatch, view) => {
    const index = indexKey.getState(state);
    const definition = index ? findDefinition(index, target) : null;

    if (view?.composing || !definition || definition.label === nextLabel) {
      return false;
    }

    if (dispatch) {
      let transaction = state.tr;
      const definitionNode = transaction.doc.nodeAt(definition.position);

      if (definitionNode?.type !== nodeTypes.definition) {
        return false;
      }

      transaction = transaction.setNodeMarkup(
        definition.position,
        nodeTypes.definition,
        { ...definitionNode.attrs, label: nextLabel },
        definitionNode.marks,
      );

      if (referencePolicy === "rename") {
        for (const reference of index!.referencesByLabel.get(target.label) ?? []) {
          const referenceNode = transaction.doc.nodeAt(reference.position);

          if (referenceNode?.type !== nodeTypes.reference) {
            return false;
          }

          transaction = transaction.setNodeMarkup(
            reference.position,
            nodeTypes.reference,
            { ...referenceNode.attrs, label: nextLabel },
            referenceNode.marks,
          );
        }
      }

      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function createRemoveDefinitionCommand(
  indexKey: PluginKey<FootnoteIndex>,
  nodeTypes: FootnoteNodeTypes,
  target: Readonly<{ label: string; occurrence: number }>,
  referencePolicy: FootnoteRemoveOptions["references"],
): Command {
  return (state, dispatch, view) => {
    const index = indexKey.getState(state);
    const definition = index ? findDefinition(index, target) : null;

    if (view?.composing || !definition) {
      return false;
    }

    if (dispatch) {
      const positions = [definition.position];

      if (referencePolicy === "remove") {
        positions.push(...(
          index!.referencesByLabel.get(target.label) ?? []
        ).map(({ position }) => position));
      }

      positions.sort((left, right) => right - left);
      let transaction = state.tr;

      for (const position of positions) {
        const node = transaction.doc.nodeAt(position);

        if (
          !node
          || (node.type !== nodeTypes.definition && node.type !== nodeTypes.reference)
        ) {
          return false;
        }

        transaction = transaction.delete(position, position + node.nodeSize);
      }

      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function createNavigateToDefinitionCommand(
  indexKey: PluginKey<FootnoteIndex>,
  label: string,
  occurrence: number,
): Command {
  return (state, dispatch, view) => {
    const definition = indexKey.getState(state)?.definitionsByLabel.get(label)?.[occurrence - 1];

    if (view?.composing || !definition) {
      return false;
    }

    const node = state.doc.nodeAt(definition.position);
    const candidate = node
      ? Selection.findFrom(state.doc.resolve(definition.position + 1), 1, true)
      : null;
    const selection = node && candidate
      && candidate.from >= definition.position + 1
      && candidate.to <= definition.position + node.nodeSize - 1
      ? candidate
      : node ? NodeSelection.create(state.doc, definition.position) : null;

    if (!selection || selection.eq(state.selection)) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }

    return true;
  };
}

function createNavigateToReferenceCommand(
  indexKey: PluginKey<FootnoteIndex>,
  nodeType: NodeType,
  label: string,
  occurrence: number,
): Command {
  return (state, dispatch, view) => {
    const reference = indexKey.getState(state)?.referencesByLabel.get(label)?.[occurrence - 1];

    if (
      view?.composing
      || !reference
      || state.doc.nodeAt(reference.position)?.type !== nodeType
    ) {
      return false;
    }

    const selection = NodeSelection.create(state.doc, reference.position);

    if (selection.eq(state.selection)) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }

    return true;
  };
}

function sliceContainsNodeType(slice: Slice, nodeType: NodeType) {
  let found = false;

  slice.content.descendants((node) => {
    found ||= node.type === nodeType;
    return !found;
  });
  return found;
}

function closePartialDefinitionSlice(slice: Slice, nodeType: NodeType) {
  if (
    (slice.openStart === 0 && slice.openEnd === 0)
    || slice.content.childCount !== 1
  ) {
    return slice;
  }

  let current = slice.content.firstChild;

  // A definition beneath a blockquote or list is carried inside that open
  // container ancestry. Strip only an unambiguous single-child path so the
  // selected definition body becomes a portable, closed semantic slice.
  while (current) {
    if (current.type === nodeType) {
      return new Slice(Fragment.from(current), 0, 0);
    }

    if (current.childCount !== 1) {
      return slice;
    }
    current = current.firstChild;
  }

  return slice;
}

function normalizeOptions(options: FootnotesExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({ messages: defaultFootnotesMessages });
  }

  if (!isPlainObject(options)) {
    throw new TypeError("Footnotes extension options must be a plain object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "messages") {
      throw new TypeError(`Unknown footnotes extension option "${key}".`);
    }
  }

  return Object.freeze({ messages: normalizeFootnotesMessages(options.messages) });
}

export function createFootnotesExtension(options?: FootnotesExtensionOptions) {
  const { messages } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-footnotes",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.1.0", markora: "^0.0.1" },
    schema: {
      nodes: [
        {
          name: "footnote_reference",
          before: "image",
          spec: {
            atom: true,
            attrs: { label: {} },
            group: "inline",
            inline: true,
            leafText: (node) => `[^${readLabel(node)}]`,
            parseDOM: [{
              tag: "[data-mdw-footnote-reference]",
              getAttrs(dom) {
                const label = normalizeFootnoteLabel(
                  dom.getAttribute("data-mdw-footnote-label") ?? "",
                );
                return label ? { label } : false;
              },
            }],
            selectable: true,
            toDOM: (node) => createReferenceDom(node, messages),
          },
        },
        {
          name: "footnote_definition",
          before: "blockquote",
          spec: {
            attrs: { label: {} },
            content: "block+",
            defining: true,
            group: "block",
            isolating: true,
            parseDOM: [{
              contentElement: "[data-mdw-footnote-content]",
              tag: "section[data-mdw-footnote-definition]",
              getAttrs(dom) {
                const label = normalizeFootnoteLabel(
                  dom.getAttribute("data-mdw-footnote-label") ?? "",
                );
                return label ? { label } : false;
              },
            }],
            selectable: true,
            toDOM: (node) => createDefinitionDom(node, messages),
          },
        },
      ],
      managedBlocks: ["footnote_definition"],
    },
    markdown: {
      tokenizerRules: [
        {
          id: "definition",
          phase: "block",
          before: [
            "@markora/foundation/block/reference",
            "@markora/foundation/block/paragraph",
          ],
          createRule: ({ token }) => createFootnoteDefinitionRule(
            token("definition_open"),
            token("definition_close"),
          ),
        },
        {
          id: "math-code-context",
          phase: "inline",
          before: ["@markora/foundation/inline/text"],
          createRule: () => createFootnoteMathShieldRule(),
        },
        {
          id: "reference",
          phase: "inline",
          before: ["@markora/foundation/inline/text"],
          createRule: ({ token }) => createFootnoteReferenceRule(token("reference")),
        },
        {
          id: "contexts",
          phase: "core",
          after: ["@markora/foundation/core/inline"],
          createRule: ({ token }) => createFootnoteContextRule(token("reference")),
        },
      ],
      parserTokens: {
        definition: {
          block: "footnote_definition",
          getAttrs: tokenLabel,
        },
        reference: {
          node: "footnote_reference",
          getAttrs: tokenLabel,
        },
      },
      serializer: {
        nodes: {
          footnote_definition(state, node) {
            const label = serializerLabel(node, messages);
            state.wrapBlock("    ", `[^${label}]: `, node, () => {
              state.renderContent(node);
            });
          },
          footnote_reference(state, node) {
            state.write(`[^${serializerLabel(node, messages)}]`);
          },
        },
      },
    },
    createRuntime({ codec, getState, ownerDocument, reportError, runCommand, schema }) {
      const nodeTypes: FootnoteNodeTypes = Object.freeze({
        definition: schema.nodes.footnote_definition,
        reference: schema.nodes.footnote_reference,
      });
      const indexKey = new PluginKey<FootnoteIndex>("markoraFootnotesIndex");
      const storage = Object.freeze({
        refreshers: new Set<() => void>(),
        scopeId: createFootnoteScopeId(ownerDocument),
      });
      const currentIndex = () => indexKey.getState(getState())
        ?? buildFootnoteIndex(getState().doc, nodeTypes, messages);
      const runtime = {
        commands: {
          insertDefinition(label: string) {
            return runCommand(createInsertDefinitionCommand(
              nodeTypes.definition,
              assertFootnoteLabel(label),
              indexKey,
            ));
          },
          insertReference(label: string) {
            return runCommand(createInsertReferenceCommand(
              nodeTypes.reference,
              assertFootnoteLabel(label),
            ));
          },
          navigateToDefinition(label: string, occurrence = 1) {
            return runCommand(createNavigateToDefinitionCommand(
              indexKey,
              assertFootnoteLabel(label),
              assertOccurrence(occurrence, "Footnote definition occurrence"),
            ));
          },
          navigateToReference(label: string, occurrence = 1) {
            return runCommand(createNavigateToReferenceCommand(
              indexKey,
              nodeTypes.reference,
              assertFootnoteLabel(label),
              assertOccurrence(occurrence, "Footnote reference occurrence"),
            ));
          },
          removeDefinition(
            target: FootnoteDefinitionTarget,
            removeOptions: FootnoteRemoveOptions,
          ) {
            return runCommand(createRemoveDefinitionCommand(
              indexKey,
              nodeTypes,
              normalizeTarget(target),
              normalizeRemoveOptions(removeOptions),
            ));
          },
          renameDefinition(
            target: FootnoteDefinitionTarget,
            nextLabel: string,
            renameOptions: FootnoteRenameOptions,
          ) {
            return runCommand(createRenameDefinitionCommand(
              indexKey,
              nodeTypes,
              normalizeTarget(target),
              assertFootnoteLabel(nextLabel),
              normalizeRenameOptions(renameOptions),
            ));
          },
        },
        state: {
          getDefinition(target: FootnoteDefinitionTarget) {
            return findDefinition(currentIndex(), normalizeTarget(target));
          },
          getDiagnostics: () => currentIndex().snapshot.diagnostics,
          getReferences(label?: string) {
            return label === undefined
              ? currentIndex().snapshot.references
              : currentIndex().referencesByLabel.get(assertFootnoteLabel(label))
                ?? Object.freeze([]);
          },
          getSnapshot: () => currentIndex().snapshot,
        },
        plugins: [{
          id: "index",
          create: () => new Plugin<FootnoteIndex>({
            key: indexKey,
            props: {
              transformCopied(slice) {
                return closePartialDefinitionSlice(slice, nodeTypes.definition);
              },
              handlePaste(view, _event, slice) {
                const closedSlice = closePartialDefinitionSlice(
                  slice,
                  nodeTypes.definition,
                );

                if (
                  view.composing
                  || !view.editable
                  || !view.state.selection.empty
                  || closedSlice.openStart !== 0
                  || closedSlice.openEnd !== 0
                  || !sliceContainsNodeType(closedSlice, nodeTypes.definition)
                ) {
                  return false;
                }

                const { $from } = view.state.selection;
                let definitionDepth = -1;

                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type === nodeTypes.definition) {
                    definitionDepth = depth;
                    break;
                  }
                }

                if (definitionDepth < 0) {
                  return false;
                }

                // A semantic definition cannot be nested. When a closed
                // definition slice is pasted from a cursor inside one, retain
                // its block meaning by inserting it as the current
                // definition's next sibling.
                const insertAt = $from.after(definitionDepth);
                view.dispatch(closeHistory(
                  view.state.tr
                    .replace(insertAt, insertAt, closedSlice)
                    .scrollIntoView()
                    .setMeta("paste", true)
                    .setMeta("uiEvent", "paste"),
                ).setTime(0));
                return true;
              },
              clipboardTextSerializer(slice) {
                if (
                  slice.openStart !== 0
                  || slice.openEnd !== 0
                  || !sliceContainsNodeType(slice, nodeTypes.definition)
                ) {
                  // Let the core serializer retain its richer ordinary-text
                  // semantics for selections that contain no definition.
                  return undefined as never;
                }

                return codec.serialize(schema.topNodeType.create(null, slice.content));
              },
            },
            filterTransaction(transaction) {
              if (
                !transaction.docChanged
                || !transactionChangesFootnoteStructure(transaction, nodeTypes)
              ) {
                return true;
              }

              const issue = findFootnoteDocumentIssue(transaction.doc, nodeTypes);

              if (issue === null) {
                return true;
              }

              reportError(new MarkdownEditorExtensionError({
                code: "EXTENSION_FOOTNOTES_INVALID_DOCUMENT",
                contribution: "document-invariant",
                extension: "markora-extension-footnotes",
                message: issue.kind === "nested-definition"
                  ? messages.nestedDefinitionDiagnostic(issue.label)
                  : issue.kind === "invalid-reference-context"
                    ? messages.invalidReferenceContextDiagnostic(issue.label)
                    : messages.invalidDocumentDiagnostic(issue.label.trim()),
                phase: "plugin",
              }));
              return false;
            },
            state: {
              init: (_configuration, state) => buildFootnoteIndex(
                state.doc,
                nodeTypes,
                messages,
              ),
              apply: (transaction, previous) => applyFootnoteIndexTransaction(
                previous,
                transaction,
                nodeTypes,
                messages,
              ),
            },
            view() {
              return {
                update(view, previousState) {
                  const currentIndex = indexKey.getState(view.state);
                  const previousIndex = indexKey.getState(previousState);

                  if (
                    currentIndex === previousIndex
                    || currentIndex?.renderIdentity === previousIndex?.renderIdentity
                  ) {
                    return;
                  }

                  for (const refresh of [...storage.refreshers]) {
                    refresh();
                  }
                },
                destroy() {
                  storage.refreshers.clear();
                },
              };
            },
          }),
        }],
        nodeViews: [
          {
            id: "definition",
            node: "footnote_definition",
            create: () => createFootnoteDefinitionNodeView({
              indexKey,
              messages,
              nodeTypes,
              storage,
            }),
          },
          {
            id: "reference",
            node: "footnote_reference",
            create: () => createFootnoteReferenceNodeView({
              indexKey,
              messages,
              nodeTypes,
              storage,
            }),
          },
        ],
      } satisfies MarkdownEditorExtensionRuntime<
        undefined,
        FootnotesCommands,
        FootnotesState
      >;

      return runtime;
    },
  });
}

export type FootnotesExtension = ReturnType<typeof createFootnotesExtension>;
