import type { MarkdownEditorLifecycleScope } from "markora/extension-api";
import {
  DIAGRAM_MAX_SOURCE_BYTES,
  diagramSourceUtf8Bytes,
  type DiagramKind,
} from "./source";

export { DIAGRAM_MAX_SOURCE_BYTES };
export const DIAGRAM_MAX_CONCURRENT_RENDERS = 4;
export const DIAGRAM_MAX_RENDERED_NODES = 4_096;
export const DIAGRAM_MAX_RENDERED_DEPTH = 128;
export const DIAGRAM_MAX_RENDERED_OUTPUT_BYTES = 1_048_576;
export const DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT = 64;
export const DIAGRAM_VIEWPORT_MARGIN = "800px";

export type DiagramRenderErrorCode =
  | "renderer-missing"
  | "renderer-failed"
  | "invalid-output"
  | "wrong-document"
  | "connected-output"
  | "unsafe-output"
  | "node-limit"
  | "output-byte-limit";

export type DiagramRenderStatus =
  | "source"
  | "offscreen"
  | "queued"
  | "rendering"
  | "rendered"
  | "error"
  | "source-too-large";

export type DiagramRenderRequest = Readonly<{
  info: string;
  kind: DiagramKind;
  ownerDocument: Document;
  signal: AbortSignal;
  source: string;
}>;

export type DiagramRenderer = (
  request: DiagramRenderRequest,
) => Node | DocumentFragment | Promise<Node | DocumentFragment>;

export type DiagramRenderSnapshot = Readonly<{
  enabled: boolean;
  errorCode: DiagramRenderErrorCode | null;
  status: DiagramRenderStatus;
}>;

export type InternalDiagramRenderSnapshot = Readonly<{
  errorCode: DiagramRenderErrorCode | null;
  info: string;
  kind: DiagramKind;
  previewRequested: boolean;
  source: string;
  status: DiagramRenderStatus;
}>;

export type DiagramRenderTarget = Readonly<{
  dom: HTMLElement;
  viewDom: HTMLElement;
  clearPreview(): void;
  commitPreview(fragment: DocumentFragment): void;
  isComposing(): boolean;
  isCurrent(kind: DiagramKind, info: string, source: string): boolean;
  setRenderSnapshot(snapshot: InternalDiagramRenderSnapshot): void;
}>;

export type DiagramRenderRegistration = Readonly<{
  destroy(): void;
  getSnapshot(): InternalDiagramRenderSnapshot;
  retry(): boolean;
  toggle(): boolean;
  update(kind: DiagramKind, info: string, source: string): void;
}>;

export type DiagramRenderManager = Readonly<{
  destroy(): void;
  invalidateAll(): void;
  register(
    target: DiagramRenderTarget,
    kind: DiagramKind,
    info: string,
    source: string,
  ): DiagramRenderRegistration;
}>;

type DiagramRenderFailure = Readonly<{
  cause: unknown;
  code: DiagramRenderErrorCode;
  kind: DiagramKind;
}>;

type CreateDiagramRenderManagerOptions = Readonly<{
  lifecycle: MarkdownEditorLifecycleScope;
  onRenderError(failure: DiagramRenderFailure): void;
  onSourceTooLarge(event: Readonly<{
    info: string;
    kind: DiagramKind;
    maxBytes: number;
    source: string;
  }>): void;
  ownerDocument: Document;
  renderers: Readonly<Partial<Record<DiagramKind, DiagramRenderer>>>;
}>;

export class DiagramRendererOutputError extends Error {
  readonly code: DiagramRenderErrorCode;

