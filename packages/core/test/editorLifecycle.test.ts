import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  Decoration as CodeMirrorDecoration,
  EditorView as CodeMirrorEditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { TextSelection } from "prosemirror-state";
import {
  ManagedBlockCursor,
  isManagedBlockNodeFromSchema,
} from "../src/managedBlockCursor";
import {
  createEditor,
  MarkdownEditorDestroyedError,
  type CodeBlockLanguageRegistry,
  type EditorUiFactory,
  type MarkdownEditor,
} from "../src";
import {
  installControlledIntersectionObservers,
  waitForCodeBlockState,
} from "./codeBlockTestUtils";

const editors: MarkdownEditor[] = [];

function installDomStubs() {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
  }

  if (!Element.prototype.animate) {
    Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
  }
}

installDomStubs();
const intersectionObservers = installControlledIntersectionObservers(window);

async function activateCodeBlocks(editor: MarkdownEditor, count = 1) {
  intersectionObservers.emitAll(true);
  await waitForCodeBlockState(editor, "active", count);
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

function createUiFactory(spies: {
  clearSelectionAnchor?: ReturnType<typeof vi.fn>;
  imageClose?: ReturnType<typeof vi.fn>;
  imageDestroy?: ReturnType<typeof vi.fn>;
  linkClose?: ReturnType<typeof vi.fn>;
  linkDestroy?: ReturnType<typeof vi.fn>;
  tableUpdate?: ReturnType<typeof vi.fn>;
  tableDestroy?: ReturnType<typeof vi.fn>;
} = {}): EditorUiFactory {
  return () => ({
    enabled: true,
    clearSelectionAnchor: spies.clearSelectionAnchor ?? vi.fn(),
    createSelectionAnchor() {
      return null;
    },
    imageEditor: {
      open() {},
      close: spies.imageClose ?? vi.fn(),
      destroy: spies.imageDestroy ?? vi.fn(),
    },
    linkEditor: {
      open() {},
      close: spies.linkClose ?? vi.fn(),
      destroy: spies.linkDestroy ?? vi.fn(),
    },
    tableToolbar: {
      update: spies.tableUpdate ?? vi.fn(),
      destroy: spies.tableDestroy ?? vi.fn(),
    },
  });
}

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      // Individual tests assert teardown failures explicitly.
    }
  }

  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("production editor options", () => {
  it("applies accessible DOM attributes, placeholder, initial selection, and autofocus", () => {
    const label = document.createElement("h2");
    label.id = "document-label";
    document.body.append(label);
    const editor = track(createEditor({
      ariaLabelledBy: label.id,
      attributes: {
        "aria-placeholder": "Ignored host placeholder",
        "aria-readonly": "true",
        contenteditable: "false",
        "data-editor-kind": "article",
        class: "host-editor-class",
      },
      autofocus: true,
      element: createHost(),
      initialSelection: "end",
      markdown: "",
      placeholder: "Start writing",
    }));

    expect(editor.view.dom.getAttribute("role")).toBe("textbox");
    expect(editor.view.dom.getAttribute("aria-multiline")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-labelledby")).toBe("document-label");
    expect(editor.view.dom.getAttribute("aria-placeholder")).toBe("Start writing");
    expect(editor.view.dom.getAttribute("data-editor-kind")).toBe("article");
    expect(editor.view.dom.classList.contains("host-editor-class")).toBe(true);
    expect(editor.view.dom.querySelector(".mdw-placeholder")?.getAttribute("data-placeholder")).toBe("Start writing");
    expect(editor.view.state.selection.to).toBe(editor.view.state.doc.content.size - 1);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.getMarkdown()).toBe("");
  });

  it("validates exact selection positions before claiming the host", () => {
    const host = createHost();

    expect(() => createEditor({
      element: host,
      initialSelection: { anchor: 0 },
      markdown: "text",
    })).toThrow("inside text blocks");
    expect(host.classList.contains("mdw-host")).toBe(false);

    const editor = track(createEditor({ element: host, markdown: "text" }));
    expect(editor.getMarkdown()).toBe("text");
  });

  it("preserves valid attribute names that overlap object-prototype keys", () => {
    const attributes = Object.create(null) as Record<string, string>;
    attributes.__proto__ = "kept-as-an-attribute";
    attributes["data-safe"] = "yes";
    const editor = track(createEditor({
      attributes,
      element: createHost(),
    }));

    expect(editor.view.dom.getAttribute("__proto__")).toBe("kept-as-an-attribute");
    expect(editor.view.dom.getAttribute("data-safe")).toBe("yes");
  });

  it("shows placeholders only for the canonical empty paragraph", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "```js\n```",
      placeholder: "Start writing",
    }));

    expect(editor.view.dom.querySelector(".mdw-code-block")).not.toBeNull();
    expect(editor.view.dom.querySelector(".mdw-placeholder")).toBeNull();

    editor.updateOptions({ placeholder: "Updated guidance" });
    expect(editor.view.dom.querySelector(".mdw-placeholder")).toBeNull();

    editor.commands.setMarkdown("");
    expect(editor.view.dom.querySelector(".mdw-placeholder")?.getAttribute("data-placeholder"))
      .toBe("Updated guidance");
  });

  it("updates runtime options without reconstructing editor state or emitting an update", () => {
    const editor = track(createEditor({
      ariaLabel: "Original editor",
      element: createHost(),
      markdown: "alpha",
    }));
    const initialState = editor.view.state;
    const updates = vi.fn();
    editor.subscribe("update", updates);

    editor.updateOptions({
      ariaLabel: "Updated editor",
      attributes: { "data-mode": "review" },
      editable: false,
      placeholder: "Unavailable while content exists",
    });

    expect(editor.view.state).toBe(initialState);
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Updated editor");
    expect(editor.view.dom.getAttribute("data-mode")).toBe("review");
    expect(editor.view.dom.getAttribute("aria-placeholder")).toBe("Unavailable while content exists");
    expect(updates).not.toHaveBeenCalled();
    expect(editor.state.can.toggleMark("strong")).toBe(false);
    expect(editor.commands.toggleMark("strong")).toBe(false);

    const attempted = editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1);
    editor.view.dispatch(attempted);
    expect(editor.getMarkdown()).toBe("alpha");

    editor.commands.setMarkdown("external");
    expect(editor.getMarkdown()).toBe("external");
    expect(updates).toHaveBeenCalledTimes(1);

    const stateAfterExternalReset = editor.view.state;
    editor.updateOptions({
      ariaLabel: null,
      attributes: null,
      editable: true,
      placeholder: null,
    });
    expect(editor.view.state).toBe(stateAfterExternalReset);
    expect(editor.view.dom.hasAttribute("aria-label")).toBe(false);
    expect(editor.view.dom.hasAttribute("data-mode")).toBe(false);
    expect(editor.view.dom.hasAttribute("aria-placeholder")).toBe(false);
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("true");

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.getMarkdown()).toBe("external!");
  });

  it("rejects invalid dynamic attributes before flushing or changing any option", () => {
    const oldChanges = vi.fn();
    const nextChanges = vi.fn();
    const editor = track(createEditor({
      ariaLabel: "Original editor",
      attributes: { "data-mode": "draft" },
      element: createHost(),
      markdown: "alpha",
      onChange: oldChanges,
      onChangeMode: "animationFrame",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    const stateBeforeInvalidUpdate = editor.view.state;

    expect(() => editor.updateOptions({
      ariaLabel: "Invalid update",
      attributes: { "bad name": "rejected" },
      editable: false,
      onChange: nextChanges,
      onChangeMode: "immediate",
    })).toThrow("invalid");

    expect(editor.view.state).toBe(stateBeforeInvalidUpdate);
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Original editor");
    expect(editor.view.dom.getAttribute("data-mode")).toBe("draft");
    expect(oldChanges).not.toHaveBeenCalled();
    expect(nextChanges).not.toHaveBeenCalled();

    editor.updateOptions({
      attributes: { "data-mode": "review" },
      editable: false,
      onChange: nextChanges,
      onChangeMode: "immediate",
    });
    expect(oldChanges).toHaveBeenCalledOnce();
    expect(editor.view.state).toBe(stateBeforeInvalidUpdate);
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(editor.view.dom.getAttribute("data-mode")).toBe("review");

    editor.updateOptions({ editable: true });
    editor.view.dispatch(editor.view.state.tr.insertText("?", editor.view.state.doc.content.size - 1));
    expect(nextChanges).toHaveBeenCalledWith("alpha!?", { origin: "user" });
  });

  it("blocks task and opaque-source controls while read-only and re-enables them dynamically", () => {
    const edits = vi.fn();
    const nextEdits = vi.fn();
    const editor = track(createEditor({
      editable: false,
      element: createHost(),
      markdown: "---\ntitle: Demo\n---\n\n* [ ] task",
      onEditOpaqueMarkdown: edits,
    }));
    const task = editor.view.dom.querySelector<HTMLElement>('[data-mdw-task-control="true"]')!;
    const opaqueEdit = editor.view.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")!;

    expect(task.getAttribute("aria-disabled")).toBe("true");
    expect(task.tabIndex).toBe(-1);
    expect(opaqueEdit.disabled).toBe(true);
    task.click();
    opaqueEdit.click();
    expect(editor.getMarkdown()).toContain("* [ ] task");
    expect(edits).not.toHaveBeenCalled();

    editor.updateOptions({ editable: true });
    expect(task.getAttribute("aria-disabled")).toBe("false");
    expect(task.tabIndex).toBe(0);
    expect(opaqueEdit.disabled).toBe(false);
    opaqueEdit.click();
    expect(edits).toHaveBeenCalledTimes(1);

    editor.updateOptions({ onEditOpaqueMarkdown: nextEdits });
    opaqueEdit.click();
    expect(edits).toHaveBeenCalledTimes(1);
    expect(nextEdits).toHaveBeenCalledTimes(1);

    editor.updateOptions({ onEditOpaqueMarkdown: null });
    expect(opaqueEdit.hidden).toBe(true);
    expect(opaqueEdit.disabled).toBe(true);
    opaqueEdit.click();
    expect(nextEdits).toHaveBeenCalledTimes(1);
  });

  it("swaps runtime callbacks after flushing pending output through the old callback", () => {
    const oldChanges = vi.fn();
    const nextChanges = vi.fn();
    const oldTransactions = vi.fn();
    const nextTransactions = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: oldChanges,
      onChangeMode: "animationFrame",
      onTransaction: oldTransactions,
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(oldChanges).not.toHaveBeenCalled();
    editor.updateOptions({
      onChange: nextChanges,
      onChangeMode: "immediate",
      onTransaction: nextTransactions,
    });
    expect(oldChanges).toHaveBeenCalledOnce();
    expect(oldChanges).toHaveBeenLastCalledWith("alpha!", { origin: "user" });

    editor.view.dispatch(editor.view.state.tr.insertText("?", editor.view.state.doc.content.size - 1));
    expect(nextChanges).toHaveBeenCalledWith("alpha!?", { origin: "user" });
    expect(oldTransactions).toHaveBeenCalledTimes(1);
    expect(nextTransactions).toHaveBeenCalledTimes(1);

    editor.updateOptions({ onChange: null, onTransaction: null });
    editor.view.dispatch(editor.view.state.tr.insertText("+", editor.view.state.doc.content.size - 1));
    expect(nextChanges).toHaveBeenCalledTimes(1);
    expect(nextTransactions).toHaveBeenCalledTimes(1);
  });

  it("keeps queued batching when a host reapplies the identical callback or mode", () => {
    const changes = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
      onChangeMode: "animationFrame",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    editor.updateOptions({ onChange: changes });
    editor.updateOptions({ onChangeMode: "animationFrame" });
    expect(changes).not.toHaveBeenCalled();

    editor.flushChange();
    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith("alpha!", { origin: "user" });
  });

  it("preserves reentrant option changes made while the previous callback is flushing", () => {
    const nextChanges = vi.fn();
    let editor!: MarkdownEditor;
    editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange() {
        editor.updateOptions({
          editable: false,
          placeholder: "Inner preview guidance",
        });
      },
      onChangeMode: "animationFrame",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    editor.updateOptions({ onChange: nextChanges });

    expect(editor.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-placeholder")).toBe("Inner preview guidance");
    expect(editor.state.can.undo()).toBe(false);

    editor.updateOptions({ editable: true });
    editor.view.dispatch(editor.view.state.tr.insertText("?", editor.view.state.doc.content.size - 1));
    editor.flushChange();
    expect(nextChanges).toHaveBeenCalledWith("alpha!?", { origin: "user" });
  });

  it("updates custom UI surfaces once per relevant option refresh", () => {
    const clearSelectionAnchor = vi.fn();
    const imageClose = vi.fn();
    const linkClose = vi.fn();
    const tableUpdate = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      ui: createUiFactory({
        clearSelectionAnchor,
        imageClose,
        linkClose,
        tableUpdate,
      }),
    }));
    clearSelectionAnchor.mockClear();
    imageClose.mockClear();
    linkClose.mockClear();
    tableUpdate.mockClear();

    editor.updateOptions({ editable: false });
    expect(clearSelectionAnchor).toHaveBeenCalledOnce();
    expect(imageClose).toHaveBeenCalledOnce();
    expect(linkClose).toHaveBeenCalledOnce();
    expect(tableUpdate).toHaveBeenCalledOnce();

    clearSelectionAnchor.mockClear();
    imageClose.mockClear();
    linkClose.mockClear();
    tableUpdate.mockClear();
    editor.updateOptions({ placeholder: "Preview guidance" });
    expect(clearSelectionAnchor).not.toHaveBeenCalled();
    expect(imageClose).toHaveBeenCalledOnce();
    expect(linkClose).toHaveBeenCalledOnce();
    expect(tableUpdate).toHaveBeenCalledOnce();

    imageClose.mockClear();
    linkClose.mockClear();
    tableUpdate.mockClear();
    editor.updateOptions({ onTransaction: vi.fn() });
    expect(imageClose).not.toHaveBeenCalled();
    expect(linkClose).not.toHaveBeenCalled();
    expect(tableUpdate).not.toHaveBeenCalled();
  });

  it("stops option application with the stable lifecycle error if an accessor destroys the editor", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    const options = {
      get placeholder() {
        editor.destroy();
        return "too late";
      },
    };

    expect(() => editor.updateOptions(options)).toThrow(MarkdownEditorDestroyedError);
    expect(editor.isDestroyed).toBe(true);
  });

  it("stops focus selection resolution with the stable lifecycle error if an accessor destroys the editor", () => {
    const host = createHost();
    const editor = track(createEditor({ element: host, markdown: "alpha" }));
    const selection = {
      get anchor() {
        editor.destroy();
        return 2;
      },
    };

    expect(() => editor.focus(selection)).toThrow(MarkdownEditorDestroyedError);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.view.isDestroyed).toBe(true);
    expect(host.querySelector(".ProseMirror")).toBeNull();
  });

  it.each(["src", "title"] as const)(
    "stops image insertion with the stable lifecycle error if the %s accessor destroys the editor",
    (field) => {
      const host = createHost();
      const editor = track(createEditor({ element: host, markdown: "alpha" }));
      const attrs = {
        alt: "description" as string | null,
        src: "safe.png",
        title: "caption" as string | null,
      };
      Object.defineProperty(attrs, field, {
        configurable: true,
        enumerable: true,
        get() {
          editor.destroy();
          return field === "src" ? "safe.png" : "caption";
        },
      });

      expect(() => editor.commands.insertImage(attrs)).toThrow(MarkdownEditorDestroyedError);
      expect(editor.isDestroyed).toBe(true);
      expect(editor.view.isDestroyed).toBe(true);
      expect(editor.getMarkdown()).toBe("alpha");
      expect(editor.view.state.doc.textContent).toBe("alpha");
    },
  );

  it("stops Markdown replacement if its options accessor destroys the editor", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    const options = {
      get emitChange() {
        editor.destroy();
        return true;
      },
    };

    expect(() => editor.commands.setMarkdown("replacement", options)).toThrow(MarkdownEditorDestroyedError);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha");
    expect(editor.view.state.doc.textContent).toBe("alpha");
  });
});

