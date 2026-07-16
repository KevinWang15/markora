import type { Page } from "@playwright/test";
import {
  blurEditor,
  clearEditorEvents,
  copyEditorSelection,
  destroyEditorOnly,
  editorLocator,
  expect,
  focusEditor,
  getEditorEvents,
  getMarkdown,
  isEditorDestroyed,
  mountEditor,
  reconcileEditor,
  remountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
  test,
  unsubscribeEditorEvent,
  updateEditorOptions,
} from "./fixtures";

async function selectText(
  page: Page,
  id: string,
  text: string,
  mode: "all" | "end" | "start" = "all",
) {
  return page.evaluate(
    ({ editorId, needle, selectionMode }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, selectionMode)
    ),
    { editorId: id, needle: text, selectionMode: mode },
  );
}

async function runCommand(
  page: Page,
  id: string,
  command: "redo" | "toggleMark" | "undo",
  value?: "strong",
) {
  return page.evaluate(
    ({ editorId, commandName, commandValue }) => (
      window.__MARKORA_BROWSER_LAB__!.command(
        editorId,
        commandName === "toggleMark"
          ? { type: "toggleMark", mark: commandValue! }
          : { type: commandName },
      )
    ),
    { commandName: command, commandValue: value, editorId: id },
  );
}

test("@required public embed options and dynamic DOM configuration stay state-preserving", async ({ labPage }) => {
  const id = "lifecycle-options";
  const labelId = `browser-lab-editor-label-${id}`;
  const initial = await mountEditor(labPage, {
    ariaLabel: "Configured Markdown editor",
    attributes: {
      "data-editor-mode": "draft",
      class: "configured-editor",
    },
    autofocus: true,
    id,
    initialSelection: "end",
    markdown: "alpha",
    placeholder: "Write something",
  });
  const editor = editorLocator(labPage, id);

  expect(initial.activeElement).toBe("prosemirror");
  expect(initial.prosemirrorFocused).toBe(true);
  expect(initial.selection).toEqual({ anchor: 6, from: 6, head: 6, to: 6 });
  await expect(editor).toHaveAttribute("role", "textbox");
  await expect(editor).toHaveAttribute("aria-multiline", "true");
  await expect(editor).toHaveAttribute("aria-readonly", "false");
  await expect(editor).toHaveAttribute("aria-label", "Configured Markdown editor");
  await expect(editor).toHaveAttribute("aria-placeholder", "Write something");
  await expect(editor).toHaveAttribute("data-editor-mode", "draft");
  await expect(editor).toHaveClass(/configured-editor/);

  expect(await resetEditor(labPage, id, "")).toBe("");
  await expect(editor.locator(".mdw-placeholder")).toHaveAttribute("data-placeholder", "Write something");

  const updated = await updateEditorOptions(labPage, id, {
    ariaLabel: null,
    ariaLabelledBy: labelId,
    attributes: null,
    placeholder: null,
  });
  expect(updated.statePreserved).toBe(true);
  await expect(editor).not.toHaveAttribute("aria-label");
  await expect(editor).toHaveAttribute("aria-labelledby", labelId);
  await expect(editor).not.toHaveAttribute("aria-placeholder");
  await expect(editor).not.toHaveAttribute("data-editor-mode");
  expect(await editor.evaluate((element) => element.classList.contains("configured-editor"))).toBe(false);
  await expect(editor.locator(".mdw-placeholder")).toHaveCount(0);
});

test("@required composite focus and typed selection/update subscriptions have deterministic boundaries", async ({ labPage }) => {
  const id = "lifecycle-events";
  await mountEditor(labPage, {
    id,
    markdown: ["before", "", "```text", "code", "```"].join("\n"),
  });
  await clearEditorEvents(labPage, id);

  await focusEditor(labPage, id, "start");
  await settleEditor(labPage, id);
  await blurEditor(labPage, id);
  await settleEditor(labPage, id);

  let events = await getEditorEvents(labPage, id);
  expect(events.counts.focus).toBe(1);
  expect(events.counts.blur).toBe(1);

  await focusEditor(labPage, id, "start");
  await settleEditor(labPage, id);
  await editorLocator(labPage, id).locator(".cm-content").click();
  await settleEditor(labPage, id);

  events = await getEditorEvents(labPage, id);
  expect(events.counts.focus).toBe(2);
  expect(events.counts.blur).toBe(1);

  await labPage.locator(`[data-e2e-output="${id}"]`).click();
  await settleEditor(labPage, id);
  events = await getEditorEvents(labPage, id);
  expect(events.counts.focus).toBe(2);
  expect(events.counts.blur).toBe(2);
  expect(events.log.filter(({ type }) => type === "focus" || type === "blur").map(({ type }) => type))
    .toEqual(["focus", "blur", "focus", "blur"]);

  await clearEditorEvents(labPage, id);
  expect(await selectText(labPage, id, "before")).toBe(true);
  events = await getEditorEvents(labPage, id);
  expect(events.counts.selection).toBe(1);
  expect(events.counts.update).toBe(0);
  expect(events.log.find(({ type }) => type === "selection")?.selection).toMatchObject({
    empty: false,
    from: 1,
    kind: "text",
    to: 7,
  });

  expect(await unsubscribeEditorEvent(labPage, id, "selection")).toBe(true);
  expect(await unsubscribeEditorEvent(labPage, id, "selection")).toBe(false);
  expect(await selectText(labPage, id, "before", "end")).toBe(true);
  await labPage.keyboard.type("!");
  await settleEditor(labPage, id);
  events = await getEditorEvents(labPage, id);
  expect(events.counts.selection).toBe(1);
  expect(events.counts.update).toBe(1);

  expect(await unsubscribeEditorEvent(labPage, id, "update")).toBe(true);
  await labPage.keyboard.type("?");
  await settleEditor(labPage, id);
  events = await getEditorEvents(labPage, id);
  expect(events.counts.update).toBe(1);
  expect(events.counts.error).toBe(0);
  expect(await getMarkdown(labPage, id)).toBe(["before!?", "", "```text", "code", "```"].join("\n"));
});