  constructor(code: DiagramRenderErrorCode, message: string) {
    super(message);
    this.name = "DiagramRendererOutputError";
    this.code = code;
  }
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const utf8Encoder = new TextEncoder();

const allowedHtmlElements = new Set(["code", "div", "p", "pre", "span"]);
const allowedSvgElements = new Set([
  "circle", "clippath", "defs", "desc", "ellipse", "g", "line",
  "lineargradient", "marker", "mask", "path", "polygon", "polyline",
  "radialgradient", "rect", "stop", "svg", "text", "title", "tspan", "use",
]);
const droppedAttributes = new Set([
  "contenteditable", "draggable", "hidden", "inert", "part", "role", "slot", "tabindex",
]);
const localReferenceAttributes = new Set([
  "clip-path", "fill", "filter", "marker-end", "marker-mid", "marker-start", "mask", "stroke",
]);
const allowedSvgAttributes = new Set([
  "alignment-baseline", "class", "color", "cx", "cy", "d", "direction",
  "dominant-baseline", "dx", "dy", "fill", "fill-opacity", "fill-rule",
  "font-family", "font-size", "font-style", "font-weight", "height", "id",
  "gradienttransform", "gradientunits", "marker-end", "markerheight", "marker-mid",
  "marker-start", "markerunits", "markerwidth", "mask", "offset", "opacity",
  "orient", "pathlength", "points", "preserveaspectratio", "r", "refx", "refy",
  "rx", "ry", "shape-rendering", "spreadmethod",
  "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
  "stroke-width", "style", "text-anchor", "transform", "vector-effect",
  "viewbox", "width", "x", "x1", "x2", "y", "y1", "y2",
]);
const allowedStyleProperties = new Set([
  "alignment-baseline", "color", "direction", "display", "dominant-baseline",
  "fill", "fill-opacity", "fill-rule", "font-family", "font-size", "font-style",
  "font-weight", "height", "max-height", "max-width", "opacity", "pointer-events", "shape-rendering", "stop-color",
  "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width",
  "text-anchor", "vector-effect", "visibility", "white-space", "width",
]);
const safeClassToken = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const safeIdToken = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const safePresentationValue = /^[A-Za-z0-9#.,%() +\-_/]*$/;
const unsafeIndirectCssValue = /(?:^|[^A-Za-z0-9_-])(?:attr|env|var)\s*\(/iu;
let nextClampNamespace = 0;

const canonicalSvgAttribute = new Map<string, string>([
  ["gradienttransform", "gradientTransform"],
  ["gradientunits", "gradientUnits"],
  ["markerheight", "markerHeight"],
  ["markerunits", "markerUnits"],
  ["markerwidth", "markerWidth"],
  ["pathlength", "pathLength"],
  ["preserveaspectratio", "preserveAspectRatio"],
  ["refx", "refX"],
  ["refy", "refY"],
  ["spreadmethod", "spreadMethod"],
  ["viewbox", "viewBox"],
]);

function invalidOutput(message: string): never {
  throw new DiagramRendererOutputError("invalid-output", message);
}

function unsafeOutput(message: string): never {
  throw new DiagramRendererOutputError("unsafe-output", message);
}

function consumeByteLength(value: string) {
  return utf8Encoder.encode(value).byteLength;
}

function checkedNodes(output: unknown, ownerDocument: Document) {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow || !(output instanceof ownerWindow.Node)) {
    const possibleOwner = typeof output === "object" && output !== null && "ownerDocument" in output
      ? (output as { ownerDocument?: unknown }).ownerDocument
      : undefined;
    if (possibleOwner && possibleOwner !== ownerDocument) {
      throw new DiagramRendererOutputError("wrong-document", "Diagram renderer output belongs to a different document.");
    }
    invalidOutput("Diagram renderer must return a DOM Node or DocumentFragment.");
  }
  if (output.ownerDocument !== ownerDocument) {
    throw new DiagramRendererOutputError("wrong-document", "Diagram renderer output belongs to a different document.");
  }
  if (output.isConnected) {
    throw new DiagramRendererOutputError("connected-output", "Diagram renderer output must be detached.");
  }
  if (typeof ownerWindow.ShadowRoot === "function" && output instanceof ownerWindow.ShadowRoot) {
    invalidOutput("Diagram renderer output cannot be a ShadowRoot.");
  }
  const acceptedNodeTypes: number[] = [
    ownerWindow.Node.ELEMENT_NODE,
    ownerWindow.Node.TEXT_NODE,
    ownerWindow.Node.DOCUMENT_FRAGMENT_NODE,
  ];
  if (!acceptedNodeTypes.includes(output.nodeType)) {
    invalidOutput("Diagram renderer output has an unsupported root node type.");
  }
  return { output, ownerWindow };
}

function rendererElements(output: Node, ownerDocument: Document) {
  const elements: Element[] = [];
  type Pending = Readonly<{ depth: number; node: Node }>;
  const stack: Pending[] = (output.nodeType === ownerDocument.defaultView!.Node.DOCUMENT_FRAGMENT_NODE
    ? [...output.childNodes]
    : [output]).map((node) => ({ depth: 1, node }));
  let nodes = 0;
  while (stack.length > 0) {
    const { depth, node } = stack.pop()!;
    nodes += 1;
    if (nodes > DIAGRAM_MAX_RENDERED_NODES || depth > DIAGRAM_MAX_RENDERED_DEPTH) {
      throw new DiagramRendererOutputError("node-limit", "Diagram renderer output exceeds the safe pre-scan bound.");
    }
    if (node.ownerDocument !== ownerDocument || node.isConnected) {
      throw new DiagramRendererOutputError(
        node.ownerDocument === ownerDocument ? "connected-output" : "wrong-document",
        "Diagram renderer output contains a connected or foreign node.",
      );
    }
    if (node.nodeType === ownerDocument.defaultView!.Node.ELEMENT_NODE) {
      elements.push(node as Element);
    }
    for (const child of node.childNodes) {
      stack.push({ depth: depth + 1, node: child });
    }
  }
  return elements;
}

function scopedIds(output: Node, ownerDocument: Document) {
  const result = new Map<string, string>();
  const prefix = `mdw-diagram-${++nextClampNamespace}-`;
  for (const element of rendererElements(output, ownerDocument)) {
    const value = element.getAttribute("id");
    if (value === null) continue;
    if (!safeIdToken.test(value) || result.has(value)) {
      unsafeOutput("Diagram renderer IDs must be unique safe local tokens.");
    }
    result.set(value, `${prefix}${result.size + 1}`);
  }
  return result;
}

function rewriteFragment(value: string, ids: ReadonlyMap<string, string>) {
  if (!value.startsWith("#") || !ids.has(value.slice(1))) {
    unsafeOutput("Diagram renderer references must resolve to a local renderer-owned ID.");
  }
  return `#${ids.get(value.slice(1))!}`;
}

function rewriteIdReferences(value: string, ids: ReadonlyMap<string, string>) {
  const references = value.trim() ? value.trim().split(/\s+/u) : [];
  if (references.length === 0 || references.length > 64) {
    unsafeOutput("Diagram renderer ARIA references must contain local IDs.");
  }
  return references.map((reference) => {
    const scoped = ids.get(reference);
    if (!scoped) unsafeOutput("Diagram renderer ARIA reference does not resolve locally.");
    return scoped;
  }).join(" ");
}

function rewriteUrlValue(value: string, ids: ReadonlyMap<string, string>) {
  const match = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.:-]{0,127})\s*\)$/i.exec(value.trim());
  if (!match || !ids.has(match[1]!)) {
    unsafeOutput("Diagram renderer URL values must be one local fragment reference.");
  }
  return `url(#${ids.get(match[1]!)!})`;
}

