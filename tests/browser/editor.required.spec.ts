import type { Locator, Page } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function expectMarkdown(page: Page, id: string, expected: string) {
  await settleEditor(page, id);
  expect(await getMarkdown(page, id)).toBe(expected);
}

async function focusTextblockEnd(page: Page, textblock: Locator) {
  await textblock.click();
  await page.keyboard.press("End");
}

async function platformModifier(page: Page) {
  return page.evaluate(() => (/Mac|iPhone|iPad/i.test(navigator.platform) ? "Meta" : "Control"));
}

test("@required lifecycle releases listeners and supports remounting", async ({ labPage }) => {
  const id = "lifecycle";
  await mountEditor(labPage, { id, markdown: "alpha" });

  const editor = editorLocator(labPage, id);
  await focusTextblockEnd(labPage, editor.locator("p"));
  await labPage.keyboard.type("!");
  await expectMarkdown(labPage, id, "alpha!");

  const mountedListeners = await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.listenerSnapshot(editorId),
    id,
  );
  expect(mountedListeners.total).toBeGreaterThan(0);

  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.destroy(editorId), id)).toBe(true);
  await settleEditor(labPage);
  await expect(editorLocator(labPage, id)).toHaveCount(0);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.listenerSnapshot(editorId),
    id,
  )).toEqual({ total: 0, byTargetAndType: {} });

  await mountEditor(labPage, { id, markdown: "beta" });
  const remounted = await snapshotEditor(labPage, id);
  expect(remounted.markdown).toBe("beta");
  expect(remounted.transactionCount).toBe(0);

  await focusTextblockEnd(labPage, editorLocator(labPage, id).locator("p"));
  await labPage.keyboard.type("!");
  await expectMarkdown(labPage, id, "beta!");
});

test("@required real typing applies heading, marks, and undoable history", async ({ labPage }) => {
  const id = "typing";
  await mountEditor(labPage, { id, markdown: "" });
  const editor = editorLocator(labPage, id);

  await editor.locator("p").click();
  await labPage.keyboard.type("# Heading");
  await labPage.keyboard.press("Enter");
  await labPage.keyboard.type("**bold**");
  await expectMarkdown(labPage, id, "# Heading\n\n**bold**");
  await expect(editor.locator("h1")).toHaveText("Heading");
  await expect(editor.locator("strong")).toHaveText("bold");

  const modifier = await platformModifier(labPage);
  expect(await resetEditor(labPage, id, "bold italic code strike")).toBe("bold italic code strike");

  for (const [text, shortcut] of [
    ["bold", `${modifier}+b`],
    ["italic", `${modifier}+i`],
    ["code", `${modifier}+e`],
    ["strike", `${modifier}+Shift+x`],
  ] as const) {
    expect(await labPage.evaluate(
      ({ editorId, needle }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "all"),
      { editorId: id, needle: text },
    )).toBe(true);
    await labPage.keyboard.press(shortcut);
  }
  await expectMarkdown(labPage, id, "**bold** *italic* `code` ~~strike~~");

  expect(await resetEditor(labPage, id, "history")).toBe("history");
  await focusTextblockEnd(labPage, editor.locator("p"));
  await labPage.keyboard.type("!");
  await expectMarkdown(labPage, id, "history!");

  await labPage.keyboard.press(`${modifier}+z`);
  await expectMarkdown(labPage, id, "history");
  await labPage.keyboard.press(`Shift+${modifier}+z`);
  await expectMarkdown(labPage, id, "history!");

  expect((await snapshotEditor(labPage, id)).transactionCount).toBeGreaterThan(0);
});

test("@required link, image, and task controls serialize exact Markdown", async ({ labPage }) => {
  const id = "media";
  const initial = [
    "[Docs](/old)",
    "",
    `![Original alt](${PIXEL_GIF})`,
    "",
    "* [ ] Todo",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: initial });
  const editor = editorLocator(labPage, id);

  await editor.locator("a").click();
  await settleEditor(labPage, id);
  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"), id)).toBe(true);
  const linkDialog = labPage.locator(`.mdw-link-editor[data-e2e-owner="${id}"]`);
  await expect(linkDialog).toBeVisible();
  await linkDialog.getByRole("textbox", { name: "Link URL" }).fill("/new");
  await linkDialog.getByRole("button", { name: "Save" }).click();

  const image = editor.locator(".mdw-image");
  await image.locator("img").click({ force: true });
  await settleEditor(labPage, id);
  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "image"), id)).toBe(true);
  const imageDialog = labPage.locator(`.mdw-image-editor[data-e2e-owner="${id}"]`);
  await expect(imageDialog).toBeVisible();
  await imageDialog.getByRole("textbox", { name: "Image URL" }).fill(PIXEL_GIF);
  await imageDialog.getByRole("textbox", { name: "Alt text" }).fill("Edited alt");
  await imageDialog.getByRole("textbox", { name: "Title" }).fill("Tiny");
  await imageDialog.getByRole("button", { name: "Save" }).click();

  const taskItem = editor.locator('li[data-task="true"]');
  await taskItem.locator('[data-mdw-task-control="true"]').click();
  await expectMarkdown(labPage, id, [
    "[Docs](/new)",
    "",
    `![Edited alt](${PIXEL_GIF} "Tiny")`,
    "",
    "* [x] Todo",
  ].join("\n"));
  await expect(taskItem.locator('[data-mdw-task-control="true"]')).toHaveAttribute("aria-checked", "true");
});

