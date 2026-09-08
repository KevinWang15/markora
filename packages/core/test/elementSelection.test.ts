import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { DecorationSet, EditorView } from "prosemirror-view";
import { ManagedBlockCursor } from "../src/managedBlockCursor";
import { DocumentRangeSelection } from "../src/documentRangeSelection";
import { createElementSelectionPlugin } from "../src/elementSelection";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { group: "block", content: "text*" },
  code_block: { group: "block", content: "text*", code: true },
  panel: { group: "block", content: "block+" },
  wrapper: { group: "block", content: "block+" },
  atom: { group: "block", atom: true },
  text: {},
} });
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const code = () => schema.nodes.code_block.create(null, schema.text("one\ntwo"));

function harness(children = [p("before"), code(), p("after")], anchor = 7, head = anchor) {
  const doc = schema.nodes.doc.create(null, children);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, anchor, head) });
  const dom = document.createElement("div");
  dom.dir = "ltr";
  const view = {
    get state() { return state; }, dom, composing: false, editable: true,
    domAtPos: () => ({ node: dom, offset: 0 }),
    endOfTextblock: () => true,
    dispatch(transaction: Parameters<EditorView["dispatch"]>[0]) { state = state.apply(transaction); },
  } as unknown as EditorView;
  const plugin = createElementSelectionPlugin(new Set(["code_block", "panel"]));
  const press = (key: string, options: KeyboardEventInit = {}) => plugin.props.handleKeyDown!.call(
    plugin, view, new KeyboardEvent("keydown", { key, shiftKey: true, ...options }),
  );
  return { view, plugin, press, after: children.slice(0, -1).reduce((size, node) => size + node.nodeSize, 1) };
}

describe("document selections across embedded elements", () => {
  it.each(["ArrowRight", "ArrowDown"])("%s includes the element and preserves the prose anchor", key => {
    const { view, press, after } = harness();
    expect(press(key)).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 7, head: after });
    expect(view.state.doc.textContent).toBe("beforeone\ntwoafter");
    expect(press("ArrowLeft")).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 7, head: 7 });
  });
  it("uses registration for a nested custom editing surface", () => {
    const panel = schema.nodes.panel.create(null, [p("first"), p("second")]);
    const { view, press, after } = harness([p("before"), panel, p("after")]);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 7, head: after });
  });
  it("leaves selections starting inside the surface to its own input handler", () => {
    const { view, press } = harness(undefined, 10);
    expect(press("ArrowRight")).toBe(false);
    expect(view.state.selection.head).toBe(10);
  });
  it("continues a native range whose head landed inside the surface", () => {
    const { view, press, after } = harness(undefined, 3, 10);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 3, head: after });
  });
  it("crosses an enclosing container edge without dropping the anchor", () => {
    const { view, press, after } = harness([schema.nodes.wrapper.create(null, p("before")), code(), p("after")], 8);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 8, head: after });
  });
  it("keeps a valid endpoint when the element ends the document", () => {
    const { view, press } = harness([p("before"), code()]);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection.head).toBe(view.state.doc.content.size);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection.$head.depth).toBe(0);
  });
  it("does not override plain navigation, composition, or modified movement", () => {
    const { press } = harness();
    for (const options of [{ shiftKey: false }, { isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press("ArrowRight", options)).toBe(false);
    }
  });
  it("selects consecutive embedded elements one at a time", () => {
    const atom = schema.nodes.atom.create();
    const { view, press } = harness([p("before"), atom, atom, p("after")]);
    expect(press("ArrowRight")).toBe(true);
    expect(view.state.selection).toBeInstanceOf(DocumentRangeSelection);
    expect(view.state.selection).toMatchObject({ anchor: 7, head: 9 });
    press("ArrowRight");
    expect(view.state.selection).toMatchObject({ anchor: 7, head: 11 });
    press("ArrowLeft");
    expect(view.state.selection).toMatchObject({ anchor: 7, head: 9 });
    press("ArrowLeft");
    expect(view.state.selection).toMatchObject({ anchor: 7, head: 7 });
  });
  it.each(["ArrowRight", "ArrowDown"])("%s collapses a terminal range after the element", key => {
    const { view, press } = harness([p("before"), schema.nodes.atom.create()]);
    press("ArrowRight");
    expect(press(key, { shiftKey: false })).toBe(true);
    expect(view.state.selection).toBeInstanceOf(ManagedBlockCursor);
    expect(view.state.selection).toMatchObject({ anchor: 9, head: 9, side: "after" });
  });
  it("collapses a terminal range towards its text start", () => {
    const { view, press } = harness([p("before"), schema.nodes.atom.create()]);
    press("ArrowRight");
    press("ArrowLeft", { shiftKey: false });
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    expect(view.state.selection.head).toBe(7);
  });
  it("typing replaces the entire model range, including the terminal atom", () => {
    const { view, plugin, press } = harness([p("before"), schema.nodes.atom.create()]);
    press("ArrowRight");
    expect(plugin.props.handleTextInput!.call(plugin, view, 7, 7, "next", () => view.state.tr)).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.textContent).toBe("beforenext");
  });

  it("extends from a managed boundary and returns to the same caret", () => {
    const { view, press } = harness([p("before"), schema.nodes.atom.create()]);
    press("ArrowRight");
    press("ArrowRight", { shiftKey: false });
    press("ArrowLeft");
    expect(view.state.selection).toMatchObject({ anchor: 9, head: 7 });
    press("ArrowRight");
    expect(view.state.selection).toBeInstanceOf(ManagedBlockCursor);
    expect(view.state.selection.head).toBe(9);
  });
  it("preserves native mouse range endpoints beside an atomic block", () => {
    const { view, plugin } = harness([p("before"), schema.nodes.atom.create()]);
    const range = plugin.props.createSelectionBetween!.call(plugin, view, view.state.doc.resolve(3), view.state.doc.resolve(9));
    expect(range).toBeInstanceOf(DocumentRangeSelection);
    expect(range).toMatchObject({ anchor: 3, head: 9 });
  });

  it("outlines fully selected surfaces without marking partially selected source", () => {
    const { view, plugin, press } = harness();
    expect(plugin.props.decorations!.call(plugin, view.state)).toBeNull();
    press("ArrowRight");
    const decorations = plugin.props.decorations!.call(plugin, view.state) as DecorationSet;
    expect(decorations.find()).toHaveLength(1);
    expect(decorations.find()[0]).toMatchObject({ from: 8, to: 17 });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 10)));
    expect(plugin.props.decorations!.call(plugin, view.state)).toBeNull();
  });

});