test("@required dynamic read-only mode covers ProseMirror, CodeMirror, tasks, commands, copy, and history", async ({ labPage }) => {
  const id = "lifecycle-readonly";
  const initialMarkdown = [
    "alpha",
    "",
    "```text",
    "code",
    "```",
    "",
    "* [ ] task",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: initialMarkdown });
  const editor = editorLocator(labPage, id);
  const code = editor.locator(".cm-content");
  const task = editor.locator('[data-mdw-task-control="true"]');

  await editor.locator("p").first().click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type("!");
  await settleEditor(labPage, id);
  const editedMarkdown = initialMarkdown.replace("alpha", "alpha!");
  expect(await getMarkdown(labPage, id)).toBe(editedMarkdown);

  const readonly = await updateEditorOptions(labPage, id, { editable: false });
  expect(readonly.statePreserved).toBe(true);
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect(code).toHaveAttribute("contenteditable", "false");
  await expect(code).toHaveAttribute("aria-readonly", "true");
  await expect(task).toHaveAttribute("aria-disabled", "true");

  await editor.focus();
  await labPage.keyboard.type("BLOCKED");
  await code.click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type("BLOCKED");
  await task.evaluate((element) => (element as HTMLElement).click());
  expect(await selectText(labPage, id, "alpha!")).toBe(true);
  expect(await runCommand(labPage, id, "toggleMark", "strong")).toBe(false);
  expect(await runCommand(labPage, id, "undo")).toBe(false);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(editedMarkdown);
  expect((await snapshotEditor(labPage, id)).selection).toMatchObject({ from: 1, to: 7 });

  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.plain).toBe("alpha!");

  const editable = await updateEditorOptions(labPage, id, { editable: true });
  expect(editable.statePreserved).toBe(true);
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(code).toHaveAttribute("contenteditable", "true");
  await expect(task).not.toHaveAttribute("aria-disabled", "true");
  await expect(task).toHaveAttribute("tabindex", "0");
  expect(await runCommand(labPage, id, "undo")).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(initialMarkdown);

  await editor.locator("p").first().click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type("?");
  await code.click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type("!");
  await task.click();
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "alpha?",
    "",
    "```text",
    "code!",
    "```",
    "",
    "* [x] task",
  ].join("\n"));

  expect((await updateEditorOptions(labPage, id, { editable: false })).statePreserved).toBe(true);
  expect(await resetEditor(labPage, id, "external replacement")).toBe("external replacement");
});

test("@required read-only reconciliation constructs a disabled native task control", async ({ labPage }) => {
  const id = "lifecycle-readonly-reconciled-task";
  await mountEditor(labPage, {
    editable: false,
    id,
    markdown: "ordinary",
  });

  const reconciled = await reconcileEditor(labPage, id, "* [ ] inserted while read-only");
  expect(reconciled.changed).toBe(true);
  const task = editorLocator(labPage, id).getByRole("checkbox", {
    name: "inserted while read-only",
  });
  await expect(task).toHaveAttribute("type", "button");
  await expect(task).toHaveAttribute("aria-disabled", "true");
  await expect(task).toHaveAttribute("tabindex", "-1");
  await expect(task).toBeDisabled();

  const beforeClick = await snapshotEditor(labPage, id);
  await task.evaluate((element) => (element as HTMLButtonElement).click());
  await settleEditor(labPage, id);
  const afterClick = await snapshotEditor(labPage, id);
  expect(afterClick.transactionCount).toBe(beforeClick.transactionCount);
  expect(afterClick.markdown).toBe("* [ ] inserted while read-only");

  expect((await updateEditorOptions(labPage, id, { editable: true })).statePreserved).toBe(true);
  await expect(task).toBeEnabled();
  await expect(task).toHaveAttribute("aria-disabled", "false");
  await expect(task).toHaveAttribute("tabindex", "0");
});

