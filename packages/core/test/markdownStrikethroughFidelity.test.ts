import { describe, expect, it } from "vitest";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";

function strikeTexts(markdown: string) {
  const codec = createCompatibilityMarkdownCodec();
  const document = codec.parse(markdown)!;
  const texts: string[] = [];

  document.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === "strike")) {
      texts.push(node.text ?? "");
    }
  });

  return { codec, document, texts };
}

describe("Markdown strikethrough delimiter fidelity", () => {
  it.each([
    ["three", "Before ~~~three~~~ after."],
    ["four", "Before ~~~~four~~~~ after."],
    ["five", "Before ~~~~~five~~~~~ after."],
  ])("keeps runs of %s tildes literal", (_label, markdown) => {
    const { codec, document, texts } = strikeTexts(markdown);
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(texts).toEqual([]);
    expect(serialized).toBe(markdown);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(markdown);
  });

  it("keeps triple tildes literal beside an exact double-tilde mark", () => {
    const markdown = "This will ~~~not~~~ strike, but ~~this~~ will.";
    const { codec, document, texts } = strikeTexts(markdown);
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(texts).toEqual(["this"]);
    expect(serialized).toBe(markdown);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(markdown);
  });

  it("continues to recognize only exact double-tilde marks", () => {
    const markdown = "A ~single~ stays literal and ~~double~~ is struck.";
    const { codec, document, texts } = strikeTexts(markdown);
    const serialized = "A \\~single\\~ stays literal and ~~double~~ is struck.";

    expect(texts).toEqual(["double"]);
    expect(codec.serialize(document)).toBe(serialized);
    expect(codec.parse(serialized)!.eq(document)).toBe(true);
  });

  it.each([
    ["a paragraph", "\\~\\~\\~ literal", "\\~\\~\\~ literal"],
    ["a blockquote", "> \\~\\~\\~ literal", "> \\~\\~\\~ literal"],
    ["a list item", "* \\~\\~\\~ literal", "* \\~\\~\\~ literal"],
    ["a hard-break continuation", "before  \n\\~\\~\\~ literal", "before\\\n\\~\\~\\~ literal"],
  ])("keeps block-leading long runs escaped inside %s", (_label, input, expected) => {
    const { codec, document, texts } = strikeTexts(input);
    const serialized = codec.serialize(document);

    expect(texts).toEqual([]);
    expect(serialized).toBe(expected);
    expect(codec.parse(serialized)!.eq(document)).toBe(true);
  });
});
