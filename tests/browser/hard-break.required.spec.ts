import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required Shift-Enter inserts one undoable hard break in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = "alphaomega";
  const expected = "alpha\\\nomega";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressHardBreak = async () => {
    if (!cdp) {
      await labPage.keyboard.press("Shift+Enter");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Enter",
        key: "Enter",
        modifiers: 8,
        nativeVirtualKeyCode: 13,
        type,
        windowsVirtualKeyCode: 13,
      });
    }
  };

  for (const entry of ["root", "minimal"] as const) {
    const id = `hard-break-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: original, root: "shadow" });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end")
    ), id)).toBe(true);

    await pressHardBreak();
    await settleEditor(labPage, id);
    await expect(editorLocator(labPage, id).locator("br")).toHaveCount(1);
    expect(await getMarkdown(labPage, id)).toBe(expected);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);
  }

  await cdp?.detach();
});
