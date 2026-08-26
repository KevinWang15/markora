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

function pressKey(editor: MarkdownEditor, key: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });

  return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
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

  it("continues completed tasks as unchecked items", () => {
    const editor = createEditor({
      element: createHost(),
      markdown: "* [x] completed",
    });
    selectText(editor, "completed", "end");

    expect(pressKey(editor, "Enter")).toBe(true);
    expect(editor.getMarkdown()).toBe("* [x] completed\n* [ ] ");
    expect(editor.state.isActive.taskChecked()).toBe(false);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("* [x] completed");

    editor.destroy();
  });

  it("inserts an unchecked task before a completed task without clearing it", () => {
    const editor = createEditor({
      element: createHost(),
      markdown: "* [x] completed",
    });
    selectText(editor, "completed", "start");

    expect(pressKey(editor, "Enter")).toBe(true);
    expect(editor.getMarkdown()).toBe("* [ ] \n* [x] completed");
    expect(editor.state.isActive.taskChecked()).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("* [x] completed");

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

  it("routes native history input through synchronized undo and redo state", () => {
    for (const editor of [
      createEditor({ element: createHost(), markdown: "alpha" }),
      createMinimalEditor({ element: createHost(), markdown: "alpha" }),
    ]) {
      selectText(editor, "alpha", "end");
      editor.view.dispatch(editor.view.state.tr.insertText("!"));
      expect(editor.getMarkdown()).toBe("alpha!");
      expect(editor.state.can.undo()).toBe(true);

      editor.view.dom.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "historyUndo",
      }));
      expect(editor.getMarkdown()).toBe("alpha");
      expect(editor.state.can.undo()).toBe(false);
      expect(editor.state.can.redo()).toBe(true);

      editor.view.dom.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "historyRedo",
      }));
      expect(editor.getMarkdown()).toBe("alpha!");
      expect(editor.state.can.undo()).toBe(true);
      expect(editor.state.can.redo()).toBe(false);

      editor.destroy();
    }
  });

  it("deletes graphemes split by marks atomically in both runtime paths", () => {
    for (const editor of [
      createEditor({ element: createHost(), markdown: "Ae**́**Z" }),
      createMinimalEditor({ element: createHost(), markdown: "Ae**́**Z" }),
    ]) {
      selectText(editor, "Z", "start");
      const backward = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      });

      expect(editor.view.dom.dispatchEvent(backward)).toBe(false);
      expect(backward.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe("AZ");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getMarkdown()).toBe("Ae**́**Z");

      editor.commands.resetMarkdown("A👩**‍**💻Z");
      selectText(editor, "A", "end");
      const forward = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentForward",
      });

      expect(editor.view.dom.dispatchEvent(forward)).toBe(false);
      expect(forward.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe("AZ");

      editor.commands.resetMarkdown("AB");
      selectText(editor, "B", "end");
      const nativeDeletion = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      });

      expect(editor.view.dom.dispatchEvent(nativeDeletion)).toBe(true);
      expect(nativeDeletion.defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("AB");

      editor.commands.resetMarkdown("Ae**́**Z");
      selectText(editor, "Z", "start");
      const noncancelableDeletion = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        inputType: "deleteContentBackward",
      });

      expect(editor.view.dom.dispatchEvent(noncancelableDeletion)).toBe(true);
      expect(noncancelableDeletion.defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("Ae**́**Z");

      editor.destroy();
    }
  });

  it("deletes words split by marks atomically in both runtime paths", () => {
    for (const editor of [
      createEditor({ element: createHost(), markdown: "alpha**beta** gamma" }),
      createMinimalEditor({ element: createHost(), markdown: "alpha**beta** gamma" }),
    ]) {
      selectText(editor, "beta", "end");
      const backward = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteWordBackward",
      });

      expect(editor.view.dom.dispatchEvent(backward)).toBe(false);
      expect(backward.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe(" gamma");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getMarkdown()).toBe("alpha**beta** gamma");

      editor.commands.resetMarkdown("alpha**beta** gamma");
      selectText(editor, "alpha", "start");
      const forward = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteWordForward",
      });

      expect(editor.view.dom.dispatchEvent(forward)).toBe(false);
      expect(forward.defaultPrevented).toBe(true);
      expect(editor.getMarkdown()).toBe(" gamma");

      editor.commands.resetMarkdown("alphabeta gamma");
      selectText(editor, "alphabeta", "end");
      const nativeDeletion = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteWordBackward",
      });

      expect(editor.view.dom.dispatchEvent(nativeDeletion)).toBe(true);
      expect(nativeDeletion.defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("alphabeta gamma");

      editor.commands.resetMarkdown("alpha**beta** gamma");
      selectText(editor, "beta", "end");
      const composingDeletion = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteWordBackward",
        isComposing: true,
      });

      expect(editor.view.dom.dispatchEvent(composingDeletion)).toBe(true);
      expect(composingDeletion.defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("alpha**beta** gamma");

      editor.destroy();
    }
  });

  it("navigates and extends independently of marks while preserving native boundaries", () => {
    const modifyDescriptor = Object.getOwnPropertyDescriptor(Selection.prototype, "modify");

    Object.defineProperty(Selection.prototype, "modify", {
      configurable: true,
      value(
        this: Selection,
        alter: "extend" | "move",
        direction: "backward" | "forward" | "left" | "right",
        granularity: "character" | "word",
      ) {
        const textNode = this.focusNode;

        if (!(textNode instanceof Text)) {
          throw new Error("The text-motion probe must use a text node.");
        }

        if (granularity === "character" && textNode.data === "wrapprobe") {
          this.collapse(textNode, 0);
          this.extend(textNode, 1);
          return;
        }

        const backward = direction === "backward" || direction === "left";
        const separator = textNode.data.indexOf(" ");
        const target = granularity === "character"
          ? Math.max(0, Math.min(
              textNode.data.length,
              this.focusOffset + (backward ? -1 : 1),
            ))
          : backward
            ? 0
            : separator < 0
              ? textNode.data.length
              : separator;

        if (alter === "move") {
          this.collapse(textNode, target);
        } else {
          this.extend(textNode, target);
        }
      },
    });

    try {
      for (const editor of [
        createEditor({ element: createHost(), markdown: "alpha**beta** gamma" }),
        createMinimalEditor({ element: createHost(), markdown: "alpha**beta** gamma" }),
      ]) {
        selectText(editor, "beta", "end");
        const extendBackward = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "ArrowLeft",
          shiftKey: true,
        });

        expect(editor.view.dom.dispatchEvent(extendBackward)).toBe(false);
        expect(extendBackward.defaultPrevented).toBe(true);
        expect(editor.view.state.selection).toMatchObject({
          anchor: 10,
          from: 1,
          head: 1,
          to: 10,
        });
        expect(editor.getMarkdown()).toBe("alpha**beta** gamma");

        editor.commands.resetMarkdown("alpha**beta** gamma");
        selectText(editor, "beta", "start");
        const extendCharacterBackward = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowLeft",
          shiftKey: true,
        });

        expect(editor.view.dom.dispatchEvent(extendCharacterBackward)).toBe(false);
        expect(extendCharacterBackward.defaultPrevented).toBe(true);
        expect(editor.view.state.selection).toMatchObject({
          anchor: 6,
          from: 5,
          head: 5,
          to: 6,
        });

        editor.commands.resetMarkdown("wrapprobe");
        selectText(editor, "probe", "start");
        const invalidCharacterProbe = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
          shiftKey: true,
        });

        expect(editor.view.dom.dispatchEvent(invalidCharacterProbe)).toBe(true);
        expect(invalidCharacterProbe.defaultPrevented).toBe(false);
        expect(editor.view.state.selection).toMatchObject({
          anchor: 5,
          from: 5,
          head: 5,
          to: 5,
        });

        editor.commands.resetMarkdown("alpha**beta** gamma");
        selectText(editor, "alpha", "start");
        const moveForward = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "ArrowRight",
        });

        expect(editor.view.dom.dispatchEvent(moveForward)).toBe(false);
        expect(moveForward.defaultPrevented).toBe(true);
        expect(editor.view.state.selection).toMatchObject({
          anchor: 10,
          from: 10,
          head: 10,
          to: 10,
        });

        editor.commands.resetMarkdown("alpha**beta** gamma");
        selectText(editor, "beta", "end");
        const composingNavigation = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          isComposing: true,
          key: "ArrowLeft",
          shiftKey: true,
        });

        expect(editor.view.dom.dispatchEvent(composingNavigation)).toBe(true);
        expect(composingNavigation.defaultPrevented).toBe(false);
        expect(editor.view.state.selection.from).toBe(10);

        editor.commands.resetMarkdown("alpha  \nbeta");
        selectText(editor, "alpha", "end");
        const hardBreakMarkdown = editor.getMarkdown();
        const atomAdjacentNavigation = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "ArrowRight",
        });

        expect(editor.view.dom.dispatchEvent(atomAdjacentNavigation)).toBe(true);
        expect(atomAdjacentNavigation.defaultPrevented).toBe(false);
        expect(editor.getMarkdown()).toBe(hardBreakMarkdown);

        editor.commands.resetMarkdown("**alpha**\n\n**beta**");
        selectText(editor, "alpha", "end");

        for (const blockEdgeNavigation of [
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: "ArrowRight",
          }),
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "ArrowRight",
            shiftKey: true,
          }),
        ]) {
          expect(editor.view.dom.dispatchEvent(blockEdgeNavigation)).toBe(true);
          expect(blockEdgeNavigation.defaultPrevented).toBe(false);
          expect(editor.view.state.selection.from).toBe(6);
        }

        for (const blockEdgeNavigation of [
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: "ArrowLeft",
          }),
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "ArrowLeft",
            shiftKey: true,
          }),
        ]) {
          selectText(editor, "beta", "start");
          expect(editor.view.dom.dispatchEvent(blockEdgeNavigation)).toBe(true);
          expect(blockEdgeNavigation.defaultPrevented).toBe(false);
          expect(editor.view.state.selection.from).toBe(8);
        }

        editor.destroy();
      }
    } finally {
      if (modifyDescriptor) {
        Object.defineProperty(Selection.prototype, "modify", modifyDescriptor);
      } else {
        Reflect.deleteProperty(Selection.prototype, "modify");
      }
    }
  });

  it("recovers native double-click word selection when mark reveal collapses it", () => {
    const modifyDescriptor = Object.getOwnPropertyDescriptor(Selection.prototype, "modify");

    Object.defineProperty(Selection.prototype, "modify", {
      configurable: true,
      value(
        this: Selection,
        alter: "extend" | "move",
        direction: "backward" | "forward" | "left" | "right",
        granularity: "character" | "word",
      ) {
        const textNode = this.focusNode;

        if (!(textNode instanceof Text) || alter !== "extend" || granularity !== "word") {
          throw new Error("The pointer word probe must extend an unmarked text node.");
        }

        if (textNode.data.includes("'")) {
          return;
        }

        this.extend(textNode, direction === "backward" ? 0 : textNode.data.length);
      },
    });

    try {
      for (const editor of [
        createEditor({ element: createHost(), markdown: "pre**fixmid**suffix" }),
        createMinimalEditor({ element: createHost(), markdown: "pre**fixmid**suffix" }),
      ]) {
        const originalPosAtCoords = editor.view.posAtCoords;
        editor.view.posAtCoords = () => ({ inside: -1, pos: 6 });
        const firstMouseDown = new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX: 20,
          clientY: 20,
          detail: 1,
        });
        expect(editor.view.dom.querySelector("strong")!.dispatchEvent(firstMouseDown)).toBe(true);

        selectText(editor, "fixmid", "end");
        const secondMouseDown = new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX: 20,
          clientY: 20,
          detail: 2,
        });
        const shiftedTarget = editor.view.dom.querySelector(".mdw-marker")
          ?? editor.view.dom.querySelector("strong")!;
        expect(shiftedTarget.dispatchEvent(secondMouseDown)).toBe(false);
        expect(secondMouseDown.defaultPrevented).toBe(true);
        expect(editor.view.state.selection).toMatchObject({
          anchor: 1,
          from: 1,
          head: 16,
          to: 16,
        });
        editor.view.posAtCoords = originalPosAtCoords;

        selectText(editor, "fixmid", "end");
        const modifiedDoubleClick = new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          cancelable: true,
          ctrlKey: true,
        });
        expect(editor.view.dom.querySelector("strong")!.dispatchEvent(modifiedDoubleClick)).toBe(true);
        expect(modifiedDoubleClick.defaultPrevented).toBe(false);
        expect(editor.view.state.selection.from).toBe(10);

        editor.commands.resetMarkdown("prefixmidsuffix");
        selectText(editor, "prefixmidsuffix", "end");
        const nativeDoubleClick = new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          cancelable: true,
        });
        expect(editor.view.dom.querySelector("p")!.dispatchEvent(nativeDoubleClick)).toBe(true);
        expect(nativeDoubleClick.defaultPrevented).toBe(false);
        expect(editor.view.state.selection.from).toBe(16);

        editor.destroy();
      }

      const segmentedFallbackEditor = createEditor({
        element: createHost(),
        markdown: "can'**tstop**now",
      });
      const originalPosAtCoords = segmentedFallbackEditor.view.posAtCoords;
      segmentedFallbackEditor.view.posAtCoords = () => ({ inside: -1, pos: 7 });
      const firstMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 30,
        clientY: 30,
        detail: 1,
      });
      expect(
        segmentedFallbackEditor.view.dom.querySelector("strong")!.dispatchEvent(firstMouseDown),
      ).toBe(true);

      selectText(segmentedFallbackEditor, "tstop", "end");
      const secondMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 30,
        clientY: 30,
        detail: 2,
      });
      expect(
        segmentedFallbackEditor.view.dom.querySelector(".mdw-marker")!.dispatchEvent(secondMouseDown),
      ).toBe(false);
      expect(secondMouseDown.defaultPrevented).toBe(true);
      expect(segmentedFallbackEditor.view.state.selection).toMatchObject({
        anchor: 1,
        from: 1,
        head: 13,
        to: 13,
      });
      segmentedFallbackEditor.view.posAtCoords = originalPosAtCoords;
      segmentedFallbackEditor.destroy();
    } finally {
      if (modifyDescriptor) {
        Object.defineProperty(Selection.prototype, "modify", modifyDescriptor);
      } else {
        Reflect.deleteProperty(Selection.prototype, "modify");
      }
    }
  });

  it("owns triple-click block dragging at stable model boundaries", () => {
    for (const editor of [
      createEditor({ element: createHost(), markdown: "one **two** three\n\nfour five" }),
      createMinimalEditor({ element: createHost(), markdown: "one **two** three\n\nfour five" }),
    ]) {
      let pointerPosition = 6;
      editor.view.posAtCoords = () => ({ inside: -1, pos: pointerPosition });
      editor.view.dom.getBoundingClientRect = () => ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 100,
        toJSON: () => ({}),
        top: 0,
        width: 100,
        x: 0,
        y: 0,
      });
      const target = editor.view.dom.querySelector("strong")!;
      const firstMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        detail: 1,
      });
      expect(target.dispatchEvent(firstMouseDown)).toBe(true);

      const thirdMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        detail: 3,
      });
      expect(target.dispatchEvent(thirdMouseDown)).toBe(false);
      expect(thirdMouseDown.defaultPrevented).toBe(true);
      expect(editor.view.state.selection).toMatchObject({
        anchor: 1,
        from: 1,
        head: 14,
        to: 14,
      });

      pointerPosition = 20;
      const move = new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        cancelable: true,
        clientX: 20,
        clientY: 40,
      });
      editor.view.dom.ownerDocument.dispatchEvent(move);
      expect(move.defaultPrevented).toBe(true);
      expect(editor.view.state.selection).toMatchObject({
        anchor: 1,
        from: 1,
        head: 25,
        to: 25,
      });

      editor.view.dom.ownerDocument.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        buttons: 0,
      }));

      selectText(editor, "two", "end");
      pointerPosition = 7;
      const currentTarget = editor.view.dom.querySelector("strong")!;
      expect(currentTarget.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        detail: 1,
      }))).toBe(true);
      const modifiedThirdMouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        ctrlKey: true,
        detail: 3,
      });
      expect(currentTarget.dispatchEvent(modifiedThirdMouseDown)).toBe(true);
      expect(modifiedThirdMouseDown.defaultPrevented).toBe(false);
      expect(editor.view.state.selection).toMatchObject({ from: 8, to: 8 });
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
