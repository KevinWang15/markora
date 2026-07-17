import {
  MarkdownEditorExtensionError,
  NodeSelection,
  Plugin,
  PluginKey,
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
  defaultMathMessages,
  normalizeMathMessages,
  type MathMessageOverrides,
  type MathMessages,
} from "./messages";
import {
  MATH_MAX_SOURCE_BYTES,
  canonicalBlockMath,
  canonicalInlineMath,
  collectMathNodeSnapshots,
  createMathNodeIdentityIndex,
  findMathNodeSnapshot,
  isMathTransactionAllowed,
  isValidBlockMathSource,
  isValidInlineMathSource,
  mathSourceUtf8Bytes,
  mapMathNodeIdentityIndex,
  normalizeMathNodeTarget,
  normalizeMathSource,
  readMathNodeSource,
  type MathKind,
  type MathNodeIdentityIndex,
  type MathNodeSnapshot as MathSourceNodeSnapshot,
  type MathNodeTarget,
  type MathNodeTypes,
} from "./source";
import {
  createMathBlockRule,
  createMathImageAltRule,
  createMathInlineRule,
  mathTokenSourceAttrs,
} from "./tokenizer";
import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  createMathRenderManager,
  type MathRenderErrorCode,
  type MathRenderer,
  type MathRenderRequest,
  type MathRenderSnapshot as InternalMathRenderSnapshot,
} from "./renderer";
import {
  createMathNodeView,
  type MathNodeViewController,
} from "./nodeViews";

export {
  MATH_MAX_SOURCE_BYTES,
  defaultMathMessages,
};
export {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
};
export const mathKinds = Object.freeze(["inline", "block"] as const);
export const mathDiagnosticCodes = Object.freeze(["source-too-large"] as const);
export const mathRenderErrorCodes = Object.freeze([
  "renderer-missing",
  "renderer-failed",
  "invalid-output",
  "wrong-document",
  "connected-output",
  "unsafe-output",
  "node-limit",
  "output-byte-limit",
] as const);

export type {
  MathKind,
  MathMessageOverrides,
  MathMessages,
  MathNodeTarget,
  MathRenderer,
  MathRenderRequest,
};

export type MathDiagnosticCode = (typeof mathDiagnosticCodes)[number];
export type { MathRenderErrorCode };
export type MathRenderStatus =
  | "source"
  | "offscreen"
  | "queued"
  | "rendering"
  | "rendered"
  | "error"
  | "source-too-large";

export type MathRenderSnapshot = Readonly<{
  enabled: boolean;
  errorCode: MathRenderErrorCode | null;
  status: MathRenderStatus;
}>;

export type MathNodeSnapshot = MathSourceNodeSnapshot & Readonly<{
  render: MathRenderSnapshot;
}>;

export type MathDiagnostic = Readonly<{
  code: MathDiagnosticCode;
  kind: MathKind;
  message: string;
  position: number;
}>;

export type MathSnapshot = Readonly<{
  diagnostics: readonly MathDiagnostic[];
  nodes: readonly MathNodeSnapshot[];
}>;

export type MathEditRequest = Readonly<{
  convert(kind: MathKind): boolean;
  kind: MathKind;
  position: number;
  remove(): boolean;
  render: MathRenderSnapshot;
  source: string;
  update(source: string): boolean;
}>;

export type MathExtensionOptions = Readonly<{
  messages?: MathMessageOverrides;
  onEditSource?: (request: MathEditRequest) => void;
  renderer?: MathRenderer;
}>;

export type MathCommands = Readonly<{
  convert(target: MathNodeTarget, kind: MathKind): boolean;
  insertBlock(source: string): boolean;
  insertInline(source: string): boolean;
  remove(target: MathNodeTarget): boolean;
  retryPreview(target: MathNodeTarget): boolean;
  togglePreview(target: MathNodeTarget): boolean;
  update(target: MathNodeTarget, source: string): boolean;
}>;

