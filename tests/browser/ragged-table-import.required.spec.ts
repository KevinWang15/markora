import {
  copyEditorSelection,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";

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

test("@required widest pipe-table rows survive trusted edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "ragged-pipe-table-fidelity";
  const input = [
    "| H1 | H2 |",
    "| --- | --- |",
    "| A | B | C |",
    "| D |",
  ].join("\n");
  const canonical = [
    "| H1 | H2 |  |",
    "| --- | --- | --- |",
    "| A | B | C |",
    "| D |  |  |",
  ].join("\n");

  await mountEditor(labPage, { entry: "root", id, markdown: input, root: "shadow" });
  const editor = editorLocator(labPage, id);
  await expect(editor.locator("th")).toHaveCount(3);
  await expect(editor.locator("td")).toHaveCount(6);
  expect(await getMarkdown(labPage, id)).toBe(canonical);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "C", "end")
  ), id)).toBe(true);

  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);
    await cdp.send("Input.insertText", { text: "!" });
    await cdp.detach();
  } else {
    await labPage.keyboard.insertText("!");
  }
  await settleEditor(labPage, id);
  const edited = canonical.replace("| A | B | C |", "| A | B | C! |");
  expect(await getMarkdown(labPage, id)).toBe(edited);

  await resetEditor(labPage, id, edited);
  await settleEditor(labPage, id);
  await expect(editor.locator("th")).toHaveCount(3);
  await expect(editor.locator("td")).toHaveCount(6);
  expect(await getMarkdown(labPage, id)).toBe(edited);

  const rows = editor.locator("table tr");
  await dragAcrossCells(
    labPage,
    rows.nth(0).locator("th").nth(2),
    rows.nth(2).locator("td").nth(2),
  );
  await settleEditor(labPage, id);
  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe([
    "|  |",
    "| --- |",
    "| C! |",
    "|  |",
  ].join("\n"));
  expect(copied.html).toContain("<table");
  expect(copied.plain).toContain("C!");
});

test("@required escaped pipes inside GFM table code spans survive CDP edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "gfm-table-code-pipe";
  const input = [
    "| f\\|oo |",
    "| ------ |",
    "| b `\\|` az |",
    "| b **\\|** im |",
  ].join("\n");
  const canonical = [
    "| f\\|oo |",
    "| --- |",
    "| b `\\|` az |",
    "| b **\\|** im |",
  ].join("\n");

  await mountEditor(labPage, { entry: "root", id, markdown: input, root: "shadow" });
  const editor = editorLocator(labPage, id);
  await expect(editor.locator("td code")).toHaveCount(1);
  await expect(editor.locator("td code")).toHaveText("|");
  expect(await getMarkdown(labPage, id)).toBe(canonical);

  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "az", "end")
  ), id)).toBe(true);
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);
    await cdp.send("Input.insertText", { text: "!" });
    await cdp.detach();
  } else {
    await labPage.keyboard.insertText("!");
  }
  await settleEditor(labPage, id);

  const edited = canonical.replace("`\\|` az", "`\\|` az!");
  expect(await getMarkdown(labPage, id)).toBe(edited);
  await resetEditor(labPage, id, edited);
  await settleEditor(labPage, id);
  await expect(editor.locator("td code")).toHaveCount(1);
  await expect(editor.locator("td code")).toHaveText("|");
  expect(await getMarkdown(labPage, id)).toBe(edited);
});
