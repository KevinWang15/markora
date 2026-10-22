import {
  MarkdownEditorExtensionError,
  NodeSelection,
  Plugin,
  Slice,
  closeHistory,
  defineMarkdownEditorExtension,
  wrapIn,
  type Command,
  type DOMOutputSpec,
  type EditorState,
  type MarkdownEditorExtensionRuntime,
  type Node as ProseMirrorNode,
  type NodeType,
  type NodeViewConstructor,
  type Transaction,
} from "markora/extension-api";
import {
  defaultAlertsMessages,
  normalizeAlertsMessages,
  type AlertsMessageOverrides,
  type AlertsMessages,
} from "./messages";
import {
  createAlertMarkerClaimRule,
  createAlertTransformRule,
  type AlertTokenMeta,
} from "./tokenizer";

export const alertKinds = Object.freeze([
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const);

export type AlertKind = (typeof alertKinds)[number];

export type AlertSnapshot = Readonly<{
  kind: AlertKind;
  position: number;
}>;

export type AlertsExtensionOptions = Readonly<{
  messages?: AlertsMessageOverrides;
}>;

export type AlertsCommands = Readonly<{
  setKind(kind: AlertKind): boolean;
  toggle(kind?: AlertKind): boolean;
  unwrap(): boolean;
  wrap(kind?: AlertKind): boolean;
}>;

export type AlertsState = Readonly<{
  canSetKind(kind: AlertKind): boolean;
  canToggle(kind?: AlertKind): boolean;
  canUnwrap(): boolean;
  canWrap(kind?: AlertKind): boolean;
  getActive(): AlertSnapshot | null;
  getAlerts(): readonly AlertSnapshot[];
  isActive(): boolean;
}>;

export type { AlertsMessageOverrides, AlertsMessages };
export { defaultAlertsMessages };

const alertKindSet = new Set<string>(alertKinds);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOptions(options: AlertsExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({ messages: defaultAlertsMessages });
  }

  if (!isPlainObject(options)) {
    throw new TypeError("Alert extension options must be a plain object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "messages") {
      throw new TypeError(`Unknown alert extension option "${key}".`);
    }
  }

  return Object.freeze({ messages: normalizeAlertsMessages(options.messages) });
}

function assertKind(kind: unknown): AlertKind {
  if (typeof kind !== "string" || !alertKindSet.has(kind)) {
    throw new TypeError(
      'Alert kind must be "note", "tip", "important", "warning", or "caution".',
    );
  }

  return kind as AlertKind;
}

function readNodeKind(node: ProseMirrorNode): AlertKind {
  if (typeof node.attrs.kind !== "string" || !alertKindSet.has(node.attrs.kind)) {
    throw new TypeError(`Alert node has invalid kind "${String(node.attrs.kind)}".`);
  }

  return node.attrs.kind as AlertKind;
}

function tokenAttrs(token: { meta: unknown }) {
  const meta = token.meta as AlertTokenMeta | null;
  return { kind: assertKind(meta?.kind ?? "note") };
}

function kindLabel(kind: AlertKind, messages: AlertsMessages) {
  switch (kind) {
    case "caution":
      return messages.cautionKindLabel;
    case "important":
      return messages.importantKindLabel;
    case "tip":
      return messages.tipKindLabel;
    case "warning":
      return messages.warningKindLabel;
    default:
      return messages.noteKindLabel;
  }
}

function alertDom(node: ProseMirrorNode, messages: AlertsMessages): DOMOutputSpec {
  const kind = readNodeKind(node);
  const label = kindLabel(kind, messages);

  return [
    "aside",
    {
      "aria-label": messages.alertLabel(kind, label),
      class: "mdw-alert",
      "data-mdw-alert": "",
      "data-mdw-alert-kind": kind,
      role: "note",
    },
    [
      "div",
      {
        "aria-hidden": "true",
        class: "mdw-alert__header",
        contenteditable: "false",
        "data-mdw-alert-header": "",
      },
      label,
    ],
    ["div", { class: "mdw-alert__body", "data-mdw-alert-body": "" }, 0],
  ];
}

