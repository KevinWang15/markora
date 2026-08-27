import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required heading marker keys change one level in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = "### title";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressBackspace = async () => {
    if (!cdp) {
      await labPage.keyboard.press("Backspace");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Backspace",
        key: "Backspace",
        nativeVirtualKeyCode: 8,
        type,
        windowsVirtualKeyCode: 8,
      });
    }
  };
  const typeHash = async () => {
    if (!cdp) {
      await labPage.keyboard.insertText("#");
      return;
    }

    await cdp.send("Input.insertText", { text: "#" });
  };

  for (const entry of ["root", "minimal"] as const) {
    const id = `heading-marker-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: original, root: "shadow" });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "title", "start")
    ), id)).toBe(true);

    await pressBackspace();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("## title");
    await expect(editorLocator(labPage, id).locator("h2")).toHaveCount(1);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);

    await typeHash();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("#### title");
    await expect(editorLocator(labPage, id).locator("h4")).toHaveCount(1);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);
  }

  await cdp?.detach();
});
