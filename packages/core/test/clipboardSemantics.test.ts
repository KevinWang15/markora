import { afterEach, describe, expect, it, vi } from "vitest";
import { Slice } from "prosemirror-model";
import { AllSelection } from "prosemirror-state";
import {
  createEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
} from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function transfer(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    clearData: vi.fn(() => values.clear()),
    files: { length: 0 },
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    items: [{ kind: "string" }],
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    types: [...values.keys()],
    values,
  };
}

function clipboardEvent(type: "copy" | "cut" | "paste", data: ReturnType<typeof transfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { configurable: true, value: data });
  return event;
}

function paste(editor: MarkdownEditor, values: Record<string, string>) {
  const event = clipboardEvent("paste", transfer(values));
  editor.view.dom.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe.each([
  ["compatibility", (markdown: string) => createEditor({ element: host(), markdown })],
  ["minimal", (markdown: string) => createMinimalEditor({ element: host(), markdown })],
] as const)("%s clipboard semantics", (_name, makeEditor) => {
  it("exposes deliberate Markdown and plain-text paste commands", () => {
    const origins: Array<string | undefined> = [];
    const editor = track(makeEditor(""));
    editor.updateOptions({
      onTransaction(_transaction, _view, context) {
        origins.push(context.origin);
      },
    });

    expect(editor.state.can.pasteMarkdown()).toBe(true);
    expect(editor.state.can.pastePlainText()).toBe(true);
    expect(editor.commands.pasteMarkdown("# Heading\n\n- one\n- two")).toBe(true);
    expect(editor.getMarkdown()).toContain("# Heading");
    expect(editor.getMarkdown()).toContain("* one");
    expect(origins.at(-1)).toBe("command");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("");

    expect(editor.commands.pastePlainText("# Literal\n\n**plain**")).toBe(true);
    expect(editor.getMarkdown()).toBe("\\# Literal\n\n\\*\\*plain\\*\\*");
    expect(origins.at(-1)).toBe("command");
    expect(() => editor.commands.pasteMarkdown(null as never)).toThrow(TypeError);
    expect(() => editor.commands.pastePlainText(null as never)).toThrow(TypeError);
  });

  it("uses HTML, Markdown MIME, and literal plain text in deliberate order", () => {
    const editor = track(makeEditor(""));

    expect(paste(editor, {
      "text/html": "<p><em>Rich</em></p>",
      "text/markdown": "# Markdown",
      "text/plain": "plain",
    }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("*Rich*");

    editor.commands.resetMarkdown("");
    expect(paste(editor, {
      "text/markdown": "# Markdown",
      "text/plain": "# fallback",
    }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("# Markdown");

    editor.commands.resetMarkdown("");
    expect(paste(editor, { "text/plain": "# Literal" }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("\\# Literal");
  });

  it("reduces HTML-only explicit plain paste to inert block-aware text", () => {
    const editor = track(makeEditor(""));
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Shift",
      shiftKey: true,
    }));

    expect(paste(editor, {
      "text/html": "<p><strong>First</strong></p><p>Second<br>line</p>",
    }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("First\n\nSecond\n\nline");
    expect(editor.view.dom.querySelector("strong")).toBeNull();
  });

  it("keeps clipboard edits isolated from adjacent history groups", () => {
    const editor = track(makeEditor(""));
    editor.view.dispatch(editor.view.state.tr.insertText("typed"));
    expect(editor.commands.pastePlainText("paste")).toBe(true);
    editor.view.dispatch(editor.view.state.tr.insertText("after"));
    expect(editor.getMarkdown()).toBe("typedpasteafter");

    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("typedpaste");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("typed");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("");
  });

  it("imports common code-language classes", () => {
    const editor = track(makeEditor(""));
    expect(paste(editor, {
      "text/html": '<pre><code class="language-ts">const value = 1;</code></pre>',
      "text/plain": "fallback",
    }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("```ts\nconst value = 1;\n```");

    editor.commands.resetMarkdown("");
    expect(paste(editor, {
      "text/html": '<pre><svg><code class="language-js">const safe = true;</code></svg></pre>',
    }).defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("```js\nconst safe = true;\n```");
  });

  it("keeps HTML-looking plain text model-stable across serialization", () => {
    const source = "<b>literal</b> and <script>inert</script>";
    const editor = track(makeEditor(""));
    expect(editor.commands.pastePlainText(source)).toBe(true);
    const markdown = editor.getMarkdown();
    editor.commands.resetMarkdown(markdown);

    expect(editor.view.state.doc.textContent).toBe(source);
    const rawNodes: string[] = [];
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "raw_block" || node.type.name === "raw_inline") {
        rawNodes.push(node.type.name);
      }
    });
    expect(rawNodes).toEqual([]);
  });

  it("copies semantic HTML, canonical Markdown, and useful plain text", () => {
    const editor = track(makeEditor([
      "# Title",
      "",
      "- first",
      "- second",
      "",
      "line  ",
      "break",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n")));
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const data = transfer();
    const event = clipboardEvent("copy", data);
    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data.values.get("text/html")).toContain("data-pm-slice");
    expect(data.values.get("text/html")).toContain("<h1");
    expect(data.values.get("text/markdown")).toContain("# Title");
    expect(data.values.get("text/markdown")).toContain("```ts");
    expect(data.values.get("text/plain")).toContain("- first\n- second");
    expect(data.values.get("text/plain")).toContain("line\nbreak");
    expect(data.values.get("text/plain")).toContain("const value = 1;");
  });

  it("keeps HTML and plain copy useful when custom MIME writes are rejected", () => {
    const editor = track(makeEditor("**copy me**"));
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const data = transfer();
    data.setData.mockImplementation((type: string, value: string) => {
      if (type === "text/markdown") {
        throw new DOMException("Unsupported clipboard type", "NotSupportedError");
      }
      data.values.set(type, value);
    });
    const event = clipboardEvent("copy", data);
    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data.values.get("text/html")).toContain("<strong>copy me</strong>");
    expect(data.values.get("text/plain")).toBe("copy me");
    expect(data.values.has("text/markdown")).toBe(false);
  });

  it("cuts once, remains undoable, and copies without editing in read-only mode", () => {
    const editor = track(makeEditor("alpha"));
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const cutData = transfer();
    const cut = clipboardEvent("cut", cutData);
    editor.view.dom.dispatchEvent(cut);

    expect(cut.defaultPrevented).toBe(true);
    expect(cutData.values.get("text/markdown")).toBe("alpha");
    expect(editor.getMarkdown()).toBe("");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const failedData = transfer();
    failedData.setData.mockImplementation(() => {
      throw new DOMException("Clipboard unavailable", "NotAllowedError");
    });
    const failedCut = clipboardEvent("cut", failedData);
    editor.view.dom.dispatchEvent(failedCut);
    expect(failedCut.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.updateOptions({ editable: false });
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const readonlyData = transfer();
    editor.view.dom.dispatchEvent(clipboardEvent("cut", readonlyData));
    expect(readonlyData.values.get("text/markdown")).toBe("alpha");
    expect(editor.getMarkdown()).toBe("alpha");
    expect(editor.state.can.pasteMarkdown()).toBe(false);
    expect(editor.commands.pasteMarkdown("beta")).toBe(false);
  });
});

describe("clipboard extension and security ordering", () => {
  it("imports portable task checkboxes without promoting parent or non-leading items", () => {
    const editor = track(createEditor({ element: host() }));

    expect(paste(editor, {
      "text/html": [
        "<ul>",
        '<li>Parent<ul><li><input type="checkbox" checked disabled>Nested</li></ul></li>',
        '<li>Before <input type="checkbox" checked disabled>form control</li>',
        "</ul>",
      ].join(""),
      "text/plain": "fallback",
    }).defaultPrevented).toBe(true);
    const checked: Array<boolean | null> = [];
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "list_item") checked.push(node.attrs.checked);
    });
    expect(checked).toEqual([null, true, null]);

    editor.commands.resetMarkdown("* Parent\n  * [x] Nested");
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const data = transfer();
    editor.view.dom.dispatchEvent(clipboardEvent("copy", data));
    editor.commands.resetMarkdown("");
    expect(paste(editor, { "text/html": data.values.get("text/html")! }).defaultPrevented).toBe(true);
    const roundTrip: Array<boolean | null> = [];
    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "list_item") roundTrip.push(node.attrs.checked);
    });
    expect(roundTrip).toEqual([null, true]);
  });

  it("runs Markdown text, slice, and handler contributions exactly once", () => {
    const calls: string[] = [];
    const extension = defineMarkdownEditorExtension({
      name: "acme-markdown-clipboard-order",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        clipboard: {
          transforms: [{
            id: "text",
            kind: "text",
            surface: "outer",
            create: () => (value) => {
              calls.push("text");
              return value.replace("TOKEN", "**Strong**");
            },
          }, {
            id: "slice",
            kind: "slice",
            surface: "outer",
            create: () => (value) => {
              calls.push("slice");
              return value;
            },
          }],
          handlers: [{
            id: "paste",
            kind: "paste",
            surface: "outer",
            create: () => () => {
              calls.push("handler");
              return false;
            },
          }],
        },
      }),
    });
    const editor = track(createEditor({ element: host(), extensions: [extension] }));

    expect(paste(editor, {
      "text/markdown": "TOKEN [unsafe](javascript:alert(1))",
      "text/plain": "fallback",
    }).defaultPrevented).toBe(true);
    expect(calls).toEqual(["text", "slice", "handler"]);
    expect(editor.getMarkdown()).toBe("**Strong** unsafe");
    expect(editor.view.dom.querySelector("a")).toBeNull();
  });

  it("fails closed and rethrows structured transform failures for host commands", () => {
    let sliceCalls = 0;
    const extension = defineMarkdownEditorExtension({
      name: "acme-markdown-clipboard-failure",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        clipboard: {
          transforms: [{
            id: "text",
            kind: "text",
            surface: "outer",
            create: () => () => {
              throw new Error("blocked transform");
            },
          }, {
            id: "slice",
            kind: "slice",
            surface: "outer",
            create: () => (value) => {
              sliceCalls += 1;
              return value;
            },
          }],
        },
      }),
    });
    const editor = track(createEditor({ element: host(), extensions: [extension], markdown: "before" }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event.error));

    expect(() => editor.commands.pasteMarkdown("# replaced")).toThrow(expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "clipboard",
    }));
    expect(editor.getMarkdown()).toBe("before");
    expect(sliceCalls).toBe(0);
    expect(errors).toHaveLength(1);

    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const event = paste(editor, {
      "text/markdown": "# browser replacement",
      "text/plain": "fallback",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("before");
    expect(sliceCalls).toBe(0);
    expect(errors).toHaveLength(2);
  });

  it("owns Markdown paste when transforms produce empty content", () => {
    let calls = 0;
    const extension = defineMarkdownEditorExtension({
      name: "acme-markdown-clipboard-empty",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        clipboard: { transforms: [{
          id: "empty",
          kind: "text",
          surface: "outer",
          create: () => () => {
            calls += 1;
            return "";
          },
        }] },
      }),
    });
    const editor = track(createEditor({ element: host(), extensions: [extension], markdown: "before" }));
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));

    const event = paste(editor, {
      "text/markdown": "# replacement",
      "text/plain": "fallback",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe("before");
    expect(calls).toBe(1);

    let sliceCalls = 0;
    const emptySlice = defineMarkdownEditorExtension({
      name: "acme-markdown-clipboard-empty-slice",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        clipboard: { transforms: [{
          id: "empty",
          kind: "slice",
          surface: "outer",
          create: () => () => {
            sliceCalls += 1;
            return Slice.empty;
          },
        }] },
      }),
    });
    const second = track(createEditor({ element: host(), extensions: [emptySlice], markdown: "before" }));
    second.view.dispatch(second.view.state.tr.setSelection(new AllSelection(second.view.state.doc)));
    expect(paste(second, {
      "text/markdown": "# replacement",
      "text/plain": "fallback",
    }).defaultPrevented).toBe(true);
    expect(second.getMarkdown()).toBe("before");
    expect(sliceCalls).toBe(1);
  });

  it("does not dispatch after a clipboard transform destroys the editor", () => {
    let editor: MarkdownEditor;
    const extension = defineMarkdownEditorExtension({
      name: "acme-markdown-clipboard-destroy",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        clipboard: { transforms: [{
          id: "destroy",
          kind: "text",
          surface: "outer",
          create: () => (value) => {
            editor.destroy();
            return value;
          },
        }] },
      }),
    });
    editor = track(createEditor({ element: host(), extensions: [extension], markdown: "before" }));
    const dom = editor.view.dom;
    const event = clipboardEvent("paste", transfer({ "text/markdown": "after" }));

    expect(() => dom.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.isDestroyed).toBe(true);
  });

  it("keeps opaque leaf text in mixed plain-copy output", () => {
    const editor = track(createEditor({ element: host(), markdown: "before <mark> after" }));
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const data = transfer();
    editor.view.dom.dispatchEvent(clipboardEvent("copy", data));
    expect(data.values.get("text/plain")).toBe("before <mark> after");
  });
});

