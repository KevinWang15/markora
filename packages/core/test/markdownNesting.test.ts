import { describe, expect, it } from "vitest";
import { createEditor as createRootEditor } from "../src/createEditor";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";
import { createEditor as createMinimalEditor } from "../src/minimalEditor";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

function nestedList(depth: number) {
  return Array.from(
    { length: depth },
    (_, index) => `${"  ".repeat(index)}* level-${index + 1}`,
  ).join("\n");
}

describe.each([
  ["root", createCompatibilityMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const)("%s Markdown nesting", (_name, createCodec) => {
  it("round-trips the deepest supported nested list without losing content", () => {
    const codec = createCodec();
    const markdown = nestedList(127);

    expect(codec.serialize(codec.parse(markdown)!)).toBe(markdown);
  });

  it.each([128, 260])(
    "rejects %i nested list items instead of returning a partial document",
    (depth) => {
      const codec = createCodec();

      expect(() => codec.parse(nestedList(depth))).toThrowError(
        new RangeError("Markdown nesting exceeds Markora's supported structural depth."),
      );
    },
  );
});

describe.each([
  ["root", (element: HTMLElement, markdown: string) => createRootEditor({ element, markdown })],
  ["minimal", (element: HTMLElement, markdown: string) => createMinimalEditor({ element, markdown })],
] as const)("%s editor Markdown nesting", (_name, createEditor) => {
  it("rejects deep external updates atomically and remains usable", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = createEditor(element, "stable");
    const overLimit = nestedList(128);

    expect(() => editor.commands.reconcileMarkdown(overLimit)).toThrowError(RangeError);
    expect(editor.getMarkdown()).toBe("stable");
    expect(() => editor.commands.resetMarkdown(overLimit)).toThrowError(RangeError);
    expect(editor.getMarkdown()).toBe("stable");

    editor.commands.resetMarkdown("still usable");
    expect(editor.getMarkdown()).toBe("still usable");
    editor.destroy();
    element.remove();
  });

  it("does not claim a host when initial Markdown exceeds the limit", () => {
    const element = document.createElement("div");
    document.body.append(element);

    expect(() => createEditor(element, nestedList(128))).toThrowError(RangeError);
    expect(element.childNodes).toHaveLength(0);

    const recovered = createEditor(element, "recovered");
    expect(recovered.getMarkdown()).toBe("recovered");
    recovered.destroy();
    element.remove();
  });
});
