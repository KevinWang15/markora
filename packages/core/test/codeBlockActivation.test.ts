import { EditorView as CodeMirrorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { MarkdownEditor } from "../src";
import { createEditor } from "../src";
import {
  installControlledIntersectionObservers,
  type ControlledIntersectionObservers,
  waitForCodeBlockState,
  waitForCodeMirrorEditors,
} from "./codeBlockTestUtils";

const editors: MarkdownEditor[] = [];
const observerControls: ControlledIntersectionObservers[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
}

if (typeof window.requestAnimationFrame !== "function") {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => (
    window.setTimeout(() => callback(Date.now()), 16)
  )) as typeof requestAnimationFrame;
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

function installObservers(options: { initiallyIntersecting?: boolean } = {}) {
  const controls = installControlledIntersectionObservers(window, options);
  observerControls.push(controls);
  return controls;
}

function findCodeBlock(editor: MarkdownEditor, wantedIndex = 0) {
  let match: { node: ProseMirrorNode; pos: number } | null = null;
  let index = 0;

  editor.view.state.doc.descendants((node, pos) => {
    if (match) {
      return false;
    }

    if (node.type.name !== "code_block") {
      return true;
    }

    if (index === wantedIndex) {
      match = { node, pos };
      return false;
    }

    index += 1;
    return true;
  });

  if (!match) {
    throw new Error(`Code block ${wantedIndex} was not found.`);
  }

  return match as { node: ProseMirrorNode; pos: number };
}

function replaceCodeBlock(
  editor: MarkdownEditor,
  text: string,
  language: string,
) {
  const { node, pos } = findCodeBlock(editor);
  const { schema } = editor.view.state;
  const replacement = text ? schema.text(text) : null;
  const tr = editor.view.state.tr
    .setNodeMarkup(pos, undefined, { ...node.attrs, params: language })
    .replaceWith(pos + 1, pos + node.nodeSize - 1, replacement ?? []);
  editor.view.dispatch(tr);
  return pos;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  observerControls.splice(0).forEach((controls) => controls.restore());
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("lazy code-block activation", () => {
  it("keeps the shell alive while activation mutates its owned DOM", async () => {
    const observers = installObservers();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```text", "observed", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    observers.emitFor(shell, true);
    await waitForCodeBlockState(editor, "active");
    expect(shell.querySelector(".cm-editor")).not.toBeNull();
  });

  it("keeps an exact, accessible static shell when IntersectionObserver is unavailable", () => {
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", "", "```custom", "first line", "second line", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const staticView = shell.querySelector<HTMLElement>(".mdw-code-block-static")!;
    const code = staticView.querySelector<HTMLElement>(".mdw-code-block-static-code")!;

    expect(window.IntersectionObserver).toBeUndefined();
    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(code.tagName).toBe("CODE");
    expect(code.textContent).toBe("first line\nsecond line");
    expect(code.hasAttribute("aria-label")).toBe(false);
    expect(code.hasAttribute("aria-readonly")).toBe(false);
    expect(code.getAttribute("spellcheck")).toBe("false");
    expect(staticView.tabIndex).toBe(0);
    expect(staticView.querySelector(".mdw-code-block-static-gutter")?.textContent).toBe("1\n2");
    expect(shell.querySelector(".mdw-code-block-language")?.textContent).toBe("custom");
    expect(loader).not.toHaveBeenCalled();
  });

  it("keeps noncollapsed code selections exact and passive", async () => {
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", "", "```custom", "alpha beta gamma", "```"].join("\n"),
    }));
    const { pos } = findCodeBlock(editor);
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    editor.focus({ anchor: pos + 1 + 6, head: pos + 1 + 10 });
    await Promise.resolve();

    expect(editor.view.state.selection).toMatchObject({
      anchor: pos + 1 + 6,
      head: pos + 1 + 10,
    });
    expect(document.getSelection()?.toString()).toBe("beta");
    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("updates the permanent static shell without loading a language runtime", () => {
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { latest: loader },
      element: createHost(),
      markdown: ["before", "", "```old", "old", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const staticView = shell.querySelector<HTMLElement>(".mdw-code-block-static")!;

    replaceCodeBlock(editor, "latest one\nlatest two\nlatest three", "latest");

    expect(editor.view.dom.querySelector(".mdw-code-block")).toBe(shell);
    expect(shell.querySelector(".mdw-code-block-static")).toBe(staticView);
    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".mdw-code-block-static-code")?.textContent)
      .toBe("latest one\nlatest two\nlatest three");
    expect(shell.querySelector(".mdw-code-block-static-gutter")?.textContent).toBe("1\n2\n3");
    expect(shell.querySelector(".mdw-code-block-language")?.textContent).toBe("latest");
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([1, 2])("keeps button %i pointer starts passive", async (button) => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```text", "passive", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const staticCode = shell.querySelector<HTMLElement>(".mdw-code-block-static-code")!;
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);

    staticCode.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button,
      cancelable: true,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
  });

  it("bounds viewport activation to eight editors and shares language loading", async () => {
    const observers = installObservers();
    const loader = vi.fn(() => []);
    const fences = Array.from({ length: 12 }, (_, index) => (
      ["```custom", `block ${index}`, "```"].join("\n")
    ));
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", ...fences].join("\n\n"),
    }));

    expect(editor.view.dom.querySelectorAll(".mdw-code-block")).toHaveLength(12);
    expect(editor.view.dom.querySelectorAll(".cm-editor")).toHaveLength(0);
    observers.emitAll(true);

    await waitForCodeBlockState(editor, "active", 8);
    await waitForCodeMirrorEditors(editor, 8);
    expect(editor.view.dom.querySelectorAll('[data-mdw-code-block-state="inactive"]')).toHaveLength(4);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it("cancels stale direct-selection loads and keeps activation work bounded", async () => {
    const fences = Array.from({ length: 12 }, (_, index) => (
      ["```text", `direct selection ${index}`, "```"].join("\n")
    ));
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", ...fences].join("\n\n"),
    }));
    const shells = [...editor.view.dom.querySelectorAll<HTMLElement>(".mdw-code-block")];
    const positions = fences.map((_, index) => findCodeBlock(editor, index).pos + 1);

    for (const position of positions) {
      editor.focus({ anchor: position, head: position });
      const working = editor.view.dom.querySelectorAll(
        '[data-mdw-code-block-state="active"], [data-mdw-code-block-state="loading"]',
      ).length;
      expect(working).toBeLessThanOrEqual(8);
    }

    expect(shells.slice(0, -1).every((shell) => shell.dataset.mdwCodeBlockState === "inactive"))
      .toBe(true);
    expect(shells.at(-1)?.dataset.mdwCodeBlockState).toBe("loading");

    await waitForCodeBlockState(editor, "active");
    expect(editor.view.dom.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(shells.at(-1)?.querySelector(".cm-editor")).not.toBeNull();
  });

  it("uses the latest document and selection when activation finishes", async () => {
    const observers = installObservers();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```text", "old", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    observers.emitFor(shell, true);
    expect(shell.dataset.mdwCodeBlockState).toBe("loading");
    const pos = replaceCodeBlock(editor, "latest value", "text");
    editor.focus({ anchor: pos + 1 + 8, head: pos + 1 + 8 });

    await waitForCodeBlockState(editor, "active");
    const cmDom = shell.querySelector<HTMLElement>(".cm-editor")!;
    const codeMirror = CodeMirrorView.findFromDOM(cmDom)!;
    expect(codeMirror.state.doc.toString()).toBe("latest value");
    expect(codeMirror.state.selection.main).toMatchObject({ anchor: 8, head: 8 });
    expect(codeMirror.hasFocus).toBe(true);
  });

  it("does not refocus a cold editor after the public blur API runs", async () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```text", "cold focus", "```"].join("\n"),
    }));
    const { pos } = findCodeBlock(editor);
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    editor.focus({ anchor: pos + 2, head: pos + 2 });
    expect(shell.dataset.mdwCodeBlockState).toBe("loading");
    editor.blur();
    expect(document.activeElement).toBe(document.body);

    await waitForCodeBlockState(editor, "active");
    const codeMirror = CodeMirrorView.findFromDOM(shell.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(codeMirror.hasFocus).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("defers runtime mounting until an outer composition ends", async () => {
    const observers = installObservers();
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", "", "```custom", "composing", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const input = (editor.view as unknown as { input: { composing: boolean } }).input;

    input.composing = true;
    observers.emitFor(shell, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(loader).not.toHaveBeenCalled();

    input.composing = false;
    shell.querySelector(".mdw-code-block-static-code")!.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );

    await waitForCodeBlockState(editor, "active");
    expect(shell.querySelector(".cm-editor")).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("cancels a resolving cold activation until composition commits", async () => {
    const observers = installObservers();
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", "", "```custom", "initial", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const input = (editor.view as unknown as { input: { composing: boolean } }).input;

    observers.emitFor(shell, true);
    expect(shell.dataset.mdwCodeBlockState).toBe("loading");

    input.composing = true;
    replaceCodeBlock(editor, "latest committed value", "custom");
    await Promise.resolve();
    await Promise.resolve();

    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(loader).not.toHaveBeenCalled();

    input.composing = false;
    shell.querySelector(".mdw-code-block-static-code")!.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );

    await waitForCodeBlockState(editor, "active");
    const codeMirror = CodeMirrorView.findFromDOM(shell.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(codeMirror.state.doc.toString()).toBe("latest committed value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resumes a many-shell viewport with one composition-end task and the same pool cap", async () => {
    const observers = installObservers();
    const fences = Array.from({ length: 40 }, (_, index) => (
      ["```text", `composition block ${index}`, "```"].join("\n")
    ));
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", ...fences].join("\n\n"),
    }));
    const input = (editor.view as unknown as { input: { composing: boolean } }).input;
    const queueMicrotask = vi.spyOn(window, "queueMicrotask");

    input.composing = true;
    observers.emitAll(true);
    expect(editor.view.dom.querySelectorAll('[data-mdw-code-block-state="inactive"]')).toHaveLength(40);
    expect(editor.view.dom.querySelectorAll(".cm-editor")).toHaveLength(0);

    queueMicrotask.mockClear();
    input.composing = false;
    editor.view.dom.querySelector(".mdw-code-block-static-code")!.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );

    expect(queueMicrotask).toHaveBeenCalledTimes(1);
    await waitForCodeBlockState(editor, "active", 8);
    await waitForCodeMirrorEditors(editor, 8);
    expect(editor.view.dom.querySelectorAll('[data-mdw-code-block-state="inactive"]')).toHaveLength(32);
  });

  it("deactivates offscreen editors and reactivates from the permanent shell", async () => {
    const observers = installObservers();
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: ["before", "", "```custom", "persistent", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const staticView = shell.querySelector<HTMLElement>(".mdw-code-block-static")!;

    observers.emitFor(shell, true);
    await waitForCodeBlockState(editor, "active");
    const firstEditor = shell.querySelector(".cm-editor");
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    observers.emitFor(shell, false);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await waitForCodeBlockState(editor, "inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(shell.querySelector(".mdw-code-block-static")).toBe(staticView);
    expect(staticView.hidden).toBe(false);

    observers.emitFor(shell, true);
    await waitForCodeBlockState(editor, "active");
    expect(shell.querySelector(".cm-editor")).not.toBe(firstEditor);
    expect(shell.querySelector(".mdw-code-block-static-code")?.textContent).toBe("persistent");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("defers hidden gutter work during typing and refreshes it once on deactivation", async () => {
    const observers = installObservers();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```text", "one", "```"].join("\n"),
    }));
    const { pos } = findCodeBlock(editor);
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const gutter = shell.querySelector<HTMLElement>(".mdw-code-block-static-gutter")!;

    editor.focus({ anchor: pos + 2, head: pos + 2 });
    await waitForCodeBlockState(editor, "active");
    const codeMirror = CodeMirrorView.findFromDOM(shell.querySelector<HTMLElement>(".cm-editor")!)!;
    const gutterMutations: MutationRecord[] = [];
    const gutterObserver = new MutationObserver((records) => gutterMutations.push(...records));
    gutterObserver.observe(gutter, { childList: true, characterData: true, subtree: true });

    codeMirror.dispatch({ changes: { from: codeMirror.state.doc.length, insert: " more" } });
    await Promise.resolve();
    expect(gutter.textContent).toBe("1");
    expect(gutterMutations).toHaveLength(0);

    codeMirror.dispatch({ changes: { from: codeMirror.state.doc.length, insert: "\ntwo" } });
    await Promise.resolve();
    expect(gutter.textContent).toBe("1");
    expect(gutterMutations).toHaveLength(0);

    editor.focus({ anchor: 1, head: 1 });
    observers.emitFor(shell, false);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await waitForCodeBlockState(editor, "inactive");
    expect(gutter.textContent).toBe("1\n2");
    expect(gutterMutations).toHaveLength(1);
    gutterObserver.disconnect();
  });

  it("shares one pending host language load across repeated activation cycles", async () => {
    const observers = installObservers();
    const then = vi.fn();
    const pending = { then } as unknown as Promise<never>;
    const loader = vi.fn(() => pending);
    const editor = track(createEditor({
      codeBlockLanguages: { pending: loader },
      element: createHost(),
      markdown: ["before", "", "```pending", "persistent", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    for (let cycle = 0; cycle < 3; cycle += 1) {
      observers.emitFor(shell, true);
      await waitForCodeBlockState(editor, "active");
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

      if (cycle < 2) {
        observers.emitFor(shell, false);
        await new Promise((resolve) => setTimeout(resolve, 450));
        await waitForCodeBlockState(editor, "inactive");
      }
    }

    expect(loader).toHaveBeenCalledTimes(1);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("cancels activation and language loading when the editor is destroyed", async () => {
    const observers = installObservers();
    const loader = vi.fn(() => []);
    const host = createHost();
    const editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: host,
      markdown: ["before", "", "```custom", "removed", "```"].join("\n"),
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    observers.emitFor(shell, true);
    expect(shell.dataset.mdwCodeBlockState).toBe("loading");
    editor.destroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector(".mdw-code-block, .cm-editor")).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(observers.observedElements()).toEqual([]);
  });

  it("keeps the static shell usable and reports one runtime activation failure", async () => {
    const observers = installObservers();
    const failure = new Error("runtime construction failed");
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```broken", "still readable", "```"].join("\n"),
    }));
    const errors: Array<{ code: string; error: unknown; language?: string }> = [];
    editor.subscribe("error", (event) => {
      errors.push({
        code: event.code,
        error: event.error,
        language: "language" in event.context ? event.context.language : undefined,
      });
    });
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const originalCreateElement = document.createElement.bind(document);
    let shouldFail = true;
    vi.spyOn(document, "createElement").mockImplementation(((name: string, options?: ElementCreationOptions) => {
      if (shouldFail) {
        shouldFail = false;
        throw failure;
      }

      return originalCreateElement(name, options);
    }) as typeof document.createElement);

    observers.emitFor(shell, true);
    await waitForCodeBlockState(editor, "error");

    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(shell.querySelector(".mdw-code-block-static-code")?.textContent).toBe("still readable");
    expect(errors).toEqual([{
      code: "code-block-runtime-load-failed",
      error: failure,
      language: "broken",
    }]);
    observers.emitFor(shell, false);
    observers.emitFor(shell, true);
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });

  it("releases the activation-pool slot when post-construction focus fails", async () => {
    const observers = installObservers();
    const failure = new Error("focus handoff failed");
    const fences = Array.from({ length: 9 }, (_, index) => (
      ["```text", `block ${index}`, "```"].join("\n")
    ));
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", ...fences].join("\n\n"),
    }));
    const shells = [...editor.view.dom.querySelectorAll<HTMLElement>(".mdw-code-block")];
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event.error));
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    let shouldFail = true;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      if (shouldFail && shells[0]?.dataset.mdwCodeBlockState === "active") {
        shouldFail = false;
        throw failure;
      }

      return originalRequestAnimationFrame(callback);
    });

    const first = findCodeBlock(editor);
    editor.focus({ anchor: first.pos + 1, head: first.pos + 1 });
    await waitForCodeBlockState(editor, "error");

    expect(shells[0]?.querySelector(".cm-editor")).toBeNull();
    expect(shells[0]?.querySelector<HTMLElement>(".mdw-code-block-static")?.hidden).toBe(false);
    expect(errors).toEqual([failure]);

    observers.emitAll(true);
    await waitForCodeBlockState(editor, "active", 8);
    expect(editor.view.dom.querySelectorAll(".cm-editor")).toHaveLength(8);
  });
});
