import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required list boundaries and zero starts survive edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const markdown = [
    "0. zero",
    "1. one",
    "",
    "* alpha",
    "- beta",
    "+ gamma",
    "",
    "1. first",
    "2) second",
    "3. third",
  ].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  for (const entry of ["root", "minimal"] as const) {
    const id = `list-fidelity-${entry}`;
    await mountEditor(labPage, { entry, id, markdown, root: "shadow" });
    const editor = editorLocator(labPage, id);
    await expect(editor.locator("ol").first()).toHaveAttribute("start", "0");
    expect(await editor.locator("ol").count()).toBe(4);
    expect(await editor.locator("ul").count()).toBe(3);
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "gamma", "end")
    ), id)).toBe(true);

    if (cdp) {
      await cdp.send("Input.insertText", { text: "!" });
    } else {
      await labPage.keyboard.insertText("!");
    }
    await settleEditor(labPage, id);
    const serialized = await getMarkdown(labPage, id);
    expect(serialized).toContain("0. zero\n1. one");
    expect(serialized).toContain("* alpha\n- beta\n* gamma!");
    expect(serialized).toContain("1. first\n2) second\n3. third");

    await resetEditor(labPage, id, serialized);
    await settleEditor(labPage, id);
    await expect(editor.locator("ol").first()).toHaveAttribute("start", "0");
    expect(await editor.locator("ol").count()).toBe(4);
    expect(await editor.locator("ul").count()).toBe(3);
    expect(await getMarkdown(labPage, id)).toBe(serialized);
  }

  await cdp?.detach();
});

test("@required Enter continues lists in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = "* parent";
  const continued = "* parent\n* ";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressEnter = async () => {
    if (!cdp) {
      await labPage.keyboard.press("Enter");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Enter",
        key: "Enter",
        nativeVirtualKeyCode: 13,
        type,
        windowsVirtualKeyCode: 13,
      });
    }
  };

  for (const entry of ["root", "minimal"] as const) {
    const id = `list-enter-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: original, root: "shadow" });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "parent", "end")
    ), id)).toBe(true);

    await pressEnter();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(continued);

    await pressEnter();
    await settleEditor(labPage, id);
    const editor = editorLocator(labPage, id);
    await expect(editor.locator(":scope > ul > li")).toHaveCount(1);
    await expect(editor.locator(":scope > p")).toHaveCount(1);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);
  }

  await cdp?.detach();
});

test("@required Tab indents and Shift-Tab outdents lists in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = "* parent\n* child";
  const nested = "* parent\n  * child";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressTab = async (shift = false) => {
    if (!cdp) {
      await labPage.keyboard.press(shift ? "Shift+Tab" : "Tab");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Tab",
        key: "Tab",
        modifiers: shift ? 8 : 0,
        nativeVirtualKeyCode: 9,
        type,
        windowsVirtualKeyCode: 9,
      });
    }
  };

  for (const entry of ["root", "minimal"] as const) {
    const id = `list-tab-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: original, root: "shadow" });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "child", "end")
    ), id)).toBe(true);
    await pressTab();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(nested);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);

    await resetEditor(labPage, id, nested);
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "child", "end")
    ), id)).toBe(true);
    await pressTab(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(nested);
  }

  await cdp?.detach();
});
