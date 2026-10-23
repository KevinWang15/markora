import {
  blurEditor, editorLocator, expect, focusEditor, getMarkdown, mountEditor,
  settleEditor, test, updateEditorOptions,
} from "./fixtures";

test("@required opaque source stays exact and inert beside supported edits", async ({ labPage: page }) => {
  const source = [
    "---",
    "title: Browser safety",
    "---",
    "",
    "# Supported",
    "",
    "Around **Markdown**.",
    "",
    "<script>globalThis.__markoraBrowserRawExecuted = true;</script>",
    "",
    "Inline <span data-label=\"[raw]\">HTML</span> stays inert.",
  ].join("\n");

  await mountEditor(page, { id: "opaque", markdown: source });
  const editor = editorLocator(page, "opaque");

  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="frontmatter"]')).toHaveCount(1);
  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="html-block"]')).toHaveCount(1);
  await expect(editor.locator('.mdw-opaque-node[data-mdw-opaque-kind="inline-html"]')).toHaveCount(2);
  await expect(editor.locator("script, iframe, style")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __markoraBrowserRawExecuted?: boolean }).__markoraBrowserRawExecuted,
  ))).toBe(false);

  await editor.getByRole("button", { name: "Edit Front matter Markdown source" }).click();
  await expect.poll(() => page.evaluate(() => window.__MARKORA_BROWSER_LAB__!.pendingOpaqueEdit("opaque"))).toEqual({
    kind: "frontmatter",
    source: "---\ntitle: Browser safety\n---",
  });
  const updated = await page.evaluate(() => window.__MARKORA_BROWSER_LAB__!.updateOpaque(
    "opaque",
    "---\ntitle: Browser safety updated\n---",
  ));
  expect(updated).toBe(true);

  const selectedHeadingEnd = await page.evaluate(() => (
    window.__MARKORA_BROWSER_LAB__!.selectText("opaque", "Supported", "end")
  ));
  expect(selectedHeadingEnd).toBe(true);
  await page.keyboard.type(" browser");
  await settleEditor(page, "opaque");

  await expect.poll(() => getMarkdown(page, "opaque")).toBe([
    "---",
    "title: Browser safety updated",
    "---",
    "",
    "# Supported browser",
    "",
    "Around **Markdown**.",
    "",
    "<script>globalThis.__markoraBrowserRawExecuted = true;</script>",
    "",
    "Inline <span data-label=\"[raw]\">HTML</span> stays inert.",
  ].join("\n"));
});

for (const root of ["document", "shadow"] as const) {
  test(`@required opaque atom frames follow focus and read-only transitions in ${root}`, async ({ labPage: page }) => {
    const id = `opaque-frame-${root}`;
    const markdown = "---\ntitle: Atom frame\n---\n\nInline <span>source</span>.";
    await mountEditor(page, { id, root, markdown });
    const editor = editorLocator(page, id);

    for (const selector of [".mdw-opaque-block", ".mdw-opaque-inline"]) {
      const atom = editor.locator(selector).first();
      await expect(atom).toHaveClass(/mdw-atom/);
      await expect(atom).toHaveAttribute("contenteditable", "false");
      await expect(atom.locator(".mdw-atom-status")).toHaveAttribute("role", "status");
      if (selector === ".mdw-opaque-block") {
        await focusEditor(page, id, "start");
      } else {
        await atom.locator(".mdw-opaque-source").click();
      }
      await expect(atom).toHaveClass(/ProseMirror-selectednode/);
      await expect(atom).toHaveCSS("outline-style", "solid");
      await expect(atom).toHaveCSS("outline-width", "2px");
      await expect(atom).toHaveCSS("outline-offset", "2px");
      const selection = await page.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id);
      await blurEditor(page, id);
      await expect(atom).toHaveCSS("outline-style", "none");
      await expect(atom).toHaveClass(/ProseMirror-selectednode/);
      await focusEditor(page, id);
      await expect(atom).toHaveCSS("outline-style", "solid");
      expect(await page.evaluate(id => window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection, id)).toEqual(selection);
    }

    const edit = editor.getByRole("button", { name: "Edit Front matter Markdown source" });
    await updateEditorOptions(page, id, { editable: false });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute("aria-disabled", "true");
    await edit.evaluate(button => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(await page.evaluate(id => window.__MARKORA_BROWSER_LAB__!.pendingOpaqueEdit(id), id)).toBeNull();
    await updateEditorOptions(page, id, { editable: true });
    await expect(edit).toBeEnabled();
    await edit.click();
    expect(await page.evaluate(id => window.__MARKORA_BROWSER_LAB__!.pendingOpaqueEdit(id), id)).toEqual({
      kind: "frontmatter", source: "---\ntitle: Atom frame\n---",
    });
    expect(await getMarkdown(page, id)).toBe(markdown);
  });
}

test("@required opaque atoms use the shared forced-colors ring", async ({ labPage: page, browserName, context }) => {
  const cdp = browserName === "chromium" ? await context.newCDPSession(page) : null;
  try {
    if (cdp) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    } else {
      await page.emulateMedia({ forcedColors: "active" });
    }
    await mountEditor(page, { id: "opaque-contrast", markdown: "---\ntitle: Contrast\n---\n\nBody" });
    const atom = editorLocator(page, "opaque-contrast").locator(".mdw-atom");
    await focusEditor(page, "opaque-contrast", "start");
    await expect(atom).toHaveCSS("outline-style", "solid");
    await expect(atom).toHaveCSS("box-shadow", "none");
    expect(await atom.evaluate(element => {
      const probe = element.ownerDocument.createElement("span");
      probe.style.color = "Highlight";
      element.append(probe);
      const matches = getComputedStyle(element).outlineColor === getComputedStyle(probe).color;
      probe.remove();
      return matches && matchMedia("(forced-colors: active)").matches;
    })).toBe(true);
    await blurEditor(page, "opaque-contrast");
    await expect(atom).toHaveCSS("outline-style", "none");
  } finally {
    await cdp?.detach();
  }
});
