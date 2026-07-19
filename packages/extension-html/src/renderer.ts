import type { MarkdownEditorLifecycleScope } from "markora/extension-api";
import { HTML_MAX_SOURCE_BYTES, htmlSourceUtf8Bytes } from "./source";

export const HTML_MAX_CONCURRENT_RENDERS = 4;
export const HTML_MAX_RENDERED_NODES = 4_096;
export const HTML_MAX_RENDERED_DEPTH = 128;
export const HTML_MAX_RENDERED_OUTPUT_BYTES = 1_048_576;
export const HTML_MAX_ATTRIBUTES_PER_ELEMENT = 64;
export const HTML_VIEWPORT_MARGIN = "800px";

export type HtmlRenderErrorCode =
  | "renderer-missing"
  | "renderer-failed"
  | "invalid-output"
  | "wrong-document"
  | "connected-output"
  | "unsafe-output"
  | "node-limit"
  | "output-byte-limit";

export type HtmlRenderStatus =
  | "source"
  | "offscreen"
  | "queued"
  | "rendering"
  | "rendered"
  | "error"
  | "source-too-large";

export type HtmlRenderRequest = Readonly<{
  kind: "html-block";
  ownerDocument: Document;
  signal: AbortSignal;
  source: string;
}>;

export type HtmlRenderer = (
  request: HtmlRenderRequest,
) => Node | DocumentFragment | Promise<Node | DocumentFragment>;

export type HtmlRenderSnapshot = Readonly<{
  errorCode: HtmlRenderErrorCode | null;
  previewRequested: boolean;
  source: string;
  status: HtmlRenderStatus;
}>;

export type HtmlRenderTarget = Readonly<{
  dom: HTMLElement;
  viewDom: HTMLElement;
  clearPreview(): void;
  commitPreview(fragment: DocumentFragment): void;
  isComposing(): boolean;
  isCurrent(source: string): boolean;
  setRenderSnapshot(snapshot: HtmlRenderSnapshot): void;
}>;

export type HtmlRenderRegistration = Readonly<{
  destroy(): void;
  getSnapshot(): HtmlRenderSnapshot;
  retry(): boolean;
  toggle(): boolean;
  update(source: string): void;
}>;

export type HtmlRenderManager = Readonly<{
  destroy(): void;
  register(target: HtmlRenderTarget, source: string): HtmlRenderRegistration;
}>;

type HtmlRenderFailure = Readonly<{
  cause: unknown;
  code: HtmlRenderErrorCode;
}>;

type CreateHtmlRenderManagerOptions = Readonly<{
  lifecycle: MarkdownEditorLifecycleScope;
  onRenderError(failure: HtmlRenderFailure): void;
  onSourceTooLarge(event: Readonly<{ maxBytes: number; source: string }>): void;
  ownerDocument: Document;
  renderer?: HtmlRenderer;
}>;

export class HtmlRendererOutputError extends Error {
  readonly code: HtmlRenderErrorCode;

  constructor(code: HtmlRenderErrorCode, message: string) {
    super(message);
    this.name = "HtmlRendererOutputError";
    this.code = code;
  }
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const utf8Encoder = new TextEncoder();

const allowedElements = new Set([
  "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote",
  "br", "caption", "cite", "code", "col", "colgroup", "dd", "del", "dfn",
  "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "ins", "kbd",
  "li", "main", "mark", "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby",
  "s", "samp", "section", "small", "span", "strong", "sub", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);

const droppedAttributes = new Set([
  "class", "contenteditable", "draggable", "hidden", "id", "inert", "part",
  "role", "slot", "style", "tabindex",
]);

const forbiddenAttributeNames = new Set([
  "action", "background", "cite", "codebase", "content", "crossorigin",
  "data", "download", "form", "formaction", "formenctype", "formmethod",
  "formnovalidate", "formtarget", "href", "http-equiv", "integrity",
  "longdesc", "manifest", "name", "nonce", "ping", "poster", "profile",
  "referrerpolicy", "rel", "sandbox", "src", "srcdoc", "srcset", "target",
  "usemap", "xlink:href", "xmlns", "xmlns:xlink",
]);

function invalidOutput(message: string): never {
  throw new HtmlRendererOutputError("invalid-output", message);
}

function unsafeOutput(message: string): never {
  throw new HtmlRendererOutputError("unsafe-output", message);
}

function utf8ByteLength(value: string) {
  return utf8Encoder.encode(value).byteLength;
}

function safeIntegerAttribute(
  value: string,
  minimum: number,
  maximum: number,
) {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? String(parsed)
    : null;
}

function safeAttributeValue(element: Element, name: string, value: string) {
  const tag = element.localName.toLowerCase();

  if (name === "dir") {
    return /^(?:auto|ltr|rtl)$/i.test(value) ? value.toLowerCase() : null;
  }
  if (name === "lang") {
    return value.length <= 64 && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)
      ? value
      : null;
  }
  if (name === "title") {
    return value.length <= 1_024 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
      ? value
      : null;
  }
  if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan")) {
    return safeIntegerAttribute(value, 1, 100);
  }
  if (tag === "th" && name === "scope") {
    return /^(?:col|colgroup|row|rowgroup)$/.test(value) ? value : null;
  }
  if ((tag === "col" || tag === "colgroup") && name === "span") {
    return safeIntegerAttribute(value, 1, 100);
  }
  if (tag === "ol" && name === "start") {
    return safeIntegerAttribute(value, -999_999, 999_999);
  }
  if (tag === "ol" && name === "reversed") {
    return "";
  }
  if (tag === "ol" && name === "type") {
    return /^(?:1|A|a|I|i)$/.test(value) ? value : null;
  }
  if (tag === "li" && name === "value") {
    return safeIntegerAttribute(value, -999_999, 999_999);
  }
  if (tag === "time" && name === "datetime") {
    return value.length <= 128 && /^[A-Za-z0-9:+., TZW-]+$/.test(value)
      ? value
      : null;
  }
  return null;
}

