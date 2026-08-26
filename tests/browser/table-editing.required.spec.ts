import type { Locator, Page } from "@playwright/test";
import {
  canRunEditorCommand,
  copyEditorSelection,
  dispatchTransfer,
  editorLocator,
  expect,
  getEditorActiveState,
  getMarkdown,
  mountEditor,
  openEditorUi,
  ownedOverlay,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
} from "./fixtures";

const TABLE_MARKDOWN = [
  "| H1 | H2 | H3 |",
  "| --- | --- | --- |",
  "| a | b | c |",
  "| d | e | f |",
].join("\n");

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  };
}

async function dragAcrossCells(page: Page, from: Locator, to: Locator) {
  const start = await center(from);
  const end = await center(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function selectCellText(page: Page, id: string, text: string) {
  expect(await page.evaluate(
    ({ editorId, needle }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "all"),
    { editorId: id, needle: text },
  )).toBe(true);
}

test("@required mature table editing keeps rectangular clipboard and structural changes predictable in Shadow DOM", async ({ labPage }) => {
  const id = "mature-table";
  await mountEditor(labPage, {
    id,
    markdown: TABLE_MARKDOWN,
    root: "shadow",
  });
  const editor = editorLocator(labPage, id);
  const bodyCells = editor.locator("table tr").nth(1).locator("td");

  await dragAcrossCells(labPage, bodyCells.nth(0), bodyCells.nth(1));
  await settleEditor(labPage, id);
  expect(await getEditorActiveState(labPage, id, { type: "tableCellSelection" })).toBe(true);
  await expect(editor.locator("td.selectedCell")).toHaveCount(2);

  await labPage.keyboard.press("Shift+ArrowDown");
  await settleEditor(labPage, id);
  await expect(editor.locator("td.selectedCell")).toHaveCount(4);

  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.plain).toBe("a\tb\nd\te");
  expect(copied.markdown).toBe([
    "| a | b |",
    "| --- | --- |",
    "| d | e |",
  ].join("\n"));
  expect(copied.html).toContain("<table");

  const paste = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: "one\ttwo\nthree\tfour",
  });
  expect(paste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "| H1 | H2 | H3 |",
    "| --- | --- | --- |",
    "| one | two | c |",
    "| three | four | f |",
  ].join("\n"));
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(TABLE_MARKDOWN);

  await resetEditor(labPage, id, TABLE_MARKDOWN);
  await selectCellText(labPage, id, "e");
  expect(await runEditorCommand(labPage, id, { type: "addTableRow", side: "before" })).toBe(true);
  await selectCellText(labPage, id, "e");
  expect(await runEditorCommand(labPage, id, { type: "addTableRow", side: "after" })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr")).toHaveCount(5);
  expect(await editor.locator("table tr").allTextContents()).toEqual(["H1H2H3", "abc", "", "def", ""]);

  await resetEditor(labPage, id, TABLE_MARKDOWN);
  await selectCellText(labPage, id, "e");
  expect(await runEditorCommand(labPage, id, { type: "addTableColumn", side: "before" })).toBe(true);
  await selectCellText(labPage, id, "e");
  expect(await runEditorCommand(labPage, id, { type: "addTableColumn", side: "after" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await editor.locator("table tr").first().locator("th").allTextContents())
    .toEqual(["H1", "", "H2", "", "H3"]);
  expect(await editor.locator("table tr").nth(2).locator("td").allTextContents())
    .toEqual(["d", "", "e", "", "f"]);

  await resetEditor(labPage, id, TABLE_MARKDOWN);
  await selectCellText(labPage, id, "e");
  expect(await runEditorCommand(labPage, id, { type: "moveTableRow", direction: "up" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "moveTableColumn", direction: "left" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "| H2 | H1 | H3 |",
    "| --- | --- | --- |",
    "| e | d | f |",
    "| b | a | c |",
  ].join("\n"));

  expect(await runEditorCommand(labPage, id, {
    type: "resizeTable",
    options: { columns: 4, rows: 4 },
  })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("table tr")).toHaveCount(4);
  await expect(editor.locator("table tr").first().locator("th")).toHaveCount(4);
  await expect(editor.locator("table tr").nth(1).locator("td")).toHaveCount(4);

  const shrink = { type: "resizeTable", options: { columns: 2, rows: 2 } } as const;
  expect(await canRunEditorCommand(labPage, id, shrink)).toBe(false);
  expect(await runEditorCommand(labPage, id, shrink)).toBe(false);
  expect(await runEditorCommand(labPage, id, {
    type: "resizeTable",
    options: { columns: 2, discardContent: true, rows: 2 },
  })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "| H2 | H1 |",
    "| --- | --- |",
    "| e | d |",
  ].join("\n"));
});

test("@required table creation and dimension controls validate safe resize in Shadow DOM", async ({ labPage }) => {
  const id = "table-dimensions";
  await mountEditor(labPage, { id, markdown: "replace me", root: "shadow" });
  await selectCellText(labPage, id, "replace me");
  expect(await openEditorUi(labPage, id, "table-create")).toBe(true);

  const dialog = ownedOverlay(labPage, id, ".mdw-table-size-editor");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Create table");
  await dialog.getByLabel("Rows").fill("3");
  await dialog.getByLabel("Columns").fill("4");
  await dialog.getByRole("button", { name: "Create" }).click();
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator("table tr")).toHaveCount(3);
  await expect(editor.locator("table tr").first().locator("th")).toHaveCount(4);
  const lastCell = editor.locator("table tr").last().locator("td").last();
  await lastCell.click();
  await labPage.keyboard.type("tail");

  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  const resize = toolbar.getByRole("button", { name: "Resize table" });
  await resize.focus();
  await resize.click();
  await expect(dialog).toHaveAccessibleName("Resize table");
  await expect(dialog.getByLabel("Rows")).toHaveValue("3");
  await expect(dialog.getByLabel("Columns")).toHaveValue("4");

  await dialog.getByLabel("Rows").fill("2");
  await dialog.getByLabel("Columns").fill("2");
  await dialog.getByRole("button", { name: "Resize" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Clear content outside the new size");
  expect(await getMarkdown(labPage, id)).toContain("tail");

  await dialog.getByLabel("Rows").fill("4");
  await dialog.getByLabel("Columns").fill("5");
  await dialog.getByRole("button", { name: "Resize" }).click();
  await settleEditor(labPage, id);
  await expect(dialog).toBeHidden();
  await expect(resize).toBeFocused();
  await expect(editor.locator("table tr")).toHaveCount(4);
  await expect(editor.locator("table tr").first().locator("th")).toHaveCount(5);
  expect(await getMarkdown(labPage, id)).toContain("tail");
});

test("@required Chromium CDP drives rectangular table selection and clipboard export", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP input commands.");

  const id = "table-cdp-selection";
  await mountEditor(labPage, { id, markdown: TABLE_MARKDOWN, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const bodyCells = editor.locator("table tr").nth(1).locator("td");
  const start = await center(bodyCells.nth(0));
  const end = await center(bodyCells.nth(1));
  await labPage.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    const target = window as typeof window & {
      __markoraTableCdpCopy?: { markdown: string; plain: string; types: string[] };
    };
    delete target.__markoraTableCdpCopy;
    section.addEventListener("copy", (rawEvent) => {
      const data = (rawEvent as ClipboardEvent).clipboardData;
      target.__markoraTableCdpCopy = {
        markdown: data?.getData("text/markdown") ?? "",
        plain: data?.getData("text/plain") ?? "",
        types: Array.from(data?.types ?? []),
      };
    }, { once: true });
  }, id);

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: start.x,
      y: start.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      type: "mouseMoved",
      x: end.x,
      y: end.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: end.x,
      y: end.y,
    });
    await expect(editor.locator("td.selectedCell")).toHaveCount(2);

    await cdp.send("Input.dispatchKeyEvent", {
      code: "ArrowDown",
      key: "ArrowDown",
      modifiers: 8,
      type: "keyDown",
      windowsVirtualKeyCode: 40,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "ArrowDown",
      key: "ArrowDown",
      modifiers: 8,
      type: "keyUp",
      windowsVirtualKeyCode: 40,
    });
    await expect(editor.locator("td.selectedCell")).toHaveCount(4);

    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      commands: ["Copy"],
      key: "c",
      modifiers: 2,
      type: "keyDown",
      windowsVirtualKeyCode: 67,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      key: "c",
      modifiers: 2,
      type: "keyUp",
      windowsVirtualKeyCode: 67,
    });
  } finally {
    await cdp.detach();
  }

  expect(await labPage.evaluate(() => (
    window as typeof window & {
      __markoraTableCdpCopy?: { markdown: string; plain: string; types: string[] };
    }
  ).__markoraTableCdpCopy)).toEqual({
    markdown: ["| a | b |", "| --- | --- |", "| d | e |"].join("\n"),
    plain: "a\tb\nd\te",
    types: expect.arrayContaining(["text/html", "text/plain", "text/markdown"]),
  });
  expect(await getMarkdown(labPage, id)).toBe(TABLE_MARKDOWN);
});

