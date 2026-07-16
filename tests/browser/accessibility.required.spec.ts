import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  copyEditorSelection,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function openImageEditor(page: Page, id: string) {
  const editor = editorLocator(page, id);
  await editor.locator(".mdw-image img").click({ force: true });
  await settleEditor(page, id);
  expect(await page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "image"), id))
    .toBe(true);
  const dialog = ownedOverlay(page, id, ".mdw-image-editor");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openLinkEditor(page: Page, id: string, text = "Docs") {
  const selected = await page.evaluate(
    ({ editorId, needle }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "start"),
    { editorId: id, needle: text },
  );
  expect(selected).toBe(true);
  expect(await page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"), id))
    .toBe(true);
  const dialog = ownedOverlay(page, id, ".mdw-link-editor");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function dispatchComposingKey(target: Locator, key: "Enter" | "Escape") {
  return target.evaluate((element, nextKey) => {
    const ownerWindow = element.ownerDocument.defaultView!;
    const event = new ownerWindow.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: nextKey,
    });
    Object.defineProperty(event, "isComposing", { configurable: true, value: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, key);
}

async function platformModifier(page: Page) {
  return page.evaluate(() => (/Mac|iPhone|iPad/i.test(navigator.platform) ? "Meta" : "Control"));
}

test("@required task controls are named, touch-sized, keyboard operable, and undoable", async ({ labPage }) => {
  const id = "task-accessibility";
  const markdown = "* [ ] Ship the release\n* [ ] Publish the notes";
  await mountEditor(labPage, { id, markdown });
  const editor = editorLocator(labPage, id);
  const tasks = editor.locator("li[data-task=true]");
  const task = tasks.first();
  const checkboxes = tasks.locator("[data-mdw-task-control=true]");
  const checkbox = checkboxes.first();
  const secondCheckbox = checkboxes.nth(1);

  await expect(task).not.toHaveAttribute("role", "checkbox");
  await expect(checkbox).toHaveAttribute("role", "checkbox");
  await expect(checkbox).toHaveAttribute("type", "button");
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(checkbox).toHaveAttribute("aria-disabled", "false");
  await expect(checkbox).toHaveAccessibleName(/Ship the release/i);
  expect(await checkbox.evaluate((element) => element.tagName)).toBe("BUTTON");

  const box = await checkbox.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  const nextHostFocusTarget = labPage.locator(`[data-e2e-output="${id}"]`);
  await secondCheckbox.focus();
  await labPage.keyboard.press("Tab");
  await expect(nextHostFocusTarget).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  await expect(editor.locator("li[data-task=true] li[data-task=true]")).toHaveCount(0);

  await labPage.keyboard.press("Shift+Tab");
  await expect(secondCheckbox).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe(markdown);

  await checkbox.focus();
  const beforeSpace = await snapshotEditor(labPage, id);
  await labPage.keyboard.press("Space");
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(checkbox).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("* [x] Ship the release\n* [ ] Publish the notes");
  const afterSpace = await snapshotEditor(labPage, id);
  expect(afterSpace.transactionCount).toBe(beforeSpace.transactionCount + 1);
  expect(afterSpace.selection).toEqual(beforeSpace.selection);

  const modifier = await platformModifier(labPage);
  await labPage.keyboard.press(`${modifier}+z`);
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(checkbox).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe(markdown);

  await labPage.keyboard.press(`Shift+${modifier}+z`);
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(checkbox).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("* [x] Ship the release\n* [ ] Publish the notes");

  const beforeEnter = await snapshotEditor(labPage, id);
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(checkbox).toBeFocused();
  const afterEnter = await snapshotEditor(labPage, id);
  expect(afterEnter.transactionCount).toBe(beforeEnter.transactionCount + 1);
  expect(afterEnter.selection).toEqual(beforeEnter.selection);

  const beforeAssistiveClick = await snapshotEditor(labPage, id);
  await checkbox.evaluate((element) => (element as HTMLButtonElement).click());
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(checkbox).toBeFocused();
  const afterAssistiveClick = await snapshotEditor(labPage, id);
  expect(afterAssistiveClick.transactionCount).toBe(beforeAssistiveClick.transactionCount + 1);

  const hostButton = labPage.locator("[data-ee016-task-host-focus]");
  const beforeHostHandoff = await snapshotEditor(labPage, id);
  await checkbox.evaluate((element) => {
    const doc = element.ownerDocument;
    const hostControl = doc.createElement("button");
    hostControl.type = "button";
    hostControl.dataset.ee016TaskHostFocus = "true";
    hostControl.textContent = "Host focus target";
    doc.body.append(hostControl);
    doc.addEventListener("click", () => hostControl.focus(), { capture: true, once: true });
    (element as HTMLButtonElement).click();
  });
  await settleEditor(labPage, id);
  await expect(hostButton).toBeFocused();
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  const afterHostHandoff = await snapshotEditor(labPage, id);
  expect(afterHostHandoff.transactionCount).toBe(beforeHostHandoff.transactionCount + 1);
  expect(afterHostHandoff.selection).toEqual(beforeHostHandoff.selection);

  await checkbox.focus();
  const beforeRepeatedEnter = await snapshotEditor(labPage, id);
  await labPage.keyboard.down("Enter");
  await settleEditor(labPage, id);
  const afterInitialEnter = await snapshotEditor(labPage, id);
  expect(afterInitialEnter.transactionCount).toBe(beforeRepeatedEnter.transactionCount + 1);
  await labPage.keyboard.down("Enter");
  await settleEditor(labPage, id);
  const afterRepeatedEnter = await snapshotEditor(labPage, id);
  expect(afterRepeatedEnter.transactionCount).toBe(afterInitialEnter.transactionCount);
  expect(afterRepeatedEnter.markdown).toBe(afterInitialEnter.markdown);
  await labPage.keyboard.up("Enter");
});

test("@required link dialog is non-modal, validates, preserves selection, and restores focus safely", async ({ labPage }) => {
  const id = "link-dialog-contract";
  await mountEditor(labPage, { id, markdown: "Read [Docs](/before) today." });
  const editor = editorLocator(labPage, id);
  const dialog = await openLinkEditor(labPage, id);
  const input = dialog.getByLabel("Link URL");

  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(dialog).toHaveAccessibleName("Edit link");
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => ({
    end: (element as HTMLInputElement).selectionEnd,
    start: (element as HTMLInputElement).selectionStart,
    value: (element as HTMLInputElement).value,
  }))).toEqual({ end: 7, start: 0, value: "/before" });
  const selectionBefore = (await snapshotEditor(labPage, id)).selection;

  await input.fill("javascript:alert(1)");
  await labPage.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await snapshotEditor(labPage, id)).selection).toEqual(selectionBefore);

  await labPage.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(editor).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("Read [Docs](/before) today.");
  expect((await snapshotEditor(labPage, id)).selection).toEqual(selectionBefore);

  const saveDialog = await openLinkEditor(labPage, id);
  const saveSelectionBefore = (await snapshotEditor(labPage, id)).selection;
  const saveInput = saveDialog.getByLabel("Link URL");
  await saveInput.fill("/after");
  await expect(saveInput).not.toHaveAttribute("aria-invalid", "true");
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(saveDialog).toBeHidden();
  await expect(editor).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("Read [Docs](/after) today.");
  expect((await snapshotEditor(labPage, id)).selection).toEqual(saveSelectionBefore);

  const reopened = await openLinkEditor(labPage, id);
  const hostButton = labPage.locator("[data-ee016-dialog-host-focus]");
  await reopened.getByLabel("Link URL").evaluate((element) => {
    const doc = element.ownerDocument;
    const hostControl = doc.createElement("button");
    hostControl.type = "button";
    hostControl.dataset.ee016DialogHostFocus = "true";
    hostControl.textContent = "Host dialog focus target";
    doc.body.append(hostControl);
    doc.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        hostControl.focus();
      }
    }, { capture: true, once: true });
  });
  await labPage.keyboard.press("Escape");
  await expect(reopened).toBeHidden();
  await expect(hostButton).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("Read [Docs](/after) today.");

  const outsideDialog = await openLinkEditor(labPage, id);
  await hostButton.click();
  await expect(outsideDialog).toBeHidden();
  await expect(editor).not.toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("Read [Docs](/after) today.");

  const unlinkDialog = await openLinkEditor(labPage, id);
  const unlinkSelectionBefore = (await snapshotEditor(labPage, id)).selection;
  await unlinkDialog.getByRole("button", { name: "Unlink" }).focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(unlinkDialog).toBeHidden();
  await expect(editor).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("Read Docs today.");
  expect((await snapshotEditor(labPage, id)).selection).toEqual(unlinkSelectionBefore);
});

