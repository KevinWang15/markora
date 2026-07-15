import { editorLocator, expect, getMarkdown, mountEditor, settleEditor, test } from "./fixtures";

test("@required opaque source stays exact and inert beside supported edits", async ({ labPage: page }) => {
  const source = [
    "---",
    "title: Browser safety",
    "---",
    "",
    "# Supported",
    "",
    "Around **Markdown**.",
    "",
    "<script>globalThis.__markoraBrowserRawExecuted = true;</script>",
    "",
    "Inline <span data-label=\"[raw]\">HTML</span> stays inert.",
  ].join("\n");

  await mountEditor(page, { id: "opaque", markdown: source });
  const editor = editorLocator(page, "opaque");

  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="frontmatter"]')).toHaveCount(1);
  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="html-block"]')).toHaveCount(1);
  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="inline-html"]')).toHaveCount(2);
  await expect(editor.locator("script, iframe, style")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __markoraBrowserRawExecuted?: boolean }).__markoraBrowserRawExecuted,
  ))).toBe(false);

  await editor.getByRole("button", { name: "Edit Front matter Markdown source" }).click();
  await expect.poll(() => page.evaluate(() => window.__MARKORA_BROWSER_LAB__!.pendingOpaqueEdit("opaque"))).toEqual({
    kind: "frontmatter",
    source: "---\ntitle: Browser safety\n---",
  });
  const updated = await page.evaluate(() => window.__MARKORA_BROWSER_LAB__!.updateOpaque(
    "opaque",
    "---\ntitle: Browser safety updated\n---",
  ));
  expect(updated).toBe(true);

  const selectedHeadingEnd = await page.evaluate(() => (
    window.__MARKORA_BROWSER_LAB__!.selectText("opaque", "Supported", "end")
  ));
  expect(selectedHeadingEnd).toBe(true);
  await page.keyboard.type(" browser");
  await settleEditor(page, "opaque");

  await expect.poll(() => getMarkdown(page, "opaque")).toBe([
    "---",
    "title: Browser safety updated",
    "---",
    "",
    "# Supported browser",
    "",
    "Around **Markdown**.",
    "",
    "<script>globalThis.__markoraBrowserRawExecuted = true;</script>",
    "",
    "Inline <span data-label=\"[raw]\">HTML</span> stays inert.",
  ].join("\n"));
});