test("@required modified cell-collapse keys preserve rectangular table selections", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "table-modified-selection";
  await mountEditor(labPage, { id, markdown: TABLE_MARKDOWN });
  const editor = editorLocator(labPage, id);
  const cells = editor.locator("table tr").nth(1).locator("td");
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;

  for (const modifiers of [2, 8]) {
    for (const { code, key, keyCode } of [
      { code: "Enter", key: "Enter", keyCode: 13 },
      { code: "Escape", key: "Escape", keyCode: 27 },
      { code: "F2", key: "F2", keyCode: 113 },
    ]) {
      await dragAcrossCells(labPage, cells.nth(0), cells.nth(1));
      await settleEditor(labPage, id);
      if (cdp) {
        for (const type of ["rawKeyDown", "keyUp"] as const) {
          await cdp.send("Input.dispatchKeyEvent", {
            code,
            key,
            modifiers,
            nativeVirtualKeyCode: keyCode,
            type,
            windowsVirtualKeyCode: keyCode,
          });
        }
      } else {
        await labPage.keyboard.press(`${modifiers === 2 ? "Control" : "Shift"}+${key}`);
      }
      await settleEditor(labPage, id);
      expect(await getEditorActiveState(labPage, id, { type: "tableCellSelection" })).toBe(true);
      await expect(editor.locator("td.selectedCell")).toHaveCount(2);
    }
  }

  await cdp?.detach();
});
