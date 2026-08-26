import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

test("@required native select-all replacement respects the active editing surface", async ({
  browserName,
  context,
  labPage,
}) => {
  const markdown = [
    "Before **bold**.",
    "",
    "```js",
    "const x = 1;",
    "const y = 2;",
    "```",
    "",
    "| A | B |",
    "| --- | --- |",
    "| C | D |",
    "",
    "After.",
  ].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressControlKey = async (code: "KeyA" | "KeyY" | "KeyZ", key: "a" | "y" | "z") => {
    if (!cdp) {
      await labPage.keyboard.press(`ControlOrMeta+${key.toUpperCase()}`);
      return;
    }

    const keyCode = key.toUpperCase().charCodeAt(0);
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code,
        key,
        modifiers: 2,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const insertText = async (text: string) => {
    if (cdp) {
      await cdp.send("Input.insertText", { text });
    } else {
      await labPage.keyboard.insertText(text);
    }
  };

  const outerId = "outer-native-select-all";
  await mountEditor(labPage, {
    id: outerId,
    markdown,
    root: "shadow",
  });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "bold", "end")
  ), outerId)).toBe(true);
  await settleEditor(labPage, outerId);

  await pressControlKey("KeyA", "a");
  await settleEditor(labPage, outerId);
  const all = (await snapshotEditor(labPage, outerId)).selection;
  expect(all.from).toBe(0);
  expect(all.to).toBeGreaterThan(0);
  expect(all.anchor).toBe(all.from);
  expect(all.head).toBe(all.to);

  await insertText("X");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("X");
  await pressControlKey("KeyZ", "z");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe(markdown);
  await pressControlKey("KeyY", "y");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("X");

  const codeId = "code-native-select-all";
  await mountEditor(labPage, {
    id: codeId,
    markdown,
    root: "shadow",
  });
  await editorLocator(labPage, codeId).locator(".cm-content").click();
  await settleEditor(labPage, codeId);
  await pressControlKey("KeyA", "a");
  await insertText("X");
  await settleEditor(labPage, codeId);
  expect(await getMarkdown(labPage, codeId)).toBe(markdown.replace(
    "const x = 1;\nconst y = 2;",
    "X",
  ));
  const codeSnapshot = await snapshotEditor(labPage, codeId);
  expect(codeSnapshot.codeMirrorFocused).toBe(true);
  expect(codeSnapshot.prosemirrorFocused).toBe(false);
  await pressControlKey("KeyZ", "z");
  await settleEditor(labPage, codeId);
  expect(await getMarkdown(labPage, codeId)).toBe(markdown);

  await cdp?.detach();
});

test("@required native rich-text drag moves one undoable semantic slice", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-rich-text-drag";
  const markdown = "alpha **beta** gamma delta";
  await mountEditor(labPage, { id, markdown, root: "shadow" });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), id)).toBe(true);
  await settleEditor(labPage, id);

  const points = await editorLocator(labPage, id).evaluate((element) => {
    const textPoint = (needle: string, offset: number, side: "after" | "before") => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        const index = text.data.indexOf(needle);
        if (index < 0) continue;
        const range = element.ownerDocument.createRange();
        range.setStart(text, index + offset);
        range.setEnd(text, index + offset + 1);
        const rect = range.getBoundingClientRect();
        return {
          x: side === "after" ? rect.right - 1 : rect.left + 1,
          y: rect.top + rect.height / 2,
        };
      }
      throw new Error(`Missing ${JSON.stringify(needle)} drag target.`);
    };
    return {
      start: textPoint("beta", 1, "before"),
      target: textPoint("delta", 4, "after"),
    };
  });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  if (cdp) {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      type: "mouseMoved",
      x: points.start.x,
      y: points.start.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: points.start.x,
      y: points.start.y,
    });
    for (let step = 1; step <= 30; step += 1) {
      const progress = step / 30;
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        type: "mouseMoved",
        x: points.start.x + (points.target.x - points.start.x) * progress,
        y: points.start.y + (points.target.y - points.start.y) * progress,
      });
    }
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: points.target.x,
      y: points.target.y,
    });
  } else {
    await labPage.mouse.move(points.start.x, points.start.y);
    await labPage.mouse.down();
    await labPage.mouse.move(points.target.x, points.target.y, { steps: 30 });
    await labPage.mouse.up();
  }
  await settleEditor(labPage, id);

  expect(await getMarkdown(labPage, id)).toBe("alpha  gamma delta**beta**");
  const moved = (await snapshotEditor(labPage, id)).selection;
  expect(moved.to - moved.from).toBe("beta".length);
  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha  gamma delta**beta**");

  await cdp?.detach();
});
