import { createMarkdownRenderScheduler } from "markora/extension-api";
import type { MarkdownEditorLifecycleScope } from "markora/extension-api";

export const MATH_MAX_SOURCE_BYTES = 65_536;
export const MATH_MAX_RENDERED_NODES = 4_096;
export const MATH_MAX_RENDERED_OUTPUT_BYTES = 1_048_576;
export const MATH_MAX_CONCURRENT_RENDERS = 4;

const MATH_MAX_RENDERED_DEPTH = 128;
const MATH_VIEWPORT_MARGIN = "800px 0px";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export type MathKind = "inline" | "block";

export type MathRenderStatus =
  | "source"
  | "offscreen"
  | "queued"
  | "rendering"
  | "rendered"
  | "error"
  | "source-too-large";

export type MathRenderErrorCode =
  | "renderer-missing"
  | "renderer-failed"
  | "invalid-output"
  | "wrong-document"
  | "connected-output"
  | "unsafe-output"
  | "node-limit"
  | "output-byte-limit";

export type MathRenderRequest = Readonly<{
  kind: MathKind;
  ownerDocument: Document;
  signal: AbortSignal;
  source: string;
}>;

export type MathRenderer = (
  request: MathRenderRequest,
) => Node | DocumentFragment | Promise<Node | DocumentFragment>;

export type MathRenderSnapshot = Readonly<{
  errorCode: MathRenderErrorCode | null;
  kind: MathKind;
  previewRequested: boolean;
  source: string;
  status: MathRenderStatus;
}>;

export type MathRenderFailure = Readonly<{
  cause: unknown;
  code: MathRenderErrorCode;
  kind: MathKind;
}>;

export type MathSourceTooLargeEvent = Readonly<{
  kind: MathKind;
  maxBytes: number;
  source: string;
}>;

/** The package NodeView implements this small renderer-owned surface. */
export type MathRenderTarget = Readonly<{
  dom: HTMLElement;
  preview: HTMLElement;
  viewDom: HTMLElement;
  clearPreview(): void;
  commitPreview(fragment: DocumentFragment): void;
  isComposing(): boolean;
  isCurrent(kind: MathKind, source: string): boolean;
  setRenderSnapshot(snapshot: MathRenderSnapshot): void;
}>;

export type MathRenderRegistration = Readonly<{
  destroy(): void;
  invalidate(): boolean;
  retry(): boolean;
  setNearViewport(nearViewport: boolean): void;
  snapshot(): MathRenderSnapshot;
  sync(kind: MathKind, source: string): boolean;
  togglePreview(): boolean;
}>;

export type MathRenderManager = Readonly<{
  destroy(): void;
  invalidateAll(): void;
  register(
    target: MathRenderTarget,
    kind: MathKind,
    source: string,
  ): MathRenderRegistration;
}>;

export type CreateMathRenderManagerOptions = Readonly<{
  lifecycle: MarkdownEditorLifecycleScope;
  onRenderError(failure: MathRenderFailure): void;
  onSourceTooLarge(event: MathSourceTooLargeEvent): void;
  ownerDocument: Document;
  renderer?: MathRenderer;
}>;

export class MathRendererOutputError extends Error {
  readonly code: MathRenderErrorCode;
  readonly cause: unknown;

  constructor(code: MathRenderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MathRendererOutputError";
    this.code = code;
    this.cause = options?.cause;
  }
}

const allowedHtmlElements = new Set(["div", "span"]);

const allowedMathMlElements = new Set([
  "annotation",
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
]);

const allowedMathMlAttributes = new Set([
  "accent",
  "accentunder",
  "align",
  "bevelled",
  "close",
  "columnalign",
  "columnlines",
  "columnspacing",
  "columnspan",
  "denomalign",
  "depth",
  "display",
  "displaystyle",
  "encoding",
  "equalcolumns",
  "equalrows",
  "fence",
  "form",
  "frame",
  "framespacing",
  "height",
  "largeop",
  "length",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "numalign",
  "open",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rowspan",
  "rspace",
  "scriptlevel",
  "scriptminsize",
  "scriptsizemultiplier",
  "selection",
  "separator",
  "separators",
  "stretchy",
  "subscriptshift",
  "superscriptshift",
  "symmetric",
  "voffset",
  "width",
]);

