import { editorLocator, expect, getMarkdown, mountEditor, ownedOverlay, test } from "./fixtures";
import type { MarkdownThemeController } from "../../packages/core/src/themes";

declare global {
  interface Window { __themeTestController?: MarkdownThemeController; }
}

for (const root of ["document", "shadow"] as const) {
  test(`@required document themes switch in a ${root} scope without changing content or selection`, async ({ labPage }) => {
    const id = `themes-${root}`;
    const markdown = "# Theme preview\n\nA paragraph with **bold**, *emphasis*, and [a link](https://example.com/).\n\n```js\nconst answer = 42;\n```";
    await mountEditor(labPage, { id, root, markdown, portal: "body" });
    const editor = editorLocator(labPage, id);
    await editor.evaluate((element) => {
      const api = window.__MARKORA_BROWSER_LAB__!;
      const custom = api.themes.defineTheme({ id: "custom-paper", label: "Custom paper", extends: "newsprint", tokens: { "--mdw-color-accent": "rgb(121, 57, 54)" } });
      window.__themeTestController = api.themes.createThemeController({
        element: element.closest<HTMLElement>("[data-e2e-frame]")!,
        themes: [...api.themes.builtInThemes, custom],
      });
    });
    const before = await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id);
    const appearances: Record<string, { font: string; background: string; maxWidth: string }> = {};
    try {
      for (const theme of ["light", "github", "newsprint", "sepia", "night", "dark", "contrast", "auto", "custom-paper"]) {
        await labPage.evaluate(theme => window.__themeTestController!.setTheme(theme), theme);
        await expect(editor.locator("h1")).toContainText("Theme preview");
        appearances[theme] = await editor.evaluate(element => {
          const style = getComputedStyle(element);
          return { font: style.fontFamily, background: style.backgroundColor, maxWidth: style.maxInlineSize };
        });
        expect(await getMarkdown(labPage, id)).toBe(markdown);
        expect(await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id)).toEqual(before);
      }
      expect(appearances.github.font).not.toBe(appearances.newsprint.font);
      expect(appearances.github.maxWidth).not.toBe(appearances.newsprint.maxWidth);
      expect(appearances.sepia.background).toBe("rgb(251, 245, 233)");
      expect(appearances.night.background).toBe("rgb(32, 37, 45)");
      await expect(editor.locator("a")).toHaveCSS("color", "rgb(121, 57, 54)");
      expect(await labPage.evaluate(id => {
        const api = window.__MARKORA_BROWSER_LAB__!;
        return api.selectText(id, "a link", "start") && api.openUi(id, "link");
      }, id)).toBe(true);
      const overlay = ownedOverlay(labPage, id, ".mdw-link-editor");
      await expect(overlay).toBeVisible();
      await expect(overlay).toHaveAttribute("data-mdw-theme-id", "custom-paper");
      await expect(overlay).toHaveCSS("background-color", "rgb(250, 249, 246)");
      await labPage.evaluate(() => window.__themeTestController!.setTheme("github"));
      await expect(overlay).toHaveAttribute("data-mdw-theme-id", "github");
      await expect(overlay).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(editor.locator("a")).toHaveCSS("color", "rgb(9, 105, 218)");
      await overlay.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally {
      await labPage.evaluate(() => { window.__themeTestController?.destroy(); delete window.__themeTestController; });
    }
  });
}

test("@required demo theme picker persists and keeps CDP edits and undo across live switches", async ({ page, context, browserName }) => {
  await page.goto("/demo");
  const editor = page.locator("#editor .ProseMirror");
  await expect(editor).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(picker.locator("option")).toHaveCount(8);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  const cdp = browserName === "chromium" ? await context.newCDPSession(page) : null;
  if (cdp) await cdp.send("Input.insertText", { text: " theme edit" });
  else await page.keyboard.insertText(" theme edit");
  await expect(editor).toContainText("theme edit");
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeEnabled();
  await picker.selectOption("sepia");
  await expect(editor).toHaveCSS("background-color", "rgb(251, 245, 233)");
  await picker.selectOption("night");
  await expect(editor).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await expect(editor).toContainText("theme edit");
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(editor).not.toContainText("theme edit");
  await page.reload();
  await expect(picker).toHaveValue("night");
  await expect(editor).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await cdp?.detach();
});

test("@required nested reference scopes reset typography and contrast tokens", async ({ labPage }) => {
  const id = "nested-theme";
  await mountEditor(labPage, { id, theme: "light", markdown: "# Nested light editor\n\nBody text" });
  const editor = editorLocator(labPage, id);
  const before = await editor.evaluate(element => getComputedStyle(element).fontFamily);
  await editor.evaluate(element => {
    element.closest<HTMLElement>("[data-e2e-editor]")!.dataset.mdwTheme = "newsprint";
  });
  await expect(editor).toHaveCSS("font-family", before);
  await editor.evaluate(element => {
    element.closest<HTMLElement>("[data-e2e-editor]")!.dataset.mdwTheme = "contrast";
  });
  await expect(editor).toHaveCSS("border-top-width", "1px");
  await editor.evaluate(element => {
    const frame = element.closest<HTMLElement>("[data-e2e-frame]")!;
    frame.removeAttribute("data-mdw-theme");
    frame.classList.add("mdw-theme-night");
  });
  await expect(editor).toHaveCSS("background-color", "rgb(32, 37, 45)");
});
