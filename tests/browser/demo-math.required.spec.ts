import { expect, test, type Page } from "@playwright/test";

async function applySource(page: Page, markdown: string) {
  await page.goto("/demo");
  await page.getByRole("textbox", { name: "Markdown source", exact: true }).fill(markdown);
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  await expect(page.locator("#output")).toHaveText(markdown);
}
const formula = (page: Page) => page.locator("#editor .mdw-math");
const input = (page: Page) => page.getByRole("textbox", { name: "LaTeX source", exact: true });

test("@required playground renders math on both entry points and edits by clicking", async ({ page }) => {
  for (const route of ["/", "/demo"]) {
    await page.goto(route);
    const block = page.locator('#editor [data-mdw-math-kind="block"]');
    await expect(block.locator("math mfrac")).toHaveCount(1);
    await block.click();
    await expect(input(page)).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await input(page).fill(String.raw`\sqrt{x}`);
    await expect(block.locator(".mdw-tex-command")).toHaveText("\\sqrt");
    await page.locator("#source").click();
    await expect(input(page)).toHaveCount(0);
    await expect(block.locator("math msqrt")).toBeVisible();
    await expect(page.locator("#source")).toBeFocused();
  }
});

test("@required playground inserts highlighted display source without a dialog", async ({ page }) => {
  await applySource(page, "Before\n\nAfter");
  await page.locator("#editor .ProseMirror p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+M");
  await expect(input(page)).toBeFocused();
  await input(page).fill(String.raw`\frac{a}{b}`);
  await expect(page.locator("#output")).toContainText(String.raw`\frac{a}{b}`);
  await input(page).press("Escape");
  await expect(formula(page).locator("math mfrac")).toBeVisible();
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await expect(page.locator("#output")).toHaveText("Before\n\nAfter");
  await page.getByRole("button", { name: /^Redo \(/ }).click();
  await expect(formula(page).locator("math mfrac")).toBeVisible();
});

test("@required inline source supports typing, keyboard exit and empty deletion", async ({ page }) => {
  await applySource(page, "Energy: $x$.");
  await formula(page).click();
  await input(page).fill("E=mc^2");
  await input(page).press("Enter");
  await expect(page.locator("#output")).toHaveText("Energy: $E=mc^2$.");
  await page.keyboard.type(" continues");
  await expect(page.locator("#output")).toHaveText("Energy: $E=mc^2$ continues.");
  await formula(page).click();
  await input(page).fill("");
  await page.locator("#source").click();
  await expect(formula(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await expect(formula(page).locator("math")).toBeVisible();
});

test("@required math edits preserve a pending Markdown draft and survive navigation", async ({ page }) => {
  await applySource(page, "Formula\n\n$$\nx^2\n$$");
  const source = page.locator("#source");
  const draft = "Unapplied draft: $a+b$";
  await source.fill(draft);
  await formula(page).click();
  await input(page).fill(String.raw`\sqrt{x}`);
  await source.click();
  await expect(source).toHaveValue(draft);
  await expect(page.locator("#output")).toContainText(String.raw`\sqrt{x}`);
  const nav = page.getByRole("navigation", { name: "Primary", exact: true });
  await nav.getByRole("link", { name: "API overview", exact: true }).click();
  await nav.getByRole("link", { name: "Core playground", exact: true }).click();
  await expect(formula(page).locator("math msqrt")).toBeVisible();
  await expect(source).toHaveValue(draft);
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  await expect(page.locator("#output")).toHaveText(draft);
});

test("@required invalid TeX remains editable and source fits a narrow themed viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await applySource(page, "$$\nx\n$$");
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
  await formula(page).click();
  await input(page).fill(String.raw`\notARealCommand{x}`);
  await page.locator("#source").click();
  await expect(formula(page).locator('[role="status"]')).toContainText("preview failed");
  await expect(page.locator("#output")).toContainText(String.raw`\notARealCommand{x}`);
  await formula(page).locator(".mdw-math__source").click();
  await input(page).fill(String.raw`\frac{a}{b} + \sqrt{x}`);
  const geometry = await input(page).evaluate(element => ({
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    pageWidth: document.documentElement.scrollWidth,
    caret: getComputedStyle(element).caretColor,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  expect(geometry.pageWidth).toBeLessThanOrEqual(320);
  expect(geometry.caret).not.toBe("rgba(0, 0, 0, 0)");
  await input(page).press("ControlOrMeta+Enter");
  await expect(formula(page).locator("math mfrac")).toBeVisible();
  await page.keyboard.type("Next paragraph");
  await expect(page.locator("#output")).toContainText("Next paragraph");
});
