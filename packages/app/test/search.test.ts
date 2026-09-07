import { describe, expect, it } from "vitest";
import { createEditor } from "markora";
import { findTextMatches, findRichMatches } from "../src/search";
import { createSearchExtension } from "../src/searchExtension";
const options = { query: "cat", caseSensitive: false, wholeWord: false };

describe("document search", () => {
  it("matches literal punctuation, Unicode case, and whole words", () => {
    expect(findTextMatches("a.b axb a.b", { ...options, query: "a.b" }).matches).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }]);
    expect(findTextMatches("café CAFÉ cafés", { ...options, query: "café", wholeWord: true }).matches).toHaveLength(2);
    expect(findTextMatches("cat catfish cat_ 🐈cat!", { ...options, wholeWord: true }).matches).toHaveLength(2);
    expect(findTextMatches("Cat cat", { ...options, caseSensitive: true }).matches).toHaveLength(1);
  });
  it("explicitly reports truncation instead of silently replacing only some matches", () => {
    expect(findTextMatches("a a a", { ...options, query: "a" }, 0, 2)).toEqual({ matches: [{ from: 0, to: 1 }, { from: 2, to: 3 }], truncated: true });
  });
  it("searches through formatting and replaces atomically without flattening unrelated marks", () => {
    const search = createSearchExtension();
    const editor = createEditor({ element: document.createElement("div"), markdown: "**cat** and ca*t*\n\nKeep **bold**.", extensions: [search] });
    try {
      expect(findRichMatches(editor.view.state.doc, options).matches).toHaveLength(2);
      const handle = editor.extensions.get(search);
      handle.commands.configure(options);
      expect(handle.commands.replace("dog")).toBe(true);
      expect(editor.getMarkdown()).toContain("**bold**");
      expect(editor.view.state.doc.textContent).toBe("dog and dogKeep bold.");
      editor.commands.undo();
      expect(editor.view.state.doc.textContent).toBe("cat and catKeep bold.");
    } finally { editor.destroy(); }
  });
});
