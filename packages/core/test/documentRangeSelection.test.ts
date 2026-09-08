import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { createDocumentRange, DocumentRangeSelection } from "../src/documentRangeSelection";

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, paragraph: { group: "block", content: "text*" },
  atom: { group: "block", atom: true }, text: {},
} });
const doc = schema.nodes.doc.create(null, [schema.nodes.atom.create(), schema.nodes.paragraph.create(null, schema.text("before")), schema.nodes.atom.create()]);

describe("structural document ranges", () => {
  it.each([[4, doc.content.size], [4, 0]])("keeps direction and boundary through JSON and history (%s → %s)", (anchor, head) => {
    const selection = createDocumentRange(doc, anchor, head);
    expect(selection).toBeInstanceOf(DocumentRangeSelection);
    expect(Selection.fromJSON(doc, selection.toJSON()).eq(selection)).toBe(true);
    expect(selection.getBookmark().resolve(doc).eq(selection)).toBe(true);
    let state = EditorState.create({ doc, selection, plugins: [history()] });
    state = state.apply(state.tr.deleteSelection());
    expect(state.doc.eq(doc)).toBe(false);
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(state.selection.eq(selection)).toBe(true);
  });
  it("includes the terminal atom in the copied slice", () => {
    const selection = createDocumentRange(doc, 4, doc.content.size);
    expect(selection.content().content.lastChild?.type.name).toBe("atom");
  });
  it("maps endpoints and bookmarks through edits", () => {
    const selection = createDocumentRange(doc, 4, doc.content.size);
    const state = EditorState.create({ doc, selection });
    const transaction = state.tr.insertText("!", 2);
    const mapped = selection.map(transaction.doc, transaction.mapping);
    expect(mapped).toMatchObject({ anchor: 5, head: doc.content.size + 1 });
    expect(selection.getBookmark().map(transaction.mapping).resolve(transaction.doc).eq(mapped)).toBe(true);
  });
  it("returns ordinary text selections when both endpoints are text positions", () => {
    expect(createDocumentRange(doc, 2, 5)).toBeInstanceOf(TextSelection);
    expect(createDocumentRange(doc, 4, 4)).toMatchObject({ anchor: 4, head: 4 });
  });
  it("rejects malformed or out-of-document endpoints", () => {
    for (const head of [-1, 0.5, NaN, doc.content.size + 1]) expect(() => createDocumentRange(doc, 2, head)).toThrow(RangeError);
  });
});
