import { EditorSelection } from "@codemirror/state";
import { EditorView as CodeMirrorView, runScopeHandlers } from "@codemirror/view";
import { closeHistory } from "prosemirror-history";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createEditor, type MarkdownEditor } from "../src";
import {
  installControlledIntersectionObservers,
  waitForCodeBlockState,
} from "./codeBlockTestUtils";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
}

const editors: MarkdownEditor[] = [];
const intersectionObservers = installControlledIntersectionObservers(window);

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

async function activateCodeMirror(editor: MarkdownEditor) {
  intersectionObservers.emitAll(true);
  await waitForCodeBlockState(editor, "active");
  const dom = editor.view.dom.querySelector<HTMLElement>(".cm-editor");
  expect(dom).not.toBeNull();
  const codeMirror = CodeMirrorView.findFromDOM(dom!);
  expect(codeMirror).not.toBeNull();
  codeMirror!.focus();
  return codeMirror!;
}

function setCode(codeMirror: CodeMirrorView, text: string, anchor = text.length, head = anchor) {
  codeMirror.dispatch({
    changes: { from: 0, to: codeMirror.state.doc.length, insert: text },
    selection: EditorSelection.range(anchor, head),
  });
}

function handleInput(codeMirror: CodeMirrorView, text: string) {
  const { from, to } = codeMirror.state.selection.main;
  const initialState = codeMirror.state;
  const insert = () => initialState.update({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: "input.type",
  });

  return codeMirror.state.facet(CodeMirrorView.inputHandler).some((handler) => (
    handler(codeMirror, from, to, text, insert)
  ));
}

function typeText(codeMirror: CodeMirrorView, text: string) {
  for (const character of text) {
    if (!handleInput(codeMirror, character)) {
      const { from, to } = codeMirror.state.selection.main;
      codeMirror.dispatch({
        changes: { from, to, insert: character },
        selection: EditorSelection.cursor(from + character.length),
        userEvent: "input.type",
      });
    }
  }
}

function backspace(codeMirror: CodeMirrorView) {
  return runScopeHandlers(codeMirror, new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Backspace",
  }), "editor");
}

