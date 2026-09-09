import { editorLocator, expect, mountEditor, test } from "./fixtures";

const prose = [
  ...[1, 2, 3, 4, 5, 6].flatMap(level => [
    "* First item\n* Second item", `${"#".repeat(level)} Heading ${level}`,
    "> A quote", "1. Ordered item\n2. Another item", "> Another quote",
  ]),
  "* Parent\n  * Nested item\n  * Another nested item",
  "A final paragraph.",
].join("\n\n");

for (const root of ["document", "shadow"] as const) {
  for (const entry of ["root", "minimal"] as const) {
    test(`@required ${entry} block spacing respects prose rhythm and compact lists in ${root}`, async ({ labPage }) => {
      const id = `spacing-${entry}-${root}`;
      await mountEditor(labPage, { id, root, entry, markdown: prose });
      const editor = editorLocator(labPage, id);
      await editor.evaluate(element => {
        element.style.setProperty("--mdw-block-spacing", "24px");
        element.style.setProperty("--mdw-list-nested-spacing", "3px");
      });
      const gaps = await editor.evaluate(element => {
        const blocks = Array.from(element.children).filter(child => child.matches("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote"));
        return blocks.slice(1).map((child, i) => ({
          pair: `${blocks[i]!.tagName} → ${child.tagName}`,
          gap: child.getBoundingClientRect().top - blocks[i]!.getBoundingClientRect().bottom,
        }));
      });
      for (const { pair, gap } of gaps) expect(gap, pair).toBeCloseTo(24, 0);
      await expect(editor.locator("li > p + ul")).toHaveCSS("margin-block-start", "3px");
      await expect(editor.locator(":scope > :first-child")).toHaveCSS("margin-block-start", "0px");
      await expect(editor.locator(":scope > :last-child")).toHaveCSS("margin-block-end", "0px");
    });
  }

  test(`@required block insets and task nesting stay compact in ${root}`, async ({ labPage }) => {
    const id = `insets-${root}`;
    await mountEditor(labPage, {
      id, root,
      markdown: "```text\nLeading code\n```\n\n* [ ] Parent\n  * Nested task content\n\n> ```text\n> Quoted code\n> ```\n\n| Cell |\n| --- |\n| Text |",
    });
    const editor = editorLocator(labPage, id);
    await editor.evaluate(element => element.style.setProperty("--mdw-list-nested-spacing", "3px"));
    await expect(editor.locator(":scope > .mdw-code-block")).toHaveCSS("margin-block-start", "0px");
    await expect(editor.locator("blockquote > .mdw-code-block")).toHaveCSS("margin-block-start", "0px");
    await expect(editor.locator(".mdw-task-content > p + ul")).toHaveCSS("margin-block-start", "3px");
    await expect(editor.locator(":scope > table")).toHaveCSS("margin-block-end", "0px");
    await expect(editor.locator("td > p")).toHaveCSS("margin-block-start", "0px");
  });
}

for (const width of [1440, 390]) {
  test(`@required playground separates a list from its heading at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
    await page.locator("#source").fill("* a\n\n* b\n\n## aaa\n\nabc");
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    const editor = page.locator("#editor .ProseMirror");
    await expect(editor.locator("h2")).toHaveText("aaa");
    const geometry = await editor.evaluate(element => ({
      gap: element.querySelector("h2")!.getBoundingClientRect().top - element.querySelector("ul")!.getBoundingClientRect().bottom,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(geometry.gap).toBeGreaterThanOrEqual(12);
    expect(geometry.overflow).toBe(false);
    await editor.screenshot({ path: testInfo.outputPath("list-heading-spacing.png") });
  });
}
