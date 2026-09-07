import { expect, test } from "@playwright/test";

test("theme picker preserves CDP edits, source state, undo, and the stored preference", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
  const picker = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(picker.locator("option")).toHaveCount(8);
  const editor = page.getByRole("textbox", { name: "Markdown document", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.insertText", { text: " theme edit" });
  for (const theme of ["github", "newsprint", "sepia", "night"]) {
    await picker.selectOption(theme);
    await expect(page.locator(".markora-app")).toHaveAttribute("data-theme", theme);
    await expect(editor).toContainText("theme edit");
  }
  await expect(page.locator(".markora-app")).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(source).toBeVisible();
  await source.focus();
  await page.keyboard.press("Control+End");
  await picker.selectOption("sepia");
  await expect(source).toBeVisible();
  await expect(source).toContainText("theme edit");
  await expect(page.locator(".app-source-editor")).toHaveCSS("background-color", "rgb(251, 245, 233)");
  await source.focus();
  await page.keyboard.press("Control+z");
  await expect(source).not.toContainText("theme edit");
  await page.reload();
  await expect(picker).toHaveValue("sepia");
  await expect(page.locator(".markora-app")).toHaveCSS("background-color", "rgb(251, 245, 233)");
  await cdp.detach();
});

test("theme preference tolerates blocked storage and follows system appearance", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "markora-app.theme") throw new DOMException("Denied", "SecurityError");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "markora-app.theme") throw new DOMException("Full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
  const picker = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(picker).toHaveValue("auto");
  await expect(page.locator(".markora-app")).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await picker.selectOption("newsprint");
  await expect(page.locator(".markora-app")).toHaveCSS("background-color", "rgb(250, 249, 246)");
  await picker.selectOption("auto");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".markora-app")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
