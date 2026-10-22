import {
  MarkdownEditorExtensionError,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  closeHistory,
  moveToElementBoundary,
  type ElementNavigationSpec,
  defineMarkdownEditorExtension,
  type Command,
  type DOMOutputSpec,
  type EditorState,
  type EditorView,
  type Fragment,
  type MarkdownEditorExtensionRuntime,
  type Node as ProseMirrorNode,
  type NodeType,
  type Transaction,
} from "markora/extension-api";
import {
  defaultDiagramMessages,
  normalizeDiagramMessages,
  type DiagramMessageOverrides,
  type DiagramMessages,
} from "./messages";
import { createDiagramNodeView, type DiagramNodeViewController } from "./nodeViews";
import {
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DIAGRAM_VIEWPORT_MARGIN,
  createDiagramRenderManager,
  type DiagramRenderErrorCode,
  type DiagramRenderer,
  type DiagramRenderRequest,
  type DiagramRenderSnapshot,
  type DiagramRenderStatus,
  type InternalDiagramRenderSnapshot,
} from "./renderer";
import {
  DIAGRAM_MAX_SOURCE_BYTES,
  assertDiagramKind,
  classifyDiagramInfo,
  collectDiagramNodeSnapshots,
  createDiagramNodeIdentityIndex,
  diagramKinds,
  diagramSourceUtf8Bytes,
  findDiagramNodeSnapshot,
  isDiagramTransactionAllowed,
  mapDiagramNodeIdentityIndex,
  normalizeDiagramInfo,
  normalizeDiagramNodeTarget,
  normalizeDiagramSource,
  readDiagramNodeInfo,
  readDiagramNodeKind,
  replaceDiagramInfoKind,
  serializeDiagramFence,
  type DiagramKind,
  type DiagramNodeIdentityIndex,
  type DiagramNodeTarget,
  type DiagramNodeTypes,
  type DiagramSourceSnapshot,
} from "./source";
import { createDiagramFenceTransformRule, diagramTokenAttrs } from "./tokenizer";

export {
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DIAGRAM_MAX_SOURCE_BYTES,
  DIAGRAM_VIEWPORT_MARGIN,
  defaultDiagramMessages,
  diagramKinds,
};

