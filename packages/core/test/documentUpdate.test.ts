import { EditorState } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import { buildReconciledDocumentTransaction } from "../src/documentUpdate";
import { parseMarkdown } from "../src/markdownCodec";

function createState(markdown: string) {
  return EditorState.create({ doc: parseMarkdown(markdown) });
}

function expectReconciledUpdate(previous: string, next: string) {
  const state = createState(previous);
  const nextDoc = parseMarkdown(next);
  const transaction = buildReconciledDocumentTransaction(state, nextDoc);

  expect(transaction.before.eq(state.doc)).toBe(true);
  expect(transaction.doc.eq(nextDoc)).toBe(true);
  expect(state.apply(transaction).doc.eq(nextDoc)).toBe(true);

  return { state, transaction };
}

describe("buildReconciledDocumentTransaction", () => {
  it("returns an unchanged transaction for equivalent documents", () => {
    const state = createState("same **document**");
    const transaction = buildReconciledDocumentTransaction(
      state,
      parseMarkdown("same **document**"),
    );

    expect(transaction.docChanged).toBe(false);
    expect(transaction.steps).toHaveLength(0);
    expect(transaction.doc.eq(state.doc)).toBe(true);
  });

  it("replaces only the narrow changed range for an inline edit", () => {
    const { state, transaction } = expectReconciledUpdate(
      "shared prefix OLD shared suffix",
      "shared prefix NEW shared suffix",
    );
    const step = transaction.steps[0]?.toJSON();

    expect(transaction.steps).toHaveLength(1);
    expect(step).toMatchObject({ stepType: "replace" });
    expect(step.from).toBeGreaterThan(0);
    expect(step.to).toBeLessThan(state.doc.content.size);
  });

  it.each([
    ["Unicode 👩🏽‍💻 世界 tail", "Unicode 🧑🏾‍🚀 世界 tail"],
    ["aaaa repeated middle aaaa", "aaaa replaced middle aaaa"],
    ["prefix e\u0301 suffix", "prefix é suffix"],
  ])("handles Unicode and repeated inline content", (previous, next) => {
    expectReconciledUpdate(previous, next);
  });

  it.each([
    ["first\n\nsecond", "first\n\ninserted\n\nsecond"],
    ["# Heading\n\nbody", "## Heading\n\nbody"],
    ["- alpha\n- beta", "1. alpha\n2. beta"],
    ["plain", "> nested\n>\n> content"],
    ["before\n\nafter", "before\n\n```ts\nconst answer = 42;\n```\n\nafter"],
  ])("handles structural document changes", (previous, next) => {
    expectReconciledUpdate(previous, next);
  });

  it("falls back to a full-content replacement when a narrow slice is not exact", () => {
    const state = createState("alpha");
    const nextDoc = parseMarkdown("omega");
    const startSpy = vi
      .spyOn(state.doc.content, "findDiffStart")
      .mockReturnValue(2);
    const endSpy = vi
      .spyOn(state.doc.content, "findDiffEnd")
      .mockReturnValue({ a: 3, b: 3 });

    try {
      const transaction = buildReconciledDocumentTransaction(state, nextDoc);

      expect(transaction.doc.eq(nextDoc)).toBe(true);
      expect(transaction.steps).toHaveLength(1);
      expect(transaction.steps[0]?.toJSON()).toMatchObject({
        from: 0,
        stepType: "replace",
        to: state.doc.content.size,
      });
    } finally {
      startSpy.mockRestore();
      endSpy.mockRestore();
    }
  });

  it("reconciles a modest cross-product corpus exactly", () => {
    const corpus = [
      "",
      "A short paragraph.",
      "# Heading\n\nParagraph with **strong** and *emphasis*.",
      "- first\n- second\n- third",
      "1. one\n2. two\n\n> quote",
      "| A | B |\n| --- | ---: |\n| x | y |",
      "```json\n{ \"ok\": true }\n```",
      "Before 👋🏽\n\n---\n\nAfter [link](/target).",
    ];

    for (const previous of corpus) {
      for (const next of corpus) {
        expectReconciledUpdate(previous, next);
      }
    }
  });
});