const droppedPresentationAttributes = new Set([
  "contenteditable",
  "dir",
  "draggable",
  "lang",
  "role",
  "tabindex",
]);

const forbiddenAttributeNames = new Set([
  "action",
  "cite",
  "data",
  "form",
  "formaction",
  "href",
  "id",
  "manifest",
  "name",
  "ping",
  "poster",
  "src",
  "srcdoc",
  "xlink:href",
]);

const numericStyleProperties = new Set([
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
  "border-width",
  "bottom",
  "font-size",
  "height",
  "left",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-width",
  "min-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "right",
  "top",
  "vertical-align",
  "width",
]);

const colorStyleProperties = new Set([
  "background-color",
  "border-bottom-color",
  "border-color",
  "border-left-color",
  "border-right-color",
  "border-top-color",
  "color",
]);

const borderStyleProperties = new Set([
  "border-bottom-style",
  "border-left-style",
  "border-right-style",
  "border-style",
  "border-top-style",
]);

const classTokenPattern = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const numericCssTokenPattern = /^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?(?:em|ex|px|rem|%)?$/i;
const safeColorPattern = /^(?:currentcolor|transparent|#[0-9a-f]{3,8}|[a-z]{1,32})$/i;
const safeMathMlValuePattern = /^[^\u0000-\u001f\u007f]{0,256}$/u;

function invalidOutput(message: string, cause?: unknown): never {
  throw new MathRendererOutputError("invalid-output", message, { cause });
}

function unsafeOutput(message: string, cause?: unknown): never {
  throw new MathRendererOutputError("unsafe-output", message, { cause });
}

function utf8ByteLength(value: string) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > MATH_MAX_RENDERED_OUTPUT_BYTES) {
      return bytes;
    }
  }

  return bytes;
}

function sourceIsTooLarge(source: string) {
  return source.length > MATH_MAX_SOURCE_BYTES
    || utf8ByteLength(source) > MATH_MAX_SOURCE_BYTES;
}

function sanitizeClass(value: string) {
  if (value.length > 1_024) {
    unsafeOutput("Math renderer class metadata exceeds its safe limit.");
  }

  const tokens = value.trim() ? value.trim().split(/\s+/u) : [];

  if (tokens.length > 64 || tokens.some((token) => !classTokenPattern.test(token))) {
    unsafeOutput("Math renderer class metadata is not in the safe token grammar.");
  }

  return tokens.join(" ");
}

function isSafeNumericStyleValue(value: string) {
  const tokens = value.trim().split(/\s+/u);

  if (tokens.length < 1 || tokens.length > 4) {
    return false;
  }

  return tokens.every((token) => {
    if (!numericCssTokenPattern.test(token)) {
      return false;
    }

    const numeric = Number.parseFloat(token);
    return Number.isFinite(numeric) && Math.abs(numeric) <= 100_000;
  });
}