describe("typed editor subscriptions", () => {
  it("emits selection and lazy update events independently, including silent setMarkdown", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    const selections: Array<{ from: number; to: number }> = [];
    const updates: string[] = [];
    editor.subscribe("selection", ({ selection }) => {
      selections.push({ from: selection.from, to: selection.to });
    });
    editor.subscribe("update", ({ editor: currentEditor }) => {
      updates.push(currentEditor.getMarkdown());
    });

    editor.focus("end");
    expect(selections).toHaveLength(1);
    expect(updates).toEqual([]);

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(updates).toEqual(["alpha!"]);

    editor.commands.setMarkdown("replacement");
    expect(updates).toEqual(["alpha!", "replacement"]);
  });

  it("keeps duplicate subscriptions independent and makes unsubscribe immediate and idempotent", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    const calls: string[] = [];
    const listener = () => calls.push("listener");
    const unsubscribeFirst = editor.subscribe("update", listener);
    const unsubscribeSecond = editor.subscribe("update", listener);
    editor.subscribe("update", () => {
      calls.push("destroyer");
      unsubscribeSecond();
    });

    unsubscribeFirst();
    unsubscribeFirst();
    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(calls).toEqual(["listener", "destroyer"]);

    editor.view.dispatch(editor.view.state.tr.insertText("?", editor.view.state.doc.content.size - 1));
    expect(calls).toEqual(["listener", "destroyer", "destroyer"]);
  });

  it("stops the current emission when a subscriber destroys the editor", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    const calls: string[] = [];
    editor.subscribe("update", () => {
      calls.push("destroy");
      editor.destroy();
    });
    editor.subscribe("update", () => calls.push("late listener"));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(calls).toEqual(["destroy"]);
    expect(editor.isDestroyed).toBe(true);
  });

  it("suppresses superseded transaction events after immediate onChange replaces the document", () => {
    let editor!: MarkdownEditor;
    let shouldReplace = true;
    const selections: number[] = [];
    const updates: string[] = [];

    editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChangeMode: "immediate",
      onChange() {
        if (shouldReplace) {
          shouldReplace = false;
          editor.commands.setMarkdown("replacement");
        }
      },
    }));
    editor.subscribe("selection", ({ selection }) => selections.push(selection.from));
    editor.subscribe("update", ({ editor: currentEditor }) => updates.push(currentEditor.getMarkdown()));

    editor.view.dispatch(editor.view.state.tr.insertText("!", 1));

    expect(editor.getMarkdown()).toBe("replacement");
    expect(selections).toEqual([1]);
    expect(updates).toEqual(["replacement"]);
  });

  it("suppresses a superseded setMarkdown event after its immediate onChange reenters", () => {
    let editor!: MarkdownEditor;
    let shouldReplace = true;
    const updates: string[] = [];

    editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChangeMode: "immediate",
      onChange() {
        if (shouldReplace) {
          shouldReplace = false;
          editor.commands.setMarkdown("replacement");
        }
      },
    }));
    editor.subscribe("update", ({ editor: currentEditor }) => updates.push(currentEditor.getMarkdown()));

    editor.commands.setMarkdown("outer", { emitChange: true });

    expect(editor.getMarkdown()).toBe("replacement");
    expect(updates).toEqual(["replacement"]);
  });

  it("emits one current update when immediate onChange only reenters to move selection", () => {
    let editor!: MarkdownEditor;
    let shouldMove = true;
    const events: string[] = [];

    editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChangeMode: "immediate",
      onChange() {
        if (shouldMove) {
          shouldMove = false;
          editor.focus("end");
        }
      },
    }));
    editor.subscribe("selection", ({ selection }) => events.push(`selection:${selection.from}`));
    editor.subscribe("update", ({ editor: currentEditor }) => events.push(`update:${currentEditor.getMarkdown()}`));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));

    expect(events).toEqual(["selection:7", "update:alpha!"]);
  });

  it("delivers accepted typed events before rethrowing an immediate onChange failure", () => {
    const failure = new Error("save failed");
    const calls: string[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChangeMode: "immediate",
      onChange() {
        calls.push("change");
        throw failure;
      },
    }));
    editor.subscribe("selection", () => calls.push("selection"));
    editor.subscribe("update", ({ editor: currentEditor }) => {
      calls.push(`update:${currentEditor.getMarkdown()}`);
    });

    expect(() => editor.view.dispatch(editor.view.state.tr.insertText("!", 1))).toThrow(failure);
    expect(calls).toEqual(["change", "selection", "update:!alpha"]);
    expect(editor.getMarkdown()).toBe("!alpha");

    calls.length = 0;
    expect(() => editor.commands.setMarkdown("replacement", { emitChange: true })).toThrow(failure);
    expect(calls).toEqual(["change", "selection", "update:replacement"]);
    expect(editor.getMarkdown()).toBe("replacement");
  });

  it("does not swallow an undefined value thrown by onTransaction", () => {
    let caught = false;
    const updates = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onTransaction() {
        throw undefined;
      },
    }));
    editor.subscribe("update", updates);

    try {
      editor.view.dispatch(editor.view.state.tr.insertText("!", 1));
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }

    expect(caught).toBe(true);
    expect(updates).toHaveBeenCalledOnce();
    expect(editor.getMarkdown()).toBe("!alpha");
  });

  it("stops a superseded outer update before later listeners see the nested state twice", () => {
    const calls: string[] = [];
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    editor.subscribe("update", ({ editor: currentEditor }) => {
      const markdown = currentEditor.getMarkdown();
      calls.push(`first:${markdown}`);

      if (markdown === "alpha!") {
        currentEditor.commands.setMarkdown("nested");
      }
    });
    editor.subscribe("update", ({ editor: currentEditor }) => {
      calls.push(`second:${currentEditor.getMarkdown()}`);
    });

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));

    expect(calls).toEqual([
      "first:alpha!",
      "first:nested",
      "second:nested",
    ]);
  });

  it("continues update delivery across selection-only reentry", () => {
    const calls: string[] = [];
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    editor.subscribe("update", ({ editor: currentEditor }) => {
      calls.push("first");
      currentEditor.focus("end");
    });
    editor.subscribe("update", () => calls.push("second"));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));

    expect(calls).toEqual(["first", "second"]);
  });

  it("finishes a live state update before delivering a synchronous language failure", async () => {
    const failure = new Error("sync language failure");
    const errors: unknown[] = [];
    const editor = track(createEditor({
      codeBlockLanguages: {
        broken() {
          throw failure;
        },
      },
      element: createHost(),
      markdown: "alpha",
    }));
    editor.subscribe("error", (event) => {
      errors.push(event.error);
      editor.commands.setMarkdown("nested");
    });

    editor.commands.setMarkdown("```broken\ncode\n```");
    expect(errors).toEqual([]);
    expect(editor.getMarkdown()).toBe("```broken\ncode\n```");
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();

    intersectionObservers.emitAll(true);
    await vi.waitFor(() => expect(errors).toEqual([failure]));
    expect(errors).toEqual([failure]);
    expect(editor.getMarkdown()).toBe("nested");
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
  });

  it("defers a reentrant language loader until the outer document update finishes", async () => {
    let editor: MarkdownEditor;
    let reenter = true;
    const loader = vi.fn(() => {
      if (reenter) {
        reenter = false;
        editor.commands.setMarkdown("nested");
      }

      return [];
    });
    editor = track(createEditor({
      codeBlockLanguages: { custom: loader },
      element: createHost(),
      markdown: "alpha",
    }));

    editor.commands.setMarkdown("```custom\ncode\n```");
    expect(loader).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe("```custom\ncode\n```");

    intersectionObservers.emitAll(true);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    expect(loader).toHaveBeenCalledOnce();
    expect(editor.getMarkdown()).toBe("nested");
    expect(editor.view.dom.textContent).toContain("nested");
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
  });

  it("defers reentrant language-extension initialization until the outer update finishes", async () => {
    let editor: MarkdownEditor;
    let reenter = true;
    const extension = ViewPlugin.define(() => {
      if (reenter) {
        reenter = false;
        editor.commands.setMarkdown("nested");
      }

      return {};
    });
    editor = track(createEditor({
      codeBlockLanguages: { custom: extension },
      element: createHost(),
      markdown: "alpha",
    }));

    editor.commands.setMarkdown("```custom\ncode\n```");
    expect(editor.getMarkdown()).toBe("```custom\ncode\n```");

    intersectionObservers.emitAll(true);
    await vi.waitFor(() => expect(editor.getMarkdown()).toBe("nested"));
    expect(editor.getMarkdown()).toBe("nested");
    expect(editor.view.dom.textContent).toContain("nested");
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
  });

  it("defers a synchronous language-extension application failure", async () => {
    const errors: unknown[] = [];
    const editor = track(createEditor({
      codeBlockLanguages: {
        broken: () => ({ invalidExtension: true }) as never,
      },
      element: createHost(),
      markdown: "alpha",
    }));
    editor.subscribe("error", (event) => errors.push(event.error));

    editor.commands.setMarkdown("```broken\ncode\n```");
    expect(errors).toEqual([]);
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();

    intersectionObservers.emitAll(true);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toContain("Unrecognized extension value");
    expect(editor.getMarkdown()).toBe("```broken\ncode\n```");
  });

  it("restores CodeMirror forwarding after an outer callback throws", async () => {
    const failure = new Error("one-shot transaction failure");
    const extensionErrors: unknown[] = [];
    let shouldThrow = true;
    const editor = track(createEditor({
      codeBlockLanguages: {
        custom: [
          CodeMirrorEditorView.exceptionSink.of((error) => extensionErrors.push(error)),
          ViewPlugin.define((view) => {
            view.dom.setAttribute("data-forwarding-extension", "ready");
            return {};
          }),
        ],
      },
      element: createHost(),
      markdown: "```custom\ncode\n```",
      onTransaction(transaction) {
        if (transaction.docChanged && shouldThrow) {
          shouldThrow = false;
          throw failure;
        }
      },
    }));

    await activateCodeBlocks(editor);
    await vi.waitFor(() => {
      expect(editor.view.dom.querySelector(".cm-editor")?.getAttribute("data-forwarding-extension"))
        .toBe("ready");
    });
    const codeMirrorDom = editor.view.dom.querySelector<HTMLElement>(".cm-editor")!;
    const codeMirror = CodeMirrorEditorView.findFromDOM(codeMirrorDom)!;
    codeMirror.contentDOM.focus();
    codeMirror.dispatch({ changes: { from: codeMirror.state.doc.length, insert: "1" } });
    expect(editor.getMarkdown()).toBe("```custom\ncode1\n```");

    codeMirror.dispatch({ changes: { from: codeMirror.state.doc.length, insert: "2" } });
    expect(editor.getMarkdown()).toBe("```custom\ncode12\n```");
    expect(extensionErrors).toEqual([failure]);
  });

  it("delivers core callbacks and typed events before rethrowing a custom UI update failure", () => {
    const failure = new Error("link close failed during update");
    const calls: string[] = [];
    const imageClose = vi.fn();
    const tableUpdate = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: () => calls.push("change"),
      onChangeMode: "immediate",
      onTransaction: () => calls.push("transaction"),
      ui: createUiFactory({
        imageClose,
        linkClose: vi.fn(() => {
          throw failure;
        }),
        tableUpdate,
      }),
    }));
    imageClose.mockClear();
    tableUpdate.mockClear();
    editor.subscribe("selection", () => calls.push("selection"));
    editor.subscribe("update", () => calls.push("update"));

    expect(() => editor.view.dispatch(editor.view.state.tr.insertText("!", 1))).toThrow(failure);
    expect(calls).toEqual(["transaction", "change", "selection", "update"]);
    expect(imageClose).toHaveBeenCalledOnce();
    expect(tableUpdate).toHaveBeenCalledOnce();
    expect(editor.getMarkdown()).toBe("!alpha");
  });

  it("reports custom UI plugin-view reinitialization failure from setMarkdown", () => {
    const failure = new Error("table reinitialization failed");
    const calls: string[] = [];
    let tableUpdates = 0;
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: () => calls.push("change"),
      onChangeMode: "immediate",
      ui: createUiFactory({
        tableUpdate: vi.fn(() => {
          tableUpdates += 1;

          if (tableUpdates === 2) {
            throw failure;
          }
        }),
      }),
    }));
    editor.subscribe("update", () => calls.push("update"));

    expect(() => editor.commands.setMarkdown("replacement", { emitChange: true })).toThrow(failure);
    expect(calls).toEqual(["change", "update"]);
    expect(editor.getMarkdown()).toBe("replacement");
    expect(tableUpdates).toBe(2);
  });

  it.each(["dispatch", "updateOptions"] as const)(
    "stops custom UI callbacks after %s destroys the editor during a view update",
    (trigger) => {
      const postDestroyCalls: string[] = [];
      const onTransaction = vi.fn();
      let editor: MarkdownEditor;
      let imageDestroyed = false;
      let linkDestroyed = false;
      let tableDestroyed = false;
      editor = track(createEditor({
        element: createHost(),
        markdown: "alpha",
        onTransaction,
        ui: () => ({
          enabled: true,
          clearSelectionAnchor() {},
          createSelectionAnchor() {
            return null;
          },
          imageEditor: {
            open() {},
            close() {
              if (imageDestroyed) {
                postDestroyCalls.push("image.close");
              }
            },
            destroy() {
              imageDestroyed = true;
            },
          },
          linkEditor: {
            open() {},
            close() {
              if (linkDestroyed) {
                postDestroyCalls.push("link.close");
              }

              if (!editor.isDestroyed) {
                editor.destroy();
              }
            },
            destroy() {
              linkDestroyed = true;
            },
          },
          tableToolbar: {
            update() {
              if (tableDestroyed) {
                postDestroyCalls.push("table.update");
              }
            },
            destroy() {
              tableDestroyed = true;
            },
          },
        }),
      }));

      if (trigger === "dispatch") {
        editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
      } else {
        editor.updateOptions({ placeholder: "Write" });
      }

      expect(editor.isDestroyed).toBe(true);
      expect(postDestroyCalls).toEqual([]);
      expect(onTransaction).not.toHaveBeenCalled();
    },
  );

  it("treats ProseMirror and nested CodeMirror as one focus boundary", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const editor = track(createEditor({
      element: createHost(),
      markdown: "before\n\n```\ncode\n```",
    }));
    const focusEvents = vi.fn();
    const blurEvents = vi.fn();
    editor.subscribe("focus", focusEvents);
    editor.subscribe("blur", blurEvents);
    await activateCodeBlocks(editor);

    editor.focus();
    expect(focusEvents).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(focusEvents).toHaveBeenCalledTimes(1);
    editor.blur();
    await Promise.resolve();
    expect(blurEvents).toHaveBeenCalledTimes(1);

    editor.focus();
    await Promise.resolve();
    expect(focusEvents).toHaveBeenCalledTimes(2);
    const codeMirror = editor.view.dom.querySelector<HTMLElement>(".cm-content")!;
    codeMirror.focus();
    await Promise.resolve();
    expect(focusEvents).toHaveBeenCalledTimes(2);
    expect(blurEvents).toHaveBeenCalledTimes(1);

    outside.focus();
    await Promise.resolve();
    expect(blurEvents).toHaveBeenCalledTimes(2);
  });

  it("finishes focus before a focus subscriber destroys the editor", async () => {
    const activeSelectionListeners = new Set<EventListenerOrEventListenerObject>();
    const originalAddEventListener = document.addEventListener;
    const originalRemoveEventListener = document.removeEventListener;
    vi.spyOn(document, "addEventListener").mockImplementation((function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "selectionchange") {
        activeSelectionListeners.add(listener);
      }

      originalAddEventListener.call(this, type, listener, options);
    }) as typeof document.addEventListener);
    vi.spyOn(document, "removeEventListener").mockImplementation((function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "selectionchange") {
        activeSelectionListeners.delete(listener);
      }

      originalRemoveEventListener.call(this, type, listener, options);
    }) as typeof document.removeEventListener);

    const host = createHost();
    const editor = track(createEditor({ element: host, markdown: "alpha" }));
    expect(activeSelectionListeners.size).toBe(1);
    editor.subscribe("focus", () => editor.destroy());

    editor.focus();
    expect(editor.isDestroyed).toBe(false);

    await Promise.resolve();
    expect(editor.isDestroyed).toBe(true);
    expect(editor.view.isDestroyed).toBe(true);
    expect(host.querySelector(".ProseMirror")).toBeNull();
    expect(activeSelectionListeners.size).toBe(0);
  });

  it("removes ProseMirror's one-shot hidden-selection guard on destroy", () => {
    const selectionChangeDescriptor = Object.getOwnPropertyDescriptor(document, "onselectionchange");
    Object.defineProperty(document, "onselectionchange", {
      configurable: true,
      value: null,
      writable: true,
    });
    const activeSelectionListeners = new Set<EventListenerOrEventListenerObject>();
    const originalAddEventListener = document.addEventListener;
    const originalRemoveEventListener = document.removeEventListener;
    vi.spyOn(document, "addEventListener").mockImplementation((function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "selectionchange") {
        activeSelectionListeners.add(listener);
      }

      originalAddEventListener.call(this, type, listener, options);
    }) as typeof document.addEventListener);
    vi.spyOn(document, "removeEventListener").mockImplementation((function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "selectionchange") {
        activeSelectionListeners.delete(listener);
      }

      originalRemoveEventListener.call(this, type, listener, options);
    }) as typeof document.removeEventListener);

    try {
      const editor = track(createEditor({
        element: createHost(),
        markdown: "before\n\n```\ncode\n```",
      }));
      let blockPos = -1;
      editor.view.state.doc.descendants((node, pos) => {
        if (blockPos < 0 && node.type.name === "code_block") {
          blockPos = pos;
          return false;
        }

        return true;
      });
      const cursor = ManagedBlockCursor.create(
        editor.view.state.doc,
        blockPos,
        "before",
        (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
      )!;

      editor.view.focus();
      editor.view.dispatch(editor.view.state.tr.setSelection(cursor));

      expect(editor.view.dom.classList.contains("ProseMirror-hideselection")).toBe(true);
      expect(activeSelectionListeners.size).toBe(2);

      editor.destroy();

      expect(activeSelectionListeners.size).toBe(0);
    } finally {
      if (selectionChangeDescriptor) {
        Object.defineProperty(document, "onselectionchange", selectionChangeDescriptor);
      } else {
        Reflect.deleteProperty(document, "onselectionchange");
      }
    }
  });

  it("reports a rejected language loader as one recoverable error", async () => {
    const failure = new Error("language unavailable");
    const editor = track(createEditor({
      codeBlockLanguages: {
        broken: () => Promise.reject(failure),
      },
      element: createHost(),
      markdown: "```broken\ncode\n```",
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event));

    intersectionObservers.emitAll(true);
    await waitForCodeBlockState(editor, "active");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({
      code: "code-block-language-load-failed",
      context: { language: "broken" },
      error: failure,
      recoverable: true,
      type: "error",
    });
    expect(editor.view.dom.querySelector(".cm-content")).not.toBeNull();
  });
});

