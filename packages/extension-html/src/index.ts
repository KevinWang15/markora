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
  type MarkdownEditorCodec,
  type MarkdownEditorExtensionRuntime,
  type Node as ProseMirrorNode,
  type NodeType,
  type Transaction,
} from "markora/extension-api";
import {
  defaultHtmlMessages,
  normalizeHtmlMessages,
  type HtmlMessageOverrides,
  type HtmlMessages,
} from "./messages";
import {
  createHtmlNodeView,
  type HtmlNodeViewController,
} from "./nodeViews";
import {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  createHtmlRenderManager,
  type HtmlRenderErrorCode,
  type HtmlRenderer,
  type HtmlRenderRequest,
  type HtmlRenderSnapshot as InternalHtmlRenderSnapshot,
  type HtmlRenderStatus,
} from "./renderer";
import {
  HTML_MAX_SOURCE_BYTES,
  classifyHtmlSource,
  codecClassifiesSingleHtmlAtom,
  collectHtmlNodeSnapshots,
  createHtmlNodeIdentityIndex,
  findHtmlNodeSnapshot,
  htmlSourceUtf8Bytes,
  isHtmlTransactionAllowed,
  mapHtmlNodeIdentityIndex,
  normalizeHtmlNodeTarget,
  readHtmlNodeKind,
  readHtmlNodeSource,
  type HtmlDisplay,
  type HtmlNodeIdentityIndex,
  type HtmlNodeTarget,
  type HtmlNodeTypes,
  type HtmlSourceKind,
  type HtmlSourceSnapshot,
} from "./source";
import {
  createHtmlClaimRule,
  htmlTokenAttrs,
} from "./tokenizer";

