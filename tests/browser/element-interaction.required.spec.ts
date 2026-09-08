import { editorLocator, expect, getMarkdown, mountEditor, runEditorCommand, settleEditor, test } from "./fixtures";
import type { CDPSession, Page } from "@playwright/test";

async function press(page: Page, cdp: CDPSession | null, key: "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown", shift = true) {
  if (!cdp) return page.keyboard.press(`${shift ? "Shift+" : ""}${key}`);
  const keyCode = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40 }[key];
  for (const type of ["rawKeyDown", "keyUp"] as const) {
    await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
}
const blocks = {
  code: "```js\none\ntwo\n```",
  diagram: "```mermaid\ngraph TD; A-->B\n```",
  table: "| A | B |\n| --- | --- |\n| C | D |",
};
for (const root of ["document", "shadow"] as const) {
  for (const entry of ["root", "minimal"] as const) {
    for (const [kind, middle] of Object.entries(blocks)) {
      if (entry === "minimal" && kind === "table") continue;
      test(`@required ${entry}/${root}: document selection crosses ${kind} without trapping or losing its anchor`, async ({ labPage, browserName, context }) => {
        const id = "element-range";
        const markdown = `before\n\n${middle}\n\nafter`;
        await mountEditor(labPage, { id, entry, root, markdown, extensionMode: kind === "diagram" ? "diagrams" : undefined, diagramRendererModes: { mermaid: "sync" } });
        const canonical = await getMarkdown(labPage, id);
        const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
        for (const [key, reverse] of [["ArrowRight", "ArrowLeft"], ["ArrowDown", "ArrowUp"]] as const) {
          await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.selectText(id, "before", "end"), id);
          const anchor = await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection.anchor, id);
          await press(labPage, cdp, key); await settleEditor(labPage, id);
          const selected = await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id);
          expect(selected.anchor).toBe(anchor); expect(selected.head).toBeGreaterThan(anchor + 1);
          await press(labPage, cdp, reverse); await settleEditor(labPage, id);
          expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor, head: anchor });
          await press(labPage, cdp, key); await settleEditor(labPage, id);
          await labPage.keyboard.press("Backspace"); await settleEditor(labPage, id);
          expect(await getMarkdown(labPage, id)).toBe("beforeafter");
          expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
          expect(await getMarkdown(labPage, id)).toBe(canonical);
        }
        await cdp?.detach();
      });
    }
  }

  test(`@required ${root}: mouse selection across a rendered diagram keeps its geometry and deletion range`, async ({ labPage, browserName, context }) => {
    const id = "diagram-drag";
    const markdown = "before\n\n```mermaid\ngraph TD; A-->B\n```\n\nafter";
    await mountEditor(labPage, { id, root, markdown, extensionMode: "diagrams", diagramRendererModes: { mermaid: "sync" } });
    const editor = editorLocator(labPage, id);
    await expect(editor.locator("[data-mdw-diagram]")).toHaveAttribute("data-mdw-diagram-state", "rendered");
    const source = editor.locator(".mdw-diagram__source-shell");
    await expect(source).toHaveClass(/visually-hidden/);
    const points = await editor.evaluate(el => ["before", "after"].map((text, index) => {
      const p = [...el.querySelectorAll("p")].find(p => p.textContent === text)!;
      const range = el.ownerDocument.createRange(); range.setStart(p.firstChild!, index ? 3 : 2); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    }));
    const before = await editor.locator("p").last().boundingBox();
    const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
    const [a, b] = points;
    if (cdp) await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...a });
    else { await labPage.mouse.move(a.x, a.y); await labPage.mouse.down(); }
    for (let i = 1; i <= 12; i++) {
      const point = { x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 };
      if (cdp) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...point });
      else await labPage.mouse.move(point.x, point.y);
    }
    if (cdp) await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...b });
    else await labPage.mouse.up();
    await settleEditor(labPage, id);
    await expect(source).toHaveClass(/visually-hidden/);
    expect((await editor.locator("p").last().boundingBox())!.y).toBe(before!.y);
    await labPage.keyboard.press("Backspace"); await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("beer");
    await runEditorCommand(labPage, id, { type: "undo" }); expect(await getMarkdown(labPage, id)).toBe(markdown);
    await cdp?.detach();
  });

  test(`@required ${root}: Shift-click extends through math without opening source editing`, async ({ labPage }) => {
    const id = "math-shift-click";
    await mountEditor(labPage, { id, root, markdown: "before\n\n$$\nx^2\n$$\n\nafter", extensionMode: "math", mathEditMode: "in-place", mathRendererMode: "sync" });
    const editor = editorLocator(labPage, id);
    await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.selectText(id, "before", "end"), id);
    await editor.locator("[data-mdw-math]").click({ modifiers: ["Shift"] });
    await settleEditor(labPage, id);
    await expect(editor.locator("textarea")).toHaveCount(0);
    await expect(editor.locator("[data-mdw-math]")).toHaveClass(/mdw-document-selected/);
    const selection = await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id);
    expect(selection.anchor).toBe(7); expect(selection.head).toBeGreaterThan(7);
    await editor.locator("[data-mdw-math]").click();
    await expect(editor.getByRole("textbox", { name: "LaTeX source", exact: true })).toBeFocused();
  });
}

