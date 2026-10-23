import { writeFile } from "node:fs/promises";
import {
  blurEditor, editorLocator, expect, focusEditor, getHtmlSnapshot, getMarkdown,
  getMathSnapshot, mountEditor, selectFootnote, selectHtml, selectMath, selectToc,
  snapshotEditor, test, updateEditorOptions,
} from "./fixtures";

const markdown = [
  "---\ntitle: Shared atom frames\n---",
  "[TOC]",
  "# Overview",
  "<div>Block HTML source</div>",
  "$$\nx^2 + y^2\n$$",
  "Inline $x$ and <b>HTML</b>, with a note[^note].",
  "![Image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)",
  "```mermaid\ngraph LR; A-->B\n```",
  "[^note]: Editable definition.",
].join("\n\n");

for (const root of ["document", "shadow"] as const) {
  test(`@required shared atom frames preserve selection, semantics and source in ${root}`, async ({ labPage: page }) => {
    const id = `atoms-${root}`;
    await mountEditor(page, { id, root, markdown, extensionMode: "all-advanced", htmlRendererMode: "missing", mathRendererMode: "missing" });
    const editor = editorLocator(page, id);
    const original = await getMarkdown(page, id);
    const html = await getHtmlSnapshot(page, id);
    const math = await getMathSnapshot(page, id);
    const families = [
      { selector: ".mdw-frontmatter", select: () => focusEditor(page, id, "start") },
      { selector: ".mdw-toc", select: () => selectToc(page, id) },
      { selector: ".mdw-html--block", select: () => selectHtml(page, id, html.nodes.find(node => node.display === "block")!) },
      { selector: ".mdw-html--inline", select: () => selectHtml(page, id, html.nodes.find(node => node.display === "inline")!) },
      { selector: ".mdw-math--block", select: () => selectMath(page, id, math.nodes.find(node => node.kind === "block")!) },
      { selector: ".mdw-math--inline", select: () => selectMath(page, id, math.nodes.find(node => node.kind === "inline")!) },
      { selector: ".mdw-footnote-reference", select: () => selectFootnote(page, id, { kind: "reference", label: "note" }) },
      { selector: ".mdw-image", select: () => editor.locator(".mdw-image-frame").click() },
    ];
    await editor.locator(".mdw-image img").evaluate(image => {
      image.style.width = "80px";
      image.style.height = "40px";
    });

    for (const family of families) {
      const atom = editor.locator(family.selector).first();
      await expect(atom).toHaveClass(/mdw-atom/);
      await expect(atom).toHaveAttribute("contenteditable", "false");
      await expect(atom.locator(".mdw-atom-status")).toHaveAttribute("role", "status");
      await family.select();
      await expect(atom).toHaveClass(/ProseMirror-selectednode/);
      await expect(atom).toHaveCSS("outline-style", "solid");
      await expect(atom).toHaveCSS("outline-width", "2px");
      const selection = (await snapshotEditor(page, id)).selection;
      await blurEditor(page, id);
      await expect(atom).toHaveCSS("outline-style", "none");
      await expect(atom).toHaveClass(/ProseMirror-selectednode/);
      await focusEditor(page, id);
      await expect(atom).toHaveCSS("outline-style", "solid");
      expect((await snapshotEditor(page, id)).selection).toEqual(selection);
    }
    await expect(editor.locator("nav.mdw-toc")).toHaveAttribute("role", "navigation");
    await expect(editor.locator("sup.mdw-footnote-reference")).toHaveCount(1);
    for (const editable of await editor.locator(".mdw-diagram, .mdw-footnote-definition").all()) {
      await expect(editable).not.toHaveClass(/mdw-atom/);
    }
    await updateEditorOptions(page, id, { editable: false });
    await expect(editor.locator(".mdw-frontmatter__edit")).toBeDisabled();
    await expect(editor.locator(".mdw-math__action").first()).toBeDisabled();
    await updateEditorOptions(page, id, { editable: true });
    await expect(editor.locator(".mdw-frontmatter__edit")).toBeEnabled();
    expect(await getMarkdown(page, id)).toBe(original);
  });
}

test("@required shared atom rings use system contrast colors through CDP", async ({ labPage: page, browserName, context }, testInfo) => {
  const cdp = browserName === "chromium" ? await context.newCDPSession(page) : null;
  try {
    if (cdp) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    } else {
      await page.emulateMedia({ forcedColors: "active" });
    }
    const id = "atoms-contrast";
    await mountEditor(page, { id, markdown, extensionMode: "all-advanced", mathRendererMode: "missing", htmlRendererMode: "missing" });
    await selectToc(page, id);
    const atom = editorLocator(page, id).locator(".mdw-toc");
    await atom.evaluate(element => element.style.setProperty("--mdw-toc-selection-color", "red"));
    await expect(atom).toHaveCSS("outline-style", "solid");
    expect(await atom.evaluate(element => {
      const probe = element.ownerDocument.createElement("span");
      probe.style.color = "Highlight";
      element.append(probe);
      const matches = getComputedStyle(element).outlineColor === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    })).toBe(true);
    if (cdp) {
      const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: ["outline-style", "outline-color"] });
      expect(snapshot.documents.length).toBeGreaterThan(0);
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const path = testInfo.outputPath("shared-atoms-contrast.png");
      await writeFile(path, Buffer.from(screenshot.data, "base64"));
      await testInfo.attach("shared-atoms-contrast", { path, contentType: "image/png" });
    }
  } finally {
    await cdp?.detach();
  }
});
