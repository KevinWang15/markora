import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as createRootEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import {
  NodeSelection,
  type Node as ProseMirrorNode,
} from "markora/extension-api";
import { createFootnotesExtension } from "../../extension-footnotes/src/index";
import {
  createMathExtension,
  defaultMathMessages,
  mathDiagnosticCodes,
  mathKinds,
  mathRenderErrorCodes,
  type MathEditRequest,
  type MathExtension,
  type MathKind,
  type MathNodeSnapshot,
  type MathRenderer,
} from "../src/index";
import {
  MATH_MAX_SOURCE_BYTES,
  canonicalBlockMath,
  canonicalInlineMath,
  createMathNodeIdentityIndex,
  isValidBlockMathSource,
  isValidInlineMathSource,
  mapMathNodeIdentityIndex,
  matchInlineMathAt,
  normalizeMathSource,
} from "../src/source";
import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MathRendererOutputError,
  createMathRenderManager,
  sanitizeMathRendererOutput,
  type MathRenderSnapshot as ManagedMathRenderSnapshot,
  type MathRenderTarget,
} from "../src/renderer";
import { analyzeInlineMathSource } from "../src/tokenizer";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;
const editors: MarkdownEditor[] = [];
const rendererCleanups: Array<() => void> = [];

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

function testLifecycle() {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let destroyed = false;
  const destroy = () => {
    if (destroyed) {
      return;
    }

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

function renderTarget(initialKind: MathKind, initialSource: string) {
  const viewDom = document.createElement("div");
  const dom = document.createElement(initialKind === "inline" ? "span" : "div");
  const preview = document.createElement("span");
  dom.append(preview);
  viewDom.append(dom);
  let currentKind = initialKind;
  let currentSource = initialSource;
  let composing = false;
  let compositionReads = 0;
  const commits: string[] = [];
  const snapshots: ManagedMathRenderSnapshot[] = [];
  const target: MathRenderTarget = {
    dom,
    preview,
    viewDom,
    clearPreview() {
      preview.replaceChildren();
    },
    commitPreview(fragment) {
      preview.replaceChildren(fragment);
      commits.push(preview.textContent ?? "");
    },
    isComposing: () => {
      compositionReads += 1;
      return composing;
    },
    isCurrent: (kind, source) => kind === currentKind && source === currentSource,
    setRenderSnapshot(next) {
      snapshots.push(next);
    },
  };

  return {
    commits,
    compositionReads: () => compositionReads,
    preview,
    snapshots,
    target,
    viewDom,
    setComposing(next: boolean) {
      composing = next;
    },
    setCurrent(kind: MathKind, source: string) {
      currentKind = kind;
      currentSource = source;
    },
  };
}

function renderedText(value: string) {
  const element = document.createElement("span");
  element.className = "katex";
  element.textContent = value;
  return element;
}

function renderManager(renderer?: MathRenderer) {
  const lifecycle = testLifecycle();
  const errors: Array<Readonly<{
    cause: unknown;
    code: string;
    kind: MathKind;
  }>> = [];
  const sourceLimits: Array<Readonly<{
    kind: MathKind;
    maxBytes: number;
    source: string;
  }>> = [];
  const manager = createMathRenderManager({
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
    sanitizeMathRendererOutput(output, document);
  } catch (error) {
    expect(error).toBeInstanceOf(MathRendererOutputError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected renderer output to fail with ${code}.`);
}

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function mathNodes(editor: MarkdownEditor, kind?: MathKind) {
  const nodes: Array<Readonly<{
    node: ProseMirrorNode;
    position: number;
  }>> = [];

  editor.view.state.doc.descendants((node, position) => {
    if (
      node.type.name === (kind === "inline" ? "math_inline" : "math_block")
      || (kind === undefined && (node.type.name === "math_inline" || node.type.name === "math_block"))
    ) {
      nodes.push({ node, position });
    }
  });
  return nodes;
}

function snapshot(editor: MarkdownEditor, extension: MathExtension) {
  return editor.extensions.get(extension).state.getSnapshot();
}

function expectCanonicalFixedPoint(
  createEditor: typeof createRootEditor | typeof createMinimalEditor,
  markdown: string,
) {
  const firstExtension = createMathExtension();
  const first = track(createEditor({
    element: host(),
    extensions: [firstExtension],
    markdown,
  }));
  const canonical = first.getMarkdown();
  const firstSnapshot = snapshot(first, firstExtension);
  const secondExtension = createMathExtension();
  const second = track(createEditor({
    element: host(),
    extensions: [secondExtension],
    markdown: canonical,
  }));

  expect(second.getMarkdown()).toBe(canonical);
  expect(snapshot(second, secondExtension).nodes.map(({ kind, source }) => ({ kind, source })))
    .toEqual(firstSnapshot.nodes.map(({ kind, source }) => ({ kind, source })));
  return { canonical, first, firstExtension };
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  while (rendererCleanups.length > 0) {
    rendererCleanups.pop()?.();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("math source grammar", () => {
  it("accepts only canonical single-dollar inline payloads", () => {
    expect(isValidInlineMathSource("x + y")).toBe(true);
    expect(isValidInlineMathSource("\\$ + x")).toBe(true);
    expect(canonicalInlineMath("\\$ + x")).toBe("$\\$ + x$");

    for (const source of [
      "",
      " x",
      "x ",
      "x\ny",
      "x\ry",
      "x$+y",
      "x\\\\$+y",
    ]) {
      expect(isValidInlineMathSource(source), source).toBe(false);
    }

    expect(() => canonicalInlineMath("x$+y")).toThrow(/canonical single-dollar/);
  });

  it("enforces ASCII adjacency and odd-even escape parity", () => {
    const accepted = [
      "$x$",
      "($x$)",
      "é$x$文",
      "\\\\$x$",
    ];
    const rejected = [
      "a$x$",
      "$x$b",
      "$ x$",
      "$x $",
      "\\$x$",
      "$$x$$",
      "$x",
    ];

    for (const source of accepted) {
      const start = source.indexOf("$");
      expect(matchInlineMathAt(source, start), source).not.toBeNull();
    }

    for (const source of rejected) {
      const start = source.indexOf("$");
      expect(matchInlineMathAt(source, start), source).toBeNull();
    }
  });

  it("gives code, HTML, and math ranges to the earliest valid opener", () => {
    const cases = [
      ["$`math$ after`", [{ start: 0, end: 7, source: "`math" }]],
      ["`code $not$` $yes$", [{ start: 13, end: 18, source: "yes" }]],
      ["$<span>math$ after</span>", [{ start: 0, end: 12, source: "<span>math" }]],
      ["<span>$not$</span> $yes$", [{ start: 19, end: 24, source: "yes" }]],
      ["<!-- $not$ --> $yes$", [{ start: 15, end: 20, source: "yes" }]],
    ] as const;

    for (const [source, ranges] of cases) {
      expect(analyzeInlineMathSource(source), source).toEqual(ranges);
    }
  });

  it("normalizes canonical block data without permitting an embedded closer", () => {
    expect(normalizeMathSource("x\r\ny\rz\0")).toBe("x\ny\nz�");
    expect(isValidBlockMathSource("")).toBe(true);
    expect(isValidBlockMathSource("x\n\ny")).toBe(true);
    expect(isValidBlockMathSource("x\r\ny")).toBe(false);
    expect(isValidBlockMathSource("x\n  $$\ny")).toBe(false);
    expect(canonicalBlockMath("")).toBe("$$\n\n$$");
    expect(canonicalBlockMath("x\n\ny")).toBe("$$\nx\n\ny\n$$");
    expect(() => canonicalBlockMath("x\n$$\ny")).toThrow(/standalone/);
    expect(MATH_MAX_SOURCE_BYTES).toBe(65_536);
  });
});

describe("math renderer output boundary", () => {
  it("copies only inert allowlisted HTML and MathML into a fresh fragment", () => {
    const listener = vi.fn();
    const source = document.createElement("span");
    source.className = "katex math-output";
    source.setAttribute("style", "color: red; font-size: 12px");
    source.setAttribute("aria-label", "renderer-owned label");
    source.setAttribute("data-secret", "renderer-owned metadata");
    source.setAttribute("contenteditable", "true");
    source.addEventListener("click", listener);
    (source as HTMLElement & { rendererSecret?: string }).rendererSecret = "secret";
    const math = document.createElementNS(
      "http://www.w3.org/1998/Math/MathML",
      "math",
    );
    math.setAttribute("display", "block");
    const identifier = document.createElementNS(
      "http://www.w3.org/1998/Math/MathML",
      "mi",
    );
    identifier.textContent = "x";
    math.append(identifier);
    source.append(math);

    const approved = sanitizeMathRendererOutput(source, document);
    const copy = approved.firstElementChild as HTMLElement;

    expect(copy).not.toBe(source);
    expect(copy.outerHTML).toBe(
      '<span class="katex math-output" style="color: red; font-size: 12px">'
      + '<math display="block"><mi>x</mi></math></span>',
    );
    expect((copy as HTMLElement & { rendererSecret?: string }).rendererSecret)
      .toBeUndefined();
    copy.click();
    expect(listener).not.toHaveBeenCalled();
    source.replaceChildren("mutated");
    expect(copy.textContent).toBe("x");
  });

  it.each([
    ["an HTML string", () => "<span>x</span>", "invalid-output"],
    ["a comment", () => document.createComment("x"), "invalid-output"],
    ["a script element", () => document.createElement("script"), "unsafe-output"],
    ["an image element", () => document.createElement("img"), "unsafe-output"],
    ["an active form control", () => document.createElement("input"), "unsafe-output"],
    ["a custom element", () => document.createElement("math-preview"), "unsafe-output"],
    ["an SVG subtree", () => document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ), "unsafe-output"],
    ["an event handler", () => {
      const element = document.createElement("span");
      element.setAttribute("onclick", "alert(1)");
      return element;
    }, "unsafe-output"],
    ["a URL-bearing attribute", () => {
      const element = document.createElement("span");
      element.setAttribute("href", "javascript:alert(1)");
      return element;
    }, "unsafe-output"],
    ["a URL-bearing style", () => {
      const element = document.createElement("span");
      element.setAttribute("style", "background: url(https://example.test/a)");
      return element;
    }, "unsafe-output"],
    ["a foreign-document node", () => (
      document.implementation.createHTMLDocument().createElement("span")
    ), "wrong-document"],
    ["an already-connected node", () => {
      const element = document.createElement("span");
      document.body.append(element);
      return element;
    }, "connected-output"],
  ] as const)("rejects %s", (_label, createOutput, code) => {
    expectRendererOutputError(createOutput(), code);
  });

  it("enforces rendered node and byte limits before committing output", () => {
    const nodes = document.createDocumentFragment();
    for (let index = 0; index <= MATH_MAX_RENDERED_NODES; index += 1) {
      nodes.append(document.createTextNode(""));
    }
    expectRendererOutputError(nodes, "node-limit");

    const bytes = document.createTextNode(
      "x".repeat(MATH_MAX_RENDERED_OUTPUT_BYTES + 1),
    );
    expectRendererOutputError(bytes, "output-byte-limit");
  });
});

