import { readFile } from "node:fs/promises";
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
const input = (page: Page) => page.getByRole("textbox", { name: "LaTeX source", exact: true });
const formula = (page: Page) => page.locator(".app-editor .mdw-math");

test("CDP inserts highlighted display math in place and preserves document history", async ({ page, context }) => {
  await openDocument(page, "Before");
  await editor(page).click(); await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+m");
  await expect(input(page)).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: String.raw`\frac{a}{b}` });
  await expect(formula(page).locator(".mdw-tex-command")).toHaveText("\\frac");
  await input(page).press("Escape");
  await expect(formula(page).locator("math mfrac")).toBeVisible();
  expect(await markdown(page)).toContain("$$\n\\frac{a}{b}\n$$");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).not.toContainText("\\frac");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toContainText("\\frac");
  await cdp.detach();
});

test("inline math inserts at the context-menu caret and exits into the sentence", async ({ page }) => {
  await openDocument(page, "Formula: .");
  await editor(page).click(); await page.keyboard.press("Control+End"); await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Insert inline math", exact: true }).click();
  await expect(input(page)).toBeFocused();
  await input(page).fill("E=mc^2"); await input(page).press("Enter");
  await page.keyboard.type(" more");
  expect(await markdown(page)).toBe("Formula: $E=mc^2$ more.");
});

test("clicking away updates a formula without taking focus from the toolbar", async ({ page }) => {
  await openDocument(page, "Inline $x^2$.");
  await formula(page).click();
  await input(page).fill(String.raw`\sqrt{x}`);
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.focus();
  await expect(input(page)).toHaveCount(0);
  await expect(theme).toBeFocused();
  await expect(formula(page).locator("math msqrt")).toBeVisible();
  await formula(page).click(); await input(page).fill(""); await theme.focus();
  await expect(formula(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(formula(page).locator("math msqrt")).toBeVisible();
});

test("CDP source typing owns native undo and invalid TeX is preserved on blur", async ({ page, context }) => {
  await openDocument(page, "$$\nx\n$$");
  await formula(page).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: String.raw`\sqrt{x}` });
  await input(page).press("Control+z");
  await expect(input(page)).toHaveValue("x");
  await expect(input(page)).toBeFocused();
  await input(page).press("Control+Shift+z");
  await expect(input(page)).toHaveValue(String.raw`\sqrt{x}`);
  await input(page).fill(String.raw`\notARealCommand{x}`);
  await input(page).press("Escape");
  await expect(formula(page).locator('[role="status"]')).toContainText("preview failed");
  expect(await markdown(page)).toContain(String.raw`\notARealCommand{x}`);
  await cdp.detach();
});

test("CDP composition stays in the source input until the committed text arrives", async ({ page, context }) => {
  await openDocument(page, "Before $x$ after.");
  await formula(page).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue("中文");
  await expect(formula(page).locator("[data-mdw-math-source]")).toHaveText("$x$");
  await cdp.send("Input.insertText", { text: "中文" });
  await expect(formula(page).locator("[data-mdw-math-source]")).toHaveText("$中文$");
  expect(await markdown(page)).toBe("Before $中文$ after.");
  await cdp.detach();
});


test("keyboard Save commits an unfinished source draft before capturing the document", async ({ page }) => {
  await openDocument(page, "Before $x$ after.");
  await formula(page).click();
  await input(page).fill(" x ");
  const download = page.waitForEvent("download");
  await input(page).press("Control+s");
  const saved = await download;
  expect(await readFile((await saved.path())!, "utf8")).toBe("Before  x  after.");
  await expect(input(page)).toHaveCount(0);
});
