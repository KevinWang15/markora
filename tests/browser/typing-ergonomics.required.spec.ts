import type { Locator } from "@playwright/test";
import {
  editorLocator,
  expect,
  focusEditor,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

async function selectText(page: Parameters<typeof mountEditor>[0], id: string, text: string) {
  expect(await page.evaluate(
    ({ editorId, needle }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "all"),
    { editorId: id, needle: text },
  )).toBe(true);
}

async function dispatchComposition(target: Locator, type: "compositionend" | "compositionstart") {
  await target.evaluate((element, eventType) => {
    const ownerWindow = element.ownerDocument.defaultView!;
    element.dispatchEvent(new ownerWindow.CompositionEvent(eventType, {
      bubbles: true,
      data: "python",
    }));
  }, type);
}

test("@required configured auto-pairs wrap, delete, and undo through real Shadow DOM keyboard input", async ({ labPage }) => {
  const id = "typing-pairs-shadow";
  await mountEditor(labPage, {
    id,
    markdown: "",
    root: "shadow",
    typing: {
      autoPairs: ["parentheses", "emphasis-asterisks"],
    },
  });
  const editor = editorLocator(labPage, id);

  await focusEditor(labPage, id, "end");
  await labPage.keyboard.type("(");
  await settleEditor(labPage, id);
  await expect(editor.locator("p")).toHaveText("()");
  expect(await getMarkdown(labPage, id)).toBe("()");

  await labPage.keyboard.press("ControlOrMeta+z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");
  await labPage.keyboard.press("ControlOrMeta+Shift+z");
  await settleEditor(labPage, id);
  await expect(editor.locator("p")).toHaveText("()");

  await labPage.keyboard.press("Backspace");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");
  await labPage.keyboard.press("ControlOrMeta+z");
  await settleEditor(labPage, id);
  await expect(editor.locator("p")).toHaveText("()");

  await resetEditor(labPage, id, "alpha");
  await selectText(labPage, id, "alpha");
  await labPage.keyboard.type("*");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("*alpha*");
  await labPage.keyboard.press("ControlOrMeta+z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha");
});

test("@required core shortcuts can be remapped and disabled without retaining their old bindings", async ({ labPage }) => {
  const id = "typing-shortcuts";
  await mountEditor(labPage, {
    id,
    markdown: "alpha",
    shortcuts: {
      "@markora/core/bold": "Alt-b",
      "@markora/core/italic": false,
      "@markora/core/redo": "Alt-r",
      "@markora/core/undo": "Alt-u",
    },
    typing: { autoPairs: ["parentheses"] },
  });

  await selectText(labPage, id, "alpha");
  await labPage.keyboard.press("ControlOrMeta+b");
  expect(await getMarkdown(labPage, id)).toBe("alpha");

  await labPage.keyboard.press("Alt+b");
  expect(await getMarkdown(labPage, id)).toBe("**alpha**");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha");

  await labPage.keyboard.press("ControlOrMeta+i");
  expect(await getMarkdown(labPage, id)).toBe("alpha");

  await resetEditor(labPage, id, ["```", "seed", "```"].join("\n"));
  const code = editorLocator(labPage, id).locator(".cm-content");
  await expect(code).toBeVisible();
  await code.click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type("(");
  await settleEditor(labPage, id);
  const pairedCode = ["```", "seed()", "```"].join("\n");
  expect(await getMarkdown(labPage, id)).toBe(pairedCode);

  await labPage.keyboard.press("ControlOrMeta+z");
  expect(await getMarkdown(labPage, id)).toBe(pairedCode);
  await labPage.keyboard.press("Alt+u");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(["```", "seed", "```"].join("\n"));
  await labPage.keyboard.press("Alt+r");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(pairedCode);
  await labPage.keyboard.type(")");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(pairedCode);
});

test("@required code-language UI preserves content, exact metadata, history, IME, and read-only state in Shadow DOM", async ({ labPage }) => {
  const id = "code-language-shadow";
  const source = "const value = 1;";
  const nextFenceInfo = "python strict=true";
  const typescriptMarkdown = ["```ts", source, "```"].join("\n");
  const pythonMarkdown = ["```" + nextFenceInfo, source, "```"].join("\n");
  await mountEditor(labPage, {
    id,
    markdown: typescriptMarkdown,
    root: "shadow",
  });
  const editor = editorLocator(labPage, id);
  const languageButton = editor.getByRole("button", { name: "Edit code block language: ts" });
  await expect(languageButton).toBeVisible();
  await languageButton.click();

  const dialog = ownedOverlay(labPage, id, ".mdw-code-language-editor");
  const input = dialog.getByLabel("Code block language or fence info");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("ts");

  await input.fill(nextFenceInfo);
  await dispatchComposition(input, "compositionstart");
  await input.press("Enter");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeVisible();
  expect(await getMarkdown(labPage, id)).toBe(typescriptMarkdown);

  await dispatchComposition(input, "compositionend");
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(pythonMarkdown);
  await expect(editor.getByRole("button", { name: `Edit code block language: ${nextFenceInfo}` }))
    .toHaveText(nextFenceInfo);
  await expect(editor.locator(".mdw-code-block")).toContainText(source);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(typescriptMarkdown);
  await expect(editor.getByRole("button", { name: "Edit code block language: ts" })).toBeVisible();

  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(pythonMarkdown);
  const pythonButton = editor.getByRole("button", {
    name: `Edit code block language: ${nextFenceInfo}`,
  });
  await expect(pythonButton).toBeVisible();

  await updateEditorOptions(labPage, id, { editable: false });
  await settleEditor(labPage, id);
  await expect(pythonButton).toBeDisabled();
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "code-language"),
    id,
  )).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(pythonMarkdown);
});

test("@required Chromium CDP commits an auto-pair trigger literally during IME", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP IME control.");

  const id = "typing-cdp-composition";
  await mountEditor(labPage, {
    id,
    markdown: "",
    typing: { autoPairs: ["parentheses"] },
  });
  const paragraph = editorLocator(labPage, id).locator("p");
  await focusEditor(labPage, id, "end");
  const cdp = await context.newCDPSession(labPage);

  try {
    await cdp.send("Input.imeSetComposition", {
      selectionEnd: 1,
      selectionStart: 1,
      text: "(",
    });
    await expect(paragraph).toHaveText("(");
    await cdp.send("Input.insertText", { text: "(" });
  } finally {
    await cdp.detach();
  }

  await settleEditor(labPage, id);
  await expect(paragraph).toHaveText("(");
  expect(await getMarkdown(labPage, id)).toBe("(");

  await labPage.keyboard.type("(");
  await settleEditor(labPage, id);
  await expect(paragraph).toHaveText("(()");
});
