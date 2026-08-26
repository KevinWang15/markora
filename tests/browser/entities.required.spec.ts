import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required entity-sensitive text survives CDP edits and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "entity-fidelity";
  const input = [
    String.raw`Literal \&copy; and \&#10;.`,
    "",
    "Whitespace: &#9;A&#10;B&#13;C&nbsp;",
    "",
    "Boundary www.example.com/?x=&copy; remains split.",
  ].join("\n");
  const canonical = [
    String.raw`Literal \&copy; and \&#10;.`,
    "",
    "Whitespace: &#9;A&#10;B&#13;C&#160;",
    "",
    "Boundary www.example.com/?x=&#169; remains split.",
  ].join("\n");

  await mountEditor(labPage, { entry: "root", id, markdown: input, root: "shadow" });
  const editor = editorLocator(labPage, id);
  await expect(editor).toContainText("Literal &copy; and &#10;.");
  await expect(editor.locator('a[href="http://www.example.com/?x="]')).toHaveCount(1);
  expect(await getMarkdown(labPage, id)).toBe(canonical);

  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Literal", "end")
  ), id)).toBe(true);

  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);
    await cdp.send("Input.insertText", { text: " &trade; &#9;" });
    await cdp.detach();
  } else {
    await labPage.keyboard.insertText(" &trade; &#9;");
  }
  await settleEditor(labPage, id);

  const edited = canonical.replace(
    "Literal",
    String.raw`Literal \&trade; \&#9;`,
  );
  expect(await getMarkdown(labPage, id)).toBe(edited);

  await resetEditor(labPage, id, edited);
  await settleEditor(labPage, id);
  await expect(editor).toContainText("Literal &trade; &#9; &copy; and &#10;.");
  await expect(editor.locator('a[href="http://www.example.com/?x="]')).toHaveCount(1);
  expect(await getMarkdown(labPage, id)).toBe(edited);
});