function runKey(
  codeMirror: CodeMirrorView,
  key: string,
  modifiers: Pick<KeyboardEventInit, "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> = {},
) {
  return runScopeHandlers(codeMirror, new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...modifiers,
  }), "editor");
}

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  editors.splice(0).reverse().forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("code-block typing ergonomics", () => {
  it("pairs only configured code brackets and quotes", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "```\nseed\n```",
      typing: {
        autoPairs: [
          "parentheses",
          "square-brackets",
          "braces",
          "single-quotes",
          "double-quotes",
          "inline-code",
        ],
      },
    }));
    const codeMirror = await activateCodeMirror(editor);

    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["'", "'"], ['"', '"']]) {
      setCode(codeMirror, "");
      expect(handleInput(codeMirror, open)).toBe(true);
      expect(codeMirror.state.doc.toString()).toBe(`${open}${close}`);
      expect(codeMirror.state.selection.main.head).toBe(open.length);
    }

    setCode(codeMirror, "");
    expect(handleInput(codeMirror, "`")).toBe(false);
    typeText(codeMirror, "`");
    expect(codeMirror.state.doc.toString()).toBe("`");
  });

  it("maps generated closers while never privileging pre-existing ones", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "```\n()\n```",
      typing: { autoPairs: ["parentheses"] },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "()", 1);
    expect(handleInput(codeMirror, ")")).toBe(false);
    typeText(codeMirror, ")");
    expect(codeMirror.state.doc.toString()).toBe("())");

    setCode(codeMirror, "");
    typeText(codeMirror, "(");
    codeMirror.dispatch({
      changes: { from: 1, insert: "value" },
      selection: EditorSelection.cursor(6),
    });
    expect(handleInput(codeMirror, ")")).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("(value)");
    expect(codeMirror.state.selection.main.head).toBe(7);

    setCode(codeMirror, "");
    typeText(codeMirror, "(");
    codeMirror.dispatch({
      changes: { from: 0, to: 1 },
      selection: EditorSelection.cursor(0),
    });
    expect(handleInput(codeMirror, ")")).toBe(false);
    typeText(codeMirror, ")");
    expect(codeMirror.state.doc.toString()).toBe("))");
  });

  it("wraps selections and deletes only empty generated pairs", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "```\nalpha\n```",
      typing: { autoPairs: ["braces", "square-brackets"] },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "alpha", 5, 0);
    typeText(codeMirror, "[");
    expect(codeMirror.state.doc.toString()).toBe("[alpha]");
    expect(codeMirror.state.selection.main.anchor).toBe(6);
    expect(codeMirror.state.selection.main.head).toBe(1);

    setCode(codeMirror, "");
    typeText(codeMirror, "{");
    expect(backspace(codeMirror)).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("");

    setCode(codeMirror, "{}", 1);
    expect(backspace(codeMirror)).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("}");

    setCode(codeMirror, "");
    typeText(codeMirror, "{");
    codeMirror.dispatch({
      changes: { from: 1, insert: "{" },
      selection: EditorSelection.cursor(2),
    });
    expect(backspace(codeMirror)).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("{}");
    expect(handleInput(codeMirror, "}")).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("{}");
  });

  it("respects selection wrapping, composition, and read-only policy", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "```\nalpha\n```",
      typing: { autoPairs: ["parentheses"], wrapSelection: false },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "alpha", 0, 5);
    expect(handleInput(codeMirror, "(")).toBe(false);
    typeText(codeMirror, "(");
    expect(codeMirror.state.doc.toString()).toBe("(");

    setCode(codeMirror, "");
    codeMirror.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(codeMirror.compositionStarted).toBe(true);
    expect(handleInput(codeMirror, "(")).toBe(false);
    expect(codeMirror.state.doc.toString()).toBe("");
    codeMirror.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    editor.updateOptions({ editable: false });
    expect(codeMirror.state.readOnly).toBe(true);
    expect(handleInput(codeMirror, "(")).toBe(false);
    expect(codeMirror.state.doc.toString()).toBe("");
  });

  it("uses configured outer history shortcuts inside an active code block", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: "```\nseed\n```",
      shortcuts: {
        "@markora/core/redo": "Alt-r",
        "@markora/core/undo": "Alt-u",
      },
      typing: { autoPairs: ["parentheses"] },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "seed!", 5);
    expect(editor.getMarkdown()).toContain("seed!");

    const isMac = /Mac|iP(hone|[oa]d)/u.test(navigator.platform);
    expect(runKey(codeMirror, "z", isMac ? { metaKey: true } : { ctrlKey: true })).toBe(true);
    expect(editor.getMarkdown()).toContain("seed!");

    expect(runKey(codeMirror, "u", { altKey: true })).toBe(true);
    expect(editor.getMarkdown()).not.toContain("seed!");
    expect(runKey(codeMirror, "r", { altKey: true })).toBe(true);
    expect(editor.getMarkdown()).toContain("seed!");

    setCode(codeMirror, "", 0);
    editor.view.dispatch(closeHistory(editor.view.state.tr));
    typeText(codeMirror, "(");
    expect(codeMirror.state.doc.toString()).toBe("()");
    expect(runKey(codeMirror, "u", { altKey: true })).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("");
    expect(runKey(codeMirror, "r", { altKey: true })).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("()");
    expect(handleInput(codeMirror, ")")).toBe(true);
    expect(codeMirror.state.doc.toString()).toBe("()");
  });

  it("preserves generated-pair provenance across offscreen reactivation", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: ["before", "", "```", "", "```"].join("\n"),
      typing: { autoPairs: ["parentheses"] },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "", 0);
    typeText(codeMirror, "(");
    expect(codeMirror.state.doc.toString()).toBe("()");

    editor.focus("start");
    intersectionObservers.emitAll(false);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await waitForCodeBlockState(editor, "inactive");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).not.toContain("()");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getMarkdown()).toContain("()");

    const reactivated = await activateCodeMirror(editor);
    reactivated.dispatch({ selection: EditorSelection.cursor(1) });
    expect(handleInput(reactivated, ")")).toBe(true);
    expect(reactivated.state.doc.toString()).toBe("()");
  });

  it("preserves generated-pair provenance across inactive fence-info edits", async () => {
    const editor = track(createEditor({
      element: host(),
      markdown: ["before", "", "```", "", "```"].join("\n"),
      typing: { autoPairs: ["parentheses"] },
    }));
    const codeMirror = await activateCodeMirror(editor);

    setCode(codeMirror, "", 0);
    typeText(codeMirror, "(");
    expect(codeMirror.state.doc.toString()).toBe("()");

    editor.focus("start");
    intersectionObservers.emitAll(false);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await waitForCodeBlockState(editor, "inactive");

    let codeBlockPos = -1;
    editor.view.state.doc.descendants((node, pos) => {
      if (node.type.name !== "code_block") {
        return true;
      }
      codeBlockPos = pos;
      return false;
    });
    expect(codeBlockPos).toBeGreaterThanOrEqual(0);
    const codeBlock = editor.view.state.doc.nodeAt(codeBlockPos)!;
    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
      codeBlockPos,
      undefined,
      { ...codeBlock.attrs, params: "ts" },
      codeBlock.marks,
    ));
    await waitForCodeBlockState(editor, "inactive");

    const reactivated = await activateCodeMirror(editor);
    reactivated.dispatch({ selection: EditorSelection.cursor(1) });
    expect(handleInput(reactivated, ")")).toBe(true);
    expect(reactivated.state.doc.toString()).toBe("()");
  });
});
