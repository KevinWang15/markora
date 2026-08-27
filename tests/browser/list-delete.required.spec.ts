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

test("@required Delete joins list boundaries without flattening nested branches", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressDelete = async () => {
    if (!cdp) {
      await labPage.keyboard.press("Delete");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Delete",
        key: "Delete",
        nativeVirtualKeyCode: 46,
        type,
        windowsVirtualKeyCode: 46,
      });
    }
  };
  const branching = [
    "* Item 1",
    "  * Item 1.1",
    "    * Item 1.1.1",
    "    * Item 1.1.2",
    "  * Item 1.2",
    "* Item 2",
  ].join("\n");
  const branchingHoisted = [
    "* Item 1",
    "* Item 1.1",
    "  * Item 1.1.1",
    "  * Item 1.1.2",
    "* Item 1.2",
    "* Item 2",
  ].join("\n");
  const cases = [
    { markdown: "* alpha\n* beta", result: "* alphabeta", target: "alpha" },
    { markdown: "3. alpha\n4. beta", result: "3. alphabeta", target: "alpha" },
    { markdown: "* alpha\n* **beta**", result: "* alpha**beta**", target: "alpha" },
    { markdown: "* Outer\n  * Inner", result: "* OuterInner", target: "Outer" },
    {
      markdown: "* Outer\n  * Inner 1\n  * Inner 2\n* Next",
      result: "* OuterInner 1\n* Inner 2\n* Next",
      target: "Outer",
    },
    { markdown: branching, result: branchingHoisted, target: "Item 1" },
    {
      markdown: "* parent\n  * child\n* after",
      result: "* parent\n  * childafter",
      target: "child",
    },
    {
      markdown: "* parent\n  * alpha\n  * beta",
      result: "* parent\n  * alphabeta",
      target: "alpha",
    },
    { markdown: "* alpha\n\nbeta", result: "* alphabeta", target: "alpha" },
    {
      markdown: "* alpha\n* beta\n\nafter",
      result: "* alphabeta\n\nafter",
      target: "alpha",
    },
    {
      markdown: "* alpha\n* beta\n  * child\n* gamma",
      result: "* alphabeta\n  * child\n* gamma",
      target: "alpha",
    },
    {
      markdown: "* alpha\n\n  beta\n\n* gamma",
      result: "* alphabeta\n\n* gamma",
      target: "alpha",
    },
  ] as const;

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `list-delete-${entry}`;
      await mountEditor(labPage, { entry, id, markdown: "", root: "shadow" });
      const editor = editorLocator(labPage, id);

      for (const { markdown, result, target } of cases) {
        await resetEditor(labPage, id, markdown);
        expect(await labPage.evaluate(({ editorId, text }) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "end")
        ), { editorId: id, text: target })).toBe(true);
        await expect(editor).toBeFocused();

        await pressDelete();
        await settleEditor(labPage, id);

        expect(await getMarkdown(labPage, id)).toBe(result);
        await expect(editor).toBeFocused();
        await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(0);
        const selection = await labPage.evaluate(
          (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
          id,
        );
        expect(selection.anchor).toBe(selection.head);

        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(markdown);
      }

      await resetEditor(labPage, id, branching);
      expect(await labPage.evaluate((editorId) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Item 1", "end")
      ), id)).toBe(true);
      await pressDelete();
      await pressDelete();
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe([
        "* Item 1Item 1.1",
        "  * Item 1.1.1",
        "  * Item 1.1.2",
        "* Item 1.2",
        "* Item 2",
      ].join("\n"));
      await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(0);

      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(branchingHoisted);
      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(branching);

      if (entry === "root") {
        const tasks = "* [ ] alpha\n* [x] beta";
        await resetEditor(labPage, id, tasks);
        expect(await labPage.evaluate((editorId) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end")
        ), id)).toBe(true);
        await pressDelete();
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe("* [ ] alphabeta");
        const taskControl = editor.locator('[data-mdw-task-control="true"]');
        await expect(taskControl).toHaveCount(1);
        await expect(taskControl).toHaveAttribute("aria-checked", "false");
        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(tasks);
        await expect(taskControl).toHaveCount(2);
        await expect(taskControl.nth(1)).toHaveAttribute("aria-checked", "true");
      }
    }
  } finally {
    await cdp?.detach();
  }
});