test("@required overlay keys preserve native buttons and never submit an active composition", async ({ labPage }) => {
  const imageId = "image-keys";
  await mountEditor(labPage, {
    id: imageId,
    markdown: `![Original](${PIXEL_GIF})`,
  });
  let imageDialog = await openImageEditor(labPage, imageId);
  const imageUrlInput = imageDialog.getByLabel("Image URL");
  await expect(imageDialog).toHaveAttribute("aria-modal", "false");
  await expect(imageDialog).toHaveAccessibleName("Edit image");
  await expect(imageUrlInput).toBeFocused();
  expect(await imageUrlInput.evaluate((element) => ({
    end: (element as HTMLInputElement).selectionEnd,
    start: (element as HTMLInputElement).selectionStart,
  }))).toEqual({ end: PIXEL_GIF.length, start: 0 });
  await imageDialog.getByLabel("Alt text").fill("Must not save");
  expect(await dispatchComposingKey(imageDialog.getByLabel("Alt text"), "Enter")).toBe(false);
  expect(await dispatchComposingKey(imageDialog.getByLabel("Alt text"), "Escape")).toBe(false);
  await expect(imageDialog).toBeVisible();

  await imageDialog.getByRole("button", { name: "Cancel" }).focus();
  await labPage.keyboard.press("Enter");
  await expect(imageDialog).toBeHidden();
  expect(await getMarkdown(labPage, imageId)).toBe(`![Original](${PIXEL_GIF})`);

  imageDialog = await openImageEditor(labPage, imageId);
  await imageDialog.getByLabel("Alt text").fill("Updated alt");
  await imageDialog.getByLabel("Title").fill("Updated title");
  await imageDialog.getByLabel("Title").press("Enter");
  await settleEditor(labPage, imageId);
  await expect(imageDialog).toBeHidden();
  await expect(editorLocator(labPage, imageId)).toBeFocused();
  expect(await getMarkdown(labPage, imageId))
    .toBe(`![Updated alt](${PIXEL_GIF} "Updated title")`);

  imageDialog = await openImageEditor(labPage, imageId);
  await imageDialog.getByRole("button", { name: "Remove" }).focus();
  await labPage.keyboard.press("Enter");
  await expect(imageDialog).toBeHidden();
  await settleEditor(labPage, imageId);
  expect(await getMarkdown(labPage, imageId)).toBe("");

  const linkId = "link-keys";
  await mountEditor(labPage, { id: linkId, markdown: "[Docs](/before)" });
  const linkDialog = await openLinkEditor(labPage, linkId);
  await linkDialog.getByRole("button", { name: "Save" }).focus();
  await labPage.keyboard.press("Escape");
  await expect(linkDialog).toBeHidden();
  expect(await getMarkdown(labPage, linkId)).toBe("[Docs](/before)");
  await expect(editorLocator(labPage, linkId)).toBeFocused();
});

