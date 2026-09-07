import { expect, test, type Page } from "@playwright/test";

async function applySource(page: Page, markdown: string) {
  await page.goto("/demo");
  await page.getByRole("textbox", { name: "Markdown source", exact: true }).fill(markdown);
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  await expect(page.locator("#output")).toHaveText(markdown);
}

const insertDialog = (page: Page) => page.getByRole("dialog", { name: "Insert math", exact: true });

test("@required playground renders inline and display math on both public entry points", async ({ page }) => {
  for (const route of ["/", "/demo"]) {
    await page.goto(route);
    await expect(page.locator('#editor [data-mdw-math-kind="inline"] math')).toHaveCount(1);
    await expect(page.locator('#editor [data-mdw-math-kind="block"] math mfrac')).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Insert math \(/ })).toBeVisible();
  }
});

test("@required playground inserts a previewed formula and undoes it in one step", async ({ page }) => {
  await applySource(page, "Before\n\nAfter");
  await page.locator("#editor .ProseMirror p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+M");
  const dialog = insertDialog(page);
  await expect(dialog.getByRole("textbox", { name: "LaTeX source" })).toBeFocused();
  await dialog.getByRole("button", { name: "Fraction", exact: true }).click();
  await expect(dialog.locator("math mfrac")).toHaveCount(1);
  await expect(page.locator("#editor .mdw-math")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Insert formula", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#editor .mdw-math math mfrac")).toHaveCount(1);
  await expect(page.locator("#output")).toContainText("$$\n\\frac{a}{b}\n$$");
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await expect(page.locator("#output")).toHaveText("Before\n\nAfter");
  await page.getByRole("button", { name: /^Redo \(/ }).click();
  await expect(page.locator("#editor .mdw-math math mfrac")).toHaveCount(1);
});

test("@required playground preserves an inline caret and keeps Cancel free of document changes", async ({ page }) => {
  await applySource(page, "Energy:");
  // Canonical Markdown trims trailing spaces; insert after punctuation, a valid inline boundary.
  await page.locator("#editor .ProseMirror p").click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: /^Insert math \(/ }).click();
  let dialog = insertDialog(page);
  await dialog.getByRole("radio", { name: /Inline/ }).check();
  await dialog.getByRole("textbox", { name: "LaTeX source" }).fill("E=mc^2");
  await expect(dialog.locator("math")).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "LaTeX source" }).press("ControlOrMeta+Enter");
  await expect(page.locator("#output")).toHaveText("Energy:$E=mc^2$");
  await page.locator("#editor .ProseMirror p").click({ position: { x: 1, y: 8 } });
  await page.getByRole("button", { name: /^Insert math \(/ }).click();
  dialog = insertDialog(page);
  await dialog.getByRole("textbox", { name: "LaTeX source" }).fill("x^2");
  await expect(dialog.locator("math")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#output")).toHaveText("Energy:$E=mc^2$");
});

test("@required math editing preserves a pending source draft and survives route navigation", async ({ page }) => {
  await applySource(page, "Formula\n\n$$\nx^2\n$$");
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  const draft = "Unapplied draft: $a+b$";
  await source.fill(draft);
  const formula = page.locator("#editor .mdw-math");
  await formula.click({ position: { x: 2, y: 2 } });
  await formula.getByRole("button", { name: "Edit math source", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit math", exact: true });
  await dialog.getByRole("textbox", { name: "LaTeX source" }).fill(String.raw`\sqrt{x}`);
  await expect(dialog.locator("math msqrt")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Apply formula", exact: true }).click();
  await expect(source).toHaveValue(draft);
  await expect(page.locator("#output")).toContainText(String.raw`\sqrt{x}`);
  await formula.getByRole("button", { name: "Edit math source", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit math", exact: true });
  await dialog.getByRole("button", { name: "Remove formula", exact: true }).click();
  await expect(formula).toHaveCount(0);
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await expect(formula.locator("math msqrt")).toHaveCount(1);
  const nav = page.getByRole("navigation", { name: "Primary", exact: true });
  await nav.getByRole("link", { name: "API overview", exact: true }).click();
  await nav.getByRole("link", { name: "Core playground", exact: true }).click();
  await expect(formula.locator("math msqrt")).toHaveCount(1);
  await expect(source).toHaveValue(draft);
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  await expect(page.locator('#editor [data-mdw-math-kind="inline"] math')).toHaveCount(1);
  await expect(page.locator("#output")).toHaveText(draft);
});

test("@required formula dialog validates source and fits a narrow screen in the selected theme", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
  await page.getByRole("button", { name: /^Insert math \(/ }).click();
  const dialog = insertDialog(page);
  await expect(dialog).toHaveCSS("background-color", "rgb(32, 37, 45)");
  const source = dialog.getByRole("textbox", { name: "LaTeX source" });
  await source.fill(String.raw`\notARealCommand`);
  await expect(dialog.getByRole("alert")).toContainText("Undefined control sequence");
  await expect(dialog.getByRole("button", { name: "Insert formula", exact: true })).toBeDisabled();
  await source.fill("x\ny");
  await dialog.getByRole("radio", { name: /Inline/ }).check();
  await expect(dialog.getByRole("alert")).toContainText("one line");
  await source.fill("x");
  await expect(dialog.getByRole("button", { name: "Insert formula", exact: true })).toBeEnabled();
  const geometry = await dialog.evaluate(element => ({
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    width: element.clientWidth, contentWidth: element.scrollWidth,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.pageWidth).toBeLessThanOrEqual(320);
  await dialog.getByRole("button", { name: "Insert formula", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: /Inline/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Insert formula", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
