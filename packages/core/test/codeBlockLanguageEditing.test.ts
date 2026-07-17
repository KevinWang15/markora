import type { Extension } from "@codemirror/state";
import { EditorView as CodeMirrorView, ViewPlugin } from "@codemirror/view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditor,
  type CodeBlockLanguageEditRequest,
  type CodeBlockLanguageEditorOverlay,
  type EditorUiFactory,
  type MarkdownEditor,
} from "../src";
import {
  installControlledIntersectionObservers,
  waitForCodeBlockState,
} from "./codeBlockTestUtils";

const editors: MarkdownEditor[] = [];

function installDomStubs() {
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
    })) as unknown as typeof Element.prototype.animate;
  }
}

installDomStubs();
const intersectionObservers = installControlledIntersectionObservers(window);

type LanguageUiHarness = {
  close: ReturnType<typeof vi.fn<(refocusTrigger: boolean) => void>>;
  composing: boolean;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  markers: HTMLElement[];
  open: ReturnType<typeof vi.fn<CodeBlockLanguageEditorOverlay["open"]>>;
  openResult: boolean;
  requests: CodeBlockLanguageEditRequest[];
  views: MarkdownEditor["view"][];
};

function createUiHarness(options: { includeLanguageEditor?: boolean } = {}) {
  const harness: LanguageUiHarness = {
    close: vi.fn<(refocusTrigger: boolean) => void>(),
    composing: false,
    destroy: vi.fn<() => void>(),
    markers: [],
    open: vi.fn<CodeBlockLanguageEditorOverlay["open"]>(() => true),
    openResult: true,
    requests: [],
    views: [],
  };
  const languageEditor: CodeBlockLanguageEditorOverlay = {
    open(view, marker, request) {
      harness.open(view, marker, request);
      harness.views.push(view);
      harness.markers.push(marker);
      harness.requests.push(request);
      return harness.openResult;
    },
    close: harness.close,
    isComposing: () => harness.composing,
    destroy: harness.destroy,
  };
  const ui: EditorUiFactory = () => ({
    enabled: true,
    clearSelectionAnchor() {},
    createSelectionAnchor() {
      return null;
    },
    ...(options.includeLanguageEditor === false
      ? {}
      : { codeBlockLanguageEditor: languageEditor }),
    imageEditor: {
      open() {},
      close() {},
      destroy() {},
    },
    linkEditor: {
      open() {},
      close() {},
      destroy() {},
    },
    tableToolbar: {
      update() {},
      destroy() {},
    },
  });

  return { harness, ui };
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

function findCodeBlock(editor: MarkdownEditor) {
  const results: Array<{ node: ProseMirrorNode; pos: number }> = [];

  editor.view.state.doc.descendants((node, pos) => {
    if (results.length === 0 && node.type.name === "code_block") {
      results.push({ node, pos });
      return false;
    }

    return true;
  });

  const result = results[0];

  if (!result) {
    throw new Error("Expected a code block in the editor document.");
  }

  return result;
}

function languageButton(editor: MarkdownEditor) {
  const button = editor.view.dom.querySelector<HTMLButtonElement>(
    "button.mdw-code-block-language",
  );

  if (!button) {
    throw new Error("Expected an editable code-block language button.");
  }

  return button;
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

function languageMarker(language: string, mounted: () => void): Extension {
  return ViewPlugin.define((view) => {
    mounted();
    view.dom.dataset.loadedLanguage = language;

    return {
      destroy() {
        if (view.dom.dataset.loadedLanguage === language) {
          delete view.dom.dataset.loadedLanguage;
        }
      },
    };
  });
}

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      // Tests that exercise teardown own any expected failure assertions.
    }
  }

  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("code-block language editing", () => {
  it("keeps custom UI factories without the optional controller backward-compatible", () => {
    const { ui } = createUiHarness({ includeLanguageEditor: false });
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```ts", "const value = 1", "```"].join("\n"),
      ui,
    }));
    const badge = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block-language");

    expect(editor.ui).not.toBeNull();
    expect(badge?.tagName).toBe("DIV");
    expect(badge?.textContent).toBe("ts");
    expect(editor.ui?.editCodeBlockLanguage()).toBe(false);
  });

  it("opens from a passive button with the exact fenced-code info", () => {
    const { harness, ui } = createUiHarness();
    const info = "lang`variant metadata=true";
    const loader = vi.fn(() => []);
    const editor = track(createEditor({
      codeBlockLanguages: { [info]: loader },
      element: createHost(),
      markdown: ["before", "", `~~~${info}`, "const value = 1", "~~~"].join("\n"),
      ui,
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;
    const button = languageButton(editor);

    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(shell.querySelector(".cm-editor")).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(button.textContent).toBe(info);
    expect(button.getAttribute("aria-label")).toBe(`Edit code block language: ${info}`);

    button.click();

    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(harness.views).toEqual([editor.view]);
    expect(harness.markers).toEqual([button]);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.language).toBe(info);
    expect(shell.dataset.mdwCodeBlockState).toBe("inactive");
    expect(loader).not.toHaveBeenCalled();
  });

  it("updates only the info string, preserves body and selection, and forms one undo step", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: [
        "before",
        "",
        "```old",
        "alpha",
        "beta",
        "```",
        "",
        "after",
      ].join("\n"),
      ui,
    }));
    const initial = findCodeBlock(editor);
    const initialSelection = editor.view.state.selection.toJSON();
    const initialBody = initial.node.textContent;

    languageButton(editor).click();
    const request = harness.requests[0]!;

    expect(request.language).toBe("old");
    expect(request.update(" old ")).toBe(true);
    expect(editor.commands.undo()).toBe(false);
    expect(request.update(" next` metadata=true ")).toBe(true);

    let current = findCodeBlock(editor);
    expect(current.node.attrs.params).toBe("next` metadata=true");
    expect(current.node.textContent).toBe(initialBody);
    expect(editor.view.state.selection.toJSON()).toEqual(initialSelection);
    expect(editor.getMarkdown()).toContain("~~~next` metadata=true\nalpha\nbeta\n~~~");
    expect(request.update("later")).toBe(false);

    expect(editor.commands.undo()).toBe(true);
    current = findCodeBlock(editor);
    expect(current.node.attrs.params).toBe("old");
    expect(current.node.textContent).toBe(initialBody);
    expect(editor.view.state.selection.toJSON()).toEqual(initialSelection);
    expect(editor.commands.undo()).toBe(false);

    expect(editor.commands.redo()).toBe(true);
    current = findCodeBlock(editor);
    expect(current.node.attrs.params).toBe("next` metadata=true");
    expect(current.node.textContent).toBe(initialBody);
    expect(editor.view.state.selection.toJSON()).toEqual(initialSelection);
  });

  it.each(["body edit", "document reset", "node removal"] as const)(
    "rejects a stale request after %s",
    (mutation) => {
      const { harness, ui } = createUiHarness();
      const editor = track(createEditor({
        element: createHost(),
        markdown: ["before", "", "```old", "alpha", "```", "", "after"].join("\n"),
        ui,
      }));
      const initial = findCodeBlock(editor);

      languageButton(editor).click();
      const request = harness.requests[0]!;

      if (mutation === "body edit") {
        editor.view.dispatch(
          editor.view.state.tr.insertText("!", initial.pos + 1 + initial.node.content.size),
        );
      } else if (mutation === "document reset") {
        editor.commands.resetMarkdown([
          "replacement",
          "",
          "```reset",
          "different body",
          "```",
        ].join("\n"));
      } else {
        editor.view.dispatch(
          editor.view.state.tr.delete(initial.pos, initial.pos + initial.node.nodeSize),
        );
      }

      const markdownAfterMutation = editor.getMarkdown();
      expect(request.update("new-language")).toBe(false);
      expect(editor.getMarkdown()).toBe(markdownAfterMutation);
    },
  );

  it("blocks an open request in read-only mode and closes an existing overlay", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```old", "alpha", "```"].join("\n"),
      ui,
    }));
    const button = languageButton(editor);

    button.click();
    const request = harness.requests[0]!;
    editor.updateOptions({ editable: false });

    expect(button.disabled).toBe(true);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledWith(false);
    expect(request.update("next")).toBe(false);
    button.click();
    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(findCodeBlock(editor).node.attrs.params).toBe("old");

    editor.updateOptions({ editable: true });
    expect(button.disabled).toBe(false);
    expect(request.update("revived")).toBe(false);
  });

  it("invalidates a request when a newer language edit supersedes it", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["```old", "alpha", "```"].join("\n"),
      ui,
    }));
    const button = languageButton(editor);

    button.click();
    const first = harness.requests[0]!;
    button.click();
    const second = harness.requests[1]!;

    expect(first.update("stale")).toBe(false);
    expect(second.update("current")).toBe(true);
    expect(findCodeBlock(editor).node.attrs.params).toBe("current");
  });

  it("lets custom UI invalidate a cancelled request explicitly", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["```old", "alpha", "```"].join("\n"),
      ui,
    }));

    languageButton(editor).click();
    const request = harness.requests[0]!;
    request.cancel();

    expect(request.update("cancelled")).toBe(false);
    expect(findCodeBlock(editor).node.attrs.params).toBe("old");
  });

  it("invalidates a request when a custom controller rejects opening", () => {
    const { harness, ui } = createUiHarness();
    harness.openResult = false;
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["```old", "alpha", "```"].join("\n"),
      ui,
    }));

    languageButton(editor).click();
    const request = harness.requests[0]!;
    expect(request.update("rejected-open")).toBe(false);
    expect(findCodeBlock(editor).node.attrs.params).toBe("old");
  });

  it("rejects line breaks before trimming command or overlay input", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["```old", "alpha", "```"].join("\n"),
      ui,
    }));

    languageButton(editor).click();
    const request = harness.requests[0]!;
    expect(request.update("next\n")).toBe(false);
    expect(() => editor.commands.setCodeBlock({ language: "next\r" })).toThrow(RangeError);
    expect(findCodeBlock(editor).node.attrs.params).toBe("old");
  });

  it("rejects updates and new opens during outer or overlay composition", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```old", "alpha", "```"].join("\n"),
      ui,
    }));
    const button = languageButton(editor);

    button.click();
    const request = harness.requests[0]!;
    const input = (editor.view as unknown as { input: { composing: boolean } }).input;

    input.composing = true;
    expect(request.update("outer-composition")).toBe(false);
    button.click();
    expect(harness.open).toHaveBeenCalledTimes(1);

    input.composing = false;
    harness.composing = true;
    expect(request.update("overlay-composition")).toBe(false);
    button.click();
    expect(harness.open).toHaveBeenCalledTimes(1);

    harness.composing = false;
    expect(request.update("next")).toBe(true);
    expect(findCodeBlock(editor).node.attrs.params).toBe("next");
  });

  it("destroys the controller and invalidates requests and detached button listeners", () => {
    const { harness, ui } = createUiHarness();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["before", "", "```old", "alpha", "```"].join("\n"),
      ui,
    }));
    const button = languageButton(editor);

    button.click();
    const request = harness.requests[0]!;
    editor.destroy();

    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(request.update("next")).toBe(false);
    button.click();
    expect(harness.open).toHaveBeenCalledTimes(1);

    editor.destroy();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the active CodeMirror instance while superseding a stale language load", async () => {
    const { harness, ui } = createUiHarness();
    const oldLanguage = deferred<Extension>();
    const nextLanguage = deferred<Extension>();
    const oldMounted = vi.fn();
    const nextMounted = vi.fn();
    const oldLoader = vi.fn(() => oldLanguage.promise);
    const nextLoader = vi.fn(() => nextLanguage.promise);
    const editor = track(createEditor({
      codeBlockLanguages: {
        next: nextLoader,
        old: oldLoader,
      },
      element: createHost(),
      markdown: ["before", "", "```old", "alpha", "```"].join("\n"),
      ui,
    }));
    const shell = editor.view.dom.querySelector<HTMLElement>(".mdw-code-block")!;

    intersectionObservers.emitFor(shell, true);
    await waitForCodeBlockState(editor, "active");
    await vi.waitFor(() => expect(oldLoader).toHaveBeenCalledTimes(1));

    const codeMirrorDom = shell.querySelector<HTMLElement>(".cm-editor")!;
    const codeMirror = CodeMirrorView.findFromDOM(codeMirrorDom)!;
    const initialBody = codeMirror.state.doc.toString();
    const button = languageButton(editor);

    codeMirror.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(codeMirror.compositionStarted).toBe(true);
    button.click();
    expect(harness.open).not.toHaveBeenCalled();
    codeMirror.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );

    button.click();
    const request = harness.requests[0]!;
    expect(request.language).toBe("old");
    expect(request.update("next")).toBe(true);
    await vi.waitFor(() => expect(nextLoader).toHaveBeenCalledTimes(1));

    const sameCodeMirrorDom = shell.querySelector<HTMLElement>(".cm-editor")!;
    expect(sameCodeMirrorDom).toBe(codeMirrorDom);
    expect(CodeMirrorView.findFromDOM(sameCodeMirrorDom)).toBe(codeMirror);
    expect(codeMirror.state.doc.toString()).toBe(initialBody);

    oldLanguage.resolve(languageMarker("old", oldMounted));
    await oldLanguage.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(oldMounted).not.toHaveBeenCalled();
    expect(codeMirror.dom.dataset.loadedLanguage).toBeUndefined();

    nextLanguage.resolve(languageMarker("next", nextMounted));
    await nextLanguage.promise;
    await vi.waitFor(() => {
      expect(nextMounted).toHaveBeenCalledTimes(1);
      expect(codeMirror.dom.dataset.loadedLanguage).toBe("next");
    });
  });
});