describe("math render manager", () => {
  it("stays source-first without a renderer and reports explicit preview requests", () => {
    const { errors, manager } = renderManager();
    const view = renderTarget("inline", "x");
    const registration = manager.register(view.target, "inline", "x");

    expect(registration.snapshot()).toEqual({
      errorCode: null,
      kind: "inline",
      previewRequested: false,
      source: "x",
      status: "source",
    });
    expect(registration.togglePreview()).toBe(true);
    expect(registration.snapshot()).toMatchObject({
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
    expect(registration.togglePreview()).toBe(true);
    expect(registration.snapshot()).toMatchObject({
      errorCode: null,
      previewRequested: false,
      status: "source",
    });
  });

  it("schedules rendering outside registration and commits a sanitized copy", async () => {
    let rendererOutput: HTMLElement | null = null;
    const requests: Array<Parameters<MathRenderer>[0]> = [];
    const renderer: MathRenderer = vi.fn((request) => {
      requests.push(request);
      rendererOutput = renderedText(`rendered:${request.source}`);
      return rendererOutput;
    });
    const { manager } = renderManager(renderer);
    const view = renderTarget("inline", "x");
    const registration = manager.register(view.target, "inline", "x");

    expect(renderer).not.toHaveBeenCalled();
    expect(registration.snapshot().status).toBe("queued");
    await vi.waitFor(() => expect(registration.snapshot().status).toBe("rendered"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "inline",
      ownerDocument: document,
      source: "x",
    });
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(requests[0]?.signal.aborted).toBe(false);
    expect(view.preview.textContent).toBe("rendered:x");
    expect(view.preview.firstElementChild).not.toBe(rendererOutput);
    expect(view.commits).toEqual(["rendered:x"]);
    expect(Object.isFrozen(registration.snapshot())).toBe(true);
  });

  it.each([
    ["a synchronous renderer failure", () => {
      throw new Error("sync failure");
    }, "renderer-failed"],
    ["a rejected renderer", () => Promise.reject(new Error("async failure")), "renderer-failed"],
    ["a non-DOM result", () => "<span>x</span>", "invalid-output"],
    ["unsafe DOM", () => document.createElement("script"), "unsafe-output"],
  ] as const)("surfaces %s without replacing source", async (_label, run, code) => {
    const renderer = vi.fn(run) as unknown as MathRenderer;
    const { errors, manager } = renderManager(renderer);
    const view = renderTarget("inline", "x");
    const registration = manager.register(view.target, "inline", "x");

    await vi.waitFor(() => expect(registration.snapshot().status).toBe("error"));
    expect(registration.snapshot().errorCode).toBe(code);
    expect(errors.map((failure) => failure.code)).toEqual([code]);
    expect(view.preview.childNodes).toHaveLength(0);
    expect(view.commits).toEqual([]);
  });

  it("retries a failed generation with a fresh abort signal", async () => {
    const requests: Array<Parameters<MathRenderer>[0]> = [];
    let fail = true;
    const renderer: MathRenderer = (request) => {
      requests.push(request);
      if (fail) {
        throw new Error("temporary failure");
      }
      return renderedText(request.source);
    };
    const { errors, manager } = renderManager(renderer);
    const view = renderTarget("inline", "x");
    const registration = manager.register(view.target, "inline", "x");

    await vi.waitFor(() => expect(registration.snapshot().status).toBe("error"));
    expect(requests[0]?.signal.aborted).toBe(true);
    fail = false;
    expect(registration.retry()).toBe(true);
    await vi.waitFor(() => expect(registration.snapshot().status).toBe("rendered"));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.signal).not.toBe(requests[0]?.signal);
    expect(requests[1]?.signal.aborted).toBe(false);
    expect(errors.map(({ code }) => code)).toEqual(["renderer-failed"]);
    expect(view.preview.textContent).toBe("x");
  });

  it("aborts stale work and ignores every late result after sync or teardown", async () => {
    const invocations: Array<Readonly<{
      request: Parameters<MathRenderer>[0];
      task: Deferred<Node>;
    }>> = [];
    const errors: string[] = [];
    const renderer: MathRenderer = (request) => {
      const task = deferred<Node>();
      invocations.push({ request, task });
      return task.promise;
    };
    const harness = renderManager(renderer);
    const view = renderTarget("inline", "x");
    const registration = harness.manager.register(view.target, "inline", "x");

    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    view.setCurrent("inline", "y");
    expect(registration.sync("inline", "y")).toBe(true);
    expect(invocations[0]?.request.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(invocations).toHaveLength(2));
    invocations[0]!.task.resolve(renderedText("stale-x"));
    invocations[1]!.task.resolve(renderedText("current-y"));
    await vi.waitFor(() => expect(registration.snapshot().status).toBe("rendered"));

    expect(view.commits).toEqual(["current-y"]);
    expect(view.preview.textContent).toBe("current-y");
    view.setCurrent("inline", "z");
    expect(registration.sync("inline", "z")).toBe(true);
    await vi.waitFor(() => expect(invocations).toHaveLength(3));
    harness.manager.destroy();
    expect(invocations[2]?.request.signal.aborted).toBe(true);
    invocations[2]!.task.resolve(renderedText("late-z"));
    await Promise.resolve();
    await Promise.resolve();
    errors.push(...harness.errors.map(({ code }) => code));
    expect(view.commits).toEqual(["current-y"]);
    expect(view.preview.childNodes).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("caps globally active renderer calls and drains queued work", async () => {
    const jobs: Array<Readonly<{ task: Deferred<Node> }>> = [];
    let active = 0;
    let maximumActive = 0;
    const renderer: MathRenderer = () => {
      const task = deferred<Node>();
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      jobs.push({ task });
      return task.promise.finally(() => {
        active -= 1;
      });
    };
    const { manager } = renderManager(renderer);
    const registrations = Array.from({ length: MATH_MAX_CONCURRENT_RENDERS * 2 }, (_, index) => {
      const source = `x${index}`;
      const view = renderTarget("inline", source);
      return manager.register(view.target, "inline", source);
    });

    await vi.waitFor(() => expect(jobs).toHaveLength(MATH_MAX_CONCURRENT_RENDERS));
    expect(active).toBe(MATH_MAX_CONCURRENT_RENDERS);
    for (const { task } of jobs.slice(0, MATH_MAX_CONCURRENT_RENDERS)) {
      task.resolve(renderedText("first"));
    }
    await vi.waitFor(() => expect(jobs).toHaveLength(MATH_MAX_CONCURRENT_RENDERS * 2));
    expect(maximumActive).toBe(MATH_MAX_CONCURRENT_RENDERS);
    for (const { task } of jobs.slice(MATH_MAX_CONCURRENT_RENDERS)) {
      task.resolve(renderedText("second"));
    }
    await vi.waitFor(() => {
      expect(registrations.every(({ snapshot: read }) => read().status === "rendered"))
        .toBe(true);
    });
    expect(active).toBe(0);
  });

  it("checks shared editor composition in linear work while draining many nodes", async () => {
    const renderer: MathRenderer = ({ source }) => renderedText(source);
    const { manager } = renderManager(renderer);
    const count = 32;
    const views = Array.from({ length: count }, (_, index) => (
      renderTarget("inline", `x${index}`)
    ));
    const registrations = views.map((view, index) => (
      manager.register(view.target, "inline", `x${index}`)
    ));

    await vi.waitFor(() => {
      expect(registrations.every(({ snapshot: read }) => read().status === "rendered"))
        .toBe(true);
    });
    expect(views.reduce((total, view) => total + view.compositionReads(), 0))
      .toBeLessThanOrEqual(count * 4);
  });

  it("gates block rendering by viewport proximity", async () => {
    const renderer: MathRenderer = vi.fn(({ source }) => renderedText(source));
    const { manager } = renderManager(renderer);
    const view = renderTarget("block", "x");
    const registration = manager.register(view.target, "block", "x");

    expect(registration.snapshot().status).toBe("offscreen");
    expect(renderer).not.toHaveBeenCalled();
    registration.setNearViewport(true);
    await vi.waitFor(() => expect(registration.snapshot().status).toBe("rendered"));
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("keeps visible display math visible when its source changes", async () => {
    const { manager } = renderManager(({ source }) => renderedText(source));
    const view = renderTarget("block", "x");
    const registration = manager.register(view.target, "block", "x");
    registration.setNearViewport(true);
    await vi.waitFor(() => expect(registration.snapshot().status).toBe("rendered"));
    view.setCurrent("block", "y");
    registration.sync("block", "y");
    await vi.waitFor(() => expect(view.preview.textContent).toBe("y"));
    expect(registration.snapshot().status).toBe("rendered");
  });

  it("defers composition work and suppresses oversized source", async () => {
    const renderer: MathRenderer = vi.fn(({ source }) => renderedText(source));
    const compositionHarness = renderManager(renderer);
    const composing = renderTarget("inline", "x");
    composing.setComposing(true);
    const compositionRegistration = compositionHarness.manager.register(
      composing.target,
      "inline",
      "x",
    );
    await Promise.resolve();
    expect(compositionRegistration.snapshot().status).toBe("queued");
    expect(renderer).not.toHaveBeenCalled();
    composing.setComposing(false);
    composing.viewDom.dispatchEvent(new CompositionEvent("compositionend"));
    await vi.waitFor(() => expect(compositionRegistration.snapshot().status).toBe("rendered"));

    const limitHarness = renderManager(renderer);
    const large = "x".repeat(MATH_MAX_SOURCE_BYTES + 1);
    const oversized = renderTarget("inline", large);
    const limitRegistration = limitHarness.manager.register(
      oversized.target,
      "inline",
      large,
    );
    expect(limitRegistration.snapshot().status).toBe("source-too-large");
    await vi.waitFor(() => expect(limitHarness.sourceLimits).toHaveLength(1));
    expect(limitHarness.sourceLimits[0]).toMatchObject({
      kind: "inline",
      maxBytes: MATH_MAX_SOURCE_BYTES,
      source: large,
    });
    expect(renderer).toHaveBeenCalledTimes(1);
  });
});

describe("math target identity index", () => {
  it("maps a large unrelated edit without rebuilding unchanged math snapshots", () => {
    const extension = createMathExtension();
    const editor = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "$x$",
        ...Array.from({ length: 256 }, (_, index) => `Paragraph ${index}.`),
      ].join("\n\n"),
    }));
    const { schema } = editor.view.state;
    const types = {
      block: schema.nodes.math_block!,
      code: schema.marks.code!,
      inline: schema.nodes.math_inline!,
    };
    const previous = createMathNodeIdentityIndex(editor.view.state.doc, types);
    const original = [...previous.values()][0]!;
    const transaction = editor.view.state.tr.insertText(
      "!",
      editor.view.state.doc.content.size - 1,
    );
    const mapped = mapMathNodeIdentityIndex(transaction, types, previous);

    expect(mapped.size).toBe(1);
    expect([...mapped.values()][0]).toBe(original);
  });
});

describe.each(entries)("%s math renderer integration", (_entry, createEditor) => {
  it("does not repaint unchanged math UI for unrelated document edits", async () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$\n\nBody",
    }));
    const marker = editor.view.dom.querySelector<HTMLElement>("[data-mdw-math]")!;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((next) => records.push(...next));
    observer.observe(marker, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    editor.view.dispatch(editor.view.state.tr.insertText(
      "!",
      editor.view.state.doc.content.size - 1,
    ));
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(editor.getMarkdown()).toBe("$x$\n\nBody!");
    expect(records).toEqual([]);
  });

  it("keeps live previews outside Markdown, clipboard, and source accessibility", async () => {
    const requests: Array<Parameters<MathRenderer>[0]> = [];
    const outputs: HTMLElement[] = [];
    const renderer: MathRenderer = vi.fn((request) => {
      requests.push(request);
      const output = renderedText(`preview:${request.source}`);
      outputs.push(output);
      return output;
    });
    const extension = createMathExtension({ renderer });
    const markdown = "Before $x$ after.\n\n$$\ny\n$$";
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown,
    }));
    const handle = editor.extensions.get(extension);
    const inline = handle.state.getNodes("inline")[0]!;
    const block = handle.state.getNodes("block")[0]!;

    expect(renderer).not.toHaveBeenCalled();
    expect(inline.render).toMatchObject({ enabled: true, status: "queued" });
    expect(block.render).toMatchObject({ enabled: true, status: "offscreen" });
    await vi.waitFor(() => {
      expect(handle.state.getRenderState(inline)?.status).toBe("rendered");
    });

    const marker = editor.view.dom.querySelector<HTMLElement>(
      '[data-mdw-math-kind="inline"]',
    )!;
    const preview = marker.querySelector<HTMLElement>("[data-mdw-math-preview]")!;
    expect(marker.dataset.mdwMathState).toBe("rendered");
    expect(marker.getAttribute("role")).toBe("group");
    expect(marker.getAttribute("aria-label")).toBe("Inline math");
    expect(marker.querySelector("[data-mdw-math-source]")?.textContent).toBe("$x$");
    const accessibleSource = marker.querySelector(".mdw-math__sr-source");
    expect(accessibleSource?.getAttribute("role")).toBe("math");
    expect(accessibleSource?.getAttribute("aria-label")).toBe("Inline math source: x");
    expect(accessibleSource?.textContent).toBe("$x$");
    expect(preview.textContent).toBe("preview:x");
    expect(preview.firstElementChild).not.toBe(outputs[0]);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(requests[0]).toMatchObject({
      kind: "inline",
      ownerDocument: editor.view.dom.ownerDocument,
      source: "x",
    });

    editor.view.dispatch(editor.view.state.tr.setSelection(
      NodeSelection.create(editor.view.state.doc, inline.position),
    ));
    const copied = editor.view.serializeForClipboard(
      editor.view.state.selection.content(),
    );
    expect(copied.text).toBe("$x$");
    expect(copied.dom.textContent).not.toContain("preview:x");
    expect(copied.dom.querySelector("[data-mdw-math-preview], button")).toBeNull();

    expect(handle.commands.togglePreview(block)).toBe(true);
    expect(handle.state.getRenderState(block)).toMatchObject({
      enabled: false,
      status: "source",
    });
    expect(handle.commands.togglePreview(block)).toBe(true);
    await vi.waitFor(() => {
      expect(handle.state.getRenderState(block)?.status).toBe("rendered");
    });
    expect(requests.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: "inline", source: "x" },
      { kind: "block", source: "y" },
    ]);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("reports failures, retries, and toggles with fresh renderer generations", async () => {
    const requests: Array<Parameters<MathRenderer>[0]> = [];
    const errors: Array<{ code?: string }> = [];
    let fail = true;
    const renderer: MathRenderer = (request) => {
      requests.push(request);
      if (fail) {
        throw new Error("temporary renderer failure");
      }
      return renderedText(`ok:${request.source}`);
    };
    const extension = createMathExtension({ renderer });
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$",
    }));
    editor.subscribe("error", (event) => errors.push(event));
    const handle = editor.extensions.get(extension);
    const target = handle.state.getNodes()[0]!;

    await vi.waitFor(() => {
      expect(handle.state.getRenderState(target)?.status).toBe("error");
    });
    expect(handle.state.getRenderState(target)).toEqual({
      enabled: true,
      errorCode: "renderer-failed",
      status: "error",
    });
    expect(errors.map(({ code }) => code)).toEqual([
      "EXTENSION_MATH_RENDERER_FAILED",
    ]);
    const marker = editor.view.dom.querySelector<HTMLElement>("[data-mdw-math]")!;
    expect(marker.querySelector<HTMLElement>(".mdw-math__source-shell")?.hidden)
      .toBe(false);
    expect(marker.querySelector<HTMLElement>("[data-mdw-math-preview]")?.hidden)
      .toBe(true);
    expect(marker.querySelector<HTMLElement>("[data-mdw-math-status]")?.textContent)
      .toBe("Math preview failed; source remains available.");
    expect(marker.querySelector<HTMLButtonElement>('[data-mdw-math-action="retry"]')?.hidden)
      .toBe(false);

    fail = false;
    expect(handle.commands.retryPreview(target)).toBe(true);
    await vi.waitFor(() => {
      expect(handle.state.getRenderState(target)?.status).toBe("rendered");
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal).not.toBe(requests[0]?.signal);
    expect(marker.querySelector("[data-mdw-math-preview]")?.textContent).toBe("ok:x");

    expect(handle.commands.togglePreview(target)).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(true);
    expect(handle.state.getRenderState(target)).toEqual({
      enabled: false,
      errorCode: null,
      status: "source",
    });
    expect(handle.commands.togglePreview(target)).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    await vi.waitFor(() => {
      expect(handle.state.getRenderState(target)?.status).toBe("rendered");
    });

    editor.updateOptions({ editable: false });
    expect(handle.commands.togglePreview(target)).toBe(false);
    editor.updateOptions({ editable: true });
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(handle.commands.togglePreview(target)).toBe(false);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });

  it("provides a localized, stale-safe, read-only host edit handoff", () => {
    const errors: Array<{ code?: string }> = [];
    const requests: MathEditRequest[] = [];
    const onEditSource = vi.fn((request: MathEditRequest) => requests.push(request));
    const extension = createMathExtension({
      messages: {
        editSource: "Edit formula",
        inlineKindLabel: "Inline formula",
        inlineSourceLabel: (source) => `Formula source: ${source}`,
      },
      onEditSource,
    });
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$",
    }));
    editor.subscribe("error", (event) => errors.push(event));
    const marker = editor.view.dom.querySelector<HTMLElement>("[data-mdw-math]")!;
    const button = marker.querySelector<HTMLButtonElement>(
      '[data-mdw-math-action="edit"]',
    )!;

    expect(marker.getAttribute("aria-label")).toBe("Inline formula");
    expect(marker.querySelector("[role=math]")?.getAttribute("aria-label"))
      .toBe("Formula source: x");
    expect(marker.querySelector(".mdw-math__kind")?.textContent).toBe("Inline formula");
    expect(button.textContent).toBe("Edit formula");
    button.click();
    expect(onEditSource).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(requests[0]).toMatchObject({
      kind: "inline",
      render: { enabled: false, errorCode: null, status: "source" },
      source: "x",
    });
    expect(requests[0]?.update("x")).toBe(true);
    expect(requests[0]?.update(" x")).toBe(false);
    expect(errors.map(({ code }) => code)).toEqual([
      "EXTENSION_MATH_INVALID_SOURCE",
    ]);
    expect(requests[0]?.update("y")).toBe(true);
    expect(requests[0]?.update(" invalid stale")).toBe(false);
    expect(requests[0]?.remove()).toBe(false);
    expect(requests[0]?.convert("block")).toBe(false);
    expect(errors).toHaveLength(1);

    button.click();
    expect(requests[1]?.source).toBe("y");
    editor.updateOptions({ editable: false });
    expect(button.disabled).toBe(true);
    button.click();
    expect(onEditSource).toHaveBeenCalledTimes(2);
    editor.updateOptions({ editable: true });
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    button.click();
    expect(onEditSource).toHaveBeenCalledTimes(2);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    expect(editor.commands.reconcileMarkdown("$z$")).toBe(true);
    expect(requests[1]?.update("stale")).toBe(false);
    const reconciledButton = editor.view.dom.querySelector<HTMLButtonElement>(
      '[data-mdw-math-action="edit"]',
    )!;
    reconciledButton.click();
    expect(requests[2]?.source).toBe("z");
    expect(requests[2]?.convert("block")).toBe(true);
    expect(requests[2]?.update("stale after convert")).toBe(false);

    const blockButton = editor.view.dom.querySelector<HTMLButtonElement>(
      '[data-mdw-math-kind="block"] [data-mdw-math-action="edit"]',
    )!;
    blockButton.click();
    expect(requests[3]).toMatchObject({ kind: "block", source: "z" });
    expect(requests[3]?.remove()).toBe(true);
    expect(requests[3]?.remove()).toBe(false);
    expect(editor.extensions.get(extension).state.getNodes()).toEqual([]);
  });
});

