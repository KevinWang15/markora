import { expect, test } from "@playwright/test";

for (const width of [320, 390, 721, 768, 1024, 1200, 1280, 1440]) {
  test(`@required site header and playground fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator("#editor .ProseMirror")).toBeVisible();
    await expect(page.locator('.topnav a[href="/demo"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".sidebar")).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const header = document.querySelector(".topbar")!.getBoundingClientRect();
      const controls = [...document.querySelectorAll(
        ".brand-badge, .brand > span:last-child, .topnav-link, .docs-theme-picker select",
      )].filter(element => element.getBoundingClientRect().width > 0);
      const boxes = controls.map(element => element.getBoundingClientRect());
      const editor = document.querySelector(".panel-editor")!.getBoundingClientRect();
      const source = document.querySelector(".panel-source")!.getBoundingClientRect();
      return {
        clipped: boxes.some(box => box.left < header.left || box.right > header.right),
        overlapping: boxes.some((box, index) => boxes.slice(index + 1).some(other =>
          box.left < other.right && box.right > other.left
          && box.top < other.bottom && box.bottom > other.top)),
        logoWidth: boxes[0].width,
        editorWidth: editor.width,
        sourceWidth: source.width,
        stacked: source.top >= editor.bottom,
      };
    });
    expect(layout.clipped).toBe(false);
    expect(layout.overlapping).toBe(false);
    expect(layout.logoWidth).toBe(42);
    expect(layout.stacked).toBe(width <= 1100);
    if (width > 1100) {
      expect(layout.editorWidth).toBeGreaterThan(500);
      expect(layout.sourceWidth).toBeGreaterThan(450);
    }
  });
}

test("@required narrow documentation keeps API names and snippet headers readable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/docs/api");
  await expect(page.locator(".api-method").first()).toBeVisible();
  const clipped = await page.locator(".api-method, .code-block-meta, .code-block-title").evaluateAll(elements => (
    elements.filter(element => element.scrollWidth > element.clientWidth + 1)
      .map(element => element.textContent)
  ));
  expect(clipped).toEqual([]);
});

test("@required Markdown source and output preserve lines and allow keyboard scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const source = page.locator("#source");
  const output = page.getByRole("region", { name: "Serialized Markdown output" });
  await expect(source).toHaveAttribute("wrap", "off");
  expect(await source.evaluate(element => getComputedStyle(element).fontFamily)).toContain("monospace");
  await expect(output).toHaveCSS("white-space", "pre");
  await output.focus();
  await expect(output).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => output.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});
