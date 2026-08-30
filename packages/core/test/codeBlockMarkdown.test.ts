import { describe, expect, it } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";
import { codeBlockDomAttrs } from "../src/schemaContributionOrder";

const codecFactories = [
  ["compatibility", createMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const;

describe.each(codecFactories)("%s fenced code serialization", (_name, createCodec) => {
  it("preserves the complete info string and lengthens a backtick fence for the body", () => {
    const codec = createCodec();
    const input = [
      "~~~{typescript strict=true #sample}",
      "````",
      "~~~",
    ].join("\n");
    const expected = [
      "`````{typescript strict=true #sample}",
      "````",
      "`````",
    ].join("\n");
    const doc = codec.parse(input)!;

    expect(doc.firstChild?.attrs.params).toBe("{typescript strict=true #sample}");
    expect(codec.serialize(doc)).toBe(expected);
    expect(codec.parse(expected)?.eq(doc)).toBe(true);
  });

  it("uses a sufficiently long tilde fence when the info string contains a backtick", () => {
    const codec = createCodec();
    const markdown = [
      "~~~~~~lang`variant metadata=true",
      "~~~",
      "~~~~~",
      "~~~~~~",
    ].join("\n");
    const doc = codec.parse(markdown)!;

    expect(doc.firstChild?.attrs.params).toBe("lang`variant metadata=true");
    expect(codec.serialize(doc)).toBe(markdown);
    expect(codec.parse(codec.serialize(doc))?.eq(doc)).toBe(true);
  });

  it("separates a leading info tilde from a tilde fence", () => {
    const codec = createCodec();
    const codeBlock = codec.schema.nodes.code_block.create(
      { params: "~lang`variant" },
      codec.schema.text("const value = 1"),
    );
    const paragraph = codec.schema.nodes.paragraph.create(
      null,
      codec.schema.text("after"),
    );
    const doc = codec.schema.nodes.doc.create(null, [codeBlock, paragraph]);
    const markdown = codec.serialize(doc);

    expect(markdown).toBe([
      "~~~ ~lang`variant",
      "const value = 1",
      "~~~",
      "",
      "after",
    ].join("\n"));
    expect(codec.parse(markdown)?.eq(doc)).toBe(true);
  });

  it("rejects an unrepresentable line break in a raw params attribute", () => {
    const codec = createCodec();
    const codeBlock = codec.schema.nodes.code_block.create(
      { params: "typescript\n# injected" },
      codec.schema.text("const value = 1"),
    );
    const doc = codec.schema.nodes.doc.create(null, codeBlock);

    expect(() => codec.serialize(doc)).toThrowError(
      new RangeError("Code block info must contain no NUL or line-break characters."),
    );
  });

  it("rejects NUL because CommonMark parsing cannot preserve it exactly", () => {
    const codec = createCodec();
    const codeBlock = codec.schema.nodes.code_block.create(
      { params: "typescript\0strict" },
      codec.schema.text("const value = 1"),
    );
    const doc = codec.schema.nodes.doc.create(null, codeBlock);

    expect(() => codec.serialize(doc)).toThrowError(
      new RangeError("Code block info must contain no NUL or line-break characters."),
    );
  });

  it("rejects non-normalized raw info attributes instead of silently trimming them", () => {
    const codec = createCodec();
    const codeBlock = codec.schema.nodes.code_block.create(
      { params: "  typescript  " },
      codec.schema.text("const value = 1"),
    );
    const doc = codec.schema.nodes.doc.create(null, codeBlock);

    expect(() => codec.serialize(doc)).toThrowError(
      new RangeError("Code block info must be normalized without surrounding whitespace."),
    );
  });

  it.each(["const value = '\0'", "first\rsecond"])(
    "rejects code text that Markdown parsing cannot preserve: %j",
    (text) => {
      const codec = createCodec();
      const codeBlock = codec.schema.nodes.code_block.create(
        { params: "text" },
        codec.schema.text(text),
      );
      const doc = codec.schema.nodes.doc.create(null, codeBlock);

      expect(() => codec.serialize(doc)).toThrowError(
        new RangeError("Code block text must contain no NUL or carriage-return characters."),
      );
    },
  );
});

describe("code-block DOM params", () => {
  it("preserves a legal complete info string including backticks", () => {
    const pre = document.createElement("pre");
    pre.setAttribute("data-params", "lang`variant metadata=true");

    expect(codeBlockDomAttrs(pre)).toEqual({
      params: "lang`variant metadata=true",
    });
  });

  it("drops line-bearing private params and falls back to a portable language class", () => {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.setAttribute("data-params", "typescript\r\n# injected");
    code.className = "language-ts";
    pre.append(code);

    expect(codeBlockDomAttrs(pre)).toEqual({ params: "ts" });

    code.removeAttribute("class");
    expect(codeBlockDomAttrs(pre)).toEqual({ params: "" });
  });

  it("drops NUL-bearing private params before Markdown serialization", () => {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.setAttribute("data-params", "typescript\0strict");
    code.className = "language-ts";
    pre.append(code);

    expect(codeBlockDomAttrs(pre)).toEqual({ params: "ts" });
  });

  it("normalizes surrounding whitespace in private params", () => {
    const pre = document.createElement("pre");
    pre.setAttribute("data-params", "  typescript strict=true  ");

    expect(codeBlockDomAttrs(pre)).toEqual({
      params: "typescript strict=true",
    });
  });
});
