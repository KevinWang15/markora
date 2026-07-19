import { afterEach, describe, expect, it, vi } from "vitest";
import { HTML_MAX_SOURCE_BYTES } from "../src/source";
import {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HtmlRendererOutputError,
  createHtmlRenderManager,
  sanitizeHtmlRendererOutput,
  type HtmlRenderer,
  type HtmlRenderSnapshot,
  type HtmlRenderTarget,
} from "../src/renderer";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
}>;

type RenderFailure = Readonly<{
  cause: unknown;
  code: string;
}>;

const rendererCleanups: Array<() => void> = [];

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
}

function testLifecycle() {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    controller.abort();

    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      cleanups[index]!();
    }
  };
  rendererCleanups.push(destroy);

  return {
    destroy,
    scope: Object.freeze({
      signal: controller.signal,
      addCleanup(cleanup: () => void) {
        cleanups.push(cleanup);
      },
    }),
  };
}

function renderTarget(initialSource: string) {
  const viewDom = document.createElement("div");
  const dom = document.createElement("div");
  const preview = document.createElement("div");
  dom.append(preview);
  viewDom.append(dom);
  let currentSource = initialSource;
  let composing = false;
  const commits: string[] = [];
  const snapshots: HtmlRenderSnapshot[] = [];
  const target: HtmlRenderTarget = {
    dom,
    viewDom,
    clearPreview() {
      preview.replaceChildren();
    },
    commitPreview(fragment) {
      preview.replaceChildren(fragment);
      commits.push(preview.textContent ?? "");
    },
    isComposing: () => composing,
    isCurrent: (source) => source === currentSource,
    setRenderSnapshot(next) {
      snapshots.push(next);
    },
  };

  return {
    commits,
    dom,
    preview,
    snapshots,
    target,
    viewDom,
    setComposing(next: boolean) {
      composing = next;
    },
    setCurrent(source: string) {
      currentSource = source;
    },
  };
}

function renderedText(value: string) {
  const output = document.createElement("p");
  output.textContent = value;
  return output;
}

function renderManager(renderer?: HtmlRenderer) {
  // jsdom currently has no IntersectionObserver. Keep the focused manager
  // contract deterministic if that changes in a future test environment.
  vi.stubGlobal("IntersectionObserver", undefined);
  const lifecycle = testLifecycle();
  const errors: RenderFailure[] = [];
  const sourceLimits: Array<Readonly<{ maxBytes: number; source: string }>> = [];
  const manager = createHtmlRenderManager({
    lifecycle: lifecycle.scope,
    onRenderError: (failure) => errors.push(failure),
    onSourceTooLarge: (event) => sourceLimits.push(event),
    ownerDocument: document,
    renderer,
  });

  return { errors, lifecycle, manager, sourceLimits };
}

