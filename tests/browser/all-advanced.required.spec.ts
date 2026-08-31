import {
  copyEditorSelection,
  editorLocator,
  expect,
  focusEditor,
  getDiagramSnapshot,
  getExtensionSnapshot,
  getHtmlSnapshot,
  getMarkdown,
  getMathSnapshot,
  getTocSnapshot,
  mountEditor,
  resetEditor,
  test,
} from "./fixtures";

const ALL_ADVANCED_SOURCE = [
  "---",
  "title: All advanced syntax",
  "---",
  "",
  "# Combined heading",
  "",
  "[TOC]",
  "",
  "Inline $x+y$ with a footnote.[^all]",
  "",
  "> [!NOTE]",
  "> Combined alert body.",
  "",
  "<section data-kind=\"combined\">HTML source</section>",
  "",
  "```mermaid theme=combined",
  'graph TD; A["$inside$ [^all] <span>"]-->B',
  "```",
  "",
  "[^all]: Combined footnote definition.",
].join("\n");

const EXPECTED_MANIFEST = [
  "markora-extension-frontmatter",
  "markora-extension-footnotes",
  "markora-extension-math",
  "markora-extension-alerts",
  "markora-extension-toc",
  "markora-extension-html",
  "markora-extension-diagrams",
];

test("@required all seven advanced-syntax packages compose without claim, NodeView, clipboard, or cleanup collisions", async ({ labPage }) => {
  const id = "all-advanced-shadow";
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "sync" },
    extensionMode: "all-advanced",
    htmlRendererMode: "sync",
    id,
    markdown: ALL_ADVANCED_SOURCE,
    mathRendererMode: "sync",
    root: "shadow",
  });

  const editor = editorLocator(labPage, id);
  const diagram = editor.locator("[data-mdw-diagram]");
  await diagram.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await getDiagramSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("rendered");
  await expect.poll(async () => (await getHtmlSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("rendered");
  await expect.poll(async () => (
    await getMathSnapshot(labPage, id)
  ).nodes.every(({ render }) => render.status === "rendered")).toBe(true);

  expect((await getExtensionSnapshot(labPage, id)).manifest.map(({ name }) => name))
    .toEqual(EXPECTED_MANIFEST);
  await expect(editor.getByRole("region", { name: "YAML front matter source" }))
    .toHaveCount(1);
  await expect(editor.locator("[data-mdw-footnote-reference]"))
    .toHaveCount(1);
  await expect(editor.locator("[data-mdw-footnote-definition]"))
    .toHaveCount(1);
  await expect(editor.locator('[data-mdw-math-kind="inline"]'))
    .toHaveCount(1);
  await expect(editor.locator("[data-mdw-math]"))
    .toHaveCount(1);
  await expect(editor.locator('[data-mdw-alert-kind="note"]'))
    .toHaveCount(1);
  await expect(editor.locator("nav[data-mdw-toc]"))
    .toHaveCount(1);
  await expect(editor.locator('[data-mdw-html-kind="html-block"]'))
    .toHaveCount(1);
  await expect(editor.locator("[data-mdw-html]"))
    .toHaveCount(1);
  await expect(diagram).toHaveCount(1);
  expect((await getDiagramSnapshot(labPage, id)).nodes[0]).toMatchObject({
    info: "mermaid theme=combined",
    kind: "mermaid",
    source: 'graph TD; A["$inside$ [^all] <span>"]-->B',
  });
  expect((await getTocSnapshot(labPage, id)).headings).toEqual([
    expect.objectContaining({ label: "Combined heading", level: 1 }),
  ]);

  const canonical = await getMarkdown(labPage, id);
  expect(canonical).toContain("title: All advanced syntax");
  expect(canonical).toContain("[TOC]");
  expect(canonical).toContain("$x+y$");
  expect(canonical).toContain("[^all]");
  expect(canonical).toContain("> [!NOTE]");
  expect(canonical).toContain('<section data-kind="combined">HTML source</section>');
  expect(canonical).toContain(
    '```mermaid theme=combined\ngraph TD; A["$inside$ [^all] <span>"]-->B\n```',
  );

  await focusEditor(labPage, id, "all");
  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe(canonical);
  expect(copied.plain).toBe(canonical);
  expect(copied.html).toContain("data-mdw-frontmatter-source");
  expect(copied.html).toContain("data-mdw-footnote-definition");
  expect(copied.html).toContain('data-mdw-math-kind="inline"');
  expect(copied.html).toContain('data-mdw-alert-kind="note"');
  expect(copied.html).toContain("data-mdw-toc");
  expect(copied.html).toContain('data-mdw-html-kind="html-block"');
  expect(copied.html).toContain('data-mdw-diagram-kind="mermaid"');
  expect(copied.html).not.toContain("data-mdw-toc-entry");
  expect(copied.html).not.toContain("data-mdw-math-preview");
  expect(copied.html).not.toContain("data-mdw-html-preview");
  expect(copied.html).not.toContain("data-mdw-diagram-preview");
  expect(copied.html).not.toContain("browser-lab-math-rendered");
  expect(copied.html).not.toContain("browser-lab-html-rendered");
  expect(copied.html).not.toContain("Rendered mermaid diagram");

  expect(await resetEditor(labPage, id, canonical)).toBe(canonical);
  expect((await getExtensionSnapshot(labPage, id)).manifest.map(({ name }) => name))
    .toEqual(EXPECTED_MANIFEST);
  expect((await getDiagramSnapshot(labPage, id)).nodes).toHaveLength(1);
  expect((await getHtmlSnapshot(labPage, id)).nodes).toHaveLength(1);
  expect((await getMathSnapshot(labPage, id)).nodes).toHaveLength(1);
  expect((await getTocSnapshot(labPage, id)).tocs).toHaveLength(1);
});