for (const entry of ["root", "minimal"] as const) {
  for (const root of ["document", "shadow"] as const) {
    test(`@required ${entry}/${root}: selecting a terminal math block includes its boundary and restores it with Undo`, async ({ labPage, browserName, context }) => {
      const id = "terminal-element";
      const markdown = "before\n\n$$\nx^2\n$$";
      await mountEditor(labPage, { id, entry, root, markdown, extensionMode: "math", mathEditMode: "in-place", mathRendererMode: "sync" });
      const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
      for (const method of ["keyboard", "mouse"] as const) {
        await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.selectText(id, "before", "end"), id);
        if (method === "keyboard") await press(labPage, cdp, "ArrowRight");
        else await editorLocator(labPage, id).locator("[data-mdw-math]").click({ modifiers: ["Shift"] });
        await settleEditor(labPage, id);
        const selection = await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id);
        expect(selection).toMatchObject({ anchor: 7, head: 9 });
        await press(labPage, cdp, "ArrowRight"); await settleEditor(labPage, id);
        expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toEqual(selection);
        await labPage.keyboard.press("Backspace"); await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe("before");
        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        expect(await getMarkdown(labPage, id)).toBe(markdown);
        expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toEqual(selection);
      }
      await press(labPage, cdp, "ArrowRight", false); await settleEditor(labPage, id);
      expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor: 9, head: 9 });
      await press(labPage, cdp, "ArrowLeft"); await settleEditor(labPage, id);
      expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor: 9, head: 7 });
      await press(labPage, cdp, "ArrowRight"); await settleEditor(labPage, id);
      expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor: 9, head: 9 });
      if (cdp) await cdp.send("Input.insertText", { text: "next" });
      else await labPage.keyboard.insertText("next");
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(`${markdown}\n\nnext`);
      await labPage.evaluate(({ id, markdown }) => {
        const lab = window.__MARKORA_BROWSER_LAB__!; lab.reset(id, markdown); lab.selectText(id, "before", "end");
      }, { id, markdown });
      await press(labPage, cdp, "ArrowRight"); await settleEditor(labPage, id);
      if (cdp) await cdp.send("Input.insertText", { text: "replacement" });
      else await labPage.keyboard.insertText("replacement");
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe("beforereplacement");
      await cdp?.detach();
    });
  }
}

test("@required leading frontmatter can be selected backwards without deleting body text", async ({ labPage, browserName, context }) => {
  const id = "frontmatter-boundary";
  const markdown = "---\ntitle: test\n---\n\nafter";
  await mountEditor(labPage, { id, markdown, extensionMode: "frontmatter" });
  await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.selectText(id, "after", "start"), id);
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
  await press(labPage, cdp, "ArrowLeft"); await settleEditor(labPage, id);
  expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor: 2, head: 0 });
  await labPage.keyboard.press("Delete"); await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("after");
  await runEditorCommand(labPage, id, { type: "undo" }); expect(await getMarkdown(labPage, id)).toBe(markdown);
  await cdp?.detach();
});

test("@required inline atoms support arrow traversal, adjacent deletion, and Undo without opening their controls", async ({ labPage, browserName, context }) => {
  const id = "inline-elements";
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
  const image = "![alt](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)";
  for (const atom of ["$x$", "<!-- note -->", "[^n]", image]) {
    const suffix = atom === "[^n]" ? "\n\n[^n]: Definition" : "";
    const markdown = `before ${atom} after${suffix}`;
    await mountEditor(labPage, { id, markdown, extensionMode: "all-advanced", mathEditMode: "in-place", mathRendererMode: "sync", htmlRendererMode: "sync" });
    const canonical = await getMarkdown(labPage, id);
    for (const [anchor, arrow, deletion] of [[8, "ArrowRight", "Delete"], [9, "ArrowLeft", "Backspace"]] as const) {
      await labPage.evaluate(({ id, anchor }) => window.__MARKORA_BROWSER_LAB__!.focus(id, { anchor }), { id, anchor });
      await press(labPage, cdp, arrow, false); await settleEditor(labPage, id);
      await expect(editorLocator(labPage, id).locator(".ProseMirror-selectednode")).toHaveCount(1);
      await expect(editorLocator(labPage, id).locator("textarea")).toHaveCount(0);
      await press(labPage, cdp, arrow, false); await settleEditor(labPage, id);
      expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id)).head).toBe(anchor === 8 ? 9 : 8);
      await labPage.evaluate(({ id, anchor }) => window.__MARKORA_BROWSER_LAB__!.focus(id, { anchor }), { id, anchor });
      await labPage.keyboard.press(deletion); await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(`before  after${suffix}`);
      await runEditorCommand(labPage, id, { type: "undo" }); expect(await getMarkdown(labPage, id)).toBe(canonical);
    }
    await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.destroy(id), id);
  }
  await cdp?.detach();
});

for (const root of ["document", "shadow"] as const) {
  test(`@required ${root}: consecutive atomic blocks extend and shrink one block at a time`, async ({ labPage, browserName, context }) => {
    const id = "consecutive-elements";
    const markdown = "before\n\n$$\nx\n$$\n\n$$\ny\n$$\n\nafter";
    await mountEditor(labPage, { id, root, markdown, extensionMode: "math", mathRendererMode: "sync" });
    await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.selectText(id, "before", "end"), id);
    const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
    for (const [key, head] of [["ArrowRight", 9], ["ArrowRight", 11], ["ArrowLeft", 9], ["ArrowLeft", 7]] as const) {
      await press(labPage, cdp, key); await settleEditor(labPage, id);
      expect((await labPage.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id))).toMatchObject({ anchor: 7, head });
    }
    await press(labPage, cdp, "ArrowRight");
    await labPage.keyboard.press("Delete"); await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("before\n\n$$\ny\n$$\n\nafter");
    await runEditorCommand(labPage, id, { type: "undo" });
    expect(await getMarkdown(labPage, id)).toBe(markdown);
    await cdp?.detach();
  });
}
