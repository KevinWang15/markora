import type { Locator, Page } from "@playwright/test";
import { chromiumTest,
  clearEditorEvents,
  editorLocator,
  expect,
  getEditorEvents,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
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

chromiumTest("@required Chromium CDP preserves active IME image syntax", async ({ context, labPage }) => {

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

chromiumTest("@required Chromium CDP preserves rich text across IME replacement and cancellation", async ({ context, labPage }) => {

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

chromiumTest("@required Chromium CDP continues completed tasks as unchecked items", async ({ context, labPage }) => {

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

chromiumTest("@required Chromium CDP deletes across a managed table and restores it natively", async ({ context, labPage }) => {

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

  const navigateBlockEdge = async (
    markdown: string,
    needle: string,
    mode: "end" | "start",
    key: "ArrowLeft" | "ArrowRight",
    extend: boolean,
    editorId = id,
  ) => {
    await resetEditor(labPage, editorId, markdown);
    expect(await labPage.evaluate(
      ({ editorId, nextMode, nextNeedle }) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, nextNeedle, nextMode)
      ),
      { editorId, nextMode: mode, nextNeedle: needle },
    )).toBe(true);
    await settleEditor(labPage, editorId);
    await editorLocator(labPage, editorId).evaluate((element) => {
      const targetWindow = window as Window & {
        __markoraWordBlockEdgePrevented?: boolean;
      };
      delete targetWindow.__markoraWordBlockEdgePrevented;
      element.addEventListener("keydown", (event) => {
        queueMicrotask(() => {
          targetWindow.__markoraWordBlockEdgePrevented = event.defaultPrevented;
        });
      }, { once: true });
    });
    await pressWordNavigation(key, extend);
    await settleEditor(labPage, editorId);
    expect(await labPage.evaluate(() => {
      const targetWindow = window as Window & {
        __markoraWordBlockEdgePrevented?: boolean;
      };
      const prevented = targetWindow.__markoraWordBlockEdgePrevented;
      delete targetWindow.__markoraWordBlockEdgePrevented;
      return prevented;
    })).toBe(false);
    await expect(editorLocator(labPage, editorId)).toBeFocused();
    expect(await getMarkdown(labPage, editorId)).toBe(markdown);
    return labPage.evaluate(
      (nextEditorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(nextEditorId).selection,
      editorId,
    );
  };

  for (const testCase of [
    { key: "ArrowRight", mode: "end", needle: "alpha" },
    { key: "ArrowLeft", mode: "start", needle: "beta" },
  ] as const) {
    for (const extend of [false, true]) {
      const plain = await navigateBlockEdge(
        "alpha\n\nbeta",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
      );
      const marked = await navigateBlockEdge(
        "**alpha**\n\n**beta**",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
      );
      expect(marked).toEqual(plain);
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

  for (const testCase of [
    { key: "ArrowLeft", mode: "end", needle: "אבגדהו" },
    { key: "ArrowRight", mode: "start", needle: "זחט" },
  ] as const) {
    for (const extend of [false, true]) {
      const plain = await navigateBlockEdge(
        "אבגדהו\n\nזחט",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
        rtlId,
      );
      const marked = await navigateBlockEdge(
        "**אבגדהו**\n\n**זחט**",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
        rtlId,
      );
      expect(marked).toEqual(plain);
    }
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

test("@required Home and End synchronize single-line marked text across engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "marked-line-edge-navigation";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressLineEdge = async (key: "End" | "Home", extend: boolean) => {
    if (!cdp) {
      await labPage.keyboard.press(`${extend ? "Shift+" : ""}${key}`);
      return;
    }

    const keyCode = key === "Home" ? 36 : 35;

    for (const type of ["keyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: extend ? 8 : 0,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const armLineEdgeKeyCapture = async (editorId: string) => {
    await editorLocator(labPage, editorId).evaluate((element) => {
      const targetWindow = window as Window & {
        __markoraLineEdgeKey?: {
          defaultPrevented: boolean;
          isTrusted: boolean;
          key: string;
        };
      };
      delete targetWindow.__markoraLineEdgeKey;
      const onKeyDown = (rawEvent: Event) => {
        const event = rawEvent as KeyboardEvent;
        if (event.key !== "Home" && event.key !== "End") {
          return;
        }

        element.removeEventListener("keydown", onKeyDown);
        queueMicrotask(() => {
          targetWindow.__markoraLineEdgeKey = {
            defaultPrevented: event.defaultPrevented,
            isTrusted: event.isTrusted,
            key: event.key,
          };
        });
      };
      element.addEventListener("keydown", onKeyDown);
    });
  };
  const readLineEdgeKeyCapture = () => labPage.evaluate(() => {
    const targetWindow = window as Window & {
      __markoraLineEdgeKey?: {
        defaultPrevented: boolean;
        isTrusted: boolean;
        key: string;
      };
    };
    const record = targetWindow.__markoraLineEdgeKey ?? null;
    delete targetWindow.__markoraLineEdgeKey;
    return record;
  });
  const navigateFrom = async (
    markdown: string,
    needle: string,
    mode: "end" | "start",
    key: "End" | "Home",
    extend: boolean,
    editorId = id,
  ) => {
    await resetEditor(labPage, editorId, markdown);
    expect(await labPage.evaluate(
      ({ editorId, nextMode, nextNeedle }) => (
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, nextNeedle, nextMode)
      ),
      { editorId, nextMode: mode, nextNeedle: needle },
    )).toBe(true);
    await settleEditor(labPage, editorId);
    const normalizedMarkdown = await getMarkdown(labPage, editorId);
    await clearEditorEvents(labPage, editorId);
    await armLineEdgeKeyCapture(editorId);
    await pressLineEdge(key, extend);
    await settleEditor(labPage, editorId);
    await expect(editorLocator(labPage, editorId)).toBeFocused();
    const events = await getEditorEvents(labPage, editorId);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    expect(await getMarkdown(labPage, editorId)).toBe(normalizedMarkdown);
    expect(await readLineEdgeKeyCapture()).toEqual({
      defaultPrevented: true,
      isTrusted: true,
      key,
    });
    return labPage.evaluate((nextEditorId) => ({
      model: window.__MARKORA_BROWSER_LAB__!.snapshot(nextEditorId).selection,
      text: document.getSelection()?.toString() ?? "",
    }), editorId);
  };

  for (const testCase of [
    {
      key: "Home",
      mode: "start",
      needle: "beta",
    },
    {
      key: "End",
      mode: "end",
      needle: "beta",
    },
  ] as const) {
    for (const extend of [false, true]) {
      const plain = await navigateFrom(
        "alphabeta gamma",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
      );
      expect(plain).toEqual(testCase.key === "Home"
        ? extend
          ? {
              model: { anchor: 6, from: 1, head: 1, to: 6 },
              text: "alpha",
            }
          : {
              model: { anchor: 1, from: 1, head: 1, to: 1 },
              text: "",
            }
        : extend
          ? {
              model: { anchor: 10, from: 10, head: 16, to: 16 },
              text: " gamma",
            }
          : {
              model: { anchor: 16, from: 16, head: 16, to: 16 },
              text: "",
            });

      for (const marked of [
        "alpha**beta** gamma",
        "alpha[beta](/line-edge-navigation) gamma",
        "alpha[**beta**](/nested-line-edge-navigation) gamma",
      ]) {
        expect(await navigateFrom(
          marked,
          testCase.needle,
          testCase.mode,
          testCase.key,
          extend,
        )).toEqual(plain);
      }
    }
  }

  const wrappedMarkdown = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj";
  const editor = editorLocator(labPage, id);
  await editor.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.boxSizing = "border-box";
    htmlElement.style.fontFamily = "monospace";
    htmlElement.style.width = "170px";
  });
  await resetEditor(labPage, id, wrappedMarkdown);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "ffff", "start"),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await armLineEdgeKeyCapture(id);
  await pressLineEdge("Home", false);
  await settleEditor(labPage, id);
  expect(await readLineEdgeKeyCapture()).toEqual({
    defaultPrevented: false,
    isTrusted: true,
    key: "Home",
  });
  expect(await getMarkdown(labPage, id)).toBe(wrappedMarkdown);
  await expect(editor).toBeFocused();

  await editor.evaluate((element) => {
    (element as HTMLElement).style.width = "";
  });
  await resetEditor(labPage, id, "alphabeta gamma");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "start"),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await armLineEdgeKeyCapture(id);
  await labPage.keyboard.press("Control+Home");
  await settleEditor(labPage, id);
  expect(await readLineEdgeKeyCapture()).toEqual({
    defaultPrevented: false,
    isTrusted: true,
    key: "Home",
  });
  expect(await getMarkdown(labPage, id)).toBe("alphabeta gamma");
  await expect(editor).toBeFocused();

  const rtlId = "rtl-marked-line-edge-navigation";
  await mountEditor(labPage, { direction: "rtl", id: rtlId, markdown: "" });

  for (const testCase of [
    { key: "Home", mode: "end", needle: "דהו" },
    { key: "End", mode: "start", needle: "אבג" },
  ] as const) {
    for (const extend of [false, true]) {
      const plain = await navigateFrom(
        "אבגדהו זחט",
        "אבגדהו",
        testCase.mode,
        testCase.key,
        extend,
        rtlId,
      );
      const marked = await navigateFrom(
        "אבג**דהו** זחט",
        testCase.needle,
        testCase.mode,
        testCase.key,
        extend,
        rtlId,
      );
      expect(marked).toEqual(plain);
    }
  }

  await cdp?.detach();
});

test("@required character selection ignores Markdown mark boundaries across engines", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "marked-character-selection";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressSelectionArrow = async (key: "ArrowLeft" | "ArrowRight") => {
    if (!cdp) {
      await labPage.keyboard.press(`Shift+${key}`);
      return;
    }

    const keyCode = key === "ArrowLeft" ? 37 : 39;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: 8,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const selectFrom = async (
    markdown: string,
    needle: string,
    mode: "end" | "start",
    key: "ArrowLeft" | "ArrowRight",
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
    await pressSelectionArrow(key);
    await settleEditor(labPage, editorId);
    await expect(editorLocator(labPage, editorId)).toBeFocused();
    const events = await getEditorEvents(labPage, editorId);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    expect(await getMarkdown(labPage, editorId)).toBe(markdown);
    return labPage.evaluate((nextEditorId) => ({
      model: window.__MARKORA_BROWSER_LAB__!.snapshot(nextEditorId).selection,
      text: document.getSelection()?.toString() ?? "",
    }), editorId);
  };

  for (const testCase of [
    {
      key: "ArrowLeft",
      marked: "alpha**beta** gamma",
      markedNeedle: "beta",
      mode: "start",
      plain: "alphabeta gamma",
      plainNeedle: "beta",
      expected: {
        model: { anchor: 6, from: 5, head: 5, to: 6 },
        text: "a",
      },
    },
    {
      key: "ArrowRight",
      marked: "alpha**beta** gamma",
      markedNeedle: "beta",
      mode: "end",
      plain: "alphabeta gamma",
      plainNeedle: "beta",
      expected: {
        model: { anchor: 10, from: 10, head: 11, to: 11 },
        text: " ",
      },
    },
    {
      key: "ArrowLeft",
      marked: "alpha[beta](/character-selection) gamma",
      markedNeedle: "beta",
      mode: "start",
      plain: "alphabeta gamma",
      plainNeedle: "beta",
      expected: {
        model: { anchor: 6, from: 5, head: 5, to: 6 },
        text: "a",
      },
    },
    {
      key: "ArrowLeft",
      marked: "Ae**́**Z",
      markedNeedle: "Z",
      mode: "start",
      plain: "AéZ",
      plainNeedle: "Z",
      expected: {
        model: { anchor: 4, from: 2, head: 2, to: 4 },
        text: "é",
      },
    },
    {
      key: "ArrowRight",
      marked: "A👩**‍**💻Z",
      markedNeedle: "A",
      mode: "end",
      plain: "A👩‍💻Z",
      plainNeedle: "A",
      expected: {
        model: { anchor: 2, from: 2, head: 7, to: 7 },
        text: "👩‍💻",
      },
    },
  ] as const) {
    const plain = await selectFrom(
      testCase.plain,
      testCase.plainNeedle,
      testCase.mode,
      testCase.key,
    );
    expect(plain).toEqual(testCase.expected);
    const marked = await selectFrom(
      testCase.marked,
      testCase.markedNeedle,
      testCase.mode,
      testCase.key,
    );
    expect(marked).toEqual(plain);
  }

  const repeatedMarkdown = "alpha**beta**\n\ngamma";
  await resetEditor(labPage, id, repeatedMarkdown);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "start"),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  await clearEditorEvents(labPage, id);

  for (let index = 0; index < 5; index += 1) {
    await pressSelectionArrow("ArrowRight");
    await settleEditor(labPage, id);
  }

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
    id,
  )).toEqual({ anchor: 6, from: 6, head: 12, to: 12 });
  await pressSelectionArrow("ArrowLeft");
  await settleEditor(labPage, id);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
    id,
  )).toEqual({ anchor: 6, from: 6, head: 10, to: 10 });
  await expect(editorLocator(labPage, id)).toBeFocused();
  const repeatedEvents = await getEditorEvents(labPage, id);
  expect(repeatedEvents.counts.focus).toBe(0);
  expect(repeatedEvents.counts.blur).toBe(0);
  expect(await getMarkdown(labPage, id)).toBe(repeatedMarkdown);

  for (const testCase of [
    {
      expected: { anchor: 6, from: 6, head: 8, to: 8 },
      key: "ArrowRight",
      mode: "end",
      needle: "alpha",
    },
    {
      expected: { anchor: 8, from: 6, head: 6, to: 8 },
      key: "ArrowLeft",
      mode: "start",
      needle: "beta",
    },
  ] as const) {
    const plain = await selectFrom(
      "alpha\n\nbeta",
      testCase.needle,
      testCase.mode,
      testCase.key,
    );
    expect(plain.model).toEqual(testCase.expected);
    const marked = await selectFrom(
      "**alpha**\n\n**beta**",
      testCase.needle,
      testCase.mode,
      testCase.key,
    );
    expect(marked).toEqual(plain);
  }

  const rtlId = "rtl-marked-character-selection";
  await mountEditor(labPage, { direction: "rtl", id: rtlId, markdown: "" });

  for (const testCase of [
    {
      key: "ArrowLeft",
      mode: "end",
      needle: "אבגדהו",
    },
    {
      key: "ArrowRight",
      mode: "start",
      needle: "זחט",
    },
  ] as const) {
    const plain = await selectFrom(
      "אבגדהו\n\nזחט",
      testCase.needle,
      testCase.mode,
      testCase.key,
      rtlId,
    );
    const marked = await selectFrom(
      "**אבגדהו**\n\n**זחט**",
      testCase.needle,
      testCase.mode,
      testCase.key,
      rtlId,
    );
    expect(marked).toEqual(plain);
  }
});

test("@required modified structural keys preserve native editing behavior", async ({ browserName, context, labPage }) => {
  const id = "structural-modifier-ownership";
  await mountEditor(labPage, { id, markdown: "" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressRaw = async (
    code: string,
    key: string,
    keyCode: number,
    modifiers: number,
  ) => {
    if (cdp) {
      for (const type of ["rawKeyDown", "keyUp"] as const) {
        await cdp.send("Input.dispatchKeyEvent", {
          code,
          key,
          modifiers,
          nativeVirtualKeyCode: keyCode,
          type,
          windowsVirtualKeyCode: keyCode,
        });
      }
    } else {
      const prefix = modifiers === 2 ? "Control+" : modifiers === 8 ? "Shift+" : "";
      await labPage.keyboard.press(`${prefix}${key}`);
    }
    await settleEditor(labPage, id);
  };
  const readResult = async () => ({
    markdown: await getMarkdown(labPage, id),
    selection: await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
      id,
    ),
  });

  const wordDeleteResults = [];
  for (const markdown of ["previous words\n\nHeading", "previous words\n\n## Heading"]) {
    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Heading", "start"),
      id,
    )).toBe(true);
    await pressRaw("Backspace", "Backspace", 8, 2);
    wordDeleteResults.push(await readResult());
  }
  expect(wordDeleteResults[1]).toEqual(wordDeleteResults[0]);
  expect(wordDeleteResults[1]).toEqual({
    markdown: "previous wordsHeading",
    selection: { anchor: 15, from: 15, head: 15, to: 15 },
  });

  for (const { marker, markdown } of [
    { marker: "---", markdown: "\\---" },
    { marker: "```", markdown: "\\`\\`\\`" },
  ] as const) {
    await resetEditor(labPage, id, "");
    await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, "start"),
      id,
    );
    await labPage.keyboard.insertText(marker);
    await pressRaw("Enter", "Enter", 13, 8);
    expect(await getMarkdown(labPage, id)).toBe(markdown);
    await expect(editorLocator(labPage, id).locator("p")).toHaveCount(1);
    await expect(editorLocator(labPage, id).locator("p br")).toHaveCount(2);
    await expect(editorLocator(labPage, id).locator("hr, .mdw-code-block")).toHaveCount(0);
  }

  await resetEditor(labPage, id, "");
  await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, "start"),
    id,
  );
  await labPage.keyboard.insertText("| A |");
  await pressRaw("Enter", "Enter", 13, 0);
  await labPage.keyboard.insertText("| --- |");
  await pressRaw("Enter", "Enter", 13, 8);
  expect(await getMarkdown(labPage, id)).toBe("| A |\n\n| --- |");
  await expect(editorLocator(labPage, id).locator("table")).toHaveCount(0);

  const table = ["| A |", "| --- |", "| value |"].join("\n");
  await resetEditor(labPage, id, table);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A", "start"),
    id,
  )).toBe(true);
  await pressRaw("ArrowLeft", "ArrowLeft", 37, 0);
  await pressRaw("Delete", "Delete", 46, 2);
  expect(await getMarkdown(labPage, id)).toBe(table);
  await expect(editorLocator(labPage, id).locator("table")).toHaveCount(1);
});

