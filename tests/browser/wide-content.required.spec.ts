import { editorLocator, expect, getMarkdown, mountEditor, ownedOverlay, runEditorCommand, test } from "./fixtures";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const tableMarkdown = "| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| one | two | three | four | five | six | seven | eight |";

for (const root of ["document", "shadow"] as const) {
  test(`@required wide tables scroll locally and keep editing controls aligned in ${root}`, async ({ labPage }, testInfo) => {
    await labPage.setViewportSize({ width: 390, height: 900 });
    const id = `wide-table-${root}`;
    await mountEditor(labPage, { id, root, markdown: tableMarkdown });
    const editor = editorLocator(labPage, id);
    const scroller = editor.locator(".mdw-table-scroll");
    const table = scroller.locator("table");
    expect(await table.locator("th").first().evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(127);
    expect(await editor.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await table.locator("td").first().click();
    const controls = ownedOverlay(labPage, id, ".mdw-table-edge-controls");
    const rowSelector = controls.getByRole("button", { name: "Select row 2", exact: true });
    const leftBefore = (await rowSelector.boundingBox())!.x;
    for (let i = 0; i < 7; i++) await labPage.keyboard.press("Tab");
    await expect.poll(() => scroller.evaluate(e => e.scrollLeft)).toBeGreaterThan(100);
    await expect(controls.locator('[data-mdw-table-axis="column"][data-mdw-table-index="0"]')).toBeHidden();
    await expect(controls.getByRole("button", { name: "Select column 8", exact: true })).toBeVisible();
    await expect.poll(async () => Math.abs((await rowSelector.boundingBox())!.x - leftBefore)).toBeLessThan(1);
    const bounds = await scroller.boundingBox();
    for (const box of await controls.locator('.mdw-table-edge-selector[data-mdw-table-axis="column"]:visible').evaluateAll(es => es.map(e => e.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(box.right).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    expect(await runEditorCommand(labPage, id, { type: "addTableColumn", side: "after" })).toBe(true);
    await expect(table.locator("th")).toHaveCount(9);
    await runEditorCommand(labPage, id, { type: "undo" });
    await expect(table.locator("th")).toHaveCount(8);
    expect(await getMarkdown(labPage, id)).toBe(tableMarkdown);
    await editor.screenshot({ path: testInfo.outputPath("wide-table.png") });
  });
}

test("@required long code labels stay compact without truncating the editable fence info", async ({ labPage }) => {
  await labPage.setViewportSize({ width: 390, height: 844 });
  const id = "long-language-label";
  const info = "long_fence_information_".repeat(10);
  await mountEditor(labPage, { id, markdown: `\`\`\`${info}\ncode\n\`\`\`` });
  const label = editorLocator(labPage, id).locator(".mdw-code-block-language");
  expect((await label.boundingBox())!.height).toBeLessThan(60);
  await expect(label).toHaveCSS("text-overflow", "ellipsis");
  await expect(label).toHaveAttribute("title", info);
  await label.click();
  const input = ownedOverlay(labPage, id, ".mdw-code-language-editor").getByLabel("Code block language or fence info");
  await expect(input).toHaveValue(info);
  await input.fill("javascript");
  await input.press("Enter");
  await expect(label).toHaveText("javascript");
  await runEditorCommand(labPage, id, { type: "undo" });
  await expect(label).toHaveAttribute("title", info);
});

for (const theme of ["github", "night"]) {
  test(`@required wide rendered math stays within ${theme} prose and supports native horizontal scrolling`, async ({ page, context, browserName }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    const formula = Array(20).fill("a_i+b_i").join("+");
    await page.locator("#source").fill(`Before $${formula}$ after.\n\n$$\n${formula}\n$$\n\nEnd.`);
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    const editor = page.locator("#editor .ProseMirror");
    await expect(editor.locator('.mdw-math[data-mdw-math-state="rendered"]')).toHaveCount(2);
    expect(await editor.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const cdp = browserName === "chromium" ? await context.newCDPSession(page) : null;
    try {
      for (const preview of await editor.locator(".mdw-math__preview").all()) {
        await expect(preview.locator(".mdw-math__render")).toHaveAttribute("inert", "");
        if (await preview.evaluate(e => e.parentElement!.classList.contains("mdw-math--inline"))) {
          expect(await preview.evaluate((e: HTMLElement) => e.offsetHeight - e.clientHeight)).toBe(0);
          expect(await preview.evaluate((e: HTMLElement) => e.offsetWidth - e.clientWidth)).toBe(0);
        }
        await preview.hover();
        if (cdp) {
          const box = (await preview.boundingBox())!;
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x + box.width / 2, y: box.y + box.height / 2, deltaX: 300, deltaY: 0 });
        } else await page.mouse.wheel(300, 0);
        await expect.poll(() => preview.evaluate(e => e.scrollLeft)).toBeGreaterThan(100);
      }
      await editor.locator(".mdw-math--inline").click();
      const input = editor.getByRole("textbox", { name: "LaTeX source", exact: true });
      await expect(input).toHaveValue(formula);
      await input.fill("x^2");
      await input.press("Escape");
      await expect(editor.locator(".mdw-math--inline .katex")).toBeVisible();
      await editor.screenshot({ path: testInfo.outputPath("wide-math.png") });
    } finally { await cdp?.detach(); }
  });
}
