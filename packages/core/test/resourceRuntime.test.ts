import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as createRootEditor } from "../src/createEditor";
import type { MarkdownEditor } from "../src/editorApi";
import { createEditor as createMinimalEditor } from "../src/minimalEditor";
import type {
  MarkdownEditorImageLoadRequest,
  MarkdownEditorImageLoadResult,
  MarkdownEditorResourceErrorPhase,
} from "../src/resourceApi";

const editors: MarkdownEditor[] = [];
const restores: Array<() => void> = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    cancel() {},
    finished: Promise.resolve(),
  })) as typeof Element.prototype.animate;
}

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function invokeModifierClick(editor: MarkdownEditor, target: Element) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  Object.defineProperty(event, "target", {
    configurable: true,
    value: target,
  });
  const handledDomEvent = editor.view.someProp("handleDOMEvents", (handlers) =>
    handlers.click?.(editor.view, event),
  );

  if (!handledDomEvent) {
    editor.view.someProp("handleClick", (handler) => handler(editor.view, 1, event));
  }

  return event;
}

function installObjectUrlMocks() {
  const createDescriptor = Object.getOwnPropertyDescriptor(window.URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(window.URL, "revokeObjectURL");
  const createObjectURL = vi.fn(() => "blob:markora/test-image");
  const revokeObjectURL = vi.fn();

  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  restores.push(() => {
    if (createDescriptor) {
      Object.defineProperty(window.URL, "createObjectURL", createDescriptor);
    } else {
      delete (window.URL as typeof window.URL & { createObjectURL?: unknown }).createObjectURL;
    }
    if (revokeDescriptor) {
      Object.defineProperty(window.URL, "revokeObjectURL", revokeDescriptor);
    } else {
      delete (window.URL as typeof window.URL & { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  return { createObjectURL, revokeObjectURL };
}

function observeImageSourceAssignments() {
  const prototype = window.HTMLImageElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
  if (!descriptor?.set) {
    throw new Error("HTMLImageElement.src setter is unavailable in this test environment.");
  }

  const assignments: Array<{
    crossOrigin: string | null;
    referrerPolicy: string;
    src: string;
  }> = [];
  Object.defineProperty(prototype, "src", {
    ...descriptor,
    set(this: HTMLImageElement, src: string) {
      assignments.push({
        crossOrigin: this.crossOrigin,
        referrerPolicy: this.referrerPolicy,
        src,
      });
      descriptor.set!.call(this, src);
    },
  });
  restores.push(() => Object.defineProperty(prototype, "src", descriptor));
  return assignments;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
  for (const restore of restores.splice(0).reverse()) {
    restore();
  }
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const runtimes = [
  { createEditor: createRootEditor, name: "root" },
  { createEditor: createMinimalEditor, name: "minimal" },
] as const;

describe("resource runtime isolation", () => {
  it("keeps root and minimal custom image protocol policies editor-local", () => {
    const rootLoads = vi.fn((request: MarkdownEditorImageLoadRequest) => ({ src: request.url }));
    const minimalLoads = vi.fn((request: MarkdownEditorImageLoadRequest) => ({ src: request.url }));
    const root = track(createRootEditor({
      element: createHost(),
      markdown: "![Root](root-image:item)",
      resources: {
        images: {
          allowedDataMimeTypes: [],
          allowedProtocols: ["root-image:"],
          allowRelative: false,
        },
        loadImage: rootLoads,
      },
    }));
    const minimal = track(createMinimalEditor({
      element: createHost(),
      markdown: "![Minimal](minimal-image:item)",
      resources: {
        images: {
          allowedDataMimeTypes: [],
          allowedProtocols: ["minimal-image:"],
          allowRelative: false,
        },
        loadImage: minimalLoads,
      },
    }));

    expect(root.getMarkdown()).toBe("![Root](root-image:item)");
    expect(minimal.getMarkdown()).toBe("![Minimal](minimal-image:item)");
    expect(rootLoads).toHaveBeenCalledWith(expect.objectContaining({
      storedUrl: "root-image:item",
      url: "root-image:item",
    }));
    expect(minimalLoads).toHaveBeenCalledWith(expect.objectContaining({
      storedUrl: "minimal-image:item",
      url: "minimal-image:item",
    }));
    expect(root.commands.insertImage({ src: "minimal-image:item" })).toBe(false);
    expect(minimal.commands.insertImage({ src: "root-image:item" })).toBe(false);
  });
});

describe.each(runtimes)("$name resource opening", ({ createEditor }) => {
  it("uses the safe default popup contract when no host opener is present", () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = track(createEditor({
      element: createHost(),
      markdown: "[Docs](https://example.test/docs)",
    }));
    const anchor = editor.view.dom.querySelector("a");

    expect(anchor).not.toBeNull();
    expect(invokeModifierClick(editor, anchor!).defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(
      "https://example.test/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uses the host resolver/opener and consumes denied or hostile modifier clicks", () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const openUrl = vi.fn();
    const requests: Array<{ kind: string; purpose: string; url: string }> = [];
    let resolution: "allow" | "deny" | "hostile" = "allow";
    const editor = track(createEditor({
      element: createHost(),
      markdown: "[Docs](/docs)",
      resources: {
        openUrl,
        resolveUrl(request) {
          requests.push(request);
          if (resolution === "deny") {
            return null;
          }
          if (resolution === "hostile") {
            return "javascript:alert(1)";
          }
          return "https://resolved.example.test/docs";
        },
      },
    }));
    const anchor = editor.view.dom.querySelector("a");
    expect(anchor).not.toBeNull();

    const allowedEvent = invokeModifierClick(editor, anchor!);
    expect(allowedEvent.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenLastCalledWith(expect.objectContaining({
      event: allowedEvent,
      kind: "link",
      storedUrl: "/docs",
      url: "https://resolved.example.test/docs",
    }));
    expect(Object.isFrozen(openUrl.mock.calls[0][0])).toBe(true);

    resolution = "deny";
    const deniedEvent = invokeModifierClick(editor, anchor!);
    expect(deniedEvent.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(1);

    resolution = "hostile";
    const hostileEvent = invokeModifierClick(editor, anchor!);
    expect(hostileEvent.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
    expect(requests).toEqual([
      { kind: "link", purpose: "open", url: "/docs" },
      { kind: "link", purpose: "open", url: "/docs" },
      { kind: "link", purpose: "open", url: "/docs" },
    ]);
  });

  it("does not open a URL after the resolver destroys the editor", () => {
    const openUrl = vi.fn();
    let editor!: MarkdownEditor;
    editor = track(createEditor({
      element: createHost(),
      markdown: "[Docs](/docs)",
      resources: {
        openUrl,
        resolveUrl() {
          editor.destroy();
          return "https://resolved.example.test/docs";
        },
      },
    }));
    const anchor = editor.view.dom.querySelector("a");
    expect(anchor).not.toBeNull();

    const event = invokeModifierClick(editor, anchor!);

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe.each(runtimes)("$name image resource lifecycle", ({ createEditor }) => {
  it("reports a hostile PromiseLike getter as a recoverable load error", async () => {
    const failure = new Error("hostile then getter");
    const errors: unknown[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: "![Hostile](/hostile.png)",
      resources: {
        loadImage: () => Object.defineProperty({}, "then", {
          get() {
            throw failure;
          },
        }) as never,
      },
    }));
    editor.subscribe("error", (event) => {
      if (event.code === "resource-callback-failed") {
        errors.push(event.error);
      }
    });

    await flushPromises();

    expect(errors).toEqual([failure]);
    expect(editor.view.dom.querySelector(".mdw-image img")?.hasAttribute("src")).toBe(false);
  });

  it("surfaces throwing loader cleanup through editor destruction", () => {
    const failure = new Error("loader cleanup failed");
    const editor = track(createEditor({
      element: createHost(),
      markdown: "![Cleanup](/cleanup.png)",
      resources: {
        loadImage: ({ url }) => ({
          cleanup() {
            throw failure;
          },
          src: url,
        }),
      },
    }));

    expect(() => editor.destroy()).toThrow(failure);
    expect(editor.isDestroyed).toBe(true);
    editors.splice(editors.indexOf(editor), 1);
  });

  it("applies resolved async image results with configured privacy attributes", async () => {
    const sourceAssignments = observeImageSourceAssignments();
    const pending = deferred<MarkdownEditorImageLoadResult | null>();
    const loadRequests: MarkdownEditorImageLoadRequest[] = [];
    const resolveUrl = vi.fn(() => "https://cdn.example.test/resolved.png");
    const editor = track(createEditor({
      element: createHost(),
      markdown: "![Resolved](/stored.png)",
      resources: {
        images: {
          crossOrigin: "anonymous",
          referrerPolicy: "origin",
        },
        loadImage(request) {
          loadRequests.push(request);
          return pending.promise;
        },
        resolveUrl,
      },
    }));
    const image = editor.view.dom.querySelector("img");

    expect(image).not.toBeNull();
    expect(image!.hasAttribute("src")).toBe(false);
    expect(resolveUrl).toHaveBeenCalledWith({
      kind: "image",
      purpose: "load",
      url: "/stored.png",
    });
    expect(loadRequests).toHaveLength(1);
    expect(Object.isFrozen(loadRequests[0])).toBe(true);
    expect(loadRequests[0]).toMatchObject({
      storedUrl: "/stored.png",
      url: "https://cdn.example.test/resolved.png",
    });

    pending.resolve({ src: "https://cdn.example.test/final.png" });
    await flushPromises();

    expect(image!.getAttribute("src")).toBe("https://cdn.example.test/final.png");
    expect(image!.crossOrigin).toBe("anonymous");
    expect(image!.referrerPolicy).toBe("origin");
    expect(image!.decoding).toBe("async");
    expect(sourceAssignments).toEqual([{
      crossOrigin: "anonymous",
      referrerPolicy: "origin",
      src: "https://cdn.example.test/final.png",
    }]);
  });

  it("distinguishes async host denial from loader failure", async () => {
    const deniedErrors: MarkdownEditorResourceErrorPhase[] = [];
    const denied = track(createEditor({
      element: createHost(),
      markdown: "![Denied](/denied.png)",
      resources: {
        loadImage: () => Promise.resolve(null),
      },
    }));
    denied.subscribe("error", (event) => {
      if (event.code === "resource-callback-failed") {
        deniedErrors.push(event.context.phase);
      }
    });

    const pendingFailure = deferred<MarkdownEditorImageLoadResult | null>();
    const failureErrors: Array<{ error: unknown; phase: MarkdownEditorResourceErrorPhase }> = [];
    const failed = track(createEditor({
      element: createHost(),
      markdown: "![Failed](/failed.png)",
      resources: {
        loadImage: () => pendingFailure.promise,
      },
    }));
    failed.subscribe("error", (event) => {
      if (event.code === "resource-callback-failed") {
        failureErrors.push({ error: event.error, phase: event.context.phase });
      }
    });

    const failure = new Error("image loader failed");
    pendingFailure.reject(failure);
    await flushPromises();

    const deniedImage = denied.view.dom.querySelector("img");
    const failedImage = failed.view.dom.querySelector("img");
    expect(deniedImage?.hasAttribute("src")).toBe(false);
    expect(denied.view.dom.textContent).toContain("Image blocked by resource policy");
    expect(deniedErrors).toEqual([]);
    expect(failedImage?.hasAttribute("src")).toBe(false);
    expect(failureErrors).toEqual([{ error: failure, phase: "load" }]);
  });

  it("aborts stale loads, ignores their result, and cleans each accepted result once", async () => {
    const loads = new Map<string, {
      pending: ReturnType<typeof deferred<MarkdownEditorImageLoadResult | null>>;
      request: MarkdownEditorImageLoadRequest;
    }>();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "![First](/first.png)",
      resources: {
        loadImage(request) {
          const pending = deferred<MarkdownEditorImageLoadResult | null>();
          loads.set(request.storedUrl, { pending, request });
          return pending.promise;
        },
      },
    }));
    const first = loads.get("/first.png");
    expect(first).toBeDefined();
    expect(first!.request.signal.aborted).toBe(false);

    editor.commands.resetMarkdown("![Second](/second.png)");
    const second = loads.get("/second.png");
    expect(second).toBeDefined();
    expect(first!.request.signal.aborted).toBe(true);
    expect(second!.request.signal.aborted).toBe(false);

    const staleCleanup = vi.fn();
    first!.pending.resolve({
      cleanup: staleCleanup,
      src: "https://cdn.example.test/stale.png",
    });
    await flushPromises();
    expect(staleCleanup).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.querySelector("img")?.hasAttribute("src")).toBe(false);

    const currentCleanup = vi.fn();
    second!.pending.resolve({
      cleanup: currentCleanup,
      src: "https://cdn.example.test/current.png",
    });
    await flushPromises();
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.test/current.png",
    );

    editor.destroy();
    expect(second!.request.signal.aborted).toBe(true);
    expect(currentCleanup).toHaveBeenCalledTimes(1);
    editor.destroy();
    expect(staleCleanup).toHaveBeenCalledTimes(1);
    expect(currentCleanup).toHaveBeenCalledTimes(1);
  });

  it("does not start a stale load after a resolver reentrantly changes the source", () => {
    const loadRequests: MarkdownEditorImageLoadRequest[] = [];
    let editor!: MarkdownEditor;
    let reenterOnTrigger = false;
    editor = track(createEditor({
      element: createHost(),
      markdown: "![Initial](/initial.png)",
      resources: {
        loadImage(request) {
          loadRequests.push(request);
          return { src: `https://cdn.example.test${request.storedUrl}` };
        },
        resolveUrl(request) {
          if (reenterOnTrigger && request.url === "/trigger.png") {
            reenterOnTrigger = false;
            editor.commands.resetMarkdown("![Winner](/winner.png)");
          }
          return request.url;
        },
      },
    }));

    reenterOnTrigger = true;
    editor.commands.resetMarkdown("![Trigger](/trigger.png)");

    expect.soft(loadRequests.map((request) => request.storedUrl)).toEqual([
      "/initial.png",
      "/winner.png",
    ]);
    const winner = loadRequests.find((request) => request.storedUrl === "/winner.png");
    expect(winner).toBeDefined();

    editor.destroy();
    expect(winner!.signal.aborted).toBe(true);
  });

  it("creates and revokes Blob object URLs and runs host cleanup on destroy", () => {
    const { createObjectURL, revokeObjectURL } = installObjectUrlMocks();
    const cleanup = vi.fn();
    let request!: MarkdownEditorImageLoadRequest;
    const editor = track(createEditor({
      element: createHost(),
      markdown: "![Blob](/blob.png)",
      resources: {
        loadImage(nextRequest) {
          request = nextRequest;
          return {
            cleanup,
            src: new window.Blob(["image"], { type: "image/png" }),
          };
        },
      },
    }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe(
      "blob:markora/test-image",
    );
    expect(request.signal.aborted).toBe(false);

    editor.destroy();
    expect(request.signal.aborted).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:markora/test-image");
    expect(cleanup).toHaveBeenCalledTimes(1);
    editor.destroy();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