function expectRendererOutputError(output: unknown, code: string) {
  try {
    sanitizeHtmlRendererOutput(output, document);
  } catch (error) {
    expect(error).toBeInstanceOf(HtmlRendererOutputError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected HTML renderer output to fail with ${code}.`);
}

function elementWithAttribute(
  name: string,
  value: string,
  namespace?: string,
) {
  const element = document.createElement("span");
  if (namespace) {
    element.setAttributeNS(namespace, name, value);
  } else {
    element.setAttribute(name, value);
  }
  return element;
}

afterEach(() => {
  while (rendererCleanups.length > 0) {
    rendererCleanups.pop()?.();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HTML renderer output boundary", () => {
  it("manually copies a static allowlisted tree without renderer identity or behavior", () => {
    const listener = vi.fn();
    const source = document.createElement("article");
    source.dir = "rtl";
    source.lang = "zh-Hans";
    source.title = "Safe renderer title";
    source.className = "host-owned-class";
    source.id = "document-clobber";
    source.style.cssText = "position: fixed; background: url(https://example.test/leak)";
    source.dataset.secret = "renderer metadata";
    source.setAttribute("aria-label", "renderer label");
    source.setAttribute("contenteditable", "true");
    source.addEventListener("click", listener);
    (source as HTMLElement & { rendererSecret?: string }).rendererSecret = "secret";

    const heading = document.createElement("h2");
    heading.textContent = "Safe preview";
    const table = document.createElement("table");
    const row = document.createElement("tr");
    const header = document.createElement("th");
    header.colSpan = 2;
    header.rowSpan = 3;
    header.scope = "colgroup";
    header.textContent = "Header";
    row.append(header);
    table.append(row);
    const list = document.createElement("ol");
    list.start = -4;
    list.reversed = true;
    list.type = "I";
    const item = document.createElement("li");
    item.value = 9;
    item.append("Item");
    list.append(item);
    source.append(heading, table, list);

    const approved = sanitizeHtmlRendererOutput(source, document);
    const copy = approved.firstElementChild as HTMLElement;
    const copiedHeader = copy.querySelector("th")!;
    const copiedList = copy.querySelector("ol")!;

    expect(copy).not.toBe(source);
    expect(copy.ownerDocument).toBe(document);
    expect(copy.localName).toBe("article");
    expect(copy.dir).toBe("rtl");
    expect(copy.lang).toBe("zh-Hans");
    expect(copy.title).toBe("Safe renderer title");
    expect(copy.getAttribute("class")).toBeNull();
    expect(copy.getAttribute("id")).toBeNull();
    expect(copy.getAttribute("style")).toBeNull();
    expect(copy.getAttribute("data-secret")).toBeNull();
    expect(copy.getAttribute("aria-label")).toBeNull();
    expect(copy.getAttribute("contenteditable")).toBeNull();
    expect(copiedHeader.getAttribute("colspan")).toBe("2");
    expect(copiedHeader.getAttribute("rowspan")).toBe("3");
    expect(copiedHeader.getAttribute("scope")).toBe("colgroup");
    expect(copiedList.getAttribute("start")).toBe("-4");
    expect(copiedList.hasAttribute("reversed")).toBe(true);
    expect(copiedList.getAttribute("type")).toBe("I");
    expect(copy.querySelector("li")?.getAttribute("value")).toBe("9");
    expect((copy as HTMLElement & { rendererSecret?: string }).rendererSecret)
      .toBeUndefined();

    copy.click();
    expect(listener).not.toHaveBeenCalled();
    source.replaceChildren("mutated after approval");
    expect(copy.textContent).toBe("Safe previewHeaderItem");
  });

  it.each([
    ["script", () => document.createElement("script")],
    ["style", () => document.createElement("style")],
    ["template with hidden active content", () => {
      const template = document.createElement("template");
      template.innerHTML = "<script>globalThis.executed = true</script>";
      return template;
    }],
    ["iframe", () => document.createElement("iframe")],
    ["object", () => document.createElement("object")],
    ["embed", () => document.createElement("embed")],
    ["base", () => document.createElement("base")],
    ["meta", () => document.createElement("meta")],
    ["link", () => document.createElement("link")],
    ["form", () => document.createElement("form")],
    ["active form control", () => document.createElement("input")],
    ["image", () => document.createElement("img")],
    ["media", () => document.createElement("video")],
    ["custom element", () => document.createElement("html-preview")],
    ["SVG namespace", () => document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    )],
    ["MathML namespace", () => document.createElementNS(
      "http://www.w3.org/1998/Math/MathML",
      "math",
    )],
  ] as const)("rejects the hostile %s element", (_label, createOutput) => {
    expectRendererOutputError(createOutput(), "unsafe-output");
  });

  it.each([
    ["event handler", () => elementWithAttribute("onclick", "alert(1)")],
    ["mixed-case event handler", () => elementWithAttribute("onLoAd", "alert(1)")],
    ["javascript href", () => elementWithAttribute("href", "javascript:alert(1)")],
    ["network src", () => elementWithAttribute("src", "https://example.test/leak")],
    ["srcset", () => elementWithAttribute("srcset", "https://example.test/a 1x")],
    ["srcdoc", () => elementWithAttribute("srcdoc", "<script>alert(1)</script>")],
    ["DOM-clobbering name", () => elementWithAttribute("name", "__proto__")],
    ["XML namespace declaration", () => elementWithAttribute("xmlns", "urn:hostile")],
    ["colon-spelled xlink URL", () => elementWithAttribute("xlink:href", "#escape")],
    ["namespaced xlink URL", () => elementWithAttribute(
      "xlink:href",
      "#escape",
      "http://www.w3.org/1999/xlink",
    )],
    ["unknown attribute", () => elementWithAttribute("popover", "manual")],
    ["invalid direction", () => elementWithAttribute("dir", "sideways")],
    ["invalid language", () => elementWithAttribute("lang", "en<script>")],
    ["control-bearing title", () => elementWithAttribute("title", "bad\u0001value")],
    ["invalid table span", () => {
      const cell = document.createElement("td");
      cell.setAttribute("colspan", "0");
      return cell;
    }],
  ] as const)("rejects the hostile %s attribute", (_label, createOutput) => {
    expectRendererOutputError(createOutput(), "unsafe-output");
  });

  it("drops presentation and renderer metadata instead of copying it", () => {
    const source = document.createElement("div");
    source.className = "host-style";
    source.id = "host-id";
    source.hidden = true;
    source.inert = true;
    source.setAttribute("style", "position: fixed");
    source.setAttribute("role", "button");
    source.setAttribute("tabindex", "0");
    source.setAttribute("aria-live", "assertive");
    source.setAttribute("data-host", "secret");
    source.append("safe text");

    const approved = sanitizeHtmlRendererOutput(source, document);
    const copy = approved.firstElementChild!;

    expect(copy.textContent).toBe("safe text");
    expect([...copy.attributes]).toEqual([]);
  });

  it.each([
    ["an HTML string", () => "<p>not DOM</p>", "invalid-output"],
    ["null", () => null, "invalid-output"],
    ["a comment", () => document.createComment("comment"), "invalid-output"],
    ["a ShadowRoot", () => document.createElement("div").attachShadow({ mode: "open" }), "invalid-output"],
    ["a foreign-document node", () => (
      document.implementation.createHTMLDocument("foreign").createElement("p")
    ), "wrong-document"],
    ["an already-connected node", () => {
      const output = document.createElement("p");
      document.body.append(output);
      return output;
    }, "connected-output"],
  ] as const)("rejects %s with %s", (_label, createOutput, code) => {
    expectRendererOutputError(createOutput(), code);
  });

  it("enforces node, depth, byte, and per-element attribute limits", () => {
    const tooManyNodes = document.createDocumentFragment();
    for (let index = 0; index <= HTML_MAX_RENDERED_NODES; index += 1) {
      tooManyNodes.append(document.createTextNode(""));
    }
    expectRendererOutputError(tooManyNodes, "node-limit");

    const tooDeep = document.createElement("div");
    let parent = tooDeep;
    for (let depth = 1; depth <= HTML_MAX_RENDERED_DEPTH; depth += 1) {
      const child = document.createElement("div");
      parent.append(child);
      parent = child;
    }
    expectRendererOutputError(tooDeep, "node-limit");

    expectRendererOutputError(
      document.createTextNode("x".repeat(HTML_MAX_RENDERED_OUTPUT_BYTES + 1)),
      "output-byte-limit",
    );

    const tooManyAttributes = document.createElement("div");
    for (let index = 0; index <= HTML_MAX_ATTRIBUTES_PER_ELEMENT; index += 1) {
      tooManyAttributes.setAttribute(`data-renderer-${index}`, String(index));
    }
    expectRendererOutputError(tooManyAttributes, "node-limit");
  });
});

describe("HTML render manager", () => {
  it("schedules outside registration and commits only the manually copied tree", async () => {
    const requests: Array<Parameters<HtmlRenderer>[0]> = [];
    let rendererOutput: HTMLElement | null = null;
    const renderer: HtmlRenderer = vi.fn((request) => {
      requests.push(request);
      rendererOutput = renderedText(`rendered:${request.source}`);
      rendererOutput.className = "renderer-class";
      return rendererOutput;
    });
    const { manager } = renderManager(renderer);
    const view = renderTarget("<p>x</p>");
    const registration = manager.register(view.target, "<p>x</p>");

    expect(renderer).not.toHaveBeenCalled();
    expect(registration.getSnapshot().status).toBe("queued");
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "html-block",
      ownerDocument: document,
      source: "<p>x</p>",
    });
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(requests[0]?.signal.aborted).toBe(false);
    expect(view.preview.textContent).toBe("rendered:<p>x</p>");
    expect(view.preview.firstElementChild).not.toBe(rendererOutput);
    expect(view.preview.firstElementChild?.getAttribute("class")).toBeNull();
    expect(view.commits).toEqual(["rendered:<p>x</p>"]);
    expect(Object.isFrozen(registration.getSnapshot())).toBe(true);
  });

  it.each([
    ["a synchronous renderer failure", () => {
      throw new Error("sync failure");
    }, "renderer-failed"],
    ["a rejected renderer", () => Promise.reject(new Error("async failure")), "renderer-failed"],
    ["a string result", () => "<p>not DOM</p>", "invalid-output"],
    ["unsafe DOM", () => document.createElement("script"), "unsafe-output"],
  ] as const)("fails closed for %s", async (_label, render, code) => {
    const renderer = vi.fn(render) as unknown as HtmlRenderer;
    const { errors, manager } = renderManager(renderer);
    const view = renderTarget("<p>x</p>");
    const registration = manager.register(view.target, "<p>x</p>");

    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("error"));
    expect(registration.getSnapshot().errorCode).toBe(code);
    expect(errors.map((failure) => failure.code)).toEqual([code]);
    expect(view.preview.childNodes).toHaveLength(0);
    expect(view.commits).toEqual([]);
  });

  it("aborts stale generations and ignores late results after update and teardown", async () => {
    const invocations: Array<Readonly<{
      request: Parameters<HtmlRenderer>[0];
      task: Deferred<Node>;
    }>> = [];
    const renderer: HtmlRenderer = (request) => {
      const task = deferred<Node>();
      invocations.push({ request, task });
      return task.promise;
    };
    const harness = renderManager(renderer);
    const view = renderTarget("<p>x</p>");
    const registration = harness.manager.register(view.target, "<p>x</p>");

    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    view.setCurrent("<p>y</p>");
    registration.update("<p>y</p>");
    expect(invocations[0]?.request.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(invocations).toHaveLength(2));

    invocations[0]!.task.resolve(renderedText("stale x"));
    invocations[1]!.task.resolve(renderedText("current y"));
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
    expect(view.commits).toEqual(["current y"]);
    expect(view.preview.textContent).toBe("current y");

    view.setCurrent("<p>z</p>");
    registration.update("<p>z</p>");
    await vi.waitFor(() => expect(invocations).toHaveLength(3));
    harness.manager.destroy();
    expect(invocations[2]?.request.signal.aborted).toBe(true);
    invocations[2]!.task.resolve(renderedText("late z"));
    await Promise.resolve();
    await Promise.resolve();

    expect(view.commits).toEqual(["current y"]);
    expect(view.preview.childNodes).toHaveLength(0);
    expect(harness.errors).toEqual([]);
  });

  it("aborts a pending generation when preview is toggled back to source", async () => {
    const task = deferred<Node>();
    let request: Parameters<HtmlRenderer>[0] | null = null;
    const renderer: HtmlRenderer = (nextRequest) => {
      request = nextRequest;
      return task.promise;
    };
    const { errors, manager } = renderManager(renderer);
    const view = renderTarget("<p>x</p>");
    const registration = manager.register(view.target, "<p>x</p>");

    await vi.waitFor(() => expect(request).not.toBeNull());
    expect(registration.toggle()).toBe(true);
    expect(request!.signal.aborted).toBe(true);
    expect(registration.getSnapshot()).toMatchObject({
      errorCode: null,
      previewRequested: false,
      status: "source",
    });
    task.resolve(renderedText("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.commits).toEqual([]);
    expect(view.preview.childNodes).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("caps globally active renderer calls and drains every queued preview", async () => {
    const jobs: Array<Readonly<{ task: Deferred<Node> }>> = [];
    let active = 0;
    let maximumActive = 0;
    const renderer: HtmlRenderer = () => {
      const task = deferred<Node>();
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      jobs.push({ task });
      return task.promise.finally(() => {
        active -= 1;
      });
    };
    const { manager } = renderManager(renderer);
    const registrations = Array.from(
      { length: HTML_MAX_CONCURRENT_RENDERS * 2 },
      (_, index) => {
        const source = `<p>${index}</p>`;
        const view = renderTarget(source);
        return manager.register(view.target, source);
      },
    );

    await vi.waitFor(() => expect(jobs).toHaveLength(HTML_MAX_CONCURRENT_RENDERS));
    expect(active).toBe(HTML_MAX_CONCURRENT_RENDERS);
    for (const { task } of jobs.slice(0, HTML_MAX_CONCURRENT_RENDERS)) {
      task.resolve(renderedText("first"));
    }
    await vi.waitFor(() => expect(jobs).toHaveLength(HTML_MAX_CONCURRENT_RENDERS * 2));
    expect(maximumActive).toBe(HTML_MAX_CONCURRENT_RENDERS);
    for (const { task } of jobs.slice(HTML_MAX_CONCURRENT_RENDERS)) {
      task.resolve(renderedText("second"));
    }
    await vi.waitFor(() => {
      expect(registrations.every(({ getSnapshot }) => getSnapshot().status === "rendered"))
        .toBe(true);
    });
    expect(active).toBe(0);
  });

  it("defers work during composition and suppresses oversized source", async () => {
    const renderer: HtmlRenderer = vi.fn(({ source }) => renderedText(source));
    const compositionHarness = renderManager(renderer);
    const composing = renderTarget("<p>x</p>");
    composing.setComposing(true);
    const compositionRegistration = compositionHarness.manager.register(
      composing.target,
      "<p>x</p>",
    );

    await Promise.resolve();
    expect(compositionRegistration.getSnapshot().status).toBe("queued");
    expect(renderer).not.toHaveBeenCalled();
    composing.setComposing(false);
    composing.viewDom.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.waitFor(() => expect(compositionRegistration.getSnapshot().status).toBe("rendered"));

    const limitRenderer: HtmlRenderer = vi.fn(({ source }) => renderedText(source));
    const limitHarness = renderManager(limitRenderer);
    const large = "x".repeat(HTML_MAX_SOURCE_BYTES + 1);
    const oversized = renderTarget(large);
    const limitRegistration = limitHarness.manager.register(oversized.target, large);

    expect(limitRegistration.getSnapshot().status).toBe("source-too-large");
    await vi.waitFor(() => expect(limitHarness.sourceLimits).toHaveLength(1));
    expect(limitHarness.sourceLimits[0]).toEqual({
      maxBytes: HTML_MAX_SOURCE_BYTES,
      source: large,
    });
    expect(limitRenderer).not.toHaveBeenCalled();
  });

  it("defers a resolved preview when composition starts during rendering", async () => {
    const jobs: Deferred<Node>[] = [];
    const renderer: HtmlRenderer = () => {
      const job = deferred<Node>();
      jobs.push(job);
      return job.promise;
    };
    const { manager } = renderManager(renderer);
    const view = renderTarget("<p>x</p>");
    const registration = manager.register(view.target, "<p>x</p>");

    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    view.setComposing(true);
    jobs[0]!.resolve(renderedText("must defer"));
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("queued"));
    expect(view.commits).toEqual([]);

    view.setComposing(false);
    view.viewDom.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.waitFor(() => expect(jobs).toHaveLength(2));
    jobs[1]!.resolve(renderedText("after composition"));
    await vi.waitFor(() => expect(registration.getSnapshot().status).toBe("rendered"));
    expect(view.commits).toEqual(["after composition"]);
  });

  it("stays source-first without a renderer and reports only explicit requests", () => {
    const { errors, manager } = renderManager();
    const view = renderTarget("<p>x</p>");
    const registration = manager.register(view.target, "<p>x</p>");

    expect(registration.getSnapshot()).toEqual({
      errorCode: null,
      previewRequested: false,
      source: "<p>x</p>",
      status: "source",
    });
    expect(registration.toggle()).toBe(true);
    expect(registration.getSnapshot()).toMatchObject({
      errorCode: "renderer-missing",
      previewRequested: true,
      status: "error",
    });
    expect(errors.map(({ code }) => code)).toEqual(["renderer-missing"]);
    expect(registration.retry()).toBe(true);
    expect(errors.map(({ code }) => code)).toEqual([
      "renderer-missing",
      "renderer-missing",
    ]);
    expect(registration.toggle()).toBe(true);
    expect(registration.getSnapshot()).toMatchObject({
      errorCode: null,
      previewRequested: false,
      status: "source",
    });
  });
});