for (const makeEditor of [createEditor, createMinimalEditor]) {
  it(`${makeEditor === createEditor ? "full" : "minimal"} public clipboard captures formats and makes deferred Cut stale-safe`, () => {
    const editor = track(makeEditor({ element: host(), markdown: "hello **world**" }));
    editor.focus({ anchor: 7, head: 12 });
    const capture = editor.clipboard.captureSelection()!;
    expect(capture.content).toMatchObject({ text: "world", markdown: "**world**", html: expect.stringContaining("<strong>world</strong>") });
    expect(Object.isFrozen(capture.content)).toBe(true);
    editor.focus("start");
    expect(capture.deleteSelection()).toBe(false);
    expect(editor.getMarkdown()).toBe("hello **world**");
    editor.focus({ anchor: 7, head: 12 });
    expect(editor.clipboard.captureSelection()!.deleteSelection()).toBe(true);
    expect(editor.getMarkdown()).toBe("hello ");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("hello **world**");
  });

  it(`${makeEditor === createEditor ? "full" : "minimal"} public clipboard paste handles Markdown, rich HTML, and read-only mode`, () => {
    const editor = track(makeEditor({ element: host(), markdown: "text" }));
    const origins: string[] = [];
    editor.subscribe("update", event => origins.push(event.origin));
    editor.focus("all");
    expect(editor.clipboard.paste({ text: "", markdown: "## Heading" })).toBe(true);
    expect(editor.getMarkdown()).toBe("## Heading");
    expect(origins).toEqual(["command"]);
    editor.focus("all");
    // A keyboard-opened menu may consume Shift keyup outside the editor.
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", keyCode: 16, shiftKey: true, bubbles: true }));
    expect(editor.clipboard.paste({ text: "bold", html: "<strong>bold</strong>" })).toBe(true);
    expect(editor.getMarkdown()).toBe("**bold**");
    editor.updateOptions({ editable: false });
    const copied = editor.clipboard.captureSelection();
    expect(copied?.deleteSelection() ?? false).toBe(false);
    expect(editor.clipboard.paste({ text: "forbidden" })).toBe(false);
    expect(editor.getMarkdown()).toBe("**bold**");
  });

  it(`${makeEditor === createEditor ? "full" : "minimal"} public paste respects custom DOM handlers before default insertion`, () => {
    const editor = track(makeEditor({ element: host(), markdown: "original" }));
    const seen: string[] = [];
    editor.view.setProps({ handleDOMEvents: { paste(_view, event) {
      seen.push(event.clipboardData!.getData("text/html"));
      event.preventDefault();
      return false;
    } } });
    expect(editor.clipboard.paste({ text: "replacement", html: "<strong>replacement</strong>" })).toBe(true);
    expect(seen).toEqual(["<strong>replacement</strong>"]);
    expect(editor.getMarkdown()).toBe("original");
  });

  it(`${makeEditor === createEditor ? "full" : "minimal"} public paste keeps the plain format in a code block`, () => {
    const editor = track(makeEditor({ element: host(), markdown: "```\nbase\n```" }));
    editor.focus("end");
    expect(editor.clipboard.paste({ text: "<plain>", html: "<strong>rich</strong>" })).toBe(true);
    expect(editor.view.state.doc.firstChild!.textContent).toBe("base<plain>");
  });

}
