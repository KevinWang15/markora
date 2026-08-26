import type { Locator, Page } from "@playwright/test";
import {
  clearEditorEvents,
  editorLocator,
  expect,
  getEditorEvents,
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

test("@required native history stays synchronized across browser engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-history";
  await mountEditor(labPage, { id, markdown: "alpha" });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);

  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
  const runNativeHistory = async (command: "redo" | "undo") => {
    if (cdp) {
      return (await cdp.send("Runtime.evaluate", {
        expression: `document.execCommand(${JSON.stringify(command)})`,
        returnByValue: true,
      })).result.value;
    }

    return labPage.evaluate((nextCommand) => document.execCommand(nextCommand), command);
  };

  if (cdp) {
    await cdp.send("Input.insertText", { text: "!" });
  } else {
    await labPage.keyboard.insertText("!");
  }
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha!");

  expect(await runNativeHistory("undo")).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.can(editorId, { type: "undo" }),
    id,
  )).toBe(false);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.can(editorId, { type: "redo" }),
    id,
  )).toBe(true);

  expect(await runNativeHistory("redo")).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha!");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.can(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.can(editorId, { type: "redo" }),
    id,
  )).toBe(false);
});

test("@required Chromium CDP deletes across a managed table and restores it natively", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP native input control.");

  const id = "cdp-managed-range-delete";
  const original = [
    "before alpha",
    "",
    "| A | B |",
    "| --- | --- |",
    "| one | two |",
    "",
    "omega after",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original });

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "start"),
    id,
  )).toBe(true);
  const from = await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection.from,
    id,
  );
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "omega", "end"),
    id,
  )).toBe(true);
  const to = await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection.to,
    id,
  );
  await labPage.evaluate(
    ({ editorId, anchor, head }) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, { anchor, head }),
    { anchor: from, editorId: id, head: to },
  );
  expect(await labPage.evaluate(() => document.getSelection()?.toString())).toContain("one");

  const cdp = await context.newCDPSession(labPage);
  expect((await cdp.send("Runtime.evaluate", {
    expression: 'document.execCommand("delete")',
    returnByValue: true,
  })).result.value).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("before  after");

  expect((await cdp.send("Runtime.evaluate", {
    expression: 'document.execCommand("undo")',
    returnByValue: true,
  })).result.value).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
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

test("@required marked grapheme clusters delete atomically across engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "cdp-marked-grapheme-delete";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressDeletionKey = async (key: "Backspace" | "Delete") => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const keyCode = key === "Backspace" ? 8 : 46;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const cases = [
    "e**́**",
    "👩**‍**💻",
    "👍**🏽**",
    "🇨**🇳**",
  ] as const;

  for (const grapheme of cases) {
    const markdown = `A${grapheme}Z`;
    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Z", "start"),
      id,
    )).toBe(true);
    await pressDeletionKey("Backspace");
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("AZ");
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(markdown);

    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A", "end"),
      id,
    )).toBe(true);
    await pressDeletionKey("Delete");
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("AZ");
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(markdown);
  }

  await resetEditor(labPage, id, "Ae**́Z**Q");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Z", "start"),
    id,
  )).toBe(true);
  await pressDeletionKey("Backspace");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("A**Z**Q");

  await resetEditor(labPage, id, "A**Xe**́Z");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "e", "start"),
    id,
  )).toBe(true);
  await pressDeletionKey("Delete");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("A**X**Z");
});