it("maps missing and rejected renderer output to attributed recoverable errors", async () => {
  const missingErrors: Array<{ code?: string }> = [];
  const missingExtension = createMathExtension();
  const missing = track(createRootEditor({
    element: host(),
    extensions: [missingExtension],
    markdown: "$x$",
  }));
  missing.subscribe("error", (event) => missingErrors.push(event));
  const missingHandle = missing.extensions.get(missingExtension);
  const missingTarget = missingHandle.state.getNodes()[0]!;

  expect(missingHandle.commands.togglePreview(missingTarget)).toBe(true);
  expect(missingHandle.state.getRenderState(missingTarget)).toEqual({
    enabled: true,
    errorCode: "renderer-missing",
    status: "error",
  });
  expect(missingErrors.map(({ code }) => code)).toEqual([
    "EXTENSION_MATH_RENDERER_MISSING",
  ]);

  for (const [output, renderCode, extensionCode] of [
    [() => "<span>x</span>", "invalid-output", "EXTENSION_MATH_INVALID_RENDERER_OUTPUT"],
    [() => document.createElement("script"), "unsafe-output", "EXTENSION_MATH_UNSAFE_RENDERER_OUTPUT"],
  ] as const) {
    const errors: Array<{ code?: string }> = [];
    const extension = createMathExtension({
      renderer: output as unknown as MathRenderer,
    });
    const editor = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$",
    }));
    editor.subscribe("error", (event) => errors.push(event));
    const handle = editor.extensions.get(extension);
    const target = handle.state.getNodes()[0]!;

    await vi.waitFor(() => {
      expect(handle.state.getRenderState(target)?.status).toBe("error");
    });
    expect(handle.state.getRenderState(target)?.errorCode).toBe(renderCode);
    expect(errors.map(({ code }) => code)).toEqual([extensionCode]);
    expect(editor.getMarkdown()).toBe("$x$");
  }
});