test("@required table toolbar exposes pressed state and roving keyboard focus", async ({ labPage }) => {
  const id = "table-keys";
  await mountEditor(labPage, {
    id,
    markdown: [
      "| A | B |",
      "| --- | --- |",
      "| one | two |",
    ].join("\n"),
  });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "two", "all"),
    id,
  )).toBe(true);
  const editor = editorLocator(labPage, id);
  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute("role", "toolbar");
  await expect(toolbar).toHaveAttribute("aria-orientation", "horizontal");
  await expect(toolbar).toHaveAccessibleName("Table controls");
  await expect(toolbar.getByRole("group", { name: "Column alignment" })).toBeVisible();
  expect((await copyEditorSelection(labPage, id)).plain).toBe("two");
  const selectionBeforeToolbarFocus = (await snapshotEditor(labPage, id)).selection;

  const buttons = toolbar.getByRole("button");
  await expect(buttons).toHaveCount(8);
  await expect(toolbar.locator("button[tabindex='0']")).toHaveCount(1);

  const firstButton = toolbar.locator("button[tabindex='0']");
  await firstButton.focus();
  await labPage.keyboard.press("ArrowRight");
  await expect(buttons.nth(1)).toBeFocused();
  await labPage.keyboard.press("ArrowLeft");
  await expect(buttons.first()).toBeFocused();
  await labPage.keyboard.press("ArrowLeft");
  await expect(buttons.last()).toBeFocused();
  await labPage.keyboard.press("End");
  await expect(buttons.last()).toBeFocused();
  await labPage.keyboard.press("Home");
  await expect(buttons.first()).toBeFocused();
  expect((await snapshotEditor(labPage, id)).selection).toEqual(selectionBeforeToolbarFocus);

  const alignCenter = toolbar.getByRole("button", { name: "Align center" });
  await alignCenter.focus();
  await labPage.keyboard.press("Space");
  await settleEditor(labPage, id);
  await expect(alignCenter).toHaveAttribute("aria-pressed", "true");
  await expect(alignCenter).toBeFocused();
  expect(await getMarkdown(labPage, id)).toContain("| --- | :---: |");

  const insertColumn = toolbar.getByRole("button", { name: "Insert column" });
  await insertColumn.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr").first().locator("th")).toHaveCount(3);
  await expect(insertColumn).toBeFocused();

  const deleteColumn = toolbar.getByRole("button", { name: "Delete column" });
  await deleteColumn.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr").first().locator("th")).toHaveCount(2);
  await expect(deleteColumn).toBeFocused();

  const insertRow = toolbar.getByRole("button", { name: "Insert row" });
  await insertRow.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr")).toHaveCount(3);
  await expect(insertRow).toBeFocused();

  const deleteRow = toolbar.getByRole("button", { name: "Delete row" });
  await deleteRow.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr")).toHaveCount(2);
  await expect(deleteRow).toBeFocused();

  await labPage.keyboard.press("Escape");
  await expect(editor).toBeFocused();

  await editor.locator("table td p").first().click();
  await expect(toolbar).toBeVisible();
  const deleteTable = toolbar.getByRole("button", { name: "Delete table" });
  await deleteTable.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(editor.locator("table")).toHaveCount(0);
  await expect(toolbar).toBeHidden();
  await expect(editor).toBeFocused();
});

