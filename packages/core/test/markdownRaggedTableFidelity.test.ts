import { describe, expect, it } from "vitest";
import { createMarkdownCodec } from "../src/markdownCodec";

function tableRows(markdown: string) {
  const codec = createMarkdownCodec();
  const document = codec.parse(markdown)!;
  const table = document.firstChild!;

  return {
    codec,
    document,
    rows: table.content.content.map((row) => (
      row.content.content.map((cell) => cell.textContent)
    )),
  };
}

describe("ragged pipe-table fidelity", () => {
  it("expands to the widest authored row instead of discarding extra cells", () => {
    const markdown = [
      "| H1 | H2 |",
      "| --- | --- |",
      "| A | B | **C** |",
      "| D |",
    ].join("\n");
    const canonical = [
      "| H1 | H2 |  |",
      "| --- | --- | --- |",
      "| A | B | **C** |",
      "| D |  |  |",
    ].join("\n");
    const { codec, document, rows } = tableRows(markdown);

    expect(rows).toEqual([
      ["H1", "H2", ""],
      ["A", "B", "C"],
      ["D", "", ""],
    ]);
    expect(codec.serialize(document)).toBe(canonical);
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("preserves widest-row cells inside a blockquote table", () => {
    const markdown = [
      "> | H1 | H2 |",
      "> | --- | --- |",
      "> | A | B | C |",
    ].join("\n");
    const canonical = [
      "> | H1 | H2 |  |",
      "> | --- | --- | --- |",
      "> | A | B | C |",
    ].join("\n");
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    const table = document.firstChild!.firstChild!;

    expect(table.content.content.map((row) => row.childCount)).toEqual([3, 3]);
    expect(table.lastChild!.lastChild!.textContent).toBe("C");
    expect(codec.serialize(document)).toBe(canonical);
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("retains existing alignment and inline syntax in recovered columns", () => {
    const markdown = [
      "| Left | Right |",
      "| :--- | ---: |",
      "| [link](https://example.com) | `code` | ~~strike~~ and a\\|b |",
    ].join("\n");
    const canonical = [
      "| Left | Right |  |",
      "| :--- | ---: | --- |",
      "| [link](https://example.com/) | `code` | ~~strike~~ and a\\|b |",
    ].join("\n");
    const { codec, document, rows } = tableRows(markdown);
    const table = document.firstChild!;

    expect(rows).toEqual([
      ["Left", "Right", ""],
      ["link", "code", "strike and a|b"],
    ]);
    expect(table.firstChild!.child(0).attrs.align).toBe("left");
    expect(table.firstChild!.child(1).attrs.align).toBe("right");
    expect(table.firstChild!.child(2).attrs.align).toBeNull();
    expect(codec.serialize(document)).toBe(canonical);
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("keeps an over-limit expansion as ordinary Markdown without losing its tail", () => {
    const widestRow = Array.from({ length: 65_539 }, (_, index) => (
      index === 65_538 ? "tail-sentinel" : "x"
    ));
    const markdown = [
      "| H1 | H2 |",
      "| --- | --- |",
      `| ${widestRow.join(" | ")} |`,
    ].join("\n");
    const codec = createMarkdownCodec();
    const document = codec.parse(markdown)!;
    let hasTable = false;
    document.descendants((node) => {
      if (node.type.name === "table") hasTable = true;
    });

    expect(hasTable).toBe(false);
    expect(document.textContent).toContain("tail-sentinel");
    expect(codec.serialize(document)).toContain("tail-sentinel");
  });
});

describe("tables that interrupt a block", () => {
  // As in GFM and markdown-it: a table may start on the line after a paragraph's text.
  it("starts right after a paragraph line, without a blank line", () => {
    const codec = createMarkdownCodec();
    const document = codec.parse([
      "**What moved it**",
      "| Platform | Change |",
      "|---|---|",
      "| Bedrock | +$56,530.50 |",
    ].join("\n"))!;

    expect(document.childCount).toBe(2);
    expect(document.child(0).type.name).toBe("paragraph");
    expect(document.child(0).textContent).toBe("What moved it");
    expect(document.child(1).type.name).toBe("table");
    expect(document.child(1).childCount).toBe(2);
    const canonical = codec.serialize(document);
    expect(canonical).toBe([
      "**What moved it**",
      "",
      "| Platform | Change |",
      "| --- | --- |",
      "| Bedrock | +$56,530.50 |",
    ].join("\n"));
    expect(codec.parse(canonical)!.eq(document)).toBe(true);
  });

  it("does not start without a delimiter row", () => {
    const document = createMarkdownCodec().parse("Text\n| not | a table |")!;
    expect(document.childCount).toBe(1);
    expect(document.child(0).type.name).toBe("paragraph");
  });
});