it("retains oversized source without invoking its configured renderer", async () => {
  const renderer: MathRenderer = vi.fn(({ source }) => renderedText(source));
  const errors: Array<{ code?: string }> = [];
  const large = "x".repeat(MATH_MAX_SOURCE_BYTES + 1);
  const extension = createMathExtension({ renderer });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `$$\n${large}\n$$`,
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const target = handle.state.getNodes()[0]!;

  expect(handle.state.getRenderState(target)).toEqual({
    enabled: true,
    errorCode: null,
    status: "source-too-large",
  });
  expect(renderer).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(errors.map(({ code }) => code)).toEqual([
      "EXTENSION_MATH_SOURCE_TOO_LARGE",
    ]);
  });
  expect(editor.getMarkdown()).toBe(`$$\n${large}\n$$`);
  expect(editor.view.dom.querySelector("[data-mdw-math-source]")?.textContent)
    .toBe(`$$\n${large}\n$$`);
});

it("aborts renderer generations across reconcile, reset, removal, and destruction", async () => {
  const invocations: Array<Readonly<{
    request: Parameters<MathRenderer>[0];
    task: Deferred<Node>;
  }>> = [];
  const errors: Array<{ code?: string }> = [];
  const renderer: MathRenderer = (request) => {
    const task = deferred<Node>();
    invocations.push({ request, task });
    return task.promise;
  };
  const extension = createMathExtension({ renderer });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "$x$",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);

  await vi.waitFor(() => expect(invocations).toHaveLength(1));
  expect(editor.commands.reconcileMarkdown("$y$")).toBe(true);
  expect(invocations[0]?.request.signal.aborted).toBe(true);
  await vi.waitFor(() => {
    expect(invocations.some(({ request }) => request.source === "y")).toBe(true);
  });
  const yInvocation = invocations.find(({ request }) => request.source === "y")!;
  editor.commands.resetMarkdown("$z$");
  expect(yInvocation.request.signal.aborted).toBe(true);
  await vi.waitFor(() => {
    expect(invocations.some(({ request }) => request.source === "z")).toBe(true);
  });
  const zInvocation = invocations.find(({ request }) => request.source === "z")!;
  invocations[0]!.task.resolve(renderedText("late-x"));
  yInvocation.task.resolve(renderedText("late-y"));
  zInvocation.task.resolve(renderedText("current-z"));
  const zTarget = handle.state.getNodes()[0]!;
  await vi.waitFor(() => {
    expect(handle.state.getRenderState(zTarget)?.status).toBe("rendered");
  });
  expect(editor.view.dom.querySelector("[data-mdw-math-preview]")?.textContent)
    .toBe("current-z");
  expect(handle.commands.remove(zTarget)).toBe(true);
  expect(zInvocation.request.signal.aborted).toBe(true);
  expect(handle.state.getNodes()).toEqual([]);

  expect(handle.commands.insertInline("w")).toBe(true);
  await vi.waitFor(() => {
    expect(invocations.some(({ request }) => request.source === "w")).toBe(true);
  });
  const wInvocation = invocations.find(({ request }) => request.source === "w")!;
  editor.destroy();
  expect(wInvocation.request.signal.aborted).toBe(true);
  wInvocation.task.resolve(renderedText("late-w"));
  await Promise.resolve();
  await Promise.resolve();
  expect(errors).toEqual([]);
});