function createAlertNodeView(
  nodeType: NodeType,
  messages: AlertsMessages,
): NodeViewConstructor {
  return (node, view) => {
    const ownerDocument = view.dom.ownerDocument;
    const dom = ownerDocument.createElement("aside");
    const header = ownerDocument.createElement("div");
    const contentDOM = ownerDocument.createElement("div");

    dom.className = "mdw-alert";
    dom.dataset.mdwAlert = "";
    dom.setAttribute("role", "note");
    header.className = "mdw-alert__header";
    header.dataset.mdwAlertHeader = "";
    header.setAttribute("aria-hidden", "true");
    header.setAttribute("contenteditable", "false");
    contentDOM.className = "mdw-alert__body";
    contentDOM.dataset.mdwAlertBody = "";
    dom.append(header, contentDOM);

    const renderKind = (current: ProseMirrorNode) => {
      const kind = readNodeKind(current);
      const label = kindLabel(kind, messages);
      dom.dataset.mdwAlertKind = kind;
      dom.setAttribute("aria-label", messages.alertLabel(kind, label));
      header.textContent = label;
    };

    renderKind(node);

    return {
      contentDOM,
      dom,
      ignoreMutation(mutation) {
        return mutation.target === header || header.contains(mutation.target);
      },
      update(nextNode) {
        if (nextNode.type !== nodeType) {
          return false;
        }

        renderKind(nextNode);
        return true;
      },
    };
  };
}

function invalidAlertKind(node: ProseMirrorNode, nodeType: NodeType) {
  return node.type === nodeType && (
    typeof node.attrs.kind !== "string" || !alertKindSet.has(node.attrs.kind)
  )
    ? String(node.attrs.kind)
    : null;
}

function invalidAlertNearPosition(
  doc: ProseMirrorNode,
  nodeType: NodeType,
  position: number,
) {
  const bounded = Math.max(0, Math.min(position, doc.content.size));
  const $position = doc.resolve(bounded);

  for (let depth = $position.depth; depth >= 0; depth -= 1) {
    const issue = invalidAlertKind($position.node(depth), nodeType);
    if (issue !== null) {
      return issue;
    }
  }

  return invalidAlertKind($position.nodeAfter ?? $position.nodeBefore ?? doc, nodeType);
}

function invalidAlertInStep(
  doc: ProseMirrorNode,
  nodeType: NodeType,
  step: Transaction["steps"][number],
) {
  let issue: string | null = null;
  const inspectRange = (from: number, to: number) => {
    if (issue !== null) {
      return;
    }

    const boundedFrom = Math.max(0, Math.min(from, doc.content.size));
    const boundedTo = Math.max(boundedFrom, Math.min(to, doc.content.size));
    issue = invalidAlertNearPosition(doc, nodeType, boundedFrom)
      ?? invalidAlertNearPosition(doc, nodeType, boundedTo);

    if (issue !== null || boundedFrom === boundedTo) {
      return;
    }

    doc.nodesBetween(boundedFrom, boundedTo, (node) => {
      issue ??= invalidAlertKind(node, nodeType);
      return issue === null;
    });
  };

  step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
    inspectRange(Math.max(0, newStart - 1), Math.min(doc.content.size, newEnd + 1));
  });

  const positioned = step as unknown as { from?: unknown; pos?: unknown; to?: unknown };
  for (const value of [positioned.pos, positioned.from, positioned.to]) {
    if (typeof value === "number") {
      inspectRange(Math.max(0, value - 1), Math.min(doc.content.size, value + 1));
    }
  }

  return issue;
}

function invalidAlertTransaction(
  transaction: Transaction,
  nodeType: NodeType,
) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const result = transaction.steps[index]!.apply(transaction.docs[index]!);

    if (result.doc) {
      const issue = invalidAlertInStep(result.doc, nodeType, transaction.steps[index]!);
      if (issue !== null) {
        return issue;
      }
    }
  }

  return null;
}

type ActiveAlert = AlertSnapshot & Readonly<{
  depth: number;
  node: ProseMirrorNode;
}>;

function ancestorAlert(
  state: EditorState,
  nodeType: NodeType,
  side: "from" | "to",
): ActiveAlert | null {
  const $position = side === "from" ? state.selection.$from : state.selection.$to;

  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);

    if (node.type === nodeType) {
      return {
        depth,
        kind: readNodeKind(node),
        node,
        position: $position.before(depth),
      };
    }
  }

  return null;
}

function activeAlert(state: EditorState, nodeType: NodeType): ActiveAlert | null {
  if (
    state.selection instanceof NodeSelection
    && state.selection.node.type === nodeType
  ) {
    return {
      depth: state.selection.$from.depth + 1,
      kind: readNodeKind(state.selection.node),
      node: state.selection.node,
      position: state.selection.from,
    };
  }

  const from = ancestorAlert(state, nodeType, "from");
  const to = ancestorAlert(state, nodeType, "to");
  return from && to && from.position === to.position ? from : null;
}

