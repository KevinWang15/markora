import type { Locator, Page } from "@playwright/test";
import { chromiumTest, editorLocator, expect, mountEditor, test, updateEditorOptions } from "./fixtures";

// A read-only editor is a document to read: no Markdown syntax revealed where the selection is,
// text selection only (no cell, node, or cursor selections and their rings), and no focus ring
// when the host took it out of the tab order.

const MARKDOWN = [
  "# Title",
  "",
  "Intro with **bold** and [a link](https://example.com).",
  "",
  "| A | B |",
  "| --- | --- |",
  "| **Hit** | one |",
  "| two | three |",
  "",
  "---",
  "",
  "- item one",
  "- item two",
].join("\n");

async function chrome(editor: Locator) {
  return editor.evaluate((element) => ({
    markers: element.querySelectorAll(".mdw-marker").length,
    activeListItems: element.querySelectorAll(".mdw-active-list-item").length,
    selectedCells: element.querySelectorAll(".selectedCell").length,
    selectedElements: element.querySelectorAll(".mdw-element-selected, .ProseMirror-selectednode").length,
    selection: element.ownerDocument.getSelection()?.toString() ?? "",
  }));
}

async function dragAcross(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!, end = (await to.boundingBox())!;
  await page.mouse.move(start.x + 4, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 4, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("@required a read-only editor reads as a document: no syntax, cell, node, or focus chrome", async ({ labPage }) => {
  const id = "read-only-document";
  await mountEditor(labPage, { id, markdown: MARKDOWN, editable: false, attributes: { role: "document", tabindex: "-1" } });
  const editor = editorLocator(labPage, id);

  for (const target of [editor.locator("strong", { hasText: "Hit" }), editor.locator("li", { hasText: "item one" }), editor.locator("h1")]) {
    await target.click();
    expect(await chrome(editor)).toMatchObject({ markers: 0, activeListItems: 0 });
  }

  // A drag across cells selects their text, as on any page.
  await dragAcross(labPage, editor.locator("td", { hasText: "one" }), editor.locator("td", { hasText: "three" }));
  expect(await chrome(editor)).toMatchObject({ selectedCells: 0, selection: expect.stringContaining("three") });

  // A rule clicked is not selected as a node.
  await editor.locator("hr").click({ force: true });
  expect(await chrome(editor)).toMatchObject({ selectedElements: 0 });
  expect(await editor.evaluate((element) => element.classList.contains("ProseMirror-hideselection"))).toBe(false);
});

test("@required becoming read-only drops editing selections and revealed syntax", async ({ labPage }) => {
  const id = "read-only-transition";
  await mountEditor(labPage, { id, markdown: MARKDOWN });
  const editor = editorLocator(labPage, id);

  await editor.locator("strong", { hasText: "bold" }).click();
  expect((await chrome(editor)).markers).toBe(2);
  await updateEditorOptions(labPage, id, { editable: false });
  expect((await chrome(editor)).markers).toBe(0);

  await updateEditorOptions(labPage, id, { editable: true });
  expect((await chrome(editor)).markers).toBe(2);
  await dragAcross(labPage, editor.locator("td", { hasText: "one" }), editor.locator("td", { hasText: "three" }));
  expect((await chrome(editor)).selectedCells).toBeGreaterThan(1);
  await updateEditorOptions(labPage, id, { editable: false });
  expect(await chrome(editor)).toMatchObject({ selectedCells: 0, markers: 0 });
  expect(await editor.evaluate((element) => element.classList.contains("ProseMirror-hideselection"))).toBe(false);
});

// Chromium matches :focus-visible on a pointer-focused element after a key press (Ctrl+C, say).
chromiumTest("@required a read-only editor draws its focus ring only while in the tab order", async ({ labPage }) => {
  const ring = async (editor: ReturnType<typeof editorLocator>) => {
    await editor.locator("strong", { hasText: "bold" }).click();
    await labPage.keyboard.press("Shift");
    expect(await editor.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    return editor.evaluate((element) => getComputedStyle(element).boxShadow);
  };
  await mountEditor(labPage, { id: "read-only-document", markdown: MARKDOWN, editable: false, attributes: { role: "document", tabindex: "-1" } });
  expect(await ring(editorLocator(labPage, "read-only-document"))).toBe("none");
  await mountEditor(labPage, { id: "read-only-textbox", markdown: MARKDOWN, editable: false });
  expect(await ring(editorLocator(labPage, "read-only-textbox"))).not.toBe("none");
});
