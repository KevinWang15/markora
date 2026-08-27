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

test("@required trusted clicks place the caret in empty structural blocks", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const clickPoint = async (x: number, y: number) => {
    if (!cdp) {
      await labPage.mouse.click(x, y);
      return;
    }

    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      type: "mouseMoved",
      x,
      y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x,
      y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x,
      y,
    });
  };
  const typeCharacter = async () => {
    if (!cdp) {
      await labPage.keyboard.type("x");
      return;
    }

    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyX",
      key: "x",
      text: "x",
      type: "keyDown",
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyX",
      key: "x",
      type: "keyUp",
    });
  };
  const cases = [
    {
      markdown: "* alpha\n* ",
      result: "* alpha\n* x",
      selector: ":scope > ul > li:nth-child(2) > p",
    },
    {
      markdown: "* alpha\n* \n* beta",
      result: "* alpha\n* x\n* beta",
      selector: ":scope > ul > li:nth-child(2) > p",
    },
    {
      markdown: "1. alpha\n2. ",
      result: "1. alpha\n2. x",
      selector: ":scope > ol > li:nth-child(2) > p",
    },
    {
      markdown: "* parent\n  * child\n  * \n  * after",
      result: "* parent\n  * child\n  * x\n  * after",
      selector: ":scope > ul > li > ul > li:nth-child(2) > p",
    },
    {
      markdown: "#\n\nalpha",
      result: "# x\n\nalpha",
      selector: ":scope > h1",
    },
    {
      markdown: ">\n\nafter",
      result: "> x\n\nafter",
      selector: ":scope > blockquote > p",
    },
  ] as const;

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `empty-block-click-${entry}`;
      await mountEditor(labPage, { entry, id, markdown: "", root: "shadow" });
      const editor = editorLocator(labPage, id);

      for (const scenario of cases) {
        await resetEditor(labPage, id, scenario.markdown);
        await settleEditor(labPage, id);
        const editorBox = await editor.boundingBox();
        const firstBlockBox = await editor.locator(":scope > *").first().boundingBox();

        if (!editorBox || !firstBlockBox) {
          throw new Error("Missing editor geometry for the empty-block click primer.");
        }

        await clickPoint(
          editorBox.x + editorBox.width - 4,
          firstBlockBox.y + firstBlockBox.height / 2,
        );
        await resetEditor(labPage, id, scenario.markdown);
        await settleEditor(labPage, id);
        const canonical = await getMarkdown(labPage, id);
        const target = editor.locator(scenario.selector);
        const targetBox = await target.boundingBox();

        if (!targetBox) {
          throw new Error(`Missing empty target ${scenario.selector}.`);
        }

        await clickPoint(targetBox.x + 8, targetBox.y + targetBox.height / 2);
        await settleEditor(labPage, id);
        await expect(editor).toBeFocused();
        const selection = await labPage.evaluate(
          (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
          id,
        );
        expect(selection.anchor).toBe(selection.head);

        await typeCharacter();
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id), scenario.markdown).toBe(scenario.result);
        await expect(target).toContainText("x");

        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(canonical);
        await expect(target).not.toContainText("x");
      }
    }
  } finally {
    await cdp?.detach();
  }
});
