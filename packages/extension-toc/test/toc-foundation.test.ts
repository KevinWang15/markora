import { describe, expect, it } from "vitest";
import { MarkdownIt } from "markora/extension-api";
import {
  defaultTocMessages,
  normalizeTocMessages,
} from "../src/messages";
import { createTocBlockRule } from "../src/tokenizer";

const tokenType = "markora_extension_toc";

function parse(source: string) {
  const markdown = new MarkdownIt("commonmark");
  markdown.block.ruler.before(
    "hr",
    "markora_extension_toc",
    createTocBlockRule(tokenType),
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  return markdown.parse(source, {});
}

function tokenTypes(source: string) {
  return parse(source).map(({ type }) => type);
}

describe("TOC tokenizer foundation", () => {
  it.each([
    "[TOC]",
    "[toc]",
    "[ToC]",
    " [toc] ",
    "   [TOC]\t",
  ])("claims the standalone top-level marker %j", (source) => {
    const token = parse(source).find(({ type }) => type === tokenType);

    expect(token).toMatchObject({
      block: true,
      content: "[TOC]",
      map: [0, 1],
      markup: "[TOC]",
      meta: { canonicalMarker: "[TOC]" },
    });
  });

  it("interrupts adjacent root paragraphs only at an exact standalone line", () => {
    expect(tokenTypes("before\n[TOC]\nafter")).toEqual([
      "paragraph_open",
      "inline",
      "paragraph_close",
      tokenType,
      "paragraph_open",
      "inline",
      "paragraph_close",
    ]);
    expect(tokenTypes("before [TOC] after")).not.toContain(tokenType);
  });

  it.each([
    ["escaped", String.raw`\[TOC]`],
    ["inline code", "`[TOC]`"],
    ["fenced code", "```\n[TOC]\n```"],
    ["indented code", "    [TOC]"],
    ["tab-indented code", "\t[TOC]"],
    ["blockquote content", "> [TOC]"],
    ["list content", "* [TOC]"],
    ["trailing prose", "[TOC] later"],
    ["internal whitespace", "[ TOC ]"],
    ["non-ASCII padding", "\u00a0[TOC]"],
  ])("leaves %s outside TOC semantics", (_label, source) => {
    expect(tokenTypes(source)).not.toContain(tokenType);
  });
});

describe("TOC message contract", () => {
  it("provides frozen English defaults with unique multiple-landmark labels", () => {
    expect(Object.isFrozen(defaultTocMessages)).toBe(true);
    expect(defaultTocMessages.navigationLabel(1, 1)).toBe("Table of contents");
    expect(defaultTocMessages.navigationLabel(1, 2)).toBe(
      "Table of contents 1 of 2",
    );
    expect(defaultTocMessages.navigationLabel(2, 2)).toBe(
      "Table of contents 2 of 2",
    );
    expect(defaultTocMessages.goToHeadingLabel("Details", 2, 3)).toContain(
      "Details",
    );
    expect(defaultTocMessages.invalidPlacementDiagnostic).toContain("top-level");
  });

  it("validates, wraps, and freezes partial message overrides", () => {
    const messages = normalizeTocMessages({
      emptyState: "Sin encabezados",
      goToHeadingLabel: (label, level) => `Ir a ${label}, nivel ${level}`,
      navigationLabel: (occurrence, total) => `Índice ${occurrence}/${total}`,
    });

    expect(Object.isFrozen(messages)).toBe(true);
    expect(messages.emptyState).toBe("Sin encabezados");
    expect(messages.navigationLabel(2, 3)).toBe("Índice 2/3");
    expect(messages.goToHeadingLabel("Detalles", 2, 1)).toBe(
      "Ir a Detalles, nivel 2",
    );
    expect(normalizeTocMessages(undefined)).toBe(defaultTocMessages);
  });

  it("rejects invalid message objects, keys, values, and formatter output", () => {
    expect(() => normalizeTocMessages(null as never)).toThrow(TypeError);
    expect(() => normalizeTocMessages([] as never)).toThrow(TypeError);
    expect(() => normalizeTocMessages({ unknown: "value" } as never)).toThrow(
      'Unknown TOC message key "unknown".',
    );
    expect(() => normalizeTocMessages({ emptyState: " " })).toThrow(
      'TOC message "emptyState" must be a non-empty string.',
    );
    expect(() => normalizeTocMessages({ navigationLabel: "label" as never }))
      .toThrow('TOC message "navigationLabel" must be a formatter function.');
    expect(() => normalizeTocMessages({ navigationLabel: () => "" })).toThrow(
      'TOC message "navigationLabel" must be a non-empty string.',
    );

    const messages = normalizeTocMessages({
      goToHeadingLabel: (label) => label === "Introduction" ? "Valid" : "",
    });
    expect(() => messages.goToHeadingLabel("", 1, 1)).toThrow(
      'TOC message "goToHeadingLabel" must be a non-empty string.',
    );
  });
});
