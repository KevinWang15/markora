import { describe, expect, it } from "vitest";
import { createEditor } from "../src/createEditor";
import { createEditor as createMinimalEditor } from "../src/minimalEditor";

for (const [name, create] of [["root", createEditor], ["minimal", createMinimalEditor]] as const) {
  describe(`${name} resource context changes`, () => {
    it("reloads identical image URLs without changing history, selection, or document", () => {
      const element = document.createElement("div");
      document.body.append(element);
      let base = "https://example.com/a/";
      const requests: string[] = [];
      const editor = create({ element, markdown: "![alt](photo.png)\n\ntext", resources: {
        resolveUrl: ({ url }) => new URL(url, base).href,
        loadImage: ({ url }) => { requests.push(url); return { src: url }; },
      } });
      editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
      const doc = editor.view.state.doc;
      const selection = editor.view.state.selection;
      base = "https://example.com/b/";
      editor.refreshResources();
      expect(requests).toEqual(["https://example.com/a/photo.png", "https://example.com/b/photo.png"]);
      expect(editor.view.state.doc).toBe(doc);
      expect(editor.view.state.selection).toBe(selection);
      expect(editor.state.can.undo()).toBe(true);
      editor.destroy();
      expect(() => editor.refreshResources()).toThrow();
      element.remove();
    });
  });
}