function publicSnapshot(active: ActiveAlert | null): AlertSnapshot | null {
  return active
    ? Object.freeze({ kind: active.kind, position: active.position })
    : null;
}

function collectAlerts(doc: ProseMirrorNode, nodeType: NodeType) {
  const alerts: AlertSnapshot[] = [];

  doc.descendants((node, position) => {
    if (node.type === nodeType) {
      alerts.push(Object.freeze({
        kind: readNodeKind(node),
        position,
      }));
    }
  });

  return Object.freeze(alerts);
}

function createWrapCommand(nodeType: NodeType, kind: AlertKind): Command {
  const command = wrapIn(nodeType, { kind });

  return (state, dispatch, view) => {
    if (view?.composing || activeAlert(state, nodeType)) {
      return false;
    }

    return command(
      state,
      dispatch
        ? (transaction) => dispatch(closeHistory(transaction.scrollIntoView()))
        : undefined,
      view,
    );
  };
}

function createSetKindCommand(nodeType: NodeType, kind: AlertKind): Command {
  return (state, dispatch, view) => {
    const active = activeAlert(state, nodeType);

    if (view?.composing || !active || active.kind === kind) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(
        state.tr.setNodeMarkup(
          active.position,
          nodeType,
          { ...active.node.attrs, kind },
          active.node.marks,
        ).scrollIntoView(),
      ));
    }

    return true;
  };
}

function createUnwrapCommand(nodeType: NodeType): Command {
  return (state, dispatch, view) => {
    const active = activeAlert(state, nodeType);

    if (view?.composing || !active || active.depth < 1) {
      return false;
    }

    const $from = state.doc.resolve(active.position + 1);
    const $to = state.doc.resolve(active.position + active.node.nodeSize - 1);
    const range = $from.blockRange($to, (node) => node.type === nodeType);

    if (!range || range.depth < 1) {
      return false;
    }

    const parent = range.$from.node(range.depth - 1);
    const index = range.$from.index(range.depth - 1);

    if (!parent.canReplace(index, index + 1, active.node.content)) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(
        state.tr.lift(range, range.depth - 1).scrollIntoView(),
      ));
    }

    return true;
  };
}

function sliceContainsAlert(
  fragment: ProseMirrorNode["content"],
  nodeType: NodeType,
): boolean {
  let found = false;

  fragment.forEach((node) => {
    if (found) {
      return;
    }

    found = node.type === nodeType || sliceContainsAlert(node.content, nodeType);
  });

  return found;
}

function openAlertBodySlice(slice: Slice, nodeType: NodeType) {
  let opened = slice;

  while (
    opened.openStart > 0
    && opened.openEnd > 0
    && opened.content.childCount === 1
    && opened.content.firstChild?.type === nodeType
  ) {
    opened = new Slice(
      opened.content.firstChild.content,
      opened.openStart - 1,
      opened.openEnd - 1,
    );
  }

  return opened;
}