export type MathState = Readonly<{
  getDiagnostics(): readonly MathDiagnostic[];
  getNode(target: MathNodeTarget): MathNodeSnapshot | null;
  getNodes(kind?: MathKind): readonly MathNodeSnapshot[];
  getRenderState(target: MathNodeTarget): MathRenderSnapshot | null;
  getSnapshot(): MathSnapshot;
}>;

const sourceRenderSnapshot: MathRenderSnapshot = Object.freeze({
  enabled: false,
  errorCode: null,
  status: "source",
});

function publicRenderSnapshot(
  snapshot: InternalMathRenderSnapshot,
): MathRenderSnapshot {
  return Object.freeze({
    enabled: snapshot.previewRequested,
    errorCode: snapshot.errorCode,
    status: snapshot.status,
  });
}

function rendererFailureDetails(
  code: MathRenderErrorCode,
  kind: MathKind,
  messages: MathMessages,
) {
  if (code === "renderer-missing") {
    return {
      code: "EXTENSION_MATH_RENDERER_MISSING",
      contribution: "renderer",
      message: messages.rendererUnavailable,
    } as const;
  }

  if (code === "renderer-failed") {
    return {
      code: "EXTENSION_MATH_RENDERER_FAILED",
      contribution: "renderer",
      message: messages.rendererFailedDiagnostic(kind),
    } as const;
  }

  if (code === "unsafe-output") {
    return {
      code: "EXTENSION_MATH_UNSAFE_RENDERER_OUTPUT",
      contribution: "dom-clamp",
      message: messages.unsafeRendererOutputDiagnostic(kind),
    } as const;
  }

  if (code === "node-limit" || code === "output-byte-limit") {
    return {
      code: "EXTENSION_MATH_RENDER_OUTPUT_LIMIT",
      contribution: "limits",
      message: messages.renderOutputLimitDiagnostic(kind),
    } as const;
  }

  return {
    code: "EXTENSION_MATH_INVALID_RENDERER_OUTPUT",
    contribution: "dom-clamp",
    message: messages.invalidRendererOutputDiagnostic(kind),
  } as const;
}

function assertSource(value: unknown) {
  if (typeof value !== "string") {
    throw new TypeError("Math source must be a string.");
  }

  return normalizeMathSource(value);
}

function assertKind(value: unknown): MathKind {
  if (value !== "inline" && value !== "block") {
    throw new TypeError('Math kind must be "inline" or "block".');
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOptions(options: MathExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({
      messages: defaultMathMessages,
      onEditSource: undefined,
      renderer: undefined,
    });
  }

  if (!isPlainObject(options)) {
    throw new TypeError("Math extension options must be a plain object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "messages" && key !== "onEditSource" && key !== "renderer") {
      throw new TypeError(`Unknown math extension option "${key}".`);
    }
  }

  if (
    options.onEditSource !== undefined
    && typeof options.onEditSource !== "function"
  ) {
    throw new TypeError("Math onEditSource must be a function.");
  }

  if (options.renderer !== undefined && typeof options.renderer !== "function") {
    throw new TypeError("Math renderer must be a function.");
  }

  return Object.freeze({
    messages: normalizeMathMessages(options.messages),
    onEditSource: options.onEditSource,
    renderer: options.renderer,
  });
}

function invalidSourceError(
  kind: MathKind,
  messages: MathMessages,
  phase: "command" | "node-view" | "serialize",
) {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_MATH_INVALID_SOURCE",
    contribution: `${kind}-source`,
    extension: "markora-extension-math",
    message: kind === "inline"
      ? messages.invalidInlineSourceDiagnostic
      : messages.invalidBlockSourceDiagnostic,
    phase,
  });
}

function readDomSource(dom: HTMLElement, kind: MathKind) {
  const shell = dom.querySelector("[data-mdw-math-source]")?.textContent
    ?? dom.textContent
    ?? "";

  if (kind === "inline") {
    if (shell.startsWith("$") && shell.endsWith("$") && shell.length >= 2) {
      const source = shell.slice(1, -1);
      return isValidInlineMathSource(source) ? source : null;
    }

    return isValidInlineMathSource(shell) ? shell : null;
  }

  const normalized = normalizeMathSource(shell);
  const source = normalized.startsWith("$$\n") && normalized.endsWith("\n$$")
    ? normalized.slice(3, -3)
    : normalized;
  return isValidBlockMathSource(source) ? source : null;
}