describe.each(entries)("%s math codec", (_entry, createEditor) => {
  it("claims inline and both block input forms with canonical fixed-point output", () => {
    const input = [
      "Inline $x + y$.",
      "",
      "$$a+b$$",
      "",
      "$$",
      "c+d",
      "$$",
      "",
      "$$",
      "$$",
      "",
      "$$$$",
    ].join("\n");
    const { canonical, first, firstExtension } = expectCanonicalFixedPoint(
      createEditor,
      input,
    );
    const nodes = snapshot(first, firstExtension).nodes;

    expect(nodes.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: "inline", source: "x + y" },
      { kind: "block", source: "a+b" },
      { kind: "block", source: "c+d" },
      { kind: "block", source: "" },
      { kind: "block", source: "" },
    ]);
    expect(canonical).toBe([
      "Inline $x + y$.",
      "",
      "$$",
      "a+b",
      "$$",
      "",
      "$$",
      "c+d",
      "$$",
      "",
      "$$",
      "",
      "$$",
      "",
      "$$",
      "",
      "$$",
    ].join("\n"));
    expect(first.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-math",
      version: "0.0.1",
    });
    expect(first.view.dom.querySelectorAll('[data-mdw-math-kind="inline"]'))
      .toHaveLength(1);
    expect(first.view.dom.querySelectorAll('[data-mdw-math-kind="block"]'))
      .toHaveLength(4);
  });

  it("applies exact inline boundary, currency, escape, and delimiter rules", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "Good ($x$), Unicode é$u$文, and numeric $5$.",
        "Bad a$left$.",
        "Bad $right$b.",
        "Bad $ spaced$.",
        "Bad $trailing $.",
        "Bad $$double$$.",
        "Bad USD$5.",
        "Escaped \\$no$ but even \\\\$yes$.",
      ].join("\n\n"),
    }));

    expect(snapshot(editor, extension).nodes
      .filter(({ kind }) => kind === "inline")
      .map(({ source }) => source)).toEqual(["x", "u", "5", "yes"]);
    const canonical = editor.getMarkdown();
    const reparsedExtension = createMathExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));
    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedExtension).nodes.map(({ source }) => source))
      .toEqual(["x", "u", "5", "yes"]);
  });

  it("keeps code and HTML opaque according to earliest-opener ownership", () => {
    const sources = [
      ["`code $not$` then $yes$", ["yes"]],
      ["$`math$ after`", ["`math"]],
      ["<span>$not$</span> then $yes$", ["yes"]],
      ["$<span>math$ after</span>", ["<span>math"]],
      ["Before <!-- $not$ --> then $yes$", ["yes"]],
      ["\\$escaped$ then $yes$", ["yes"]],
    ] as const;

    for (const [markdown, expected] of sources) {
      const extension = createMathExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));
      expect(snapshot(editor, extension).nodes.map(({ source }) => source), markdown)
        .toEqual(expected);
      const canonical = editor.getMarkdown();
      const reparsedExtension = createMathExtension();
      const reparsed = track(createEditor({
        element: host(),
        extensions: [reparsedExtension],
        markdown: canonical,
      }));
      expect(reparsed.getMarkdown(), markdown).toBe(canonical);
    }
  });

  it("normalizes block line endings and retains nested block math", () => {
    const markdown = [
      "> $$",
      "> quoted\rline",
      "> $$",
      "",
      "* $$",
      "  listed",
      "  $$",
      "",
      "```text",
      "$$",
      "not math",
      "$$",
      "```",
      "",
      "    $$indented$$",
    ].join("\r\n");
    const { canonical, first, firstExtension } = expectCanonicalFixedPoint(
      createEditor,
      markdown,
    );

    expect(snapshot(first, firstExtension).nodes.map(({ kind, source }) => ({
      kind,
      source,
    }))).toEqual([
      { kind: "block", source: "quoted\nline" },
      { kind: "block", source: "listed" },
    ]);
    expect(canonical).toContain("> $$\n> quoted\n> line\n> $$");
    expect(canonical).toContain("* $$\n  listed\n  $$");
    expect(mathNodes(first)).toHaveLength(2);
  });

  it("keeps math-looking image descriptions literal plain alt text", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "![formula $x$ and **bold**](https://example.test/math.png)",
    }));
    const image = editor.view.state.doc.firstChild?.firstChild;

    expect(snapshot(editor, extension).nodes).toEqual([]);
    expect(image?.type.name).toBe("image");
    expect(image?.attrs.alt).toBe("formula $x$ and bold");
    const canonical = editor.getMarkdown();
    expect(canonical).toContain("formula \\$x\\$ and bold");

    const reparsedExtension = createMathExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));
    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedExtension).nodes).toEqual([]);
    expect(reparsed.view.state.doc.firstChild?.firstChild?.attrs.alt)
      .toBe("formula $x$ and bold");
  });
});

