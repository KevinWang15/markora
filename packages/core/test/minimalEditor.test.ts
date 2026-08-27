import { afterEach, describe, expect, it, vi } from "vitest";
import { InputRule, Plugin, PluginKey, TextSelection } from "../src/extension-api";
import {
  ManagedBlockCursor,
  MarkdownEditorDestroyedError,
  createEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
  type MarkdownEditorChangeOrigin,
} from "../src/minimal";
import {
  calloutExtension,
  highlightExtension,
} from "./support/publicExtensions";

const editors: MarkdownEditor[] = [];

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

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }

  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("minimal embedded editor entry", () => {
  it("mounts the CommonMark foundation without compatibility-only surfaces", () => {
    const ui = vi.fn(() => {
      throw new Error("the minimal entry must not create default UI");
    });
    const editor = track(createEditor({
      ariaLabel: "Document body",
      element: createHost(),
      markdown: "# Hello\n\n**small** and `direct`",
      placeholder: "Start writing",
      ui,
    }));

    expect(editor.ui).toBeNull();
    expect(ui).not.toHaveBeenCalled();
    expect(editor.extensions.manifest.preset?.name).toBe("markora/minimal");
    expect(editor.extensions.manifest.extensions).toEqual([]);
    expect(editor.view.state.schema.nodes.table).toBeUndefined();
    expect(editor.view.state.schema.nodes.raw_block).toBeUndefined();
    expect(editor.view.state.schema.marks.strike).toBeUndefined();
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
    expect(editor.view.dom.getAttribute("role")).toBe("textbox");
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Document body");
    expect(editor.view.dom.getAttribute("aria-multiline")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-placeholder")).toBe("Start writing");
    expect(editor.getMarkdown()).toContain("# Hello");
    expect(editor.commands.toggleMark("strike")).toBe(false);
    expect(editor.getToolbarState().strike).toEqual({ active: false, enabled: false });
  });

  it("keeps the compatibility command and state facade useful for foundation features", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "link target",
    }));

    editor.focus({ anchor: 1, head: 5 });
    expect(editor.state.can.setLink()).toBe(true);
    expect(editor.commands.setLink("https://example.com/docs")).toBe(true);
    expect(editor.state.isActive.mark("link")).toBe(true);
    expect(editor.getMarkdown()).toBe("[link](https://example.com/docs) target");
    expect(editor.commands.removeLink()).toBe(true);
    expect(editor.getMarkdown()).toBe("link target");
    expect(editor.commands.setLink("javascript:alert(1)")).toBe(false);

    editor.commands.resetMarkdown("");
    expect(editor.state.can.insertImage()).toBe(true);
    expect(editor.commands.insertImage({
      src: "/asset.png",
      alt: "Asset",
    })).toBe(true);
    expect(editor.state.isActive.node("image")).toBe(true);
    expect(editor.commands.removeImage()).toBe(true);

    editor.view.dispatch(editor.view.state.tr.insertText("history"));
    expect(editor.state.can.undo()).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.commands.redo()).toBe(true);
  });

  it("continues, indents, and outdents lists without trapping unrelated Tab input", () => {
    const original = "* parent\n* child";
    const nested = "* parent\n  * child";
    const editor = track(createEditor({
      element: createHost(),
      markdown: original,
    }));
    const selectTextEnd = (text: string) => {
      let end: number | undefined;

      editor.view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === text) {
          end = pos + node.nodeSize;
        }
      });

      if (end === undefined) {
        throw new Error(`Missing text ${JSON.stringify(text)}.`);
      }

      editor.view.dispatch(editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, end),
      ));
    };
    const press = (key: "Enter" | "Tab", shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };

    selectTextEnd("child");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(nested);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(original);

    editor.commands.resetMarkdown(nested);
    selectTextEnd("child");
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(original);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(nested);

    editor.commands.resetMarkdown("* parent");
    selectTextEnd("parent");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("* parent\n* ");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(editor.view.state.doc.childCount).toBe(2);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(editor.view.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.view.state.doc.lastChild?.type.name).toBe("paragraph");

    editor.commands.resetMarkdown("* only");
    selectTextEnd("only");
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* only");

    editor.commands.resetMarkdown("plain");
    selectTextEnd("plain");
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("plain");
  });

  it("lifts list items before a later Backspace joins their content", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "" }));
    const selectTextStart = (text: string, offset = 0) => {
      let start: number | undefined;

      editor.view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === text) {
          start = pos + offset;
        }
      });

      if (start === undefined) {
        throw new Error(`Missing text ${JSON.stringify(text)}.`);
      }

      editor.view.dispatch(editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, start),
      ));
    };
    const pressBackspace = (init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };
    const cases = [
      ["* alpha", "alpha", "alpha"],
      ["* alpha\n* beta", "alpha", "alpha\n\n* beta"],
      ["* alpha\n* beta", "beta", "* alpha\n\nbeta"],
      ["* alpha\n* beta\n* gamma", "beta", "* alpha\n\nbeta\n\n* gamma"],
      ["* parent\n  * child", "child", "* parent\n* child"],
      ["1. parent\n   1. child", "child", "1. parent\n2. child"],
      ["before\n\n* child", "child", "before\n\nchild"],
      ["* alpha\n\n  beta", "beta", "* alphabeta"],
    ] as const;

    for (const [markdown, target, result] of cases) {
      editor.commands.resetMarkdown(markdown);
      selectTextStart(target);
      expect(pressBackspace().defaultPrevented, markdown).toBe(true);
      expect(editor.getMarkdown(), markdown).toBe(result);
      expect(editor.commands.undo(), markdown).toBe(true);
      expect(editor.getMarkdown(), markdown).toBe(markdown);
    }

    editor.commands.resetMarkdown("* alpha\n* beta");
    selectTextStart("beta");
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("* alpha\n\nbeta");
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("* alphabeta");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("* alpha\n\nbeta");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");

    selectTextStart("beta", 1);
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");

    selectTextStart("beta");
    expect(pressBackspace({ altKey: true }).defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");

    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "x",
    }));
    expect(editor.view.composing).toBe(true);
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "x",
    }));

    editor.updateOptions({ editable: false });
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");
  });

  it("joins list items forward without flattening nested branches", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "" }));
    const selectTextEnd = (text: string, offset = 0) => {
      let end: number | undefined;

      editor.view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === text) {
          end = pos + node.nodeSize - offset;
        }
      });

      if (end === undefined) {
        throw new Error(`Missing text ${JSON.stringify(text)}.`);
      }

      editor.view.dispatch(editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, end),
      ));
    };
    const pressDelete = (init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };
    const branching = [
      "* Item 1",
      "  * Item 1.1",
      "    * Item 1.1.1",
      "    * Item 1.1.2",
      "  * Item 1.2",
      "* Item 2",
    ].join("\n");
    const branchingHoisted = [
      "* Item 1",
      "* Item 1.1",
      "  * Item 1.1.1",
      "  * Item 1.1.2",
      "* Item 1.2",
      "* Item 2",
    ].join("\n");
    const cases = [
      ["* alpha\n* beta", "alpha", "* alphabeta"],
      ["3. alpha\n4. beta", "alpha", "3. alphabeta"],
      ["* alpha\n* **beta**", "alpha", "* alpha**beta**"],
      ["* Outer\n  * Inner", "Outer", "* OuterInner"],
      [
        "* Outer\n  * Inner 1\n  * Inner 2\n* Next",
        "Outer",
        "* OuterInner 1\n* Inner 2\n* Next",
      ],
      [branching, "Item 1", branchingHoisted],
      ["* parent\n  * child\n* after", "child", "* parent\n  * childafter"],
      ["* parent\n  * alpha\n  * beta", "alpha", "* parent\n  * alphabeta"],
      ["* alpha\n\nbeta", "alpha", "* alphabeta"],
      ["* alpha\n* beta\n\nafter", "alpha", "* alphabeta\n\nafter"],
      ["* alpha\n* beta\n  * child\n* gamma", "alpha", "* alphabeta\n  * child\n* gamma"],
      ["* alpha\n\n  beta\n\n* gamma", "alpha", "* alphabeta\n\n* gamma"],
    ] as const;

    for (const [markdown, target, result] of cases) {
      editor.commands.resetMarkdown(markdown);
      selectTextEnd(target);
      expect(pressDelete().defaultPrevented, markdown).toBe(true);
      expect(editor.getMarkdown(), markdown).toBe(result);
      expect(editor.view.state.selection, markdown).toBeInstanceOf(TextSelection);
      expect(editor.commands.undo(), markdown).toBe(true);
      expect(editor.getMarkdown(), markdown).toBe(markdown);
    }

    editor.commands.resetMarkdown(branching);
    selectTextEnd("Item 1");
    expect(pressDelete().defaultPrevented).toBe(true);
    expect(pressDelete().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe([
      "* Item 1Item 1.1",
      "  * Item 1.1.1",
      "  * Item 1.1.2",
      "* Item 1.2",
      "* Item 2",
    ].join("\n"));
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(branchingHoisted);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(branching);

    editor.commands.resetMarkdown("* alpha\n* beta");
    selectTextEnd("alpha", 1);
    expect(pressDelete().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");

    selectTextEnd("alpha");
    expect(pressDelete({ altKey: true }).defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");

    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "x",
    }));
    expect(editor.view.composing).toBe(true);
    expect(pressDelete().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "x",
    }));

    editor.updateOptions({ editable: false });
    expect(pressDelete().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("* alpha\n* beta");
  });

  it("exits coincident inline marks without moving or retaining active state", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "pre [***fix***](/target) suffix",
    }));
    let markEnd: number | undefined;

    editor.view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "fix") {
        markEnd = pos + node.nodeSize;
      }
    });
    if (markEnd === undefined) {
      throw new Error("Missing nested marked text.");
    }

    editor.view.dispatch(editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, markEnd),
    ));
    const arrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });

    expect(editor.view.dom.dispatchEvent(arrow)).toBe(false);
    expect(arrow.defaultPrevented).toBe(true);
    expect(editor.view.state.selection.head).toBe(markEnd);
    expect(editor.state.isActive.mark("strong")).toBe(false);
    expect(editor.state.isActive.mark("em")).toBe(false);
    expect(editor.state.isActive.mark("link")).toBe(false);
    expect(editor.state.can.removeLink()).toBe(false);
    expect(editor.getToolbarState()).toMatchObject({
      bold: { active: false },
      italic: { active: false },
      link: { active: false },
    });

    editor.view.dispatch(editor.view.state.tr.insertText("X"));
    const inserted = editor.view.state.selection.$from.nodeBefore;
    expect(inserted?.text).toBe("X");
    expect(inserted?.marks).toEqual([]);
    expect(editor.getMarkdown()).toBe("pre ***[fix](/target)***X suffix");

    editor.commands.resetMarkdown("**fix**");
    editor.focus({ anchor: 4 });
    const composingArrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "ArrowRight",
    });
    expect(editor.view.dom.dispatchEvent(composingArrow)).toBe(true);
    expect(composingArrow.defaultPrevented).toBe(false);
  });

  it("inserts, remaps, and disables the shared hard-break shortcut safely", () => {
    const pressEnter = (editor: MarkdownEditor, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };
    const original = "alphaomega";

    const defaults = track(createEditor({
      element: createHost(),
      markdown: original,
    }));
    defaults.focus({ anchor: 6 });
    expect(pressEnter(defaults, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(defaults.getMarkdown()).toBe("alpha\\\nomega");
    expect(defaults.commands.undo()).toBe(true);
    expect(defaults.getMarkdown()).toBe(original);

    const disabled = track(createEditor({
      element: createHost(),
      markdown: original,
      shortcuts: { "@markora/core/hard-break": false },
    }));
    disabled.focus({ anchor: 6 });
    expect(pressEnter(disabled, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(disabled.getMarkdown()).toBe(original);

    const remapped = track(createEditor({
      element: createHost(),
      markdown: original,
      shortcuts: { "@markora/core/hard-break": "Alt-Enter" },
    }));
    remapped.focus({ anchor: 6 });
    expect(pressEnter(remapped, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(remapped.getMarkdown()).toBe(original);
    expect(pressEnter(remapped, { altKey: true }).defaultPrevented).toBe(true);
    expect(remapped.getMarkdown()).toBe("alpha\\\nomega");
  });

  it("changes heading marker levels with exact editability and key guards", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "### title",
    }));
    const pressBackspace = (init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };
    const typeHash = () => {
      const { from, to } = editor.view.state.selection;
      return Boolean(editor.view.someProp("handleTextInput", (handler) => (
        handler(editor.view, from, to, "#")
      )));
    };

    editor.focus({ anchor: 1 });
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("## title");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("### title");

    expect(typeHash()).toBe(true);
    expect(editor.getMarkdown()).toBe("#### title");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("### title");

    editor.commands.resetMarkdown("# title");
    editor.focus({ anchor: 1 });
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("title");

    editor.commands.resetMarkdown("###### title");
    editor.focus({ anchor: 1 });
    expect(typeHash()).toBe(false);
    expect(editor.getMarkdown()).toBe("###### title");

    editor.commands.resetMarkdown("### title");
    editor.focus({ anchor: 1 });
    for (const init of [
      { ctrlKey: true },
      { isComposing: true },
      { shiftKey: true },
    ]) {
      expect(pressBackspace(init).defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe("### title");
    }

    editor.updateOptions({ editable: false });
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(typeHash()).toBe(false);
    expect(editor.getMarkdown()).toBe("### title");
  });

  it("unwraps code blocks at the first caret with exact Backspace guards", () => {
    const original = ["```js", "alpha", "beta", "```"].join("\n");
    const editor = track(createEditor({
      element: createHost(),
      markdown: original,
    }));
    const pressBackspace = (init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };

    editor.focus({ anchor: 1 });
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha\n\nbeta");
    expect(editor.view.state.doc.childCount).toBe(2);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.view.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(original);

    editor.commands.resetMarkdown(["```js", "", "```"].join("\n"));
    editor.focus({ anchor: 1 });
    expect(pressBackspace().defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("");
    expect(editor.view.state.doc.childCount).toBe(1);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("paragraph");

    for (const init of [
      { ctrlKey: true },
      { isComposing: true },
      { shiftKey: true },
    ]) {
      editor.commands.resetMarkdown(original);
      editor.focus({ anchor: 1 });
      expect(pressBackspace(init).defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe(original);
    }

    editor.updateOptions({ editable: false });
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe(original);
  });

  it("runs foundation typing rules without compatibility-only task or strike rules", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "",
    }));
    const typeText = (text: string) => {
      for (const character of text) {
        const { from, to } = editor.view.state.selection;
        const handled = editor.view.someProp("handleTextInput", (handler) => (
          handler(editor.view, from, to, character)
        ));

        if (!handled) {
          editor.view.dispatch(editor.view.state.tr.insertText(character, from, to));
        }
      }
    };

    typeText("# ");
    expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.view.state.doc.firstChild?.attrs.level).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("");

    typeText("~~literal~~");
    expect(editor.view.state.doc.textContent).toBe("~~literal~~");
    expect(editor.view.state.schema.marks.strike).toBeUndefined();

    editor.commands.resetMarkdown("");
    typeText("* [x] task");
    const listItem = editor.view.state.doc.firstChild?.firstChild;
    expect(editor.view.state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(listItem?.type.name).toBe("list_item");
    expect(listItem?.attrs.checked).toBeUndefined();
    expect(listItem?.textContent).toBe("[x] task");
  });

  it("restores literal Markdown with Backspace immediately after every foundation input rule", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "" }));
    const typeText = (text: string) => {
      for (const character of text) {
        const { from, to } = editor.view.state.selection;
        const handled = editor.view.someProp("handleTextInput", (handler) => (
          handler(editor.view, from, to, character)
        ));

        if (!handled) {
          editor.view.dispatch(editor.view.state.tr.insertText(character, from, to));
        }
      }
    };
    const pressBackspace = (init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
        ...init,
      });
      editor.view.dom.dispatchEvent(event);
      return event;
    };
    const cases = [
      ["# ", "\\# ", "heading"],
      ["> ", "\\> ", "blockquote"],
      ["* ", "\\* ", "bullet_list"],
      ["3. ", "3\\. ", "ordered_list"],
      ["*em*", "\\*em\\*", "em"],
      ["**bold**", "\\*\\*bold\\*\\*", "strong"],
      ["`code`", "\\`code\\`", "code"],
      ["[link](/target)", "\\[link\\](/target)", "link"],
      ["![alt](/image.png)", "!\\[alt\\](/image.png)", "image"],
      ["```js ", "\\`\\`\\`js ", "code_block"],
    ] as const;

    for (const [source, literal, transformedType] of cases) {
      editor.commands.resetMarkdown("");
      typeText(source);
      let transformed = false;
      editor.view.state.doc.descendants((node) => {
        if (node.type.name === transformedType || node.marks.some((mark) => mark.type.name === transformedType)) {
          transformed = true;
          return false;
        }
        return true;
      });
      expect(transformed, source).toBe(true);
      expect(pressBackspace().defaultPrevented, source).toBe(true);
      expect(editor.getMarkdown(), source).toBe(literal);
    }

    editor.commands.resetMarkdown("");
    typeText("# ");
    expect(pressBackspace({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(pressBackspace({ isComposing: true }).defaultPrevented).toBe(false);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");

    editor.commands.resetMarkdown("");
    typeText("*em*");
    editor.view.dispatch(editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, 1),
    ));
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.view.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe("em");

    editor.commands.resetMarkdown("");
    typeText("# ");
    editor.view.dispatch(editor.view.state.tr.insertText("later"));
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe("# later");

    editor.commands.resetMarkdown("");
    typeText("# ");
    editor.updateOptions({ editable: false });
    expect(pressBackspace().defaultPrevented).toBe(false);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");
  });

  it("uses one extension codec, registry, and assembly across document updates", () => {
    const editor = track(createEditor({
      element: createHost(),
      extensions: [highlightExtension, calloutExtension],
      markdown: ":::warning Deploy\n\nInside ==hot==.\n\n:::",
    }));
    const handle = editor.extensions.get(calloutExtension);

    expect(editor.view.state.doc.firstChild?.type.name).toBe("acme_callout");
    expect(editor.getMarkdown()).toContain("==hot==");
    expect(editor.extensions.manifest.extensions.map(({ name }) => name)).toEqual([
      "@acme/highlight",
      "@acme/callout",
    ]);
    expect(handle.commands.wrapWarning()).toBe(true);
    expect(handle.storage.commandRuns).toBe(1);
    expect(editor.commands.reconcileMarkdown("reconciled")).toBe(true);
    expect(editor.commands.reconcileMarkdown("reconciled")).toBe(false);
    editor.commands.resetMarkdown("reset");
    expect(editor.extensions.get(calloutExtension)).toBe(handle);
    expect(handle.storage.commandRuns).toBe(1);
    expect(editor.getMarkdown()).toBe("reset");
  });

  it("applies the managed-block boundary contract to extension blocks", () => {
    const editor = track(createEditor({
      element: createHost(),
      extensions: [calloutExtension],
      markdown: ":::warning Boundary\n\nInside.\n\n:::",
    }));
    const callout = editor.view.state.doc.firstChild;

    expect(callout?.type.name).toBe("acme_callout");
    const boundary = ManagedBlockCursor.create(
      editor.view.state.doc,
      0,
      "after",
      (node) => node.type.name === "acme_callout",
    );
    expect(boundary).not.toBeNull();

    editor.view.dispatch(editor.view.state.tr.setSelection(boundary!));
    expect(editor.view.dom.classList.contains("mdw-has-managed-block-cursor")).toBe(true);
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }));

    expect(editor.view.state.doc.childCount).toBe(2);
    expect(editor.view.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
  });

  it("installs extension plugin, input, keymap, clipboard, and NodeView lanes", () => {
    const activity = new PluginKey<number>("minimal-lane-activity");
    const calls: string[] = [];
    const lanes = defineMarkdownEditorExtension({
      name: "acme-minimal-lanes",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: ({ schema }) => ({
        inputRules: [{
          id: "bang",
          create: () => new InputRule(/!!$/, (state, _match, start, end) => (
            state.tr.replaceWith(start, end, schema.text("important"))
          )),
        }],
        plugins: [{
          id: "activity",
          create: () => new Plugin<number>({
            key: activity,
            state: {
              init: () => 0,
              apply: (transaction, value) => transaction.docChanged ? value + 1 : value,
            },
          }),
        }],
        keymaps: [{
          id: "shortcut",
          key: "Ctrl-Alt-k",
          create: () => () => {
            calls.push("keymap");
            return true;
          },
        }],
        clipboard: {
          transforms: [{
            id: "text",
            kind: "text",
            surface: "outer",
            create: () => (text) => `${text}:minimal`,
          }],
        },
        nodeViews: [{
          id: "paragraph",
          node: "paragraph",
          create: () => () => {
            const dom = document.createElement("p");
            dom.dataset.minimalNodeView = "true";
            return { dom, contentDOM: dom };
          },
        }],
      }),
    });
    const editor = track(createEditor({
      element: createHost(),
      extensions: [lanes],
      markdown: "lane",
    }));
    let pasted = "source";

    editor.view.someProp("transformPastedText", (transform) => {
      pasted = transform(pasted, false, editor.view);
    });
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    }));
    editor.view.dispatch(editor.view.state.tr.insertText("!"));

    expect(pasted).toBe("source:minimal");
    expect(calls).toEqual(["keymap"]);
    expect(editor.view.dom.querySelector("[data-minimal-node-view=true]")).not.toBeNull();
    expect(activity.getState(editor.view.state)).toBeGreaterThan(0);

    editor.commands.resetMarkdown("");
    for (const character of "!!") {
      const { from, to } = editor.view.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handler) => (
        handler(editor.view, from, to, character)
      ));
      if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(character, from, to));
    }
    expect(editor.view.state.doc.textContent).toBe("important");
    const recovery = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
    });
    editor.view.dom.dispatchEvent(recovery);
    expect(recovery.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("!!");
  });

  it("enforces read-only, URL, file-transfer, and dynamic option policies", () => {
    const host = createHost();
    const onChange = vi.fn();
    const editor = track(createEditor({
      attributes: { "data-surface": "minimal" },
      editable: false,
      element: host,
      markdown: "safe",
      onChange,
    }));
    const before = editor.getMarkdown();

    editor.view.dispatch(editor.view.state.tr.insertText("blocked"));
    expect(editor.getMarkdown()).toBe(before);
    expect(editor.commands.toggleMark("strong")).toBe(false);
    expect(editor.commands.insertImage({ src: "javascript:alert(1)" })).toBe(false);
    expect(editor.commands.reconcileMarkdown("external")).toBe(true);
    expect(editor.getMarkdown()).toBe("external");
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
    expect(editor.view.dom.getAttribute("data-surface")).toBe("minimal");

    editor.updateOptions({
      ariaLabel: "Updated document",
      attributes: { "data-next": "true" },
      editable: true,
      placeholder: "Continue",
    });
    expect(editor.view.editable).toBe(true);
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Updated document");
    expect(editor.view.dom.getAttribute("data-next")).toBe("true");
    expect(editor.view.dom.hasAttribute("data-surface")).toBe(false);

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: { length: 1 }, items: [], types: ["Files"] },
    });
    expect(editor.view.dom.dispatchEvent(paste)).toBe(false);
    expect(paste.defaultPrevented).toBe(true);
  });

  it("publishes transaction, selection, focus, blur, and extension error events", async () => {
    const reporting = defineMarkdownEditorExtension({
      name: "acme-minimal-reporting",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: ({ reportError }) => ({
        commands: {
          report: () => {
            reportError(new Error("reported"), "report-command");
            return true;
          },
        },
      }),
    });
    const transactionOrigins: MarkdownEditorChangeOrigin[] = [];
    const editor = track(createEditor({
      element: createHost(),
      extensions: [reporting],
      markdown: "events",
      onTransaction: (_transaction, _view, context) => {
        transactionOrigins.push(context.origin);
      },
    }));
    const events: string[] = [];
    editor.subscribe("focus", () => events.push("focus"));
    editor.subscribe("blur", () => events.push("blur"));
    editor.subscribe("selection", ({ origin }) => events.push(`selection:${origin}`));
    editor.subscribe("update", ({ origin }) => events.push(`update:${origin}`));
    editor.subscribe("error", ({ code }) => events.push(`error:${code}`));

    editor.focus("end");
    await Promise.resolve();
    editor.view.dispatch(editor.view.state.tr.insertText("!"));
    expect(editor.extensions.get(reporting).commands.report()).toBe(true);
    editor.blur();
    await Promise.resolve();

    expect(transactionOrigins).toContain("command");
    expect(transactionOrigins).toContain("user");
    expect(events).toContain("selection:command");
    expect(events).toContain("update:user");
    expect(events).toContain("error:EXTENSION_RUNTIME_FAILED");
    expect(events).toContain("focus");
    expect(events).toContain("blur");
  });

  it("tears extension scopes down in reverse order and destroys idempotently", () => {
    const events: string[] = [];
    const probe = (name: string) => defineMarkdownEditorExtension({
      name,
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createStorage: ({ lifecycle }) => {
        lifecycle.addCleanup(() => events.push(`${name}:assembly`));
        return {};
      },
      createRuntime: () => ({
        setup({ lifecycle }) {
          events.push(`${name}:setup`);
          lifecycle.addCleanup(() => events.push(`${name}:setup-cleanup`));
        },
      }),
    });
    const host = createHost();
    const editor = createEditor({
      element: host,
      extensions: [probe("acme-minimal-first"), probe("acme-minimal-second")],
      markdown: "final",
    });

    editor.destroy();
    editor.destroy();

    expect(events).toEqual([
      "acme-minimal-first:setup",
      "acme-minimal-second:setup",
      "acme-minimal-second:setup-cleanup",
      "acme-minimal-first:setup-cleanup",
      "acme-minimal-second:assembly",
      "acme-minimal-first:assembly",
    ]);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.getMarkdown()).toBe("final");
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect(() => editor.focus()).toThrow(MarkdownEditorDestroyedError);
  });
});
