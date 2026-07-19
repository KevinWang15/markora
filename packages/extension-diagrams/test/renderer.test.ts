import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DiagramRendererOutputError,
  createDiagramRenderManager,
  sanitizeDiagramRendererOutput,
  type DiagramRenderTarget,
  type DiagramRenderer,
  type InternalDiagramRenderSnapshot,
} from "../src/renderer";
import type { DiagramKind } from "../src/source";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
}>;

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

const cleanups: Array<() => void> = [];

function lifecycle() {
  const controller = new AbortController();
  const callbacks: Array<() => void> = [];
  const destroy = () => {
    controller.abort();
    for (let index = callbacks.length - 1; index >= 0; index -= 1) callbacks[index]!();
  };
  cleanups.push(destroy);
  return {
    destroy,
    scope: Object.freeze({
      signal: controller.signal,
      addCleanup(callback: () => void) { callbacks.push(callback); },
    }),
  };
}

function renderTarget(kind: DiagramKind, info: string, source: string) {
  const viewDom = document.createElement("div");
  const dom = document.createElement("div");
  const preview = document.createElement("div");
  dom.append(preview);
  viewDom.append(dom);
  let current = { kind, info, source };
  let composing = false;
  const commits: string[] = [];
  const snapshots: InternalDiagramRenderSnapshot[] = [];
  const target: DiagramRenderTarget = {
    dom,
    viewDom,
    clearPreview: () => preview.replaceChildren(),
    commitPreview(fragment) {
      preview.replaceChildren(fragment);
      commits.push(preview.textContent ?? "");
    },
    isComposing: () => composing,
    isCurrent: (nextKind, nextInfo, nextSource) => (
      nextKind === current.kind && nextInfo === current.info && nextSource === current.source
    ),
    setRenderSnapshot: (snapshot) => snapshots.push(snapshot),
  };
  return {
    commits,
    dom,
    preview,
    snapshots,
    target,
    viewDom,
    setComposing(value: boolean) { composing = value; },
    setCurrent(nextKind: DiagramKind, nextInfo: string, nextSource: string) {
      current = { kind: nextKind, info: nextInfo, source: nextSource };
    },
  };
}

function manager(renderers: Readonly<Partial<Record<DiagramKind, DiagramRenderer>>>) {
  const activeLifecycle = lifecycle();
  const errors: Array<Readonly<{ code: string; kind: DiagramKind }>> = [];
  const limits: unknown[] = [];
  const instance = createDiagramRenderManager({
    lifecycle: activeLifecycle.scope,
    onRenderError: (failure) => errors.push(failure),
    onSourceTooLarge: (event) => limits.push(event),
    ownerDocument: document,
    renderers,
  });
  return { activeLifecycle, errors, instance, limits };
}

function textOutput(value: string) {
  const element = document.createElement("div");
  element.textContent = value;
  return element;
}

