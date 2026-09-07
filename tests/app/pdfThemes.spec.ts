import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

for (const theme of ["light", "dark", "github", "newsprint", "sepia", "night", "auto", "contrast"]) {
  test(`PDF export keeps the ${theme} appearance in Chromium print output`, async ({ page, context }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator(".markora-app")).not.toHaveAttribute("inert");
    const picker = page.getByRole("combobox", { name: "Theme", exact: true });
    await picker.selectOption(theme);
    const editor = page.getByRole("textbox", { name: "Markdown document", exact: true, includeHidden: true });
    const appearance = await editor.evaluate(element => {
      const style = getComputedStyle(element);
      return { font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color,
        paper: getComputedStyle(document.querySelector(".markora-app")!).backgroundColor };
    });
    const before = await editor.textContent();
    if (theme === "sepia") await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
    await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = "true"; }; });
    await page.getByRole("button", { name: "Print / Save as PDF", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-requested", "true");
    // The save dialog can outlive a theme or system preference change.
    await picker.selectOption(theme === "night" ? "sepia" : "night");
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    const article = page.locator("#markora-print article");
    await expect(article).toHaveAttribute("data-theme", theme);
    await expect(article).toHaveCSS("font-family", appearance.font);
    await expect(article).toHaveCSS("font-size", appearance.size);
    await expect(article).toHaveCSS("line-height", appearance.lineHeight);
    await expect(article).toHaveCSS("color", appearance.color);
    await expect(page.locator("body")).toHaveCSS("background-color", appearance.paper);
    await expect(article).toHaveCSS("print-color-adjust", "exact");
    if (theme === "github") await expect(article.locator("h1")).toHaveCSS("border-bottom-width", "1px");
    await expect(page.locator("#markora-print .ProseMirror, #markora-print [contenteditable], #markora-print button")).toHaveCount(0);
    const cdp = await context.newCDPSession(page);
    const { data } = await cdp.send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    const pdf = Buffer.from(data, "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    await writeFile(testInfo.outputPath(`${theme}.pdf`), pdf);
    await cdp.detach();
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
    await expect(page.locator("#markora-print")).toHaveCount(0);
    expect(await editor.textContent()).toBe(before);
    await expect(page.locator(".app-file-location")).not.toHaveText("Edited");
    if (theme === "sepia") await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toBeVisible();
  });
}