function staticMathDom(
  node: ProseMirrorNode,
  kind: MathKind,
  messages: MathMessages,
): DOMOutputSpec {
  const source = readMathNodeSource(node) ?? "";
  const shell = kind === "inline"
    ? isValidInlineMathSource(source) ? canonicalInlineMath(source) : source
    : isValidBlockMathSource(source) ? canonicalBlockMath(source) : source;
  const kindLabel = kind === "inline"
    ? messages.inlineKindLabel
    : messages.blockKindLabel;
  const sourceLabel = kind === "inline"
    ? messages.inlineSourceLabel(source)
    : messages.blockSourceLabel(source);
  const tag = kind === "inline" ? "span" : "div";

  return [
    tag,
    {
      "aria-label": sourceLabel,
      class: `mdw-math mdw-math--${kind}`,
      contenteditable: "false",
      "data-mdw-math": "",
      "data-mdw-math-kind": kind,
      role: "math",
    },
    ["span", { class: "mdw-math__kind" }, kindLabel],
    [kind === "inline" ? "span" : "pre", {
      class: "mdw-math__source-shell",
    }, ["code", {
      class: "mdw-math__source",
      "data-mdw-math-source": "",
    }, shell]],
  ];
}

function lineAlternates() {
  return ["paragraph", "reference", "blockquote", "list"];
}

function findInsertedNode(transaction: Transaction, inserted: ProseMirrorNode) {
  let position: number | null = null;

  transaction.doc.descendants((node, nodePosition) => {
    if (node === inserted) {
      position = nodePosition;
      return false;
    }
    return position === null;
  });

  return position;
}

function selectInsertedNode(
  transaction: Transaction,
  inserted: ProseMirrorNode,
) {
  const position = findInsertedNode(transaction, inserted);
  return position === null
    ? transaction
    : transaction.setSelection(NodeSelection.create(transaction.doc, position));
}

type MathIdentityLookup = (state: EditorState) => MathNodeIdentityIndex;

