import {
  editorLocator,
  expect,
  focusEditor,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required Backspace restores literal Markdown after a root or minimal input rule", async ({
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
    { input: "# ", literal: "\\# ", selector: "h1" },
    { input: "> ", literal: "\\> ", selector: "blockquote" },
    { input: "* ", literal: "\\* ", selector: "ul" },
    { input: "3. ", literal: "3\\. ", selector: "ol" },
    { input: "*em*", literal: "\\*em\\*", selector: "em" },
    { input: "**bold**", literal: "\\*\\*bold\\*\\*", selector: "strong" },
    { input: "`code`", literal: "\\`code\\`", selector: "code" },
    { input: "[link](/target)", literal: "\\[link\\](/target)", selector: "a" },
    { input: "![alt](/image.png)", literal: "!\\[alt\\](/image.png)", selector: "img[src='/image.png']" },
    { input: "```js ", literal: "\\`\\`\\`js ", selector: "pre" },
  ] as const;

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `input-rule-recovery-${entry}`;
      await mountEditor(labPage, {
        entry,
        id,
        markdown: "",
        root: "shadow",
      });
      const editor = editorLocator(labPage, id);

      for (const { input, literal, selector } of cases) {
        await resetEditor(labPage, id, "");
        await focusEditor(labPage, id, "end");
        await typeText(input);
        await settleEditor(labPage, id);

        await expect(editor.locator(selector)).toHaveCount(1);
        if (selector === "pre" && entry === "root") {
          await expect(editor.locator(".cm-content")).toBeFocused();
        } else {
          await expect(editor).toBeFocused();
        }

        await pressBackspace();
        await settleEditor(labPage, id);

        expect(await getMarkdown(labPage, id)).toBe(literal);
        await expect(editor.locator(selector)).toHaveCount(0);
        await expect(editor).toBeFocused();
      }
    }
  } finally {
    await cdp?.detach();
  }
});