function copySafeAttributes(source: Element, target: Element) {
  if (source.attributes.length > HTML_MAX_ATTRIBUTES_PER_ELEMENT) {
    throw new HtmlRendererOutputError(
      "node-limit",
      "HTML renderer output has too many attributes on one element.",
    );
  }

  for (const attribute of [...source.attributes]) {
    const name = attribute.name.toLowerCase();

    if (
      attribute.namespaceURI !== null
      || name.startsWith("on")
      || name.includes(":")
      || forbiddenAttributeNames.has(name)
    ) {
      unsafeOutput(`HTML renderer attribute "${attribute.name}" is unsafe.`);
    }

    if (
      droppedAttributes.has(name)
      || name.startsWith("aria-")
      || name.startsWith("data-")
    ) {
      continue;
    }

    const safe = safeAttributeValue(source, name, attribute.value);

    if (safe === null) {
      unsafeOutput(`HTML renderer attribute "${attribute.name}" is not allowed.`);
    }

    target.setAttribute(name, safe);
  }
}

function createSafeElement(source: Element, ownerDocument: Document) {
  const localName = source.localName.toLowerCase();

  if (
    source.namespaceURI !== HTML_NAMESPACE
    || !allowedElements.has(localName)
    || localName.includes("-")
  ) {
    unsafeOutput(`HTML renderer element <${localName}> is not allowed.`);
  }

  return ownerDocument.createElement(localName);
}

/** Manually copy a detached, static HTML allowlist into fresh owner DOM. */
export function sanitizeHtmlRendererOutput(
  output: unknown,
  ownerDocument: Document,
): DocumentFragment {
  const ownerWindow = ownerDocument.defaultView;

  if (!ownerWindow || !(output instanceof ownerWindow.Node)) {
    const possibleOwner = typeof output === "object" && output !== null && "ownerDocument" in output
      ? (output as { ownerDocument?: unknown }).ownerDocument
      : undefined;

    if (possibleOwner && possibleOwner !== ownerDocument) {
      throw new HtmlRendererOutputError(
        "wrong-document",
        "HTML renderer output belongs to a different document.",
      );
    }
    invalidOutput("HTML renderer must return a DOM Node or DocumentFragment.");
  }

  if (output.ownerDocument !== ownerDocument) {
    throw new HtmlRendererOutputError(
      "wrong-document",
      "HTML renderer output belongs to a different document.",
    );
  }
  if (output.isConnected) {
    throw new HtmlRendererOutputError(
      "connected-output",
      "HTML renderer output must be detached from the document.",
    );
  }
  if (
    typeof ownerWindow.ShadowRoot === "function"
    && output instanceof ownerWindow.ShadowRoot
  ) {
    invalidOutput("HTML renderer output cannot be a ShadowRoot.");
  }

  const accepted: number[] = [
    ownerWindow.Node.ELEMENT_NODE,
    ownerWindow.Node.TEXT_NODE,
    ownerWindow.Node.DOCUMENT_FRAGMENT_NODE,
  ];
  if (!accepted.includes(output.nodeType)) {
    invalidOutput("HTML renderer output has an unsupported root node type.");
  }

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
    bytes += utf8ByteLength(value);
    if (bytes > HTML_MAX_RENDERED_OUTPUT_BYTES) {
      throw new HtmlRendererOutputError(
        "output-byte-limit",
        "HTML renderer output exceeds the safe byte limit.",
      );
    }
  };

  while (work.length > 0) {
    const current = work.pop()!;

    if (current.depth > HTML_MAX_RENDERED_DEPTH) {
      throw new HtmlRendererOutputError("node-limit", "HTML renderer output is too deep.");
    }
    if (current.source.ownerDocument !== ownerDocument || current.source.isConnected) {
      throw new HtmlRendererOutputError(
        current.source.ownerDocument === ownerDocument ? "connected-output" : "wrong-document",
        "HTML renderer output contains a connected or foreign node.",
      );
    }

    nodes += 1;
    if (nodes > HTML_MAX_RENDERED_NODES) {
      throw new HtmlRendererOutputError("node-limit", "HTML renderer output has too many nodes.");
    }

    let copied: Node;

    if (current.source.nodeType === ownerWindow.Node.TEXT_NODE) {
      const value = current.source.nodeValue ?? "";
      consume(value);
      copied = ownerDocument.createTextNode(value);
    } else if (current.source.nodeType === ownerWindow.Node.ELEMENT_NODE) {
      const sourceElement = current.source as Element;
      const targetElement = createSafeElement(sourceElement, ownerDocument);
      consume(sourceElement.localName);
      copySafeAttributes(sourceElement, targetElement);
      for (const attribute of [...targetElement.attributes]) {
        consume(attribute.name);
        consume(attribute.value);
      }
      copied = targetElement;
    } else {
      invalidOutput("HTML renderer output contains a non-element, non-text descendant.");
    }

    current.parent.appendChild(copied);
    const children = [...current.source.childNodes];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      work.push({
        depth: current.depth + 1,
        parent: copied,
        source: children[index]!,
      });
    }
  }

  if (nodes === 0) {
    invalidOutput("HTML renderer output cannot be an empty fragment.");
  }
  return result;
}

