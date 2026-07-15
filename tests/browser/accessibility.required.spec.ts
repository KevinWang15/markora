import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
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

async function openLinkEditor(page: Page, id: string) {
  const selected = await page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Docs", "start"),
    id,
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
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(checkbox).toHaveAccessibleName(/Ship the release/i);

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
  await labPage.keyboard.press("Space");
  await settleEditor(labPage, id);
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(checkbox).toBeFocused();
  expect(await getMarkdown(labPage, id)).toBe("* [x] Ship the release\n* [ ] Publish the notes");

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
});

test("@required overlay keys preserve native buttons and never submit an active composition", async ({ labPage }) => {
  const imageId = "image-keys";
  await mountEditor(labPage, {
    id: imageId,
    markdown: `![Original](${PIXEL_GIF})`,
  });
  let imageDialog = await openImageEditor(labPage, imageId);
  await imageDialog.getByLabel("Alt text").fill("Must not save");
  expect(await dispatchComposingKey(imageDialog.getByLabel("Alt text"), "Enter")).toBe(false);
  expect(await dispatchComposingKey(imageDialog.getByLabel("Alt text"), "Escape")).toBe(false);
  await expect(imageDialog).toBeVisible();

  await imageDialog.getByRole("button", { name: "Cancel" }).focus();
  await labPage.keyboard.press("Enter");
  await expect(imageDialog).toBeHidden();
  expect(await getMarkdown(labPage, imageId)).toBe(`![Original](${PIXEL_GIF})`);

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
  await editorLocator(labPage, id).locator("td p").last().click();
  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();

  const buttons = toolbar.getByRole("button");
  await expect(buttons).toHaveCount(8);
  await expect(toolbar.locator("button[tabindex='0']")).toHaveCount(1);

  const firstButton = toolbar.locator("button[tabindex='0']");
  await firstButton.focus();
  await labPage.keyboard.press("End");
  await expect(buttons.last()).toBeFocused();
  await labPage.keyboard.press("Home");
  await expect(buttons.first()).toBeFocused();

  const alignCenter = toolbar.getByRole("button", { name: "Align center" });
  await alignCenter.focus();
  await labPage.keyboard.press("Space");
  await settleEditor(labPage, id);
  await expect(alignCenter).toHaveAttribute("aria-pressed", "true");
  await expect(alignCenter).toBeFocused();
  expect(await getMarkdown(labPage, id)).toContain("| --- | :---: |");

  await labPage.keyboard.press("Escape");
  await expect(editorLocator(labPage, id)).toBeFocused();
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