function createInsertCommand(
  kind: MathKind,
  nodeType: NodeType,
  source: string,
  types: MathNodeTypes,
): Command {
  return (state, dispatch, view) => {
    if (view?.composing) {
      return false;
    }

    const node = nodeType.create({ source });
    let transaction = state.tr.replaceSelectionWith(node, kind === "inline");

    if (!isMathTransactionAllowed(transaction, types)) {
      return false;
    }

    transaction = selectInsertedNode(transaction, node);

    if (dispatch) {
      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function targetNode(
  doc: ProseMirrorNode,
  types: MathNodeTypes,
  target: MathNodeTarget,
  identities: MathNodeIdentityIndex,
) {
  const normalized = normalizeMathNodeTarget(target);
  const snapshot = findMathNodeSnapshot(doc, types, normalized, identities);
  const node = snapshot ? doc.nodeAt(snapshot.position) : null;
  return node && snapshot ? { node, snapshot } : null;
}

function createUpdateCommand(
  target: MathNodeTarget,
  source: string,
  types: MathNodeTypes,
  identities: MathIdentityLookup,
): Command {
  return (state, dispatch, view) => {
    const current = targetNode(state.doc, types, target, identities(state));

    if (view?.composing || !current || current.snapshot.source === source) {
      return false;
    }

    let transaction = state.tr.setNodeMarkup(
      current.snapshot.position,
      current.node.type,
      { ...current.node.attrs, source },
      current.node.marks,
    );

    if (!isMathTransactionAllowed(transaction, types)) {
      return false;
    }

    transaction = transaction.setSelection(NodeSelection.create(
      transaction.doc,
      current.snapshot.position,
    ));

    if (dispatch) {
      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

function createRemoveCommand(
  target: MathNodeTarget,
  types: MathNodeTypes,
  identities: MathIdentityLookup,
): Command {
  return (state, dispatch, view) => {
    const current = targetNode(state.doc, types, target, identities(state));

    if (view?.composing || !current) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(state.tr.delete(
        current.snapshot.position,
        current.snapshot.position + current.node.nodeSize,
      ).scrollIntoView()));
    }

    return true;
  };
}

function createConvertCommand(
  target: MathNodeTarget,
  nextKind: MathKind,
  types: MathNodeTypes,
  paragraphType: NodeType,
  identities: MathIdentityLookup,
): Command {
  return (state, dispatch, view) => {
    const current = targetNode(state.doc, types, target, identities(state));

    if (view?.composing || !current || current.snapshot.kind === nextKind) {
      return false;
    }

    const position = current.snapshot.position;
    const resolved = state.doc.resolve(position);
    let inserted: ProseMirrorNode;
    let from: number;
    let to: number;

    if (nextKind === "block") {
      const textblock = resolved.parent;

      if (
        !textblock.isTextblock
        || textblock.childCount !== 1
        || textblock.firstChild !== current.node
        || resolved.depth < 1
      ) {
        return false;
      }

      const container = resolved.node(resolved.depth - 1);
      const index = resolved.index(resolved.depth - 1);

      if (!container.canReplaceWith(index, index + 1, types.block)) {
        return false;
      }

      inserted = types.block.create({ source: current.snapshot.source });
      from = resolved.before(resolved.depth);
      to = from + textblock.nodeSize;
    } else {
      if (!isValidInlineMathSource(current.snapshot.source)) {
        return false;
      }

      const index = resolved.index();

      if (!resolved.parent.canReplaceWith(index, index + 1, paragraphType)) {
        return false;
      }

      const inline = types.inline.create({ source: current.snapshot.source });
      inserted = paragraphType.create(null, inline);
      from = position;
      to = position + current.node.nodeSize;
    }

    let transaction = state.tr.replaceWith(from, to, inserted);

    if (!isMathTransactionAllowed(transaction, types)) {
      return false;
    }

    const selected = nextKind === "block"
      ? findInsertedNode(transaction, inserted)
      : findInsertedNode(transaction, inserted.firstChild!);

    if (selected !== null) {
      transaction = transaction.setSelection(NodeSelection.create(
        transaction.doc,
        selected,
      ));
    }

    if (dispatch) {
      dispatch(closeHistory(transaction.scrollIntoView()));
    }

    return true;
  };
}

export function createMathExtension(options?: MathExtensionOptions) {
  const { messages, onEditSource, renderer } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-math",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.2.0", markora: "^0.0.1" },
    schema: {
      nodes: [
        {
          name: "math_inline",
          before: "image",
          spec: {
            atom: true,
            attrs: { source: { validate: "string" } },
            group: "inline",
            inline: true,
            leafText: (node) => {
              const source = readMathNodeSource(node);
              return source !== null && isValidInlineMathSource(source)
                ? canonicalInlineMath(source)
                : source ?? "";
            },
            parseDOM: [{
              tag: '[data-mdw-math][data-mdw-math-kind="inline"]',
              getAttrs(dom) {
                const source = readDomSource(dom, "inline");
                return source === null ? false : { source };
              },
            }],
            selectable: true,
            toDOM: (node) => staticMathDom(node, "inline", messages),
          },
        },
        {
          name: "math_block",
          before: "blockquote",
          spec: {
            atom: true,
            attrs: { source: { validate: "string" } },
            defining: true,
            group: "block",
            isolating: true,
            leafText: (node) => {
              const source = readMathNodeSource(node);
              return source !== null && isValidBlockMathSource(source)
                ? canonicalBlockMath(source)
                : source ?? "";
            },
            parseDOM: [{
              tag: '[data-mdw-math][data-mdw-math-kind="block"]',
              getAttrs(dom) {
                const source = readDomSource(dom, "block");
                return source === null ? false : { source };
              },
            }],
            selectable: true,
            toDOM: (node) => staticMathDom(node, "block", messages),
          },
        },
      ],
      managedBlocks: ["math_block"],
    },
    markdown: {
      tokenizerRules: [
        {
          id: "block",
          phase: "block",
          before: [
            { id: "@markora/opaque/display-math", optional: true },
            { id: "markora-extension-footnotes/definition", optional: true },
            "@markora/foundation/block/fence",
          ],
          options: { alt: lineAlternates() },
          createRule: ({ token }) => createMathBlockRule(token("block")),
        },
        {
          id: "inline",
          phase: "inline",
          before: [
            { id: "markora-extension-footnotes/math-code-context", optional: true },
            { id: "markora-extension-footnotes/reference", optional: true },
            "@markora/foundation/inline/text",
          ],
          createRule: ({ token }) => createMathInlineRule(token("inline")),
        },
        {
          id: "image-alt",
          phase: "core",
          after: [
            "@markora/foundation/core/inline",
            { id: "@markora/opaque/inline-source", optional: true },
          ],
          before: [
            { id: "markora-extension-footnotes/contexts", optional: true },
          ],
          createRule: ({ token }) => createMathImageAltRule(token("inline")),
        },
      ],
      parserTokens: {
        block: { node: "math_block", getAttrs: mathTokenSourceAttrs },
        inline: { node: "math_inline", getAttrs: mathTokenSourceAttrs },
      },
      serializer: {
        escapeExtraCharacters: "$",
        nodes: {
          math_block(state, node) {
            const source = readMathNodeSource(node);

            if (source === null || !isValidBlockMathSource(source)) {
              throw invalidSourceError("block", messages, "serialize");
            }

            state.text(canonicalBlockMath(source), false);
            state.closeBlock(node);
          },
          math_inline(state, node) {
            const source = readMathNodeSource(node);

            if (source === null || !isValidInlineMathSource(source)) {
              throw invalidSourceError("inline", messages, "serialize");
            }

            state.text(canonicalInlineMath(source), false);
          },
        },
      },
    },
    createRuntime({
      getState,
      lifecycle,
      ownerDocument,
      reportError,
      runCommand,
      schema,
    }) {
      const types: MathNodeTypes = Object.freeze({
        block: schema.nodes.math_block,
        code: schema.marks.code,
        inline: schema.nodes.math_inline,
      });
      const paragraphType = schema.nodes.paragraph;
      const identityKey = new PluginKey<MathNodeIdentityIndex>(
        "markora-extension-math-identity",
      );
      const controllers = new Set<MathNodeViewController>();
      let editVersion = 0;
      const manager = createMathRenderManager({
        lifecycle,
        ownerDocument,
        renderer,
        onRenderError({ cause, code, kind }) {
          const detail = rendererFailureDetails(code, kind, messages);
          reportError(new MarkdownEditorExtensionError({
            ...detail,
            cause,
            extension: "markora-extension-math",
            phase: "node-view",
          }));
        },
        onSourceTooLarge({ maxBytes }) {
          reportError(new MarkdownEditorExtensionError({
            code: "EXTENSION_MATH_SOURCE_TOO_LARGE",
            contribution: "limits",
            extension: "markora-extension-math",
            message: messages.sourceTooLargeDiagnostic(maxBytes),
            phase: "node-view",
          }));
        },
      });
      const identities: MathIdentityLookup = (editorState) => {
        const index = identityKey.getState(editorState);

        if (!index) {
          throw new Error("Math node identities are unavailable before plugin initialization.");
        }

        return index;
      };
      const baseNodes = () => collectMathNodeSnapshots(identities(getState()));
      const findController = (target: MathNodeTarget) => {
        const normalized = normalizeMathNodeTarget(target);

        for (const controller of controllers) {
          if (
            controller.kind === normalized.kind
            && controller.source === normalized.source
            && controller.getPosition() === normalized.position
            && controller.isCurrent()
          ) {
            return controller;
          }
        }

        return null;
      };
      const renderSnapshot = (target: MathNodeTarget): MathRenderSnapshot => {
        const controller = findController(target);

        if (controller) {
          return publicRenderSnapshot(controller.getRenderSnapshot());
        }

        return renderer
          ? Object.freeze({ ...sourceRenderSnapshot, enabled: true })
          : sourceRenderSnapshot;
      };
      const decorate = (node: MathSourceNodeSnapshot): MathNodeSnapshot => Object.freeze({
        ...node,
        render: renderSnapshot(node),
      });
      const diagnostics = () => Object.freeze(baseNodes().flatMap((node) => (
        mathSourceUtf8Bytes(node.source) > MATH_MAX_SOURCE_BYTES
          ? [Object.freeze({
              code: "source-too-large" as const,
              kind: node.kind,
              message: messages.sourceTooLargeDiagnostic(MATH_MAX_SOURCE_BYTES),
              position: node.position,
            })]
          : []
      )));
      const commands: MathCommands = {
        convert(target, kind) {
          const normalized = normalizeMathNodeTarget(target);
          return runCommand(createConvertCommand(
            normalized,
            assertKind(kind),
            types,
            paragraphType,
            identities,
          ));
        },
        insertBlock(source) {
          const normalized = assertSource(source);

          if (!isValidBlockMathSource(normalized)) {
            reportError(invalidSourceError("block", messages, "command"));
            return false;
          }

          return runCommand(createInsertCommand(
            "block",
            types.block,
            normalized,
            types,
          ));
        },
        insertInline(source) {
          const normalized = assertSource(source);

          if (!isValidInlineMathSource(normalized)) {
            reportError(invalidSourceError("inline", messages, "command"));
            return false;
          }

          return runCommand(createInsertCommand(
            "inline",
            types.inline,
            normalized,
            types,
          ));
        },
        remove(target) {
          return runCommand(createRemoveCommand(
            normalizeMathNodeTarget(target),
            types,
            identities,
          ));
        },
        retryPreview(target) {
          const normalized = normalizeMathNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (
              view?.composing
              || !findMathNodeSnapshot(
                state.doc,
                types,
                normalized,
                identities(state),
              )
            ) {
              return false;
            }

            return findController(normalized)?.retryPreview() ?? false;
          });
        },
        togglePreview(target) {
          const normalized = normalizeMathNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (
              view?.composing
              || !findMathNodeSnapshot(
                state.doc,
                types,
                normalized,
                identities(state),
              )
            ) {
              return false;
            }

            return findController(normalized)?.togglePreview() ?? false;
          });
        },
        update(target, source) {
          const normalizedTarget = normalizeMathNodeTarget(target);
          const normalizedSource = assertSource(source);
          const valid = normalizedTarget.kind === "inline"
            ? isValidInlineMathSource(normalizedSource)
            : isValidBlockMathSource(normalizedSource);

          if (!valid) {
            reportError(invalidSourceError(
              normalizedTarget.kind,
              messages,
              "command",
            ));
            return false;
          }

          return runCommand(createUpdateCommand(
            normalizedTarget,
            normalizedSource,
            types,
            identities,
          ));
        },
      };
      const handOffSourceEdit = (controller: MathNodeViewController) => {
        if (!onEditSource) {
          return;
        }

        const position = controller.getPosition();

        if (position === null || !controller.isCurrent()) {
          return;
        }

        const requestedNode = controller.node;
        const target = baseNodes().find((node) => (
          node.kind === controller.kind
          && node.position === position
          && node.source === controller.source
        ));

        if (!target) {
          return;
        }

        const requestVersion = ++editVersion;
        const requestIsCurrent = () => (
          requestVersion === editVersion
          && controller.node === requestedNode
          && controller.isCurrent()
          && findMathNodeSnapshot(
            getState().doc,
            types,
            target,
            identities(getState()),
          ) !== null
        );
        const request: MathEditRequest = Object.freeze({
          convert(kind) {
            const nextKind = assertKind(kind);
            return requestIsCurrent()
              ? commands.convert(target, nextKind)
              : false;
          },
          kind: target.kind,
          position: target.position,
          remove: () => requestIsCurrent() ? commands.remove(target) : false,
          render: publicRenderSnapshot(controller.getRenderSnapshot()),
          source: target.source,
          update(source) {
            const normalized = assertSource(source);

            if (!requestIsCurrent()) {
              return false;
            }

            if (normalized === target.source) {
              return true;
            }

            const valid = target.kind === "inline"
              ? isValidInlineMathSource(normalized)
              : isValidBlockMathSource(normalized);

            if (!valid) {
              reportError(invalidSourceError(
                target.kind,
                messages,
                "node-view",
              ));
              return false;
            }

            return commands.update(target, normalized);
          },
        });

        onEditSource(request);
      };
      const state: MathState = {
        getDiagnostics: diagnostics,
        getNode(target) {
          const normalized = normalizeMathNodeTarget(target);
          const editorState = getState();
          const node = findMathNodeSnapshot(
            editorState.doc,
            types,
            normalized,
            identities(editorState),
          );
          return node ? decorate(node) : null;
        },
        getNodes(kind) {
          const normalizedKind = kind === undefined ? undefined : assertKind(kind);
          return Object.freeze(baseNodes()
            .filter((node) => normalizedKind === undefined || node.kind === normalizedKind)
            .map(decorate));
        },
        getRenderState(target) {
          const normalized = normalizeMathNodeTarget(target);
          const editorState = getState();
          return findMathNodeSnapshot(
            editorState.doc,
            types,
            normalized,
            identities(editorState),
          )
            ? renderSnapshot(normalized)
            : null;
        },
        getSnapshot() {
          return Object.freeze({
            diagnostics: diagnostics(),
            nodes: Object.freeze(baseNodes().map(decorate)),
          });
        },
      };
      const runtime = {
        commands,
        state,
        plugins: [
          {
            id: "identity",
            create: () => new Plugin<MathNodeIdentityIndex>({
              key: identityKey,
              state: {
                init: (_configuration, editorState) => (
                  createMathNodeIdentityIndex(editorState.doc, types)
                ),
                apply: (transaction, previous) => (
                  mapMathNodeIdentityIndex(transaction, types, previous)
                ),
              },
            }),
          },
          {
            id: "invariant",
            create: () => new Plugin({
              filterTransaction(transaction) {
                if (isMathTransactionAllowed(transaction, types)) {
                  return true;
                }

                reportError(new MarkdownEditorExtensionError({
                  code: "EXTENSION_MATH_INVALID_DOCUMENT",
                  contribution: "document-invariant",
                  extension: "markora-extension-math",
                  message: messages.invalidDocumentDiagnostic,
                  phase: "plugin",
                }));
                return false;
              },
              view(editorView) {
                let editable = editorView.editable;
                let composing = editorView.composing;

                return {
                  update(editorView) {
                    const nextEditable = editorView.editable;
                    const nextComposing = editorView.composing;

                    if (
                      nextEditable === editable
                      && nextComposing === composing
                    ) {
                      return;
                    }

                    editable = nextEditable;
                    composing = nextComposing;
                    for (const controller of [...controllers]) {
                      controller.refresh();
                    }
                  },
                };
              },
            }),
          },
        ],
        nodeViews: [
          {
            id: "inline",
            node: "math_inline",
            create: () => createMathNodeView({
              kind: "inline",
              manager,
              messages,
              nodeType: types.inline,
              onCreate: (controller) => controllers.add(controller),
              onDestroy(controller) {
                controllers.delete(controller);
                editVersion += 1;
              },
              ...(onEditSource ? { onEditSource: handOffSourceEdit } : {}),
              readSource: (node) => readMathNodeSource(node) ?? "",
              reportError,
            }),
          },
          {
            id: "block",
            node: "math_block",
            create: () => createMathNodeView({
              kind: "block",
              manager,
              messages,
              nodeType: types.block,
              onCreate: (controller) => controllers.add(controller),
              onDestroy(controller) {
                controllers.delete(controller);
                editVersion += 1;
              },
              ...(onEditSource ? { onEditSource: handOffSourceEdit } : {}),
              readSource: (node) => readMathNodeSource(node) ?? "",
              reportError,
            }),
          },
        ],
        setup({ editor }) {
          return editor.subscribe("state", (event) => {
            if (event.origin === "external" || event.origin === "reset") {
              editVersion += 1;
              manager.invalidateAll();
            }
          });
        },
      } satisfies MarkdownEditorExtensionRuntime<
        undefined,
        MathCommands,
        MathState
      >;

      return runtime;
    },
  });
}

export type MathExtension = ReturnType<typeof createMathExtension>;
