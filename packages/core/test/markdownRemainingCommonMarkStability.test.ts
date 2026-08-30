import { describe, expect, it } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

function expectStable(
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
] as const)("%s remaining CommonMark stability", (_entry, createCodec) => {
  it("retains escaped trailing hashes as heading content", () => {
    expectStable(
      createCodec(),
      "### foo \\###\n## foo #\\##\n# foo \\#\n",
      "### foo \\###\n\n## foo \\###\n\n# foo \\#",
    );
  });

  it("keeps tight multi-block list items tight", () => {
    expectStable(
      createCodec(),
      "* a\n  > b\n  >\n* c\n",
      "* a\n  > b\n* c",
    );
    expectStable(
      createCodec(),
      "- a\n  > b\n  ```\n  c\n  ```\n- d\n",
      "* a\n  > b\n  ```\n  c\n  ```\n* d",
    );
  });

  it.each([
    {
      input: "*foo **bar *baz* bim** bop*\n",
      expected: "*foo* ***bar baz*** **bim** bop",
    },
    {
      input: "***foo* bar**\n",
      expected: "***foo*** **bar**",
    },
    {
      input: "**foo *bar **baz**\nbim* bop**\n",
      expected: "**foo** ***bar baz*** *bim* bop",
    },
  ])("normalizes crossing emphasis and strong marks without losing them", ({ input, expected }) => {
    expectStable(createCodec(), input, expected);
  });
});

it("keeps minimal escaped email-like angle text literal", () => {
  expectStable(
    createMinimalMarkdownCodec(),
    "<foo\\+@bar.example.com>\n",
    "\\<foo+@bar.example.com>",
  );
});
