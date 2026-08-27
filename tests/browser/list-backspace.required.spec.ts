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

test("@required Backspace lifts list items before joining their content", async ({
  browserName,
  context,
  labPage,
}) => {
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
  const cases = [
    { markdown: "* alpha", result: "alpha", target: "alpha" },
    { markdown: "* alpha\n* beta", result: "alpha\n\n* beta", target: "alpha" },
    { markdown: "* alpha\n* beta", result: "* alpha\n\nbeta", target: "beta" },
    { markdown: "* alpha\n* beta\n* gamma", result: "* alpha\n\nbeta\n\n* gamma", target: "beta" },
    { markdown: "* parent\n  * child", result: "* parent\n* child", target: "child" },
    { markdown: "1. parent\n   1. child", result: "1. parent\n2. child", target: "child" },
    { markdown: "before\n\n* child", result: "before\n\nchild", target: "child" },
    { markdown: "* alpha\n\n  beta", result: "* alphabeta", target: "beta" },
  ] as const;

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `list-backspace-${entry}`;
      await mountEditor(labPage, { entry, id, markdown: "", root: "shadow" });
      const editor = editorLocator(labPage, id);

      for (const { markdown, result, target } of cases) {
        await resetEditor(labPage, id, markdown);
        expect(await labPage.evaluate(({ editorId, text }) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "start")
        ), { editorId: id, text: target })).toBe(true);
        await expect(editor).toBeFocused();

        await pressBackspace();
        await settleEditor(labPage, id);

        expect(await getMarkdown(labPage, id)).toBe(result);
        await expect(editor).toBeFocused();
        const selection = await labPage.evaluate(
          (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
          id,
        );
        expect(selection.anchor).toBe(selection.head);

        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(markdown);
      }

      if (entry === "root") {
        await resetEditor(labPage, id, "* [x] task");
        expect(await labPage.evaluate((editorId) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "task", "start")
        ), id)).toBe(true);
        await pressBackspace();
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe("task");
        const taskControl = editor.locator('[data-mdw-task-control="true"]');
        await expect(taskControl).toHaveCount(0);
        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe("* [x] task");
        await expect(taskControl).toHaveAttribute("aria-checked", "true");
      }

      const original = "* alpha\n* beta";
      const lifted = "* alpha\n\nbeta";
      await resetEditor(labPage, id, original);
      expect(await labPage.evaluate((editorId) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "start")
      ), id)).toBe(true);
      await pressBackspace();
      await pressBackspace();
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe("* alphabeta");

      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(lifted);
      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(original);
    }
  } finally {
    await cdp?.detach();
  }
});
