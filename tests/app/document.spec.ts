import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openDocument(page: Page, content: string) {
  const picking = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open document", exact: true }).click();
  await (await picking).setFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from(content) });
}
async function source(page: Page) {
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toBeVisible();
}
async function rich(page: Page) {
  await page.getByRole("button", { name: "Return to rich text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown document", exact: true })).toBeVisible();
}
async function sourceText(page: Page) {
  return (await page.locator(".app-source-editor .cm-line").allTextContents()).join("\n");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
});

test("untouched saves retain original bytes, including CRLF and footnotes", async ({ page }) => {
  const original = "Title\r\n=====\r\n\r\nA[^1] &copy;\r\n\r\n[^1]: Footnote\r\n";
  await openDocument(page, original);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!, "utf8")).toBe(original);
});

test("CDP source and rich edits share undo and redo across view changes", async ({ page, context }) => {
  await openDocument(page, "original");
  const body = page.getByRole("textbox", { name: "Markdown document", exact: true });
  await body.click(); await page.keyboard.press("Control+End");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: " rich" });
  await source(page);
  expect(await sourceText(page)).toBe("original rich");
  await page.keyboard.press("Control+End");
  await cdp.send("Input.insertText", { text: " source" });
  await rich(page); await body.click(); await page.keyboard.press("Control+z");
  await source(page); expect(await sourceText(page)).toBe("original rich");
  await page.keyboard.press("Control+z"); expect(await sourceText(page)).toBe("original");
  await page.keyboard.press("Control+Shift+z"); expect(await sourceText(page)).toBe("original rich");
  await rich(page); await body.click(); await page.keyboard.press("Control+Shift+z");
  await source(page); expect(await sourceText(page)).toBe("original rich source");
});

test("unsaved modal confines keyboard focus and Escape preserves the document", async ({ page, context }) => {
  await openDocument(page, "original"); await source(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: "changed " });
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest("dialog[open]")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await sourceText(page)).toContain("changed");
});

test("outline uses actual model headings, including Setext and literal hashes", async ({ page }) => {
  await openDocument(page, "First\n=====\n\n## C#\n\n## Second");
  await expect(page.locator(".app-outline-item")).toHaveText(["First", "C#", "Second"]);
  await page.locator(".app-outline-item").filter({ hasText: "Second" }).click();
  expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("h2")?.textContent)).toContain("Second");
});

test("recovery survives reload and restores the source as unsaved", async ({ page, context }) => {
  await openDocument(page, "original"); await source(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: "recovered " });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("markora-app.recovery") ?? "{}").markdown)).toContain("recovered");
  await page.reload();
  await expect(page.getByRole("alertdialog")).toContainText("Recover your document?");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toBeVisible();
  expect(await sourceText(page)).toContain("recovered");
  await expect(page.locator(".app-file-location")).toHaveText("Edited");
});

test("rich footnotes survive editing and saving", async ({ page, context }) => {
  await openDocument(page, "A[^1]\n\n[^1]: Footnote\n");
  await page.getByRole("textbox", { name: "Markdown document", exact: true }).click();
  await page.keyboard.press("Control+End");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: "!" });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  const saved = await readFile((await (await downloading).path())!, "utf8");
  expect(saved).toContain("A[^1]");
  expect(saved).not.toContain("[^1](Footnote)");
});

test("rejected merged table paste explains the limitation and preserves content", async ({ page }) => {
  await openDocument(page, "before");
  const body = page.getByRole("textbox", { name: "Markdown document", exact: true });
  await body.click(); await page.keyboard.press("Control+End");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async () => {
    const html = '<table><tbody><tr><th colspan="2">Merged</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>';
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob(["Merged\nA\tB"], { type: "text/plain" }),
    })]);
  });
  await page.keyboard.press("Control+v");
  await expect(page.getByRole("alert")).toContainText("Pasted merged table cells cannot be represented");
  await expect(body).toHaveText("before");
  await expect(page.locator(".app-file-location")).not.toHaveText("Edited");
});

test("saving nested table content requires an explicit conversion decision", async ({ page }) => {
  await openDocument(page, "before");
  const body = page.getByRole("textbox", { name: "Markdown document", exact: true });
  await body.click(); await page.keyboard.press("Control+End");
  await body.evaluate(element => {
    const data = new DataTransfer();
    data.setData("text/html", "<table><tr><th>Header</th></tr><tr><td><p>First</p><p>Second</p></td></tr></table>");
    data.setData("text/plain", "Header\nFirst\nSecond");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.locator(".app-editor td p")).toHaveCount(2);
  // Separate the next typing burst from the pasted table in document history.
  await page.waitForTimeout(600);
  await page.locator(".app-editor td p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".app-editor td p")).toHaveText(["First", "Second"]);
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Review table conversion");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".app-editor td p")).toHaveCount(2);
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save Markdown", exact: true }).click();
  const saved = await readFile((await (await downloading).path())!, "utf8");
  expect(saved).toContain("First");
  expect(saved).toContain("Second");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("source conversion requires consent and rich table structure remains undoable", async ({ page }) => {
  await openDocument(page, "before");
  const body = page.getByRole("textbox", { name: "Markdown document", exact: true });
  await body.click(); await page.keyboard.press("Control+End");
  await body.evaluate(element => {
    const data = new DataTransfer();
    data.setData("text/html", "<table><tr><th>H</th></tr><tr><td><p>First</p><p>Second</p></td></tr></table>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Review source conversion");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-editor td p")).toHaveText(["First", "Second"]);
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  await page.getByRole("button", { name: "Continue to source", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown source", exact: true }).focus();
  await page.keyboard.type("edit ");
  await rich(page); await body.click(); await page.keyboard.press("Control+z");
  await expect(page.locator(".app-editor td p")).toHaveText(["First", "Second"]);
});

test("view switches retain source caret and scroll without adding undo steps", async ({ page }) => {
  await openDocument(page, Array.from({ length: 150 }, (_, i) => `Line ${i}: Writing at a stable position.`).join("\n\n"));
  await source(page);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowLeft");
  const scroller = page.locator(".app-source-editor .cm-scroller");
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  const top = await scroller.evaluate(element => element.scrollTop);
  await rich(page); await source(page);
  await expect.poll(() => scroller.evaluate((element, position) => Math.abs(element.scrollTop - position), top)).toBeLessThan(3);
  await page.keyboard.type("CARET");
  // CodeMirror virtualizes long files, so inspect the actual saved source.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toMatch(/positionCARET\.$/u);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
