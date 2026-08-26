import type { BrowserContext, Page } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const androidChromeUserAgent = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/131.0.0.0 Mobile Safari/537.36",
].join(" ");

test.use({
  userAgent: androidChromeUserAgent,
  viewport: { height: 915, width: 412 },
});

async function dispatchNoMutationBackspace(
  context: BrowserContext,
  id: string,
  page: Page,
  target: "code-mirror" | "prosemirror" = "prosemirror",
  count = 1,
) {
  const cdp = await context.newCDPSession(page);
  const containerSelector = `[data-e2e-editor="${id}"]`;
  const targetSelector = target === "code-mirror" ? ".cm-content" : ".ProseMirror";
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(async () => {
      const events = [];
      for (let index = 0; index < ${count}; index += 1) {
        const container = document.querySelector(${JSON.stringify(containerSelector)});
        if (!(container instanceof HTMLElement)) throw new Error("Android editor container missing.");
        const shadowHost = container.querySelector("[data-e2e-shadow-host]");
        const root = shadowHost?.shadowRoot ?? container;
        const target = root.querySelector(${JSON.stringify(targetSelector)});
        if (!(target instanceof HTMLElement)) throw new Error("Android editor target missing.");
        const event = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        });
        target.dispatchEvent(event);
        events.push(event);
        if (index + 1 < ${count}) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      return {
        defaultPrevented: events.some((event) => event.defaultPrevented),
        userAgent: navigator.userAgent,
      };
    })()`,
    returnByValue: true,
  });

  return result.result.value as { defaultPrevented: boolean; userAgent: string };
}

test("@required Android CDP fallback deletes complete grapheme clusters", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing Android CDP input control.");

  const id = "android-grapheme-backspace";
  await mountEditor(labPage, { id, markdown: "" });

  for (const value of ["A😀", "A👩‍💻", "Aé", "A👍🏽", "A🇨🇳"] as const) {
    await resetEditor(labPage, id, value);
    expect(await labPage.evaluate(
      ({ editorId, text }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "end"),
      { editorId: id, text: value },
    )).toBe(true);

    const event = await dispatchNoMutationBackspace(context, id, labPage);
    expect(event.defaultPrevented).toBe(false);
    expect(event.userAgent).toContain("Android");
    await expect.poll(() => getMarkdown(labPage, id)).toBe("A");

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(value);
  }

  const burst = "A😀👩‍💻é👍🏽🇨🇳";
  await resetEditor(labPage, id, burst);
  expect(await labPage.evaluate(
    ({ editorId, text }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "end"),
    { editorId: id, text: burst },
  )).toBe(true);
  await dispatchNoMutationBackspace(context, id, labPage, "prosemirror", 3);
  await expect.poll(() => getMarkdown(labPage, id)).toBe("A😀👩‍💻");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(burst);

  const shadowId = "android-shadow-grapheme";
  await mountEditor(labPage, { id: shadowId, markdown: "A😀", root: "shadow" });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A😀", "end"),
    shadowId,
  )).toBe(true);
  await dispatchNoMutationBackspace(context, shadowId, labPage);
  await expect.poll(() => getMarkdown(labPage, shadowId)).toBe("A");
});

test("@required Android CDP fallback preserves structural Backspace commands", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing Android CDP input control.");

  const id = "android-structural-backspace";
  const table = [
    "| A | B |",
    "| --- | --- |",
    "| one | two |",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: table });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "two", "end"),
    id,
  )).toBe(true);
  await labPage.keyboard.press("ArrowRight");
  await expect(editorLocator(labPage, id).locator("table.mdw-managed-block-cursor-after")).toHaveCount(1);

  await dispatchNoMutationBackspace(context, id, labPage);
  await expect.poll(() => getMarkdown(labPage, id)).toBe("");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(table);

  await resetEditor(labPage, id, "![alt](/android.png)");
  await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, "end"), id);
  await dispatchNoMutationBackspace(context, id, labPage);
  await expect.poll(() => getMarkdown(labPage, id)).toBe("");
});

test("@required Android CDP fallback expires after editor state changes", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing Android CDP input control.");

  const id = "android-stale-backspace";
  const editor = editorLocator(labPage, id);
  await mountEditor(labPage, { id, markdown: "alpha beta" });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "end"),
    id,
  )).toBe(true);
  await dispatchNoMutationBackspace(context, id, labPage);
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);
  await labPage.waitForTimeout(100);
  expect(await getMarkdown(labPage, id)).toBe("alpha beta");

  await resetEditor(labPage, id, "alpha");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);
  await dispatchNoMutationBackspace(context, id, labPage);
  await updateEditorOptions(labPage, id, { editable: false });
  await labPage.waitForTimeout(100);
  expect(await getMarkdown(labPage, id)).toBe("alpha");
  await updateEditorOptions(labPage, id, { editable: true });

  await resetEditor(labPage, id, "alpha");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);
  await dispatchNoMutationBackspace(context, id, labPage);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await labPage.waitForTimeout(100);
  expect(await getMarkdown(labPage, id)).toBe("alpha");
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });

  await resetEditor(labPage, id, "alpha");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "alpha", "end"),
    id,
  )).toBe(true);
  await dispatchNoMutationBackspace(context, id, labPage);
  await labPage.evaluate(() => {
    const button = document.createElement("button");
    button.id = "android-external-focus";
    button.textContent = "External focus";
    document.body.append(button);
    button.focus();
  });
  await labPage.waitForTimeout(100);
  expect(await getMarkdown(labPage, id)).toBe("alpha");
  await expect(labPage.locator("#android-external-focus")).toBeFocused();
});

test("@required Android CDP fallback preserves auto-pairs and active code graphemes", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing Android CDP input control.");

  const pairId = "android-auto-pair-backspace";
  await mountEditor(labPage, {
    id: pairId,
    markdown: "",
    typing: { autoPairs: ["parentheses"] },
  });
  await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, "end"), pairId);
  await labPage.keyboard.insertText("(");
  await settleEditor(labPage, pairId);
  expect(await getMarkdown(labPage, pairId)).toBe("()");
  await dispatchNoMutationBackspace(context, pairId, labPage);
  await expect.poll(() => getMarkdown(labPage, pairId)).toBe("");

  const codeId = "android-code-grapheme-backspace";
  const originalCode = ["```text", "A👩‍💻", "```"].join("\n");
  await mountEditor(labPage, { id: codeId, markdown: originalCode });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "A👩‍💻", "end"),
    codeId,
  )).toBe(true);
  const codeMirror = editorLocator(labPage, codeId).locator(".cm-content");
  await expect(codeMirror).toHaveCount(1);
  await codeMirror.click();
  await labPage.keyboard.press("End");

  await dispatchNoMutationBackspace(context, codeId, labPage, "code-mirror");
  await expect.poll(() => getMarkdown(labPage, codeId)).toBe([
    "```text",
    "A",
    "```",
  ].join("\n"));
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    codeId,
  )).toBe(true);
  await settleEditor(labPage, codeId);
  expect(await getMarkdown(labPage, codeId)).toBe(originalCode);
});
