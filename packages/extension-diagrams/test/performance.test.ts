import { expect, it } from "vitest";
import { createEditor } from "markora";
import { createDiagramsExtension } from "../src/index";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

it("mounts and position-remaps 512 source-only diagrams within the retained broad CI bound", () => {
  const kinds = ["mermaid", "geojson", "topojson", "stl"] as const;
  const fences = Array.from({ length: 512 }, (_, index) => [
    `\`\`\`${kinds[index % kinds.length]} item=${index}`,
    `${kinds[index % kinds.length]} source ${index}`,
    "```",
  ].join("\n"));
  const markdown = ["preamble", ...fences].join("\n\n");
  const element = document.createElement("div");
  document.body.append(element);
  const extension = createDiagramsExtension();
  const started = performance.now();
  const editor = createEditor({ element, extensions: [extension], markdown });
  const handle = editor.extensions.get(extension);
  const before = handle.state.getNodes();

  expect(before).toHaveLength(512);
  editor.view.dispatch(editor.view.state.tr.insertText("!", 1));
  const after = handle.state.getNodes();
  expect(after.map(({ identity }) => identity)).toEqual(before.map(({ identity }) => identity));
  expect(after.every((node, index) => node.position === before[index]!.position + 1)).toBe(true);
  expect(editor.getMarkdown()).toContain("```mermaid item=0\nmermaid source 0\n```");
  expect(performance.now() - started).toBeLessThan(20_000);

  editor.destroy();
  element.remove();
}, 25_000);