test("@required word deletion ignores Markdown mark boundaries across engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "cdp-marked-word-delete";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressWordDeletion = async (key: "Backspace" | "Delete") => {
    if (!cdp) {
      await labPage.keyboard.press(`Control+${key}`);
      return;
    }

    const keyCode = key === "Backspace" ? 8 : 46;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: 2,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const deleteFrom = async (
    markdown: string,
    needle: string,
    mode: "end" | "start",
    key: "Backspace" | "Delete",
  ) => {
    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(
      ({ editorId, nextNeedle, nextMode }) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, nextNeedle, nextMode)
      ),
      { editorId: id, nextMode: mode, nextNeedle: needle },
    )).toBe(true);
    await settleEditor(labPage, id);
    await clearEditorEvents(labPage, id);
    await pressWordDeletion(key);
    await settleEditor(labPage, id);
    await expect(editorLocator(labPage, id)).toBeFocused();
    const events = await getEditorEvents(labPage, id);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    const result = await editorLocator(labPage, id).textContent();
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(markdown);
    return result;
  };

  for (const testCase of [
    {
      backwardNeedle: "beta",
      forwardNeedle: "alpha",
      marked: "alpha**beta** gamma",
      plain: "alphabeta gamma",
      plainNeedle: "alphabeta",
    },
    {
      backwardNeedle: "beta",
      forwardNeedle: "alpha",
      marked: "alpha[beta](/word) gamma",
      plain: "alphabeta gamma",
      plainNeedle: "alphabeta",
    },
    {
      backwardNeedle: "'t",
      forwardNeedle: "can",
      marked: "**can**'t next",
      plain: "can't next",
      plainNeedle: "can't",
    },
    {
      backwardNeedle: "пожаловать",
      forwardNeedle: "добро",
      marked: "добро**пожаловать** мир",
      plain: "добропожаловать мир",
      plainNeedle: "добропожаловать",
    },
  ] as const) {
    const plainBackward = await deleteFrom(
      testCase.plain,
      testCase.plainNeedle,
      "end",
      "Backspace",
    );
    const markedBackward = await deleteFrom(
      testCase.marked,
      testCase.backwardNeedle,
      "end",
      "Backspace",
    );
    expect(markedBackward).toBe(plainBackward);

    const plainForward = await deleteFrom(
      testCase.plain,
      testCase.plainNeedle,
      "start",
      "Delete",
    );
    const markedForward = await deleteFrom(
      testCase.marked,
      testCase.forwardNeedle,
      "start",
      "Delete",
    );
    expect(markedForward).toBe(plainForward);
  }

  if (browserName === "firefox") {
    const handoffMarkdown = "alpha**beta** gamma";
    await resetEditor(labPage, id, handoffMarkdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    await labPage.evaluate(() => {
      const button = document.createElement("button");
      button.id = "word-probe-focus-handoff";
      button.textContent = "Host focus target";
      document.body.append(button);
      document.addEventListener("focusin", (event) => {
        const target = event.target;

        if (
          target instanceof HTMLElement
          && target.isContentEditable
          && target.getAttribute("aria-hidden") === "true"
        ) {
          button.focus();
        }
      }, { capture: true, once: true });
    });
    await pressWordDeletion("Backspace");
    await settleEditor(labPage, id);
    await expect(labPage.locator("#word-probe-focus-handoff")).toBeFocused();
    expect(await getMarkdown(labPage, id)).toBe(handoffMarkdown);
    await labPage.locator("#word-probe-focus-handoff").evaluate((button) => button.remove());

    await resetEditor(labPage, id, handoffMarkdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    await labPage.evaluate((editorId) => {
      document.addEventListener("focusin", (event) => {
        const target = event.target;

        if (
          target instanceof HTMLElement
          && target.isContentEditable
          && target.getAttribute("aria-hidden") === "true"
        ) {
          window.__MARKORA_BROWSER_LAB__!.reset(editorId, "host replacement");
        }
      }, { capture: true, once: true });
    }, id);
    await pressWordDeletion("Backspace");
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("host replacement");
  }
});

