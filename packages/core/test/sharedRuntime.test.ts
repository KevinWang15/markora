import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as full } from "../src/createEditor";
import { createEditor as minimal } from "../src/minimalEditor";
import type { MarkdownEditor } from "../src/editorApi";

const editors: MarkdownEditor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// These contracts intentionally run through both public assemblies. Shared runtime
// changes must preserve behavior without importing full-only features into minimal.
describe.each([{ name: "full", create: full }, { name: "minimal", create: minimal }])("$name runtime contracts", ({ create }) => {
  function mount(options: Partial<Parameters<typeof create>[0]> = {}) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = create({ element, markdown: "hello", ...options });
    editors.push(editor);
    return editor;
  }

  it("suppresses stale outer events after a subscriber replaces the document", () => {
    const editor = mount();
    const updates: string[] = [];
    editor.subscribe("update", () => updates.push(editor.getMarkdown()));
    editor.subscribe("state", event => {
      if (event.origin === "user") editor.commands.resetMarkdown("replacement");
    });
    editor.view.dispatch(editor.view.state.tr.insertText("!", 2));
    expect(updates).toEqual(["replacement"]);
    expect(editor.getMarkdown()).toBe("replacement");
  });

  it("finishes state delivery when an onTransaction callback throws", () => {
    const failure = new Error("host callback");
    const editor = mount({ onTransaction() { throw failure; } });
    const update = vi.fn();
    editor.subscribe("update", update);
    expect(() => editor.view.dispatch(editor.view.state.tr.insertText("!", 2))).toThrow(failure);
    expect(editor.getMarkdown()).toBe("h!ello");
    expect(update).toHaveBeenCalledOnce();
  });

  it("does not deliver queued focus after destruction", async () => {
    const editor = mount();
    const focused = vi.fn();
    editor.subscribe("focus", focused);
    editor.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    editor.destroy();
    await Promise.resolve();
    expect(focused).not.toHaveBeenCalled();
  });

  it("validates DOM options atomically and preserves readonly accessibility", () => {
    const editor = mount({ editable: false, ariaLabel: "Document" });
    expect(() => editor.updateOptions({ editable: true, attributes: { onclick: "bad" } })).toThrow();
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Document");
    editor.updateOptions({ ariaLabel: null, placeholder: "Write here" });
    expect(editor.view.dom.hasAttribute("aria-label")).toBe(false);
    expect(editor.view.dom.getAttribute("aria-placeholder")).toBe("Write here");
  });
});
