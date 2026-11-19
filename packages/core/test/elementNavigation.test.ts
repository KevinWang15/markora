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
const block = (name: typeof blocks[number]) => {
  if (name === "code_block" || name === "diagram") {
    return schema.nodes[name].create(null, schema.text("line1\nline2"));
  }
  if (name === "table" || name === "blockquote") {
    return schema.nodes[name].create(null, paragraph("cell"));
  }
  return schema.nodes[name].createAndFill()!;
};
const document = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);

function createMockView(initialState: EditorState) {
  let state = initialState;
  const dom = globalThis.document.createElement("div");
  dom.dir = "ltr";
  const view = {
    get state() { return state; },
    dom,
    composing: false,
    editable: true,
    domAtPos: () => ({ node: dom, offset: 0 }),
    endOfTextblock: () => true,
    dispatch(tr: Parameters<EditorView["dispatch"]>[0]) { state = state.apply(tr); },
  } as unknown as EditorView;
  return { view, getState: () => state, setState: (next: EditorState) => { state = next; } };
}

describe("element navigation state machine", () => {
  it("delegates only inner horizontal text arrows to custom owners while sharing exits and vertical motion", () => {
    const diagram = schema.nodes.diagram.create(null, schema.text("line1\nline2"));
    const doc = document(paragraph("Before"), diagram, block("divider"));
    const { view, getState } = createMockView(EditorState.create({ doc, selection: TextSelection.create(doc, 9) }));
    const plugin = createElementNavigationPlugin(managed);
    const press = (key: string) => plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent("keydown", { key }));

    // Horizontal arrows inside diagram stay delegated to custom owner.
    expect(press("ArrowLeft")).toBe(false);
    expect(getState().selection.head).toBe(9);
    // Vertical ArrowDown from line 1 stays inside multi-line diagram (newline after caret).
    expect(press("ArrowDown")).toBe(false);
    // Vertical ArrowUp from line 1 exits directly to paragraph before diagram.
    expect(press("ArrowUp")).toBe(true);
    expect(getState().selection).toBeInstanceOf(TextSelection);
    expect(getState().selection.head).toBe(7);

    // ArrowRight from paragraph enters editable diagram directly at start.
    expect(press("ArrowRight")).toBe(true);
    expect(getState().selection).toBeInstanceOf(TextSelection);
    expect(getState().selection.head).toBe(9);

    // Escape selects whole diagram; ArrowRight moves to Gap Space before divider;
    // ArrowRight again selects divider atom.
    expect(press("Escape")).toBe(true);
    expect(getState().selection).toBeInstanceOf(NodeSelection);
    expect(getState().selection.from).toBe(8);
    expect(press("ArrowRight")).toBe(true);
    expect(getState().selection).toBeInstanceOf(ManagedBlockCursor);
    expect(press("ArrowRight")).toBe(true);
    expect(getState().selection).toBeInstanceOf(NodeSelection);
    expect(getState().selection.from).toBe(8 + diagram.nodeSize);

    // Shared moveToElementBoundary works and rejects invalid positions.
    expect(moveToElementBoundary(view, 8, "before")).toBe(true);
    expect(getState().selection.head).toBe(7);
    for (const pos of [-1, NaN, 0, doc.content.size + 1]) {
      expect(moveToElementBoundary(view, pos, "before")).toBe(false);
    }
  });

  for (const first of blocks) for (const second of blocks) {
    it(`${first} ↔ ${second} shares one Gap Space boundary and takes exactly two arrows horizontally and vertically`, () => {
      const a = block(first), b = block(second), doc = document(a, b);
      const aEnd = navigation.enter(doc, 0, a, -1)!;
      const bStart = navigation.enter(doc, a.nodeSize, b, 1)!;

      // Horizontal: A end -> Gap Space -> B start, and exact reverse.
      const afterA = navigation.step(aEnd, 1)!;
      const beforeB = navigation.step(bStart, -1)!;
      expect(afterA).toBeInstanceOf(ManagedBlockCursor);
      expect(afterA.empty).toBe(true);
      expect(afterA.eq(beforeB)).toBe(true);
      expect(navigation.step(afterA, 1)!.eq(bStart)).toBe(true);
      expect(navigation.step(beforeB, -1)!.eq(aEnd)).toBe(true);

      // Vertical: A bottom edge -> Gap Space -> B top edge, and exact reverse.
      const verticalAfterA = navigation.stepVertical(aEnd, 1, () => true)!;
      const verticalBeforeB = navigation.stepVertical(bStart, -1, () => true)!;
      expect(verticalAfterA.eq(afterA)).toBe(true);
      expect(verticalBeforeB.eq(beforeB)).toBe(true);
      expect(navigation.stepVertical(verticalAfterA, 1, () => true)!.eq(bStart)).toBe(true);
      expect(navigation.stepVertical(verticalBeforeB, -1, () => true)!.eq(aEnd)).toBe(true);

      expect(ManagedBlockCursor.create(doc, 0, "after", (node): node is ProseMirrorNode => !!node && navigation.isBlock(node))!.eq(
        ManagedBlockCursor.create(doc, a.nodeSize, "before", (node): node is ProseMirrorNode => !!node && navigation.isBlock(node))!,
      )).toBe(true);
    });
  }

  it("uses two-arrow gap transitions for adjacent inline atoms and enters editable blocks directly from prose", () => {
    const image = schema.nodes.image.create(), math = schema.nodes.inline_math.create();
    const code = block("code_block");
    const doc = document(code, schema.nodes.paragraph.create(null, [image, math]), block("divider"));
    const codeEnd = navigation.enter(doc, 0, code, -1)!;
    const paraStart = TextSelection.create(doc, code.nodeSize + 1);
    const imgSel = NodeSelection.create(doc, code.nodeSize + 1);
    const betweenInline = TextSelection.create(doc, code.nodeSize + 2);
    const mathSel = NodeSelection.create(doc, code.nodeSize + 2);
    const paraEnd = TextSelection.create(doc, code.nodeSize + 3);
    const dividerSel = NodeSelection.create(doc, code.nodeSize + 4);

    // Walk forward: codeEnd -> paraStart -> imgSel -> betweenInline -> mathSel -> paraEnd -> dividerSel.
    const forward = [codeEnd, paraStart, imgSel, betweenInline, mathSel, paraEnd, dividerSel];
    for (let index = 0; index < forward.length - 1; index++) {
      expect(navigation.step(forward[index]!, 1)!.eq(forward[index + 1]!)).toBe(true);
      expect(navigation.step(forward[index + 1]!, -1)!.eq(forward[index]!)).toBe(true);
    }
  });

  it("supports symmetric entry and exit for nested managed blocks inside a blockquote", () => {
    const nestedCode = schema.nodes.code_block.create(null, schema.text("x"));
    const quote = schema.nodes.blockquote.create(null, [nestedCode]);
    const doc = document(paragraph("Before"), quote, paragraph("After"));
    const beforeEnd = TextSelection.create(doc, 7);

    // Before -> inner gap inside quote -> code start -> code end -> inner gap after -> After
    const innerBefore = navigation.step(beforeEnd, 1)!;
    expect(innerBefore).toBeInstanceOf(ManagedBlockCursor);
    expect(innerBefore.head).toBe(9);
    const codeStart = navigation.step(innerBefore, 1)!;
    expect(codeStart).toBeInstanceOf(TextSelection);
    expect(codeStart.head).toBe(10);
    // Reverse back to Before in two steps.
    expect(navigation.step(codeStart, -1)!.eq(innerBefore)).toBe(true);
    expect(navigation.step(innerBefore, -1)!.eq(beforeEnd)).toBe(true);
  });

  it("keeps document edges stable horizontally and vertically and exposes adjacent text carets without another stop", () => {
    for (const kind of ["diagram", "divider", "block_math"] as const) {
      const node = block(kind);
      const doc = document(node);
      const startSel = navigation.enter(doc, 0, node, 1)!;
      const endSel = navigation.enter(doc, 0, node, -1)!;
      const before = navigation.step(startSel, -1)!;
      const after = navigation.step(endSel, 1)!;
      expect(before).toBeInstanceOf(ManagedBlockCursor);
      expect(after).toBeInstanceOf(ManagedBlockCursor);
      expect(navigation.step(before, -1)!.eq(before)).toBe(true);
      expect(navigation.step(after, 1)!.eq(after)).toBe(true);
      expect(navigation.stepVertical(startSel, -1, () => true)!.eq(before)).toBe(true);
      expect(navigation.stepVertical(endSel, 1, () => true)!.eq(after)).toBe(true);
      expect(navigation.stepVertical(before, 1, () => true)!.eq(startSel)).toBe(true);
      expect(navigation.stepVertical(after, -1, () => true)!.eq(endSel)).toBe(true);
    }
    const diag = block("diagram");
    const mixed = document(paragraph("Before"), diag, paragraph("After"));
    expect(navigation.step(NodeSelection.create(mixed, 8), -1)).toMatchObject({ head: 7 });
    expect(navigation.step(NodeSelection.create(mixed, 8), 1)).toMatchObject({ head: 8 + diag.nodeSize + 1 });
  });

  it("leaves normal text, adjacent paragraphs, and hard breaks to native caret movement", () => {
    const doc = document(
      schema.nodes.paragraph.create(null, [schema.text("ab"), schema.nodes.hard_break.create(), schema.text("cd")]),
      paragraph("second"),
    );
    expect(navigation.step(TextSelection.create(doc, 2), 1)).toBeNull();
    expect(navigation.step(TextSelection.create(doc, 3), 1)).toBeNull();
    expect(navigation.step(TextSelection.create(doc, 1, 4), 1)).toBeNull();
    // Vertical motion between plain paragraphs always delegates to native browser.
    expect(navigation.stepVertical(TextSelection.create(doc, 2), 1, () => true)).toBeNull();
    expect(navigation.stepVertical(TextSelection.create(doc, 8), -1, () => true)).toBeNull();
  });

  it("does not cross into a following block vertically when a hard break remains below the caret", () => {
    const doc = document(
      schema.nodes.paragraph.create(null, [schema.text("ab"), schema.nodes.hard_break.create(), schema.text("cd")]),
      block("code_block"),
    );
    const { view, getState, setState } = createMockView(EditorState.create({ doc, selection: TextSelection.create(doc, 2) }));
    const plugin = createElementNavigationPlugin(managed);
    const press = (key: string) => plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent("keydown", { key }));

    // Caret on line 1 before hard_break: ArrowDown stays native.
    expect(press("ArrowDown")).toBe(false);
    // Caret on line 2 after hard_break: ArrowDown enters code_block at start.
    setState(EditorState.create({ doc, selection: TextSelection.create(doc, 5) }));
    expect(press("ArrowDown")).toBe(true);
    expect(getState().selection).toBeInstanceOf(TextSelection);
    expect(getState().selection.head).toBe(doc.firstChild!.nodeSize + 1);
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
