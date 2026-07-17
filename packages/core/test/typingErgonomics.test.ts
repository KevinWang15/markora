import { afterEach, describe, expect, it } from "vitest";
import { closeHistory } from "prosemirror-history";
import { TextSelection } from "prosemirror-state";
import { createEditor, type MarkdownEditor } from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
}

const activeEditors: MarkdownEditor[] = [];

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track<T extends MarkdownEditor>(editor: T) {
  activeEditors.push(editor);
  return editor;
}

function typeText(editor: MarkdownEditor, text: string) {
  for (const character of text) {
    const { from, to } = editor.view.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) => (
      handler(editor.view, from, to, character)
    ));

    if (!handled) {
      editor.view.dispatch(editor.view.state.tr.insertText(character, from, to));
    }
  }
}

function placeCaret(editor: MarkdownEditor, position: number) {
  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, position),
  ));
}

function selectText(editor: MarkdownEditor, from: number, to: number) {
  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, from, to),
  ));
}

function backspace(editor: MarkdownEditor) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Backspace",
  });
  return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));
}

afterEach(() => {
  activeEditors.splice(0).reverse().forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("configurable typing ergonomics", () => {
  it("keeps pairing opt-in and validates copied pair policies", () => {
    const pairs = ["parentheses"] as const;
    const editor = track(createEditor({
      element: host(),
      typing: { autoPairs: pairs },
    }));
    (pairs as unknown as string[])[0] = "braces";

    typeText(editor, "(");
    expect(editor.view.state.doc.textContent).toBe("()");

    expect(() => createEditor({
      element: host(),
      typing: { autoPairs: ["unknown" as "braces"] },
    })).toThrow(RangeError);
    const quoteAndCode = track(createEditor({
      element: host(),
      typing: { autoPairs: ["double-quotes", "inline-code"] },
    }));
    const promotedMarkdown = track(createEditor({
      element: host(),
      typing: { autoPairs: ["emphasis-asterisks", "strong-asterisks"] },
    }));
    expect(quoteAndCode.isDestroyed).toBe(false);
    expect(promotedMarkdown.isDestroyed).toBe(false);
    expect(() => createEditor({
      element: host(),
      typing: { autoPairs: null as never },
    })).toThrow(TypeError);
  });

  it("pairs, skips, deletes, and rehydrates only generated brackets", () => {
    const editor = track(createEditor({
      element: host(),
      typing: { autoPairs: ["parentheses"] },
    }));

    typeText(editor, "(");
    expect(editor.view.state.doc.textContent).toBe("()");
    expect(editor.view.state.selection.from).toBe(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("()");
    typeText(editor, ")");
    expect(editor.view.state.doc.textContent).toBe("()");

    placeCaret(editor, 2);
    expect(backspace(editor)).toBeFalsy();

    editor.commands.resetMarkdown("");
    typeText(editor, "(");
    editor.view.dispatch(closeHistory(editor.view.state.tr));
    expect(backspace(editor)).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("()");
    placeCaret(editor, 2);
    typeText(editor, ")");
    expect(editor.view.state.doc.textContent).toBe("()");

    editor.commands.resetMarkdown("()");
    placeCaret(editor, 2);
    typeText(editor, ")");
    expect(editor.view.state.doc.textContent).toBe("())");

    editor.commands.resetMarkdown("");
    typeText(editor, "(");
    editor.view.dispatch(editor.view.state.tr.delete(1, 3));
    editor.view.dispatch(editor.view.state.tr.insertText("()", 1));
    placeCaret(editor, 2);
    typeText(editor, ")");
    expect(editor.view.state.doc.textContent).toBe("())");

    editor.commands.resetMarkdown("");
    typeText(editor, "(");
    const replacement = editor.view.state.tr.replaceWith(
      1,
      3,
      editor.view.state.schema.text("()"),
    );
    replacement.setSelection(TextSelection.create(replacement.doc, 2));
    editor.view.dispatch(replacement);
    typeText(editor, ")");
    expect(editor.view.state.doc.textContent).toBe("())");
  });

  it("wraps literal selections in one undoable change and remains inert during IME", () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "alpha",
      typing: { autoPairs: ["double-quotes", "parentheses"] },
    }));

    selectText(editor, 1, 6);
    typeText(editor, '"');
    expect(editor.view.state.doc.textContent).toBe('"alpha"');
    placeCaret(editor, 7);
    typeText(editor, '"');
    expect(editor.view.state.doc.textContent).toBe('"alpha"');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("alpha");

    placeCaret(editor, 1);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "（",
    }));
    const { from, to } = editor.view.state.selection;
    const handledDuringComposition = editor.view.someProp("handleTextInput", (handler) => (
      handler(editor.view, from, to, "(")
    ));
    expect(handledDuringComposition).toBeFalsy();
    expect(editor.view.state.doc.textContent).toBe("alpha");

    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "（",
    }));
    typeText(editor, "(");
    expect(editor.view.state.doc.textContent).toBe("()alpha");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("alpha");
  });

  it("preserves backward selections and toggles compatible Markdown marks", () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "alpha",
      typing: { autoPairs: ["parentheses", "emphasis-asterisks"] },
    }));

    selectText(editor, 6, 1);
    typeText(editor, "(");
    expect(editor.view.state.doc.textContent).toBe("(alpha)");
    expect(editor.view.state.selection.anchor).toBe(7);
    expect(editor.view.state.selection.head).toBe(2);

    editor.commands.resetMarkdown("alpha");
    selectText(editor, 1, 6);
    typeText(editor, "*");
    expect(editor.getMarkdown()).toBe("*alpha*");
    typeText(editor, "*");
    expect(editor.getMarkdown()).toBe("alpha");
  });

  it("finalizes emphasis, promoted strong markers, and paired links", () => {
    const emphasis = track(createEditor({
      element: host(),
      typing: { autoPairs: ["emphasis-asterisks"] },
    }));
    typeText(emphasis, "*value*");
    expect(emphasis.getMarkdown()).toBe("*value*");

    const strong = track(createEditor({
      element: host(),
      typing: { autoPairs: ["strong-asterisks", "emphasis-asterisks"] },
    }));
    typeText(strong, "**value**");
    expect(strong.getMarkdown()).toBe("**value**");
    expect(strong.view.state.selection.from).toBe(6);
    expect(strong.view.state.selection.$from.parent.type.name).toBe("paragraph");

    const strike = track(createEditor({
      element: host(),
      typing: { autoPairs: ["strikethrough"] },
    }));
    typeText(strike, "~~value~~");
    expect(strike.getMarkdown()).toBe("~~value~~");

    const link = track(createEditor({
      element: host(),
      typing: { autoPairs: ["square-brackets", "parentheses"] },
    }));
    typeText(link, "[Docs](https://example.com)");
    expect(link.getMarkdown()).toBe("[Docs](https://example.com/)");
    expect(link.view.state.doc.textContent).toBe("Docs");
  });

  it("does not pair inside code contexts or turn unsupported minimal marks into literals", () => {
    const code = track(createEditor({
      element: host(),
      markdown: "`value`",
      typing: { autoPairs: ["parentheses"] },
    }));
    placeCaret(code, 3);
    typeText(code, "(");
    expect(code.view.state.doc.textContent).toBe("va(lue");

    code.commands.resetMarkdown("`value`");
    selectText(code, 1, 6);
    typeText(code, "(");
    expect(code.view.state.doc.textContent).toBe("(");

    const minimal = track(createMinimalEditor({
      element: host(),
      typing: { autoPairs: ["emphasis-asterisks", "strikethrough"] },
    }));
    typeText(minimal, "*value*");
    expect(minimal.getMarkdown()).toBe("*value*");

    minimal.commands.resetMarkdown("value");
    selectText(minimal, 1, 6);
    typeText(minimal, "~");
    expect(minimal.view.state.doc.textContent).toBe("~");
  });

  it("remaps and disables built-in shortcuts without changing defaults", () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "alpha",
      shortcuts: {
        "@markora/core/bold": "Alt-b",
        "@markora/core/italic": false,
      },
    }));
    selectText(editor, 1, 6);
    const isMac = /Mac|iP(hone|[oa]d)/u.test(navigator.platform);

    const oldBold = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...(isMac ? { metaKey: true } : { ctrlKey: true }),
      key: "b",
    });
    editor.view.dom.dispatchEvent(oldBold);
    expect(oldBold.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      key: "b",
    }));
    expect(editor.getMarkdown()).toBe("**alpha**");

    editor.commands.undo();
    const disabledItalic = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...(isMac ? { metaKey: true } : { ctrlKey: true }),
      key: "i",
    });
    editor.view.dom.dispatchEvent(disabledItalic);
    expect(disabledItalic.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "b",
    }));
    expect(editor.getMarkdown()).toBe("alpha");
  });
});
