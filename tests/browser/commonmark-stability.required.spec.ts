import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required remaining CommonMark structures survive CDP edits and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "remaining-commonmark-stability";
  const input = [
    "### heading \\###",
    "",
    "* item",
    "  > quoted",
    "  >",
    "* sibling",
    "",
    "*foo **bar *baz* bim** bop*",
  ].join("\n");
  const canonical = [
    "### heading \\###",
    "",
    "* item",
    "  > quoted",
    "* sibling",
    "",
    "*foo* ***bar baz*** **bim** bop",
  ].join("\n");

  await mountEditor(labPage, { entry: "root", id, markdown: input, root: "shadow" });
  const editor = editorLocator(labPage, id);
  await expect(editor.locator("h3")).toContainText("heading ###");
  await expect(editor.locator("blockquote")).toContainText("quoted");
  expect(await getMarkdown(labPage, id)).toBe(canonical);

  for (const target of ["quoted", "baz"]) {
    expect(await labPage.evaluate(({ editorId, text }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "end")
    ), { editorId: id, text: target })).toBe(true);

    if (browserName === "chromium") {
      const cdp = await context.newCDPSession(labPage);
      await cdp.send("Input.insertText", { text: "!" });
      await cdp.detach();
    } else {
      await labPage.keyboard.insertText("!");
    }
    await settleEditor(labPage, id);
  }

  const edited = canonical
    .replace("quoted", "quoted!")
    .replace("bar baz", "bar baz!");
  expect(await getMarkdown(labPage, id)).toBe(edited);

  await resetEditor(labPage, id, edited);
  await settleEditor(labPage, id);
  await expect(editor.locator("h3")).toContainText("heading ###");
  await expect(editor.locator("blockquote")).toContainText("quoted!");
  await expect(editor.locator("strong")).toHaveCount(2);
  await expect(editor.locator("em")).toHaveCount(2);
  expect(await getMarkdown(labPage, id)).toBe(edited);
});
