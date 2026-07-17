import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import {
  createEditor,
  createMinimalMarkdownEditorPreset,
  getMarkdownEditorTransactionOrigin,
  MarkdownEditorDestroyedError,
  type MarkdownEditor,
  type MarkdownEditorStateEvent,
} from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    cancel() {},
    finished: Promise.resolve(),
  })) as typeof Element.prototype.animate;
}

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function findTextRange(editor: MarkdownEditor, text: string, occurrence = 0) {
  let remaining = occurrence;
  let match: { from: number; to: number } | null = null;

  editor.view.state.doc.descendants((node, pos) => {
    if (match || !node.isText || !node.text) {
      return !match;
    }

    let offset = 0;
    while (offset <= node.text.length) {
      const index = node.text.indexOf(text, offset);

      if (index < 0) {
        break;
      }

      if (remaining === 0) {
        match = { from: pos + index, to: pos + index + text.length };
        return false;
      }

      remaining -= 1;
      offset = index + Math.max(1, text.length);
    }

    return true;
  });

  if (!match) {
    throw new Error(`Text ${JSON.stringify(text)} was not found.`);
  }

  return match as { from: number; to: number };
}

function selectText(
  editor: MarkdownEditor,
  text: string,
  mode: "all" | "end" | "start" = "end",
  occurrence = 0,
) {
  const range = findTextRange(editor, text, occurrence);
  const from = mode === "end" ? range.to : range.from;
  const to = mode === "all" ? range.to : from;
  editor.view.dispatch(
    editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, from, to)),
  );
}

function getNodeCount(editor: MarkdownEditor, name: string) {
  let count = 0;
  editor.view.state.doc.descendants((node) => {
    if (node.type.name === name) {
      count += 1;
    }
    return true;
  });
  return count;
}

