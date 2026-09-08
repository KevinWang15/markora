import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";

afterEach(() => vi.restoreAllMocks());

describe("immutable Markdown normalization", () => {
  it("retains the parser's tree when no normalization is needed", () => {
    const codec = createMarkdownCodec();
    const source = "# Heading\n\nA **bold** paragraph.\n\n* ordinary\n* list\n\n```js\ncode\n```";
    const parsed = codec.parser.parse(source);
    vi.spyOn(codec.parser, "parse").mockReturnValue(parsed);
    expect(codec.parse(source)).toBe(parsed);
  });

  it("copies only the task's ancestor path and retains unaffected blocks", () => {
    const codec = createMarkdownCodec();
    const source = "* [x] task\n\nUnchanged paragraph";
    const parsed = codec.parser.parse(source);
    vi.spyOn(codec.parser, "parse").mockReturnValue(parsed);
    const normalized = codec.parse(source)!;
    expect(normalized).not.toBe(parsed);
    expect(normalized.firstChild).not.toBe(parsed.firstChild);
    expect(normalized.lastChild).toBe(parsed.lastChild);
    expect(normalized.firstChild!.firstChild!.textContent).toBe("task");
    expect(parsed.firstChild!.firstChild!.textContent).toBe("[x] task");
    expect(codec.serialize(normalized)).toBe(source);
  });
});