test("@required word navigation ignores Markdown mark boundaries across engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "marked-word-navigation";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressWordNavigation = async (
    key: "ArrowLeft" | "ArrowRight",
    extend: boolean,
  ) => {
    if (!cdp) {
      await labPage.keyboard.press(`${extend ? "Control+Shift" : "Control"}+${key}`);
      return;
    }

    const keyCode = key === "ArrowLeft" ? 37 : 39;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: extend ? 10 : 2,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const navigateFrom = async (
    markdown: string,
    needle: string,
    mode: "end" | "start",
    key: "ArrowLeft" | "ArrowRight",
    extend: boolean,
    editorId = id,
  ) => {
    await resetEditor(labPage, editorId, markdown);
    expect(await labPage.evaluate(
      ({ editorId, nextNeedle, nextMode }) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, nextNeedle, nextMode)
      ),
      { editorId, nextMode: mode, nextNeedle: needle },
    )).toBe(true);
    await settleEditor(labPage, editorId);
    await clearEditorEvents(labPage, editorId);
    await pressWordNavigation(key, extend);
    await settleEditor(labPage, editorId);
    await expect(editorLocator(labPage, editorId)).toBeFocused();
    const events = await getEditorEvents(labPage, editorId);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    expect(await getMarkdown(labPage, editorId)).toBe(markdown);
    return labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
      editorId,
    );
  };

  for (const testCase of [
    {
      backwardNeedle: "beta",
      forwardNeedle: "alpha",
      marked: "alpha**beta** gamma",
      plain: "alphabeta gamma",
      plainNeedle: "alphabeta",
    },
    {
      backwardNeedle: "beta",
      forwardNeedle: "alpha",
      marked: "alpha[beta](/word-navigation) gamma",
      plain: "alphabeta gamma",
      plainNeedle: "alphabeta",
    },
    {
      backwardNeedle: "пожаловать",
      forwardNeedle: "добро",
      marked: "добро**пожаловать** мир",
      plain: "добропожаловать мир",
      plainNeedle: "добропожаловать",
    },
  ] as const) {
    for (const extend of [false, true]) {
      const plainBackward = await navigateFrom(
        testCase.plain,
        testCase.plainNeedle,
        "end",
        "ArrowLeft",
        extend,
      );
      const markedBackward = await navigateFrom(
        testCase.marked,
        testCase.backwardNeedle,
        "end",
        "ArrowLeft",
        extend,
      );
      const wordStart = 1;
      const wordEnd = wordStart + testCase.plainNeedle.length;
      expect(plainBackward).toEqual(extend
        ? { anchor: wordEnd, from: wordStart, head: wordStart, to: wordEnd }
        : { anchor: wordStart, from: wordStart, head: wordStart, to: wordStart });
      expect(markedBackward).toEqual(plainBackward);

      const plainForward = await navigateFrom(
        testCase.plain,
        testCase.plainNeedle,
        "start",
        "ArrowRight",
        extend,
      );
      const markedForward = await navigateFrom(
        testCase.marked,
        testCase.forwardNeedle,
        "start",
        "ArrowRight",
        extend,
      );
      expect(plainForward).toEqual(extend
        ? { anchor: wordStart, from: wordStart, head: wordEnd, to: wordEnd }
        : { anchor: wordEnd, from: wordEnd, head: wordEnd, to: wordEnd });
      expect(markedForward).toEqual(plainForward);
    }
  }

  const rtlId = "rtl-marked-word-navigation";
  await mountEditor(labPage, { direction: "rtl", id: rtlId, markdown: "" });

  for (const extend of [false, true]) {
    const plainLeft = await navigateFrom(
      "אבגדהו זחט",
      "אבגדהו",
      "start",
      "ArrowLeft",
      extend,
      rtlId,
    );
    const markedLeft = await navigateFrom(
      "אבג**דהו** זחט",
      "אבג",
      "start",
      "ArrowLeft",
      extend,
      rtlId,
    );
    expect(markedLeft).toEqual(plainLeft);

    const plainRight = await navigateFrom(
      "אבגדהו זחט",
      "אבגדהו",
      "end",
      "ArrowRight",
      extend,
      rtlId,
    );
    const markedRight = await navigateFrom(
      "אבג**דהו** זחט",
      "דהו",
      "end",
      "ArrowRight",
      extend,
      rtlId,
    );
    expect(markedRight).toEqual(plainRight);
  }

  if (browserName === "firefox") {
    const handoffMarkdown = "alpha**beta** gamma";
    await resetEditor(labPage, id, handoffMarkdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    await labPage.evaluate(() => {
      const button = document.createElement("button");
      button.id = "word-navigation-probe-focus-handoff";
      button.textContent = "Host focus target";
      document.body.append(button);
      document.addEventListener("focusin", (event) => {
        const target = event.target;

        if (
          target instanceof HTMLElement
          && target.isContentEditable
          && target.getAttribute("aria-hidden") === "true"
        ) {
          button.focus();
        }
      }, { capture: true, once: true });
    });
    await pressWordNavigation("ArrowLeft", true);
    await settleEditor(labPage, id);
    await expect(labPage.locator("#word-navigation-probe-focus-handoff")).toBeFocused();
    expect(await getMarkdown(labPage, id)).toBe(handoffMarkdown);
    await labPage.locator("#word-navigation-probe-focus-handoff").evaluate((button) => button.remove());

    await resetEditor(labPage, id, handoffMarkdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    await labPage.evaluate((editorId) => {
      document.addEventListener("focusin", (event) => {
        const target = event.target;

        if (
          target instanceof HTMLElement
          && target.isContentEditable
          && target.getAttribute("aria-hidden") === "true"
        ) {
          window.__MARKORA_BROWSER_LAB__!.reset(editorId, "host replacement");
        }
      }, { capture: true, once: true });
    }, id);
    await pressWordNavigation("ArrowLeft", true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("host replacement");
  }
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
