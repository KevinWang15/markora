import type { CDPSession, Locator, Page } from "@playwright/test";
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

async function clickWithCdp(cdp: CDPSession, point: { x: number; y: number }) {
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x: point.x,
    y: point.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x: point.x,
    y: point.y,
  });
}

async function moveHeldPointerWithCdp(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x: from.x,
    y: from.y,
  });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      type: "mouseMoved",
      x: from.x + (to.x - from.x) * step / 12,
      y: from.y + (to.y - from.y) * step / 12,
    });
  }
}

async function releasePointerWithCdp(cdp: CDPSession, point: { x: number; y: number }) {
  await cdp.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x: point.x,
    y: point.y,
  });
}

test("@required Chromium table edge controls pass selection, insertion, deletion, focus, and visual acceptance", async ({
  browserName,
  context,
  labPage,
}, testInfo) => {
  test.skip(browserName !== "chromium", "This acceptance test drives the Chromium DevTools Protocol.");

  const id = "table-edge-controls";
  await mountEditor(labPage, { id, markdown: TABLE_MARKDOWN, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const table = editor.locator("table");
  await table.locator("tr").nth(1).locator("td").nth(1).click();
  await settleEditor(labPage, id);
  await expect(editor).toBeFocused();

  const controls = ownedOverlay(labPage, id, ".mdw-table-edge-controls");
  await expect(controls.getByRole("button", { name: /^Select row / })).toHaveCount(3);
  await expect(controls.getByRole("button", { name: "Select row 2" })).toBeVisible();
  await expect(controls.getByRole("button", { name: /^Select column / })).toHaveCount(3);
  await expect(controls.getByRole("button", { name: /^Insert row between/ })).toHaveCount(2);
  await expect(controls.getByRole("button", { name: /^Insert column between/ })).toHaveCount(2);

  const rowSelector = controls.getByRole("button", { name: "Select row 2" });
  const columnSelector = controls.getByRole("button", { name: "Select column 2" });
  const rowInsertion = controls.getByRole("button", { name: "Insert row between rows 2 and 3" });
  const columnInsertion = controls.getByRole("button", {
    name: "Insert column between columns 1 and 2",
  });
  const [tableBox, secondRowBox, secondHeaderBox, rowSelectorBox, columnSelectorBox, rowInsertionBox, columnInsertionBox] = await Promise.all([
    table.boundingBox(),
    table.locator("tr").nth(1).boundingBox(),
    table.locator("tr").first().locator("th").nth(1).boundingBox(),
    rowSelector.boundingBox(),
    columnSelector.boundingBox(),
    rowInsertion.boundingBox(),
    columnInsertion.boundingBox(),
  ]);
  for (const box of [tableBox, secondRowBox, secondHeaderBox, rowSelectorBox, columnSelectorBox, rowInsertionBox, columnInsertionBox]) {
    expect(box).not.toBeNull();
  }
  expect(Math.abs(rowSelectorBox!.y - secondRowBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(rowSelectorBox!.height - secondRowBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(rowSelectorBox!.x + rowSelectorBox!.width - (tableBox!.x + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(columnSelectorBox!.x - secondHeaderBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(columnSelectorBox!.width - secondHeaderBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(columnSelectorBox!.y + columnSelectorBox!.height - (tableBox!.y + 1))).toBeLessThanOrEqual(1);
  const secondRowBoundary = secondRowBox!.y + secondRowBox!.height;
  expect(Math.abs(rowInsertionBox!.y + rowInsertionBox!.height / 2 - secondRowBoundary)).toBeLessThanOrEqual(1);
  expect(Math.abs(rowInsertionBox!.x + rowInsertionBox!.width / 2 - (tableBox!.x - 5))).toBeLessThanOrEqual(1);
  const firstColumnBox = await table.locator("tr").first().locator("th").first().boundingBox();
  expect(firstColumnBox).not.toBeNull();
  expect(Math.abs(
    columnInsertionBox!.x + columnInsertionBox!.width / 2
      - (firstColumnBox!.x + firstColumnBox!.width),
  )).toBeLessThanOrEqual(1);

  const cdp = await context.newCDPSession(labPage);
  const scrollBeforeSelection = await labPage.evaluate(() => window.scrollY);
  try {
    const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
    const contextualDelete = toolbar.locator(".mdw-table-toolbar-button--danger");
    await expect(contextualDelete).toHaveCount(1);
    await expect(contextualDelete).toHaveAttribute("aria-label", "Delete table");
    await expect(contextualDelete.locator("svg")).toHaveClass(/lucide-trash-2/);
    await expect.poll(() => rowSelector.evaluate((button) => (
      getComputedStyle(button, "::before").opacity
    ))).toBe("0");
    const rowSelectorCenter = await center(rowSelector);
    await cdp.send("Input.dispatchMouseEvent", {
      buttons: 0,
      type: "mouseMoved",
      x: rowSelectorCenter.x,
      y: rowSelectorCenter.y,
    });
    await expect.poll(() => rowSelector.evaluate((button) => (
      getComputedStyle(button, "::before").opacity
    ))).toBe("1");
    await testInfo.attach("table-row-selector-progressive-disclosure", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });

    expect(await controls.evaluate((edgeControls, point) => {
      const root = edgeControls.getRootNode() as Document | ShadowRoot;
      const cover = document.createElement("div");
      cover.dataset.testid = "table-edge-cover";
      Object.assign(cover.style, {
        background: "white",
        height: "28px",
        left: `${point.x - 14}px`,
        position: "fixed",
        top: `${point.y - 14}px`,
        width: "28px",
        zIndex: "1",
      });
      root.append(cover);
      const hit = root.elementFromPoint(point.x, point.y);
      const result = {
        edgeZIndex: getComputedStyle(edgeControls).zIndex,
        hostLayerWins: hit === cover,
      };
      cover.remove();
      return result;
    }, rowSelectorCenter)).toEqual({ edgeZIndex: "0", hostLayerWins: true });

    await clickWithCdp(cdp, await center(rowSelector));
    await settleEditor(labPage, id);
    await expect(editor.locator("tr").nth(1).locator(".selectedCell")).toHaveCount(3);
    await expect(rowSelector).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toBeFocused();
    expect(Math.abs((await labPage.evaluate(() => window.scrollY)) - scrollBeforeSelection))
      .toBeLessThanOrEqual(1);

    await expect(contextualDelete).toHaveAttribute("aria-label", "Delete row");
    await expect(contextualDelete).toHaveAttribute("data-mdw-table-delete-action", "delete-row");
    await expect(contextualDelete.locator("svg")).toHaveClass(/mdi-table-row-remove/);
    await expect(toolbar.getByRole("button", { name: /^Delete / })).toHaveCount(1);
    await testInfo.attach("table-selected-row-contextual-action", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });
    await contextualDelete.click();
    await settleEditor(labPage, id);
    await expect(table.locator("tr")).toHaveCount(2);
    await expect(editor).toBeFocused();
    expect(Math.abs((await labPage.evaluate(() => window.scrollY)) - scrollBeforeSelection))
      .toBeLessThanOrEqual(1);
    expect(await getMarkdown(labPage, id)).toBe([
      "| H1 | H2 | H3 |",
      "| --- | --- | --- |",
      "| d | e | f |",
    ].join("\n"));

    expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
    await settleEditor(labPage, id);
    await table.locator("tr").nth(1).locator("td").nth(1).click();
    await clickWithCdp(cdp, await center(controls.getByRole("button", { name: "Select column 2" })));
    await settleEditor(labPage, id);
    await expect(editor.locator(".selectedCell")).toHaveCount(3);
    await expect(controls.getByRole("button", { name: "Select column 2" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(contextualDelete).toHaveAttribute("aria-label", "Delete column");
    await expect(contextualDelete).toHaveAttribute("data-mdw-table-delete-action", "delete-column");
    await expect(contextualDelete.locator("svg")).toHaveClass(/mdi-table-column-remove/);
    await expect(toolbar.getByRole("button", { name: /^Delete / })).toHaveCount(1);
    await testInfo.attach("table-selected-column-contextual-action", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });
    await contextualDelete.click();
    await settleEditor(labPage, id);
    await expect(table.locator("tr").first().locator("th")).toHaveCount(2);
    await expect(editor).toBeFocused();
    expect(Math.abs((await labPage.evaluate(() => window.scrollY)) - scrollBeforeSelection))
      .toBeLessThanOrEqual(1);
    expect(await getMarkdown(labPage, id)).toBe([
      "| H1 | H3 |",
      "| --- | --- |",
      "| a | c |",
      "| d | f |",
    ].join("\n"));

    await resetEditor(labPage, id, TABLE_MARKDOWN);
    await table.locator("tr").nth(1).locator("td").nth(1).click();
    const freshRowInsertion = controls.getByRole("button", { name: "Insert row between rows 2 and 3" });
    const rowInsertionCenter = await center(freshRowInsertion);
    await cdp.send("Input.dispatchMouseEvent", {
      buttons: 0,
      type: "mouseMoved",
      x: rowInsertionCenter.x,
      y: rowInsertionCenter.y,
    });
    await expect.poll(() => freshRowInsertion.evaluate((button) => getComputedStyle(button).opacity))
      .toBe("1");
    await testInfo.attach("table-edge-row-insertion-hover", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });
    await clickWithCdp(cdp, rowInsertionCenter);
    await settleEditor(labPage, id);
    await expect(table.locator("tr")).toHaveCount(4);
    expect(await table.locator("tr").allTextContents()).toEqual(["H1H2H3", "abc", "", "def"]);
    expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
    await settleEditor(labPage, id);

    await table.locator("tr").nth(1).locator("td").nth(1).click();
    const freshColumnInsertion = controls.getByRole("button", {
      name: "Insert column between columns 1 and 2",
    });
    const columnInsertionCenter = await center(freshColumnInsertion);
    await cdp.send("Input.dispatchMouseEvent", {
      buttons: 0,
      type: "mouseMoved",
      x: columnInsertionCenter.x,
      y: columnInsertionCenter.y,
    });
    await expect.poll(() => freshColumnInsertion.evaluate((button) => getComputedStyle(button).opacity))
      .toBe("1");
    await clickWithCdp(cdp, columnInsertionCenter);
    await settleEditor(labPage, id);
    await expect(table.locator("tr").first().locator("th")).toHaveCount(4);
    expect(await table.locator("tr").first().locator("th").allTextContents())
      .toEqual(["H1", "", "H2", "H3"]);
  } finally {
    await cdp.detach();
  }
});

test("@required Chromium table edge handles drag rows and columns to a visual drop position", async ({
  browserName,
  context,
  labPage,
}, testInfo) => {
  test.skip(browserName !== "chromium", "This acceptance test drives the Chromium DevTools Protocol.");

  const id = "table-edge-reorder";
  await mountEditor(labPage, { id, markdown: TABLE_MARKDOWN, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const table = editor.locator("table");
  await table.locator("tr").nth(1).locator("td").first().click();
  await settleEditor(labPage, id);
  const controls = ownedOverlay(labPage, id, ".mdw-table-edge-controls");
  const indicator = controls.locator(".mdw-table-reorder-indicator");
  const cdp = await context.newCDPSession(labPage);
  const scrollBeforeDrag = await labPage.evaluate(() => window.scrollY);

  try {
    const headerSelector = controls.getByRole("button", { name: "Select row 1" });
    await expect(headerSelector).toHaveAttribute("data-mdw-table-reorderable", "false");

    const sourceRow = controls.getByRole("button", { name: "Select row 2" });
    const targetRow = controls.getByRole("button", { name: "Select row 3" });
    const rowStart = await center(sourceRow);
    const targetRowBox = await targetRow.boundingBox();
    expect(targetRowBox).not.toBeNull();
    const rowEnd = {
      x: targetRowBox!.x + targetRowBox!.width / 2,
      y: targetRowBox!.y + targetRowBox!.height * 0.8,
    };
    await moveHeldPointerWithCdp(cdp, rowStart, rowEnd);
    await expect(sourceRow).toHaveAttribute("aria-grabbed", "true");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-mdw-table-axis", "row");
    await expect(indicator).toHaveAttribute("data-mdw-table-target-index", "2");
    await expect(editor.locator("tr").nth(1).locator(".selectedCell")).toHaveCount(3);
    await testInfo.attach("table-row-drag-drop-indicator", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });
    await releasePointerWithCdp(cdp, rowEnd);
    await settleEditor(labPage, id);
    await expect(indicator).toBeHidden();
    expect(await table.locator("tr").allTextContents()).toEqual(["H1H2H3", "def", "abc"]);
    expect(await getMarkdown(labPage, id)).toBe([
      "| H1 | H2 | H3 |",
      "| --- | --- | --- |",
      "| d | e | f |",
      "| a | b | c |",
    ].join("\n"));
    await expect(editor).toBeFocused();
    expect(Math.abs((await labPage.evaluate(() => window.scrollY)) - scrollBeforeDrag))
      .toBeLessThanOrEqual(1);
    expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(TABLE_MARKDOWN);

    await table.locator("tr").nth(1).locator("td").first().click();
    await settleEditor(labPage, id);
    const sourceColumn = controls.getByRole("button", { name: "Select column 1" });
    const targetColumn = controls.getByRole("button", { name: "Select column 3" });
    const columnStart = await center(sourceColumn);
    const targetColumnBox = await targetColumn.boundingBox();
    expect(targetColumnBox).not.toBeNull();
    const columnEnd = {
      x: targetColumnBox!.x + targetColumnBox!.width * 0.8,
      y: targetColumnBox!.y + targetColumnBox!.height / 2,
    };
    await moveHeldPointerWithCdp(cdp, columnStart, columnEnd);
    await expect(sourceColumn).toHaveAttribute("aria-grabbed", "true");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-mdw-table-axis", "column");
    await expect(indicator).toHaveAttribute("data-mdw-table-target-index", "2");
    await expect(editor.locator(".selectedCell")).toHaveCount(3);
    await testInfo.attach("table-column-drag-drop-indicator", {
      body: await labPage.screenshot(),
      contentType: "image/png",
    });
    await releasePointerWithCdp(cdp, columnEnd);
    await settleEditor(labPage, id);
    await expect(indicator).toBeHidden();
    expect(await table.locator("tr").first().locator("th").allTextContents())
      .toEqual(["H2", "H3", "H1"]);
    expect(await getMarkdown(labPage, id)).toBe([
      "| H2 | H3 | H1 |",
      "| --- | --- | --- |",
      "| b | c | a |",
      "| e | f | d |",
    ].join("\n"));
    await expect(editor).toBeFocused();
    expect(Math.abs((await labPage.evaluate(() => window.scrollY)) - scrollBeforeDrag))
      .toBeLessThanOrEqual(1);
    expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(TABLE_MARKDOWN);
  } finally {
    await cdp.detach();
  }
});

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