type RenderEntry = {
  controller: AbortController | null;
  destroyed: boolean;
  diagnosticGeneration: number;
  errorCode: HtmlRenderErrorCode | null;
  generation: number;
  nearViewport: boolean;
  pending: RenderJob | null;
  previewRequested: boolean;
  source: string;
  status: HtmlRenderStatus;
  target: HtmlRenderTarget;
};

type RenderJob = {
  cancelled: boolean;
  entry: RenderEntry;
  explicit: boolean;
  generation: number;
};

function snapshot(entry: RenderEntry): HtmlRenderSnapshot {
  return Object.freeze({
    errorCode: entry.errorCode,
    previewRequested: entry.previewRequested,
    source: entry.source,
    status: entry.status,
  });
}

export function createHtmlRenderManager(
  options: CreateHtmlRenderManagerOptions,
): HtmlRenderManager {
  const { lifecycle, onRenderError, onSourceTooLarge, ownerDocument, renderer } = options;
  const ownerWindow = ownerDocument.defaultView;

  if (!ownerWindow) {
    throw new Error("HTML renderer management requires a window-backed document.");
  }

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

  const safelyReport = (failure: HtmlRenderFailure) => {
    try { onRenderError(failure); } catch { /* observer isolation */ }
  };
  const safelyReportLimit = (source: string) => {
    try { onSourceTooLarge(Object.freeze({ maxBytes: HTML_MAX_SOURCE_BYTES, source })); } catch { /* observer isolation */ }
  };
  const isCurrent = (entry: RenderEntry, generation: number) => (
    !destroyed
    && !lifecycle.signal.aborted
    && !entry.destroyed
    && entry.generation === generation
    && entry.previewRequested
    && entry.target.isCurrent(entry.source)
  );
  const transition = (
    entry: RenderEntry,
    status: HtmlRenderStatus,
    errorCode: HtmlRenderErrorCode | null = null,
  ) => {
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
  const reportFailure = (
    entry: RenderEntry,
    generation: number,
    code: HtmlRenderErrorCode,
    cause: unknown,
  ) => {
    if (!isCurrent(entry, generation)) return;
    entry.controller?.abort();
    entry.controller = null;
    entry.target.clearPreview();
    transition(entry, "error", code);
    safelyReport(Object.freeze({ cause, code }));
  };

  const nextJob = () => {
    const take = (queue: RenderJob[]) => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        if (!job.cancelled && job.entry.pending === job && isCurrent(job.entry, job.generation)) {
          return job;
        }
      }
      return null;
    };
    return take(high) ?? take(normal);
  };

  let schedulePump = () => {};

  const finish = () => {
    active = Math.max(0, active - 1);
    schedulePump();
  };

  const startJob = (job: RenderJob) => {
    const { entry, generation } = job;
    entry.pending = null;

    if (!renderer || !isCurrent(entry, generation)) return;
    if (entry.target.isComposing()) {
      transition(entry, "queued");
      return;
    }
    if (!entry.nearViewport) {
      transition(entry, "offscreen");
      return;
    }

    const controller = new AbortControllerConstructor();
    entry.controller?.abort();
    entry.controller = controller;
    transition(entry, "rendering");
    active += 1;
    let result: unknown;

    try {
      result = renderer(Object.freeze({
        kind: "html-block" as const,
        ownerDocument,
        signal: controller.signal,
        source: entry.source,
      }));
    } catch (cause) {
      reportFailure(entry, generation, "renderer-failed", cause);
      finish();
      return;
    }

    void Promise.resolve(result).then((output) => {
      if (!isCurrent(entry, generation) || controller.signal.aborted) return;
      let approved: DocumentFragment;

      try {
        approved = sanitizeHtmlRendererOutput(output, ownerDocument);
      } catch (cause) {
        reportFailure(
          entry,
          generation,
          cause instanceof HtmlRendererOutputError ? cause.code : "invalid-output",
          cause,
        );
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
      try {
        entry.target.commitPreview(approved);
      } catch (cause) {
        reportFailure(entry, generation, "renderer-failed", cause);
        return;
      }
      if (isCurrent(entry, generation) && !controller.signal.aborted) {
        transition(entry, "rendered");
      }
    }, (cause) => reportFailure(entry, generation, "renderer-failed", cause)).finally(finish);
  };

  const pump = () => {
    pumpHandle = null;
    if (destroyed || lifecycle.signal.aborted || active >= HTML_MAX_CONCURRENT_RENDERS) return;
    const job = nextJob();
    if (!job) return;
    startJob(job);
    if (active < HTML_MAX_CONCURRENT_RENDERS) schedulePump();
  };

  schedulePump = () => {
    if (
      destroyed
      || lifecycle.signal.aborted
      || pumpHandle !== null
      || active >= HTML_MAX_CONCURRENT_RENDERS
      || (high.length === 0 && normal.length === 0)
    ) return;
    pumpHandle = ownerWindow.setTimeout(pump, 0);
  };

  const enqueue = (entry: RenderEntry, explicit: boolean) => {
    if (destroyed || entry.destroyed) return false;
    if (htmlSourceUtf8Bytes(entry.source) > HTML_MAX_SOURCE_BYTES) {
      transition(entry, "source-too-large");
      if (entry.diagnosticGeneration !== entry.generation) {
        entry.diagnosticGeneration = entry.generation;
        const generation = entry.generation;
        ownerWindow.setTimeout(() => {
          if (!entry.destroyed && entry.generation === generation && entry.status === "source-too-large") {
            safelyReportLimit(entry.source);
          }
        }, 0);
      }
      return true;
    }
    if (!entry.previewRequested) {
      transition(entry, "source");
      return false;
    }
    if (!renderer) {
      if (explicit) {
        transition(entry, "error", "renderer-missing");
        safelyReport(Object.freeze({
          cause: new Error("No HTML renderer is configured."),
          code: "renderer-missing",
        }));
      } else {
        entry.previewRequested = false;
        transition(entry, "source");
      }
      return explicit;
    }
    if (!entry.nearViewport) {
      transition(entry, "offscreen");
      return true;
    }

    if (entry.pending) entry.pending.cancelled = true;
    const job: RenderJob = {
      cancelled: false,
      entry,
      explicit,
      generation: entry.generation,
    };
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
          if (entry.previewRequested && observation.isIntersecting && entry.status !== "rendered") {
            restart(entry, false);
          } else if (!observation.isIntersecting && (entry.status === "queued" || entry.status === "rendering")) {
            entry.generation += 1;
            abortGeneration(entry);
            transition(entry, "offscreen");
          }
        }
      }, { root: null, rootMargin: HTML_VIEWPORT_MARGIN, threshold: 0 });
    } catch {
      observer = null;
    }
  }

  const handleCompositionEnd = () => ownerWindow.queueMicrotask(() => {
    if (destroyed) return;
    for (const entry of entries) {
      if (!entry.destroyed && entry.previewRequested && entry.status === "queued") {
        enqueue(entry, false);
      }
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
    register(target, source) {
      if (destroyed || lifecycle.signal.aborted) {
        throw new Error("Cannot register an HTML NodeView after renderer teardown.");
      }

      const entry: RenderEntry = {
        controller: null,
        destroyed: false,
        diagnosticGeneration: -1,
        errorCode: null,
        generation: 1,
        nearViewport: observer === null,
        pending: null,
        previewRequested: Boolean(renderer),
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
        update(nextSource) {
          if (registrationDestroyed || entry.destroyed || nextSource === entry.source) return;
          entry.source = nextSource;
          restart(entry, false);
        },
      } satisfies HtmlRenderRegistration);
    },
  });
}