test("@required native double-click word selection ignores Markdown mark boundaries", async ({ browserName, context, labPage }) => {
  const id = "pointer-word-mark-selection";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;

  const selectAt = async (markdown: string, marked: boolean, offset: number) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const point = await editorLocator(labPage, id).evaluate((element, target) => {
      const { inMark, offset: textOffset } = target;
      const container = inMark ? element.querySelector("strong") : element.querySelector("p");
      const text = container?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) {
        throw new Error(`Missing target text node for ${JSON.stringify(element.textContent)}.`);
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, textOffset);
      range.setEnd(text, textOffset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, { inMark: marked, offset });
    const doubleClick = async () => {
      if (cdp) {
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          clickCount: 2,
          type: "mousePressed",
          x: point.x,
          y: point.y,
        });
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 0,
          clickCount: 2,
          type: "mouseReleased",
          x: point.x,
          y: point.y,
        });
      } else {
        await labPage.mouse.dblclick(point.x, point.y);
      }
      await settleEditor(labPage, id);
      return {
        model: await labPage.evaluate(
          (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
          id,
        ),
        text: await labPage.evaluate(() => document.getSelection()?.toString()),
      };
    };

    const first = await doubleClick();
    if (marked || first.text) return first;

    // Under parallel load WebKit can occasionally drop both native clicks on
    // the unmarked control. Retry only that browser-owned oracle; a collapsed
    // marked result remains a product failure and is never retried.
    await labPage.mouse.click(1, 1);
    await settleEditor(labPage, id);
    return doubleClick();
  };

  for (const testCase of [
    { marked: "pre**fixmid**suffix", markedOffset: 2, plain: "prefixmidsuffix", plainOffset: 5 },
    { marked: "при**ветмир**снова", markedOffset: 2, plain: "приветмирснова", plainOffset: 5 },
    { marked: "can'**tstop**now", markedOffset: 2, plain: "can'tstopnow", plainOffset: 6 },
    { marked: "אבג**דהו**זחט", markedOffset: 2, plain: "אבגדהוזחט", plainOffset: 5 },
  ]) {
    const plain = await selectAt(testCase.plain, false, testCase.plainOffset);
    const marked = await selectAt(testCase.marked, true, testCase.markedOffset);
    expect(marked).toEqual(plain);
    expect(marked.text).not.toBe("");
  }
  await cdp?.detach();
});

