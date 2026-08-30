import { describe, expect, it } from "vitest";
import {
  MarkdownEditorExtensionError,
  defineMarkdownEditorExtension,
  type MarkdownEditorMarkdownContribution,
} from "../src/extensionApi";
import { MARKORA_VERSION } from "../src/extensionVersion";
import { resolveMarkdownEditorExtensions } from "../src/extensionResolver";
import {
  createMarkdownCodec,
  type MarkdownEditorCodec,
} from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

const compatibility = {
  extensionApi: "^1.0.0",
  markora: "^0.0.1",
} as const;

const codecBuilders = [
  ["compatibility", createMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const;

function extension(name: string, markdown: MarkdownEditorMarkdownContribution) {
  return defineMarkdownEditorExtension({
    name,
    version: "1.0.0",
    compatibility,
    markdown,
  });
}

function build(
  createCodec: (extensions: ReturnType<typeof resolve>["extensions"]) => MarkdownEditorCodec,
  ...definitions: ReturnType<typeof extension>[]
) {
  return createCodec(resolve(...definitions).extensions);
}

function resolve(...definitions: ReturnType<typeof extension>[]) {
  return resolveMarkdownEditorExtensions({
    markoraVersion: MARKORA_VERSION,
    extensions: definitions,
  });
}

function ruleNames(
  codec: MarkdownEditorCodec,
  phase: "block" | "core" | "inline",
) {
  const ruler = (
    phase === "block"
      ? codec.tokenizer.block.ruler
      : phase === "inline"
        ? codec.tokenizer.inline.ruler
        : codec.tokenizer.core.ruler
  ) as unknown as Readonly<{
    __rules__: readonly Readonly<{ name: string }>[];
  }>;
  return ruler.__rules__.map(({ name }) => name);
}

function blockRuleNames(codec: MarkdownEditorCodec) {
  return ruleNames(codec, "block");
}

function expectRelativeOrder(names: readonly string[], expected: readonly string[]) {
  const indexes = expected.map((name) => names.indexOf(name));

  expect(indexes, `missing rules in ${names.join(", ")}`).not.toContain(-1);
  expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
}

function expectExtensionError(
  operation: () => unknown,
  code: string,
  phase: string,
) {
  try {
    operation();
    throw new Error("Expected an extension error.");
  } catch (error) {
    expect(error).toBeInstanceOf(MarkdownEditorExtensionError);
    expect(error).toMatchObject({ code, phase });
    return error as MarkdownEditorExtensionError;
  }
}

describe.each(codecBuilders)("%s Markdown contribution compiler", (codecName, createCodec) => {
  it("publishes stable anchors in the underlying Markdown-it order", () => {
    const codec = build(createCodec);

    expectRelativeOrder(
      ruleNames(codec, "block"),
      codecName === "compatibility"
        ? [
            "markora_frontmatter",
            "table",
            "markora_display_math",
            "markora_directive_container",
            "fence",
            "blockquote",
            "hr",
            "reference",
            "paragraph",
          ]
        : ["fence", "blockquote", "hr", "reference", "paragraph"],
    );
    expectRelativeOrder(
      ruleNames(codec, "inline"),
      codecName === "compatibility"
        ? ["markora_inline_directive", "text", "emphasis"]
        : ["text", "emphasis"],
    );
    expectRelativeOrder(
      ruleNames(codec, "core"),
      codecName === "compatibility"
        ? [
            "block",
            "markora_html_source",
            "inline",
            "markora_inline_source",
          ]
        : ["block", "inline"],
    );
  });

  it("places rules deterministically around optional compatibility anchors", () => {
    const owner = "acme-optional-anchor-placement";
    const codec = build(createCodec, extension(owner, {
      tokenizerRules: [
        {
          id: "frontmatter",
          phase: "block",
          before: [
            { id: "@markora/opaque/frontmatter", optional: true },
            "@markora/foundation/block/hr",
          ],
          createRule: () => () => false,
        },
        {
          id: "between-blockquote-reference",
          phase: "block",
          after: ["@markora/foundation/block/blockquote"],
          before: ["@markora/foundation/block/reference"],
          createRule: () => () => false,
        },
        {
          id: "display-math",
          phase: "block",
          before: [
            { id: "@markora/opaque/display-math", optional: true },
            "@markora/foundation/block/fence",
          ],
          createRule: () => () => false,
        },
        {
          id: "inline",
          phase: "inline",
          before: [
            { id: "@markora/opaque/inline-directive", optional: true },
            "@markora/foundation/inline/text",
          ],
          createRule: () => () => false,
        },
        {
          id: "after-html-source",
          phase: "core",
          after: [
            "@markora/foundation/core/block",
            { id: "@markora/opaque/html-source", optional: true },
          ],
          before: ["@markora/foundation/core/inline"],
          createRule: () => () => undefined,
        },
        {
          id: "before-inline-source",
          phase: "core",
          after: ["@markora/foundation/core/inline"],
          before: [{ id: "@markora/opaque/inline-source", optional: true }],
          createRule: () => () => undefined,
        },
      ],
    }));
    const blockNames = ruleNames(codec, "block");
    const inlineNames = ruleNames(codec, "inline");
    const coreNames = ruleNames(codec, "core");

    expectRelativeOrder(
      blockNames,
      codecName === "compatibility"
        ? [`${owner}/frontmatter`, "markora_frontmatter", "hr"]
        : [`${owner}/frontmatter`, "hr"],
    );
    expectRelativeOrder(blockNames, [
      "blockquote",
      `${owner}/between-blockquote-reference`,
      "reference",
    ]);
    expectRelativeOrder(
      blockNames,
      codecName === "compatibility"
        ? [`${owner}/display-math`, "markora_display_math", "fence"]
        : [`${owner}/display-math`, "fence"],
    );
    expectRelativeOrder(
      inlineNames,
      codecName === "compatibility"
        ? [`${owner}/inline`, "markora_inline_directive", "text"]
        : [`${owner}/inline`, "text"],
    );
    expectRelativeOrder(
      coreNames,
      codecName === "compatibility"
        ? [
            "block",
            "markora_html_source",
            `${owner}/after-html-source`,
            "inline",
            `${owner}/before-inline-source`,
            "markora_inline_source",
          ]
        : [
            "block",
            `${owner}/after-html-source`,
            "inline",
            `${owner}/before-inline-source`,
          ],
    );
  });

  it("honors every before and after constraint in one deterministic tokenizer graph", () => {
    const owner = "acme-token-graph";
    const noMatch = () => false;
    const codec = build(createCodec, extension(owner, {
      tokenizerRules: [
        {
          id: "middle",
          phase: "block",
          after: [
            "@markora/foundation/block/fence",
            `${owner}/left-a`,
            `${owner}/left-b`,
          ],
          before: [
            `${owner}/right-a`,
            `${owner}/right-b`,
            "@markora/foundation/block/paragraph",
            { id: "acme-not-installed/rule", optional: true },
          ],
          createRule: () => noMatch,
        },
        {
          id: "right-a",
          phase: "block",
          before: ["@markora/foundation/block/paragraph"],
          createRule: () => noMatch,
        },
        {
          id: "right-b",
          phase: "block",
          before: ["@markora/foundation/block/paragraph"],
          createRule: () => noMatch,
        },
        {
          id: "left-a",
          phase: "block",
          after: ["@markora/foundation/block/fence"],
          createRule: () => noMatch,
        },
        {
          id: "left-b",
          phase: "block",
          after: ["@markora/foundation/block/fence"],
          createRule: () => noMatch,
        },
      ],
    }));
    const names = blockRuleNames(codec);
    const index = (id: string) => names.indexOf(id);

    expect(index("fence")).toBeLessThan(index(`${owner}/left-a`));
    expect(index("fence")).toBeLessThan(index(`${owner}/left-b`));
    expect(index(`${owner}/left-a`)).toBeLessThan(index(`${owner}/middle`));
    expect(index(`${owner}/left-b`)).toBeLessThan(index(`${owner}/middle`));
    expect(index(`${owner}/middle`)).toBeLessThan(index(`${owner}/right-a`));
    expect(index(`${owner}/middle`)).toBeLessThan(index(`${owner}/right-b`));
    expect(index(`${owner}/right-a`)).toBeLessThan(index("paragraph"));
    expect(index(`${owner}/right-b`)).toBeLessThan(index("paragraph"));
  });

  it("rejects cycles that contradict the foundation anchor order", () => {
    const owner = "acme-anchor-cycle";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      tokenizerRules: [{
        id: "impossible",
        phase: "block",
        after: ["@markora/foundation/block/paragraph"],
        before: ["@markora/foundation/block/fence"],
        createRule: () => () => false,
      }],
    })), "EXTENSION_ORDER_CYCLE", "tokenizer");

    expect(error.extension).toBe(owner);
    expect(error.contribution).toBe(`${owner}/impossible`);
    expect(error.participants).toEqual(expect.arrayContaining([
      "@markora/foundation/block/fence",
      "@markora/foundation/block/paragraph",
      `${owner}/impossible`,
    ]));
  });

  it("rejects missing required tokenizer targets but ignores explicit optional targets", () => {
    const owner = "acme-missing-tokenizer-target";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      tokenizerRules: [{
        id: "rule",
        phase: "block",
        before: [
          "acme-absent/rule",
          { id: "acme-optional/rule", optional: true },
        ],
        createRule: () => () => false,
      }],
    })), "EXTENSION_MISSING_DEPENDENCY", "tokenizer");

    expect(error).toMatchObject({
      extension: owner,
      contribution: `${owner}/rule`,
      participants: [`${owner}/rule`, "acme-absent/rule"],
    });
  });

  it("rejects tokenizer edges across phases", () => {
    const owner = "acme-cross-phase";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      tokenizerRules: [
        {
          id: "block",
          phase: "block",
          before: [`${owner}/inline`],
          createRule: () => () => false,
        },
        {
          id: "inline",
          phase: "inline",
          createRule: () => () => false,
        },
      ],
    })), "EXTENSION_INVALID_DEFINITION", "tokenizer");

    expect(error).toMatchObject({
      extension: owner,
      contribution: `${owner}/block`,
      participants: [`${owner}/block`, `${owner}/inline`],
    });
  });

  it("rejects node parser handlers that target a schema mark", () => {
    const owner = "acme-wrong-parser-kind";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      parserTokens: {
        wrong: { node: "em" },
      },
    })), "EXTENSION_INVALID_DEFINITION", "codec");

    expect(error).toMatchObject({
      extension: owner,
      contribution: `${owner}/wrong`,
      participants: [`${owner}/wrong`, "em"],
    });
    expect(error.message).toContain('but "em" is a mark');
  });

  it("rejects mark parser handlers that target a schema node", () => {
    const owner = "acme-reverse-parser-kind";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      parserTokens: {
        wrong: { mark: "paragraph" },
      },
    })), "EXTENSION_INVALID_DEFINITION", "codec");

    expect(error).toMatchObject({
      extension: owner,
      contribution: `${owner}/wrong`,
      participants: [`${owner}/wrong`, "paragraph"],
    });
    expect(error.message).toContain('but "paragraph" is a node');
  });

  it("rejects missing parser targets with owner attribution", () => {
    const owner = "acme-missing-parser-target";
    const error = expectExtensionError(() => build(createCodec, extension(owner, {
      parserTokens: {
        missing: { block: "acme_missing" },
      },
    })), "EXTENSION_INVALID_DEFINITION", "codec");

    expect(error).toMatchObject({
      extension: owner,
      contribution: `${owner}/missing`,
      participants: [`${owner}/missing`, "acme_missing"],
    });
    expect(error.message).toContain('missing schema node "acme_missing"');
  });
});
