import { afterEach, expect, it } from "vitest";
import { createEditor, type MarkdownEditor } from "markora";
import { NodeSelection } from "prosemirror-state";
import { flushProseMirrorInput } from "../src/proseMirrorCompatibility";

const editors: MarkdownEditor[] = [];
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = (() => []) as unknown as typeof Range.prototype.getClientRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(markdown = "Formula: .") {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ element: host, markdown });
  editors.push(editor);
  editor.focus("end");
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

it("captures a native caret before the queued selectionchange event", () => {
  const editor = setup();
  document.getSelection()!.collapse(editor.view.dom.querySelector("p")!.firstChild!, 9);
  expect(editor.view.state.selection.head).toBe(11);
  flushProseMirrorInput(editor.view);
  expect(editor.view.state.selection.head).toBe(10);
  expect(editor.getMarkdown()).toBe("Formula: .");
  expect(editor.commands.undo()).toBe(false);
});

it("preserves the direction of a pending native range", () => {
  const editor = setup();
  const text = editor.view.dom.querySelector("p")!.firstChild!;
  document.getSelection()!.setBaseAndExtent(text, 9, text, 1);
  flushProseMirrorInput(editor.view);
  expect(editor.view.state.selection.anchor).toBe(10);
  expect(editor.view.state.selection.head).toBe(2);
});

it("retains an existing node selection when native selection has not changed", () => {
  const editor = setup("---\n\nAfter");
  const selection = NodeSelection.create(editor.view.state.doc, 0);
  editor.view.dispatch(editor.view.state.tr.setSelection(selection));
  flushProseMirrorInput(editor.view);
  expect(editor.view.state.selection.eq(selection)).toBe(true);
});