test("@required task, dialog, and toolbar semantics remain keyboard complete in Shadow DOM", async ({ labPage }) => {
  const id = "shadow-accessibility";
  await mountEditor(labPage, {
    id,
    markdown: [
      "* [ ] Shadow task",
      "",
      "[Shadow docs](/shadow)",
      "",
      "| A | B |",
      "| --- | --- |",
      "| one | two |",
    ].join("\n"),
    portal: "default",
    root: "shadow",
  });

  const editor = editorLocator(labPage, id);
  const task = editor.getByRole("checkbox", { name: /Shadow task/i });
  await task.focus();
  await labPage.keyboard.press("Enter");
  await settleEditor(labPage, id);
  await expect(task).toHaveAttribute("aria-checked", "true");
  await expect(task).toBeFocused();

  const linkDialog = await openLinkEditor(labPage, id, "Shadow docs");
  expect(await linkDialog.evaluate((element) => element.getRootNode() instanceof ShadowRoot)).toBe(true);
  await expect(linkDialog).toHaveAttribute("aria-modal", "false");
  await expect(linkDialog.getByLabel("Link URL")).toBeFocused();
  await labPage.keyboard.press("Escape");
  await expect(linkDialog).toBeHidden();
  await expect(editor).toBeFocused();

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "two", "all"),
    id,
  )).toBe(true);
  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();
  expect(await toolbar.evaluate((element) => element.getRootNode() instanceof ShadowRoot)).toBe(true);
  const insertColumn = toolbar.getByRole("button", { name: "Insert column" });
  await insertColumn.focus();
  await labPage.keyboard.press("ArrowRight");
  await expect(toolbar.getByRole("button", { name: "Delete column" })).toBeFocused();
  await labPage.keyboard.press("Escape");
  await expect(editor).toBeFocused();
});

test("@required axe finds no automatic violations in the complete editor fixture", async ({ labPage }) => {
  const id = "axe";
  await mountEditor(labPage, {
    id,
    markdown: [
      "# Accessible fixture",
      "",
      "* [ ] Named task",
      "",
      "[Docs](/docs)",
      "",
      `![Pixel](${PIXEL_GIF})`,
      "",
      "| A | B |",
      "| --- | ---: |",
      "| one | two |",
      "",
      "```text",
      "code",
      "```",
      "",
      ":::note",
      "opaque source",
      ":::",
    ].join("\n"),
    portal: "local",
  });

  await editorLocator(labPage, id).locator("td p").last().click();
  await expect(ownedOverlay(labPage, id, ".mdw-table-toolbar")).toBeVisible();
  const results = await new AxeBuilder({ page: labPage }).analyze();
  const violations = results.violations.map(({ id: rule, impact, nodes }) => ({
    impact,
    nodes: nodes.map((node) => node.target),
    rule,
  }));
  expect(violations).toEqual([]);
});
