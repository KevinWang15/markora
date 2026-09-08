import { describe, expect, it } from "vitest";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownSerializerState } from "prosemirror-markdown";
import { bufferMarkdownSerializerOutput } from "../src/markdownSerializerBuffer";

type Runtime = MarkdownSerializerState & { out: string; delim: string; flushClose(size?: number): void };
const State = MarkdownSerializerState as unknown as new (...args: unknown[]) => Runtime;
function state(buffered: boolean, tightLists: boolean = false) {
  const result = new State(defaultMarkdownSerializer.nodes, defaultMarkdownSerializer.marks, { tightLists });
  if (buffered) bufferMarkdownSerializerOutput(result);
  return result;
}

describe("buffered Markdown writer compatibility", () => {
  it.each([
    "# Heading\n\nParagraph with **bold**, *italic*, [link](https://example.com), and `code`.\n\n---\n\n![alt](image.png)",
    "> quote\n>\n> * one\n>   * nested\n>\n> tail",
    "1. first\n\n   paragraph\n\n2. second\n\n```js\nconst x = 1;\n```",
    "literal! [link](https://example.com)\n\n\\! [next](https://example.com)\n\nline  \nbreak",
    "", "plain\n\n".repeat(500),
  ])("matches upstream output for %s", markdown => {
    const doc = defaultMarkdownParser.parse(markdown);
    for (const tight of [false, true]) {
      const upstream = state(false, tight);
      const buffered = state(true, tight);
      upstream.renderContent(doc);
      buffered.renderContent(doc);
      expect(buffered.out).toBe(upstream.out);
    }
  });

  it("preserves custom serializer reads/writes, delimiters and bang escaping across chunks", () => {
    const outputs: string[][] = [];
    for (const buffered of [false, true]) {
      const writer = state(buffered);
      const snapshots: string[] = [];
      writer.text("literal", false);
      writer.text("!", false);
      writer.text("[link]", false);
      snapshots.push(writer.out);
      writer.out += "\n> reset\\!";
      writer.text("[not escaped]", false);
      snapshots.push(writer.out);
      writer.out = "";
      writer.delim = "> ";
      writer.write("one");
      writer.closeBlock(defaultMarkdownParser.parse("one").firstChild!);
      writer.flushClose(3);
      writer.text("two\nthree", false);
      writer.ensureNewLine();
      snapshots.push(writer.out);
      outputs.push(snapshots);
    }
    expect(outputs[1]).toEqual(outputs[0]);
  });
});