describe("editor lifecycle", () => {
  it("makes retained custom UI mutation actions inert after destroy", () => {
    let retainedActions: Parameters<EditorUiFactory>[0] | null = null;
    const fallbackUi = createUiFactory();
    const editor = track(createEditor({
      element: createHost(),
      markdown: ["| A | B |", "| --- | --- |", "| C | D |"].join("\n"),
      ui: (actions) => {
        retainedActions = actions;
        return fallbackUi(actions);
      },
    }));
    const actions = retainedActions!;
    const beforeActiveMutation = editor.view.state.doc;
    actions.appendTableRow(editor.view);
    expect(editor.view.state.doc.eq(beforeActiveMutation)).toBe(false);

    editor.destroy();
    const destroyedDoc = editor.view.state.doc;

    expect(() => {
      actions.appendTableColumn(editor.view);
      actions.appendTableRow(editor.view);
      actions.removeTableColumn(editor.view);
      actions.removeTableRow(editor.view);
      actions.setTableColumnAlignment(editor.view, "center");
      actions.removeActiveTable(editor.view);
      actions.removeActiveImage(editor.view);
      actions.removeActiveLink(editor.view);
    }).not.toThrow();
    expect(actions.updateActiveImage(editor.view, { src: "safe.png", alt: null, title: null })).toBe(false);
    expect(actions.updateLinkHref(editor.view, "https://example.com")).toBe(false);
    expect(editor.view.state.doc.eq(destroyedDoc)).toBe(true);
  });

  it("destroys exactly once, removes owned host state, caches Markdown, and permits same-host remount", () => {
    const host = createHost();
    const spies = {
      clearSelectionAnchor: vi.fn(),
      imageDestroy: vi.fn(),
      linkDestroy: vi.fn(),
      tableDestroy: vi.fn(),
    };
    const editor = track(createEditor({
      element: host,
      markdown: "alpha",
      ui: createUiFactory(spies),
    }));
    const unsubscribe = editor.subscribe("update", vi.fn());
    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    editor.destroy();
    editor.destroy();
    unsubscribe();
    unsubscribe();

    expect(editor.isDestroyed).toBe(true);
    expect(editor.getMarkdown()).toBe("alpha!");
    expect(() => editor.flushChange()).not.toThrow();
    expect(spies.clearSelectionAnchor).toHaveBeenCalledTimes(1);
    expect(spies.imageDestroy).toHaveBeenCalledTimes(1);
    expect(spies.linkDestroy).toHaveBeenCalledTimes(1);
    expect(spies.tableDestroy).toHaveBeenCalledTimes(1);
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect(host.querySelector(".ProseMirror")).toBeNull();

    const remounted = track(createEditor({ element: host, markdown: "beta" }));
    expect(remounted.getMarkdown()).toBe("beta");
  });

  it("throws a stable error from operational APIs after destroy", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    editor.destroy();

    for (const operation of [
      () => editor.focus(),
      () => editor.blur(),
      () => editor.updateOptions({ editable: false }),
      () => editor.subscribe("update", vi.fn()),
      () => editor.commands.setMarkdown("next"),
      () => editor.commands.toggleMark("strong"),
      () => editor.state.can.undo(),
      () => editor.state.isActive.mark("strong"),
      () => editor.getToolbarState(),
    ]) {
      expect(operation).toThrow(MarkdownEditorDestroyedError);
    }
  });

  it("finishes every cleanup step when the final onChange throws", () => {
    const host = createHost();
    const spies = {
      clearSelectionAnchor: vi.fn(),
      imageDestroy: vi.fn(),
      linkDestroy: vi.fn(),
      tableDestroy: vi.fn(),
    };
    const failure = new Error("save failed");
    const editor = track(createEditor({
      element: host,
      markdown: "alpha",
      onChange() {
        throw failure;
      },
      onChangeMode: "animationFrame",
      ui: createUiFactory(spies),
    }));
    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));

    expect(() => editor.destroy()).toThrow(failure);
    expect(editor.isDestroyed).toBe(true);
    expect(spies.imageDestroy).toHaveBeenCalledOnce();
    expect(spies.linkDestroy).toHaveBeenCalledOnce();
    expect(spies.tableDestroy).toHaveBeenCalledOnce();
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect(() => editor.destroy()).not.toThrow();
  });

  it("continues cleanup after a custom controller throws and preserves a host-owned class", () => {
    const host = createHost();
    host.classList.add("mdw-host");
    const failure = new Error("link teardown failed");
    const imageDestroy = vi.fn();
    const linkDestroy = vi.fn(() => {
      throw failure;
    });
    const tableDestroy = vi.fn();
    const editor = track(createEditor({
      element: host,
      ui: createUiFactory({ imageDestroy, linkDestroy, tableDestroy }),
    }));

    expect(() => editor.destroy()).toThrow(failure);
    expect(editor.isDestroyed).toBe(true);
    expect(imageDestroy).toHaveBeenCalledOnce();
    expect(linkDestroy).toHaveBeenCalledOnce();
    expect(tableDestroy).toHaveBeenCalledOnce();
    expect(host.classList.contains("mdw-host")).toBe(true);
    expect(host.querySelector(".ProseMirror")).toBeNull();
    expect(() => editor.destroy()).not.toThrow();
  });

  it("finishes ProseMirror teardown when an overlay close callback throws", () => {
    const host = createHost();
    const failure = new Error("link close failed");
    const imageDestroy = vi.fn();
    const linkDestroy = vi.fn();
    const tableDestroy = vi.fn();
    const editor = track(createEditor({
      element: host,
      markdown: "alpha",
      ui: () => ({
        enabled: true,
        clearSelectionAnchor() {},
        createSelectionAnchor() {
          return null;
        },
        imageEditor: {
          open() {},
          close() {},
          destroy: imageDestroy,
        },
        linkEditor: {
          open() {},
          close() {
            throw failure;
          },
          destroy: linkDestroy,
        },
        tableToolbar: {
          update() {},
          destroy: tableDestroy,
        },
      }),
    }));

    expect(() => editor.destroy()).toThrow(failure);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.view.isDestroyed).toBe(true);
    expect(host.querySelector(".ProseMirror")).toBeNull();
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect(imageDestroy).toHaveBeenCalledOnce();
    expect(linkDestroy).toHaveBeenCalledOnce();
    expect(tableDestroy).toHaveBeenCalledOnce();

    const remounted = track(createEditor({ element: host, markdown: "recovered" }));
    expect(remounted.getMarkdown()).toBe("recovered");
  });

  it("finishes ProseMirror teardown when a custom CodeMirror widget throws", async () => {
    const host = createHost();
    const failure = new Error("widget teardown failed");

    class ThrowingWidget extends WidgetType {
      toDOM(view: CodeMirrorEditorView) {
        const element = view.dom.ownerDocument.createElement("span");
        element.setAttribute("data-fragile-widget", "mounted");
        return element;
      }

      destroy() {
        throw failure;
      }
    }

    const decoration = CodeMirrorDecoration.widget({
      widget: new ThrowingWidget(),
    }).range(0);
    const editor = track(createEditor({
      codeBlockLanguages: {
        fragile: () => CodeMirrorEditorView.decorations.of(
          CodeMirrorDecoration.set([decoration]),
        ),
      },
      element: host,
      markdown: "```fragile\ncode\n```",
    }));

    await activateCodeBlocks(editor);
    await vi.waitFor(() => {
      expect(editor.view.dom.querySelector('[data-fragile-widget="mounted"]')).not.toBeNull();
    });

    expect(() => editor.destroy()).toThrow(failure);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.view.isDestroyed).toBe(true);
    expect(host.querySelector(".ProseMirror")).toBeNull();
    expect(host.classList.contains("mdw-host")).toBe(false);

    const remounted = track(createEditor({ element: host, markdown: "recovered" }));
    expect(remounted.getMarkdown()).toBe("recovered");
  });

  it("reports a live CodeMirror teardown failure from the document replacement that caused it", async () => {
    const failure = new Error("removed widget teardown failed");

    class ThrowingWidget extends WidgetType {
      toDOM(view: CodeMirrorEditorView) {
        const element = view.dom.ownerDocument.createElement("span");
        element.setAttribute("data-fragile-widget", "mounted");
        return element;
      }

      destroy() {
        throw failure;
      }
    }

    const editor = track(createEditor({
      codeBlockLanguages: {
        fragile: () => CodeMirrorEditorView.decorations.of(
          CodeMirrorDecoration.set([
            CodeMirrorDecoration.widget({ widget: new ThrowingWidget() }).range(0),
          ]),
        ),
      },
      element: createHost(),
      markdown: "```fragile\ncode\n```",
    }));

    await activateCodeBlocks(editor);
    await vi.waitFor(() => {
      expect(editor.view.dom.querySelector('[data-fragile-widget="mounted"]')).not.toBeNull();
    });

    expect(() => editor.commands.setMarkdown("plain")).toThrow(failure);
    expect(editor.getMarkdown()).toBe("plain");
    expect(editor.isDestroyed).toBe(false);
    expect(() => editor.destroy()).not.toThrow();
  });

  it("releases host ownership when creation fails", () => {
    const host = createHost();

    expect(() => createEditor({
      element: host,
      ui() {
        throw new Error("factory failed");
      },
    })).toThrow("factory failed");
    expect(host.classList.contains("mdw-host")).toBe(false);

    const editor = track(createEditor({ element: host, markdown: "recovered" }));
    expect(editor.getMarkdown()).toBe("recovered");
    expect(() => createEditor({ element: host })).toThrow("already has a live editor");
  });

  it("keeps the passive shell usable when lazy language-registry enumeration fails", async () => {
    const host = createHost();
    const failure = new Error("registry getter failed");
    const registry = Object.create(null) as CodeBlockLanguageRegistry;
    Object.defineProperty(registry, "broken", {
      enumerable: true,
      get() {
        throw failure;
      },
    });

    const editor = track(createEditor({
      codeBlockLanguages: registry,
      element: host,
      markdown: "```broken\ncode\n```",
    }));
    const errors: Array<{ code: string; error: unknown; language?: string }> = [];
    editor.subscribe("error", (event) => errors.push({
      code: event.code,
      error: event.error,
      language: event.context.language,
    }));

    expect(host.classList.contains("mdw-host")).toBe(true);
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
    expect(editor.view.dom.querySelector(".mdw-code-block-static-code")?.textContent).toBe("code");

    intersectionObservers.emitAll(true);
    await waitForCodeBlockState(editor, "error");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors).toEqual([{
      code: "code-block-runtime-load-failed",
      error: failure,
      language: "broken",
    }]);
    expect(editor.view.dom.querySelector(".mdw-code-block-static-code")?.textContent).toBe("code");
  });

  it("cleans returned UI controllers when reading their configuration fails", () => {
    const host = createHost();
    const failure = new Error("enabled getter failed");
    const imageDestroy = vi.fn();
    const linkDestroy = vi.fn();
    const tableDestroy = vi.fn();

    expect(() => createEditor({
      element: host,
      ui: () => ({
        get enabled() {
          throw failure;
        },
        clearSelectionAnchor() {},
        createSelectionAnchor() {
          return null;
        },
        imageEditor: {
          open() {},
          close() {},
          destroy: imageDestroy,
        },
        linkEditor: {
          open() {},
          close() {},
          destroy: linkDestroy,
        },
        tableToolbar: {
          update() {},
          destroy: tableDestroy,
        },
      }),
    })).toThrow(failure);
    expect(imageDestroy).toHaveBeenCalledOnce();
    expect(linkDestroy).toHaveBeenCalledOnce();
    expect(tableDestroy).toHaveBeenCalledOnce();
    expect(host.classList.contains("mdw-host")).toBe(false);

    const editor = track(createEditor({ element: host, markdown: "recovered" }));
    expect(editor.getMarkdown()).toBe("recovered");
  });

  it("reports an initial synchronous language-loader failure after construction", async () => {
    const host = createHost();
    const failure = new Error("language loader failed");
    const editor = track(createEditor({
      codeBlockLanguages: {
        broken() {
          throw failure;
        },
      },
      element: host,
      markdown: "```broken\ncode\n```",
    }));
    const errors: unknown[] = [];
    editor.subscribe("error", (event) => errors.push(event.error));

    expect(errors).toEqual([]);
    expect(host.classList.contains("mdw-host")).toBe(true);
    expect(host.querySelector(".ProseMirror")).not.toBeNull();

    intersectionObservers.emitAll(true);
    await waitForCodeBlockState(editor, "active");
    await vi.waitFor(() => expect(errors).toEqual([failure]));
    expect(errors).toEqual([failure]);
    expect(editor.getMarkdown()).toBe("```broken\ncode\n```");
  });

  it("cancels deferred language initialization when custom UI initialization fails", async () => {
    const host = createHost();
    const failure = new Error("table initialization failed");
    const languageCreate = vi.fn();
    const languageDestroy = vi.fn();
    const tableDestroy = vi.fn();
    const trackedLanguage = ViewPlugin.define(() => {
      languageCreate();
      return { destroy: languageDestroy };
    });

    expect(() => createEditor({
      codeBlockLanguages: {
        tracked: () => trackedLanguage,
      },
      element: host,
      markdown: "```tracked\ncode\n```",
      ui: () => ({
        enabled: true,
        clearSelectionAnchor() {},
        createSelectionAnchor() {
          return null;
        },
        imageEditor: {
          open() {},
          close() {},
          destroy() {},
        },
        linkEditor: {
          open() {},
          close() {},
          destroy() {},
        },
        tableToolbar: {
          update() {
            throw failure;
          },
          destroy: tableDestroy,
        },
      }),
    })).toThrow(failure);
    expect(languageCreate).not.toHaveBeenCalled();
    expect(languageDestroy).not.toHaveBeenCalled();
    expect(tableDestroy).toHaveBeenCalledOnce();
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect(host.querySelector(".ProseMirror")).toBeNull();

    await Promise.resolve();
    expect(languageCreate).not.toHaveBeenCalled();

    const editor = track(createEditor({ element: host, markdown: "recovered" }));
    expect(editor.getMarkdown()).toBe("recovered");
  });

  it("does not schedule work after an onTransaction callback destroys the editor", () => {
    const changes = vi.fn();
    let editor: MarkdownEditor | null = null;
    editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
      onChangeMode: "animationFrame",
      onTransaction(transaction) {
        if (transaction.docChanged) {
          editor?.destroy();
        }
      },
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.isDestroyed).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(() => editor.flushChange()).not.toThrow();
  });
});
