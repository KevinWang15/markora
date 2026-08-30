import { describe, expect, it } from "vitest";
import {
  defineMarkdownEditorExtension,
  sliceMarkdownEditorOriginalSourceLines,
} from "../src/extension-api";
import { MARKORA_VERSION } from "../src/extensionVersion";
import { resolveMarkdownEditorExtensions } from "../src/extensionResolver";
import {
  createMarkdownCodec,
  type MarkdownEditorCodec,
} from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";
import { createMarkdownEditorSourceEnvironment } from "../src/markdownSource";

const codecBuilders = [
  ["compatibility", createMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const;

describe("original Markdown source line ranges", () => {
  it("preserves BOMs and authored line endings behind a private environment", () => {
    const source = "\uFEFF---\r\ntitle: Exact\r---\nBody\n";
    const environment = createMarkdownEditorSourceEnvironment(source);

    expect(Object.keys(environment)).toEqual([]);
    expect(sliceMarkdownEditorOriginalSourceLines(environment, 0, 3)).toBe(
      "\uFEFF---\r\ntitle: Exact\r---",
    );
    expect(sliceMarkdownEditorOriginalSourceLines(environment, 3, 4)).toBe("Body");
    expect(sliceMarkdownEditorOriginalSourceLines(environment, 4, 5)).toBe("");
    expect(sliceMarkdownEditorOriginalSourceLines(environment, 0, 5)).toBe(source);

    Object.assign(environment, {
      markoraOriginalSource: "tampered",
      source: "tampered",
    });
    expect(sliceMarkdownEditorOriginalSourceLines(environment, 0, 3)).toBe(
      "\uFEFF---\r\ntitle: Exact\r---",
    );
  });

  it.each([
    [null, 0, 1],
    [{}, 0, 1],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), -1, 1],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 0, 0],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 1, 1],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 2, 1],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 0.5, 1],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 0, Number.NaN],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 0, 3],
    [createMarkdownEditorSourceEnvironment("one\ntwo"), 2, 3],
  ])(
    "returns null for an invalid or unavailable range %#",
    (environment, startLine, endLine) => {
      expect(sliceMarkdownEditorOriginalSourceLines(
        environment,
        startLine,
        endLine,
      )).toBeNull();
    },
  );
});

describe.each(codecBuilders)("%s codec source environment", (_, createCodec) => {
  it("makes exact original source available to public core tokenizer rules", () => {
    const observed: Array<string | null> = [];
    const sourceProbe = defineMarkdownEditorExtension({
      name: "acme-source-probe",
      version: "1.0.0",
      compatibility: { extensionApi: "^1.1.0", markora: "^0.0.1" },
      markdown: {
        tokenizerRules: [{
          id: "capture",
          phase: "core",
          after: ["@markora/foundation/core/block"],
          before: ["@markora/foundation/core/inline"],
          createRule: () => (state) => {
            observed.push(sliceMarkdownEditorOriginalSourceLines(state.env, 0, 2));
          },
        }],
      },
    });
    const resolution = resolveMarkdownEditorExtensions({
      extensions: [sourceProbe],
      markoraVersion: MARKORA_VERSION,
    });
    const codec = createCodec(
      resolution.extensions,
    ) as MarkdownEditorCodec;
    const source = "\uFEFFalpha\r\nbeta\r\ngamma";

    codec.parse(source);

    expect(observed).toEqual(["\uFEFFalpha\r\nbeta"]);
  });
});
