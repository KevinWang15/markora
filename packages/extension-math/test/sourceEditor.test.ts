import { afterEach, describe, expect, it } from "vitest";
import { createEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { NodeSelection } from "markora/extension-api";
import { createMathExtension } from "../src/index";
import { highlightTex } from "../src/sourceEditor";

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
const editors: MarkdownEditor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

it("highlights TeX without interpreting source as HTML", () => {
  const source = String.raw`\frac{12}{x_2} % <img onerror=alert(1)>`;
  const host = document.createElement("div");
  host.append(highlightTex(source, document));
  expect(host.textContent).toBe(source);
  expect(host.querySelector(".mdw-tex-command")?.textContent).toBe("\\frac");
  expect(host.querySelector(".mdw-tex-number")?.textContent).toBe("12");
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".mdw-tex-comment")?.textContent).toContain("<img");
});

for (const [name, create] of [
  ["full", createEditor],
  ["minimal", createMinimalEditor],
] as const) {
  describe(`${name} in-place math`, () => {
    function mount(markdown = "Before\n\n$$\nx^2\n$$\n\nAfter") {
      const element = document.body.appendChild(document.createElement("div"));
      const math = createMathExtension({
        renderer: ({ ownerDocument, source }) => {
          const span = ownerDocument.createElement("span");
          span.textContent = source;
          return span;
        },
      });
      const editor = create({ element, markdown, extensions: [math] });
      editors.push(editor);
      const handle = editor.extensions.get(math);
      const open = () => {
        expect(handle.commands.edit(handle.state.getNodes()[0]!)).toBe(true);
        return element.querySelector<HTMLTextAreaElement>("textarea")!;
      };
      return { editor, handle, element, open };
    }
    const type = (input: HTMLTextAreaElement, source: string) => {
      input.value = source;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    };
    it("edits the document live and restores one editing session with Undo", () => {
      const { editor, element, open } = mount();
      const input = open();
      expect(document.activeElement).toBe(input);
      type(input, "y");
      type(input, "y^3");
      expect(editor.getMarkdown()).toContain("y^3");
      input.blur();
      expect(element.querySelector("textarea")).toBeNull();
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getMarkdown()).toContain("x^2");
    });
    it("continues after display math without adding a separate scaffold undo step", () => {
      const { editor, handle, element } = mount("Before");
      editor.focus("end");
      handle.commands.editSelection();
      const input = element.querySelector<HTMLTextAreaElement>("textarea")!;
      type(input, "x^2");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
      expect(element.querySelector("textarea")).toBeNull();
      expect(editor.view.state.selection.$from.parent.type.name).toBe("paragraph");
      editor.commands.undo();
      expect(editor.getMarkdown()).toBe("Before");
    });
    it("removes an emptied inline formula on exit, preserving undo", () => {
      const { editor, open } = mount("Before $x$ after");
      const input = open();
      type(input, "");
      input.blur();
      expect(editor.getMarkdown()).toBe("Before  after");
      editor.commands.undo();
      expect(editor.getMarkdown()).toBe("Before $x$ after");
    });
    it("continues at the replacement boundary after clearing inline source", () => {
      const { editor, open } = mount("Before $x$ after");
      const input = open(); type(input, "");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      editor.view.dispatch(editor.view.state.tr.insertText("next"));
      expect(editor.getMarkdown()).toBe("Before next after");
    });
    it("preserves source incompatible with delimiters as literal text on exit", () => {
      const { editor, open } = mount("Before $x$ after");
      const input = open();
      type(input, " x ");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      input.blur();
      expect(editor.getMarkdown()).toBe("Before  x  after");
    });
    it("does not write intermediate IME composition or close on composing Escape", () => {
      const { editor, element, open } = mount();
      const input = open();
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      type(input, "中文");
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        }),
      );
      expect(editor.getMarkdown()).toContain("x^2");
      expect(element.querySelector("textarea")).toBe(input);
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      expect(editor.getMarkdown()).toContain("中文");
    });
    it("discards stale local drafts after an external replacement and rejects stale targets", () => {
      const { editor, element, handle, open } = mount("Before $x$ after");
      const target = handle.state.getNodes()[0]!;
      const input = open();
      type(input, " x ");
      editor.commands.resetMarkdown("Replacement $y$");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      expect(element.querySelector("textarea")).toBeNull();
      expect(editor.getMarkdown()).toBe("Replacement $y$");
      expect(handle.commands.edit(target)).toBe(false);
    });
    it("inserts and focuses empty display source, and supports keyboard entry", () => {
      const { editor, handle, element } = mount("Before");
      expect(handle.commands.editSelection()).toBe(true);
      const input = element.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(document.activeElement).toBe(input);
      type(input, "z");
      input.blur();
      const position = handle.state.getNodes()[0]!.position;
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          NodeSelection.create(editor.view.state.doc, position),
        ),
      );
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(element.querySelector("textarea")).not.toBeNull();
    });
    it("commits invalid input before a host save and defers during composition", () => {
      const { editor, handle, open } = mount("Before $x$ after");
      const input = open();
      input.dispatchEvent(new CompositionEvent("compositionstart"));
      type(input, " x ");
      expect(handle.commands.finishEditing()).toBe(false);
      expect(document.activeElement).toBe(input);
      input.dispatchEvent(new CompositionEvent("compositionend"));
      expect(handle.commands.finishEditing()).toBe(true);
      expect(editor.getMarkdown()).toBe("Before  x  after");
    });
    it("does not edit read-only formulas", () => {
      const { editor, handle, element } = mount();
      editor.updateOptions({ editable: false });
      expect(handle.commands.edit(handle.state.getNodes()[0]!)).toBe(false);
      element.querySelector<HTMLElement>(".mdw-math")!.click();
      expect(element.querySelector("textarea")).toBeNull();
    });
  });
}
