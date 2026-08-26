import { describe, expect, it } from "vitest";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";

describe("Markdown task-prefix fidelity", () => {
  it.each([
    ["escaped checked prefix", "* \\[x\\] literal", "* \\[x\\] literal"],
    ["escaped unchecked prefix", "* \\[ \\] literal", "* \\[ \\] literal"],
    ["entity-decoded prefix", "* &#91;x] entity", "* \\[x\\] entity"],
  ])("keeps a %s as ordinary list text", (_label, input, expected) => {
    const codec = createCompatibilityMarkdownCodec();
    const document = codec.parse(input)!;
    const item = document.firstChild!.firstChild!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(item.attrs.checked).toBeNull();
    expect(item.textContent).toContain("[");
    expect(serialized).toBe(expected);
    expect(reparsed.eq(document)).toBe(true);
  });

  it.each([
    ["checked", "* [x] genuine", true, "* [x] genuine"],
    ["uppercase checked", "* [X] genuine", true, "* [x] genuine"],
    ["unchecked", "* [ ] genuine", false, "* [ ] genuine"],
    ["empty checked", "* [x]", true, "* [x] "],
    ["empty unchecked", "* [ ]", false, "* [ ] "],
    ["tab-separated", "* [x]\tgenuine", true, "* [x] genuine"],
    ["continued", "* [x]\n  genuine", true, "* [x] genuine"],
  ])("round-trips a %s task semantically", (_label, input, checked, expected) => {
    const codec = createCompatibilityMarkdownCodec();
    const document = codec.parse(input)!;
    const item = document.firstChild!.firstChild!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(item.attrs.checked).toBe(checked);
    expect(serialized).toBe(expected);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(expected);
  });

  it.each([
    [
      "a second paragraph",
      "* [x] first\n\n  second paragraph",
      "* [x] first\n\n  second paragraph",
    ],
    [
      "a nested ordinary list",
      "* [x] parent\n  * child",
      "* [x] parent\n  * child",
    ],
    [
      "a nested task",
      "* [x] parent\n  * [ ] child",
      "* [x] parent\n  * [ ] child",
    ],
    [
      "a code block",
      "* [x] first\n\n      code",
      "* [x] first\n\n  ```\n  code\n  ```",
    ],
  ])("round-trips a task containing %s", (_label, input, expected) => {
    const codec = createCompatibilityMarkdownCodec();
    const document = codec.parse(input)!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(serialized).toBe(expected);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(expected);
  });
});
