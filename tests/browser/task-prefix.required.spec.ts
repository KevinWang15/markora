import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required escaped task prefixes remain literal through edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "task-prefix-fidelity";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await mountEditor(labPage, {
    entry: "root",
    id,
    markdown: [
      "* \\[x\\] literal",
      "* &#91;x] entity",
      "* [x] parent",
      "",
      "  second paragraph",
      "",
      "  * [ ] child",
      "",
      "  ```",
      "  code",
      "  ```",
      "* [ ]",
    ].join("\n"),
    root: "shadow",
  });
  const editor = editorLocator(labPage, id);

  await expect(editor.locator('[data-mdw-task-control="true"]')).toHaveCount(3);
  await expect(editor.locator('li[data-task="true"] li[data-task="true"]')).toHaveCount(1);
  await expect(editor.locator("li").first()).toContainText("[x] literal");
  await expect(editor.locator("li").nth(1)).toContainText("[x] entity");
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "literal", "end")
  ), id)).toBe(true);

  if (cdp) {
    await cdp.send("Input.insertText", { text: "!" });
  } else {
    await labPage.keyboard.insertText("!");
  }
  await settleEditor(labPage, id);
  const serialized = await getMarkdown(labPage, id);
  expect(serialized).toBe(
    [
      "* \\[x\\] literal!",
      "",
      "* \\[x\\] entity",
      "",
      "* [x] parent",
      "",
      "  second paragraph",
      "",
      "  * [ ] child",
      "",
      "  ```",
      "  code",
      "  ```",
      "",
      "* [ ] ",
    ].join("\n"),
  );

  await resetEditor(labPage, id, serialized);
  await settleEditor(labPage, id);
  await expect(editor.locator('[data-mdw-task-control="true"]')).toHaveCount(3);
  await expect(editor.locator('li[data-task="true"] li[data-task="true"]')).toHaveCount(1);
  await expect(editor.locator("li").first()).toContainText("[x] literal!");
  expect(await getMarkdown(labPage, id)).toBe(serialized);
  await cdp?.detach();
});
