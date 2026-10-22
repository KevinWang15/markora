import { JSDOM } from "jsdom";
import { Plugin } from "../src/extension-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditor as createRootEditor,
  defineMarkdownEditorExtension,
  setMarkdownEditorTransactionOrigin,
  type MarkdownEditor,
} from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

type EditorFactory = typeof createRootEditor;

const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;
const editors: MarkdownEditor[] = [];
const foreignWindows: Array<Window & typeof globalThis> = [];

function installDomStubs(targetWindow: Window & typeof globalThis) {
  if (!targetWindow.Range.prototype.getClientRects) {
    targetWindow.Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }
  if (!targetWindow.Range.prototype.getBoundingClientRect) {
    targetWindow.Range.prototype.getBoundingClientRect = (
      () => new targetWindow.DOMRect()
    ) as () => DOMRect;
  }
  if (!targetWindow.Element.prototype.animate) {
    targetWindow.Element.prototype.animate = (
      () => ({ cancel() {}, finished: Promise.resolve() })
    ) as typeof Element.prototype.animate;
  }
}

installDomStubs(window);

function createHost(ownerDocument: Document = document) {
  const host = ownerDocument.createElement("div");
  ownerDocument.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      // Failure behavior is asserted by the owning test.
    }
  }
  for (const foreignWindow of foreignWindows.splice(0)) {
    foreignWindow.close();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe.each(entries)("%s idle Markdown changes", (_entry, createEditor: EditorFactory) => {
  it("retains plugin-view construction dispatches without pre-return host callbacks", () => {
    const extension = defineMarkdownEditorExtension({
      name: `acme-construction-dispatch-${_entry}`,
      version: "1.0.0",
      compatibility: { extensionApi: "^1.0.0", markora: "^0.1.0" },
      createRuntime: () => ({
        plugins: [{
          id: "construction-dispatch",
          create: () => new Plugin({
            view(editorView) {
              editorView.dispatch(editorView.state.tr.insertText("!"));
              return { destroy() {} };
            },
          }),
        }],
      }),
    });
    const changes = vi.fn();
    const transactions = vi.fn();

    const editor = track(createEditor({
      element: createHost(),
      extensions: [extension],
      markdown: "alpha",
      onChange: changes,
      onTransaction: transactions,
    }));

    expect(editor.getMarkdown()).toBe("!alpha");
    expect(changes).not.toHaveBeenCalled();
    expect(transactions).not.toHaveBeenCalled();
  });

  it("keeps typed state/update notifications synchronous without serializing onChange", () => {
    const changes = vi.fn();
    const events: string[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
    }));
    editor.subscribe("state", () => events.push("state"));
    editor.subscribe("update", () => events.push("update"));

    editor.view.dispatch(editor.view.state.tr.insertText("!", 6));

    expect(events).toEqual(["state", "update"]);
    expect(changes).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe("alpha!");
    expect(changes).not.toHaveBeenCalled();

    editor.flushChange();
    expect(changes).toHaveBeenCalledWith("alpha!", { origin: "user" });
  });

  it("coalesces the latest document and origin and flushes it during teardown", () => {
    const changes = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
    }));
    editor.view.dispatch(editor.view.state.tr.insertText("!", 6));
    editor.view.dispatch(setMarkdownEditorTransactionOrigin(
      editor.view.state.tr.insertText("?", 7),
      "extension:scheduler-test",
    ));

    expect(changes).not.toHaveBeenCalled();
    editor.destroy();

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith("alpha!?", {
      origin: "extension:scheduler-test",
    });
    expect(editor.getMarkdown()).toBe("alpha!?");
  });

  it("does not call a captured listener after serialization destroys the editor", () => {
    const nodeName = `scheduler_destroy_${_entry}`;
    let activeEditor: MarkdownEditor | undefined;
    const extension = defineMarkdownEditorExtension({
      name: `acme-scheduler-destroy-${_entry}`,
      version: "1.0.0",
      compatibility: { extensionApi: "^1.0.0", markora: "^0.1.0" },
      schema: {
        nodes: [{
          name: nodeName,
          before: "blockquote",
          spec: {
            atom: true,
            group: "block",
            parseDOM: [{ tag: `div[data-${nodeName}]` }],
            toDOM: () => ["div", { [`data-${nodeName}`]: "true" }],
          },
        }],
      },
      markdown: {
        serializer: {
          nodes: {
            [nodeName](state, node) {
              activeEditor?.destroy();
              state.write(":::destroyed-during-snapshot");
              state.closeBlock(node);
            },
          },
        },
      },
      createRuntime: () => ({
        setup({ editor }) {
          activeEditor = editor;
        },
      }),
    });
    const changes = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      extensions: [extension],
      markdown: "safe",
      onChange: changes,
    }));
    const customNode = editor.view.state.schema.nodes[nodeName].create();
    editor.view.dispatch(editor.view.state.tr.replaceWith(
      0,
      editor.view.state.doc.content.size,
      customNode,
    ));

    editor.flushChange();

    expect(editor.isDestroyed).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe(":::destroyed-during-snapshot");
  });
});

describe("idle scheduler realm", () => {
  it.each(entries)("uses the host window for the %s entry", (_entry, createEditor: EditorFactory) => {
    const foreignWindow = new JSDOM("<!doctype html><html><body></body></html>").window as unknown as Window & typeof globalThis;
    foreignWindows.push(foreignWindow);
    installDomStubs(foreignWindow);
    let idleCallback: ((deadline: { didTimeout: boolean; timeRemaining(): number }) => void) | undefined;
    const requestIdleCallback = vi.fn((callback) => {
      idleCallback = callback;
      return 17;
    });
    const cancelIdleCallback = vi.fn();
    Object.assign(foreignWindow, { requestIdleCallback, cancelIdleCallback });
    const globalIdle = vi.fn();
    const previousGlobalIdle = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
    const previousGlobalCancel = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
    Object.assign(window, {
      requestIdleCallback: globalIdle,
      cancelIdleCallback: vi.fn(),
    });

    try {
      const changes = vi.fn();
      const editor = track(createEditor({
        element: createHost(foreignWindow.document),
        markdown: "alpha",
        onChange: changes,
      }));
      let nextTimer = 100;
      const timers = new Map<number, { callback: () => void; delay: number }>();
      foreignWindow.setTimeout = vi.fn((callback: TimerHandler, delay?: number) => {
        const handle = nextTimer++;
        timers.set(handle, {
          callback: callback as () => void,
          delay: Number(delay ?? 0),
        });
        return handle;
      }) as typeof foreignWindow.setTimeout;
      foreignWindow.clearTimeout = vi.fn((handle?: number) => {
        if (handle !== undefined) {
          timers.delete(handle);
        }
      }) as typeof foreignWindow.clearTimeout;
      editor.view.dispatch(editor.view.state.tr.insertText("!", 6));

      expect(requestIdleCallback).not.toHaveBeenCalled();
      expect(globalIdle).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
      const quiet = [...timers.values()].find(({ delay }) => delay === 300)!;
      quiet.callback();
      expect(requestIdleCallback).toHaveBeenCalledOnce();
      idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
      expect(changes).toHaveBeenCalledWith("alpha!", { origin: "user" });
    } finally {
      Object.assign(window, {
        requestIdleCallback: previousGlobalIdle,
        cancelIdleCallback: previousGlobalCancel,
      });
    }
  });
});
