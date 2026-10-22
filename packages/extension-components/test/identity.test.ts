import { describe, expect, it, vi } from "vitest";
import { EditorState, NodeSelection, Schema, wrapIn, type Transaction } from "markora/extension-api";
import { buildComponentIdentities, collectChangedComponents, mapComponentIdentities } from "../src/identity";

const schema = new Schema({
  nodes: {
    doc: { content: "block+", marks: "_" },
    paragraph: { group: "block", content: "text*" },
    blockquote: { group: "block", content: "block+" },
    custom_component: { group: "block", atom: true, attrs: { name: {}, source: {} } },
    text: {},
  },
  marks: { strong: {} },
});
const paragraph = () => schema.nodes.paragraph.create(null, schema.text("text"));
const component = () => schema.nodes.custom_component.create({ name: "chart", source: "{}" });
const document = () => schema.nodes.doc.create(null, [paragraph(), component(), paragraph(), component()]);

function expectIndex(transaction: Transaction) {
  const previous = buildComponentIdentities(transaction.before);
  const actual = mapComponentIdentities(transaction, previous);
  expect([...actual].map(([position, entry]) => [position, entry.node.toJSON()]))
    .toEqual([...buildComponentIdentities(transaction.doc)].map(([position, entry]) => [position, entry.node.toJSON()]));
  return { previous, actual };
}

describe("incremental component index", () => {
  it("maps unchanged occurrences and rescans only replaced ranges", () => {
    const state = EditorState.create({ doc: document() });
    const transaction = state.tr.insertText("prefix", 1).insert(0, component());
    const { previous, actual } = expectIndex(transaction);
    expect(actual.get(13)?.identity).toBe(previous.get(6)?.identity);
    expect(actual.get(20)?.identity).toBe(previous.get(13)?.identity);
    expect([...collectChangedComponents(transaction).keys()]).toEqual([0]);
  });

  it("handles attribute and mark steps with empty maps", () => {
    const state = EditorState.create({ doc: document() });
    const transaction = state.tr.setNodeAttribute(6, "source", '{"value":1}');
    const { previous, actual } = expectIndex(transaction);
    expect(actual.get(6)?.identity).not.toBe(previous.get(6)?.identity);
    expect(collectChangedComponents(transaction).get(6)?.attrs.source).toBe('{"value":1}');
    expectIndex(state.tr.addNodeMark(6, schema.marks.strong.create()));
    expectIndex(state.tr.addMark(1, 5, schema.marks.strong.create()));
  });

  it("preserves identities inside replace-around gaps", () => {
    const doc = document();
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 6) });
    expect(wrapIn(schema.nodes.blockquote)(state, transaction => {
      const { previous, actual } = expectIndex(transaction);
      expect(actual.get(7)?.identity).toBe(previous.get(6)?.identity);
    })).toBe(true);
  });

  it("invalidates replacements even when the same node instance is reused", () => {
    const state = EditorState.create({ doc: document() });
    const transaction = state.tr.replaceWith(6, 7, state.doc.nodeAt(6)!);
    const { previous, actual } = expectIndex(transaction);
    expect(actual.get(6)?.identity).not.toBe(previous.get(6)?.identity);
    expect(actual.get(13)?.identity).toBe(previous.get(13)?.identity);
  });

  it("handles duplicate node instances, deletions, resets and later edits to a transaction", () => {
    const shared = component();
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [shared, shared, paragraph()]) });
    const index = buildComponentIdentities(state.doc);
    expect(index.get(0)?.identity).not.toBe(index.get(1)?.identity);
    expectIndex(state.tr.delete(0, 1));
    expectIndex(state.tr.replaceWith(0, state.doc.content.size, state.doc.content));
    const transaction = state.tr.insertText("x", 3);
    expect(collectChangedComponents(transaction).size).toBe(0);
    transaction.insert(0, component());
    expect(collectChangedComponents(transaction).size).toBe(1);
    expectIndex(transaction);
  });

  it("matches a full rebuild over mixed multi-step transactions", () => {
    let state = EditorState.create({ doc: document() });
    for (let iteration = 0; iteration < 120; iteration++) {
      const transaction = state.tr;
      const positions = [...buildComponentIdentities(state.doc).keys()];
      const position = positions[iteration % positions.length];
      if (iteration % 4 === 0) transaction.insert(0, component());
      if (iteration % 4 === 1) transaction.delete(position, position + 1);
      if (iteration % 4 === 2) transaction.setNodeAttribute(position, "source", JSON.stringify({ iteration }));
      if (iteration % 4 === 3) transaction.insert(position, schema.nodes.blockquote.create(null, [paragraph(), component()]));
      transaction.insert(transaction.doc.content.size, paragraph());
      expectIndex(transaction);
      state = state.apply(transaction);
    }
  });

  it("does not traverse unchanged subtrees in a 10,000-paragraph document", () => {
    const block = schema.nodes.blockquote.create(null, Array.from({ length: 100 }, paragraph));
    const doc = schema.nodes.doc.create(null, [...Array.from({ length: 100 }, () => block), component()]);
    const state = EditorState.create({ doc });
    const previous = buildComponentIdentities(doc);
    const descendants = vi.spyOn(Object.getPrototypeOf(doc), "descendants");
    const nodesBetween = vi.spyOn(Object.getPrototypeOf(doc), "nodesBetween");
    try {
      const transaction = state.tr.insertText("prefix", 2);
      expect(collectChangedComponents(transaction).size).toBe(0);
      const scanned = nodesBetween.mock.calls.length;
      const next = mapComponentIdentities(transaction, previous);
      expect(nodesBetween).toHaveBeenCalledTimes(scanned);
      expect(scanned).toBeLessThanOrEqual(3);
      expect(descendants).not.toHaveBeenCalled();
      expect([...next.values()][0].identity).toBe([...previous.values()][0].identity);
    } finally {
      descendants.mockRestore();
      nodesBetween.mockRestore();
    }
  });
});
