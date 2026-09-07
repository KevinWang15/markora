import { TextSelection } from "prosemirror-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type MarkdownEditor } from "../src/minimal";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const source = "```\nalpha\nbeta\ngamma\n```";
let editor: MarkdownEditor;

beforeEach(() => {
  const host = document.createElement("div");
  document.body.append(host);
  editor = createEditor({ element: host, markdown: source });
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 40, 20),
  ] as unknown as DOMRectList);
});

afterEach(() => {
  editor.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function navigate(key: string, anchor: number, head = anchor, modifiers: KeyboardEventInit = {}) {
  const { view } = editor;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  view.dom.dispatchEvent(event);
  return event;
}

describe("native code-block line edges", () => {
  it.each([
    ["Home", 4, 1],
    ["End", 4, 6],
    ["Home", 9, 7],
    ["End", 9, 11],
    ["Home", 14, 12],
    ["End", 14, 17],
  ])("moves %s from %i to %i synchronously", (key, start, expected) => {
    expect(navigate(key, start).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.anchor).toBe(expected);
    expect(editor.view.state.selection.head).toBe(expected);
    expect(editor.getMarkdown()).toBe(source);
  });

  it("extends and reverses a selection across hard line breaks", () => {
    expect(navigate("Home", 14, 9, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.anchor).toBe(14);
    expect(editor.view.state.selection.head).toBe(7);
    expect(navigate("End", 4, 9, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.anchor).toBe(4);
    expect(editor.view.state.selection.head).toBe(11);
  });

  it("measures only the current logical line", () => {
    const measured: string[] = [];
    vi.mocked(Range.prototype.getClientRects).mockImplementation(function (this: Range) {
      measured.push(this.toString());
      return [new DOMRect(0, 0, 40, 20)] as unknown as DOMRectList;
    });
    navigate("Home", 9);
    expect(measured).toContain("beta");
    expect(measured).not.toContain("alpha\nbeta\ngamma");
  });

  it("leaves soft-wrapped code lines to native visual navigation", () => {
    vi.mocked(Range.prototype.getClientRects).mockReturnValue([
      new DOMRect(0, 0, 40, 20),
      new DOMRect(0, 20, 20, 20),
    ] as unknown as DOMRectList);
    expect(navigate("Home", 9).defaultPrevented).toBe(false);
    expect(editor.view.state.selection.head).toBe(9);
  });

  it.each([
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ])("preserves native shortcuts and composition for %o", (modifiers) => {
    expect(navigate("Home", 9, 9, modifiers).defaultPrevented).toBe(false);
    expect(editor.view.state.selection.head).toBe(9);
  });

  it("does not claim keys from a read-only editor", () => {
    editor.updateOptions({ editable: false });
    expect(navigate("Home", 9).defaultPrevented).toBe(false);
    expect(editor.view.state.selection.head).toBe(9);
  });
});
