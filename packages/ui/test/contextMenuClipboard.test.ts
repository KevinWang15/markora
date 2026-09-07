import { afterEach, expect, it, vi } from "vitest";
import { createEditor, type MarkdownEditor } from "markora";
import { copySelection, pasteClipboard } from "../src/contextMenuClipboard";
import type { ContextMenuContext } from "../src/contextMenuTypes";
const editors: MarkdownEditor[] = [];
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = (() => []) as unknown as typeof Range.prototype.getClientRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
function setup(markdown = "hello **world**") {
  const host = document.createElement("div"); document.body.append(host);
  const editor = createEditor({ element: host, markdown }); editors.push(editor);
  editor.focus({ anchor: 7, head: 12 });
  const { doc, selection } = editor.view.state; const abort = new AbortController();
  const context: ContextMenuContext = { editor, selection, source: "keyboard", signal: abort.signal,
    isCurrent: () => !abort.signal.aborted && !editor.isDestroyed && editor.view.state.doc === doc && editor.view.state.selection.eq(selection) };
  return { editor, context, abort };
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); });

it("copies rich selection metadata and only cuts after a successful write, with undo", async () => {
  const { editor, context } = setup(); const write = vi.fn(async (_content: unknown) => {});
  await expect(copySelection(context, { write }, true)).resolves.toBe(true);
  expect(write.mock.calls[0][0]).toMatchObject({ html: expect.stringContaining("<strong>world</strong>") });
  expect(editor.getMarkdown()).toBe("hello ");
  expect(editor.commands.undo()).toBe(true); expect(editor.getMarkdown()).toBe("hello **world**");
});

it("never deletes selected text when clipboard writing fails", async () => {
  const { editor, context } = setup();
  await expect(copySelection(context, { write: async () => { throw new Error("permission denied"); } }, true)).rejects.toThrow("permission denied");
  expect(editor.getMarkdown()).toBe("hello **world**");
});

it.each(["document", "selection", "readonly", "abort"] as const)("rejects a delayed cut after a %s change", async kind => {
  const { editor, context, abort } = setup(); let finish!: () => void;
  const pending = copySelection(context, { write: () => new Promise(resolve => { finish = resolve; }) }, true);
  if (kind === "document") editor.commands.reconcileMarkdown("replacement");
  if (kind === "selection") editor.focus("start");
  if (kind === "readonly") editor.updateOptions({ editable: false });
  if (kind === "abort") abort.abort();
  const before = editor.getMarkdown(); finish();
  await expect(pending).resolves.toBe(false); expect(editor.getMarkdown()).toBe(before);
});

it("never applies a delayed paste to a replacement document", async () => {
  const { editor, context } = setup(); let finish!: (value: { text: string }) => void;
  const pending = pasteClipboard(context, { read: () => new Promise(resolve => { finish = resolve; }) });
  editor.commands.reconcileMarkdown("new document"); finish({ text: "stale clipboard" });
  await expect(pending).resolves.toBe(false); expect(editor.getMarkdown()).toBe("new document");
});

it("uses rich paste sanitization and literal plain-text paste as separate actions", async () => {
  const first = setup();
  await pasteClipboard(first.context, { read: async () => ({ text: "bold", html: '<strong>bold</strong><script>alert(1)</script>' }) });
  expect(first.editor.getMarkdown()).toBe("hello **bold**");
  const second = setup();
  await pasteClipboard(second.context, { read: async () => ({ text: "**literal**", html: "<strong>bold</strong>" }) }, true);
  expect(second.editor.getMarkdown()).toBe("hello \\*\\*literal\\*\\*");
});
