import type { Locator, Page } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

async function focusTextEnd(page: Page, editor: Locator) {
  await editor.click();
  await page.keyboard.press("End");
}

async function startSyntheticComposition(editor: Locator, text: string) {
  return editor.evaluate(async (element, nextText) => {
    const ownerDocument = element.ownerDocument;
    const ownerWindow = ownerDocument.defaultView!;
    element.dispatchEvent(new ownerWindow.CompositionEvent("compositionstart", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: "",
    }));
    element.dispatchEvent(new ownerWindow.CompositionEvent("compositionupdate", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: nextText,
    }));

    let inserted = ownerDocument.execCommand("insertText", false, nextText);

    if (!inserted) {
      const selection = ownerDocument.getSelection();

      if (!selection?.rangeCount) {
        throw new Error("Synthetic composition has no DOM selection.");
      }

      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = ownerDocument.createTextNode(nextText);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new ownerWindow.InputEvent("input", {
        bubbles: true,
        composed: true,
        data: nextText,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      inserted = true;
    }

    await Promise.resolve();
    return inserted;
  }, text);
}

async function endSyntheticComposition(editor: Locator, text: string) {
  await editor.evaluate((element, finalText) => {
    const ownerWindow = element.ownerDocument.defaultView!;
    element.dispatchEvent(new ownerWindow.CompositionEvent("compositionend", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: finalText,
    }));
  }, text);
}

function containsLoneSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }

      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

test("@required CJK composition stays textual until commit", async ({ labPage }) => {
  const id = "composition";
  await mountEditor(labPage, { id, markdown: "" });
  const editor = editorLocator(labPage, id);

  for (const text of ["中文输入", "日本語入力", "한국어 입력"] as const) {
    await resetEditor(labPage, id, "");
    await focusTextEnd(labPage, editor.locator("p"));
    expect(await startSyntheticComposition(editor, text)).toBe(true);
    await expect(editor.locator("p")).toHaveText(text);
    await expect(editor.locator("h1, .mdw-image, .mdw-code-block")).toHaveCount(0);
    await endSyntheticComposition(editor, text);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(text);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("");
  }

  const codeText = "日本語と한국어";
  await resetEditor(labPage, id, ["```text", "", "```"].join("\n"));
  const codeMirror = editor.locator(".cm-content");
  await focusTextEnd(labPage, codeMirror);
  expect(await startSyntheticComposition(codeMirror, codeText)).toBe(true);
  await expect(codeMirror).toContainText(codeText);
  await endSyntheticComposition(codeMirror, codeText);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(["```text", codeText, "```"].join("\n"));

  const imageSyntax = "![中文](/composition.png)";
  await resetEditor(labPage, id, "");
  await focusTextEnd(labPage, editor.locator("p"));
  expect(await startSyntheticComposition(editor, imageSyntax)).toBe(true);
  await expect(editor.locator(".mdw-image")).toHaveCount(0);
  await expect(editor.locator("p")).toContainText(imageSyntax);

  await endSyntheticComposition(editor, imageSyntax);
  await settleEditor(labPage, id);
  await expect(editor.locator(".mdw-image")).toHaveCount(1);
  expect(await getMarkdown(labPage, id)).toBe(imageSyntax);
});

test("@required Chromium CDP preserves active IME image syntax", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP IME control.");

  const id = "cdp-composition";
  const imageSyntax = "![中文](/cdp.png)";
  await mountEditor(labPage, { id, markdown: "" });
  const editor = editorLocator(labPage, id);
  await focusTextEnd(labPage, editor.locator("p"));

  const cdp = await context.newCDPSession(labPage);
  await cdp.send("Input.imeSetComposition", {
    text: "zhong",
    selectionStart: "zhong".length,
    selectionEnd: "zhong".length,
  });
  await cdp.send("Input.imeSetComposition", {
    text: "中文",
    selectionStart: "中文".length,
    selectionEnd: "中文".length,
  });
  await expect(editor.locator("p")).toHaveText("中文");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.can(editorId, {
      type: "setHeading",
      level: 2,
    }),
    id,
  )).toBe(false);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, {
      type: "setHeading",
      level: 2,
    }),
    id,
  )).toBe(false);
  await expect(editor.locator("p")).toHaveText("中文");
  await cdp.send("Input.insertText", { text: "中文" });
  await settleEditor(labPage, id);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, {
      type: "setHeading",
      level: 2,
    }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("h2")).toContainText("中文");
  expect(await getMarkdown(labPage, id)).toBe("## 中文");

  await resetEditor(labPage, id, "");
  await focusTextEnd(labPage, editor.locator("p"));
  await cdp.send("Input.imeSetComposition", {
    text: imageSyntax,
    selectionStart: imageSyntax.length,
    selectionEnd: imageSyntax.length,
  });

  await expect(editor.locator("p")).toContainText(imageSyntax);
  await expect(editor.locator(".mdw-image")).toHaveCount(0);

  await cdp.send("Input.insertText", { text: imageSyntax });
  await settleEditor(labPage, id);
  await expect(editor.locator(".mdw-image")).toHaveCount(1);
  expect(await getMarkdown(labPage, id)).toBe(imageSyntax);
});