test("@required imported table editing and toolbar alignment retain content", async ({ labPage }) => {
  const id = "table";
  await mountEditor(labPage, {
    id,
    markdown: [
      "| Name | Status |",
      "| --- | --- |",
      "| Alpha | Draft |",
    ].join("\n"),
  });
  const editor = editorLocator(labPage, id);
  const statusCell = editor.locator("table tr").nth(1).locator("td").nth(1).locator("p");

  await focusTextblockEnd(labPage, statusCell);
  await labPage.keyboard.type(" Ready");
  await expectMarkdown(labPage, id, [
    "| Name | Status |",
    "| --- | --- |",
    "| Alpha | Draft Ready |",
  ].join("\n"));

  const toolbar = labPage.locator(`.mdw-table-toolbar[data-e2e-owner="${id}"]`);
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Align center" }).click();
  await expectMarkdown(labPage, id, [
    "| Name | Status |",
    "| --- | :---: |",
    "| Alpha | Draft Ready |",
  ].join("\n"));
});

test("@required CodeMirror editing and boundary exit stay synchronized", async ({ labPage }) => {
  const id = "code";
  await mountEditor(labPage, {
    id,
    markdown: [
      "before",
      "",
      "```",
      "const value = 1;",
      "```",
      "",
      "after",
    ].join("\n"),
  });
  const editor = editorLocator(labPage, id);
  const codeLine = editor.locator(".cm-line");

  await focusTextblockEnd(labPage, codeLine);
  await labPage.keyboard.type(" // edited");
  await expectMarkdown(labPage, id, [
    "before",
    "",
    "```",
    "const value = 1; // edited",
    "```",
    "",
    "after",
  ].join("\n"));

  await labPage.keyboard.press("ArrowDown");
  await settleEditor(labPage, id);
  const exited = await snapshotEditor(labPage, id);
  expect(exited.codeMirrorFocused).toBe(false);
  expect(exited.prosemirrorFocused).toBe(true);

  await labPage.keyboard.type("!");
  await expectMarkdown(labPage, id, [
    "before",
    "",
    "```",
    "const value = 1; // edited",
    "```",
    "",
    "!after",
  ].join("\n"));
});

test("@required code-block focus handoffs and replacement preserve document scroll", async ({ labPage }) => {
  const id = "code-scroll";
  const before = Array.from({ length: 18 }, (_, index) => `before-${index}`);
  const after = Array.from({ length: 18 }, (_, index) => `after-${index}`);
  const markdown = [
    before.join("\n\n"),
    [
      "```typescript",
      "const first = 1;",
      "const second = 2;",
      "```",
    ].join("\n"),
    after.join("\n\n"),
  ].join("\n\n");
  await mountEditor(labPage, {
    id,
    markdown,
  });
  const editor = editorLocator(labPage, id);
  const codeBlock = editor.locator(".mdw-code-block");
  const settleFocus = () => labPage.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const centerCodeBlock = async () => {
    await codeBlock.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await settleFocus();
  };
  const scrollY = () => labPage.evaluate(() => window.scrollY);

  await centerCodeBlock();
  await codeBlock.locator(".cm-line").last().click();
  await labPage.keyboard.press("End");
  const beforeExit = await scrollY();

  await labPage.keyboard.press("ArrowRight");
  await settleFocus();
  const afterExit = await scrollY();
  expect(Math.abs(afterExit - beforeExit)).toBeLessThanOrEqual(1);
  expect((await snapshotEditor(labPage, id)).activeElement).toBe("prosemirror");

  await labPage.keyboard.press("ArrowLeft");
  await settleFocus();
  expect(Math.abs((await scrollY()) - afterExit)).toBeLessThanOrEqual(1);
  await expect(codeBlock).toHaveClass(/mdw-element-selected/);
  expect((await snapshotEditor(labPage, id)).activeElement).toBe("prosemirror");

  await labPage.keyboard.press("Enter");
  await settleFocus();
  expect(Math.abs((await scrollY()) - afterExit)).toBeLessThanOrEqual(1);
  expect((await snapshotEditor(labPage, id)).activeElement).toBe("code-mirror");
  await labPage.keyboard.press("Escape");
  await settleFocus();
  const beforeDeletion = await scrollY();
  await labPage.keyboard.press("Backspace");
  await settleFocus();
  expect(Math.abs((await scrollY()) - beforeDeletion)).toBeLessThanOrEqual(1);
  await expect(codeBlock).toHaveCount(0);
  expect((await snapshotEditor(labPage, id)).activeElement).toBe("prosemirror");

  expect(await resetEditor(labPage, id, markdown)).toBe(markdown);
  await expect(codeBlock).toHaveAttribute("data-mdw-code-block-state", "active");
  await centerCodeBlock();
  await codeBlock.locator(".cm-line").first().click();
  await labPage.keyboard.press("Home");
  const beforeReplacement = await scrollY();

  await labPage.keyboard.press("Backspace");
  await settleFocus();
  expect(Math.abs((await scrollY()) - beforeReplacement)).toBeLessThanOrEqual(1);
  await expect(codeBlock).toHaveCount(0);
  expect((await snapshotEditor(labPage, id)).activeElement).toBe("prosemirror");
});
