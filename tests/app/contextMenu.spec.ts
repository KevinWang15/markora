import { expect, test, type Page } from "@playwright/test";
async function openDocument(page: Page, markdown: string) {
  await page.goto("/"); await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open document", exact: true }).click();
  await (await picker).setFiles({ name: "context.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
}
const editor = (page: Page) => page.getByRole("textbox", { name: "Markdown document", exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "Editor context menu", exact: true });

test("context menu Undo and Redo use document history across source and rich mode", async ({ page, context }) => {
  await openDocument(page, "Original");
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await source.click(); await page.keyboard.press("ControlOrMeta+A");
  const cdp = await context.newCDPSession(page); await cdp.send("Input.insertText", { text: "Changed source" });
  await page.getByRole("button", { name: "Return to rich text", exact: true }).click();
  await editor(page).click(); await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(editor(page)).toHaveText("Original");
  await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Redo", exact: true }).click();
  await expect(editor(page)).toHaveText("Changed source");
});

test("app context menu formats a selected range and edits math in the active theme", async ({ page }) => {
  await openDocument(page, "hello world\n\n$$\nx^2\n$$");
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
  await editor(page).locator("p").first().click(); await page.keyboard.press("Home");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await menu(page).getByRole("menuitem", { name: "Format", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Bold", exact: true }).click();
  await expect(editor(page).locator("strong")).toContainText("hello");
  await editor(page).locator(".mdw-math").click({ button: "right", position: { x: 12, y: 65 } });
  await menu(page).getByRole("menuitem", { name: "Edit formula…", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit math", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "LaTeX source", exact: true })).toBeFocused();
});


test("context menus stay above app chrome when a short viewport forces them upward", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 400 });
  await openDocument(page, "text");
  await editor(page).click(); await page.keyboard.press("Shift+F10");
  const firstItem = menu(page).getByRole("menuitem", { name: "Cut", exact: true });
  await expect(firstItem).toBeVisible();
  expect(await firstItem.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await page.keyboard.press("Escape"); await expect(editor(page)).toBeFocused();
});