test("@required reconciled external updates preserve caret, focus, history, and controlled-host boundaries", async ({ labPage }) => {
  const id = "lifecycle-reconcile";
  await mountEditor(labPage, {
    controlledEcho: true,
    id,
    markdown: "alpha\n\ncaret",
  });
  const editor = editorLocator(labPage, id);

  await editor.locator("p").first().click();
  await labPage.keyboard.press("End");
  const beforeTyping = await snapshotEditor(labPage, id);
  await labPage.keyboard.insertText("!");
  await settleEditor(labPage, id);
  const typed = await snapshotEditor(labPage, id);

  expect(typed.markdown).toBe("alpha!\n\ncaret");
  expect(typed.transactionCount).toBe(beforeTyping.transactionCount + 1);
  expect(typed.changeCount).toBe(beforeTyping.changeCount + 1);

  expect(await selectText(labPage, id, "caret", "end")).toBe(true);
  const beforeExternal = await snapshotEditor(labPage, id);
  const external = await reconcileEditor(labPage, id, "prefix\n\nalpha!\n\ncaret");

  expect(external.changed).toBe(true);
  expect(external.snapshot.markdown).toBe("prefix\n\nalpha!\n\ncaret");
  expect(external.snapshot.transactionCount).toBe(beforeExternal.transactionCount + 1);
  expect(external.snapshot.changeCount).toBe(beforeExternal.changeCount);
  expect(external.snapshot.activeElement).toBe("prosemirror");
  expect(external.snapshot.prosemirrorFocused).toBe(true);
  expect(external.snapshot.selection).toEqual({
    anchor: beforeExternal.selection.anchor + 8,
    from: beforeExternal.selection.from + 8,
    head: beforeExternal.selection.head + 8,
    to: beforeExternal.selection.to + 8,
  });

  expect(await runCommand(labPage, id, "undo")).toBe(true);
  await settleEditor(labPage, id);
  const undone = await snapshotEditor(labPage, id);
  expect(undone.markdown).toBe("prefix\n\nalpha\n\ncaret");
  expect(undone.transactionCount).toBe(external.snapshot.transactionCount + 1);
  expect(undone.changeCount).toBe(external.snapshot.changeCount + 1);

  const equivalent = await reconcileEditor(labPage, id, "prefix\n\nalpha\n\ncaret");
  expect(equivalent.changed).toBe(false);
  expect(equivalent.snapshot.transactionCount).toBe(undone.transactionCount);
  expect(equivalent.snapshot.changeCount).toBe(undone.changeCount);

  expect(await selectText(labPage, id, "alpha", "end")).toBe(true);
  await labPage.keyboard.insertText("?");
  await settleEditor(labPage, id);
  const beforeReset = await snapshotEditor(labPage, id);
  expect(beforeReset.markdown).toBe("prefix\n\nalpha?\n\ncaret");

  expect(await resetEditor(labPage, id, "hard reset")).toBe("hard reset");
  const reset = await snapshotEditor(labPage, id);
  expect(reset.selection).toEqual({ anchor: 1, from: 1, head: 1, to: 1 });
  expect(reset.transactionCount).toBe(beforeReset.transactionCount);
  expect(reset.changeCount).toBe(beforeReset.changeCount + 1);
  expect(await runCommand(labPage, id, "undo")).toBe(false);
});

test("@required destroy is idempotent and remounts into the identical retained host", async ({ labPage }) => {
  const id = "lifecycle-remount";
  await mountEditor(labPage, { id, markdown: "alpha" });
  const host = labPage.locator(`[data-e2e-host="${id}"]`);
  await host.evaluate((element) => {
    element.setAttribute("data-retained-host-token", "original");
  });
  expect((await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.listenerSnapshot(editorId)
  ), id)).total).toBeGreaterThan(0);

  expect(await destroyEditorOnly(labPage, id)).toBe(true);
  await settleEditor(labPage, id);
  expect(await isEditorDestroyed(labPage, id)).toBe(true);
  await expect(host).toHaveAttribute("data-retained-host-token", "original");
  await expect(host).not.toHaveClass(/mdw-host/);
  await expect(host.locator(".ProseMirror")).toHaveCount(0);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.listenerSnapshot(editorId)
  ), id)).toEqual({ total: 0, byTargetAndType: {} });

  expect(await destroyEditorOnly(labPage, id)).toBe(false);
  const remounted = await remountEditor(labPage, id, {
    ariaLabel: "Remounted Markdown editor",
    markdown: "beta",
  });
  expect(remounted.markdown).toBe("beta");
  expect(await isEditorDestroyed(labPage, id)).toBe(false);
  await expect(host).toHaveAttribute("data-retained-host-token", "original");
  await expect(host).toHaveClass(/mdw-host/);
  await expect(host.locator(".ProseMirror")).toHaveCount(1);
  await expect(editorLocator(labPage, id)).toHaveAttribute("aria-label", "Remounted Markdown editor");
});