test("@required pointer range selection crosses Markdown mark boundaries", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "pointer-mark-drag-selection";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;

  const textPoint = async (
    needle: string,
    offset: number,
    side: "after" | "before",
  ) => editorLocator(labPage, id).evaluate(
    (element, target) => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text: Text | null = null;
      while (walker.nextNode()) {
        const candidate = walker.currentNode as Text;
        if (candidate.data === target.needle) {
          text = candidate;
          break;
        }
      }
      if (!text) throw new Error(`Missing ${JSON.stringify(target.needle)} text node.`);
      const range = element.ownerDocument.createRange();
      range.setStart(text, target.offset);
      range.setEnd(text, target.offset + 1);
      const rect = range.getBoundingClientRect();
      return {
        x: target.side === "before" ? rect.left + 1 : rect.right - 1,
        y: rect.top + rect.height / 2,
      };
    },
    { needle, offset, side },
  );

  const drag = async (
    markdown: string,
    startNeedle: string,
    startOffset: number,
    startSide: "after" | "before",
    endNeedle: string,
    endOffset: number,
    endSide: "after" | "before",
  ) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const start = await textPoint(startNeedle, startOffset, startSide);
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "none",
        buttons: 0,
        type: "mouseMoved",
        x: start.x,
        y: start.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 1,
        type: "mousePressed",
        x: start.x,
        y: start.y,
      });
    } else {
      await labPage.mouse.move(start.x, start.y);
      await labPage.mouse.down();
    }

    const end = await textPoint(endNeedle, endOffset, endSide);
    if (cdp) {
      for (let step = 1; step <= 20; step += 1) {
        const progress = step / 20;
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          type: "mouseMoved",
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 1,
        type: "mouseReleased",
        x: end.x,
        y: end.y,
      });
    } else {
      await labPage.mouse.move(end.x, end.y, { steps: 20 });
      await labPage.mouse.up();
    }

    await settleEditor(labPage, id);
    return {
      model: await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      ),
      text: await labPage.evaluate(() => document.getSelection()?.toString()),
    };
  };

  const shiftClick = async (
    startNeedle: string,
    startOffset: number,
    startSide: "after" | "before",
    endNeedle: string,
    endOffset: number,
    endSide: "after" | "before",
  ) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, "pre**fixmid**suffix");
    await settleEditor(labPage, id);
    const click = async (
      point: { x: number; y: number },
      extend: boolean,
    ) => {
      if (cdp) {
        const modifiers = extend ? 8 : 0;
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers,
          type: "mousePressed",
          x: point.x,
          y: point.y,
        });
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 0,
          clickCount: 1,
          modifiers,
          type: "mouseReleased",
          x: point.x,
          y: point.y,
        });
        return;
      }

      if (extend) await labPage.keyboard.down("Shift");
      try {
        await labPage.mouse.click(point.x, point.y);
      } finally {
        if (extend) await labPage.keyboard.up("Shift");
      }
    };

    await click(await textPoint(startNeedle, startOffset, startSide), false);
    await settleEditor(labPage, id);
    await click(await textPoint(endNeedle, endOffset, endSide), true);
    await settleEditor(labPage, id);
    return {
      model: await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      ),
      text: await labPage.evaluate(() => document.getSelection()?.toString()),
    };
  };

  const inlineMarkdown = "pre**fixmid**suffix";
  expect(await drag(inlineMarkdown, "pre", 1, "before", "suffix", 2, "after")).toEqual({
    model: { anchor: 2, from: 2, head: 13, to: 13 },
    text: "refixmidsuf",
  });
  expect(await drag(inlineMarkdown, "suffix", 2, "after", "pre", 1, "before")).toEqual({
    model: { anchor: 13, from: 2, head: 2, to: 13 },
    text: "refixmidsuf",
  });
  expect(await shiftClick("pre", 1, "before", "suffix", 2, "after")).toEqual({
    model: { anchor: 2, from: 2, head: 13, to: 13 },
    text: "refixmidsuf",
  });
  if (cdp) {
    await cdp.send("Input.insertText", { text: "X" });
  } else {
    await labPage.keyboard.insertText("X");
  }
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("pXfix");

  expect(await shiftClick("suffix", 2, "after", "pre", 1, "before")).toEqual({
    model: { anchor: 13, from: 2, head: 2, to: 13 },
    text: "refixmidsuf",
  });

  const blockMarkdown = "one **two** three\n\nfour **five** six";
  const forwardBlocks = await drag(
    blockMarkdown,
    "one ",
    1,
    "before",
    " six",
    3,
    "after",
  );
  expect(forwardBlocks.model).toEqual({ anchor: 2, from: 2, head: 29, to: 29 });
  expect(forwardBlocks.text?.replace(/\s/gu, "")).toBe("netwothreefourfivesix");
  if (cdp) {
    await cdp.send("Input.insertText", { text: "X" });
  } else {
    await labPage.keyboard.insertText("X");
  }
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("oX");

  const backwardBlocks = await drag(
    blockMarkdown,
    " six",
    3,
    "after",
    "one ",
    1,
    "before",
  );
  expect(backwardBlocks.model).toEqual({ anchor: 29, from: 2, head: 2, to: 29 });
  expect(backwardBlocks.text?.replace(/\s/gu, "")).toBe("netwothreefourfivesix");
  await cdp?.detach();
});

