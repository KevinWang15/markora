import { expect, test } from "./fixtures";

// Headless Chromium hides native scrollbars by default, masking inline layout
// regressions that are visible in the desktop application.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const theme of ["github", "night"]) {
  test(`@required ${theme} inline math has no scrollbar chrome and contains tall formulas`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    const formulas = [
      "E = mc^2",
      String.raw`\dfrac{a+b}{c+d}`,
      String.raw`\sqrt{x^2+y^2}`,
      String.raw`\int_0^\infty e^{-x^2}\,dx`,
      String.raw`\sum_{n=1}^{10} n^2`,
      String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    ];
    await page.locator("#source").fill(formulas.map(source => `Inline math: $${source}$ after.`).join("\n\n"));
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    const editor = page.locator("#editor .ProseMirror");
    await expect(editor.locator('[data-mdw-math-state="rendered"]')).toHaveCount(formulas.length);

    for (const fontSize of [14, 20, 28]) {
      await editor.evaluate((element, size) => { element.style.fontSize = `${size}px`; }, fontSize);
      for (const preview of await editor.locator(".mdw-math__preview").all()) {
        const metrics = await preview.evaluate((element: HTMLElement) => {
          const bounds = element.getBoundingClientRect();
          const math = element.querySelector("math")!.getBoundingClientRect();
          return {
            verticalBar: element.offsetWidth - element.clientWidth,
            horizontalBar: element.offsetHeight - element.clientHeight,
            horizontalOverflow: element.scrollWidth - element.clientWidth,
            clippedTop: bounds.top - math.top,
            clippedBottom: math.bottom - bounds.bottom,
          };
        });
        expect(metrics.verticalBar).toBe(0);
        expect(metrics.horizontalBar).toBe(0);
        expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
        expect(metrics.clippedTop).toBeLessThanOrEqual(1);
        expect(metrics.clippedBottom).toBeLessThanOrEqual(1);
      }
      if (fontSize === 20) await editor.screenshot({ path: testInfo.outputPath("inline-math.png") });
    }

    await editor.locator(".mdw-math--inline").first().click();
    const input = editor.getByRole("textbox", { name: "LaTeX source", exact: true });
    await expect(input).toHaveValue(formulas[0]);
    await input.fill("x^2");
    await input.press("Escape");
    await expect(editor.locator(".mdw-math--inline").first().locator("math")).toBeVisible();
  });
}
