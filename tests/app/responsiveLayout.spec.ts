import { expect, test } from "@playwright/test";

for (const width of [720, 800, 1024]) {
  test(`sidebar and Find controls remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/");
    await expect(page.locator(".app-editor .ProseMirror")).toBeVisible();
    await page.keyboard.press("Control+f");
    const find = page.getByRole("textbox", { name: "Find text", exact: true });
    await expect(find).toBeFocused();
    const bounds = await page.evaluate(() => {
      const sidebar = document.querySelector(".app-sidebar")!.getBoundingClientRect();
      const main = document.querySelector(".app-main")!.getBoundingClientRect();
      const input = document.querySelector<HTMLInputElement>('[aria-label="Find text"]')!;
      const rect = input.getBoundingClientRect();
      return { overlap: sidebar.right - main.left, inputVisible: document.elementFromPoint(rect.left + 5, rect.top + rect.height / 2) === input };
    });
    expect(bounds.overlap).toBeLessThanOrEqual(1);
    expect(bounds.inputVisible).toBe(true);
    await find.fill("Markdown");
    await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
    await expect(page.locator(".app-sidebar")).toBeHidden();
    await expect(find).toHaveValue("Markdown");
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await expect(page.locator(".app-sidebar")).toBeVisible();
    const toolbar = page.locator(".app-toolbar");
    await toolbar.evaluate(e => e.scrollLeft = 0);
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const toolbarBox = (await toolbar.boundingBox())!;
    expect((await undo.boundingBox())!.x).toBeGreaterThanOrEqual(toolbarBox.x);
  });
}
