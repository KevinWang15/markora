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
