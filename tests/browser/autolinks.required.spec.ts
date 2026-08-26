import {
  editorLocator,
  expect,
  focusEditor,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
} from "./fixtures";

test("@required bare autolinks survive CDP typing while plain paste stays literal", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "bare-autolink-fidelity";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const initial = [
    "Visit www.commonmark.org, https://example.com/a, and person@example.com.",
    "Type here",
  ].join("\n\n");

  await mountEditor(labPage, { entry: "root", id, markdown: initial, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const links = editor.locator("a");

  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute("href", "http://www.commonmark.org/");
  await expect(links.nth(1)).toHaveAttribute("href", "https://example.com/a");
  await expect(links.nth(2)).toHaveAttribute("href", "mailto:person@example.com");
  expect(await getMarkdown(labPage, id)).toBe(initial);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Type here", "end")
  ), id)).toBe(true);

  if (cdp) {
    await cdp.send("Input.insertText", { text: " (www.typora.io) " });
  } else {
    await labPage.keyboard.insertText(" (www.typora.io) ");
  }
  await settleEditor(labPage, id);
  const typed = `${initial} (www.typora.io) `;
  await expect(links).toHaveCount(4);
  await expect(links.nth(3)).toHaveAttribute("href", "http://www.typora.io/");
  expect(await getMarkdown(labPage, id)).toBe(typed);

  await resetEditor(labPage, id, typed);
  await settleEditor(labPage, id);
  await expect(links).toHaveCount(4);
  expect(await getMarkdown(labPage, id)).toBe(typed.trimEnd());

  await resetEditor(labPage, id, "Literal");
  await focusEditor(labPage, id, "all");
  expect(await runEditorCommand(labPage, id, {
    type: "pastePlainText",
    text: "www.literal.com",
  })).toBe(true);
  await settleEditor(labPage, id);
  const literal = "www\\.literal.com";
  await expect(links).toHaveCount(0);
  expect(await getMarkdown(labPage, id)).toBe(literal);

  await resetEditor(labPage, id, literal);
  await settleEditor(labPage, id);
  await expect(links).toHaveCount(0);
  expect(await getMarkdown(labPage, id)).toBe(literal);
  await cdp?.detach();
});