export const diagramDiagnosticCodes = Object.freeze(["source-too-large"] as const);
export const diagramRenderErrorCodes = Object.freeze([
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
  DiagramKind,
  DiagramMessageOverrides,
  DiagramMessages,
  DiagramNodeTarget,
  DiagramRenderer,
  DiagramRenderErrorCode,
  DiagramRenderRequest,
  DiagramRenderSnapshot,
  DiagramRenderStatus,
};

export type DiagramDiagnosticCode = (typeof diagramDiagnosticCodes)[number];

export type DiagramNodeSnapshot = DiagramSourceSnapshot & Readonly<{
  render: DiagramRenderSnapshot;
}>;

export type DiagramDiagnostic = Readonly<{
  code: DiagramDiagnosticCode;
  info: string;
  kind: DiagramKind;
  message: string;
  position: number;
}>;

export type DiagramsSnapshot = Readonly<{
  diagnostics: readonly DiagramDiagnostic[];
  nodes: readonly DiagramNodeSnapshot[];
}>;

export type DiagramInsert = Readonly<{
  info: string;
  source: string;
}>;

export type DiagramUpdate = Readonly<{
  info?: string;
  source?: string;
}>;

export type DiagramEditRequest = Readonly<{
  convert(kind: DiagramKind): boolean;
  identity: number;
  info: string;
  kind: DiagramKind;
  position: number;
  remove(): boolean;
  render: DiagramRenderSnapshot;
  restoreCodeBlock(): boolean;
  source: string;
  update(patch: DiagramUpdate): boolean;
}>;

export type DiagramExtensionOptions = Readonly<{
  messages?: DiagramMessageOverrides;
  onEditSource?: (request: DiagramEditRequest) => void;
  renderers?: Readonly<Partial<Record<DiagramKind, DiagramRenderer>>>;
}>;

export type DiagramCommands = Readonly<{
  convert(target: DiagramNodeTarget, kind: DiagramKind): boolean;
  convertCodeBlock(kind: DiagramKind): boolean;
  insert(value: DiagramInsert): boolean;
  remove(target: DiagramNodeTarget): boolean;
  restoreCodeBlock(target: DiagramNodeTarget): boolean;
  retryPreview(target: DiagramNodeTarget): boolean;
  togglePreview(target: DiagramNodeTarget): boolean;
  update(target: DiagramNodeTarget, patch: DiagramUpdate): boolean;
}>;

export type DiagramState = Readonly<{
  getDiagnostics(): readonly DiagramDiagnostic[];
  getKind(target: DiagramNodeTarget): DiagramKind | null;
  getNode(target: DiagramNodeTarget): DiagramNodeSnapshot | null;
  getNodes(kind?: DiagramKind): readonly DiagramNodeSnapshot[];
  getRenderState(target: DiagramNodeTarget): DiagramRenderSnapshot | null;
  getSnapshot(): DiagramsSnapshot;
}>;

const sourceRenderSnapshot: DiagramRenderSnapshot = Object.freeze({
  enabled: false,
  errorCode: null,
  status: "source",
});

function publicRenderSnapshot(snapshot: InternalDiagramRenderSnapshot): DiagramRenderSnapshot {
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

function normalizeRenderers(value: DiagramExtensionOptions["renderers"]) {
  if (value === undefined) {
    return Object.freeze({}) as Readonly<Partial<Record<DiagramKind, DiagramRenderer>>>;
  }
  if (!isPlainObject(value)) {
    throw new TypeError("Diagram renderers must be a plain partial kind map.");
  }
  const result: Partial<Record<DiagramKind, DiagramRenderer>> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !diagramKinds.includes(key as DiagramKind)) {
      throw new TypeError(`Unknown diagram renderer kind "${String(key)}".`);
    }
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Diagram renderer "${key}" must be a function data property.`);
    }
    result[key as DiagramKind] = descriptor.value as DiagramRenderer;
  }
  return Object.freeze(result);
}

function normalizeOptions(options: DiagramExtensionOptions | undefined) {
  if (options === undefined) {
    return Object.freeze({
      messages: defaultDiagramMessages,
      onEditSource: undefined,
      renderers: normalizeRenderers(undefined),
    });
  }
  if (!isPlainObject(options)) {
    throw new TypeError("Diagram extension options must be a plain object.");
  }
  for (const key of Object.keys(options)) {
    if (key !== "messages" && key !== "onEditSource" && key !== "renderers") {
      throw new TypeError(`Unknown diagram extension option "${key}".`);
    }
  }
  if (options.onEditSource !== undefined && typeof options.onEditSource !== "function") {
    throw new TypeError("Diagram onEditSource must be a function.");
  }
  return Object.freeze({
    messages: normalizeDiagramMessages(options.messages),
    onEditSource: options.onEditSource,
    renderers: normalizeRenderers(options.renderers),
  });
}

function normalizeInsert(value: unknown): Readonly<{ info: string; kind: DiagramKind; source: string }> {
  if (!isPlainObject(value)) throw new TypeError("A diagram insertion must be a plain object.");
  for (const key of Object.keys(value)) {
    if (key !== "info" && key !== "source") throw new TypeError(`Unknown diagram insertion key "${key}".`);
  }
  if (typeof value.info !== "string") throw new TypeError("Diagram info must be a one-line string.");
  if (typeof value.source !== "string") throw new TypeError("Diagram source must be a string.");
  const info = normalizeDiagramInfo(value.info);
  return Object.freeze({
    info,
    kind: classifyDiagramInfo(info)!,
    source: normalizeDiagramSource(value.source),
  });
}

function normalizeUpdate(value: unknown) {
  if (!isPlainObject(value)) throw new TypeError("A diagram update must be a plain object.");
  for (const key of Object.keys(value)) {
    if (key !== "info" && key !== "source") throw new TypeError(`Unknown diagram update key "${key}".`);
  }
  if (!("info" in value) && !("source" in value)) {
    throw new TypeError("A diagram update must provide info or source.");
  }
  if (value.info !== undefined && typeof value.info !== "string") {
    throw new TypeError("Diagram info must be a one-line string.");
  }
  if (value.source !== undefined && typeof value.source !== "string") {
    throw new TypeError("Diagram source must be a string.");
  }
  return Object.freeze({
    ...(value.info !== undefined ? { info: normalizeDiagramInfo(value.info) } : {}),
    ...(value.source !== undefined ? { source: normalizeDiagramSource(value.source) } : {}),
  });
}

function invalidDocumentError(messages: DiagramMessages, phase: "command" | "plugin" | "serialize") {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_DIAGRAM_INVALID_DOCUMENT",
    contribution: "document-invariant",
    extension: "markora-extension-diagrams",
    message: messages.invalidDocumentDiagnostic,
    phase,
  });
}

function invalidInfoError(messages: DiagramMessages, phase: "command" | "node-view") {
  return new MarkdownEditorExtensionError({
    code: "EXTENSION_DIAGRAM_INVALID_INFO",
    contribution: "info",
    extension: "markora-extension-diagrams",
    message: messages.invalidInfoDiagnostic,
    phase,
  });
}

function rendererFailureDetails(code: DiagramRenderErrorCode, kind: DiagramKind, messages: DiagramMessages) {
  if (code === "renderer-missing") return {
    code: "EXTENSION_DIAGRAM_RENDERER_MISSING",
    contribution: "renderer",
    message: messages.rendererUnavailable(kind),
  } as const;
  if (code === "renderer-failed") return {
    code: "EXTENSION_DIAGRAM_RENDERER_FAILED",
    contribution: "renderer",
    message: messages.rendererFailedDiagnostic(kind),
  } as const;
  if (code === "unsafe-output") return {
    code: "EXTENSION_DIAGRAM_UNSAFE_RENDERER_OUTPUT",
    contribution: "dom-clamp",
    message: messages.unsafeRendererOutputDiagnostic(kind),
  } as const;
  if (code === "node-limit" || code === "output-byte-limit") return {
    code: "EXTENSION_DIAGRAM_RENDER_OUTPUT_LIMIT",
    contribution: "limits",
    message: messages.renderOutputLimitDiagnostic(kind),
  } as const;
  return {
    code: "EXTENSION_DIAGRAM_INVALID_RENDERER_OUTPUT",
    contribution: "dom-clamp",
    message: messages.invalidRendererOutputDiagnostic(kind),
  } as const;
}

function staticDiagramDom(node: ProseMirrorNode, messages: DiagramMessages): DOMOutputSpec {
  const kind = readDiagramNodeKind(node) ?? "mermaid";
  const info = readDiagramNodeInfo(node) ?? kind;
  return [
    "div",
    {
      "aria-label": messages.sourceLabel(kind, info),
      class: "mdw-diagram",
      "data-mdw-diagram": "",
      "data-mdw-diagram-kind": kind,
      role: "group",
    },
    ["div", { class: "mdw-diagram__header", contenteditable: "false" },
      ["span", { class: "mdw-diagram__kind" }, messages.kindLabel(kind)],
      ["code", { class: "mdw-diagram__info" }, info]],
    ["pre", { class: "mdw-diagram__source-shell" },
      ["code", {
        class: "mdw-diagram__source",
        "data-mdw-diagram-source": "",
        dir: "auto",
      }, 0]],
  ];
}

function sliceContainsDiagram(content: Fragment, type: NodeType) {
  let found = false;
  content.descendants((node) => {
    found ||= node.type === type;
    return !found;
  });
  return found;
}

function readDiagramDomAttrs(dom: HTMLElement | string) {
  if (typeof dom === "string") return false;
  const info = dom.getAttribute("data-mdw-diagram-info")
    ?? dom.querySelector(".mdw-diagram__info")?.textContent
    ?? "";
  const kind = dom.getAttribute("data-mdw-diagram-kind");
  const classified = classifyDiagramInfo(info);
  return classified && classified === kind ? { info, kind: classified } : false;
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

function selectedDiagramPositions(state: EditorState, type: NodeType) {
  const positions = new Set<number>();
  if (!(state.selection instanceof TextSelection)) return positions;
  for (const resolved of [state.selection.$from, state.selection.$to]) {
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type === type) {
        positions.add(resolved.before(depth));
        break;
      }
    }
  }
  if (!state.selection.empty) {
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
      if (node.type !== type) return true;
      if (
        state.selection.from <= position + node.nodeSize - 1
        && state.selection.to >= position + 1
      ) positions.add(position);
      return false;
    });
  }
  return positions;
}

function adjacentDiagram(
  state: EditorState,
  type: NodeType,
  direction: -1 | 1,
) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const resolved = selection.$head;
  if (
    direction === 1
      ? resolved.parentOffset !== resolved.parent.content.size
      : resolved.parentOffset !== 0
  ) return null;

  for (let depth = resolved.depth - 1; depth >= 0; depth -= 1) {
    const parent = resolved.node(depth);
    if (direction === 1) {
      const index = resolved.indexAfter(depth);
      if (index < parent.childCount) {
        const node = parent.child(index);
        return node.type === type
          ? { node, position: resolved.after(depth + 1) }
          : null;
      }
    } else {
      const index = resolved.index(depth);
      if (index > 0) {
        const node = parent.child(index - 1);
        return node.type === type
          ? { node, position: resolved.before(depth + 1) - node.nodeSize }
          : null;
      }
    }
  }
  return null;
}

function diagramBoundaryExit(
  state: EditorState,
  type: NodeType,
  direction: -1 | 1,
) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  for (let depth = selection.$head.depth; depth > 0; depth -= 1) {
    const node = selection.$head.node(depth);
    if (node.type !== type) continue;
    const position = selection.$head.before(depth);
    const contentBoundary = direction === 1
      ? position + node.nodeSize - 1
      : position + 1;
    if (selection.head !== contentBoundary) return null;
    return TextSelection.near(
      state.doc.resolve(direction === 1 ? position + node.nodeSize : position),
      direction,
    );
  }
  return null;
}

function selectedDiagramSelection(state: EditorState, type: NodeType) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  for (let depth = selection.$head.depth; depth > 0; depth -= 1) {
    const node = selection.$head.node(depth);
    if (node.type !== type) continue;
    const position = selection.$head.before(depth);
    const contentStart = position + 1;
    const contentEnd = position + node.nodeSize - 1;
    const atStart = selection.head === contentStart;
    const atEnd = selection.head === contentEnd;
    return { atEnd, atStart, contentEnd, contentStart, node, position };
  }
  return null;
}

function boundaryPlaintextLine(source: string, atStart: boolean) {
  if (atStart) {
    const match = /[\n\r\u001C-\u001E\u0085\u2029]/u.exec(source);
    return match ? source.slice(0, match.index) : source;
  }
  const boundary = Math.max(
    source.lastIndexOf("\n"),
    source.lastIndexOf("\r"),
    source.lastIndexOf("\u001C"),
    source.lastIndexOf("\u001D"),
    source.lastIndexOf("\u001E"),
    source.lastIndexOf("\u0085"),
    source.lastIndexOf("\u2029"),
  );
  return source.slice(boundary + 1);
}

type GraphemeSegment = Readonly<{ index: number; segment: string }>;
type GraphemeSegments = Readonly<{
  containing?: (index: number) => GraphemeSegment | undefined;
}>;
type GraphemeSegmenter = Readonly<{
  segment: (source: string) => GraphemeSegments;
}>;
type GraphemeSegmenterConstructor = new (
  locale?: string,
  options?: Readonly<{ granularity: "grapheme" }>,
) => GraphemeSegmenter;

let cachedGraphemeSegmenter: GraphemeSegmenter | null | undefined;

function graphemeSegmenter() {
  if (cachedGraphemeSegmenter !== undefined) return cachedGraphemeSegmenter;
  const Constructor = (Intl as unknown as Readonly<{
    Segmenter?: GraphemeSegmenterConstructor;
  }>).Segmenter;
  cachedGraphemeSegmenter = Constructor
    ? new Constructor(undefined, { granularity: "grapheme" })
    : null;
  return cachedGraphemeSegmenter;
}

function diagramSourceGraphemeEdges(source: string) {
  if (!source) return { firstEnd: 0, lastStart: 0 };
  const segments = graphemeSegmenter()?.segment(source);
  const first = segments?.containing?.(0);
  const last = segments?.containing?.(source.length - 1);
  if (first && last) {
    return {
      firstEnd: first.index + first.segment.length,
      lastStart: last.index,
    };
  }
  const firstEnd = (source.codePointAt(0) ?? 0) > 0xFFFF ? 2 : 1;
  const finalUnit = source.charCodeAt(source.length - 1);
  const previousUnit = source.length > 1 ? source.charCodeAt(source.length - 2) : 0;
  const lastLength = finalUnit >= 0xDC00 && finalUnit <= 0xDFFF
    && previousUnit >= 0xD800 && previousUnit <= 0xDBFF
    ? 2
    : 1;
  return { firstEnd, lastStart: source.length - lastLength };
}

function resolvePlaintextLineRtl(
  ownerDocument: Document,
  line: string,
) {
  const parent = ownerDocument.body ?? ownerDocument.documentElement;
  const ownerWindow = ownerDocument.defaultView;
  if (!parent || !ownerWindow) return false;

  const host = ownerDocument.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  host.style.setProperty("block-size", "0", "important");
  host.style.setProperty("contain", "strict", "important");
  host.style.setProperty("inline-size", "0", "important");
  host.style.setProperty("inset", "0 auto auto -100000px", "important");
  host.style.setProperty("overflow", "hidden", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("visibility", "hidden", "important");
  const root = host.attachShadow({ mode: "closed" });
  const probe = ownerDocument.createElement("bdi");
  probe.dir = "auto";
  // UAX #9 P3 assigns level zero to a paragraph without a strong character.
  // Appending an LTR sentinel reproduces that default without overriding a
  // strong character authored earlier in this plaintext line.
  probe.textContent = `${line}A`;
  root.append(probe);
  parent.append(host);
  try {
    return ownerWindow.getComputedStyle(probe).direction === "rtl";
  } finally {
    host.remove();
  }
}

function moveSelectionAtHorizontalDiagramBoundary(
  view: EditorView,
  event: KeyboardEvent,
  type: NodeType,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  const diagram = selectedDiagramSelection(view.state, type);
  if (!diagram) return false;

  const directionForLine = (atStart: boolean): -1 | 1 => {
    const line = boundaryPlaintextLine(diagram.node.textContent, atStart);
    const rtl = resolvePlaintextLineRtl(view.dom.ownerDocument, line);
    return event.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1 : -1;
  };
  const dispatch = (target: number) => {
    const selection = event.shiftKey
      ? TextSelection.create(view.state.doc, view.state.selection.anchor, target)
      : TextSelection.create(view.state.doc, target);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  };
  const { firstEnd, lastStart } = diagramSourceGraphemeEdges(diagram.node.textContent);

  if (diagram.atStart || diagram.atEnd) {
    const direction = directionForLine(diagram.atStart);
    if ((direction === -1 && diagram.atStart) || (direction === 1 && diagram.atEnd)) {
      if (!event.shiftKey) return moveToElementBoundary(view, diagram.position, direction < 0 ? "before" : "after");
      const outside = TextSelection.near(view.state.doc.resolve(
        direction === -1
          ? diagram.position
          : diagram.position + diagram.node.nodeSize,
      ), direction);
      return dispatch(outside.head);
    }
    return dispatch(direction === 1
      ? diagram.contentStart + firstEnd
      : diagram.contentStart + lastStart);
  }

  if (
    firstEnd > 0
    && view.state.selection.head === diagram.contentStart + firstEnd
    && directionForLine(true) === -1
  ) return dispatch(diagram.contentStart);
  if (
    lastStart < diagram.node.textContent.length
    && view.state.selection.head === diagram.contentStart + lastStart
    && directionForLine(false) === 1
  ) return dispatch(diagram.contentEnd);
  return false;
}

function moveSelectionIntoAdjacentDiagram(
  view: EditorView,
  event: KeyboardEvent,
  type: NodeType,
) {
  if (event.altKey || event.ctrlKey || event.metaKey || view.composing || event.isComposing || event.keyCode === 229) return false;
  // Plain horizontal traversal belongs to the shared element state machine.
  if (!event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    return moveSelectionAtHorizontalDiagramBoundary(view, event, type);
  }
  if (moveSelectionAtHorizontalDiagramBoundary(view, event, type)) return true;
  let directionElement: Element = view.dom;
  try {
    const atSelection = view.domAtPos(view.state.selection.head, 0).node;
    const candidate = atSelection.nodeType === 1
      ? atSelection as Element
      : atSelection.parentElement;
    if (candidate && view.dom.contains(candidate)) directionElement = candidate;
  } catch {
    // The editor root remains a safe direction fallback during DOM reconciliation.
  }
  const directionStyle = view.dom.ownerDocument.defaultView
    ?.getComputedStyle(directionElement).direction;
  const rtl = directionStyle === "rtl";
  const direction = event.key === "ArrowDown"
    || event.key === (rtl ? "ArrowLeft" : "ArrowRight")
    ? 1
    : event.key === "ArrowUp"
      || event.key === (rtl ? "ArrowRight" : "ArrowLeft")
      ? -1
      : 0;
  if (direction === 0) return false;
  const exit = diagramBoundaryExit(view.state, type, direction);
  if (exit) {
    const selection = event.shiftKey
      ? TextSelection.create(view.state.doc, view.state.selection.anchor, exit.head)
      : exit;
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  }
  const adjacent = adjacentDiagram(view.state, type, direction);
  if (!adjacent) return false;

  const contentStart = adjacent.position + 1;
  const contentEnd = adjacent.position + adjacent.node.nodeSize - 1;
  const { firstEnd, lastStart } = diagramSourceGraphemeEdges(adjacent.node.textContent);
  const target = event.shiftKey && adjacent.node.content.size > 0
    ? direction === 1 ? contentStart + firstEnd : contentStart + lastStart
    : direction === 1 ? contentStart : contentEnd;
  const selection = event.shiftKey
    ? TextSelection.create(view.state.doc, view.state.selection.anchor, target)
    : TextSelection.create(view.state.doc, target);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

function createInsertCommand(value: Readonly<{ info: string; kind: DiagramKind; source: string }>, type: NodeType): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const content = value.source ? state.schema.text(value.source) : undefined;
    const node = type.create({ info: value.info, kind: value.kind }, content);
    let transaction = state.tr.replaceSelectionWith(node, false);
    const position = findInsertedNode(transaction, node);
    if (position !== null) {
      transaction = transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
    }
    if (dispatch) dispatch(closeHistory(transaction.scrollIntoView()));
    return true;
  };
}

type IdentityLookup = (state: EditorState) => DiagramNodeIdentityIndex;

function targetNode(
  doc: ProseMirrorNode,
  type: NodeType,
  target: DiagramNodeTarget,
  identities: DiagramNodeIdentityIndex,
) {
  const normalized = normalizeDiagramNodeTarget(target);
  const snapshot = findDiagramNodeSnapshot(doc, type, normalized, identities);
  const node = snapshot ? doc.nodeAt(snapshot.position) : null;
  return node && snapshot ? { node, snapshot } : null;
}

function createConvertCommand(
  target: DiagramNodeTarget,
  kind: DiagramKind,
  type: NodeType,
  identities: IdentityLookup,
): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selected = targetNode(state.doc, type, target, identities(state));
    if (!selected || selected.snapshot.kind === kind) return false;
    const info = replaceDiagramInfoKind(selected.snapshot.info, kind);
    if (dispatch) {
      dispatch(closeHistory(state.tr.setNodeMarkup(
        selected.snapshot.position,
        type,
        { info, kind },
      ).scrollIntoView()));
    }
    return true;
  };
}

function selectedCodeBlock(state: EditorState, type: NodeType) {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type !== type) continue;
    const position = $from.before(depth);
    const end = position + $from.node(depth).nodeSize;
    return $to.pos <= end ? { node: $from.node(depth), position } : null;
  }
  if (!(state.selection instanceof NodeSelection)) return null;
  const node = state.selection.node;
  return node.type === type ? { node, position: state.selection.from } : null;
}

function createConvertCodeBlockCommand(kind: DiagramKind, types: DiagramNodeTypes): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selected = selectedCodeBlock(state, types.codeBlock);
    if (!selected || /[\u0000\r]/u.test(selected.node.textContent)) return false;
    const raw = typeof selected.node.attrs.params === "string" ? selected.node.attrs.params : "";
    if (/[\u0000\r\n]/u.test(raw)) return false;
    const info = replaceDiagramInfoKind(raw, kind);
    if (classifyDiagramInfo(info) !== kind) return false;
    if (dispatch) {
      dispatch(closeHistory(state.tr.setNodeMarkup(
        selected.position,
        types.diagram,
        { info, kind },
      ).scrollIntoView()));
    }
    return true;
  };
}

function createRestoreCodeBlockCommand(
  target: DiagramNodeTarget,
  types: DiagramNodeTypes,
  identities: IdentityLookup,
): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selected = targetNode(state.doc, types.diagram, target, identities(state));
    if (!selected) return false;
    if (dispatch) {
      dispatch(closeHistory(state.tr.setNodeMarkup(
        selected.snapshot.position,
        types.codeBlock,
        { params: selected.snapshot.info },
      ).scrollIntoView()));
    }
    return true;
  };
}

function createUpdateCommand(
  target: DiagramNodeTarget,
  patch: Readonly<{ info?: string; source?: string }>,
  type: NodeType,
  identities: IdentityLookup,
): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selected = targetNode(state.doc, type, target, identities(state));
    if (!selected) return false;
    const info = patch.info ?? selected.snapshot.info;
    const source = patch.source ?? selected.snapshot.source;
    const kind = classifyDiagramInfo(info);
    if (!kind || (info === selected.snapshot.info && source === selected.snapshot.source)) return false;
    let transaction = state.tr;
    if (info !== selected.snapshot.info) {
      transaction = transaction.setNodeMarkup(selected.snapshot.position, type, { info, kind });
    }
    if (source !== selected.snapshot.source) {
      const from = selected.snapshot.position + 1;
      const to = from + selected.node.content.size;
      transaction = source
        ? transaction.replaceWith(from, to, state.schema.text(source))
        : transaction.delete(from, to);
    }
    if (dispatch) dispatch(closeHistory(transaction.scrollIntoView()));
    return true;
  };
}

function createRemoveCommand(target: DiagramNodeTarget, type: NodeType, identities: IdentityLookup): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selected = targetNode(state.doc, type, target, identities(state));
    if (!selected) return false;
    if (dispatch) {
      dispatch(closeHistory(state.tr.delete(
        selected.snapshot.position,
        selected.snapshot.position + selected.node.nodeSize,
      ).scrollIntoView()));
    }
    return true;
  };
}

export function createDiagramsExtension(options?: DiagramExtensionOptions) {
  const { messages, onEditSource, renderers } = normalizeOptions(options);

  return defineMarkdownEditorExtension({
    name: "markora-extension-diagrams",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.4.0", markora: "^0.1.0" },
    schema: {
      nodes: [{
        name: "diagram",
        before: "blockquote",
        spec: {
          attrs: {
            info: { validate: "string" },
            kind: { validate: "string" },
          },
          code: true,
          content: "text*",
          createGapCursor: true,
          defining: true,
          group: "block",
          marks: "",
          parseDOM: [{
            contentElement: "[data-mdw-diagram-source]",
            getAttrs: readDiagramDomAttrs,
            preserveWhitespace: "full",
            tag: "[data-mdw-diagram]",
          }],
          selectable: true,
          elementNavigation: { textArrows: "custom" } satisfies ElementNavigationSpec,
          toDOM: (node) => staticDiagramDom(node, messages),
          whitespace: "pre",
        },
      }],
      managedBlocks: ["diagram"],
    },
    markdown: {
      tokenizerRules: [{
        id: "fence",
        phase: "core",
        after: ["@markora/foundation/core/block"],
        before: ["@markora/foundation/core/inline"],
        createRule: ({ token }) => createDiagramFenceTransformRule(token("diagram")),
      }],
      parserTokens: {
        diagram: { block: "diagram", getAttrs: diagramTokenAttrs, noCloseToken: true },
      },
      serializer: {
        nodes: {
          diagram(state, node) {
            try { serializeDiagramFence(state, node); }
            catch (cause) {
              throw new MarkdownEditorExtensionError({
                cause,
                code: "EXTENSION_DIAGRAM_INVALID_DOCUMENT",
                contribution: "serializer",
                extension: "markora-extension-diagrams",
                message: messages.invalidDocumentDiagnostic,
                phase: "serialize",
              });
            }
          },
        },
      },
    },
    createRuntime({ codec, getState, lifecycle, ownerDocument, reportError, runCommand, schema }) {
      const types: DiagramNodeTypes = Object.freeze({
        codeBlock: schema.nodes.code_block,
        diagram: schema.nodes.diagram,
      });
      const identityKey = new PluginKey<DiagramNodeIdentityIndex>("markora-extension-diagrams-identity");
      const controllers = new Set<DiagramNodeViewController>();
      const controllersByMarker = new Map<object, DiagramNodeViewController>();
      let editVersion = 0;
      const manager = createDiagramRenderManager({
        lifecycle,
        ownerDocument,
        renderers,
        onRenderError({ cause, code, kind }) {
          reportError(new MarkdownEditorExtensionError({
            ...rendererFailureDetails(code, kind, messages),
            cause,
            extension: "markora-extension-diagrams",
            phase: "node-view",
          }));
        },
        onSourceTooLarge({ kind, maxBytes }) {
          reportError(new MarkdownEditorExtensionError({
            code: "EXTENSION_DIAGRAM_SOURCE_TOO_LARGE",
            contribution: "limits",
            extension: "markora-extension-diagrams",
            message: messages.sourceTooLargeDiagnostic(maxBytes),
            phase: "node-view",
            cause: Object.freeze({ kind }),
          }));
        },
      });
      const identities: IdentityLookup = (editorState) => {
        const index = identityKey.getState(editorState);
        if (!index) throw new Error("Diagram node identities are unavailable before plugin initialization.");
        return index;
      };
      const selectedControllers = (editorView: EditorView) => {
        const selected = new Set<DiagramNodeViewController>();
        for (const position of selectedDiagramPositions(editorView.state, types.diagram)) {
          const marker = editorView.nodeDOM(position);
          const controller = marker ? controllersByMarker.get(marker) : undefined;
          if (controller) selected.add(controller);
        }
        return selected;
      };
      const baseNodes = () => collectDiagramNodeSnapshots(identities(getState()));
      const findController = (target: DiagramNodeTarget) => {
        const normalized = normalizeDiagramNodeTarget(target);
        for (const controller of controllers) {
          if (
            controller.kind === normalized.kind
            && controller.info === normalized.info
            && controller.source === normalized.source
            && controller.getPosition() === normalized.position
            && controller.isCurrent()
          ) return controller;
        }
        return null;
      };
      const renderSnapshot = (target: DiagramNodeTarget): DiagramRenderSnapshot => {
        const controller = findController(target);
        if (controller) return publicRenderSnapshot(controller.getRenderSnapshot());
        return renderers[target.kind]
          ? Object.freeze({ ...sourceRenderSnapshot, enabled: true })
          : sourceRenderSnapshot;
      };
      const decorate = (node: DiagramSourceSnapshot): DiagramNodeSnapshot => Object.freeze({
        ...node,
        render: renderSnapshot(node),
      });
      const diagnostics = () => Object.freeze(baseNodes().flatMap((node) => (
        diagramSourceUtf8Bytes(node.info, node.source) > DIAGRAM_MAX_SOURCE_BYTES
          ? [Object.freeze({
              code: "source-too-large" as const,
              info: node.info,
              kind: node.kind,
              message: messages.sourceTooLargeDiagnostic(DIAGRAM_MAX_SOURCE_BYTES),
              position: node.position,
            })]
          : []
      )));

      const commands: DiagramCommands = {
        convert(target, kind) {
          return runCommand(createConvertCommand(
            normalizeDiagramNodeTarget(target),
            assertDiagramKind(kind),
            types.diagram,
            identities,
          ));
        },
        convertCodeBlock(kind) {
          return runCommand(createConvertCodeBlockCommand(assertDiagramKind(kind), types));
        },
        insert(value) {
          let normalized: ReturnType<typeof normalizeInsert>;
          try { normalized = normalizeInsert(value); }
          catch (cause) {
            if (!(cause instanceof RangeError)) throw cause;
            reportError(invalidInfoError(messages, "command"));
            return false;
          }
          return runCommand(createInsertCommand(normalized, types.diagram));
        },
        remove(target) {
          return runCommand(createRemoveCommand(normalizeDiagramNodeTarget(target), types.diagram, identities));
        },
        restoreCodeBlock(target) {
          return runCommand(createRestoreCodeBlockCommand(normalizeDiagramNodeTarget(target), types, identities));
        },
        retryPreview(target) {
          const normalized = normalizeDiagramNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (view?.composing || !findDiagramNodeSnapshot(state.doc, types.diagram, normalized, identities(state))) return false;
            return findController(normalized)?.retryPreview() ?? false;
          });
        },
        togglePreview(target) {
          const normalized = normalizeDiagramNodeTarget(target);
          return runCommand((state, _dispatch, view) => {
            if (view?.composing || !findDiagramNodeSnapshot(state.doc, types.diagram, normalized, identities(state))) return false;
            return findController(normalized)?.togglePreview() ?? false;
          });
        },
        update(target, patch) {
          const normalizedTarget = normalizeDiagramNodeTarget(target);
          let normalizedPatch: ReturnType<typeof normalizeUpdate>;
          try { normalizedPatch = normalizeUpdate(patch); }
          catch (cause) {
            if (!(cause instanceof RangeError)) throw cause;
            reportError(invalidInfoError(messages, "command"));
            return false;
          }
          return runCommand(createUpdateCommand(normalizedTarget, normalizedPatch, types.diagram, identities));
        },
      };

      const handOffSourceEdit = (controller: DiagramNodeViewController) => {
        if (!onEditSource) return;
        const position = controller.getPosition();
        if (position === null || !controller.isCurrent()) return;
        const target = baseNodes().find((node) => (
          node.position === position
          && node.kind === controller.kind
          && node.info === controller.info
          && node.source === controller.source
        ));
        if (!target) return;
        const requestedNode = controller.node;
        const requestVersion = ++editVersion;
        const requestIsCurrent = () => (
          requestVersion === editVersion
          && controller.node === requestedNode
          && controller.isCurrent()
          && findDiagramNodeSnapshot(getState().doc, types.diagram, target, identities(getState())) !== null
        );
        const request: DiagramEditRequest = Object.freeze({
          convert: (kind) => requestIsCurrent() ? commands.convert(target, assertDiagramKind(kind)) : false,
          identity: target.identity,
          info: target.info,
          kind: target.kind,
          position: target.position,
          remove: () => requestIsCurrent() ? commands.remove(target) : false,
          render: publicRenderSnapshot(controller.getRenderSnapshot()),
          restoreCodeBlock: () => requestIsCurrent() ? commands.restoreCodeBlock(target) : false,
          source: target.source,
          update(patch) {
            if (!requestIsCurrent()) return false;
            const normalized = normalizeUpdate(patch);
            if ((normalized.info ?? target.info) === target.info && (normalized.source ?? target.source) === target.source) return true;
            return commands.update(target, normalized);
          },
        });
        onEditSource(request);
      };

      const state: DiagramState = {
        getDiagnostics: diagnostics,
        getKind(target) {
          const normalized = normalizeDiagramNodeTarget(target);
          return findDiagramNodeSnapshot(getState().doc, types.diagram, normalized, identities(getState()))?.kind ?? null;
        },
        getNode(target) {
          const normalized = normalizeDiagramNodeTarget(target);
          const found = findDiagramNodeSnapshot(getState().doc, types.diagram, normalized, identities(getState()));
          return found ? decorate(found) : null;
        },
        getNodes(kind) {
          const normalizedKind = kind === undefined ? undefined : assertDiagramKind(kind);
          return Object.freeze(baseNodes()
            .filter((node) => normalizedKind === undefined || node.kind === normalizedKind)
            .map(decorate));
        },
        getRenderState(target) {
          const normalized = normalizeDiagramNodeTarget(target);
          return findDiagramNodeSnapshot(getState().doc, types.diagram, normalized, identities(getState()))
            ? renderSnapshot(normalized)
            : null;
        },
        getSnapshot() {
          return Object.freeze({ diagnostics: diagnostics(), nodes: Object.freeze(baseNodes().map(decorate)) });
        },
      };

      return {
        commands,
        state,
        plugins: [{
          id: "identity",
          create: () => new Plugin<DiagramNodeIdentityIndex>({
            key: identityKey,
            state: {
              init: (_configuration, editorState) => createDiagramNodeIdentityIndex(editorState.doc, types.diagram),
              apply: (transaction, previous) => mapDiagramNodeIdentityIndex(transaction, types.diagram, previous),
            },
          }),
        }, {
          id: "clipboard",
          create: () => new Plugin({
            props: {
              clipboardTextSerializer(slice) {
                if (
                  slice.openStart !== 0
                  || slice.openEnd !== 0
                  || !sliceContainsDiagram(slice.content, types.diagram)
                ) {
                  return undefined as never;
                }
                return codec.serialize(schema.topNodeType.create(null, slice.content));
              },
            },
          }),
        }, {
          id: "invariant",
          create: () => new Plugin({
            filterTransaction(transaction) {
              if (isDiagramTransactionAllowed(transaction, types.diagram)) return true;
              reportError(invalidDocumentError(messages, "plugin"));
              return false;
            },
            props: {
              handleKeyDown(editorView, event) {
                return moveSelectionIntoAdjacentDiagram(editorView, event, types.diagram);
              },
            },
            view(editorView) {
              for (const controller of [...controllers]) controller.refresh();
              let editable = editorView.editable;
              let composing = editorView.composing;
              let sourceSelections = selectedControllers(editorView);
              for (const controller of sourceSelections) controller.refresh();
              return {
                update(nextView, previousState) {
                  const nextSourceSelections = selectedControllers(nextView);
                  const environmentChanged = nextView.editable !== editable
                    || nextView.composing !== composing;
                  const selectionChanged = !nextView.state.selection.eq(
                    previousState.selection,
                  );
                  editable = nextView.editable;
                  composing = nextView.composing;
                  if (environmentChanged) {
                    for (const controller of [...controllers]) controller.refresh();
                  } else if (selectionChanged) {
                    for (const controller of new Set([
                      ...sourceSelections,
                      ...nextSourceSelections,
                    ])) controller.refresh();
                  }
                  sourceSelections = nextSourceSelections;
                },
              };
            },
          }),
        }],
        nodeViews: [{
          id: "diagram",
          node: "diagram",
          create: () => createDiagramNodeView({
            manager,
            messages,
            nodeType: types.diagram,
            onCreate(controller) {
              controllers.add(controller);
              controllersByMarker.set(controller.marker, controller);
            },
            onDestroy(controller) {
              controllers.delete(controller);
              controllersByMarker.delete(controller.marker);
              editVersion += 1;
            },
            ...(onEditSource ? { onEditSource: handOffSourceEdit } : {}),
            readInfo: (node) => readDiagramNodeInfo(node) ?? "",
            readKind: (node) => readDiagramNodeKind(node) ?? "mermaid",
            reportError,
          }),
        }],
        setup({ editor }) {
          const unsubscribe = editor.subscribe("state", (event) => {
            if (event.origin === "external" || event.origin === "reset") {
              editVersion += 1;
              manager.invalidateAll();
              for (const controller of [...controllers]) controller.refresh();
            }
          });
          return () => {
            unsubscribe();
            controllers.clear();
            controllersByMarker.clear();
          };
        },
      } satisfies MarkdownEditorExtensionRuntime<undefined, DiagramCommands, DiagramState>;
    },
  });
}

export type DiagramsExtension = ReturnType<typeof createDiagramsExtension>;
