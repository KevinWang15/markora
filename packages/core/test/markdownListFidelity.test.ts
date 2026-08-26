import { describe, expect, it } from "vitest";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

describe.each([
  ["root", createCompatibilityMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const)("%s Markdown list fidelity", (name, createCodec) => {
  it.each([
    {
      label: "adjacent bullet lists",
      input: "- alpha\n+ beta\n* gamma",
      expected: "* alpha\n- beta\n* gamma",
    },
    {
      label: "adjacent ordered lists",
      input: "1) alpha\n2. beta\n3) gamma",
      expected: "1. alpha\n2) beta\n3. gamma",
    },
    {
      label: "zero-start ordered lists",
      input: "0) zero\n1) one",
      expected: "0. zero\n1. one",
    },
    {
      label: "nested adjacent lists",
      input: "* outer\n  * inner\n  - split\n* tail",
      expected: "* outer\n  * inner\n  - split\n* tail",
    },
    {
      label: "adjacent task-looking lists",
      input: "* [x] done\n- [ ] separate",
      expected: "* [x] done\n- [ ] separate",
      expectedMinimal: "* \\[x\\] done\n- \\[ \\] separate",
    },
  ])("round-trips $label without merging structure", ({ expected, expectedMinimal, input }) => {
    const codec = createCodec();
    const document = codec.parse(input)!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;
    const canonical = name === "minimal" && expectedMinimal
      ? expectedMinimal
      : expected;

    expect(serialized).toBe(canonical);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(canonical);
  });
});
