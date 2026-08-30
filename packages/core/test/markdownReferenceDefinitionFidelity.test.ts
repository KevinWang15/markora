import { describe, expect, it } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";

describe("reference-definition fidelity", () => {
  it("preserves used and unused definitions while resolving reference links", () => {
    const markdown = [
      "[unused]: https://example.com \"kept\"",
      "",
      "Before.",
      "",
      "[used]: /target \"title\"",
      "",
      "Use [label][used].",
    ].join("\n");
    const canonical = [
      "[unused]: https://example.com \"kept\"",
      "",
      "Before.",
      "",
      "[used]: /target \"title\"",
      "",
      "Use [label](/target \"title\").",
    ].join("\n");
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    const definitions = document.content.content.filter((node) => (
      node.type.name === "raw_block" && node.attrs.kind === "reference-definition"
    ));

    expect(definitions.map((node) => node.attrs.source)).toEqual([
      "[unused]: https://example.com \"kept\"",
      "[used]: /target \"title\"",
    ]);
    expect(document.textContent).toContain("Use label.");
    expect(codec.serialize(document)).toBe(canonical);
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("retains exact top-level multiline source and duplicate definitions", () => {
    const markdown = [
      "[multi]:\r\n  </a b>\r\n  'line title'",
      "",
      "[multi]: /ignored \"duplicate\"",
      "",
      "[multi]",
    ].join("\r\n");
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    const definitions = document.content.content.filter((node) => node.type.name === "raw_block");

    expect(definitions.map((node) => node.attrs.source)).toEqual([
      "[multi]:\r\n  </a b>\r\n  'line title'",
      "[multi]: /ignored \"duplicate\"",
    ]);
    expect(codec.serialize(document)).toContain("[multi](/a%20b \"line title\")");
    expect(codec.parse(codec.serialize(document))!.eq(document)).toBe(true);
  });

  it("keeps invalid definition-looking text ordinary", () => {
    const codec = createMarkdownCodec();
    const document = codec.parse("[label]:\n\n[label]")!;

    expect(document.content.content.some((node) => node.type.name === "raw_block")).toBe(false);
    expect(codec.serialize(document)).toBe("\\[label\\]:\n\n\\[label\\]");
  });

  it("retains definitions and resolved uses inside blockquotes and lists", () => {
    const markdown = [
      "> [quoted]: /q",
      ">",
      "> [quoted]",
      "",
      "* item",
      "",
      "  [nested]: /n",
      "",
      "  [nested]",
    ].join("\n");
    const canonical = [
      "> [quoted]: /q",
      ">",
      "> [quoted](/q)",
      "",
      "* item",
      "",
      "  [nested]: /n",
      "",
      "  [nested](/n)",
    ].join("\n");
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    const definitions: string[] = [];
    document.descendants((node) => {
      if (node.type.name === "raw_block") definitions.push(node.attrs.source);
    });

    expect(definitions).toEqual(["[quoted]: /q", "[nested]: /n"]);
    expect(codec.serialize(document)).toBe(canonical);
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("keeps an unsafe definition inert while stripping its resolved link mark", () => {
    const markdown = "[bad]: javascript:alert(1)\n\n[bad]";
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    const definition = document.firstChild!;
    const label = document.lastChild!.firstChild!;

    expect(definition.type.name).toBe("raw_block");
    expect(definition.attrs).toMatchObject({
      kind: "reference-definition",
      source: "[bad]: javascript:alert(1)",
    });
    expect(label.text).toBe("bad");
    expect(label.marks).toHaveLength(0);
    expect(codec.serialize(document)).toBe("[bad]: javascript:alert(1)\n\nbad");
  });
});