test("@required native triple click selects marked text blocks", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "pointer-mark-triple-click";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;

  const selectBlock = async (markdown: string, marked: boolean) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const point = await editorLocator(labPage, id).evaluate((element, inMark) => {
      const container = inMark ? element.querySelector("strong") : element.querySelector("p");
      const text = container?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) {
        throw new Error("Missing triple-click target text.");
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, inMark ? 2 : 5);
      range.setEnd(text, inMark ? 3 : 6);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, marked);

    // Playwright's WebKit mouse.click expands clickCount into that many
    // press/release pairs. Emit each detail once so this is one triple-click,
    // not a sequence of six clicks.
    if (!cdp) await labPage.mouse.move(point.x, point.y);
    for (const clickCount of [1, 2, 3]) {
      if (cdp) {
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          clickCount,
          type: "mousePressed",
          x: point.x,
          y: point.y,
        });
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 0,
          clickCount,
          type: "mouseReleased",
          x: point.x,
          y: point.y,
        });
      } else {
        await labPage.mouse.down({ clickCount });
        await labPage.mouse.up({ clickCount });
      }
    }
    await settleEditor(labPage, id);
    return {
      model: await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      ),
      text: await labPage.evaluate(() => document.getSelection()?.toString()),
    };
  };

  const marked = await selectBlock("pre**fixmid**suffix\n\nnext", true);
  const plain = await selectBlock("prefixmidsuffix\n\nnext", false);
  expect(marked).toEqual(plain);
  expect(marked.text).toContain("prefixmidsuffix");
  await cdp?.detach();
});