it("retains the documented absent-package distinction", () => {
  const markdown = "Inline $x$.\n\n$$\ny\n$$";
  const root = track(createRootEditor({ element: host(), markdown }));
  const minimal = track(createMinimalEditor({ element: host(), markdown }));

  expect(root.view.state.schema.nodes.math_inline).toBeUndefined();
  expect(root.view.state.schema.nodes.math_block).toBeUndefined();
  expect(root.view.state.doc.lastChild?.type.name).toBe("raw_block");
  expect(root.view.state.doc.lastChild?.attrs.kind).toBe("display-math");
  expect(root.getMarkdown()).toBe(markdown);
  expect(minimal.view.state.schema.nodes.math_inline).toBeUndefined();
  expect(minimal.view.state.schema.nodes.math_block).toBeUndefined();
  expect(minimal.view.state.schema.nodes.raw_block).toBeUndefined();
  expect(minimal.extensions.manifest.extensions.some(({ name }) => (
    name === "markora-extension-math"
  ))).toBe(false);
});

describe.each(entries)("%s math and footnotes interop", (_entry, createEditor) => {
  it.each(["math-first", "footnotes-first"] as const)(
    "is deterministic when registered $s",
    (order) => {
      const math = createMathExtension();
      const footnotes = createFootnotesExtension();
      const extensions = order === "math-first"
        ? [math, footnotes]
        : [footnotes, math];
      const editor = track(createEditor({
        element: host(),
        extensions,
        markdown: [
          "Hidden $x [^hidden]$ and visible[^shown].",
          "",
          "[^shown]: Definition with $y$.",
          "",
          "[^hidden]: Not referenced.",
        ].join("\n"),
      }));
      const footnoteSnapshot = editor.extensions.get(footnotes).state.getSnapshot();

      expect(snapshot(editor, math).nodes.map(({ source }) => source))
        .toEqual(["x [^hidden]", "y"]);
      expect(footnoteSnapshot.references.map(({ label }) => label)).toEqual(["shown"]);
      expect(footnoteSnapshot.definitions.map(({ label }) => label))
        .toEqual(["shown", "hidden"]);
      const canonical = editor.getMarkdown();
      const reparsedMath = createMathExtension();
      const reparsedFootnotes = createFootnotesExtension();
      const reparsed = track(createEditor({
        element: host(),
        extensions: order === "math-first"
          ? [reparsedMath, reparsedFootnotes]
          : [reparsedFootnotes, reparsedMath],
        markdown: canonical,
      }));
      expect(reparsed.getMarkdown()).toBe(canonical);
    },
  );

  it("flattens math and footnote syntax together inside image alt text", () => {
    const math = createMathExtension();
    const footnotes = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [footnotes, math],
      markdown: "![formula $x$ [^note]](https://example.test/a.png)\n\n[^note]: Note.",
    }));
    const image = editor.view.state.doc.firstChild?.firstChild;

    expect(snapshot(editor, math).nodes).toEqual([]);
    expect(editor.extensions.get(footnotes).state.getReferences()).toEqual([]);
    expect(image?.attrs.alt).toBe("formula $x$ [^note]");
    const canonical = editor.getMarkdown();
    expect(canonical).toContain("formula \\$x\\$ \\[^note\\]");
    const reparsedMath = createMathExtension();
    const reparsedFootnotes = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedMath, reparsedFootnotes],
      markdown: canonical,
    }));
    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedMath).nodes).toEqual([]);
    expect(reparsed.extensions.get(reparsedFootnotes).state.getReferences())
      .toEqual([]);
  });
});