function expectOutputError(output: unknown, code: string) {
  try {
    sanitizeDiagramRendererOutput(output, document);
  } catch (error) {
    expect(error).toBeInstanceOf(DiagramRendererOutputError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected diagram renderer output to fail with ${code}.`);
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("diagram DOM clamp", () => {
  it("accepts a realistic Mermaid-shaped static SVG and scopes IDs/references per clone", () => {
    const makeSvg = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 40");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.setAttribute("class", "flowchart mermaid");
      svg.setAttribute("style", "max-width: 100%; height: auto");
      svg.setAttribute("aria-labelledby", "diagram-title");
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.id = "diagram-title";
      title.textContent = "Flow chart";
      const defs = document.createElementNS(svg.namespaceURI, "defs");
      const marker = document.createElementNS(svg.namespaceURI, "marker");
      marker.id = "arrowhead";
      marker.setAttribute("markerWidth", "10");
      marker.setAttribute("markerHeight", "10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("orient", "auto");
      const markerPath = document.createElementNS(svg.namespaceURI, "path");
      markerPath.setAttribute("d", "M0 0 L10 5 L0 10 z");
      marker.append(markerPath);
      defs.append(marker);
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.id = "edge-1";
      path.setAttribute("d", "M0 20 L100 20");
      path.setAttribute("marker-end", "url(#arrowhead)");
      svg.append(title, defs, path);
      return svg;
    };

    const first = sanitizeDiagramRendererOutput(makeSvg(), document);
    const second = sanitizeDiagramRendererOutput(makeSvg(), document);
    const firstSvg = first.querySelector("svg")!;
    const secondSvg = second.querySelector("svg")!;
    const firstMarker = first.querySelector("marker")!;
    const secondMarker = second.querySelector("marker")!;

    expect(firstSvg.getAttribute("viewBox")).toBe("0 0 100 40");
    expect(firstSvg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(firstMarker.getAttribute("markerWidth")).toBe("10");
    expect(firstSvg.getAttribute("aria-labelledby")).toBe(first.querySelector("title")!.id);
    expect(first.querySelector("path[marker-end]")?.getAttribute("marker-end"))
      .toBe(`url(#${firstMarker.id})`);
    expect(firstMarker.id).not.toBe(secondMarker.id);
    expect(first.textContent).toBe(second.textContent);
  });

  it("allows local SVG use but rejects unresolved and external references", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.id = "shape";
    path.setAttribute("d", "M0 0 L1 1");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#shape");
    svg.append(path, use);
    const safe = sanitizeDiagramRendererOutput(svg, document);
    expect(safe.querySelector("use")?.getAttribute("href"))
      .toBe(`#${safe.querySelector("path")!.id}`);

    for (const href of ["#missing", "https://example.com/a.svg#shape", "javascript:alert(1)"]) {
      const hostile = svg.cloneNode(true) as SVGElement;
      hostile.querySelector("use")!.setAttribute("href", href);
      expectOutputError(hostile, "unsafe-output");
    }
  });

  it.each(["script", "foreignObject", "style", "animate", "iframe", "img", "form"])(
    "rejects active or network-capable <%s>",
    (name) => {
      const namespace = ["iframe", "img", "form"].includes(name)
        ? "http://www.w3.org/1999/xhtml"
        : "http://www.w3.org/2000/svg";
      expectOutputError(document.createElementNS(namespace, name), "unsafe-output");
    },
  );

  it("rejects events, external CSS URLs, duplicate IDs, connected and foreign nodes", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("onclick", "alert(1)");
    expectOutputError(svg, "unsafe-output");
    svg.removeAttribute("onclick");
    svg.setAttribute("style", "fill: url(https://example.com/x)");
    expectOutputError(svg, "unsafe-output");
    svg.setAttribute("style", "fill: var(--host-controlled-paint)");
    expectOutputError(svg, "unsafe-output");
    svg.removeAttribute("style");
    svg.setAttribute("fill", "var(--host-controlled-paint)");
    expectOutputError(svg, "unsafe-output");

    const duplicate = document.createElementNS(svg.namespaceURI, "svg");
    for (let index = 0; index < 2; index += 1) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.id = "same";
      duplicate.append(path);
    }
    expectOutputError(duplicate, "unsafe-output");

    const connected = document.createElement("div");
    document.body.append(connected);
    expectOutputError(connected, "connected-output");
    const foreign = document.implementation.createHTMLDocument().createElement("div");
    expectOutputError(foreign, "wrong-document");
    expectOutputError("<svg></svg>", "invalid-output");
  });

  it("bounds node count and depth during the pre-scan", () => {
    const tooMany = document.createDocumentFragment();
    for (let index = 0; index <= DIAGRAM_MAX_RENDERED_NODES; index += 1) {
      tooMany.append(document.createElement("span"));
    }
    expectOutputError(tooMany, "node-limit");

    const root = document.createElement("div");
    let cursor = root;
    for (let depth = 1; depth <= DIAGRAM_MAX_RENDERED_DEPTH; depth += 1) {
      const child = document.createElement("span");
      cursor.append(child);
      cursor = child;
    }
    expectOutputError(root, "node-limit");
  });

  it("enforces the published per-element attribute and rendered-byte limits", () => {
    const acceptedAttributes = document.createElement("span");
    for (let index = 0; index < DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT; index += 1) {
      acceptedAttributes.setAttribute(`data-limit-${index}`, String(index));
    }
    expect(() => sanitizeDiagramRendererOutput(acceptedAttributes, document))
      .not.toThrow();

    const attributes = document.createElement("span");
    for (let index = 0; index <= DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT; index += 1) {
      attributes.setAttribute(`data-limit-${index}`, String(index));
    }
    expectOutputError(attributes, "node-limit");

    const acceptedBytes = document.createElement("div");
    acceptedBytes.textContent = "x".repeat(
      DIAGRAM_MAX_RENDERED_OUTPUT_BYTES - "div".length,
    );
    expect(() => sanitizeDiagramRendererOutput(acceptedBytes, document))
      .not.toThrow();

    const bytes = document.createElement("div");
    bytes.textContent = "x".repeat(
      DIAGRAM_MAX_RENDERED_OUTPUT_BYTES - "div".length + 1,
    );
    expectOutputError(bytes, "output-byte-limit");
  });
});