export { defaultHtmlMessages };
export {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_SOURCE_BYTES,
};
export const htmlDisplays = Object.freeze(["block", "inline"] as const);
export const htmlSourceKinds = Object.freeze([
  "html-block",
  "inline-html",
  "html-comment",
] as const);
export const htmlDiagnosticCodes = Object.freeze(["source-too-large"] as const);
export const htmlRenderErrorCodes = Object.freeze([
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
  HtmlDisplay,
  HtmlMessageOverrides,
  HtmlMessages,
  HtmlNodeTarget,
  HtmlRenderer,
  HtmlRenderErrorCode,
  HtmlRenderRequest,
  HtmlRenderStatus,
  HtmlSourceKind,
};

export type HtmlDiagnosticCode = (typeof htmlDiagnosticCodes)[number];

export type HtmlRenderSnapshot = Readonly<{
  enabled: boolean;
  errorCode: HtmlRenderErrorCode | null;
  status: HtmlRenderStatus;
}>;

export type HtmlNodeSnapshot = HtmlSourceSnapshot & Readonly<{
  render: HtmlRenderSnapshot;
}>;

export type HtmlDiagnostic = Readonly<{
  code: HtmlDiagnosticCode;
  display: HtmlDisplay;
  kind: HtmlSourceKind;
  message: string;
  position: number;
}>;

export type HtmlSnapshot = Readonly<{
  diagnostics: readonly HtmlDiagnostic[];
  nodes: readonly HtmlNodeSnapshot[];
}>;

export type HtmlEditRequest = Readonly<{
  display: HtmlDisplay;
  identity: number;
  kind: HtmlSourceKind;
  position: number;
  remove(): boolean;
  render: HtmlRenderSnapshot;
  source: string;
  update(source: string): boolean;
}>;

export type HtmlExtensionOptions = Readonly<{
  messages?: HtmlMessageOverrides;
  onEditSource?: (request: HtmlEditRequest) => void;
  renderer?: HtmlRenderer;
}>;

export type HtmlCommands = Readonly<{
  remove(target: HtmlNodeTarget): boolean;
  retryPreview(target: HtmlNodeTarget): boolean;
  togglePreview(target: HtmlNodeTarget): boolean;
  update(target: HtmlNodeTarget, source: string): boolean;
}>;

export type HtmlState = Readonly<{
  getDiagnostics(): readonly HtmlDiagnostic[];
  getNode(target: HtmlNodeTarget): HtmlNodeSnapshot | null;
  getNodes(display?: HtmlDisplay): readonly HtmlNodeSnapshot[];
  getRenderState(target: HtmlNodeTarget): HtmlRenderSnapshot | null;
  getSnapshot(): HtmlSnapshot;
}>;

const sourceRenderSnapshot: HtmlRenderSnapshot = Object.freeze({
  enabled: false,
  errorCode: null,
  status: "source",
});

function publicRenderSnapshot(snapshot: InternalHtmlRenderSnapshot): HtmlRenderSnapshot {
  return Object.freeze({
    enabled: snapshot.previewRequested,
    errorCode: snapshot.errorCode,
    status: snapshot.status,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOptions(options: HtmlExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({
      messages: defaultHtmlMessages,
      onEditSource: undefined,
      renderer: undefined,
    });
  }
  if (!isPlainObject(options)) {
    throw new TypeError("HTML extension options must be a plain object.");
  }
  for (const key of Object.keys(options)) {
    if (key !== "messages" && key !== "onEditSource" && key !== "renderer") {
      throw new TypeError(`Unknown HTML extension option "${key}".`);
    }
  }
  if (options.onEditSource !== undefined && typeof options.onEditSource !== "function") {
    throw new TypeError("HTML onEditSource must be a function.");
  }
  if (options.renderer !== undefined && typeof options.renderer !== "function") {
    throw new TypeError("HTML renderer must be a function.");
  }
  return Object.freeze({
    messages: normalizeHtmlMessages(options.messages),
    onEditSource: options.onEditSource,
    renderer: options.renderer,
  });
}

function assertSource(value: unknown) {
  if (typeof value !== "string") {
    throw new TypeError("HTML source must be a string.");
  }
  return value;
}

function assertDisplay(value: unknown): HtmlDisplay {
  if (value !== "block" && value !== "inline") {
    throw new TypeError('HTML display must be "block" or "inline".');
  }
  return value;
}

function invalidSourceError(
  display: HtmlDisplay,
  messages: HtmlMessages,
  phase: "command" | "node-view" | "serialize",
) {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_HTML_INVALID_SOURCE",
    contribution: `${display}-source`,
    extension: "markora-extension-html",
    message: messages.invalidSourceDiagnostic(display),
    phase,
  });
}

function renderFailureDetails(code: HtmlRenderErrorCode, messages: HtmlMessages) {
  if (code === "renderer-missing") {
    return {
      code: "EXTENSION_HTML_RENDERER_MISSING",
      contribution: "renderer",
      message: messages.rendererUnavailable,
    } as const;
  }
  if (code === "renderer-failed") {
    return {
      code: "EXTENSION_HTML_RENDERER_FAILED",
      contribution: "renderer",
      message: messages.rendererFailedDiagnostic,
    } as const;
  }
  if (code === "unsafe-output") {
    return {
      code: "EXTENSION_HTML_UNSAFE_RENDERER_OUTPUT",
      contribution: "dom-clamp",
      message: messages.unsafeRendererOutputDiagnostic,
    } as const;
  }
  if (code === "node-limit" || code === "output-byte-limit") {
    return {
      code: "EXTENSION_HTML_RENDER_OUTPUT_LIMIT",
      contribution: "limits",
      message: messages.renderOutputLimitDiagnostic,
    } as const;
  }
  return {
    code: "EXTENSION_HTML_INVALID_RENDERER_OUTPUT",
    contribution: "dom-clamp",
    message: messages.invalidRendererOutputDiagnostic,
  } as const;
}

function readDomAttrs(dom: HTMLElement, display: HtmlDisplay) {
  const source = dom.querySelector("[data-mdw-html-source]")?.textContent
    ?? dom.textContent
    ?? "";
  const kind = classifyHtmlSource(source, display);
  const declared = dom.dataset.mdwHtmlKind;
  return kind && declared === kind ? { kind, source } : false;
}

function staticHtmlDom(
  node: ProseMirrorNode,
  display: HtmlDisplay,
  messages: HtmlMessages,
): DOMOutputSpec {
  const source = readHtmlNodeSource(node) ?? "";
  const kind = readHtmlNodeKind(node) ?? (display === "block" ? "html-block" : "inline-html");
  const tag = display === "block" ? "div" : "span";
  const sourceTag = display === "block" ? "pre" : "span";
  const label = kind === "html-comment"
    ? messages.commentKindLabel
    : display === "block" ? messages.blockKindLabel : messages.inlineKindLabel;

  return [
    tag,
    {
      class: `mdw-html mdw-html--${display}`,
      contenteditable: "false",
      "data-mdw-html": "",
      "data-mdw-html-display": display,
      "data-mdw-html-kind": kind,
      "aria-label": label,
      role: "group",
    },
    [tag, { class: "mdw-html__header" },
      ["span", { class: "mdw-html__kind" }, label]],
    [sourceTag, { class: "mdw-html__source-shell" },
      ["span", { class: "mdw-html__visually-hidden" }, messages.sourceLabel(kind)],
      ["code", { class: "mdw-html__source", "data-mdw-html-source": "" }, source]],
  ];
}

type IdentityLookup = (state: EditorState) => HtmlNodeIdentityIndex;

function targetNode(
  doc: ProseMirrorNode,
  types: HtmlNodeTypes,
  target: HtmlNodeTarget,
  identities: HtmlNodeIdentityIndex,
) {
  const normalized = normalizeHtmlNodeTarget(target);
  const snapshot = findHtmlNodeSnapshot(doc, types, normalized, identities);
  const node = snapshot ? doc.nodeAt(snapshot.position) : null;
  return node && snapshot ? { node, snapshot } : null;
}

function createUpdateCommand(
  target: HtmlNodeTarget,
  source: string,
  codec: MarkdownEditorCodec,
  messages: HtmlMessages,
  reportError: (error: unknown, contribution?: string) => void,
  types: HtmlNodeTypes,
  identities: IdentityLookup,
): Command {
  return (state, dispatch, view) => {
    const current = targetNode(state.doc, types, target, identities(state));
    if (view?.composing || !current || current.snapshot.source === source) return false;

    const kind = codecClassifiesSingleHtmlAtom(
      codec,
      source,
      current.snapshot.display,
      current.node.type,
    );

    if (!kind) {
      reportError(invalidSourceError(current.snapshot.display, messages, "command"));
      return false;
    }

    let transaction = state.tr.setNodeMarkup(
      current.snapshot.position,
      current.node.type,
      { kind, source },
      current.node.marks,
    );
    if (!isHtmlTransactionAllowed(transaction, types)) return false;
    transaction = transaction.setSelection(NodeSelection.create(
      transaction.doc,
      current.snapshot.position,
    ));
    if (dispatch) dispatch(closeHistory(transaction.scrollIntoView()));
    return true;
  };
}

function createRemoveCommand(
  target: HtmlNodeTarget,
  types: HtmlNodeTypes,
  identities: IdentityLookup,
): Command {
  return (state, dispatch, view) => {
    const current = targetNode(state.doc, types, target, identities(state));
    if (view?.composing || !current) return false;
    let transaction = state.tr.delete(
      current.snapshot.position,
      current.snapshot.position + current.node.nodeSize,
    );
    const targetPosition = Math.min(current.snapshot.position, transaction.doc.content.size);
    transaction = transaction.setSelection(Selection.near(
      transaction.doc.resolve(targetPosition),
      targetPosition >= transaction.doc.content.size ? -1 : 1,
    ));
    if (dispatch) dispatch(closeHistory(transaction.scrollIntoView()));
    return true;
  };
}

export function createHtmlExtension(options?: HtmlExtensionOptions) {
  const { messages, onEditSource, renderer } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-html",
    version: "0.0.1",
    compatibility: {
      extensionApi: "^1.3.0",
      markora: "^0.0.1",
      runtime: "root-default",
    },
    schema: {
      nodes: [
        {
          name: "html_inline",
          before: "image",
          spec: {
            atom: true,
            attrs: {
              kind: { default: "inline-html" },
              source: { validate: "string" },
            },
            draggable: true,
            group: "inline",
            inline: true,
            leafText: (node) => readHtmlNodeSource(node) ?? "",
            parseDOM: [{
              tag: '[data-mdw-html][data-mdw-html-display="inline"]',
              getAttrs: (dom) => readDomAttrs(dom, "inline"),
            }],
            selectable: true,
            toDOM: (node) => staticHtmlDom(node, "inline", messages),
          },
        },
        {
          name: "html_block",
          before: "blockquote",
          spec: {
            atom: true,
            attrs: {
              kind: { default: "html-block" },
              source: { validate: "string" },
            },
            defining: true,
            draggable: true,
            createGapCursor: true,
            group: "block",
            isolating: true,
            leafText: (node) => readHtmlNodeSource(node) ?? "",
            parseDOM: [{
              tag: '[data-mdw-html][data-mdw-html-display="block"]',
              getAttrs: (dom) => readDomAttrs(dom, "block"),
            }],
            selectable: true,
            toDOM: (node) => staticHtmlDom(node, "block", messages),
          },
        },
      ],
      managedBlocks: ["html_block"],
    },
    markdown: {
      tokenizerRules: [{
        id: "claim",
        phase: "core",
        after: ["@markora/opaque/inline-source"],
        createRule: ({ token }) => createHtmlClaimRule(token("block"), token("inline")),
      }],
      parserTokens: {
        block: { node: "html_block", getAttrs: htmlTokenAttrs },
        inline: { node: "html_inline", getAttrs: htmlTokenAttrs },
      },
      serializer: {
        nodes: {
          html_block(state, node) {
            const source = readHtmlNodeSource(node);
            const kind = readHtmlNodeKind(node);
            if (source === null || kind !== classifyHtmlSource(source, "block")) {
              throw invalidSourceError("block", messages, "serialize");
            }
            state.text(source, false);
            state.closeBlock(node);
          },
          html_inline(state, node) {
            const source = readHtmlNodeSource(node);
            const kind = readHtmlNodeKind(node);
            if (source === null || kind !== classifyHtmlSource(source, "inline")) {
              throw invalidSourceError("inline", messages, "serialize");
            }
            state.text(source, false);
          },
        },
      },
    },
    createRuntime({ codec, getState, lifecycle, ownerDocument, reportError, runCommand, schema }) {
      const types: HtmlNodeTypes = Object.freeze({
        block: schema.nodes.html_block,
        code: schema.marks.code,
        inline: schema.nodes.html_inline,
      });
      const identityKey = new PluginKey<HtmlNodeIdentityIndex>("markora-extension-html-identity");
      const controllers = new Set<HtmlNodeViewController>();
      const manager = createHtmlRenderManager({
        lifecycle,
        ownerDocument,
        renderer,
        onRenderError({ cause, code }) {
          reportError(new MarkdownEditorExtensionError({
            ...renderFailureDetails(code, messages),
            cause,
            extension: "markora-extension-html",
            phase: "node-view",
          }));
        },
        onSourceTooLarge({ maxBytes }) {
          reportError(new MarkdownEditorExtensionError({
            code: "EXTENSION_HTML_SOURCE_TOO_LARGE",
            contribution: "limits",
            extension: "markora-extension-html",
            message: messages.sourceTooLargeDiagnostic(maxBytes),
            phase: "node-view",
          }));
        },
      });
      const identities: IdentityLookup = (state) => {
        const index = identityKey.getState(state);
        if (!index) throw new Error("HTML node identities are unavailable before plugin initialization.");
        return index;
      };
      const baseNodes = () => collectHtmlNodeSnapshots(identities(getState()));
      const findController = (target: HtmlNodeTarget) => {
        const normalized = normalizeHtmlNodeTarget(target);
        for (const controller of controllers) {
          if (
            controller.display === normalized.display
            && controller.kind === normalized.kind
            && controller.source === normalized.source
            && controller.getPosition() === normalized.position
            && controller.isCurrent()
          ) return controller;
        }
        return null;
      };
      const renderSnapshot = (target: HtmlNodeTarget): HtmlRenderSnapshot => {
        const controller = findController(target);
        if (controller) return publicRenderSnapshot(controller.getRenderSnapshot());
        return renderer && target.display === "block" && target.kind === "html-block"
          ? Object.freeze({ ...sourceRenderSnapshot, enabled: true })
          : sourceRenderSnapshot;
      };
      const decorate = (node: HtmlSourceSnapshot): HtmlNodeSnapshot => Object.freeze({
        ...node,
        render: renderSnapshot(node),
      });
      const diagnostics = () => Object.freeze(baseNodes().flatMap((node) => (
        node.display === "block"
        && node.kind === "html-block"
        && htmlSourceUtf8Bytes(node.source) > HTML_MAX_SOURCE_BYTES
          ? [Object.freeze({
              code: "source-too-large" as const,
              display: node.display,
              kind: node.kind,
              message: messages.sourceTooLargeDiagnostic(HTML_MAX_SOURCE_BYTES),
              position: node.position,
            })]
          : []
      )));

      const commands: HtmlCommands = {
        remove(target) {
          return runCommand(createRemoveCommand(normalizeHtmlNodeTarget(target), types, identities));
        },
        retryPreview(target) {
          const normalized = normalizeHtmlNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (
              view?.composing
              || !findHtmlNodeSnapshot(state.doc, types, normalized, identities(state))
            ) return false;
            return findController(normalized)?.retryPreview() ?? false;
          });
        },
        togglePreview(target) {
          const normalized = normalizeHtmlNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (
              view?.composing
              || !findHtmlNodeSnapshot(state.doc, types, normalized, identities(state))
            ) return false;
            return findController(normalized)?.togglePreview() ?? false;
          });
        },
        update(target, source) {
          const normalized = normalizeHtmlNodeTarget(target);
          const nextSource = assertSource(source);
          return runCommand(createUpdateCommand(
            normalized,
            nextSource,
            codec,
            messages,
            reportError,
            types,
            identities,
          ));
        },
      };

      const getDecoratedNode = (target: HtmlNodeTarget) => {
        const normalized = normalizeHtmlNodeTarget(target);
        const editorState = getState();
        const node = findHtmlNodeSnapshot(
          editorState.doc,
          types,
          normalized,
          identities(editorState),
        );
        return node ? decorate(node) : null;
      };
      const state: HtmlState = {
        getDiagnostics: diagnostics,
        getNode(target) {
          return getDecoratedNode(target);
        },
        getNodes(display) {
          const normalizedDisplay = display === undefined ? undefined : assertDisplay(display);
          return Object.freeze(baseNodes()
            .filter((node) => normalizedDisplay === undefined || node.display === normalizedDisplay)
            .map(decorate));
        },
        getRenderState(target) {
          const node = getDecoratedNode(target);
          return node?.render ?? null;
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
        plugins: [{
          id: "identity-invariant",
          create: () => new Plugin<HtmlNodeIdentityIndex>({
            key: identityKey,
            filterTransaction(transaction) {
              if (isHtmlTransactionAllowed(transaction, types)) return true;
              reportError(new MarkdownEditorExtensionError({
                code: "EXTENSION_HTML_DOCUMENT_INVARIANT",
                contribution: "document-invariant",
                extension: "markora-extension-html",
                message: messages.invalidDocumentDiagnostic,
                phase: "plugin",
              }));
              return false;
            },
            state: {
              init: (_config, editorState) => createHtmlNodeIdentityIndex(editorState.doc, types),
              apply: (transaction, previous) => mapHtmlNodeIdentityIndex(transaction, types, previous),
            },
            view() {
              for (const controller of [...controllers]) controller.refresh();
              return {
                update() {
                  for (const controller of [...controllers]) controller.refresh();
                },
                destroy() {},
              };
            },
          }),
        }],
        nodeViews: [
          {
            id: "inline-source",
            node: "html_inline",
            create: () => createHtmlNodeView({
              display: "inline",
              messages,
              nodeType: types.inline,
              onCreate: (controller) => controllers.add(controller),
              onDestroy: (controller) => controllers.delete(controller),
              onEditSource: onEditSource ? (controller) => invokeEdit(controller) : undefined,
              readKind: (node) => readHtmlNodeKind(node) ?? "inline-html",
              readSource: (node) => readHtmlNodeSource(node) ?? "",
              reportError,
            }),
          },
          {
            id: "block-source",
            node: "html_block",
            create: () => createHtmlNodeView({
              display: "block",
              manager,
              messages,
              nodeType: types.block,
              onCreate: (controller) => controllers.add(controller),
              onDestroy: (controller) => controllers.delete(controller),
              onEditSource: onEditSource ? (controller) => invokeEdit(controller) : undefined,
              readKind: (node) => readHtmlNodeKind(node) ?? "html-block",
              readSource: (node) => readHtmlNodeSource(node) ?? "",
              reportError,
            }),
          },
        ],
      } satisfies MarkdownEditorExtensionRuntime<undefined, HtmlCommands, HtmlState>;

      function invokeEdit(controller: HtmlNodeViewController) {
        if (!onEditSource || lifecycle.signal.aborted) return;
        const position = controller.getPosition();
        const source = controller.source;
        const kind = controller.kind;
        if (position === null) return;
        const current = identities(getState()).get(position);
        if (!current || current.source !== source || current.kind !== kind) return;
        const target = normalizeHtmlNodeTarget(current);
        const render = renderSnapshot(target);
        onEditSource(Object.freeze({
          ...target,
          remove: () => commands.remove(target),
          render,
          update: (nextSource: string) => commands.update(target, nextSource),
        }));
      }

      lifecycle.addCleanup(() => controllers.clear());

      return runtime;
    },
  });
}

export type HtmlExtension = ReturnType<typeof createHtmlExtension>;