function sanitizeStyle(value: string) {
  if (
    value.length > 4_096
    || /[\u0000-\u001f\u007f\\{}()"'@!]/u.test(value)
    || /(?:url|expression|var|import|behavior|binding)\s*/iu.test(value)
  ) {
    unsafeOutput("Math renderer inline style contains an unsafe construct.");
  }

  const normalized: string[] = [];

  for (const rawDeclaration of value.split(";")) {
    const declaration = rawDeclaration.trim();

    if (!declaration) {
      continue;
    }

    const separator = declaration.indexOf(":");

    if (separator <= 0 || declaration.indexOf(":", separator + 1) !== -1) {
      unsafeOutput("Math renderer inline style has an invalid declaration.");
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    let safe = false;

    if (numericStyleProperties.has(property)) {
      safe = isSafeNumericStyleValue(propertyValue);
    } else if (colorStyleProperties.has(property)) {
      safe = safeColorPattern.test(propertyValue);
    } else if (borderStyleProperties.has(property)) {
      safe = /^(?:none|solid)$/iu.test(propertyValue);
    } else if (property === "display") {
      safe = /^(?:block|inline|inline-block|none)$/u.test(propertyValue);
    } else if (property === "position") {
      safe = /^(?:relative|static)$/u.test(propertyValue);
    } else if (property === "opacity") {
      safe = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/u.test(propertyValue);
    } else if (property === "text-align") {
      safe = /^(?:center|end|left|right|start)$/u.test(propertyValue);
    } else if (property === "white-space") {
      safe = /^(?:normal|nowrap|pre)$/u.test(propertyValue);
    }

    if (!safe) {
      unsafeOutput(`Math renderer inline style property "${property}" is unsafe.`);
    }

    normalized.push(`${property}: ${propertyValue}`);
  }

  return normalized.join("; ");
}

function shouldDropAttribute(name: string) {
  return droppedPresentationAttributes.has(name)
    || name.startsWith("aria-")
    || name.startsWith("data-");
}

function copySafeAttributes(source: Element, target: Element) {
  const namespace = source.namespaceURI;

  for (const attribute of [...source.attributes]) {
    const name = attribute.name.toLowerCase();

    if (attribute.namespaceURI === XMLNS_NAMESPACE || name === "xmlns") {
      continue;
    }

    if (
      attribute.namespaceURI !== null
      || name.startsWith("on")
      || forbiddenAttributeNames.has(name)
      || name.includes(":")
    ) {
      unsafeOutput(`Math renderer attribute "${attribute.name}" is unsafe.`);
    }

    if (shouldDropAttribute(name)) {
      continue;
    }

    let value: string;

    if (name === "class") {
      value = sanitizeClass(attribute.value);
    } else if (name === "style") {
      value = sanitizeStyle(attribute.value);
    } else if (namespace === MATHML_NAMESPACE && allowedMathMlAttributes.has(name)) {
      value = attribute.value;

      if (!safeMathMlValuePattern.test(value)) {
        unsafeOutput(`Math renderer MathML attribute "${name}" has an unsafe value.`);
      }

      if (
        name === "encoding"
        && !/^(?:application\/x-tex|application\/mathml\+xml|text\/plain)$/iu.test(value)
      ) {
        unsafeOutput("Math renderer annotation encoding is not allowed.");
      }
    } else {
      unsafeOutput(`Math renderer attribute "${attribute.name}" is not allowed.`);
    }

    if (value) {
      target.setAttribute(name, value);
    }
  }
}

function createSafeElement(source: Element, ownerDocument: Document) {
  const namespace = source.namespaceURI;
  const localName = source.localName.toLowerCase();

  if (namespace === HTML_NAMESPACE) {
    if (!allowedHtmlElements.has(localName) || localName.includes("-")) {
      unsafeOutput(`Math renderer HTML element <${localName}> is not allowed.`);
    }

    return ownerDocument.createElement(localName);
  }

  if (namespace === MATHML_NAMESPACE) {
    if (!allowedMathMlElements.has(localName)) {
      unsafeOutput(`Math renderer MathML element <${localName}> is not allowed.`);
    }

    return ownerDocument.createElementNS(MATHML_NAMESPACE, localName);
  }

  unsafeOutput("Math renderer output uses an unsupported DOM namespace.");
}

/**
 * Validates and manually copies renderer DOM into a new inert fragment.
 * Event listeners, expando properties, custom prototypes, and later mutations
 * of the renderer-owned tree can never cross this boundary.
 */
export function sanitizeMathRendererOutput(
  output: unknown,
  ownerDocument: Document,
): DocumentFragment {
  const ownerWindow = ownerDocument.defaultView;

  if (!ownerWindow || !(output instanceof ownerWindow.Node)) {
    const possibleOwner = typeof output === "object" && output !== null
      && "ownerDocument" in output
      ? (output as { ownerDocument?: unknown }).ownerDocument
      : undefined;

    if (possibleOwner && possibleOwner !== ownerDocument) {
      throw new MathRendererOutputError(
        "wrong-document",
        "Math renderer output belongs to a different document.",
      );
    }

    invalidOutput("Math renderer must return a DOM Node or DocumentFragment.");
  }

  if (output.ownerDocument !== ownerDocument) {
    throw new MathRendererOutputError(
      "wrong-document",
      "Math renderer output belongs to a different document.",
    );
  }

  if (output.isConnected) {
    throw new MathRendererOutputError(
      "connected-output",
      "Math renderer output must be detached from the document.",
    );
  }

  const acceptedRootNodeTypes: readonly number[] = [
    ownerWindow.Node.ELEMENT_NODE,
    ownerWindow.Node.TEXT_NODE,
    ownerWindow.Node.DOCUMENT_FRAGMENT_NODE,
  ];

  if (!acceptedRootNodeTypes.includes(output.nodeType)) {
    invalidOutput("Math renderer output contains an unsupported DOM node type.");
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

  let nodeCount = 0;
  let outputBytes = 0;
  const consumeBytes = (value: string) => {
    outputBytes += utf8ByteLength(value);

    if (outputBytes > MATH_MAX_RENDERED_OUTPUT_BYTES) {
      throw new MathRendererOutputError(
        "output-byte-limit",
        "Math renderer output exceeds the safe byte limit.",
      );
    }
  };

  while (work.length > 0) {
    const current = work.pop()!;

    if (current.depth > MATH_MAX_RENDERED_DEPTH) {
      throw new MathRendererOutputError(
        "node-limit",
        "Math renderer output exceeds the safe depth limit.",
      );
    }

    if (
      current.source.ownerDocument !== ownerDocument
      || current.source.isConnected
    ) {
      throw new MathRendererOutputError(
        current.source.ownerDocument === ownerDocument
          ? "connected-output"
          : "wrong-document",
        "Math renderer output contains a connected or foreign-document node.",
      );
    }

    nodeCount += 1;

    if (nodeCount > MATH_MAX_RENDERED_NODES) {
      throw new MathRendererOutputError(
        "node-limit",
        "Math renderer output exceeds the safe node limit.",
      );
    }

    let copied: Node;

    if (current.source.nodeType === ownerWindow.Node.TEXT_NODE) {
      const text = current.source.nodeValue ?? "";
      consumeBytes(text);
      copied = ownerDocument.createTextNode(text);
    } else if (current.source.nodeType === ownerWindow.Node.ELEMENT_NODE) {
      const sourceElement = current.source as Element;
      const targetElement = createSafeElement(sourceElement, ownerDocument);
      consumeBytes(sourceElement.localName);
      copySafeAttributes(sourceElement, targetElement);

      for (const attribute of [...targetElement.attributes]) {
        consumeBytes(attribute.name);
        consumeBytes(attribute.value);
      }

      copied = targetElement;
    } else {
      invalidOutput("Math renderer output contains a non-element, non-text descendant.");
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

  return result;
}

type RenderEntry = {
  controller: AbortController | null;
  destroyed: boolean;
  diagnosticVersion: number;
  errorCode: MathRenderErrorCode | null;
  explicitRequest: boolean;
  generation: number;
  kind: MathKind;
  nearViewport: boolean;
  previewRequested: boolean;
  source: string;
  status: MathRenderStatus;
  target: MathRenderTarget;
};

function frozenSnapshot(entry: RenderEntry): MathRenderSnapshot {
  return Object.freeze({
    errorCode: entry.errorCode,
    kind: entry.kind,
    previewRequested: entry.previewRequested,
    source: entry.source,
    status: entry.status,
  });
}

export function createMathRenderManager(
  options: CreateMathRenderManagerOptions,
): MathRenderManager {
  const {
    lifecycle,
    onRenderError,
    onSourceTooLarge,
    ownerDocument,
    renderer,
  } = options;
  const ownerWindow = ownerDocument.defaultView;

  if (!ownerWindow) {
    throw new Error("Math renderer management requires a window-backed document.");
  }

  const entries = new Set<RenderEntry>();
  const entriesByDom = new Map<HTMLElement, RenderEntry>();
  const AbortControllerConstructor = ownerWindow.AbortController;
  const IntersectionObserverConstructor = ownerWindow.IntersectionObserver;
  let compositionRoot: HTMLElement | null = null;
  let destroyed = false;
  let observer: IntersectionObserver | null = null;

  const safelyReportRenderError = (failure: MathRenderFailure) => {
    try {
      onRenderError(failure);
    } catch {
      // Error observers must not destabilize the renderer lifecycle.
    }
  };

  const safelyReportSourceLimit = (event: MathSourceTooLargeEvent) => {
    try {
      onSourceTooLarge(event);
    } catch {
      // Diagnostic observers must not destabilize the renderer lifecycle.
    }
  };

  const isCurrent = (entry: RenderEntry, generation: number) => (
    !destroyed
    && !lifecycle.signal.aborted
    && !entry.destroyed
    && entry.generation === generation
    && entry.previewRequested
    && entry.target.isCurrent(entry.kind, entry.source)
  );

  const isLiveSourceGeneration = (entry: RenderEntry, generation: number) => (
    !destroyed
    && !lifecycle.signal.aborted
    && !entry.destroyed
    && entry.generation === generation
    && entry.target.isCurrent(entry.kind, entry.source)
  );

  const transition = (
    entry: RenderEntry,
    status: MathRenderStatus,
    errorCode: MathRenderErrorCode | null = null,
  ) => {
    entry.status = status;
    entry.errorCode = errorCode;
    entry.target.setRenderSnapshot(frozenSnapshot(entry));
  };

  const abortGeneration = (entry: RenderEntry, clearPreview = true) => {
    const controller = entry.controller;
    entry.controller = null;
    controller?.abort();

    if (clearPreview) {
      entry.target.clearPreview();
    }
  };

  const reportCurrentFailure = (
    entry: RenderEntry,
    generation: number,
    code: MathRenderErrorCode,
    cause: unknown,
  ) => {
    if (!isCurrent(entry, generation)) {
      return;
    }

    const controller = entry.controller;
    entry.controller = null;
    controller?.abort();
    entry.target.clearPreview();
    transition(entry, "error", code);
    safelyReportRenderError(Object.freeze({ cause, code, kind: entry.kind }));
  };

  const scheduler = createMarkdownRenderScheduler({ ownerWindow, maxConcurrent: MATH_MAX_CONCURRENT_RENDERS });
  const startJob = (entry: RenderEntry, generation: number, explicit: boolean, controller: AbortController) => {

    if (!renderer || !isCurrent(entry, generation)) {
      return;
    }

    if (
      entry.target.isComposing()
      || (
        entry.kind === "block"
        && !entry.nearViewport
        && !(explicit && !observer)
      )
    ) {
      entry.explicitRequest ||= explicit;
      transition(entry, entry.kind === "block" && !entry.nearViewport
        ? "offscreen"
        : "queued");
      return;
    }

    transition(entry, "rendering");
    let result: unknown;

    try {
      result = renderer(Object.freeze({
        kind: entry.kind,
        ownerDocument,
        signal: controller.signal,
        source: entry.source,
      }));
    } catch (cause) {
      reportCurrentFailure(entry, generation, "renderer-failed", cause);
      return;
    }

    return Promise.resolve(result).then(
      (output) => {
        if (!isCurrent(entry, generation) || controller.signal.aborted) {
          return;
        }

        let approved: DocumentFragment;

        try {
          approved = sanitizeMathRendererOutput(output, ownerDocument);
        } catch (cause) {
          const code = cause instanceof MathRendererOutputError
            ? cause.code
            : "invalid-output";
          reportCurrentFailure(entry, generation, code, cause);
          return;
        }

        if (!isCurrent(entry, generation) || controller.signal.aborted) {
          return;
        }

        try {
          entry.target.commitPreview(approved);
        } catch (cause) {
          reportCurrentFailure(entry, generation, "renderer-failed", cause);
          return;
        }

        if (isCurrent(entry, generation) && !controller.signal.aborted) {
          transition(entry, "rendered");
        }
      },
      (cause) => {
        reportCurrentFailure(entry, generation, "renderer-failed", cause);
      },
    );
  };

  const enqueue = (entry: RenderEntry, explicit: boolean) => {
    if (entry.destroyed || destroyed) {
      return false;
    }

    if (sourceIsTooLarge(entry.source)) {
      transition(entry, "source-too-large");
      const generation = entry.generation;

      if (entry.diagnosticVersion !== generation) {
        entry.diagnosticVersion = generation;
        ownerWindow.setTimeout(() => {
          if (
            isLiveSourceGeneration(entry, generation)
            && entry.status === "source-too-large"
          ) {
            safelyReportSourceLimit(Object.freeze({
              kind: entry.kind,
              maxBytes: MATH_MAX_SOURCE_BYTES,
              source: entry.source,
            }));
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
        safelyReportRenderError(Object.freeze({
          cause: new Error("No math renderer is configured."),
          code: "renderer-missing",
          kind: entry.kind,
        }));
      } else {
        entry.previewRequested = false;
        transition(entry, "source");
      }

      return explicit;
    }

    if (entry.kind === "block" && !entry.nearViewport && !(explicit && !observer)) {
      entry.explicitRequest ||= explicit;
      transition(entry, "offscreen");
      return true;
    }

    entry.controller?.abort();
    const controller = new AbortControllerConstructor();
    entry.controller = controller;
    const generation = entry.generation;
    entry.explicitRequest = false;
    transition(entry, "queued");
    scheduler.enqueue({
      signal: controller.signal,
      priority: explicit ? "high" : "normal",
      isCurrent: () => isCurrent(entry, generation),
      run: () => startJob(entry, generation, explicit, controller),
      onError: cause => reportCurrentFailure(entry, generation, "renderer-failed", cause),
    });
    return true;
  };

  const restart = (entry: RenderEntry, explicit: boolean) => {
    entry.generation += 1;
    abortGeneration(entry);
    return enqueue(entry, explicit);
  };

  const setNearViewport = (entry: RenderEntry, nearViewport: boolean) => {
    if (entry.destroyed || entry.kind !== "block" || entry.nearViewport === nearViewport) {
      return;
    }

    entry.nearViewport = nearViewport;

    if (!entry.previewRequested || sourceIsTooLarge(entry.source)) {
      return;
    }

    if (nearViewport) {
      if (entry.status !== "rendered") {
        restart(entry, entry.explicitRequest);
      }
      return;
    }

    if (["queued", "rendering"].includes(entry.status)) {
      entry.generation += 1;
      abortGeneration(entry);
      transition(entry, "offscreen");
    }
  };

  if (typeof IntersectionObserverConstructor === "function") {
    try {
      observer = new IntersectionObserverConstructor((observations) => {
        for (const observation of observations) {
          const entry = entriesByDom.get(observation.target as HTMLElement);

          if (entry) {
            setNearViewport(entry, observation.isIntersecting);
          }
        }
      }, {
        root: null,
        rootMargin: MATH_VIEWPORT_MARGIN,
        threshold: 0,
      });
    } catch {
      observer = null;
    }
  }

  const handleCompositionEnd = () => {
    ownerWindow.queueMicrotask(() => {
      if (destroyed) {
        return;
      }

      for (const entry of entries) {
        if (
          entry.previewRequested
          && !entry.destroyed
          && !entry.target.isComposing()
          && entry.status === "queued"
        ) {
          enqueue(entry, entry.explicitRequest);
        }
      }

    });
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    scheduler.destroy();
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
    entriesByDom.clear();


  };

  const handleLifecycleAbort = () => destroy();
  lifecycle.signal.addEventListener("abort", handleLifecycleAbort, { once: true });
  lifecycle.addCleanup(() => {
    lifecycle.signal.removeEventListener("abort", handleLifecycleAbort);
    destroy();
  });

  return Object.freeze({
    destroy,
    invalidateAll() {
      if (destroyed) {
        return;
      }

      for (const entry of entries) {
        if (!entry.destroyed && entry.previewRequested) {
          restart(entry, false);
        }
      }
    },
    register(target, kind, source) {
      if (destroyed || lifecycle.signal.aborted) {
        throw new Error("Cannot register a math NodeView after renderer teardown.");
      }

      const entry: RenderEntry = {
        controller: null,
        destroyed: false,
        diagnosticVersion: -1,
        errorCode: null,
        explicitRequest: false,
        generation: 1,
        kind,
        nearViewport: kind === "inline",
        previewRequested: Boolean(renderer),
        source,
        status: "source",
        target,
      };
      entries.add(entry);
      entriesByDom.set(target.dom, entry);

      if (!compositionRoot) {
        compositionRoot = target.viewDom;
        compositionRoot.addEventListener("compositionend", handleCompositionEnd);
      }

      if (kind === "block") {
        observer?.observe(target.dom);
      }

      if (sourceIsTooLarge(source)) {
        entry.previewRequested = Boolean(renderer);
        enqueue(entry, false);
      } else if (renderer) {
        enqueue(entry, false);
      } else {
        transition(entry, "source");
      }

      let registrationDestroyed = false;
      const registration: MathRenderRegistration = Object.freeze({
        destroy() {
          if (registrationDestroyed) {
            return;
          }

          registrationDestroyed = true;
          entry.destroyed = true;
          entry.generation += 1;
          observer?.unobserve(target.dom);
          abortGeneration(entry);
          entries.delete(entry);
          entriesByDom.delete(target.dom);
        },
        invalidate() {
          if (entry.destroyed || !entry.previewRequested) {
            return false;
          }

          restart(entry, false);
          return true;
        },
        retry() {
          if (
            entry.destroyed
            || entry.status === "source-too-large"
            || (entry.status !== "error" && entry.status !== "offscreen")
          ) {
            return false;
          }

          entry.previewRequested = true;
          restart(entry, true);
          return true;
        },
        setNearViewport(nearViewport) {
          setNearViewport(entry, nearViewport);
        },
        snapshot: () => frozenSnapshot(entry),
        sync(nextKind, nextSource) {
          if (
            entry.destroyed
            || (entry.kind === nextKind && entry.source === nextSource)
          ) {
            return false;
          }

          if (entry.kind === "block" && nextKind !== "block") {
            observer?.unobserve(target.dom);
          } else if (entry.kind !== "block" && nextKind === "block") {
            observer?.observe(target.dom);
          }

          if (entry.kind !== nextKind) entry.nearViewport = nextKind === "inline";
          entry.kind = nextKind;
          entry.source = nextSource;
          entry.diagnosticVersion = -1;
          entry.generation += 1;
          abortGeneration(entry);

          if (entry.previewRequested || sourceIsTooLarge(nextSource)) {
            enqueue(entry, false);
          } else {
            transition(entry, "source");
          }

          return true;
        },
        togglePreview() {
          if (entry.destroyed) {
            return false;
          }

          if (entry.previewRequested) {
            entry.previewRequested = false;
            entry.generation += 1;
            abortGeneration(entry);
            if (sourceIsTooLarge(entry.source)) {
              enqueue(entry, false);
            } else {
              transition(entry, "source");
            }
            return true;
          }

          entry.previewRequested = true;
          restart(entry, true);
          return true;
        },
      });

      return registration;
    },
  });
}
