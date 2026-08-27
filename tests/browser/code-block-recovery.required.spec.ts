import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
} from "./fixtures";

test("@required Backspace unwraps a code block at its first caret in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = ["```js", "alpha", "beta", "```"].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressKey = async (key: "Backspace" | "Home") => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const virtualKeyCode = key === "Backspace" ? 8 : 36;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        nativeVirtualKeyCode: virtualKeyCode,
        type,
        windowsVirtualKeyCode: virtualKeyCode,
      });
    }
  };

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `code-block-recovery-${entry}`;
      await mountEditor(labPage, {
        entry,
        id,
        markdown: original,
        root: "shadow",
      });
      const editor = editorLocator(labPage, id);

      if (entry === "root") {
        await editor.locator(".cm-line").first().click();
      } else {
        await editor.locator("pre").click({ position: { x: 8, y: 8 } });
      }
      await pressKey("Home");
      await settleEditor(labPage, id);
      if (entry === "root") {
        await expect(editor.locator(".cm-content")).toBeFocused();
      } else {
        await expect(editor).toBeFocused();
      }
      expect((await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      )).anchor).toBe(1);
      await pressKey("Backspace");
      await settleEditor(labPage, id);

      expect(await getMarkdown(labPage, id)).toBe("alpha\n\nbeta");
      await expect(editor.locator("pre, .cm-editor")).toHaveCount(0);
      await expect(editor.locator("p")).toHaveCount(2);
      await expect(editor).toBeFocused();

      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(original);

      const empty = ["```js", "", "```"].join("\n");
      await resetEditor(labPage, id, empty);
      if (entry === "root") {
        await editor.locator(".cm-line").click();
      } else {
        await editor.locator("pre").click({ position: { x: 8, y: 8 } });
      }
      await pressKey("Home");
      await settleEditor(labPage, id);
      if (entry === "root") {
        await expect(editor.locator(".cm-content")).toBeFocused();
      } else {
        await expect(editor).toBeFocused();
      }
      await pressKey("Backspace");
      await settleEditor(labPage, id);

      expect(await getMarkdown(labPage, id)).toBe("");
      await expect(editor.locator("pre, .cm-editor")).toHaveCount(0);
      await expect(editor.locator("p")).toHaveCount(1);
    }
  } finally {
    await cdp?.detach();
  }
});