test("@required triple-click block drag crosses Markdown mark boundaries", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "pointer-block-drag";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const selectBlocks = async (
    markdown: string,
    startNeedle: string,
    startOffset: number,
    endNeedle: string,
    endOffset: number,
  ) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const point = async (needle: string, offset: number) => editorLocator(labPage, id).evaluate(
      (element, target) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          if (text.data !== target.needle) continue;
          const range = element.ownerDocument.createRange();
          range.setStart(text, target.offset);
          range.setEnd(text, target.offset + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        throw new Error(`Missing ${JSON.stringify(target.needle)} block-drag text.`);
      },
      { needle, offset },
    );
    const start = await point(startNeedle, startOffset);
    for (const clickCount of [1, 2]) {
      if (cdp) {
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          clickCount,
          type: "mousePressed",
          x: start.x,
          y: start.y,
        });
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 0,
          clickCount,
          type: "mouseReleased",
          x: start.x,
          y: start.y,
        });
      } else {
        await labPage.mouse.move(start.x, start.y);
        await labPage.mouse.down({ clickCount });
        await labPage.mouse.up({ clickCount });
      }
    }
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 3,
        type: "mousePressed",
        x: start.x,
        y: start.y,
      });
    } else {
      await labPage.mouse.down({ clickCount: 3 });
    }
    const end = await point(endNeedle, endOffset);
    if (cdp) {
      for (let step = 1; step <= 20; step += 1) {
        const progress = step / 20;
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          clickCount: 3,
          type: "mouseMoved",
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 3,
        type: "mouseReleased",
        x: end.x,
        y: end.y,
      });
    } else {
      await labPage.mouse.move(end.x, end.y, { steps: 20 });
      await labPage.mouse.up({ clickCount: 3 });
    }
    await settleEditor(labPage, id);
    return {
      model: await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      ),
      text: await labPage.evaluate(() => document.getSelection()?.toString()),
    };
  };

  for (const testCase of [
    {
      endNeedle: "four five",
      endOffset: 7,
      marked: "one pre**fix** three\n\nfour five",
      markedStartNeedle: "fix",
      markedStartOffset: 1,
      plain: "one prefix three\n\nfour five",
      plainStartNeedle: "one prefix three",
      plainStartOffset: 6,
      replace: true,
    },
    {
      endNeedle: "one two",
      endOffset: 1,
      marked: "one two\n\nfour pre**fix** five",
      markedStartNeedle: "fix",
      markedStartOffset: 1,
      plain: "one two\n\nfour prefix five",
      plainStartNeedle: "four prefix five",
      plainStartOffset: 7,
      replace: false,
    },
  ]) {
    const plain = await selectBlocks(
      testCase.plain,
      testCase.plainStartNeedle,
      testCase.plainStartOffset,
      testCase.endNeedle,
      testCase.endOffset,
    );
    const marked = await selectBlocks(
      testCase.marked,
      testCase.markedStartNeedle,
      testCase.markedStartOffset,
      testCase.endNeedle,
      testCase.endOffset,
    );
    expect(marked).toEqual(plain);
    expect(marked.text?.replace(/\s/gu, "")).toContain(
      testCase.plain.replace(/\s/gu, ""),
    );
    if (testCase.replace) {
      if (cdp) {
        await cdp.send("Input.insertText", { text: "X" });
      } else {
        await labPage.keyboard.insertText("X");
      }
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe("X");
    }
  }
  await cdp?.detach();
});

