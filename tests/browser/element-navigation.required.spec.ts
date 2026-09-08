import { test, expect, mountEditor, focusEditor, editorLocator, snapshotEditor, getMarkdown, updateEditorOptions } from "./fixtures";

for (const entry of ["root", "minimal"] as const) {
  test(`@required ${entry} shared boundary deletes the directional neighbor and respects readonly`, async ({ labPage }) => {
    const id = `boundary-delete-${entry}`;
    await mountEditor(labPage, { id, entry, markdown: "```js\nfirst\n```\n\n---\n\n```js\nlast\n```" });
    const host = editorLocator(labPage, id);
    const original = await getMarkdown(labPage, id);
    await focusEditor(labPage, id, { anchor: 1 });
    await labPage.keyboard.press("Escape");
    await expect(host.locator("pre.mdw-element-selected, .mdw-element-selected pre")).toHaveCount(1);
    await labPage.keyboard.press("ArrowRight");
    const boundary = (await snapshotEditor(labPage, id)).selection.head;
    await labPage.keyboard.press("Backspace");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("first");
    expect(await getMarkdown(labPage, id)).toContain("---");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toBe(original);
    expect((await snapshotEditor(labPage, id)).selection.head).toBe(boundary);
    await labPage.keyboard.press("Delete");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("---");
    expect(await getMarkdown(labPage, id)).toContain("first");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toBe(original);
    await labPage.keyboard.press("ArrowRight");
    await expect(host.locator("hr.mdw-element-selected, .mdw-element-selected hr")).toHaveCount(1);
    await updateEditorOptions(labPage, id, { editable: false });
    await host.focus();
    await labPage.keyboard.press("Delete");
    await labPage.keyboard.press("Backspace");
    expect(await getMarkdown(labPage, id)).toBe(original);
  });

  test(`@required ${entry} consecutive elements share one boundary in both directions`, async ({ labPage, context, browserName }, testInfo) => {
    const id = `elements-${entry}`;
    const markdown = ["Before", "```js\nx\n```", "```mermaid\ngraph LR; A-->B\n```", "```plantuml\nAlice -> Bob\n```", "---", "> Quoted", ...(entry === "root" ? ["| A |\n| --- |\n| B |", "$$\nx\n$$", "![pic](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)"] : []), "After"].join("\n\n");
    await mountEditor(labPage, { id, entry, markdown, root: "shadow", extensionMode: entry === "root" ? "all-advanced" : "diagrams", mathEditMode: "in-place", mathRendererMode: "sync" });
    const host = editorLocator(labPage, id);
    const original = await getMarkdown(labPage, id);
    await focusEditor(labPage, id, { anchor: 7 });
    const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
    const arrow = async (key: "ArrowLeft" | "ArrowRight") => {
      if (cdp) {
        const code = key === "ArrowLeft" ? 37 : 39;
        for (const type of ["rawKeyDown", "keyUp"] as const) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      } else await labPage.keyboard.press(key);
    };
    const expected = ["pre", '[data-mdw-diagram-kind="mermaid"]', '[data-mdw-diagram-kind="plantuml"]', "hr", "blockquote", ...(entry === "root" ? ["table", '[data-mdw-math-kind="block"]', "img"] : [])];
    try {
      for (const selector of expected) {
        await arrow("ArrowRight");
        await expect(host.locator(".mdw-element-selected"), `select ${selector}`).toHaveCount(1);
        await expect(host.locator(".mdw-element-selected")).toHaveCSS("outline-style", "solid");
        await expect(host.locator(`${selector}.mdw-element-selected, .mdw-element-selected ${selector}`)).toHaveCount(1);
        expect((await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(false);
        await arrow("ArrowRight");
        await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
        const selection = (await snapshotEditor(labPage, id)).selection;
        expect(selection.from).toBe(selection.to);
      }
      for (const selector of [...expected].reverse()) {
        await arrow("ArrowLeft");
        await expect(host.locator(`${selector}.mdw-element-selected, .mdw-element-selected ${selector}`)).toHaveCount(1);
        await arrow("ArrowLeft");
        await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
      }
      expect((await snapshotEditor(labPage, id)).selection.head).toBe(7);
      expect(await getMarkdown(labPage, id)).toBe(original);
      await arrow("ArrowRight");
      await labPage.screenshot({ path: testInfo.outputPath("selected-code.png") });
      await labPage.keyboard.press("Enter");
      await labPage.keyboard.insertText("edited ");
      await expect.poll(() => getMarkdown(labPage, id)).toContain("edited x");
      await labPage.keyboard.press("Escape");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      expect((await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(false);
      const edited = await getMarkdown(labPage, id);
      await labPage.keyboard.press("Delete");
      await expect.poll(() => getMarkdown(labPage, id)).not.toContain("edited x");
      await labPage.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => getMarkdown(labPage, id)).toBe(edited);
    } finally { await cdp?.detach(); }
  });

  test(`@required ${entry} inline math and images have reversible three-state traversal`, async ({ labPage }, testInfo) => {
    const id = `inline-${entry}`;
    await mountEditor(labPage, { id, entry, root: "shadow", markdown: "A $x$![pic](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)$y$ Z", extensionMode: "math", mathEditMode: "in-place", mathRendererMode: "sync" });
    const host = editorLocator(labPage, id);
    await focusEditor(labPage, id, { anchor: 3 });
    for (let index = 0; index < 3; index++) {
      await labPage.keyboard.press("ArrowRight");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      await labPage.keyboard.press("ArrowRight");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
      expect((await snapshotEditor(labPage, id)).selection.head).toBe(4 + index);
    }
    for (let index = 0; index < 3; index++) {
      await labPage.keyboard.press("ArrowLeft");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      await labPage.keyboard.press("ArrowLeft");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
    }
    expect((await snapshotEditor(labPage, id)).selection.head).toBe(3);
    await labPage.keyboard.press("ArrowRight");
    await labPage.screenshot({ path: testInfo.outputPath("selected-inline-math.png") });
    await labPage.keyboard.press("Delete");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("$x$");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toContain("$x$");
  });
}
