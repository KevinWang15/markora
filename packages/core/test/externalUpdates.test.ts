import { afterEach, describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import {
  createEditor,
  MarkdownEditorDestroyedError,
  setMarkdownEditorTransactionOrigin,
  type MarkdownEditor,
} from "../src";

const editors: MarkdownEditor[] = [];
const restores: Array<() => void> = [];

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

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function installAnimationFrameStub() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  }) as typeof requestAnimationFrame;
  window.cancelAnimationFrame = ((frameId: number) => {
    callbacks.delete(frameId);
  }) as typeof cancelAnimationFrame;

  restores.push(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  return {
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      pendingCallbacks.forEach((callback) => callback(0));
    },
  };
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      // Tests assert callback and teardown failures at their point of origin.
    }
  }

  restores.splice(0).forEach((restore) => restore());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("reconciled external Markdown updates", () => {
  it("is a strict semantic no-op for identical and canonically equivalent Markdown", () => {
    const changes = vi.fn();
    const transactions = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
      onTransaction: transactions,
    }));
    const selections = vi.fn();
    const updates = vi.fn();
    editor.subscribe("selection", selections);
    editor.subscribe("update", updates);
    const initialState = editor.view.state;

    expect(editor.commands.reconcileMarkdown("alpha")).toBe(false);
    expect(editor.commands.reconcileMarkdown("alpha\n", { emitChange: true })).toBe(false);

    expect(editor.view.state).toBe(initialState);
    expect(editor.getMarkdown()).toBe("alpha");
    expect(changes).not.toHaveBeenCalled();
    expect(transactions).not.toHaveBeenCalled();
    expect(selections).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
  });

  it.each([
    {
      expectedFrom: 3,
      expectedTo: 3,
      initialSelection: { anchor: 3 },
      name: "keeps a selection before the changed range",
      nextMarkdown: "alpha expanded beta",
    },
    {
      expectedFrom: 12,
      expectedTo: 12,
      initialSelection: { anchor: 8 },
      name: "maps a selection after the changed range",
      nextMarkdown: "new alpha beta",
    },
    {
      expectedFrom: 1,
      expectedTo: 1,
      initialSelection: { anchor: 1, head: 7 },
      name: "collapses a selection whose content is deleted",
      nextMarkdown: "beta",
    },
  ])("$name", ({ expectedFrom, expectedTo, initialSelection, nextMarkdown }) => {
    const editor = track(createEditor({
      element: createHost(),
      initialSelection,
      markdown: "alpha beta",
    }));

    expect(editor.commands.reconcileMarkdown(nextMarkdown)).toBe(true);
    expect(editor.view.state.selection.from).toBe(expectedFrom);
    expect(editor.view.state.selection.to).toBe(expectedTo);
  });

  it("retains local history while keeping the external update out of undo", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.getMarkdown()).toBe("alpha!");
    expect(editor.state.can.undo()).toBe(true);

    expect(editor.commands.reconcileMarkdown("prefix alpha!")).toBe(true);
    expect(editor.getMarkdown()).toBe("prefix alpha!");
    expect(editor.state.can.undo()).toBe(true);

    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("prefix alpha");
    expect(editor.commands.undo()).toBe(false);
  });

  it("retains unaffected code-block node views across a reconciled update", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "```js\nconst answer = 42;\n```\n\ntail",
    }));
    const codeMirror = editor.view.dom.querySelector(".cm-editor");

    expect(codeMirror).not.toBeNull();
    expect(editor.commands.reconcileMarkdown(
      "```js\nconst answer = 42;\n```\n\ntail expanded",
    )).toBe(true);
    expect(editor.view.dom.querySelector(".cm-editor")).toBe(codeMirror);
  });

  it("identifies user, command, and extension transaction origins", () => {
    const transactionOrigins: string[] = [];
    const changeOrigins: string[] = [];
    const updateOrigins: string[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange(_markdown, context) {
        changeOrigins.push(context.origin);
      },
      onTransaction(_transaction, _view, context) {
        transactionOrigins.push(context.origin);
      },
    }));
    editor.subscribe("update", (event) => updateOrigins.push(event.origin));

    editor.view.dispatch(editor.view.state.tr.insertText("!", 6));
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6)),
    );
    transactionOrigins.length = 0;

    expect(editor.commands.toggleMark("strong")).toBe(true);
    const extensionTransaction = setMarkdownEditorTransactionOrigin(
      editor.view.state.tr.insertText("?", editor.view.state.doc.content.size - 1),
      "extension:comments",
    );
    editor.view.dispatch(extensionTransaction);

    expect(transactionOrigins).toEqual(["command", "extension:comments"]);
    expect(changeOrigins).toEqual(["user", "command", "extension:comments"]);
    expect(updateOrigins).toEqual(["user", "command", "extension:comments"]);
  });

  it("does not let a public extension origin bypass read-only filtering", () => {
    const transactionOrigins: string[] = [];
    const editor = track(createEditor({
      editable: false,
      element: createHost(),
      markdown: "alpha",
      onTransaction(_transaction, _view, context) {
        transactionOrigins.push(context.origin);
      },
    }));
    const transaction = setMarkdownEditorTransactionOrigin(
      editor.view.state.tr.insertText("!", 6),
      "extension:comments",
    );

    editor.view.dispatch(transaction);

    expect(editor.getMarkdown()).toBe("alpha");
    expect(transactionOrigins).toEqual(["extension:comments"]);
  });

  it("reports external origins while keeping reconciled updates silent by default", () => {
    const changes: Array<{ markdown: string; origin: string }> = [];
    const transactionOrigins: string[] = [];
    const editor = track(createEditor({
      element: createHost(),
      initialSelection: "end",
      markdown: "alpha",
      onChange(markdown, context) {
        changes.push({ markdown, origin: context.origin });
      },
      onTransaction(_transaction, _view, context) {
        transactionOrigins.push(context.origin);
      },
    }));
    const selectionOrigins: string[] = [];
    const updateOrigins: string[] = [];
    editor.subscribe("selection", (event) => selectionOrigins.push(event.origin));
    editor.subscribe("update", (event) => updateOrigins.push(event.origin));

    expect(editor.commands.reconcileMarkdown("prefix alpha")).toBe(true);
    expect(changes).toEqual([]);
    expect(transactionOrigins).toEqual(["external"]);
    expect(selectionOrigins).toEqual(["external"]);
    expect(updateOrigins).toEqual(["external"]);

    expect(editor.commands.reconcileMarkdown("final", { emitChange: true })).toBe(true);
    expect(changes).toEqual([{ markdown: "final", origin: "external" }]);
    expect(transactionOrigins).toEqual(["external", "external"]);
    expect(selectionOrigins.every((origin) => origin === "external")).toBe(true);
    expect(updateOrigins).toEqual(["external", "external"]);
  });

  it("uses reset origins and clears selection and history on an explicit hard reset", () => {
    const changes: Array<{ markdown: string; origin: string }> = [];
    const transactions = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      initialSelection: "end",
      markdown: "alpha",
      onChange(markdown, context) {
        changes.push({ markdown, origin: context.origin });
      },
      onTransaction: transactions,
    }));
    const selectionOrigins: string[] = [];
    const updateOrigins: string[] = [];
    editor.subscribe("selection", (event) => selectionOrigins.push(event.origin));
    editor.subscribe("update", (event) => updateOrigins.push(event.origin));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.state.can.undo()).toBe(true);
    changes.length = 0;
    transactions.mockClear();
    selectionOrigins.length = 0;
    updateOrigins.length = 0;

    editor.commands.resetMarkdown("beta", { emitChange: true });

    expect(editor.getMarkdown()).toBe("beta");
    expect(editor.view.state.selection.from).toBe(1);
    expect(editor.state.can.undo()).toBe(false);
    expect(editor.commands.undo()).toBe(false);
    expect(changes).toEqual([{ markdown: "beta", origin: "reset" }]);
    expect(transactions).not.toHaveBeenCalled();
    expect(selectionOrigins).toEqual(["reset"]);
    expect(updateOrigins).toEqual(["reset"]);
  });

  it("keeps setMarkdown as a hard-reset compatibility alias", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.state.can.undo()).toBe(true);

    editor.commands.setMarkdown("beta");

    expect(editor.getMarkdown()).toBe("beta");
    expect(editor.state.can.undo()).toBe(false);
  });

  it("hard-resets state and history even when the parsed document is unchanged", () => {
    const editor = track(createEditor({
      element: createHost(),
      initialSelection: "end",
      markdown: "alpha",
    }));
    editor.view.dispatch(editor.view.state.tr.insertText("!", 6));
    const stateBeforeReset = editor.view.state;

    editor.commands.resetMarkdown("alpha!");

    expect(editor.view.state).not.toBe(stateBeforeReset);
    expect(editor.getMarkdown()).toBe("alpha!");
    expect(editor.view.state.selection.from).toBe(1);
    expect(editor.state.can.undo()).toBe(false);
  });

  it("accepts reconciled and reset host updates while the editor is read-only", () => {
    const changes = vi.fn();
    const transactionOrigins: string[] = [];
    const editor = track(createEditor({
      editable: false,
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
      onTransaction(_transaction, _view, context) {
        transactionOrigins.push(context.origin);
      },
    }));
    const updateOrigins: string[] = [];
    editor.subscribe("update", (event) => updateOrigins.push(event.origin));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.getMarkdown()).toBe("alpha");

    expect(editor.commands.reconcileMarkdown("external")).toBe(true);
    editor.commands.resetMarkdown("reset");

    expect(editor.getMarkdown()).toBe("reset");
    expect(changes).not.toHaveBeenCalled();
    expect(transactionOrigins).toEqual(["user", "external"]);
    expect(updateOrigins).toEqual(["external", "reset"]);
  });

  it.each(["immediate", "animationFrame"] as const)(
    "terminates a controlled onChange echo in %s mode",
    (onChangeMode) => {
      const animationFrames = installAnimationFrameStub();
      const changes: Array<{ markdown: string; origin: string }> = [];
      const echoResults: boolean[] = [];
      let editor!: MarkdownEditor;
      editor = track(createEditor({
        element: createHost(),
        markdown: "alpha",
        onChange(markdown, context) {
          changes.push({ markdown, origin: context.origin });
          echoResults.push(editor.commands.reconcileMarkdown(markdown));
        },
        onChangeMode,
      }));

      editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
      animationFrames.flush();
      animationFrames.flush();

      expect(editor.getMarkdown()).toBe("alpha!");
      expect(changes).toEqual([{ markdown: "alpha!", origin: "user" }]);
      expect(echoResults).toEqual([false]);
    },
  );

  it("does not cancel a pending local animation-frame change for an equal echo", () => {
    const animationFrames = installAnimationFrameStub();
    const changes: Array<{ markdown: string; origin: string }> = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange(markdown, context) {
        changes.push({ markdown, origin: context.origin });
      },
      onChangeMode: "animationFrame",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.commands.reconcileMarkdown("alpha!\n")).toBe(false);
    animationFrames.flush();

    expect(changes).toEqual([{ markdown: "alpha!", origin: "user" }]);
  });

  it("cancels a pending local animation-frame change when a different external value wins", () => {
    const animationFrames = installAnimationFrameStub();
    const changes = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      markdown: "alpha",
      onChange: changes,
      onChangeMode: "animationFrame",
    }));

    editor.view.dispatch(editor.view.state.tr.insertText("!", editor.view.state.doc.content.size - 1));
    expect(editor.commands.reconcileMarkdown("authoritative")).toBe(true);
    animationFrames.flush();

    expect(editor.getMarkdown()).toBe("authoritative");
    expect(changes).not.toHaveBeenCalled();
  });

  it("uses deterministic last-invocation-wins ordering for overlapping external updates", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "initial" }));

    expect(editor.commands.reconcileMarkdown("newer value")).toBe(true);
    expect(editor.commands.reconcileMarkdown("older value arriving last")).toBe(true);
    expect(editor.commands.reconcileMarkdown("older value arriving last")).toBe(false);

    expect(editor.getMarkdown()).toBe("older value arriving last");
  });

  it.each(["reconcileMarkdown", "resetMarkdown"] as const)(
    "stops %s if its option accessor destroys the editor",
    (commandName) => {
      const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
      const options = {
        get emitChange() {
          editor.destroy();
          return true;
        },
      };

      expect(() => editor.commands[commandName]("replacement", options)).toThrow(MarkdownEditorDestroyedError);
      expect(editor.isDestroyed).toBe(true);
      expect(editor.getMarkdown()).toBe("alpha");
      expect(editor.view.state.doc.textContent).toBe("alpha");
    },
  );

  it.each([
    ["reconcileMarkdown", "reconcile Markdown"],
    ["resetMarkdown", "reset Markdown"],
    ["setMarkdown", "set Markdown"],
  ] as const)(
    "preserves the stable %s lifecycle error after destroy",
    (commandName, operation) => {
      const editor = track(createEditor({ element: createHost(), markdown: "alpha" }));
      editor.destroy();
      const call = () => editor.commands[commandName]("beta");

      expect(call).toThrow(MarkdownEditorDestroyedError);

      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({ operation });
      }
    },
  );
});