test("@required double-click word drag crosses Markdown mark boundaries", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "pointer-word-drag";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  const wordDrag = async (options: {
    endNeedle: string;
    endOffset: number;
    markdown: string;
    startNeedle: string;
    startOffset: number;
  }) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, options.markdown);
    await settleEditor(labPage, id);
    const point = async (needle: string, offset: number) => editorLocator(labPage, id).evaluate(
      (element, target) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text: Text | null = null;
        while (walker.nextNode()) {
          const candidate = walker.currentNode as Text;
          if (candidate.data === target.needle) {
            text = candidate;
            break;
          }
        }
        if (!text) throw new Error(`Missing ${JSON.stringify(target.needle)} word-drag text.`);
        const range = element.ownerDocument.createRange();
        range.setStart(text, target.offset);
        range.setEnd(text, target.offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      { needle, offset },
    );
    const start = await point(options.startNeedle, options.startOffset);
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 1,
        type: "mousePressed",
        x: start.x,
        y: start.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 1,
        type: "mouseReleased",
        x: start.x,
        y: start.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 2,
        type: "mousePressed",
        x: start.x,
        y: start.y,
      });
    } else {
      await labPage.mouse.move(start.x, start.y);
      await labPage.mouse.down({ clickCount: 1 });
      await labPage.mouse.up({ clickCount: 1 });
      await labPage.mouse.down({ clickCount: 2 });
    }

    const end = await point(options.endNeedle, options.endOffset);
    if (cdp) {
      for (let step = 1; step <= 20; step += 1) {
        const progress = step / 20;
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          type: "mouseMoved",
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 2,
        type: "mouseReleased",
        x: end.x,
        y: end.y,
      });
    } else {
      await labPage.mouse.move(end.x, end.y, { steps: 20 });
      await labPage.mouse.up({ clickCount: 2 });
    }
    await settleEditor(labPage, id);
    return {
      model: await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      ),
      text: await labPage.evaluate(() => document.getSelection()?.toString()),
    };
  };

  for (const testCase of [
    {
      expectedText: "prefix alpha beta",
      marked: {
        endNeedle: " alpha beta",
        endOffset: 9,
        markdown: "pre**fix** alpha beta",
        startNeedle: "fix",
        startOffset: 1,
      },
      plain: {
        endNeedle: "prefix alpha beta",
        endOffset: 15,
        markdown: "prefix alpha beta",
        startNeedle: "prefix alpha beta",
        startOffset: 4,
      },
    },
    {
      expectedText: "alpha beta prefix",
      marked: {
        endNeedle: "alpha beta pre",
        endOffset: 2,
        markdown: "alpha beta pre**fix**",
        startNeedle: "fix",
        startOffset: 1,
      },
      plain: {
        endNeedle: "alpha beta prefix",
        endOffset: 2,
        markdown: "alpha beta prefix",
        startNeedle: "alpha beta prefix",
        startOffset: 15,
      },
    },
    {
      expectedText: "prefix alpha\nbeta gamma",
      marked: {
        endNeedle: " gamma",
        endOffset: 4,
        markdown: "pre**fix** alpha\n\nbe**ta** gamma",
        startNeedle: "fix",
        startOffset: 1,
      },
      plain: {
        endNeedle: "beta gamma",
        endOffset: 8,
        markdown: "prefix alpha\n\nbeta gamma",
        startNeedle: "prefix alpha",
        startOffset: 4,
      },
    },
    {
      expectedText: "alpha beta\ngamma prefix",
      marked: {
        endNeedle: "alpha be",
        endOffset: 2,
        markdown: "alpha be**ta**\n\ngamma pre**fix**",
        startNeedle: "fix",
        startOffset: 1,
      },
      plain: {
        endNeedle: "alpha beta",
        endOffset: 2,
        markdown: "alpha beta\n\ngamma prefix",
        startNeedle: "gamma prefix",
        startOffset: 9,
      },
    },
  ]) {
    const plain = await wordDrag(testCase.plain);
    const marked = await wordDrag(testCase.marked);
    expect(marked).toEqual(plain);
    expect(marked.text?.replace(/\n+/gu, "\n")).toContain(testCase.expectedText);
  }
  await cdp?.detach();
});

