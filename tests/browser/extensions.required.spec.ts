import AxeBuilder from "@axe-core/playwright";
import {
  copyEditorSelection,
  dispatchTransfer,
  destroyEditorOnly,
  editorLocator,
  expect,
  focusEditor,
  getExtensionSnapshot,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const EXTERNAL_MARKDOWN = [
  ":::warning Release",
  "Ship carefully today.",
  ":::",
  "",
  "A ==bright== signal.",
].join("\n");

const NORMALIZED_EXTERNAL_MARKDOWN = [
  ":::warning Release",
  "Ship carefully today.",
  "",
  ":::",
  "",
  "A ==bright== signal.",
].join("\n");

test("@required public extensions parse, render, edit, serialize, handle keys, and clean up", async ({ labPage }) => {
  const id = "public-extensions";
  await mountEditor(labPage, {
    extensionMode: "public-example",
    id,
    markdown: EXTERNAL_MARKDOWN,
  });

  const editor = editorLocator(labPage, id);
  const callout = editor.locator("[data-demo-callout-node-view=true]");
  await expect(callout).toHaveRole("note");
  await expect(callout).toHaveAccessibleName("warning callout: Release");
  await expect(callout).toContainText("Ship carefully today.");
  await expect(editor.locator("mark[data-demo-highlight=true]")).toHaveText("bright");
  expect(await getMarkdown(labPage, id)).toBe(NORMALIZED_EXTERNAL_MARKDOWN);

  const initialExtensions = await getExtensionSnapshot(labPage, id);
  expect(initialExtensions.manifest).toEqual(expect.arrayContaining([
    { name: "@markora-demo/callout", version: "1.0.0" },
    { name: "@markora-demo/highlight", version: "1.0.0" },
  ]));
  expect(initialExtensions.uiActions).toEqual([{
    defaultLabel: "Wrap selection in warning callout",
    group: "blocks",
    id: "@markora-demo/callout/wrap-warning",
  }]);
  expect(initialExtensions.calloutLifecycle).toEqual({
    cleanupRuns: 0,
    commandRuns: 0,
    nodeViewDestroys: 0,
    setupActive: true,
    setupRuns: 1,
  });

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "today.", "end"),
    id,
  )).toBe(true);
  await labPage.keyboard.type(" now");
  await settleEditor(labPage, id);
  await expect(callout).toContainText("Ship carefully today. now");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "carefully"),
    id,
  )).toBe(true);
  await labPage.keyboard.press("Control+Shift+h");
  await settleEditor(labPage, id);
  await expect(callout.locator("mark[data-demo-highlight=true]")).toHaveText("carefully");
  expect(await getMarkdown(labPage, id)).toContain("Ship ==carefully== today. now");

  expect(await destroyEditorOnly(labPage, id)).toBe(true);
  const destroyedExtensions = await getExtensionSnapshot(labPage, id);
  expect(destroyedExtensions.calloutLifecycle).toEqual({
    cleanupRuns: 1,
    commandRuns: 0,
    nodeViewDestroys: 1,
    setupActive: false,
    setupRuns: 1,
  });
  await expect(labPage.getByRole("button", { name: "Wrap selection in warning callout" })).toBeDisabled();
});

test("@required public extension nodes and marks round-trip through clipboard Markdown", async ({ labPage }) => {
  const id = "extension-clipboard-roundtrip";
  await mountEditor(labPage, {
    extensionMode: "public-example",
    id,
    initialSelection: "all",
    markdown: EXTERNAL_MARKDOWN,
  });

  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe(NORMALIZED_EXTERNAL_MARKDOWN);
  expect(copied.html).toContain('data-demo-callout="warning"');
  expect(copied.html).toContain('data-demo-highlight="true"');

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  expect(await runEditorCommand(labPage, id, {
    type: "pasteMarkdown",
    text: copied.markdown,
  })).toBe(true);
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator("[data-demo-callout-node-view=true]")).toContainText("Ship carefully today.");
  await expect(editor.locator("mark[data-demo-highlight=true]")).toHaveText("bright");
  expect(await getMarkdown(labPage, id)).toBe(NORMALIZED_EXTERNAL_MARKDOWN);
});

