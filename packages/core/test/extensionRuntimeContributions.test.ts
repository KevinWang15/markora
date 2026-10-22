import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Slice } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { InputRule } from "prosemirror-inputrules";
import {
  createEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
} from "../src";
import {
  installControlledIntersectionObservers,
  waitForCodeBlockState,
} from "./codeBlockTestUtils";

const editors: MarkdownEditor[] = [];
const intersectionObservers = installControlledIntersectionObservers(window);

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
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

async function getActiveCodeMirrorContent(editor: MarkdownEditor) {
  intersectionObservers.emitAll(true);
  await waitForCodeBlockState(editor, "active");
  const content = editor.view.dom.querySelector<HTMLElement>(".cm-content");
  expect(content).not.toBeNull();
  return content!;
}

function createClipboardEvent(options: {
  files?: readonly File[];
  html?: string;
  text?: string;
}) {
  const files = options.files ?? [];
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      files: { length: files.length, ...files },
      items: files.length > 0
        ? files.map(() => ({ kind: "file" }))
        : [{ kind: "string" }],
      types: [
        ...(options.text !== undefined ? ["text/plain"] : []),
        ...(options.html !== undefined ? ["text/html"] : []),
        ...(files.length > 0 ? ["Files"] : []),
      ],
      getData(type: string) {
        if (type.toLowerCase() === "text/html") {
          return options.html ?? "";
        }

        if (["text", "text/plain"].includes(type.toLowerCase())) {
          return options.text ?? "";
        }

        return "";
      },
    },
  });
  return event;
}

function createDropEvent(text: string) {
  const event = new Event("drop", {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: {
      files: { length: 0 },
      items: [{ kind: "string" }],
      types: ["text/plain"],
      getData(type: string) {
        return ["text", "text/plain"].includes(type.toLowerCase()) ? text : "";
      },
    },
  });
  return event;
}

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

function runtimeExtension(
  name: string,
  createRuntime: Parameters<typeof defineMarkdownEditorExtension>[0]["createRuntime"],
) {
  return defineMarkdownEditorExtension({
    name,
    version: "1.0.0",
    compatibility: { markora: "^0.1.0", extensionApi: "^1.0.0" },
    createRuntime,
  });
}

