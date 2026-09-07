import { expect, test, type Page } from "@playwright/test";

async function openDocument(page: Page, markdown: string) {
  await page.goto("/");
  await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open document", exact: true }).click();
  await (await picker).setFiles({ name: "math.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
}
async function markdown(page: Page) {
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(source).toBeVisible();
  return (await source.locator(".cm-line").allTextContents()).join("\n");
}
const editor = (page: Page) => page.getByRole("textbox", { name: "Markdown document", exact: true });

test("CDP inserts display math with a live preview and one undo step", async ({ page, context }) => {
  await openDocument(page, "Before");
  await editor(page).click(); await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+m");
  const dialog = page.getByRole("dialog", { name: "Insert math", exact: true });
  const source = dialog.getByRole("textbox", { name: "LaTeX source" });
  await expect(source).toBeFocused();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: String.raw`\frac{a}{b}` });
  await expect(dialog.locator("math mfrac")).toHaveCount(1);
  await expect(page.locator(".app-editor .mdw-math")).toHaveCount(0);
  await source.press("Control+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app-editor [data-mdw-math-kind="block"] math')).toHaveCount(1);
  expect(await markdown(page)).toContain("$$\n\\frac{a}{b}\n$$");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toHaveText("Before");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toContainText("\\frac{a}{b}");
});

test("inline math inserts at the preserved caret and remains semantic Markdown", async ({ page }) => {
  await openDocument(page, "Formula: .");
  await editor(page).click(); await page.keyboard.press("Control+End"); await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Insert math", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert math", exact: true });
  await dialog.getByRole("radio", { name: /Inline/ }).check();
  await dialog.getByRole("textbox", { name: "LaTeX source" }).fill("E=mc^2");
  await expect(dialog.locator("math")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Insert formula" }).click();
  await expect(page.locator('.app-editor [data-mdw-math-kind="inline"]')).toHaveCount(1);
  expect(await markdown(page)).toBe("Formula: $E=mc^2$.");
});

test("existing formulas can be previewed, updated, removed, and restored by undo", async ({ page }) => {
  await openDocument(page, "Inline $x^2$.");
  const formula = page.locator(".app-editor .mdw-math");
  await formula.click();
  await formula.getByRole("button", { name: "Edit math source", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit math", exact: true });
  await dialog.getByRole("textbox", { name: "LaTeX source" }).fill(String.raw`\sqrt{x}`);
  await expect(dialog.locator("math msqrt")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Apply formula" }).click();
  await expect(formula.locator("math msqrt")).toHaveCount(1);
  await formula.getByRole("button", { name: "Edit math source", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit math", exact: true });
  await dialog.getByRole("button", { name: "Remove formula" }).click();
  await expect(formula).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(formula.locator("math msqrt")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await markdown(page)).toBe("Inline $x^2$.");
});

test("templates and validation stay local to the dialog; Escape cancels without edits", async ({ page }) => {
  await openDocument(page, "Keep this text");
  await editor(page).click(); await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Insert math", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert math", exact: true });
  const source = dialog.getByRole("textbox", { name: "LaTeX source" });
  await expect(source).toHaveValue("Keep this text");
  await source.fill("");
  await dialog.getByRole("button", { name: "Matrix", exact: true }).click();
  await expect(dialog.locator("math mtable")).toHaveCount(1);
  await source.fill(String.raw`\notARealCommand{x}`);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Insert formula" })).toBeDisabled();
  await source.fill("x\ny");
  await dialog.getByRole("radio", { name: /Inline/ }).check();
  await expect(dialog.getByRole("alert")).toContainText("one line");
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  expect(await markdown(page)).toBe("Keep this text");
  await expect(page.getByRole("button", { name: "Insert math", exact: true })).toBeDisabled();
});
