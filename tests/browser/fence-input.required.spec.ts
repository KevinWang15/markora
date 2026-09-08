import { test, expect, mountEditor, resetEditor, focusEditor, editorLocator,
  getDiagramSnapshot, getMarkdown } from "./fixtures";

for (const entry of ["root", "minimal"] as const) {
  test(`@required ${entry} typed fences create the matching editable block on Enter`, async ({ labPage, context, browserName }, testInfo) => {
    test.setTimeout(60_000);
    const id = `fence-${entry}`;
    await mountEditor(labPage, { id, entry, markdown: "", extensionMode: "diagrams", root: "shadow" });
    const host = editorLocator(labPage, id);
    const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
    const type = async (text: string) => {
      for (const character of text) {
        if (cdp) await cdp.send("Input.insertText", { text: character });
        else await labPage.keyboard.insertText(character);
      }
    };
    try {
      for (const kind of ["mermaid", "plantuml", "geojson", "topojson", "stl"]) {
        await resetEditor(labPage, id, "");
        await focusEditor(labPage, id, "end");
        await type(`\`\`\`${kind}`);
        await labPage.keyboard.press("Enter");
        await expect(host.locator(`[data-mdw-diagram-kind="${kind}"]`)).toHaveCount(1);
        expect((await getDiagramSnapshot(labPage, id)).nodes).toMatchObject([{ kind, source: "" }]);
        await labPage.keyboard.press("ControlOrMeta+z");
        await expect(host.locator("[data-mdw-diagram-kind]")).toHaveCount(0);
        await expect(host.locator("p")).toHaveText(`\`\`\`${kind}`);
        await labPage.keyboard.press("ControlOrMeta+Shift+z");
        await expect(host.locator(`[data-mdw-diagram-kind="${kind}"]`)).toHaveCount(1);
        await type("body");
        expect((await getDiagramSnapshot(labPage, id)).nodes).toMatchObject([{ kind, source: "body" }]);
      }
      // Generic and extension fences share the same entry path; aliases and
      // punctuation in ordinary language labels must retain their fence info.
      for (const [fence, info] of [["```", ""], ["```typescript", "typescript"], ["~~~c++", "c++"], ["```unknown-engine", "unknown-engine"]]) {
        await resetEditor(labPage, id, "");
        await focusEditor(labPage, id, "end");
        await type(fence!);
        await labPage.keyboard.press("Enter");
        await expect(host.locator("pre")).toHaveCount(1);
        await expect.poll(() => getMarkdown(labPage, id)).toContain(`\`\`\`${info}\n`);
        await type("code");
        await expect.poll(() => getMarkdown(labPage, id)).toContain("\ncode\n");
      }
      await resetEditor(labPage, id, "");
      await focusEditor(labPage, id, "end");
      await type("```mermaid ");
      await expect(host.locator('[data-mdw-diagram-kind="mermaid"]')).toHaveCount(1);
      await labPage.keyboard.press("Backspace");
      await expect(host.locator("p")).toHaveText("```mermaid ");
      await expect(host.locator("[data-mdw-diagram-kind]")).toHaveCount(0);
      await labPage.screenshot({ path: testInfo.outputPath("typed-fence.png") });
    } finally { await cdp?.detach(); }
  });
}

test("@required playground typed Mermaid and PlantUML fences render after entering source", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/demo");
  for (const [kind, source] of [["mermaid", "flowchart LR\nStart --> Finish"], ["plantuml", "Alice -> Bob: Hello"]]) {
    await page.locator("#source").fill("");
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    await page.locator("#editor .ProseMirror p").click();
    await page.keyboard.type(`\`\`\`${kind}`);
    await page.keyboard.press("Enter");
    const shell = page.locator(`#editor [data-mdw-diagram-kind="${kind}"]`);
    await expect(shell).toHaveCount(1);
    const lines = source!.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (index > 0) await page.keyboard.press("Enter");
      await page.keyboard.type(lines[index]!);
    }
    await page.locator("#source").click();
    await expect(shell.locator("[data-mdw-diagram-preview] svg")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#output")).toContainText(source!);
  }
  await page.screenshot({ path: testInfo.outputPath("typed-diagram-preview.png"), fullPage: true });
});