describe("extension runtime contribution lanes", () => {
  it("forms duplicate-key first-true chains in resolved order", () => {
    const calls: string[] = [];
    const first = runtimeExtension("acme-key-first", () => ({
      keymaps: [{
        id: "shared",
        key: "Ctrl-k",
        create: () => () => {
          calls.push("first:false");
          return false;
        },
      }],
    }));
    const second = runtimeExtension("acme-key-second", () => ({
      keymaps: [{
        id: "shared",
        key: "Ctrl-k",
        create: () => () => {
          calls.push("second:true");
          return true;
        },
      }],
    }));
    const third = runtimeExtension("acme-key-third", () => ({
      keymaps: [{
        id: "shared",
        key: "Ctrl-k",
        create: () => () => {
          calls.push("third");
          return true;
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [first, second, third],
    }));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(calls).toEqual(["first:false", "second:true"]);
  });

  it("remaps, disables, canonicalizes, and composition-gates qualified extension shortcuts", () => {
    const calls: string[] = [];
    const first = runtimeExtension("acme-key-config", () => ({
      keymaps: [{
        id: "first",
        key: "Control-j",
        create: () => () => {
          calls.push("first");
          return false;
        },
      }, {
        id: "second",
        key: "Ctrl-j",
        create: () => () => {
          calls.push("second");
          return true;
        },
      }, {
        id: "disabled",
        key: "Ctrl-d",
        create: () => () => {
          calls.push("disabled");
          return true;
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [first],
      shortcuts: {
        "acme-key-config/disabled": false,
        "acme-key-config/first": "Alt-k",
        "acme-key-config/second": "a-k",
      },
    }));

    const dispatch = (init: KeyboardEventInit) => editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
    dispatch({ ctrlKey: true, key: "j" });
    dispatch({ ctrlKey: true, key: "d" });
    expect(calls).toEqual([]);

    dispatch({ altKey: true, isComposing: true, key: "k" });
    expect(calls).toEqual([]);
    dispatch({ altKey: true, key: "k" });
    expect(calls).toEqual(["first", "second"]);
  });

  it("runs public keymaps before compatibility and base keymaps", () => {
    let calls = 0;
    const extension = runtimeExtension("acme-key-override", () => ({
      keymaps: [{
        id: "bold",
        key: "Mod-b",
        create: () => () => {
          calls += 1;
          return true;
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "plain",
    }));

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(calls).toBe(1);
    expect(editor.getMarkdown()).toBe("plain");
  });

  it("rejects malformed keymap factories with contribution attribution", () => {
    const invalid = runtimeExtension("acme-key-invalid", () => ({
      keymaps: [{
        id: "shortcut",
        key: "Ctrl-k",
        create: (() => "not a command") as never,
      }],
    }));

    expect(() => createEditor({
      element: host(),
      extensions: [invalid],
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "input",
      extension: "acme-key-invalid",
      contribution: "acme-key-invalid/shortcut",
    }));
  });

  it("reports and aborts a keymap command that does not return boolean", () => {
    const invalid = runtimeExtension("acme-key-invalid-result", () => ({
      keymaps: [{
        id: "shortcut",
        key: "Ctrl-k",
        create: () => (() => "not a boolean") as never,
      }],
    }));
    const editor = track(createEditor({ element: host(), extensions: [invalid] }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") errors.push(event.error);
    });
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(errors).toEqual([expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "input",
      extension: "acme-key-invalid-result",
      contribution: "acme-key-invalid-result/shortcut",
    })]);
  });

  it("reports and rejects an input rule result that is not a Transaction", () => {
    const invalid = runtimeExtension("acme-input-invalid-result", () => ({
      inputRules: [{
        id: "rule",
        create: () => new InputRule(/x$/, (() => "not a transaction") as never),
      }],
    }));
    const editor = track(createEditor({ element: host(), extensions: [invalid] }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") errors.push(event.error);
    });
    const { from, to } = editor.view.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) => (
      handler(editor.view, from, to, "x", () => null)
    ));

    expect(handled).toBeUndefined();
    expect(errors).toEqual([expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "input",
      extension: "acme-input-invalid-result",
      contribution: "acme-input-invalid-result/rule",
    })]);
  });

  it("orders behavior plugins by contribution edges", () => {
    const events: string[] = [];
    const first = runtimeExtension("acme-plugin-first", () => ({
      plugins: [{
        id: "behavior",
        create: () => new Plugin({
          view: () => {
            events.push("first");
            return { destroy() {} };
          },
        }),
      }],
    }));
    const second = runtimeExtension("acme-plugin-second", () => ({
      plugins: [{
        id: "behavior",
        before: ["acme-plugin-first/behavior"],
        create: () => new Plugin({
          view: () => {
            events.push("second");
            return { destroy() {} };
          },
        }),
      }],
    }));

    track(createEditor({ element: host(), extensions: [first, second] }));
    expect(events).toEqual(["second", "first"]);
  });

  it("pipelines clipboard transforms and short-circuits handlers", () => {
    const calls: string[] = [];
    const first = runtimeExtension("acme-clipboard-first", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "outer",
          create: () => (value) => `${value}:first`,
        }],
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "outer",
          create: () => () => {
            calls.push("first:false");
            return false;
          },
        }],
      },
    }));
    const second = runtimeExtension("acme-clipboard-second", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "both",
          create: () => (value) => `${value}:second`,
        }],
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "both",
          create: () => () => {
            calls.push("second:true");
            return true;
          },
        }],
      },
    }));
    const editor = track(createEditor({ element: host(), extensions: [first, second] }));
    let transformed = "source";
    editor.view.someProp("transformPastedText", (transform) => {
      transformed = transform(transformed, false, editor.view);
    });
    const event = new Event("paste") as ClipboardEvent;
    const handled = editor.view.someProp("handlePaste", (handler) => (
      handler(editor.view, event, Slice.empty)
    ));

    expect(transformed).toBe("source:first:second");
    expect(handled).toBe(true);
    expect(calls).toEqual(["first:false", "second:true"]);
  });

  it("reports and rejects a structured clipboard transform that does not return a Slice", () => {
    const invalid = runtimeExtension("acme-clipboard-invalid-slice-result", () => ({
      clipboard: {
        transforms: [{
          id: "slice",
          kind: "slice",
          surface: "outer",
          create: () => (() => "not a slice") as never,
        }],
      },
    }));
    const editor = track(createEditor({ element: host(), extensions: [invalid] }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") errors.push(event.error);
    });
    let transformed = Slice.empty;
    editor.view.someProp("transformPasted", (transform) => {
      transformed = transform(transformed, editor.view);
    });
    editor.view.someProp("handlePaste", (handler) => (
      handler(editor.view, new Event("paste") as ClipboardEvent, transformed)
    ));

    expect(transformed).toBe(Slice.empty);
    expect(errors).toEqual([expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "clipboard",
      extension: "acme-clipboard-invalid-slice-result",
      contribution: "acme-clipboard-invalid-slice-result/slice",
    })]);
  });

  it("routes nested-code and both clipboard contributions into CodeMirror only", async () => {
    const calls: string[] = [];
    const outer = runtimeExtension("acme-clipboard-outer", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "outer",
          create: () => (value) => `${value}:outer`,
        }],
      },
    }));
    const nested = runtimeExtension("acme-clipboard-nested", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "nested-code",
          create: () => (value) => `${value}:nested`,
        }],
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "nested-code",
          create: () => () => {
            calls.push("nested:false");
            return false;
          },
        }],
      },
    }));
    const both = runtimeExtension("acme-clipboard-both", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "both",
          create: () => (value) => `${value}:both`,
        }],
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "both",
          create: () => () => {
            calls.push("both:false");
            return false;
          },
        }],
      },
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [outer, nested, both],
      markdown: ["```text", "before", "```"].join("\n"),
    }));
    const codeMirrorContent = await getActiveCodeMirrorContent(editor);
    codeMirrorContent.focus();
    codeMirrorContent.dispatchEvent(createClipboardEvent({ text: "source" }));
    let outerText = "source";
    editor.view.someProp("transformPastedText", (transform) => {
      outerText = transform(outerText, false, editor.view);
    });

    expect(editor.getMarkdown()).toContain("source:nested:both");
    expect(editor.getMarkdown()).not.toContain(":outer");
    expect(outerText).toBe("source:outer:both");
    expect(calls).toEqual(["nested:false", "both:false"]);
  });

  it("short-circuits nested paste and drop handlers in resolved order", async () => {
    const calls: string[] = [];
    const createHandlerExtension = (
      name: string,
      result: boolean,
      suffix: string,
    ) => runtimeExtension(name, () => ({
      clipboard: {
        handlers: (["paste", "drop"] as const).map((kind) => ({
          id: kind,
          kind,
          surface: "nested-code" as const,
          create: () => () => {
            calls.push(`${kind}:${suffix}`);
            return result;
          },
        })),
      },
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [
        createHandlerExtension("acme-clipboard-handler-first", false, "first"),
        createHandlerExtension("acme-clipboard-handler-second", true, "second"),
        createHandlerExtension("acme-clipboard-handler-third", true, "third"),
      ],
      markdown: ["```text", "before", "```"].join("\n"),
    }));
    const codeMirrorContent = await getActiveCodeMirrorContent(editor);
    codeMirrorContent.focus();
    const paste = createClipboardEvent({ text: "paste" });
    codeMirrorContent.dispatchEvent(paste);
    const drop = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", {
      configurable: true,
      value: {
        files: { length: 0 },
        items: [{ kind: "string" }],
        types: ["text/plain"],
        getData: () => "drop",
      },
    });
    codeMirrorContent.dispatchEvent(drop);

    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(["```text", "before", "```"].join("\n"));
    expect(calls).toEqual([
      "paste:first",
      "paste:second",
      "drop:first",
      "drop:second",
    ]);
  });

  it("runs nested HTML before text transforms and keeps both-surface slices outer-only", async () => {
    const calls: string[] = [];
    const extension = runtimeExtension("acme-clipboard-nested-rich", () => ({
      clipboard: {
        transforms: [{
          id: "html",
          kind: "html",
          surface: "nested-code",
          create: () => (value) => {
            calls.push(`html:${value}`);
            return "<p>changed<br>line</p>";
          },
        }, {
          id: "text",
          kind: "text",
          surface: "nested-code",
          create: () => (value) => {
            calls.push(`text:${value}`);
            return `${value}:text`;
          },
        }, {
          id: "slice",
          kind: "slice",
          surface: "both",
          create: () => (value) => {
            calls.push("slice");
            return value;
          },
        }],
      },
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: ["```text", "", "```"].join("\n"),
    }));
    const codeMirrorContent = await getActiveCodeMirrorContent(editor);
    codeMirrorContent.focus();
    codeMirrorContent.dispatchEvent(createClipboardEvent({
      html: "<strong>source</strong>",
      text: "source",
    }));

    expect(editor.getMarkdown()).toContain("changed\nline:text");
    expect(calls).toEqual([
      "html:<strong>source</strong>",
      "text:changed\nline",
    ]);
  });

  it("keeps read-only and file guards ahead of nested clipboard hooks", async () => {
    const calls: string[] = [];
    const extension = runtimeExtension("acme-clipboard-nested-guarded", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "nested-code",
          create: () => (value) => {
            calls.push("transform");
            return `${value}:changed`;
          },
        }],
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "nested-code",
          create: () => () => {
            calls.push("handler");
            return false;
          },
        }],
      },
    }));
    const markdown = ["```text", "before", "```"].join("\n");
    const editor = track(createEditor({
      editable: false,
      element: host(),
      extensions: [extension],
      markdown,
    }));
    const codeMirrorContent = await getActiveCodeMirrorContent(editor);
    const readonlyEvent = createClipboardEvent({ text: "readonly" });
    codeMirrorContent.dispatchEvent(readonlyEvent);

    expect(readonlyEvent.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(calls).toEqual([]);

    editor.updateOptions({ editable: true });
    codeMirrorContent.focus();
    const fileEvent = createClipboardEvent({
      files: [new File(["secret"], "secret.txt", { type: "text/plain" })],
      text: "file text",
    });
    codeMirrorContent.dispatchEvent(fileEvent);

    expect(fileEvent.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(calls).toEqual([]);
  });

  it.each([
    ["paste", "handled"],
    ["drop", "handled"],
    ["paste", "throw"],
    ["drop", "throw"],
  ] as const)(
    "always prevents default when a static nested %s handler reports %s",
    (kind, outcome) => {
      const failure = new Error(`static ${kind} failed`);
      const handler = vi.fn(() => {
        if (outcome === "throw") {
          throw failure;
        }

        return true;
      });
      const extension = runtimeExtension(`acme-static-${kind}-${outcome}`, () => ({
        clipboard: {
          handlers: [{
            id: kind,
            kind,
            surface: "nested-code",
            create: () => handler,
          }],
        },
      }));
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown: ["```text", "before", "```"].join("\n"),
      }));
      editor.subscribe("error", () => {});
      const staticContent = editor.view.dom.querySelector<HTMLElement>(
        ".mdw-code-block-static-code",
      );
      expect(staticContent).not.toBeNull();
      expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
      const event = kind === "paste"
        ? createClipboardEvent({ text: "source" })
        : createDropEvent("source");

      staticContent!.dispatchEvent(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it("rejects duplicate NodeView owners before touching the host", () => {
    const first = runtimeExtension("acme-node-view-first", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: ({ ownerDocument }) => () => ({
          dom: ownerDocument.createElement("p"),
        }),
      }],
    }));
    const second = runtimeExtension("acme-node-view-second", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: ({ ownerDocument }) => () => ({
          dom: ownerDocument.createElement("p"),
        }),
      }],
    }));
    const element = host();

    expect(() => createEditor({ element, extensions: [first, second] })).toThrow(
      expect.objectContaining({ code: "EXTENSION_CONTRIBUTION_CONFLICT" }),
    );
    expect(element.classList.contains("mdw-host")).toBe(false);
    expect(element.childNodes).toHaveLength(0);
  });

  it("lets an explicit extension NodeView override the compatibility task item view", () => {
    const extension = runtimeExtension("acme-list-item-view", () => ({
      nodeViews: [{
        id: "list-item",
        node: "list_item",
        create: ({ ownerDocument }) => () => {
          const dom = ownerDocument.createElement("li");
          dom.dataset.extensionListItem = "true";
          return { contentDOM: dom, dom };
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "* [ ] overridden task",
    }));

    expect(editor.view.dom.querySelector('[data-extension-list-item="true"]')).not.toBeNull();
    expect(editor.view.dom.querySelector('[data-mdw-task-control="true"]')).toBeNull();
  });

  it.each([
    {
      code: "EXTENSION_RUNTIME_FAILED",
      label: "throwing constructor",
      constructor: () => {
        throw new Error("constructor exploded");
      },
    },
    {
      code: "EXTENSION_INVALID_DEFINITION",
      label: "malformed result",
      constructor: () => ({ dom: "not a DOM node" }),
    },
    {
      code: "EXTENSION_INVALID_DEFINITION",
      label: "malformed callback",
      constructor: () => ({
        dom: document.createElement("p"),
        update: "not a callback",
      }),
    },
  ])("attributes a NodeView $label", ({ code, constructor }) => {
    const invalid = runtimeExtension("acme-node-view-invalid", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: () => constructor as never,
      }],
    }));

    expect(() => createEditor({
      element: host(),
      extensions: [invalid],
      markdown: "content",
    })).toThrow(expect.objectContaining({
      code,
      phase: "node-view",
      extension: "acme-node-view-invalid",
      contribution: "acme-node-view-invalid/paragraph",
    }));
  });

  it.each([
    {
      code: "EXTENSION_RUNTIME_FAILED",
      label: "throwing",
      update: () => {
        throw new Error("update exploded");
      },
    },
    {
      code: "EXTENSION_INVALID_DEFINITION",
      label: "non-boolean",
      update: () => "not a boolean",
    },
  ])("reports and rethrows an attributed $label NodeView callback", ({ code, update }) => {
    const failing = runtimeExtension("acme-node-view-update-failing", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: ({ ownerDocument }) => () => {
          const dom = ownerDocument.createElement("p");
          return {
            dom,
            contentDOM: dom,
            update: update as never,
          };
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [failing],
      markdown: "content",
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        errors.push(event.error);
      }
    });

    expect(() => editor.view.dispatch(editor.view.state.tr.insertText("!"))).toThrow(
      expect.objectContaining({
        code,
        phase: "node-view",
        extension: "acme-node-view-update-failing",
        contribution: "acme-node-view-update-failing/paragraph",
      }),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code,
        phase: "node-view",
        extension: "acme-node-view-update-failing",
        contribution: "acme-node-view-update-failing/paragraph",
      }),
    ]);
  });

  it("reports live NodeView destroy failures without poisoning final teardown", () => {
    let destroyCalls = 0;
    const failing = runtimeExtension("acme-node-view-live-destroy", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: ({ ownerDocument }) => () => {
          const dom = ownerDocument.createElement("p");
          return {
            dom,
            contentDOM: dom,
            update: () => false,
            destroy() {
              destroyCalls += 1;

              if (destroyCalls === 1) {
                throw new Error("live destroy exploded");
              }
            },
          };
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [failing],
      markdown: "content",
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        errors.push(event.error);
      }
    });

    expect(() => editor.view.dispatch(editor.view.state.tr.insertText("!"))).not.toThrow();
    expect(errors).toEqual([
      expect.objectContaining({
        code: "EXTENSION_CLEANUP_FAILED",
        phase: "destroy",
        extension: "acme-node-view-live-destroy",
        contribution: "acme-node-view-live-destroy/paragraph",
      }),
    ]);
    expect(() => editor.destroy()).not.toThrow();
    expect(destroyCalls).toBe(2);
  });

  it("continues sibling NodeView cleanup and surfaces every teardown failure", () => {
    const destroyed: number[] = [];
    let instance = 0;
    const failing = runtimeExtension("acme-node-view-destroy-failing", () => ({
      nodeViews: [{
        id: "paragraph",
        node: "paragraph",
        create: ({ ownerDocument }) => () => {
          const id = instance += 1;
          const dom = ownerDocument.createElement("p");
          return {
            dom,
            contentDOM: dom,
            destroy() {
              destroyed.push(id);
              throw new Error(`destroy ${id} exploded`);
            },
          };
        },
      }],
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [failing],
      markdown: "first\n\nsecond",
    }));
    let thrown: unknown;

    try {
      editor.destroy();
    } catch (error) {
      thrown = error;
    }

    expect(destroyed.sort()).toEqual([1, 2]);
    expect(thrown).toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [
        expect.objectContaining({
          code: "EXTENSION_CLEANUP_FAILED",
          phase: "destroy",
          extension: "acme-node-view-destroy-failing",
          contribution: "acme-node-view-destroy-failing/paragraph",
        }),
        expect.objectContaining({
          code: "EXTENSION_CLEANUP_FAILED",
          phase: "destroy",
          extension: "acme-node-view-destroy-failing",
          contribution: "acme-node-view-destroy-failing/paragraph",
        }),
      ],
    }));
    expect(editor.isDestroyed).toBe(true);
  });

  it("rejects duplicate ProseMirror PluginKeys during assembly", () => {
    const shared = new PluginKey("acme-shared-key");
    const create = (name: string) => runtimeExtension(name, () => ({
      plugins: [{
        id: "shared",
        create: () => new Plugin({ key: shared }),
      }],
    }));

    expect(() => createEditor({
      element: host(),
      extensions: [create("acme-plugin-key-first"), create("acme-plugin-key-second")],
    })).toThrow(expect.objectContaining({ code: "EXTENSION_CONTRIBUTION_CONFLICT" }));
  });

  it("reports and aborts a failing browser clipboard pipeline", () => {
    const failing = runtimeExtension("acme-clipboard-failing", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "outer",
          create: () => () => {
            throw new Error("transform failed");
          },
        }],
      },
    }));
    const editor = track(createEditor({ element: host(), extensions: [failing] }));
    const events: Array<{ phase?: string; contribution?: string }> = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        events.push({
          phase: event.context.phase,
          contribution: event.context.contribution,
        });
      }
    });
    let transformed = "source";

    editor.view.someProp("transformPastedText", (transform) => {
      transformed = transform(transformed, false, editor.view);
    });
    editor.view.someProp("handlePaste", (handler) => (
      handler(editor.view, new Event("paste") as ClipboardEvent, Slice.empty)
    ));

    expect(transformed).toBe("source");
    expect(events).toEqual([{
      phase: "clipboard",
      contribution: "acme-clipboard-failing/text",
    }]);
  });

  it("reports nested clipboard browser failures through the structured error path", async () => {
    const failing = runtimeExtension("acme-clipboard-nested-failing", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "nested-code",
          create: () => () => {
            throw new Error("nested transform failed");
          },
        }],
      },
    }));
    const editor = track(createEditor({
      element: host(),
      extensions: [failing],
      markdown: ["```text", "", "```"].join("\n"),
    }));
    const events: Array<{ phase?: string; contribution?: string }> = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        events.push({
          phase: event.context.phase,
          contribution: event.context.contribution,
        });
      }
    });
    const codeMirrorContent = await getActiveCodeMirrorContent(editor);
    codeMirrorContent.focus();
    codeMirrorContent.dispatchEvent(createClipboardEvent({ text: "source" }));

    expect(editor.getMarkdown()).toContain("source");
    expect(events).toEqual([{
      phase: "clipboard",
      contribution: "acme-clipboard-nested-failing/text",
    }]);
  });

  it("rejects malformed clipboard hook factories during assembly", () => {
    const invalidTransform = runtimeExtension("acme-clipboard-invalid-transform", () => ({
      clipboard: {
        transforms: [{
          id: "text",
          kind: "text",
          surface: "nested-code",
          create: (() => "not a transform") as never,
        }],
      },
    }));
    const invalidHandler = runtimeExtension("acme-clipboard-invalid-handler", () => ({
      clipboard: {
        handlers: [{
          id: "paste",
          kind: "paste",
          surface: "nested-code",
          create: (() => ({ invalid: true })) as never,
        }],
      },
    }));

    expect(() => createEditor({
      element: host(),
      extensions: [invalidTransform],
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "clipboard",
      extension: "acme-clipboard-invalid-transform",
      contribution: "acme-clipboard-invalid-transform/text",
    }));
    expect(() => createEditor({
      element: host(),
      extensions: [invalidHandler],
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "clipboard",
      extension: "acme-clipboard-invalid-handler",
      contribution: "acme-clipboard-invalid-handler/paste",
    }));
  });

  it("rejects nested-only slice transforms before invoking their factory", () => {
    let factoryInvoked = false;
    const invalidSlice = runtimeExtension("acme-clipboard-invalid-nested-slice", () => ({
      clipboard: {
        transforms: [{
          id: "slice",
          kind: "slice",
          surface: "nested-code",
          create: () => {
            factoryInvoked = true;
            return (value) => value;
          },
        }],
      },
    }));

    expect(() => createEditor({
      element: host(),
      extensions: [invalidSlice],
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "clipboard",
      extension: "acme-clipboard-invalid-nested-slice",
      contribution: "acme-clipboard-invalid-nested-slice/slice",
    }));
    expect(factoryInvoked).toBe(false);
  });

  it.each([
    {
      label: "transform kind",
      name: "acme-clipboard-invalid-transform-kind",
      contribution: "transform",
      clipboard: {
        transforms: [{
          id: "transform",
          kind: "binary",
          surface: "outer",
          create: () => (value: unknown) => value,
        }],
      },
    },
    {
      label: "transform surface",
      name: "acme-clipboard-invalid-transform-surface",
      contribution: "transform",
      clipboard: {
        transforms: [{
          id: "transform",
          kind: "text",
          surface: "unknown",
          create: () => (value: unknown) => value,
        }],
      },
    },
    {
      label: "handler kind",
      name: "acme-clipboard-invalid-handler-kind",
      contribution: "handler",
      clipboard: {
        handlers: [{
          id: "handler",
          kind: "copy",
          surface: "outer",
          create: () => () => false,
        }],
      },
    },
    {
      label: "handler surface",
      name: "acme-clipboard-invalid-handler-surface",
      contribution: "handler",
      clipboard: {
        handlers: [{
          id: "handler",
          kind: "paste",
          surface: "unknown",
          create: () => () => false,
        }],
      },
    },
  ])("rejects an invalid clipboard $label", ({ name, clipboard, contribution }) => {
    const invalid = runtimeExtension(name, () => ({ clipboard }) as never);

    expect(() => createEditor({
      element: host(),
      extensions: [invalid],
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "clipboard",
      extension: name,
      contribution: `${name}/${contribution}`,
    }));
  });
});
