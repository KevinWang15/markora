import { describe, expect, it } from "vitest";
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from "prosemirror-model";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";
import { normalizeMarkdownEditorResources } from "../src/resourcePolicy";

function linkSnapshots(markdown: string) {
  const codec = createCompatibilityMarkdownCodec();
  const document = codec.parse(markdown)!;
  const links: Array<{ autolink: boolean; href: string; text: string }> = [];

  document.descendants((node) => {
    if (!node.isText) return;
    const link = node.marks.find((mark) => mark.type.name === "link");
    if (!link) return;
    links.push({
      autolink: link.attrs.autolink === true,
      href: String(link.attrs.href),
      text: node.text ?? "",
    });
  });

  return { codec, document, links };
}

describe("Markdown bare-autolink fidelity", () => {
  it("imports and canonically retains bare domains, URLs, and email addresses", () => {
    const markdown = "Visit www.commonmark.org, https://example.com/a, and person@example.com.";
    const { codec, document, links } = linkSnapshots(markdown);
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;

    expect(links).toEqual([
      { autolink: true, href: "http://www.commonmark.org/", text: "www.commonmark.org" },
      { autolink: true, href: "https://example.com/a", text: "https://example.com/a" },
      { autolink: true, href: "mailto:person@example.com", text: "person@example.com" },
    ]);
    expect(serialized).toBe(markdown);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(markdown);
  });

  it("keeps explicit links explicit even when their labels resemble bare links", () => {
    const markdown = "[www.example.com](https://destination.example/path)";
    const { codec, document, links } = linkSnapshots(markdown);

    expect(links).toEqual([{
      autolink: false,
      href: "https://destination.example/path",
      text: "www.example.com",
    }]);
    expect(codec.serialize(document)).toBe(markdown);
  });

  it("retains surrounding punctuation and nested inline marks", () => {
    const markdown = "See *(www.example.com)*, https://example.com/a_(b), and person+tag@example.co.uk.";
    const { codec, document, links } = linkSnapshots(markdown);

    expect(links.map(({ href, text }) => ({ href, text }))).toEqual([
      { href: "http://www.example.com/", text: "www.example.com" },
      { href: "https://example.com/a_(b)", text: "https://example.com/a_(b)" },
      { href: "mailto:person+tag@example.co.uk", text: "person+tag@example.co.uk" },
    ]);
    expect(codec.serialize(document)).toBe(markdown);
    expect(codec.parse(markdown)!.eq(document)).toBe(true);
  });

  it("falls back to an explicit link when edited text no longer matches its stored destination", () => {
    const codec = createCompatibilityMarkdownCodec();
    const imported = codec.parse("www.example.com")!;
    const originalLink = imported.firstChild!.firstChild!.marks.find((mark) => mark.type.name === "link")!;
    const edited = codec.schema.nodes.doc.create(null, codec.schema.nodes.paragraph.create(
      null,
      codec.schema.text("www.changed.example", [originalLink]),
    ));

    expect(codec.serialize(edited)).toBe("[www.changed.example](http://www.example.com/)");
  });

  it("retains validated bare-link provenance through rich HTML", () => {
    const codec = createCompatibilityMarkdownCodec();
    const autolink = codec.parse("www.example.com")!;
    const container = document.createElement("div");
    container.append(DOMSerializer.fromSchema(codec.schema).serializeFragment(autolink.content));

    expect(container.innerHTML).toBe(
      '<p><a data-markora-autolink="true" href="http://www.example.com/">www.example.com</a></p>',
    );
    const reparsed = ProseMirrorDOMParser.fromSchema(codec.schema).parse(container);
    const richLink = reparsed.firstChild!.firstChild!.marks.find((mark) => mark.type.name === "link")!;
    expect(richLink.attrs.autolink).toBe(true);
    expect(codec.serialize(reparsed)).toBe("www.example.com");
  });

  it("escapes literal URL-shaped text so reset cannot silently promote it", () => {
    const codec = createCompatibilityMarkdownCodec();
    const text = "Literal www.example.com, https://example.com, and person@example.com.";
    const document = codec.schema.nodes.doc.create(null, codec.schema.nodes.paragraph.create(
      null,
      codec.schema.text(text),
    ));
    const serialized = "Literal www\\.example.com, https\\://example.com, and person\\@example.com.";
    const reparsed = codec.parse(serialized)!;

    expect(codec.serialize(document)).toBe(serialized);
    expect(reparsed.eq(document)).toBe(true);
    expect(codec.serialize(reparsed)).toBe(serialized);
  });

  it("keeps authored escapes, code spans, and rejected protocols noninteractive", () => {
    const markdown = "www\\.example.com `https://code.example` ftp://files.example.com";
    const { codec, document, links } = linkSnapshots(markdown);
    const serialized = "www\\.example.com `https://code.example` ftp\\://files.example.com";

    expect(links).toEqual([]);
    expect(codec.serialize(document)).toBe(serialized);
    expect(codec.parse(serialized)!.eq(document)).toBe(true);
  });

  it("applies the editor URL policy before retaining automatic link marks", () => {
    const codec = createCompatibilityMarkdownCodec([], normalizeMarkdownEditorResources({
      links: { allowedProtocols: ["https:"] },
    }));
    const document = codec.parse("http://blocked.example https://allowed.example")!;
    const links: string[] = [];
    document.descendants((node) => {
      const link = node.marks.find((mark) => mark.type.name === "link");
      if (link) links.push(String(link.attrs.href));
    });

    expect(links).toEqual(["https://allowed.example/"]);
    expect(codec.serialize(document)).toBe(
      "http\\://blocked.example https://allowed.example",
    );
  });
});
