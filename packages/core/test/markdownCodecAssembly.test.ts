import { describe, expect, it } from "vitest";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";

describe("Markdown codec assemblies", () => {
  it("builds an isolated but behaviorally compatible graph per editor", () => {
    const first = createCompatibilityMarkdownCodec();
    const second = createCompatibilityMarkdownCodec();

    expect(first).not.toBe(second);
    expect(first.schema).not.toBe(second.schema);
    expect(first.parser).not.toBe(second.parser);
    expect(first.serializer).not.toBe(second.serializer);

    const markdown = "# Assembly\n\n- [x] task\n\n| A | B |\n| --- | ---: |\n| one | two |";
    const firstDoc = first.parse(markdown);
    const secondDoc = second.parse(markdown);

    expect(firstDoc?.type.schema).toBe(first.schema);
    expect(secondDoc?.type.schema).toBe(second.schema);
    expect(first.serialize(firstDoc!)).toBe(second.serialize(secondDoc!));
  });

  it("keeps parse, serializer, and imported-content policy on one schema", () => {
    const codec = createCompatibilityMarkdownCodec();
    const doc = codec.parse("[unsafe](javascript:alert(1)) ![image](javascript:alert(2))");
    let unsafeSemanticNode = false;

    doc?.descendants((node) => {
      unsafeSemanticNode ||= node.type === codec.schema.nodes.image
        || node.marks.some((mark) => mark.type === codec.schema.marks.link);
    });

    expect(doc?.type.schema).toBe(codec.schema);
    expect(unsafeSemanticNode).toBe(false);
    expect(codec.createImportedContentSanitizerPlugin()).toBeDefined();
    expect(codec.createTableCellContentFromMarkdown("**cell**").size).toBeGreaterThan(0);
  });
});