test("@required contributed NodeView and host-rendered UI action are accessible and keyboard operable", async ({ labPage }) => {
  const id = "extension-accessibility";
  await mountEditor(labPage, {
    extensionMode: "public-example",
    id,
    markdown: "Wrap this paragraph.",
  });

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Wrap this paragraph."),
    id,
  )).toBe(true);

  const toolbar = labPage.getByRole("toolbar", { name: `${id} extension actions` });
  const action = toolbar.getByRole("button", { name: "Wrap selection in warning callout" });
  await expect(toolbar).toBeVisible();
  await expect(action).toBeEnabled();
  const actionBox = await action.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.height).toBeGreaterThanOrEqual(44);

  await action.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).getByRole("note", {
    name: "warning callout: Deploy",
  })).toContainText("Wrap this paragraph.");
  expect(await getMarkdown(labPage, id)).toBe([
    ":::warning Deploy",
    "Wrap this paragraph.",
    "",
    ":::",
  ].join("\n"));
  expect((await getExtensionSnapshot(labPage, id)).calloutLifecycle?.commandRuns).toBe(1);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  const violations = results.violations.map(({ id: rule, impact, nodes }) => ({
    impact,
    nodes: nodes.map((node) => node.target),
    rule,
  }));
  expect(violations).toEqual([]);
});

test("@required clipboard contributions reach active and passive code with exact surface policy", async ({ labPage }) => {
  const passiveId = "extension-passive-clipboard";
  await mountEditor(labPage, {
    extensionMode: "public-example",
    id: passiveId,
    markdown: "```text\ncode-start\n```",
  });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "code-start", "end"),
    passiveId,
  )).toBe(true);
  const passivePaste = await dispatchTransfer(labPage, passiveId, {
    event: "paste",
    plain: " NESTEDCLIPBOARDINPUT BOTHCLIPBOARDINPUT",
    target: "static-code",
  });
  expect(passivePaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, passiveId);
  expect(await getMarkdown(labPage, passiveId)).toBe([
    "```text",
    "code-start nested-then-both-output both-clipboard-output",
    "```",
  ].join("\n"));

  const id = "extension-nested-clipboard";
  await mountEditor(labPage, {
    extensionMode: "public-example",
    id,
    markdown: [
      "outer-start",
      "",
      "```text",
      "code-start",
      "```",
    ].join("\n"),
  });

  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await labPage.keyboard.press("End");
  const nestedPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: " NESTEDCLIPBOARDINPUT BOTHCLIPBOARDINPUT",
    target: "code-mirror",
  });
  expect(nestedPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "outer-start",
    "",
    "```text",
    "code-start nested-then-both-output both-clipboard-output",
    "```",
  ].join("\n"));

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "outer-start", "end"),
    id,
  )).toBe(true);
  const outerPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: " NESTEDCLIPBOARDINPUT BOTHCLIPBOARDINPUT",
  });
  expect(outerPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  const editableMarkdown = [
    "outer-start NESTEDCLIPBOARDINPUT both-clipboard-output",
    "",
    "```text",
    "code-start nested-then-both-output both-clipboard-output",
    "```",
  ].join("\n");
  expect(await getMarkdown(labPage, id)).toBe(editableMarkdown);

  const nestedDrop = await dispatchTransfer(labPage, id, {
    event: "drop",
    plain: "drop:NESTEDCLIPBOARDINPUT:BOTHCLIPBOARDINPUT",
    target: "code-mirror",
  });
  expect(nestedDrop.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  const droppedMarkdown = await getMarkdown(labPage, id);
  expect(droppedMarkdown).toContain(
    "drop:nested-then-both-output:both-clipboard-output",
  );
  expect(droppedMarkdown).not.toContain("drop:NESTEDCLIPBOARDINPUT");

  await updateEditorOptions(labPage, id, { editable: false });
  await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: " BOTHCLIPBOARDINPUT",
    target: "code-mirror",
  });
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(droppedMarkdown);

  await updateEditorOptions(labPage, id, { editable: true });
  const filePaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    files: [{ contents: "unsafe", name: "unsafe.txt", type: "text/plain" }],
    plain: " NESTEDCLIPBOARDINPUT BOTHCLIPBOARDINPUT",
    target: "code-mirror",
  });
  expect(filePaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(droppedMarkdown);
});
