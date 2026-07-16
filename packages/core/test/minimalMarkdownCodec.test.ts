import { describe, expect, it } from "vitest";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";
import { createMinimalMarkdownEditorPreset, MARKORA_VERSION } from "../src/extensionPresets";
import { resolveMarkdownEditorExtensions } from "../src/extensionResolver";
import { calloutExtension, highlightExtension } from "./support/publicExtensions";

describe("minimal Markdown codec", () => {
  it("omits default-only syntax and schema features", () => {
    const resolution = resolveMarkdownEditorExtensions({
      markoraVersion: MARKORA_VERSION,
      preset: createMinimalMarkdownEditorPreset(),
    });
    const codec = createMinimalMarkdownCodec(resolution.extensions);

    expect(codec.schema.nodes.table).toBeUndefined();
    expect(codec.schema.nodes.raw_block).toBeUndefined();
    expect(codec.schema.marks.strike).toBeUndefined();

    const doc = codec.parse("~~not strike~~\n\n| not | a table |\n| --- | --- |");
    expect(doc?.firstChild?.textContent).toContain("~~not strike~~");
    expect(doc?.childCount).toBeGreaterThan(0);
  });

  it("still composes external block and inline extensions", () => {
    const resolution = resolveMarkdownEditorExtensions({
      markoraVersion: MARKORA_VERSION,
      preset: createMinimalMarkdownEditorPreset(),
      extensions: [calloutExtension, highlightExtension],
    });
    const codec = createMinimalMarkdownCodec(resolution.extensions);
    const doc = codec.parse(":::tip Minimal\n==small== and **strong**\n:::");
    let highlighted = false;
    doc?.descendants((node) => {
      highlighted ||= node.marks.some((mark) => mark.type === codec.schema.marks.acme_highlight);
    });

    expect(doc?.firstChild?.type.name).toBe("acme_callout");
    expect(highlighted).toBe(true);
    expect(codec.serialize(doc!)).toContain("==small==");
  });
});