describe("diagram render manager", () => {
  it("routes immutable complete requests to the configured kind renderer", async () => {
    const renderer = vi.fn(({ kind, info, source, ownerDocument }) => {
      const output = ownerDocument.createElement("div");
      output.textContent = `${kind}:${info}:${source}`;
      return output;
    });
    const harness = manager({ mermaid: renderer });
    const view = renderTarget("mermaid", "mermaid theme=dark", "graph TD");
    const registration = harness.instance.register(view.target, "mermaid", "mermaid theme=dark", "graph TD");
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
    expect(view.commits).toEqual(["mermaid:mermaid theme=dark:graph TD"]);
    expect(Object.isFrozen(renderer.mock.calls[0]![0])).toBe(true);
  });

  it("reports a missing per-kind renderer only after explicit preview request", () => {
    const harness = manager({ mermaid: () => textOutput("ok") });
    const view = renderTarget("geojson", "geojson", "{}");
    const registration = harness.instance.register(view.target, "geojson", "geojson", "{}");
    expect(registration.getSnapshot().status).toBe("source");
    expect(harness.errors).toEqual([]);
    expect(registration.toggle()).toBe(true);
    expect(registration.getSnapshot()).toMatchObject({ errorCode: "renderer-missing", status: "error" });
    expect(harness.errors).toEqual([expect.objectContaining({ code: "renderer-missing", kind: "geojson" })]);
  });

  it("suppresses stale success/failure after update and teardown", async () => {
    const calls: Array<Deferred<Node>> = [];
    const harness = manager({ mermaid: () => {
      const task = deferred<Node>();
      calls.push(task);
      return task.promise;
    } });
    const view = renderTarget("mermaid", "mermaid", "old");
    const registration = harness.instance.register(view.target, "mermaid", "mermaid", "old");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    view.setCurrent("mermaid", "mermaid", "new");
    registration.update("mermaid", "mermaid", "new");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[0]!.resolve(textOutput("stale"));
    calls[1]!.resolve(textOutput("current"));
    await vi.waitFor(() => expect(view.commits).toEqual(["current"]));
    registration.destroy();
    await expect(calls[0]!.promise).resolves.toBeDefined();
  });

  it("aborts each renderer signal on source update and registration destroy", async () => {
    const tasks: Deferred<Node>[] = [];
    const signals: AbortSignal[] = [];
    const harness = manager({ mermaid: ({ signal }) => {
      signals.push(signal);
      const task = deferred<Node>();
      tasks.push(task);
      return task.promise;
    } });
    const view = renderTarget("mermaid", "mermaid", "old");
    const registration = harness.instance.register(view.target, "mermaid", "mermaid", "old");
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    view.setCurrent("mermaid", "mermaid", "new");
    registration.update("mermaid", "mermaid", "new");
    expect(signals[0]!.aborted).toBe(true);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    registration.destroy();
    expect(signals[1]!.aborted).toBe(true);
  });

  it("preserves a user-disabled preview across source and kind updates", async () => {
    const renderer: DiagramRenderer = ({ source }) => textOutput(source);
    const harness = manager({ mermaid: renderer, geojson: renderer });
    const view = renderTarget("mermaid", "mermaid", "old");
    const registration = harness.instance.register(view.target, "mermaid", "mermaid", "old");
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
    expect(registration.toggle()).toBe(true);
    expect(registration.getSnapshot().previewRequested).toBe(false);
    view.setCurrent("geojson", "geojson", "new");
    registration.update("geojson", "geojson", "new");
    expect(registration.getSnapshot()).toMatchObject({ previewRequested: false, status: "source" });
  });

  it("makes retry a no-op outside error/offscreen and for over-limit source", async () => {
    const harness = manager({ mermaid: () => textOutput("ok") });
    const view = renderTarget("mermaid", "mermaid", "x");
    const registration = harness.instance.register(view.target, "mermaid", "mermaid", "x");
    expect(registration.retry()).toBe(false);
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
    expect(registration.retry()).toBe(false);

    const largeView = renderTarget("mermaid", "mermaid", "x".repeat(262_145));
    const large = harness.instance.register(largeView.target, "mermaid", "mermaid", "x".repeat(262_145));
    expect(large.getSnapshot().status).toBe("source-too-large");
    expect(large.retry()).toBe(false);
  });

  it("releases all four invocation slots immediately when never-settling work is aborted", async () => {
    const tasks: Deferred<Node>[] = [];
    const renderer: DiagramRenderer = () => {
      const task = deferred<Node>();
      tasks.push(task);
      return task.promise;
    };
    const harness = manager({ mermaid: renderer });
    const registrations = Array.from({ length: DIAGRAM_MAX_CONCURRENT_RENDERS }, (_, index) => {
      const view = renderTarget("mermaid", "mermaid", `old-${index}`);
      const registration = harness.instance.register(view.target, "mermaid", "mermaid", `old-${index}`);
      return { registration, view };
    });
    await vi.waitFor(() => expect(tasks).toHaveLength(DIAGRAM_MAX_CONCURRENT_RENDERS));
    for (const [index, { registration, view }] of registrations.entries()) {
      view.setCurrent("mermaid", "mermaid", `new-${index}`);
      registration.update("mermaid", "mermaid", `new-${index}`);
    }
    await vi.waitFor(() => expect(tasks.length).toBeGreaterThan(DIAGRAM_MAX_CONCURRENT_RENDERS));
    for (const { registration } of registrations) registration.destroy();
  });

  it("defers renderer work during composition and resumes after compositionend", async () => {
    const renderer = vi.fn(() => textOutput("ok"));
    const harness = manager({ mermaid: renderer });
    const view = renderTarget("mermaid", "mermaid", "x");
    view.setComposing(true);
    const registration = harness.instance.register(view.target, "mermaid", "mermaid", "x");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(renderer).not.toHaveBeenCalled();
    expect(registration.getSnapshot().status).toBe("queued");
    view.setComposing(false);
    view.viewDom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
  });
});