test("@required owned word and block drags reach vertical editor edges", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "pointer-drag-edges";
  const markdown = "one alpha word\n\ntwo pre**fix** word\n\nthree omega word";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const editor = editorLocator(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  const dispatchMouse = async (options: {
    buttons: number;
    clickCount: number;
    type: "mouseMoved" | "mousePressed" | "mouseReleased";
    x: number;
    y: number;
  }) => {
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        ...options,
      });
      return;
    }

    await labPage.mouse.move(options.x, options.y);
    if (options.type === "mousePressed") {
      await labPage.mouse.down({ button: "left", clickCount: options.clickCount });
    } else if (options.type === "mouseReleased") {
      await labPage.mouse.up({ button: "left", clickCount: options.clickCount });
    }
  };

  for (const kind of ["word", "block"] as const) {
    for (const direction of ["above", "below"] as const) {
      await labPage.mouse.click(1, 1);
      await resetEditor(labPage, id, markdown);
      await settleEditor(labPage, id);
      expect(await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "one", "start"),
        id,
      )).toBe(true);
      const documentStart = (await snapshotEditor(labPage, id)).selection.head;
      expect(await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "omega word", "end"),
        id,
      )).toBe(true);
      const documentEnd = (await snapshotEditor(labPage, id)).selection.head;
      const start = await editor.evaluate((element) => {
        const text = element.querySelector("strong")?.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) {
          throw new Error("Missing marked pointer-edge target.");
        }
        const range = element.ownerDocument.createRange();
        range.setStart(text, 1);
        range.setEnd(text, 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      const completedClicks = kind === "word" ? [1] : [1, 2];
      for (const clickCount of completedClicks) {
        await dispatchMouse({
          buttons: 1,
          clickCount,
          type: "mousePressed",
          ...start,
        });
        await dispatchMouse({
          buttons: 0,
          clickCount,
          type: "mouseReleased",
          ...start,
        });
      }
      const activeClickCount = kind === "word" ? 2 : 3;
      await dispatchMouse({
        buttons: 1,
        clickCount: activeClickCount,
        type: "mousePressed",
        ...start,
      });
      const initial = (await snapshotEditor(labPage, id)).selection;
      const bounds = await editor.boundingBox();
      if (!bounds) throw new Error("Missing pointer-edge editor bounds.");
      const edge = {
        x: bounds.x + bounds.width / 2,
        y: direction === "above"
          ? bounds.y - 30
          : bounds.y + bounds.height + 30,
      };
      await dispatchMouse({
        buttons: 1,
        clickCount: activeClickCount,
        type: "mouseMoved",
        ...edge,
      });
      await dispatchMouse({
        buttons: 0,
        clickCount: activeClickCount,
        type: "mouseReleased",
        ...edge,
      });
      await settleEditor(labPage, id);

      const selection = (await snapshotEditor(labPage, id)).selection;
      expect(selection).toMatchObject(direction === "above"
        ? {
            anchor: initial.to,
            from: documentStart,
            head: documentStart,
            to: initial.to,
          }
        : {
            anchor: initial.from,
            from: initial.from,
            head: documentEnd,
            to: documentEnd,
          });

      if (cdp) {
        await cdp.send("Input.insertText", { text: "X" });
      } else {
        await labPage.keyboard.insertText("X");
      }
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(
        direction === "above"
          ? `X${kind === "word" ? " word" : ""}\n\nthree omega word`
          : `one alpha word\n\n${kind === "word" ? "two " : ""}X`,
      );
    }
  }
  await cdp?.detach();
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
  await expect(editor.locator(".mdw-table-scroll.mdw-managed-block-cursor-before")).toHaveCount(1);

  const text = "表の前";
  expect(await startSyntheticComposition(editor, text)).toBe(true);
  await expect(editor.locator(".mdw-table-scroll.mdw-managed-block-cursor-before")).toHaveCount(0);
  await endSyntheticComposition(editor, text);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(`${text}\n\n${tableMarkdown}`);
});