test("@required Chromium CDP preserves rich text across IME replacement and cancellation", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP IME control.");

  const id = "cdp-selection-composition";
  const original = "before **selected** after";
  await mountEditor(labPage, { id, markdown: original });
  const editor = editorLocator(labPage, id);
  const cdp = await context.newCDPSession(labPage);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "selected", "all"),
    id,
  )).toBe(true);
  await cdp.send("Input.imeSetComposition", {
    text: "候補",
    selectionStart: "候補".length,
    selectionEnd: "候補".length,
  });
  await expect(editor.locator("strong")).toHaveText("候補");

  await cdp.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await settleEditor(labPage, id);
  await expect(editor.locator("strong")).toHaveCount(0);
  expect(await getMarkdown(labPage, id)).toBe("before  after");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("strong")).toHaveText("selected");
  expect(await getMarkdown(labPage, id)).toBe(original);

  await resetEditor(labPage, id, original);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "selected", "all"),
    id,
  )).toBe(true);
  await cdp.send("Input.imeSetComposition", {
    text: "変換",
    selectionStart: "変換".length,
    selectionEnd: "変換".length,
  });
  await cdp.send("Input.insertText", { text: "確定" });
  await settleEditor(labPage, id);
  await expect(editor.locator("strong")).toHaveText("確定");
  expect(await getMarkdown(labPage, id)).toBe("before **確定** after");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("strong")).toHaveText("selected");
  expect(await getMarkdown(labPage, id)).toBe(original);
});

test("@required Chromium CDP continues completed tasks as unchecked items", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing raw CDP key events.");

  const id = "cdp-task-continuation";
  const original = "* [x] completed";
  await mountEditor(labPage, { id, markdown: original });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "completed", "end"),
    id,
  )).toBe(true);

  const cdp = await context.newCDPSession(labPage);
  for (const type of ["rawKeyDown", "keyUp"] as const) {
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      nativeVirtualKeyCode: 13,
      type,
      windowsVirtualKeyCode: 13,
    });
  }
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("* [x] completed\n* [ ] ");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "completed", "start"),
    id,
  )).toBe(true);
  for (const type of ["rawKeyDown", "keyUp"] as const) {
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      nativeVirtualKeyCode: 13,
      type,
      windowsVirtualKeyCode: 13,
    });
  }
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("* [ ] \n* [x] completed");
});

test("@required dead-key output, emoji, and surrogate deletion remain intact", async ({ labPage }) => {
  const id = "unicode";
  await mountEditor(labPage, { id, markdown: "" });
  const paragraph = editorLocator(labPage, id).locator("p");
  await focusTextEnd(labPage, paragraph);

  const deadKeyPrevented = await paragraph.evaluate((element) => {
    const ownerWindow = element.ownerDocument.defaultView!;
    const event = new ownerWindow.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Quote",
      key: "Dead",
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(deadKeyPrevented).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("");

  const unicode = "é e\u0301 😀 👩‍💻 👍🏽 🇨🇳";
  await labPage.keyboard.insertText(unicode);
  await settleEditor(labPage, id);
  const markdown = await getMarkdown(labPage, id);
  expect(markdown).toBe(unicode);
  expect(markdown).not.toContain("�");
  expect(containsLoneSurrogate(markdown)).toBe(false);

  await resetEditor(labPage, id, "A😀");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A😀", "end"),
    id,
  )).toBe(true);
  await labPage.keyboard.press("Backspace");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("A");
});

test("@required mixed bidirectional text can be selected and replaced logically", async ({ labPage }) => {
  const id = "bidi";
  await mountEditor(labPage, {
    direction: "rtl",
    id,
    markdown: "abc אבג 123 العربية",
  });

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "אבג", "all"),
    id,
  )).toBe(true);
  expect(await labPage.evaluate(() => document.getSelection()?.toString())).toBe("אבג");

  await labPage.keyboard.insertText("שלום");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("abc שלום 123 العربية");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "العربية", "all"),
    id,
  )).toBe(true);
  expect(await labPage.evaluate(() => document.getSelection()?.toString())).toBe("العربية");
});

test("@required composition at a managed table boundary materializes an editable paragraph", async ({ labPage }) => {
  const id = "managed-composition";
  const tableMarkdown = [
    "| A | B |",
    "| --- | --- |",
    "| one | two |",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: tableMarkdown });
  const editor = editorLocator(labPage, id);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A", "start"),
    id,
  )).toBe(true);
  await labPage.keyboard.press("ArrowLeft");
  await expect(editor.locator("table.mdw-managed-block-cursor-before")).toHaveCount(1);

  const text = "表の前";
  expect(await startSyntheticComposition(editor, text)).toBe(true);
  await expect(editor.locator("table.mdw-managed-block-cursor-before")).toHaveCount(0);
  await endSyntheticComposition(editor, text);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(`${text}\n\n${tableMarkdown}`);
});
