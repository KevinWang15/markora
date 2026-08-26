import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required long tilde runs remain literal through CDP edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "strikethrough-delimiter-fidelity";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await mountEditor(labPage, {
    entry: "root",
    id,
    markdown: "This will ~~~not~~~ strike, but ~~this~~ will.",
    root: "shadow",
  });
  const editor = editorLocator(labPage, id);

  await expect(editor.locator("del")).toHaveCount(1);
  await expect(editor.locator("del")).toHaveText("this");
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "not", "end")
  ), id)).toBe(true);

  if (cdp) {
    await cdp.send("Input.insertText", { text: "!" });
  } else {
    await labPage.keyboard.insertText("!");
  }
  await settleEditor(labPage, id);
  const serialized = "This will ~~~not!~~~ strike, but ~~this~~ will.";
  expect(await getMarkdown(labPage, id)).toBe(serialized);

  await resetEditor(labPage, id, serialized);
  await settleEditor(labPage, id);
  await expect(editor.locator("del")).toHaveCount(1);
  await expect(editor.locator("del")).toHaveText("this");
  expect(await getMarkdown(labPage, id)).toBe(serialized);
  await cdp?.detach();
});