export function createAlertsExtension(
  options?: AlertsExtensionOptions,
) {
  const { messages } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-alerts",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.1.0", markora: "^0.1.0" },
    schema: {
      nodes: [{
        name: "alert",
        before: "blockquote",
        spec: {
          attrs: {
            kind: {
              default: "note",
              validate: (value) => assertKind(value),
            },
          },
          content: "block+",
          defining: true,
          group: "block",
          parseDOM: [{
            tag: "aside[data-mdw-alert][data-mdw-alert-kind]",
            contentElement: "[data-mdw-alert-body]",
            getAttrs(dom) {
              const kind = typeof dom === "string"
                ? null
                : (dom as Element).getAttribute("data-mdw-alert-kind");
              return kind && alertKindSet.has(kind) ? { kind } : false;
            },
          }],
          toDOM: (node) => alertDom(node, messages),
        },
      }],
      managedBlocks: ["alert"],
    },
    markdown: {
      tokenizerRules: [{
        id: "marker-claim",
        phase: "block",
        before: ["@markora/foundation/block/blockquote"],
        createRule: createAlertMarkerClaimRule,
      }, {
        id: "blockquote",
        phase: "core",
        after: ["@markora/foundation/core/block"],
        before: ["@markora/foundation/core/inline"],
        createRule: ({ token }) => createAlertTransformRule(
          token("alert_open"),
          token("alert_close"),
        ),
      }],
      parserTokens: {
        alert: {
          block: "alert",
          getAttrs: tokenAttrs,
        },
      },
      serializer: {
        nodes: {
          alert(state, node) {
            const kind = readNodeKind(node).toUpperCase();
            const marker = `[!${kind}]`;

            if (
              node.childCount === 1
              && node.firstChild?.type.name === "paragraph"
              && node.firstChild.content.size === 0
            ) {
              state.wrapBlock("> ", null, node, () => state.write(marker));
              return;
            }

            state.wrapBlock("> ", null, node, () => {
              state.write(marker);

              // A non-paragraph block may either fail to interrupt the marker
              // paragraph (for example a footnote definition) or be mistaken
              // for Setext syntax (a thematic break). Keep an explicit quoted
              // boundary so extension-owned blocks also remain fixed points.
              // Closing the marker lets the next block flush the canonical
              // bare `>` separator instead of emitting trailing whitespace.
              if (node.firstChild?.type.name !== "paragraph") {
                state.closeBlock(node);
              } else {
                state.ensureNewLine();
              }

              state.renderContent(node);
            });
          },
        },
      },
    },
    createRuntime({ codec, getState, reportError, runCommand, schema }) {
      const nodeType = schema.nodes.alert;
      const unwrapCommand = createUnwrapCommand(nodeType);
      const commands: AlertsCommands = {
        setKind(kind) {
          return runCommand(createSetKindCommand(nodeType, assertKind(kind)));
        },
        toggle(kind = "note") {
          const normalized = assertKind(kind);
          return runCommand((state, dispatch, view) => (
            activeAlert(state, nodeType)
              ? unwrapCommand(state, dispatch, view)
              : createWrapCommand(nodeType, normalized)(state, dispatch, view)
          ));
        },
        unwrap: () => runCommand(unwrapCommand),
        wrap(kind = "note") {
          return runCommand(createWrapCommand(nodeType, assertKind(kind)));
        },
      };
      const state: AlertsState = {
        canSetKind(kind) {
          const normalized = assertKind(kind);
          const active = activeAlert(getState(), nodeType);
          return Boolean(active && active.kind !== normalized);
        },
        canToggle(kind = "note") {
          const normalized = assertKind(kind);
          const editorState = getState();
          return activeAlert(editorState, nodeType)
            ? unwrapCommand(editorState)
            : createWrapCommand(nodeType, normalized)(editorState);
        },
        canUnwrap: () => unwrapCommand(getState()),
        canWrap(kind = "note") {
          return createWrapCommand(nodeType, assertKind(kind))(getState());
        },
        getActive: () => publicSnapshot(activeAlert(getState(), nodeType)),
        getAlerts: () => collectAlerts(getState().doc, nodeType),
        isActive: () => Boolean(activeAlert(getState(), nodeType)),
      };

      return {
        commands,
        state,
        plugins: [{
          id: "clipboard",
          create: () => new Plugin({
            props: {
              transformCopied(slice) {
                return openAlertBodySlice(slice, nodeType);
              },
              clipboardTextSerializer(slice) {
                if (
                  slice.openStart !== 0
                  || slice.openEnd !== 0
                  || !sliceContainsAlert(slice.content, nodeType)
                ) {
                  return undefined as never;
                }

                return codec.serialize(schema.topNodeType.create(null, slice.content));
              },
            },
          }),
        }, {
          id: "document-invariant",
          create: () => new Plugin({
            filterTransaction(transaction) {
              if (!transaction.docChanged) {
                return true;
              }

              const invalidKind = invalidAlertTransaction(transaction, nodeType);

              if (invalidKind === null) {
                return true;
              }

              reportError(new MarkdownEditorExtensionError({
                code: "EXTENSION_ALERTS_INVALID_DOCUMENT",
                contribution: "document-invariant",
                extension: "markora-extension-alerts",
                message: messages.invalidDocumentDiagnostic(invalidKind),
                phase: "plugin",
              }));
              return false;
            },
          }),
        }],
        nodeViews: [{
          id: "alert",
          node: "alert",
          create: () => createAlertNodeView(nodeType, messages),
        }],
        ui: [{
          id: "toggle",
          group: "blocks",
          defaultLabel: messages.toggleAlert,
          command: "toggle",
          enabled: "canToggle",
          active: "isActive",
        }],
      } satisfies MarkdownEditorExtensionRuntime<
        undefined,
        AlertsCommands,
        AlertsState
      >;
    },
  });
}

export type AlertsExtension = ReturnType<typeof createAlertsExtension>;