describe.each(entries)("%s math commands and state", (_entry, createEditor) => {
  it("inserts, updates, converts, removes, and tracks stale targets through history", () => {
    const origins: Array<string | undefined> = [];
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "",
      onTransaction(_transaction, _view, context) {
        origins.push(context.origin);
      },
    }));
    const handle = editor.extensions.get(extension);

    expect(handle.commands.insertInline("x")).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    const inserted = handle.state.getNodes("inline")[0]!;
    expect(Object.isFrozen(inserted)).toBe(true);
    expect(inserted).toMatchObject({
      kind: "inline",
      source: "x",
      render: { enabled: false, errorCode: null, status: "source" },
    });
    expect(handle.commands.update(inserted, "x")).toBe(false);
    expect(handle.commands.update(inserted, "y")).toBe(true);
    expect(handle.state.getNode(inserted)).toBeNull();
    expect(handle.commands.update(inserted, "stale")).toBe(false);
    expect(editor.commands.undo()).toBe(true);
    expect(handle.state.getNodes("inline")[0]?.source).toBe("x");
    expect(editor.commands.redo()).toBe(true);
    expect(handle.state.getNodes("inline")[0]?.source).toBe("y");

    const updated = handle.state.getNodes("inline")[0]!;
    expect(handle.commands.convert(updated, "inline")).toBe(false);
    expect(handle.commands.convert(updated, "block")).toBe(true);
    expect(handle.state.getNodes().map(({ kind, source }) => ({ kind, source })))
      .toEqual([{ kind: "block", source: "y" }]);
    expect(editor.getMarkdown()).toBe("$$\ny\n$$");
    const block = handle.state.getNodes("block")[0]!;
    expect(handle.commands.convert(block, "inline")).toBe(true);
    const converted = handle.state.getNodes("inline")[0]!;
    expect(handle.commands.remove(converted)).toBe(true);
    expect(handle.commands.remove(converted)).toBe(false);
    expect(handle.state.getNodes()).toEqual([]);
    expect(editor.commands.undo()).toBe(true);
    expect(handle.state.getNodes("inline")).toHaveLength(1);
    expect(origins).toContain("extension:markora-extension-math");
  });

  it("does not let an identical node inherit a removed sibling's stale target", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$ $x$",
    }));
    editor.subscribe("error", () => {});
    const handle = editor.extensions.get(extension);
    const [removed, shifted] = handle.state.getNodes("inline");

    expect(removed).toBeDefined();
    expect(shifted).toBeDefined();
    editor.view.dispatch(editor.view.state.tr.delete(
      removed!.position,
      shifted!.position,
    ));

    const current = handle.state.getNodes("inline")[0]!;
    expect(current.position).toBe(removed!.position);
    expect(current.identity).toBe(shifted!.identity);
    expect(current.identity).not.toBe(removed!.identity);
    expect(editor.getMarkdown()).toBe("$x$");

    expect(handle.commands.update(removed!, "wrong")).toBe(false);
    expect(handle.commands.remove(removed!)).toBe(false);
    expect(handle.commands.convert(removed!, "block")).toBe(false);
    expect(handle.commands.togglePreview(removed!)).toBe(false);
    expect(handle.commands.retryPreview(removed!)).toBe(false);
    expect(handle.state.getNode(removed!)).toBeNull();
    expect(handle.state.getRenderState(removed!)).toBeNull();
    expect(editor.getMarkdown()).toBe("$x$");

    expect(handle.commands.togglePreview(current)).toBe(true);
    expect(handle.commands.retryPreview(current)).toBe(true);
    expect(handle.commands.update(current, "y")).toBe(true);
    expect(editor.getMarkdown()).toBe("$y$");
  });

  it("inserts and normalizes block source without discarding surrounding content", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "Body",
    }));
    const handle = editor.extensions.get(extension);

    expect(handle.commands.insertBlock("a\r\nb\rc")).toBe(true);
    expect(handle.state.getNodes("block")[0]?.source).toBe("a\nb\nc");
    expect(editor.getMarkdown()).toContain("Body");
    expect(editor.getMarkdown()).toContain("$$\na\nb\nc\n$$");
  });

  it("honors read-only, composition, no-op, and invalid-source guards", () => {
    const errors: Array<{ code?: string; error?: Error }> = [];
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "$x$",
    }));
    editor.subscribe("error", (event) => errors.push(event));
    const handle = editor.extensions.get(extension);
    const target = handle.state.getNodes()[0]!;

    expect(handle.commands.insertInline(" x")).toBe(false);
    expect(handle.commands.update(target, "x$+y")).toBe(false);
    expect(errors.map(({ code }) => code)).toEqual([
      "EXTENSION_MATH_INVALID_SOURCE",
      "EXTENSION_MATH_INVALID_SOURCE",
    ]);
    expect(() => handle.commands.insertInline(42 as never)).toThrow(/Extension command/);
    expect(() => handle.state.getNode({ kind: "inline", position: 1 } as never))
      .toThrow(/Extension state query/);

    editor.updateOptions({ editable: false });
    expect(handle.commands.update(target, "y")).toBe(false);
    expect(handle.commands.remove(target)).toBe(false);
    editor.updateOptions({ editable: true });
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(handle.commands.update(target, "z")).toBe(false);
    expect(handle.commands.remove(target)).toBe(false);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });

  it("exposes frozen oversize diagnostics while retaining source", () => {
    const large = "x".repeat(MATH_MAX_SOURCE_BYTES + 1);
    const extension = createMathExtension({
      messages: {
        sourceTooLargeDiagnostic: (maximum) => `Limit ${maximum}`,
      },
    });
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: `$$\n${large}\n$$`,
    }));
    const handle = editor.extensions.get(extension);
    const current = handle.state.getSnapshot();

    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.nodes)).toBe(true);
    expect(Object.isFrozen(current.diagnostics)).toBe(true);
    expect(current.nodes[0]?.source).toBe(large);
    expect(current.nodes[0]?.render).toEqual({
      enabled: false,
      errorCode: null,
      status: "source-too-large",
    });
    expect(current.diagnostics).toEqual([{
      code: "source-too-large",
      kind: "block",
      message: `Limit ${MATH_MAX_SOURCE_BYTES}`,
      position: current.nodes[0]!.position,
    }]);
    expect(editor.getMarkdown()).toBe(`$$\n${large}\n$$`);
  });
});

