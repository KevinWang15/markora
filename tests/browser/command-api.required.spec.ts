import {
  canRunEditorCommand,
  clearEditorEvents,
  editorLocator,
  expect,
  getEditorActiveState,
  getEditorEvents,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

test("@required host block, list, and task commands preserve focus, history, and state events", async ({ labPage }) => {
  const id = "command-block-list";
  await mountEditor(labPage, {
    id,
    markdown: "alpha\n\nbeta",
  });
  const editor = editorLocator(labPage, id);
  const output = labPage.locator(`[data-e2e-output="${id}"]`);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);
  await output.focus();
  await clearEditorEvents(labPage, id);
  expect(await canRunEditorCommand(labPage, id, { type: "setHeading", level: 2 })).toBe(true);
  expect((await getEditorEvents(labPage, id)).counts.state).toBe(0);
  expect(await runEditorCommand(labPage, id, { type: "setHeading", level: 2 })).toBe(true);
  await settleEditor(labPage, id);

  await expect(editor.locator("h2")).toContainText("alpha");
  await expect(editor).toBeFocused();
  expect(await getEditorActiveState(labPage, id, { type: "heading", level: 2 })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("## alpha\n\nbeta");
  let events = await getEditorEvents(labPage, id);
  expect(events.counts.state).toBe(1);
  expect(events.counts.update).toBe(1);
  expect(events.log.find(({ type }) => type === "state")).toMatchObject({
    docChanged: true,
    selectionChanged: false,
    type: "state",
  });

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha\n\nbeta");
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("## alpha\n\nbeta");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
    id,
  )).toBe(true);
  await output.focus();
  expect(await runEditorCommand(labPage, id, { type: "toggleBulletList" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "toggleTaskList" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "setTaskChecked", checked: true })).toBe(true);
  await settleEditor(labPage, id);

  const task = editor.locator('li[data-task="true"]');
  await expect(task).toContainText("beta");
  await expect(task.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  expect(await getEditorActiveState(labPage, id, { type: "taskList" })).toBe(true);
  expect(await getEditorActiveState(labPage, id, { type: "taskChecked" })).toBe(true);
  await expect(editor).toBeFocused();

  const editableMarkdown = await getMarkdown(labPage, id);
  await updateEditorOptions(labPage, id, { editable: false });
  await output.focus();
  expect(await canRunEditorCommand(labPage, id, { type: "toggleOrderedList" })).toBe(false);
  expect(await runEditorCommand(labPage, id, { type: "toggleOrderedList" })).toBe(false);
  expect(await output).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe(editableMarkdown);

  events = await getEditorEvents(labPage, id);
  expect(events.counts.error).toBe(0);
});

test("@required code-block commands cross the ProseMirror and CodeMirror focus boundary", async ({ labPage }) => {
  const id = "command-code";
  await mountEditor(labPage, { id, markdown: "const value = 1" });
  const editor = editorLocator(labPage, id);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "value", "end"),
    id,
  )).toBe(true);
  expect(await canRunEditorCommand(labPage, id, {
    type: "setCodeBlock",
    options: { language: "ts" },
  })).toBe(true);
  expect(await runEditorCommand(labPage, id, {
    type: "setCodeBlock",
    options: { language: "ts" },
  })).toBe(true);
  await settleEditor(labPage, id);

  const codeMirror = editor.locator(".cm-content");
  await expect(codeMirror).toContainText("const value = 1");
  expect(await getEditorActiveState(labPage, id, {
    type: "codeBlock",
    options: { language: "ts" },
  })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("```ts\nconst value = 1\n```");

  await codeMirror.click();
  await expect(codeMirror).toBeFocused();
  expect(await runEditorCommand(labPage, id, { type: "setParagraph" })).toBe(true);
  await settleEditor(labPage, id);

  await expect(editor.locator(".cm-editor")).toHaveCount(0);
  await expect(editor.locator("p")).toHaveText("const value = 1");
  await expect(editor).toBeFocused();
  expect(await getEditorActiveState(labPage, id, { type: "paragraph" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("const value = 1");
});

test("@required table commands create accessible, round-trippable structures without built-in UI", async ({ labPage }) => {
  const id = "command-table";
  await mountEditor(labPage, { id, markdown: "before" });
  const editor = editorLocator(labPage, id);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "before", "end"),
    id,
  )).toBe(true);
  expect(await runEditorCommand(labPage, id, {
    type: "insertTable",
    options: { columns: 2, rows: 2 },
  })).toBe(true);
  await settleEditor(labPage, id);

  const table = editor.locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("th")).toHaveCount(2);
  await expect(table.locator("td")).toHaveCount(2);
  await expect(table.locator("th").first()).toHaveAttribute("scope", "col");
  expect(await getEditorActiveState(labPage, id, { type: "table" })).toBe(true);
  expect(await canRunEditorCommand(labPage, id, { type: "addTableRow" })).toBe(true);

  await table.locator("th p").first().click();
  await labPage.keyboard.type("Head");
  expect(await runEditorCommand(labPage, id, {
    type: "setTableColumnAlignment",
    alignment: "center",
  })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "addTableColumn" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "addTableRow" })).toBe(true);
  await settleEditor(labPage, id);

  await expect(table.locator("th")).toHaveCount(3);
  await expect(table.locator("tr")).toHaveCount(3);
  expect(await getEditorActiveState(labPage, id, {
    type: "tableColumnAlignment",
    alignment: "center",
  })).toBe(true);
  const serialized = await getMarkdown(labPage, id);
  expect(serialized).toContain("Head");
  expect(serialized).toContain(":---:");

  await resetEditor(labPage, id, serialized);
  await settleEditor(labPage, id);
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("th")).toHaveCount(3);
  expect(await getMarkdown(labPage, id)).toBe(serialized);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Head", "end"),
    id,
  )).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "deleteTable" })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("table")).toHaveCount(0);
  await expect(editor).toBeFocused();
});