function sanitizeClass(value: string) {
  if (value.length > 4_096) unsafeOutput("Diagram renderer class metadata is too large.");
  const tokens = value.trim() ? value.trim().split(/\s+/u) : [];
  if (tokens.length > 128 || tokens.some((token) => !safeClassToken.test(token))) {
    unsafeOutput("Diagram renderer class metadata is outside the safe token grammar.");
  }
  return tokens.join(" ");
}

function sanitizeStyle(value: string, ids: ReadonlyMap<string, string>) {
  if (value.length > 8_192 || /[\u0000-\u001f\u007f\\{}"'@]/u.test(value) || /(?:expression|javascript|vbscript|import|behavior|binding)/iu.test(value)) {
    unsafeOutput("Diagram renderer inline style contains an unsafe construct.");
  }
  const normalized: string[] = [];
  for (const raw of value.split(";")) {
    const declaration = raw.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(":");
    if (separator <= 0 || declaration.indexOf(":", separator + 1) !== -1) {
      unsafeOutput("Diagram renderer inline style has an invalid declaration.");
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    let propertyValue = declaration.slice(separator + 1).trim();
    if (!allowedStyleProperties.has(property)) {
      unsafeOutput(`Diagram renderer inline style property "${property}" is not allowed.`);
    }
    if (/url\s*\(/i.test(propertyValue)) {
      if (!localReferenceAttributes.has(property)) {
        unsafeOutput("Diagram renderer inline style contains an unsupported URL reference.");
      }
      propertyValue = rewriteUrlValue(propertyValue, ids);
    } else if (
      propertyValue.length > 1_024
      || !safePresentationValue.test(propertyValue)
      || unsafeIndirectCssValue.test(propertyValue)
    ) {
      unsafeOutput("Diagram renderer inline style value is outside the safe grammar.");
    }
    normalized.push(`${property}: ${propertyValue}`);
  }
  return normalized.join("; ");
}

function safeAttributeValue(source: Element, name: string, value: string, ids: ReadonlyMap<string, string>) {
  if (name === "id") {
    const scoped = ids.get(value);
    if (!scoped) unsafeOutput("Diagram renderer ID is invalid.");
    return scoped;
  }
  if (name === "aria-labelledby" || name === "aria-describedby") {
    return rewriteIdReferences(value, ids);
  }
  if (name === "class") return sanitizeClass(value);
  if (name === "style") return sanitizeStyle(value, ids);
  if ((name === "href" || name === "xlink:href") && source.localName.toLowerCase() === "use") {
    return rewriteFragment(value, ids);
  }
  if (localReferenceAttributes.has(name) && /url\s*\(/i.test(value)) {
    return rewriteUrlValue(value, ids);
  }
  if (name === "lang") {
    return value.length <= 64 && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value) ? value : null;
  }
  if (name === "dir") return /^(?:auto|ltr|rtl)$/i.test(value) ? value.toLowerCase() : null;
  if (name === "title") {
    return value.length <= 1_024 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
  }
  return value.length <= 4_096
    && safePresentationValue.test(value)
    && !unsafeIndirectCssValue.test(value)
    ? value
    : null;
}

function copySafeAttributes(
  source: Element,
  target: Element,
  ids: ReadonlyMap<string, string>,
) {
  if (source.attributes.length > DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT) {
    throw new DiagramRendererOutputError("node-limit", "Diagram renderer output has too many attributes on one element.");
  }
  const html = source.namespaceURI === HTML_NAMESPACE;
  for (const attribute of [...source.attributes]) {
    const name = attribute.localName.toLowerCase();
    if (attribute.namespaceURI === XMLNS_NAMESPACE || name === "xmlns") continue;
    if (name.startsWith("on") || name === "src" || name === "srcdoc" || name === "action" || name === "formaction") {
      unsafeOutput(`Diagram renderer attribute "${attribute.name}" is unsafe.`);
    }
    if (
      (name.startsWith("aria-") && name !== "aria-labelledby" && name !== "aria-describedby")
      || name.startsWith("data-")
      || droppedAttributes.has(name)
    ) continue;
    const isUseHref = source.localName.toLowerCase() === "use"
      && name === "href"
      && (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NAMESPACE);
    if (attribute.namespaceURI !== null && !isUseHref) {
      unsafeOutput(`Diagram renderer namespaced attribute "${attribute.name}" is unsafe.`);
    }
    if (html) {
      if (!["aria-describedby", "aria-labelledby", "class", "dir", "lang", "style", "title"].includes(name)) {
        unsafeOutput(`Diagram renderer HTML attribute "${attribute.name}" is not allowed.`);
      }
    } else if (
      !allowedSvgAttributes.has(name)
      && !isUseHref
      && name !== "aria-describedby"
      && name !== "aria-labelledby"
      && name !== "clip-path"
      && name !== "filter"
    ) {
      unsafeOutput(`Diagram renderer SVG attribute "${attribute.name}" is not allowed.`);
    }
    const safe = safeAttributeValue(source, isUseHref ? "href" : name, attribute.value, ids);
    if (safe === null) unsafeOutput(`Diagram renderer attribute "${attribute.name}" has an unsafe value.`);
    if (safe) {
      if (isUseHref) target.setAttribute("href", safe);
      else target.setAttribute(canonicalSvgAttribute.get(name) ?? name, safe);
    }
  }
}

function createSafeElement(source: Element, ownerDocument: Document) {
  const name = source.localName.toLowerCase();
  if (source.namespaceURI === HTML_NAMESPACE) {
    if (!allowedHtmlElements.has(name) || name.includes("-")) {
      unsafeOutput(`Diagram renderer HTML element <${name}> is not allowed.`);
    }
    return ownerDocument.createElement(name);
  }
  if (source.namespaceURI === SVG_NAMESPACE) {
    if (!allowedSvgElements.has(name)) {
      unsafeOutput(`Diagram renderer SVG element <${name}> is not allowed.`);
    }
    return ownerDocument.createElementNS(SVG_NAMESPACE, source.localName);
  }
  unsafeOutput("Diagram renderer output uses an unsupported DOM namespace.");
}

/** Manually clone a detached static HTML/SVG allowlist and scope local IDs. */
export function sanitizeDiagramRendererOutput(
  rawOutput: unknown,
  ownerDocument: Document,
): DocumentFragment {
  const { output, ownerWindow } = checkedNodes(rawOutput, ownerDocument);
  const ids = scopedIds(output, ownerDocument);
  const result = ownerDocument.createDocumentFragment();
  type Work = Readonly<{ depth: number; parent: Node; source: Node }>;
  const work: Work[] = [];
  if (output.nodeType === ownerWindow.Node.DOCUMENT_FRAGMENT_NODE) {
    const children = [...output.childNodes];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      work.push({ depth: 1, parent: result, source: children[index]! });
    }
  } else {
    work.push({ depth: 1, parent: result, source: output });
  }
  let nodes = 0;
  let bytes = 0;
  const consume = (value: string) => {
    bytes += consumeByteLength(value);
    if (bytes > DIAGRAM_MAX_RENDERED_OUTPUT_BYTES) {
      throw new DiagramRendererOutputError("output-byte-limit", "Diagram renderer output exceeds the safe byte limit.");
    }
  };
  while (work.length > 0) {
    const current = work.pop()!;
    if (current.depth > DIAGRAM_MAX_RENDERED_DEPTH) {
      throw new DiagramRendererOutputError("node-limit", "Diagram renderer output is too deep.");
    }
    if (current.source.ownerDocument !== ownerDocument || current.source.isConnected) {
      throw new DiagramRendererOutputError(
        current.source.ownerDocument === ownerDocument ? "connected-output" : "wrong-document",
        "Diagram renderer output contains a connected or foreign node.",
      );
    }
    nodes += 1;
    if (nodes > DIAGRAM_MAX_RENDERED_NODES) {
      throw new DiagramRendererOutputError("node-limit", "Diagram renderer output has too many nodes.");
    }
    let copied: Node;
    if (current.source.nodeType === ownerWindow.Node.TEXT_NODE) {
      const value = current.source.nodeValue ?? "";
      consume(value);
      copied = ownerDocument.createTextNode(value);
    } else if (current.source.nodeType === ownerWindow.Node.ELEMENT_NODE) {
      const source = current.source as Element;
      const target = createSafeElement(source, ownerDocument);
      consume(source.localName);
      copySafeAttributes(source, target, ids);
      for (const attribute of [...target.attributes]) {
        consume(attribute.name);
        consume(attribute.value);
      }
      copied = target;
    } else {
      invalidOutput("Diagram renderer output contains a non-element, non-text descendant.");
    }
    current.parent.appendChild(copied);
    const children = [...current.source.childNodes];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      work.push({ depth: current.depth + 1, parent: copied, source: children[index]! });
    }
  }
  if (nodes === 0) invalidOutput("Diagram renderer output cannot be empty.");
  return result;
}

type RenderEntry = {
  controller: AbortController | null;
  destroyed: boolean;
  diagnosticGeneration: number;
  errorCode: DiagramRenderErrorCode | null;
  generation: number;
  info: string;
  kind: DiagramKind;
  nearViewport: boolean;
  pending: RenderJob | null;
  previewRequested: boolean;
  source: string;
  status: DiagramRenderStatus;
  target: DiagramRenderTarget;
};

type RenderJob = {
  cancelled: boolean;
  entry: RenderEntry;
  explicit: boolean;
  generation: number;
  release?: () => void;
};

function snapshot(entry: RenderEntry): InternalDiagramRenderSnapshot {
  return Object.freeze({
    errorCode: entry.errorCode,
    info: entry.info,
    kind: entry.kind,
    previewRequested: entry.previewRequested,
    source: entry.source,
    status: entry.status,
  });
}

export function createDiagramRenderManager(options: CreateDiagramRenderManagerOptions): DiagramRenderManager {
  const { lifecycle, onRenderError, onSourceTooLarge, ownerDocument, renderers } = options;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Diagram renderer management requires a window-backed document.");

  const entries = new Set<RenderEntry>();
  const byDom = new Map<HTMLElement, RenderEntry>();
  const high: RenderJob[] = [];
  const normal: RenderJob[] = [];
  const AbortControllerConstructor = ownerWindow.AbortController;
  let active = 0;
  let destroyed = false;
  let observer: IntersectionObserver | null = null;
  let pumpHandle: number | null = null;
  let compositionRoot: HTMLElement | null = null;

  const safelyReport = (failure: DiagramRenderFailure) => { try { onRenderError(failure); } catch { /* observer isolation */ } };
  const safelyReportLimit = (entry: RenderEntry) => {
    try { onSourceTooLarge(Object.freeze({ info: entry.info, kind: entry.kind, maxBytes: DIAGRAM_MAX_SOURCE_BYTES, source: entry.source })); } catch { /* observer isolation */ }
  };
  const rendererFor = (entry: RenderEntry) => renderers[entry.kind];
  const isCurrent = (entry: RenderEntry, generation: number) => (
    !destroyed && !lifecycle.signal.aborted && !entry.destroyed
    && entry.generation === generation && entry.previewRequested
    && entry.target.isCurrent(entry.kind, entry.info, entry.source)
  );
  const transition = (entry: RenderEntry, status: DiagramRenderStatus, errorCode: DiagramRenderErrorCode | null = null) => {
    entry.status = status;
    entry.errorCode = errorCode;
    entry.target.setRenderSnapshot(snapshot(entry));
  };
  const abortGeneration = (entry: RenderEntry, clear = true) => {
    if (entry.pending) entry.pending.cancelled = true;
    entry.pending = null;
    entry.controller?.abort();
    entry.controller = null;
    if (clear) entry.target.clearPreview();
  };
  const reportFailure = (entry: RenderEntry, generation: number, code: DiagramRenderErrorCode, cause: unknown) => {
    if (!isCurrent(entry, generation)) return;
    entry.controller?.abort();
    entry.controller = null;
    entry.target.clearPreview();
    transition(entry, "error", code);
    safelyReport(Object.freeze({ cause, code, kind: entry.kind }));
  };
  const nextJob = () => {
    const take = (queue: RenderJob[]) => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        if (!job.cancelled && job.entry.pending === job && isCurrent(job.entry, job.generation)) return job;
      }
      return null;
    };
    return take(high) ?? take(normal);
  };
  let schedulePump = () => {};
  const startJob = (job: RenderJob) => {
    const { entry, generation } = job;
    entry.pending = null;
    const renderer = rendererFor(entry);
    if (!renderer || !isCurrent(entry, generation)) return;
    if (entry.target.isComposing()) { transition(entry, "queued"); return; }
    if (!entry.nearViewport) { transition(entry, "offscreen"); return; }
    const controller = new AbortControllerConstructor();
    entry.controller?.abort();
    entry.controller = controller;
    transition(entry, "rendering");
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      schedulePump();
    };
    job.release = release;
    controller.signal.addEventListener("abort", release, { once: true });
    let result: unknown;
    try {
      result = renderer(Object.freeze({
        info: entry.info,
        kind: entry.kind,
        ownerDocument,
        signal: controller.signal,
        source: entry.source,
      }));
    } catch (cause) {
      reportFailure(entry, generation, "renderer-failed", cause);
      release();
      return;
    }
    void Promise.resolve(result).then((output) => {
      if (!isCurrent(entry, generation) || controller.signal.aborted) return;
      let approved: DocumentFragment;
      try {
        approved = sanitizeDiagramRendererOutput(output, ownerDocument);
      } catch (cause) {
        reportFailure(entry, generation, cause instanceof DiagramRendererOutputError ? cause.code : "invalid-output", cause);
        return;
      }
      if (!isCurrent(entry, generation) || controller.signal.aborted) return;
      if (entry.target.isComposing()) {
        entry.generation += 1;
        controller.abort();
        entry.controller = null;
        transition(entry, "queued");
        return;
      }
      try { entry.target.commitPreview(approved); }
      catch (cause) { reportFailure(entry, generation, "renderer-failed", cause); return; }
      if (isCurrent(entry, generation) && !controller.signal.aborted) transition(entry, "rendered");
    }, (cause) => reportFailure(entry, generation, "renderer-failed", cause)).finally(release);
  };
  const pump = () => {
    pumpHandle = null;
    if (destroyed || lifecycle.signal.aborted || active >= DIAGRAM_MAX_CONCURRENT_RENDERS) return;
    const job = nextJob();
    if (!job) return;
    startJob(job);
    if (active < DIAGRAM_MAX_CONCURRENT_RENDERS) schedulePump();
  };
  schedulePump = () => {
    if (destroyed || lifecycle.signal.aborted || pumpHandle !== null || active >= DIAGRAM_MAX_CONCURRENT_RENDERS || (high.length === 0 && normal.length === 0)) return;
    pumpHandle = ownerWindow.setTimeout(pump, 0);
  };
  const enqueue = (entry: RenderEntry, explicit: boolean) => {
    if (destroyed || entry.destroyed) return false;
    if (diagramSourceUtf8Bytes(entry.info, entry.source) > DIAGRAM_MAX_SOURCE_BYTES) {
      transition(entry, "source-too-large");
      if (entry.diagnosticGeneration !== entry.generation) {
        entry.diagnosticGeneration = entry.generation;
        const generation = entry.generation;
        ownerWindow.setTimeout(() => {
          if (!entry.destroyed && entry.generation === generation && entry.status === "source-too-large") safelyReportLimit(entry);
        }, 0);
      }
      return true;
    }
    if (!entry.previewRequested) { transition(entry, "source"); return false; }
    if (!rendererFor(entry)) {
      if (explicit) {
        transition(entry, "error", "renderer-missing");
        safelyReport(Object.freeze({ cause: new Error(`No ${entry.kind} renderer is configured.`), code: "renderer-missing", kind: entry.kind }));
      } else {
        entry.previewRequested = false;
        transition(entry, "source");
      }
      return explicit;
    }
    if (!entry.nearViewport) { transition(entry, "offscreen"); return true; }
    if (entry.pending) entry.pending.cancelled = true;
    const job: RenderJob = { cancelled: false, entry, explicit, generation: entry.generation };
    entry.pending = job;
    (explicit ? high : normal).push(job);
    transition(entry, "queued");
    if (!entry.target.isComposing()) schedulePump();
    return true;
  };
  const restart = (entry: RenderEntry, explicit: boolean) => {
    entry.generation += 1;
    abortGeneration(entry);
    return enqueue(entry, explicit);
  };

  if (typeof ownerWindow.IntersectionObserver === "function") {
    try {
      observer = new ownerWindow.IntersectionObserver((observations) => {
        for (const observation of observations) {
          const entry = byDom.get(observation.target as HTMLElement);
          if (!entry || entry.destroyed || entry.nearViewport === observation.isIntersecting) continue;
          entry.nearViewport = observation.isIntersecting;
          if (entry.previewRequested && observation.isIntersecting && entry.status !== "rendered") restart(entry, false);
          else if (!observation.isIntersecting && (entry.status === "queued" || entry.status === "rendering")) {
            entry.generation += 1;
            abortGeneration(entry);
            transition(entry, "offscreen");
          }
        }
      }, { root: null, rootMargin: DIAGRAM_VIEWPORT_MARGIN, threshold: 0 });
    } catch { observer = null; }
  }
  const handleCompositionEnd = () => ownerWindow.queueMicrotask(() => {
    if (destroyed) return;
    for (const entry of entries) {
      if (!entry.destroyed && entry.previewRequested && entry.status === "queued") enqueue(entry, false);
    }
    schedulePump();
  });
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (pumpHandle !== null) ownerWindow.clearTimeout(pumpHandle);
    pumpHandle = null;
    observer?.disconnect();
    observer = null;
    compositionRoot?.removeEventListener("compositionend", handleCompositionEnd);
    compositionRoot = null;
    for (const entry of entries) {
      entry.destroyed = true;
      entry.generation += 1;
      abortGeneration(entry);
    }
    entries.clear();
    byDom.clear();
    high.length = 0;
    normal.length = 0;
  };
  const handleAbort = () => destroy();
  lifecycle.signal.addEventListener("abort", handleAbort, { once: true });
  lifecycle.addCleanup(() => {
    lifecycle.signal.removeEventListener("abort", handleAbort);
    destroy();
  });

  return Object.freeze({
    destroy,
    invalidateAll() {
      for (const entry of entries) {
        if (!entry.destroyed && entry.previewRequested) restart(entry, false);
      }
    },
    register(target, kind, info, source) {
      if (destroyed || lifecycle.signal.aborted) throw new Error("Cannot register a diagram NodeView after renderer teardown.");
      const entry: RenderEntry = {
        controller: null,
        destroyed: false,
        diagnosticGeneration: -1,
        errorCode: null,
        generation: 1,
        info,
        kind,
        nearViewport: observer === null,
        pending: null,
        previewRequested: Boolean(renderers[kind]),
        source,
        status: "source",
        target,
      };
      entries.add(entry);
      byDom.set(target.dom, entry);
      observer?.observe(target.dom);
      if (!compositionRoot) {
        compositionRoot = target.viewDom;
        compositionRoot.addEventListener("compositionend", handleCompositionEnd);
      }
      enqueue(entry, false);
      let registrationDestroyed = false;
      return Object.freeze({
        destroy() {
          if (registrationDestroyed) return;
          registrationDestroyed = true;
          entry.destroyed = true;
          entry.generation += 1;
          abortGeneration(entry);
          observer?.unobserve(target.dom);
          entries.delete(entry);
          byDom.delete(target.dom);
        },
        getSnapshot: () => snapshot(entry),
        retry() {
          if (registrationDestroyed || entry.destroyed) return false;
          if (entry.status !== "error" && entry.status !== "offscreen") return false;
          entry.previewRequested = true;
          return restart(entry, true);
        },
        toggle() {
          if (registrationDestroyed || entry.destroyed) return false;
          if (entry.previewRequested) {
            entry.previewRequested = false;
            entry.generation += 1;
            abortGeneration(entry);
            transition(entry, "source");
            return true;
          }
          entry.previewRequested = true;
          return restart(entry, true);
        },
        update(nextKind, nextInfo, nextSource) {
          if (registrationDestroyed || entry.destroyed || (nextKind === entry.kind && nextInfo === entry.info && nextSource === entry.source)) return;
          entry.kind = nextKind;
          entry.info = nextInfo;
          entry.source = nextSource;
          restart(entry, false);
        },
      } satisfies DiagramRenderRegistration);
    },
  });
}
