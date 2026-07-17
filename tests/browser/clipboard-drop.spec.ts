import type { Page } from "@playwright/test";
import {
  dispatchTransfer,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

async function focusParagraphEnd(page: Page, id: string) {
  const paragraph = editorLocator(page, id).locator("p").last();
  await paragraph.click();
  await page.keyboard.press("End");
}

test("@required file-bearing paste and drop are safely rejected everywhere", async ({ labPage }) => {
  const id = "file-transfer";
  const markdown = [
    "before",
    "",
    "```text",
    "code stays",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown });
  const file = {
    contents: "must never enter the document",
    name: "local-secret.txt",
    type: "text/plain",
  };
  await editorLocator(labPage, id).locator(".cm-content").click();

  for (const target of ["prosemirror", "code-mirror"] as const) {
    for (const event of ["paste", "dragover", "drop"] as const) {
      const result = await dispatchTransfer(labPage, id, {
        event,
        files: [file],
        html: "<strong>mixed rich text must also be rejected</strong>",
        markdown: "**mixed Markdown must also be rejected**",
        plain: "mixed text must also be rejected",
        target,
      });
      expect(result.defaultPrevented).toBe(true);
      expect(result.fileCount).toBe(1);
      expect(result.types).toContain("Files");
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(markdown);
    }
  }
});

test("rich HTML wins over plain fallback and unsafe URLs are removed", async ({ labPage }) => {
  const id = "rich-paste";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: [
      '<p><strong>Rich</strong> <a href="javascript:alert(1)">unsafe</a></p>',
      "<ul><li>One</li><li>Two</li></ul>",
    ].join(""),
    plain: "plain fallback",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  expect(await getMarkdown(labPage, id)).toBe([
    "**Rich** unsafe",
    "",
    "* One",
    "",
    "* Two",
  ].join("\n"));
  await expect(editorLocator(labPage, id).locator("strong")).toHaveText("Rich");
  await expect(editorLocator(labPage, id).locator("a")).toHaveCount(0);

  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }), id))
    .toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");
});

test("rich HTML table headers keep scope and mixed rows receive body cells", async ({ labPage }) => {
  const id = "rich-table-scope";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: [
      "<table><thead>",
      '<tr><th scope="col">Name</th><th scope="col">Status</th></tr>',
      "</thead><tbody>",
      '<tr><th scope="row">Alpha</th><td>Ready</td></tr>',
      "</tbody></table>",
    ].join(""),
    plain: "Name Status Alpha Ready",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  const rows = editor.locator("table tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("th")).toHaveCount(2);
  expect(await rows.first().locator("th").evaluateAll((headers) =>
    headers.map((header) => header.getAttribute("scope")))).toEqual(["col", "col"]);
  await expect(rows.nth(1).locator('th[scope="row"]')).toHaveText("Alpha");
  await expect(rows.nth(1).locator("td")).toHaveCount(1);

  await rows.nth(1).locator("td p").click();
  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Insert column after" }).click();
  await settleEditor(labPage, id);

  await expect(rows.first().locator("th")).toHaveCount(3);
  expect(await rows.first().locator("th").evaluateAll((headers) =>
    headers.map((header) => header.getAttribute("scope")))).toEqual(["col", "col", "col"]);
  await expect(rows.nth(1).locator('th[scope="row"]')).toHaveCount(1);
  await expect(rows.nth(1).locator("td")).toHaveCount(2);
  expect(await getMarkdown(labPage, id)).toBe([
    "| Name | Status |  |",
    "| --- | --- | --- |",
    "| Alpha | Ready |  |",
  ].join("\n"));
});

test("Markdown MIME pastes semantically while plain Markdown-looking text remains literal", async ({ labPage }) => {
  const id = "plain-paste";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const markdownLookingText = "# Literal heading\n\n**literal strong**";
  const markdownResult = await dispatchTransfer(labPage, id, {
    event: "paste",
    markdown: markdownLookingText,
    plain: markdownLookingText,
  });
  expect(markdownResult.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("# Literal heading\n\n**literal strong**");
  await expect(editorLocator(labPage, id).locator("h1, strong")).toHaveCount(2);

  await resetEditor(labPage, id, "");
  await focusParagraphEnd(labPage, id);
  const plainResult = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: "<b>literal tag</b>\n\n\nsecond block",
  });
  expect(plainResult.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  const escapedPlainMarkdown = "\\<b>literal tag\\</b>\n\nsecond block";
  expect(await getMarkdown(labPage, id)).toBe(escapedPlainMarkdown);
  const editor = editorLocator(labPage, id);
  expect(await editor.locator("p").allTextContents()).toEqual(["<b>literal tag</b>", "second block"]);
  await expect(editor.locator("strong")).toHaveCount(0);

  await resetEditor(labPage, id, escapedPlainMarkdown);
  await settleEditor(labPage, id);
  expect(await editor.locator("p").allTextContents()).toEqual(["<b>literal tag</b>", "second block"]);
  await expect(editor.locator("strong")).toHaveCount(0);
});

test("external rich and plain drops insert undoable content", async ({ labPage }) => {
  const id = "external-drop";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const richDrop = await dispatchTransfer(labPage, id, {
    event: "drop",
    html: "<p><em>Dropped rich</em></p>",
    plain: "plain fallback",
  });
  expect(richDrop.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("*Dropped rich*");

  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }), id))
    .toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");

  const plainDrop = await dispatchTransfer(labPage, id, {
    event: "drop",
    plain: "Dropped plain",
  });
  expect(plainDrop.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("Dropped plain");
});

test("CodeMirror accepts ordinary multiline text paste while rejecting files", async ({ labPage }) => {
  const id = "code-paste";
  await mountEditor(labPage, {
    id,
    markdown: ["```text", "before", "```"].join("\n"),
  });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await labPage.keyboard.press("End");

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: "<strong>ignored rich fallback</strong>",
    plain: "\nafter\nthird",
    target: "code-mirror",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "```text",
    "before",
    "after",
    "third",
    "```",
  ].join("\n"));
});
