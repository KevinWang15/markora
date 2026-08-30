import { EditorView as CodeMirrorView } from "@codemirror/view";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/createEditor";
import {
  installControlledIntersectionObservers,
  waitForCodeBlockState,
} from "./codeBlockTestUtils";

const editors: Array<ReturnType<typeof createEditor>> = [];

function installDomStubs() {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
  }

  if (!Element.prototype.animate) {
    Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
  }

  if (typeof requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(Date.now()), 16)
    )) as typeof requestAnimationFrame;
  }
}

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function trackEditor(editor: ReturnType<typeof createEditor>) {
  editors.push(editor);
  return editor;
}

function deferredExtension() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

installDomStubs();
const intersectionObservers = installControlledIntersectionObservers(window);

async function activateCodeBlocks(
  editor: ReturnType<typeof createEditor>,
  count = 1,
) {
  intersectionObservers.emitAll(true);
  await waitForCodeBlockState(editor, "active", count);
}

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("embedded read-only surfaces", () => {
  it("mirrors editable updates into CodeMirror and blocks non-sync document changes", async () => {
    const editor = trackEditor(createEditor({
      editable: false,
      element: createHost(),
      markdown: "```ts\nconst value = 1\n```",
    }));
    await activateCodeBlocks(editor);
    const codeMirrorDom = editor.view.dom.querySelector<HTMLElement>(".cm-editor");
    const content = codeMirrorDom?.querySelector<HTMLElement>(".cm-content");
    const codeMirror = codeMirrorDom ? CodeMirrorView.findFromDOM(codeMirrorDom) : null;

    expect(codeMirror).not.toBeNull();
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(content?.getAttribute("aria-readonly")).toBe("true");

    codeMirror?.dispatch({ changes: { from: 0, insert: "blocked" } });
    expect(codeMirror?.state.doc.toString()).toBe("const value = 1");

    editor.commands.resetMarkdown("```ts\nconst value = 2\n```");
    expect(codeMirror?.state.doc.toString()).toBe("const value = 2");

    editor.updateOptions({ editable: true });
    const editableContent = editor.view.dom.querySelector<HTMLElement>(".cm-content");
    expect(editableContent?.getAttribute("contenteditable")).toBe("true");
    expect(editableContent?.getAttribute("aria-readonly")).toBe("false");

    editor.updateOptions({ editable: false });
    const readonlyContent = editor.view.dom.querySelector<HTMLElement>(".cm-content");
    expect(readonlyContent?.getAttribute("contenteditable")).toBe("false");
    expect(readonlyContent?.getAttribute("aria-readonly")).toBe("true");
  });

  it("reports only the live, current async language rejection", async () => {
    const stale = deferredExtension();
    const current = deferredExtension();
    const staleLoader = vi.fn(() => stale.promise);
    const currentLoader = vi.fn(() => current.promise);
    const editor = trackEditor(createEditor({
      codeBlockLanguages: {
        current: currentLoader,
        stale: staleLoader,
      },
      element: createHost(),
      markdown: "```stale\nold\n```",
    }));
    const errors: Array<{ error: unknown; language: string }> = [];
    editor.subscribe("error", (event) => {
      errors.push({ error: event.error, language: event.context.language });
    });

    await activateCodeBlocks(editor);
    await vi.waitFor(() => expect(staleLoader).toHaveBeenCalledTimes(1));
    editor.commands.resetMarkdown("```current\nnew\n```");
    await vi.waitFor(() => expect(currentLoader).toHaveBeenCalledTimes(1));
    const staleError = new Error("stale language failure");
    stale.reject(staleError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);

    const currentError = new Error("current language failure");
    current.reject(currentError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([{ error: currentError, language: "current" }]);
  });

  it("reports a shared language-loader failure once for multiple matching blocks", async () => {
    const deferred = deferredExtension();
    const loader = vi.fn(() => deferred.promise);
    const editor = trackEditor(createEditor({
      codeBlockLanguages: {
        shared: loader,
      },
      element: createHost(),
      markdown: ["```shared", "first", "```", "", "```shared", "second", "```"].join("\n"),
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event));

    await activateCodeBlocks(editor, 2);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    deferred.reject(new Error("shared failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
  });

  it("suppresses a late language rejection after destroy", async () => {
    const deferred = deferredExtension();
    const loader = vi.fn(() => deferred.promise);
    const editor = trackEditor(createEditor({
      codeBlockLanguages: {
        late: loader,
      },
      element: createHost(),
      markdown: "```late\nold\n```",
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event));
    await activateCodeBlocks(editor);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    editor.destroy();

    deferred.reject(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
  });
});