it("rejects raw transactions that make canonical math unreparseable", () => {
  const errors: Array<{ code?: string; error?: Error }> = [];
  const extension = createMathExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "a $x$\n\n$$\ny\n$$",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const inline = handle.state.getNodes("inline")[0]!;
  const block = handle.state.getNodes("block")[0]!;
  const before = editor.getMarkdown();

  editor.view.dispatch(editor.view.state.tr.delete(
    inline.position - 1,
    inline.position,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors[errors.length - 1]?.code).toBe("EXTENSION_MATH_INVALID_DOCUMENT");

  const code = editor.view.state.schema.marks.code.create();
  editor.view.dispatch(editor.view.state.tr.addMark(
    inline.position,
    inline.position + 1,
    code,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors[errors.length - 1]?.code).toBe("EXTENSION_MATH_INVALID_DOCUMENT");

  const blockNode = editor.view.state.doc.nodeAt(block.position)!;
  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
    block.position,
    blockNode.type,
    { source: "y\n$$\nz" },
    blockNode.marks,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors[errors.length - 1]?.code).toBe("EXTENSION_MATH_INVALID_DOCUMENT");
  expect(errors).toHaveLength(3);
});

it("validates math against every intermediate document in a multi-step transaction", () => {
  const errors: Array<{ code?: string }> = [];
  const extension = createMathExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `${"a".repeat(50)} $x$`,
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const inline = handle.state.getNodes("inline")[0]!;
  const before = editor.getMarkdown();
  const code = editor.view.state.schema.marks.code.create();
  const transaction = editor.view.state.tr.insertText("b".repeat(10), 1);
  const intermediatePosition = transaction.mapping.map(inline.position, 1);

  transaction.addMark(
    intermediatePosition,
    intermediatePosition + 1,
    code,
  );
  transaction.insertText("c".repeat(10), 1);
  editor.view.dispatch(transaction);

  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.code).toBe("EXTENSION_MATH_INVALID_DOCUMENT");
  expect(editor.view.state.doc.nodeAt(inline.position)?.marks)
    .not.toContainEqual(code);
});

describe.each(entries)("%s math schema and clipboard", (_entry, createEditor) => {
  it("serializes inline and block atoms as source-only semantic clipboard data", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "Before $x$ after.\n\n$$\ny\n$$",
    }));

    for (const target of snapshot(editor, extension).nodes) {
      editor.view.dispatch(editor.view.state.tr.setSelection(
        NodeSelection.create(editor.view.state.doc, target.position),
      ));
      const copied = editor.view.serializeForClipboard(
        editor.view.state.selection.content(),
      );
      const expected = target.kind === "inline" ? "$x$" : "$$\ny\n$$";
      const element = copied.dom.querySelector<HTMLElement>(
        `[data-mdw-math-kind="${target.kind}"]`,
      );

      expect(copied.text).toBe(expected);
      expect(element).not.toBeNull();
      expect(element?.getAttribute("role")).toBe("math");
      expect(element?.getAttribute("aria-label")).toContain(`${target.kind === "inline" ? "Inline" : "Block"} math source`);
      expect(element?.querySelector("[data-mdw-math-source]")?.textContent)
        .toBe(expected);
      expect(element?.querySelector(".mdw-math__preview, .mdw-math__status, button"))
        .toBeNull();

      const container = document.createElement("div");
      container.append(copied.dom.cloneNode(true));
      const pastedExtension = createMathExtension();
      const pasted = track(createEditor({
        element: host(),
        extensions: [pastedExtension],
        markdown: "",
      }));
      expect(pasted.view.pasteHTML(
        container.innerHTML,
        new Event("paste") as ClipboardEvent,
      )).toBe(true);
      expect(snapshot(pasted, pastedExtension).nodes.map(({ kind, source }) => ({
        kind,
        source,
      }))).toEqual([{ kind: target.kind, source: target.source }]);
    }
  });

  it("retains inline math in headings while excluding unrepresentable hard breaks", () => {
    const extension = createMathExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "# Formula $x$",
    }));
    const heading = editor.view.state.doc.firstChild!;

    expect(heading.type.name).toBe("heading");
    expect(mathNodes(editor, "inline")).toHaveLength(1);
    expect(heading.type.validContent(heading.content)).toBe(true);
    expect(heading.canReplaceWith(
      heading.childCount,
      heading.childCount,
      editor.view.state.schema.nodes.hard_break,
    )).toBe(false);
    expect(editor.getMarkdown()).toBe("# Formula $x$");
  });
});

it("validates factory options, localized messages, and frozen public constants", () => {
  expect(createMathExtension().compatibility.extensionApi).toBe("^1.2.0");
  expect(Object.isFrozen(defaultMathMessages)).toBe(true);
  expect(Object.isFrozen(mathKinds)).toBe(true);
  expect(Object.isFrozen(mathDiagnosticCodes)).toBe(true);
  expect(Object.isFrozen(mathRenderErrorCodes)).toBe(true);
  expect(() => createMathExtension({ unknown: true } as never))
    .toThrow(/Unknown math extension option/);
  expect(() => createMathExtension({ renderer: "bad" } as never))
    .toThrow(/renderer must be a function/);
  expect(() => createMathExtension({ onEditSource: "bad" } as never))
    .toThrow(/onEditSource must be a function/);
  expect(() => createMathExtension({ messages: new Date() as never }))
    .toThrow(/plain partial message object/);
  expect(() => createMathExtension({ messages: { editSource: " " } }))
    .toThrow(/non-empty string/);
  expect(() => createMathExtension({
    messages: { previewLabel: () => "" },
  })).toThrow(/non-empty string/);
});