function getFirstNodePosition(editor: MarkdownEditor, name: string) {
  let match: number | null = null;
  editor.view.state.doc.descendants((node, pos) => {
    if (node.type.name === name) {
      match = pos;
      return false;
    }
    return true;
  });

  if (match === null) {
    throw new Error(`Node ${name} was not found.`);
  }

  return match;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("public command and state surface", () => {
  it("sets paragraphs and heading levels with exact can and active semantics", () => {
    const editor = createEditor({ element: createHost(), markdown: "alpha" });
    const dispatch = vi.spyOn(editor.view, "dispatch");
    selectText(editor, "alpha", "end");
    dispatch.mockClear();

    expect(editor.state.isActive.paragraph()).toBe(true);
    expect(editor.state.isActive.heading()).toBe(false);
    expect(editor.state.can.setHeading(3)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();

    expect(editor.commands.setHeading(3)).toBe(true);
    expect(editor.getMarkdown()).toBe("### alpha");
    expect(editor.state.isActive.heading()).toBe(true);
    expect(editor.state.isActive.heading(3)).toBe(true);
    expect(editor.state.isActive.heading(2)).toBe(false);
    expect(editor.state.can.setHeading(3)).toBe(false);
    expect(editor.commands.setHeading(3)).toBe(false);
    expect(editor.commands.setParagraph()).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");
    expect(editor.state.isActive.paragraph()).toBe(true);

    editor.destroy();
  });

  it("toggles blockquotes as one undoable command transaction", () => {
    const origins: Array<string | undefined> = [];
    const editor = createEditor({
      element: createHost(),
      markdown: "alpha",
      onTransaction(transaction) {
        origins.push(getMarkdownEditorTransactionOrigin(transaction));
      },
    });
    selectText(editor, "alpha", "end");
    origins.length = 0;

    expect(editor.state.can.toggleBlockquote()).toBe(true);
    expect(editor.commands.toggleBlockquote()).toBe(true);
    expect(editor.getMarkdown()).toBe("> alpha");
    expect(editor.state.isActive.blockquote()).toBe(true);
    expect(origins).toEqual(["command"]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getMarkdown()).toBe("> alpha");
    expect(editor.commands.toggleBlockquote()).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.destroy();
  });

  it("switches list kinds, task state, and flat-task constraints without hidden attrs", () => {
    const editor = createEditor({
      element: createHost(),
      markdown: "* [x] one\n* [ ] two",
    });
    selectText(editor, "one", "end");

    expect(editor.state.isActive.taskList()).toBe(true);
    expect(editor.state.isActive.taskChecked()).toBe(true);
    expect(editor.state.can.sinkListItem()).toBe(false);
    expect(editor.commands.sinkListItem()).toBe(false);
    expect(editor.state.can.liftListItem()).toBe(false);
    expect(editor.commands.toggleOrderedList()).toBe(true);
    expect(editor.state.isActive.orderedList()).toBe(true);
    expect(editor.getMarkdown()).toBe("1. one\n\n2. two");

    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "list_item") {
        expect(node.attrs.checked).toBeNull();
      }
      return true;
    });

    const roundTripped = editor.getMarkdown();
    editor.commands.resetMarkdown(roundTripped);
    expect(editor.getMarkdown()).toBe(roundTripped);
    expect(editor.state.isActive.orderedList()).toBe(true);
    expect(editor.commands.toggleTaskList()).toBe(true);
    expect(editor.getMarkdown()).toBe("* [ ] one\n\n* two");
    expect(editor.state.isActive.taskList()).toBe(true);
    expect(editor.state.can.setTaskChecked(true)).toBe(true);
    expect(editor.commands.setTaskChecked(true)).toBe(true);
    expect(editor.getMarkdown()).toBe("* [x] one\n\n* two");
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(editor.getMarkdown()).toBe("* one\n\n* two");
    expect(editor.state.isActive.bulletList()).toBe(true);

    editor.destroy();
  });

  it("indents and outdents ordinary list items", () => {
    const editor = createEditor({
      element: createHost(),
      markdown: "* one\n* two",
    });
    selectText(editor, "two", "end");

    expect(editor.state.can.sinkListItem()).toBe(true);
    expect(editor.commands.sinkListItem()).toBe(true);
    expect(editor.getMarkdown()).toBe("* one\n  * two");
    expect(editor.state.can.liftListItem()).toBe(true);
    expect(editor.commands.liftListItem()).toBe(true);
    expect(editor.getMarkdown()).toBe("* one\n* two");

    editor.destroy();
  });

  it("inserts hard breaks and rules with deterministic selections", () => {
    const editor = createEditor({ element: createHost(), markdown: "alpha" });
    selectText(editor, "alpha", "end");

    expect(editor.state.can.insertHardBreak()).toBe(true);
    expect(editor.commands.insertHardBreak()).toBe(true);
    expect(getNodeCount(editor, "hard_break")).toBe(1);
    expect(editor.state.isActive.hardBreak()).toBe(true);
    expect(editor.commands.undo()).toBe(true);

    expect(editor.state.can.insertHorizontalRule()).toBe(true);
    expect(editor.commands.insertHorizontalRule()).toBe(true);
    expect(getNodeCount(editor, "horizontal_rule")).toBe(1);
    expect(editor.view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.isActive.horizontalRule()).toBe(false);

    const rulePos = getFirstNodePosition(editor, "horizontal_rule");
    editor.view.dispatch(
      editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, rulePos)),
    );
    expect(editor.state.isActive.horizontalRule()).toBe(true);
    expect(editor.state.isActive.node("horizontal_rule")).toBe(true);

    editor.destroy();
  });

  it("sets and retargets code blocks while validating language info", () => {
    const editor = createEditor({ element: createHost(), markdown: "const value = 1" });
    selectText(editor, "value", "end");

    expect(editor.state.can.setCodeBlock({ language: "ts" })).toBe(true);
    expect(editor.commands.setCodeBlock({ language: "ts" })).toBe(true);
    expect(editor.state.isActive.codeBlock()).toBe(true);
    expect(editor.state.isActive.codeBlock({ language: "ts" })).toBe(true);
    expect(editor.getMarkdown()).toBe("```ts\nconst value = 1\n```");
    expect(editor.state.can.setCodeBlock({ language: "ts" })).toBe(false);
    expect(editor.commands.setCodeBlock({ language: "javascript" })).toBe(true);
    expect(editor.getMarkdown()).toContain("```javascript");
    expect(editor.commands.setParagraph()).toBe(true);
    expect(editor.getMarkdown()).toBe("const value = 1");

    expect(() => editor.state.can.setHeading(0 as 1)).toThrow(RangeError);
    expect(() => editor.commands.setCodeBlock({ language: "bad\nlang" })).toThrow(RangeError);
    expect(() => editor.commands.setCodeBlock({ language: "bad\rlang" })).toThrow(RangeError);
    expect(editor.commands.setCodeBlock({ language: "lang`variant" })).toBe(true);
    expect(editor.state.isActive.codeBlock({ language: "lang`variant" })).toBe(true);
    expect(editor.getMarkdown()).toBe("~~~lang`variant\nconst value = 1\n~~~");

    editor.destroy();
  });

  it("inserts and edits a round-trippable table through the public surface", () => {
    const editor = createEditor({ element: createHost(), markdown: "before" });
    selectText(editor, "before", "end");

    expect(editor.state.can.insertTable({ columns: 2, rows: 3 })).toBe(true);
    expect(editor.commands.insertTable({ columns: 2, rows: 3 })).toBe(true);
    expect(editor.state.isActive.table()).toBe(true);
    expect(editor.state.isActive.node("table")).toBe(true);
    expect(getNodeCount(editor, "table_row")).toBe(3);
    expect(getNodeCount(editor, "table_header")).toBe(2);
    expect(getNodeCount(editor, "table_cell")).toBe(4);
    expect(editor.state.can.insertTable()).toBe(false);
    expect(editor.commands.insertTable()).toBe(false);

    expect(editor.commands.setTableColumnAlignment("center")).toBe(true);
    expect(editor.state.isActive.tableColumnAlignment("center")).toBe(true);
    expect(editor.state.can.setTableColumnAlignment("center")).toBe(false);
    expect(editor.commands.addTableColumn()).toBe(true);
    expect(getNodeCount(editor, "table_header")).toBe(3);
    expect(editor.commands.addTableRow()).toBe(true);
    expect(getNodeCount(editor, "table_row")).toBe(4);

    const serialized = editor.getMarkdown();
    expect(serialized).toContain(":---:");
    editor.commands.resetMarkdown(serialized);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(getNodeCount(editor, "table")).toBe(1);

    editor.destroy();
  });

  it("uses default table dimensions, clears alignment, and deletes the table", () => {
    const editor = createEditor({ element: createHost(), markdown: "" });

    expect(editor.state.can.insertTable()).toBe(true);
    expect(editor.commands.insertTable()).toBe(true);
    expect(getNodeCount(editor, "table_row")).toBe(2);
    expect(getNodeCount(editor, "table_header")).toBe(3);
    expect(getNodeCount(editor, "table_cell")).toBe(3);

    expect(editor.state.can.setTableColumnAlignment("right")).toBe(true);
    expect(editor.commands.setTableColumnAlignment("right")).toBe(true);
    expect(editor.state.isActive.tableColumnAlignment("right")).toBe(true);
    expect(editor.getMarkdown()).toContain("---:");

    expect(editor.state.can.setTableColumnAlignment(null)).toBe(true);
    expect(editor.commands.setTableColumnAlignment(null)).toBe(true);
    expect(editor.state.isActive.tableColumnAlignment(null)).toBe(true);
    expect(editor.state.can.setTableColumnAlignment(null)).toBe(false);
    expect(editor.getMarkdown()).not.toContain(":---");
    expect(editor.getMarkdown()).not.toContain("---:");

    expect(editor.state.can.deleteTable()).toBe(true);
    expect(editor.commands.deleteTable()).toBe(true);
    expect(getNodeCount(editor, "table")).toBe(0);
    expect(editor.getMarkdown()).toBe("");
    expect(editor.view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.can.deleteTable()).toBe(false);

    editor.destroy();
  });

  it("promotes the next row when deleting a table header row", () => {
    const editor = createEditor({
      element: createHost(),
      markdown: "| Head A | Head B |\n| --- | ---: |\n| Body A | Body B |",
    });
    selectText(editor, "Head A", "end");

    expect(editor.state.can.deleteTableRow()).toBe(true);
    expect(editor.commands.deleteTableRow()).toBe(true);
    expect(getNodeCount(editor, "table_row")).toBe(1);
    expect(getNodeCount(editor, "table_header")).toBe(2);
    expect(getNodeCount(editor, "table_cell")).toBe(0);
    expect(editor.getMarkdown()).toBe("| Body A | Body B |\n| --- | ---: |");

    const serialized = editor.getMarkdown();
    editor.commands.resetMarkdown(serialized);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(editor.state.isActive.table()).toBe(true);
    expect(editor.commands.deleteTableColumn()).toBe(true);
    expect(getNodeCount(editor, "table_header")).toBe(1);
    expect(editor.commands.deleteTableColumn()).toBe(true);
    expect(editor.state.isActive.table()).toBe(false);
    expect(editor.view.state.selection.$from.parent.type.name).toBe("paragraph");

    editor.destroy();
  });

  it("emits typed state events for stored-mark-only transactions", () => {
    const editor = createEditor({ element: createHost(), markdown: "alpha" });
    const events: MarkdownEditorStateEvent[] = [];
    editor.subscribe("state", (event) => events.push(event));
    selectText(editor, "alpha", "end");
    events.length = 0;

    expect(editor.commands.toggleMark("strong")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      docChanged: false,
      origin: "command",
      selectionChanged: false,
      type: "state",
    });
    expect(events[0].editor).toBe(editor);

    editor.destroy();
  });

  it("focuses only after successful editing commands", () => {
    const editor = createEditor({ element: createHost(), markdown: "alpha" });
    const outside = document.createElement("button");
    document.body.append(outside);
    selectText(editor, "alpha", "end");
    outside.focus();

    expect(editor.commands.setHeading(2)).toBe(true);
    expect(editor.view.hasFocus()).toBe(true);
    outside.focus();
    expect(editor.commands.setHeading(2)).toBe(false);
    expect(document.activeElement).toBe(outside);

    editor.destroy();
  });

  it("exposes pure remove capability and focuses after removing links and images", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const linkEditor = createEditor({
      element: createHost(),
      markdown: "[docs](https://example.com) tail",
    });
    const linkRange = findTextRange(linkEditor, "docs");
    linkEditor.view.dispatch(linkEditor.view.state.tr.setSelection(
      TextSelection.create(linkEditor.view.state.doc, linkRange.from + 1),
    ));
    outside.focus();

    expect(linkEditor.state.can.removeLink()).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(linkEditor.commands.removeLink()).toBe(true);
    expect(linkEditor.view.hasFocus()).toBe(true);
    expect(linkEditor.getMarkdown()).toBe("docs tail");
    expect(linkEditor.state.can.removeLink()).toBe(false);
    outside.focus();
    expect(linkEditor.commands.removeLink()).toBe(false);
    expect(document.activeElement).toBe(outside);
    linkEditor.destroy();

    const imageEditor = createEditor({
      element: createHost(),
      markdown: "![alt](https://example.com/image.png)",
    });
    const imagePos = getFirstNodePosition(imageEditor, "image");
    imageEditor.view.dispatch(imageEditor.view.state.tr.setSelection(
      NodeSelection.create(imageEditor.view.state.doc, imagePos),
    ));
    outside.focus();

    expect(imageEditor.state.can.removeImage()).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(imageEditor.commands.removeImage()).toBe(true);
    expect(imageEditor.view.hasFocus()).toBe(true);
    expect(imageEditor.getMarkdown()).toBe("");
    expect(imageEditor.state.can.removeImage()).toBe(false);
    outside.focus();
    expect(imageEditor.commands.removeImage()).toBe(false);
    expect(document.activeElement).toBe(outside);
    imageEditor.destroy();
  });

  it("keeps can pure and disables every mutation while read-only", () => {
    const editor = createEditor({
      editable: false,
      element: createHost(),
      markdown: "# alpha",
    });
    const dispatch = vi.spyOn(editor.view, "dispatch");

    expect(editor.state.isActive.heading(1)).toBe(true);
    expect(editor.state.can.setParagraph()).toBe(false);
    expect(editor.state.can.toggleBulletList()).toBe(false);
    expect(editor.state.can.insertHorizontalRule()).toBe(false);
    expect(editor.state.can.insertTable()).toBe(false);
    expect(editor.commands.setParagraph()).toBe(false);
    expect(editor.commands.insertTable()).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    editor.destroy();
  });

  it("exposes the same safe surface in both minimal runtime paths", () => {
    for (const editor of [
      createMinimalEditor({ element: createHost(), markdown: "alpha" }),
      createEditor({
        element: createHost(),
        extensionPreset: createMinimalMarkdownEditorPreset(),
        markdown: "alpha",
      }),
    ]) {
      selectText(editor, "alpha", "end");
      expect(editor.state.can.setHeading(2)).toBe(true);
      expect(editor.commands.setHeading(2)).toBe(true);
      expect(editor.state.isActive.heading(2)).toBe(true);
      expect(editor.commands.setParagraph()).toBe(true);
      expect(editor.state.can.toggleTaskList()).toBe(false);
      expect(editor.commands.toggleTaskList()).toBe(false);
      expect(editor.state.isActive.taskList()).toBe(false);
      expect(editor.state.can.insertTable()).toBe(false);
      expect(editor.commands.insertTable()).toBe(false);
      expect(editor.state.isActive.table()).toBe(false);
      expect(editor.state.isActive.tableColumnAlignment(null)).toBe(false);
      editor.destroy();
    }
  });

  it("validates table arguments and preserves destroyed-editor errors", () => {
    const editor = createEditor({ element: createHost(), markdown: "alpha" });

    expect(() => editor.state.can.insertTable({ rows: 0 })).toThrow(RangeError);
    expect(() => editor.commands.insertTable({ columns: 101 })).toThrow(RangeError);
    expect(() => editor.state.can.setTableColumnAlignment("wide" as "left")).toThrow(RangeError);
    expect(() => editor.commands.setTaskChecked("yes" as unknown as boolean)).toThrow(TypeError);

    editor.destroy();
    expect(() => editor.state.isActive.paragraph()).toThrow(MarkdownEditorDestroyedError);
    expect(() => editor.state.can.setHeading(2)).toThrow(MarkdownEditorDestroyedError);
    expect(() => editor.commands.insertTable()).toThrow(MarkdownEditorDestroyedError);
  });
});
