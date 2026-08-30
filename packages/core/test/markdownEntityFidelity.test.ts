import { describe, expect, it } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

function expectStableMarkdown(
  codec: ReturnType<typeof createMarkdownCodec>,
  input: string,
  expected: string,
) {
  const document = codec.parse(input)!;
  const serialized = codec.serialize(document);
  const reparsed = codec.parse(serialized)!;

  expect(serialized).toBe(expected);
  expect(reparsed.eq(document)).toBe(true);
  expect(codec.serialize(reparsed)).toBe(expected);
}

describe.each([
  ["root", () => createMarkdownCodec()],
  ["minimal", () => createMinimalMarkdownCodec()],
] as const)("%s Markdown entity fidelity", (_entry, createCodec) => {
  it("keeps entity-shaped literal text literal across serialization", () => {
    expectStableMarkdown(
      createCodec(),
      String.raw`Literal \&copy; \&#10; \&#x0A; \&NotEqualTilde; &bogus;`,
      String.raw`Literal \&copy; \&#10; \&#x0A; \&NotEqualTilde; &bogus;`,
    );
  });

  it("encodes entity-produced structural whitespace without changing the text node", () => {
    expectStableMarkdown(
      createCodec(),
      "&#9;A&#10;B&#13;C&nbsp;",
      "&#9;A&#10;B&#13;C&#160;",
    );
  });

  it("preserves entity-sensitive text inside marks, links, images, and headings", () => {
    expectStableMarkdown(
      createCodec(),
      [
        "# A&#10;B",
        "",
        String.raw`**\&copy;** [A&#13;B](/target "title&#13;line") ![\&copy;](/image.png "title&#13;line")`,
      ].join("\n"),
      [
        "# A&#10;B",
        "",
        String.raw`**\&copy;** [A&#13;B](/target "title&#13;line") ![\&copy;](/image.png "title&#13;line")`,
      ].join("\n"),
    );
  });
});

describe("root entity boundaries", () => {
  it("does not let decoded entity text extend an adjacent bare autolink after reset", () => {
    expectStableMarkdown(
      createMarkdownCodec(),
      "Boundary www.example.com/?x=&copy; remains split.",
      "Boundary www.example.com/?x=&#169; remains split.",
    );
  });

  it("does not turn entity-produced cell line breaks into raw HTML or extra rows", () => {
    const codec = createMarkdownCodec();
    const input = "| h |\n| --- |\n| A&#10;B&#13;C |";
    const expected = "| h |\n| --- |\n| A&#10;B&#13;C |";
    const document = codec.parse(input)!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(serialized).toBe(expected);
    expect(reparsed.eq(document)).toBe(true);
    expect(reparsed.textContent).toBe("hA\nB\rC");
    expect(JSON.stringify(reparsed.toJSON())).not.toContain("raw_inline");
  });
});
