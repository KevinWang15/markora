import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createElementNavigation, moveToElementBoundary } from "../src/elementNavigation";
import { createElementNavigationPlugin } from "../src/elementInteraction";
import { ManagedBlockCursor, registerManagedBlockTypes } from "../src/managedBlockCursor";

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, paragraph: { group: "block", content: "inline*" }, text: { group: "inline" },
  code_block: { group: "block", content: "text*", code: true },
  diagram: { group: "block", content: "text*", code: true, elementNavigation: { textArrows: "custom" } },
  divider: { group: "block", atom: true }, block_math: { group: "block", atom: true },
  table: { group: "block", content: "paragraph+" }, blockquote: { group: "block", content: "block+" },
  image: { group: "inline", inline: true, atom: true }, inline_math: { group: "inline", inline: true, atom: true },
  hard_break: { group: "inline", inline: true, selectable: false },
} });
const managed = new Set(["diagram"]);
registerManagedBlockTypes(schema, managed);
const navigation = createElementNavigation(managed);
const paragraph = (text = "") => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const blocks = ["code_block", "diagram", "divider", "block_math", "table", "blockquote"] as const;
const block = (name: typeof blocks[number]) => schema.nodes[name].createAndFill()!;
const document = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);

describe("element navigation state machine", () => {
  it("delegates only inner text arrows to custom owners and shares their exits", () => {
    const diagram = schema.nodes.diagram.create(null, schema.text("source"));
    const doc = document(paragraph("Before"), diagram, block("divider"));
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 9) });
    const dom = globalThis.document.createElement("div");
    dom.dir = "ltr";
    const view = {
      get state() { return state; }, dom, composing: false, editable: true,
      domAtPos: () => ({ node: dom, offset: 0 }),
      dispatch(tr: Parameters<EditorView["dispatch"]>[0]) { state = state.apply(tr); },
    } as unknown as EditorView;
    const plugin = createElementNavigationPlugin(managed);
    const press = (key: string) => plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent("keydown", { key }));
    expect(press("ArrowLeft")).toBe(false);
    expect(state.selection.head).toBe(9);
    expect(moveToElementBoundary(view, 8, "before")).toBe(true);
    expect(state.selection.head).toBe(7);
    expect(press("ArrowRight")).toBe(true);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(press("ArrowRight")).toBe(true);
    expect(state.selection).toBeInstanceOf(ManagedBlockCursor);
    for (const pos of [-1, NaN, 0, doc.content.size + 1]) {
      expect(moveToElementBoundary(view, pos, "before")).toBe(false);
    }
  });

  for (const first of blocks) for (const second of blocks) {
    it(`${first} ↔ ${second} shares one boundary and takes exactly two arrows`, () => {
      const a = block(first), b = block(second), doc = document(a, b);
      const selectedA = NodeSelection.create(doc, 0), selectedB = NodeSelection.create(doc, a.nodeSize);
      const afterA = navigation.step(selectedA, 1)!;
      const beforeB = navigation.step(selectedB, -1)!;
      expect(afterA.empty).toBe(true);
      expect(afterA.eq(beforeB)).toBe(true);
      expect(navigation.step(afterA, 1)!.eq(selectedB)).toBe(true);
      expect(navigation.step(beforeB, -1)!.eq(selectedA)).toBe(true);
      expect(ManagedBlockCursor.create(doc, 0, "after", (node): node is ProseMirrorNode => !!node && navigation.isBlock(node))!.eq(
        ManagedBlockCursor.create(doc, a.nodeSize, "before", (node): node is ProseMirrorNode => !!node && navigation.isBlock(node))!,
      )).toBe(true);
    });
  }

  it("uses the same two-arrow contract for adjacent inline atoms and block/inline transitions", () => {
    const image = schema.nodes.image.create(), math = schema.nodes.inline_math.create();
    const code = block("code_block");
    const doc = document(code, schema.nodes.paragraph.create(null, [image, math]), block("divider"));
    const positions = [0, code.nodeSize + 1, code.nodeSize + 2, code.nodeSize + 4];
    for (let index = 0; index < positions.length - 1; index++) {
      const a = NodeSelection.create(doc, positions[index]!);
      const b = NodeSelection.create(doc, positions[index + 1]!);
      expect(navigation.step(navigation.step(a, 1)!, 1)!.eq(b)).toBe(true);
      expect(navigation.step(navigation.step(b, -1)!, -1)!.eq(a)).toBe(true);
    }
  });

  it("keeps document edges stable and exposes adjacent text carets without another stop", () => {
    const doc = document(block("diagram"));
    const before = navigation.step(NodeSelection.create(doc, 0), -1)!;
    const after = navigation.step(NodeSelection.create(doc, 0), 1)!;
    expect(navigation.step(before, -1)!.eq(before)).toBe(true);
    expect(navigation.step(after, 1)!.eq(after)).toBe(true);
    const mixed = document(paragraph("Before"), block("diagram"), paragraph("After"));
    expect(navigation.step(NodeSelection.create(mixed, 8), -1)).toMatchObject({ head: 7 });
    expect(navigation.step(NodeSelection.create(mixed, 8), 1)).toMatchObject({ head: 11 });
  });

  it("leaves normal text and hard breaks to native caret movement", () => {
    const doc = document(schema.nodes.paragraph.create(null, [schema.text("ab"), schema.nodes.hard_break.create(), schema.text("cd")]));
    expect(navigation.step(TextSelection.create(doc, 2), 1)).toBeNull();
    expect(navigation.step(TextSelection.create(doc, 3), 1)).toBeNull();
    expect(navigation.step(TextSelection.create(doc, 1, 4), 1)).toBeNull();
  });

  it("preserves canonical boundaries through JSON, bookmarks, and deletion of either neighbor", () => {
    const a = block("diagram"), b = block("code_block"), doc = document(a, b);
    const boundary = navigation.boundary(doc, a.nodeSize);
    expect(Selection.fromJSON(doc, boundary.toJSON()).eq(boundary)).toBe(true);
    for (const [from, to] of [[0, a.nodeSize], [a.nodeSize, doc.content.size]]) {
      const tr = EditorState.create({ doc, selection: boundary }).tr.delete(from!, to!);
      const mapped = boundary.map(tr.doc, tr.mapping);
      expect(mapped).toBeInstanceOf(ManagedBlockCursor);
      expect(boundary.getBookmark().map(tr.mapping).resolve(tr.doc).eq(mapped)).toBe(true);
    }
  });
});
