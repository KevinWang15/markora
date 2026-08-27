import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required typed CommonMark shortcuts transform in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const typeText = async (text: string) => {
    for (const character of text) {
      if (cdp) {
        await cdp.send("Input.insertText", { text: character });
      } else {
        await labPage.keyboard.insertText(character);
      }
    }
  };
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
    const id = `foundation-typing-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: "", root: "shadow" });
    const editor = editorLocator(labPage, id);
    const cases = [
      { input: "# title", markdown: "# title", selectors: ["h1"] },
      { input: "> quote", markdown: "> quote", selectors: ["blockquote"] },
      { input: "* item", markdown: "* item", selectors: ["ul", "li"] },
      { input: "3. item", markdown: "3. item", selectors: ["ol", "li"] },
      {
        input: "**bold** *em* `code` [docs](/docs)",
        markdown: "**bold** *em* `code` [docs](/docs)",
        selectors: ["strong", "em", "code", "a[href='/docs']"],
      },
      {
        input: "![alt](/asset.png)",
        markdown: "![alt](/asset.png)",
        selectors: [".mdw-image-standalone", "img[src='/asset.png']"],
      },
    ] as const;

    for (const scenario of cases) {
      expect(await resetEditor(labPage, id, "")).toBe("");
      await editor.locator("p").click();
      await typeText(scenario.input);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(scenario.markdown);
      for (const selector of scenario.selectors) {
        await expect(editor.locator(selector)).toHaveCount(1);
      }
    }

    expect(await resetEditor(labPage, id, "")).toBe("");
    await editor.locator("p").click();
    await typeText("---");
    await pressEnter();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("---");
    await expect(editor.locator("hr")).toHaveCount(1);

    expect(await resetEditor(labPage, id, "")).toBe("");
    await editor.locator("p").click();
    await typeText("```js");
    await pressEnter();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("```js\n\n```");
    await expect(editor.locator("pre")).toHaveCount(1);
  }

  await cdp?.detach();
});
