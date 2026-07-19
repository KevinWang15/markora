import AxeBuilder from "@axe-core/playwright";
import type { Request } from "@playwright/test";
import {
  copyEditorSelection,
  destroyEditorOnly,
  editorLocator,
  expect,
  focusEditor,
  getEditorEvents,
  getExtensionSnapshot,
  getHtmlRendererCalls,
  getHtmlSnapshot,
  getMarkdown,
  getPendingHtmlEdit,
  mountEditor,
  reconcileEditor,
  removePendingHtmlEdit,
  resetEditor,
  runEditorCommand,
  runHtmlCommand,
  selectHtml,
  settleEditor,
  settleHtmlRenderer,
  test,
  updateEditorOptions,
  updatePendingHtmlEdit,
  type LabHtmlNodeTarget,
} from "./fixtures";

const EXACT_BLOCK = '<div data-kind="exact">\r\nblock [not](markdown)\r\n</div>';
const EXACT_BLOCK_COMMENT = "<!-- block\r\ncomment -->";
const EXACT_INLINE_OPEN = '<span data-label="[a] &amp;">';
const EXACT_INLINE_CLOSE = "</span>";
const EXACT_INLINE_COMMENT = "<!-- inline\r\ncomment -->";
const EXACT_LINE = `Before ${EXACT_INLINE_OPEN}inside${EXACT_INLINE_CLOSE} ${EXACT_INLINE_COMMENT} after.`;
const EXACT_MARKDOWN = [
  EXACT_BLOCK,
  EXACT_BLOCK_COMMENT,
  EXACT_LINE,
].join("\r\n\r\n") + "\r\n";
const EXACT_CANONICAL = [
  EXACT_BLOCK,
  EXACT_BLOCK_COMMENT,
  EXACT_LINE,
].join("\n\n");

async function waitForHtmlCalls(
  page: Parameters<typeof getHtmlRendererCalls>[0],
  id: string,
  count: number,
) {
  await expect.poll(async () => (await getHtmlRendererCalls(page, id)).length)
    .toBe(count);
}

async function waitForHtmlStatus(
  page: Parameters<typeof getHtmlSnapshot>[0],
  id: string,
  status: string,
) {
  await expect.poll(async () => (await getHtmlSnapshot(page, id)).nodes[0]?.render.status)
    .toBe(status);
}

test("@required HTML preserves exact block, inline, and comment source in document and Shadow roots", async ({ labPage }) => {
  const canonical: string[] = [];

  for (const [id, root] of [
    ["html-root-document", "document"],
    ["html-root-shadow", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry: "root",
      extensionMode: "html",
      htmlRendererMode: "missing",
      id,
      markdown: EXACT_MARKDOWN,
      root,
    });

    const editor = editorLocator(labPage, id);
    await expect(editor.locator('[data-mdw-html-display="block"]')).toHaveCount(2);
    await expect(editor.locator('[data-mdw-html-display="inline"]')).toHaveCount(3);
    await expect(editor.locator('[data-mdw-html-kind="html-block"]')).toHaveCount(1);
    await expect(editor.locator('[data-mdw-html-kind="html-comment"]')).toHaveCount(2);
    await expect(editor.locator('[data-mdw-html-kind="inline-html"]')).toHaveCount(2);

    const snapshot = await getHtmlSnapshot(labPage, id);
    expect(snapshot.nodes.map(({ display, kind, source }) => ({
      display,
      kind,
      source,
    }))).toEqual([
      { display: "block", kind: "html-block", source: EXACT_BLOCK },
      { display: "block", kind: "html-comment", source: EXACT_BLOCK_COMMENT },
      { display: "inline", kind: "inline-html", source: EXACT_INLINE_OPEN },
      { display: "inline", kind: "inline-html", source: EXACT_INLINE_CLOSE },
      { display: "inline", kind: "html-comment", source: EXACT_INLINE_COMMENT },
    ]);
    expect(snapshot.nodes.map(({ render }) => render)).toEqual([
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
    ]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(await getHtmlRendererCalls(labPage, id)).toEqual([]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-html",
      version: "0.0.1",
    });
    expect(await editor.locator('[data-mdw-html-kind="html-block"] [data-mdw-html-source]')
      .evaluate((element) => element.textContent)).toBe(EXACT_BLOCK);

    canonical.push(await getMarkdown(labPage, id));
    expect(canonical[canonical.length - 1]).toBe(EXACT_CANONICAL);
    expect(await resetEditor(labPage, id, EXACT_CANONICAL)).toBe(EXACT_CANONICAL);
    expect((await getHtmlSnapshot(labPage, id)).nodes.map(({ display, kind, source }) => ({
      display,
      kind,
      source,
    }))).toEqual(snapshot.nodes.map(({ display, kind, source }) => ({
      display,
      kind,
      source,
    })));
  }

  expect(canonical[1]).toBe(canonical[0]);

  const rejection = await labPage.evaluate(() => {
    try {
      window.__MARKORA_BROWSER_LAB__!.mount({
        entry: "minimal",
        extensionMode: "html",
        htmlRendererMode: "missing",
        id: "html-minimal-rejected",
        markdown: "<div>must not be claimed</div>",
      } as never);
      return null;
    } catch (error) {
      const candidate = error as Partial<{
        code: unknown;
        extension: unknown;
        message: unknown;
        name: unknown;
        phase: unknown;
      }>;
      return {
        code: candidate.code,
        extension: candidate.extension,
        message: candidate.message,
        name: candidate.name,
        phase: candidate.phase,
      };
    }
  });
  expect(rejection).toMatchObject({
    code: "EXTENSION_INCOMPATIBLE",
    extension: "markora-extension-html",
    phase: "resolve",
  });
  await expect(labPage.locator('[data-e2e-editor="html-minimal-rejected"]'))
    .toHaveCount(0);
  expect(await labPage.evaluate(() => (
    window.__MARKORA_BROWSER_LAB__!.mountedIds()
  ))).not.toContain("html-minimal-rejected");
});

test("@required sanitized HTML preview remains derived and clipboard output is source-only", async ({ labPage }) => {
  const id = "html-safe-preview";
  const source = [
    '<section data-value="safe">',
    "  <strong>authored source</strong>",
    "</section>",
  ].join("\n");
  const inlineLine = "After <span>inline</span> <!-- exact comment -->.";
  const markdown = `${source}\n\n${inlineLine}`;
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "sync",
    id,
    markdown,
    root: "shadow",
  });
  await waitForHtmlStatus(labPage, id, "rendered");

  expect(await getHtmlRendererCalls(labPage, id)).toEqual([{
    aborted: false,
    id: 1,
    kind: "html-block",
    settled: "resolved",
    source,
  }]);
  const snapshot = await getHtmlSnapshot(labPage, id);
  expect(snapshot.nodes.slice(1).map(({ display, kind, render }) => ({
    display,
    kind,
    render,
  }))).toEqual([
    {
      display: "inline",
      kind: "inline-html",
      render: { enabled: false, errorCode: null, status: "source" },
    },
    {
      display: "inline",
      kind: "inline-html",
      render: { enabled: false, errorCode: null, status: "source" },
    },
    {
      display: "inline",
      kind: "html-comment",
      render: { enabled: false, errorCode: null, status: "source" },
    },
  ]);
  const editor = editorLocator(labPage, id);
  const preview = editor.locator(
    '[data-mdw-html-kind="html-block"] [data-mdw-html-preview]',
  );
  await expect(preview.locator("article"))
    .toHaveText(`Rendered html-block HTML 1: ${source}`);
  expect(await preview.locator("article").evaluate((element) => (
    Array.from(element.attributes, ({ name, value }) => ({ name, value }))
  ))).toEqual([]);
  await expect(preview).toHaveAttribute("aria-hidden", "true");
  await expect(preview).toHaveAttribute("inert", "");
  await expect(editor.locator(".browser-lab-html-rendered")).toHaveCount(0);
  expect(await editor.locator(
    '[data-mdw-html-kind="html-block"] [data-mdw-html-source]',
  )
    .evaluate((element) => element.textContent)).toBe(source);
  expect(await getMarkdown(labPage, id)).toBe(markdown);

  const target = snapshot.nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe(source);
  expect(copied.plain).toBe(source);
  expect(copied.html).toContain('data-mdw-html-kind="html-block"');
  expect(copied.html).toContain("&lt;section");
  expect(copied.html).not.toContain("Rendered html-block HTML");
  expect(copied.html).not.toContain("browser-lab-html-rendered");
  expect(copied.html).not.toContain("data-mdw-html-preview");
  expect(copied.html).not.toContain("<button");
  expect(copied.html).not.toContain("<strong>authored source</strong>");
});

test("@required hostile authored and renderer HTML is clamped without DOM execution, navigation, or network", async ({ labPage }) => {
  const hostileSource = [
    "<div>",
    "<script>window.__markoraAuthoredHtml = true</script>",
    '<img src="https://markora-html.invalid/probe.png" onerror="window.__markoraAuthoredHtml = true">',
    '<iframe src="https://markora-html.invalid/frame"></iframe>',
    '<svg onload="window.__markoraAuthoredHtml = true"><a xlink:href="https://markora-html.invalid/svg">x</a></svg>',
    '<form action="https://markora-html.invalid/submit"><input autofocus></form>',
    "</div>",
  ].join("\n");
  const observedRequests: string[] = [];
  const recordRequest = (request: Request) => {
    if (request.url().includes("markora-html.invalid")) {
      observedRequests.push(request.url());
    }
  };
  const initialUrl = labPage.url();
  labPage.on("request", recordRequest);

  try {
    for (const [mode, errorCode, extensionCode] of [
      ["unsafe", "unsafe-output", "EXTENSION_HTML_UNSAFE_RENDERER_OUTPUT"],
      ["wrong-document", "wrong-document", "EXTENSION_HTML_INVALID_RENDERER_OUTPUT"],
      ["connected", "connected-output", "EXTENSION_HTML_INVALID_RENDERER_OUTPUT"],
      ["throw", "renderer-failed", "EXTENSION_HTML_RENDERER_FAILED"],
      ["reject", "renderer-failed", "EXTENSION_HTML_RENDERER_FAILED"],
      ["string", "invalid-output", "EXTENSION_HTML_INVALID_RENDERER_OUTPUT"],
      ["missing", "renderer-missing", "EXTENSION_HTML_RENDERER_MISSING"],
    ] as const) {
      const id = `html-clamp-${mode}`;
      const source = mode === "unsafe" ? hostileSource : `<div>${mode}</div>`;
      await mountEditor(labPage, {
        extensionMode: "html",
        htmlRendererMode: mode,
        id,
        markdown: source,
      });
      await editorLocator(labPage, id).locator('[data-mdw-html-kind="html-block"]')
        .scrollIntoViewIfNeeded();
      if (mode === "missing") {
        const target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
        expect(await runHtmlCommand(labPage, id, {
          target,
          type: "togglePreview",
        })).toBe(true);
      }
      await waitForHtmlStatus(labPage, id, "error");

      expect((await getHtmlSnapshot(labPage, id)).nodes[0]?.render).toEqual({
        enabled: true,
        errorCode,
        status: "error",
      });
      const editor = editorLocator(labPage, id);
      expect(await editor.locator("[data-mdw-html-source]")
        .evaluate((element) => element.textContent)).toBe(source);
      await expect(editor.locator("[data-mdw-html-preview]")).toBeEmpty();
      await expect(editor.locator(
        "script, img, iframe, object, embed, svg, form, input, [onclick], [href], [src], [action]",
      )).toHaveCount(0);
      expect(await getMarkdown(labPage, id)).toBe(source);
      expect((await getEditorEvents(labPage, id)).log).toContainEqual(
        expect.objectContaining({
          code: extensionCode,
          extension: "markora-extension-html",
          type: "error",
        }),
      );
    }
  } finally {
    labPage.off("request", recordRequest);
  }

  expect(observedRequests).toEqual([]);
  expect(labPage.url()).toBe(initialUrl);
  expect(await labPage.evaluate(() => ({
    authored: (window as typeof window & {
      __markoraAuthoredHtml?: boolean;
    }).__markoraAuthoredHtml,
    renderer: (window as typeof window & {
      __markoraUnsafeHtmlRenderer?: boolean;
    }).__markoraUnsafeHtmlRenderer,
  }))).toEqual({ authored: undefined, renderer: undefined });
  await expect(labPage.locator("[data-e2e-html-renderer-artifact]"))
    .toHaveCount(0);
});

test("@required stale deferred HTML renders cannot commit after update, removal, or destruction", async ({ labPage }) => {
  const id = "html-render-lifecycle";
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "deferred",
    id,
    markdown: "<div>x</div>",
  });
  await waitForHtmlCalls(labPage, id, 1);
  const x = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    source: "<section>y</section>",
    target: x,
    type: "update",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 2);
  expect((await getHtmlRendererCalls(labPage, id))[0]?.aborted).toBe(true);

  expect(await settleHtmlRenderer(labPage, id, { callId: 1 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);
  expect((await getHtmlSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("rendering");

  expect(await settleHtmlRenderer(labPage, id, { callId: 2 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "rendered");
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveText("Rendered html-block HTML 2: <section>y</section>");

  const y = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    source: "<aside>z</aside>",
    target: y,
    type: "update",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 3);
  const z = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    target: z,
    type: "remove",
  })).toBe(true);
  expect((await getHtmlRendererCalls(labPage, id))[2]?.aborted).toBe(true);
  expect(await settleHtmlRenderer(labPage, id, { callId: 3 })).toBe(true);
  await settleEditor(labPage, id);
  expect((await getHtmlSnapshot(labPage, id)).nodes).toEqual([]);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html]"))
    .toHaveCount(0);

  const destroyId = "html-render-destroy";
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "deferred",
    id: destroyId,
    markdown: "<main>destroyed</main>",
  });
  await waitForHtmlCalls(labPage, destroyId, 1);
  expect(await destroyEditorOnly(labPage, destroyId)).toBe(true);
  expect((await getHtmlRendererCalls(labPage, destroyId))[0]?.aborted).toBe(true);
  expect(await settleHtmlRenderer(labPage, destroyId, { callId: 1 })).toBe(true);
  await labPage.evaluate(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(editorLocator(labPage, destroyId).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);
});

test("@required a failed HTML preview retries in a fresh render generation", async ({ labPage }) => {
  const id = "html-render-retry";
  const source = "<div>retry source</div>";
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "deferred",
    id,
    markdown: source,
  });
  await waitForHtmlCalls(labPage, id, 1);

  expect(await settleHtmlRenderer(labPage, id, {
    callId: 1,
    outcome: "reject",
  })).toBe(true);
  await waitForHtmlStatus(labPage, id, "error");
  const preview = editorLocator(labPage, id).locator("[data-mdw-html-preview]");
  await expect(preview.locator("article")).toHaveCount(0);
  const failed = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(failed.render).toEqual({
    enabled: true,
    errorCode: "renderer-failed",
    status: "error",
  });

  expect(await runHtmlCommand(labPage, id, {
    target: failed,
    type: "retryPreview",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 2);
  expect(await getHtmlRendererCalls(labPage, id)).toEqual([
    {
      aborted: true,
      id: 1,
      kind: "html-block",
      settled: "rejected",
      source,
    },
    {
      aborted: false,
      id: 2,
      kind: "html-block",
      settled: "pending",
      source,
    },
  ]);
  await expect(preview.locator("article")).toHaveCount(0);

  expect(await settleHtmlRenderer(labPage, id, { callId: 2 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "rendered");
  await expect(preview.locator("article"))
    .toHaveText(`Rendered html-block HTML 2: ${source}`);
  expect(await getHtmlRendererCalls(labPage, id)).toEqual([
    {
      aborted: true,
      id: 1,
      kind: "html-block",
      settled: "rejected",
      source,
    },
    {
      aborted: false,
      id: 2,
      kind: "html-block",
      settled: "resolved",
      source,
    },
  ]);
  expect(await getMarkdown(labPage, id)).toBe(source);
});

test("@required HTML render generations reset, reconcile, toggle, and defer across composition", async ({ labPage }) => {
  const id = "html-render-boundaries";
  const source = "<div>same reset</div>";
  const markdown = `${source}\n\nAfter.`;
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "deferred",
    id,
    markdown,
  });
  await waitForHtmlCalls(labPage, id, 1);
  const beforeReset = (await getHtmlSnapshot(labPage, id)).nodes[0]!;

  expect(await resetEditor(labPage, id, markdown)).toBe(markdown);
  await waitForHtmlCalls(labPage, id, 2);
  const afterReset = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(afterReset.identity).not.toBe(beforeReset.identity);
  expect((await getHtmlRendererCalls(labPage, id))[0]?.aborted).toBe(true);
  expect(await runHtmlCommand(labPage, id, {
    target: beforeReset,
    type: "togglePreview",
  })).toBe(false);
  expect(await settleHtmlRenderer(labPage, id, { callId: 1 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);
  expect(await settleHtmlRenderer(labPage, id, { callId: 2 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "rendered");

  expect(await runHtmlCommand(labPage, id, {
    source: "<section>pending reconcile</section>",
    target: afterReset,
    type: "update",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 3);
  expect(await reconcileEditor(labPage, id, "<main>reconciled</main>\n\nAfter."))
    .toMatchObject({ changed: true });
  await waitForHtmlCalls(labPage, id, 4);
  expect((await getHtmlRendererCalls(labPage, id))[2]?.aborted).toBe(true);
  expect(await settleHtmlRenderer(labPage, id, { callId: 3 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);
  expect(await settleHtmlRenderer(labPage, id, { callId: 4 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "rendered");

  let target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    source: "<aside>toggle boundary</aside>",
    target,
    type: "update",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 5);
  target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "togglePreview",
  })).toBe(true);
  expect((await getHtmlRendererCalls(labPage, id))[4]?.aborted).toBe(true);
  expect(await settleHtmlRenderer(labPage, id, { callId: 5 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);

  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "togglePreview",
  })).toBe(true);
  await waitForHtmlCalls(labPage, id, 6);
  await focusEditor(labPage, id, "end");
  await editorLocator(labPage, id).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "編",
    }));
  });
  expect(await getPendingHtmlEdit(labPage, id)).toBeNull();
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await getPendingHtmlEdit(labPage, id)).toBeNull();
  expect(await selectHtml(labPage, id, target)).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    source: "<section>must not update during composition</section>",
    target,
    type: "update",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "remove",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "togglePreview",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "retryPreview",
  })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("<aside>toggle boundary</aside>\n\nAfter.");
  expect(await getHtmlRendererCalls(labPage, id)).toHaveLength(6);
  expect(await settleHtmlRenderer(labPage, id, { callId: 6 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "queued");
  expect((await getHtmlRendererCalls(labPage, id))[5]?.aborted).toBe(true);
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveCount(0);
  await editorLocator(labPage, id).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "編",
    }));
  });
  await waitForHtmlCalls(labPage, id, 7);
  expect(await settleHtmlRenderer(labPage, id, { callId: 7 })).toBe(true);
  await waitForHtmlStatus(labPage, id, "rendered");
  await expect(editorLocator(labPage, id).locator("[data-mdw-html-preview] article"))
    .toHaveText("Rendered html-block HTML 7: <aside>toggle boundary</aside>");
});

test("@required HTML commands and host edits are stale-safe, undoable, and read-only guarded", async ({ labPage }) => {
  const id = "html-commands-edits";
  const firstSource = "<div>First</div>";
  const secondSource = "<section>Second</section>";
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "missing",
    id,
    markdown: firstSource,
  });

  const first = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await runHtmlCommand(labPage, id, {
    source: firstSource,
    target: first,
    type: "update",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    source: secondSource,
    target: first,
    type: "update",
  })).toBe(true);
  expect(await runHtmlCommand(labPage, id, {
    source: "<aside>stale</aside>",
    target: first,
    type: "update",
  })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(secondSource);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(firstSource);
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(secondSource);

  let target: LabHtmlNodeTarget = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  let editButton = editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  });
  await editButton.click();
  expect(await getPendingHtmlEdit(labPage, id)).toEqual({
    display: "block",
    identity: target.identity,
    kind: "html-block",
    position: target.position,
    render: { enabled: false, errorCode: null, status: "source" },
    source: secondSource,
  });
  expect(await updatePendingHtmlEdit(labPage, id, "<article>Third</article>"))
    .toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("<article>Third</article>");

  target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  editButton = editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  });
  await editButton.click();
  expect(await reconcileEditor(labPage, id, "<main>External</main>"))
    .toMatchObject({ changed: true });
  expect(await updatePendingHtmlEdit(labPage, id, "<aside>stale edit</aside>"))
    .toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("<main>External</main>");

  const errorsBeforeStaleInvalid = (await getEditorEvents(labPage, id)).counts.error;
  expect(await runHtmlCommand(labPage, id, {
    source: "ordinary text",
    target,
    type: "update",
  })).toBe(false);
  expect((await getEditorEvents(labPage, id)).counts.error)
    .toBe(errorsBeforeStaleInvalid);

  target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  }).click();
  await updateEditorOptions(labPage, id, { editable: false });
  await expect(editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  })).toBeDisabled();
  await expect(editorLocator(labPage, id).getByRole("button", {
    name: "Show HTML preview",
  })).toBeDisabled();
  expect(await removePendingHtmlEdit(labPage, id)).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    source: "<aside>Read only</aside>",
    target,
    type: "update",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "remove",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "togglePreview",
  })).toBe(false);
  expect(await runHtmlCommand(labPage, id, {
    target,
    type: "retryPreview",
  })).toBe(false);
  const errorsBeforeReadonlyInvalid = (await getEditorEvents(labPage, id)).counts.error;
  expect(await runHtmlCommand(labPage, id, {
    source: "ordinary text",
    target,
    type: "update",
  })).toBe(false);
  expect((await getEditorEvents(labPage, id)).counts.error)
    .toBe(errorsBeforeReadonlyInvalid);
  expect(await getMarkdown(labPage, id)).toBe("<main>External</main>");

  await updateEditorOptions(labPage, id, { editable: true });
  expect(await removePendingHtmlEdit(labPage, id)).toBe(true);
  expect((await getHtmlSnapshot(labPage, id)).nodes).toEqual([]);
  await focusEditor(labPage, id, "end");
  expect(await runEditorCommand(labPage, id, {
    text: "<section>pasted HTML</section>",
    type: "pasteMarkdown",
  })).toBe(true);
  expect((await getHtmlSnapshot(labPage, id)).nodes[0]).toMatchObject({
    display: "block",
    kind: "html-block",
    source: "<section>pasted HTML</section>",
  });
});

test("@required localized RTL HTML actions are keyboard operable, reflow-safe, and accessible", async ({ labPage }) => {
  const id = "html-rtl-localized";
  const source = "<div>مرحبا</div>";
  await mountEditor(labPage, {
    direction: "rtl",
    extensionMode: "html",
    htmlMessages: {
      blockKindLabel: "كتلة HTML",
      editSource: "تحرير مصدر HTML",
      previewLabel: "معاينة HTML منقاة",
      previewLoading: "جارٍ إنشاء معاينة HTML",
      retryPreview: "إعادة محاولة المعاينة",
      showPreview: "إظهار معاينة HTML",
      showSource: "إظهار مصدر HTML",
      sourceLabel: "مصدر كتلة HTML",
    },
    htmlRendererMode: "sync",
    id,
    language: "ar",
    markdown: source,
    root: "shadow",
  });
  await waitForHtmlStatus(labPage, id, "rendered");
  const target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);

  const editor = editorLocator(labPage, id);
  const marker = editor.locator('[data-mdw-html-kind="html-block"]');
  await expect(editor.getByRole("group", { name: "كتلة HTML" })).toBeVisible();
  await expect(marker.locator(".mdw-html__kind")).toHaveText("كتلة HTML");
  expect(await marker.evaluate((element) => getComputedStyle(element).direction))
    .toBe("rtl");
  const labelledBy = (await marker.getAttribute("aria-labelledby"))?.split(" ") ?? [];
  expect(labelledBy).toHaveLength(3);
  expect(await marker.evaluate((element, ids) => ids.map((id) => (
    element.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.textContent
  )), labelledBy)).toEqual(["كتلة HTML", "مصدر كتلة HTML", source]);
  expect(await marker.ariaSnapshot()).toContain(source);
  await expect(marker.locator("[data-mdw-html-preview]"))
    .toHaveAttribute("aria-label", "معاينة HTML منقاة");

  const edit = marker.getByRole("button", { name: "تحرير مصدر HTML" });
  await edit.focus();
  await labPage.keyboard.press("Enter");
  expect((await getPendingHtmlEdit(labPage, id))?.source).toBe(source);

  const toggle = marker.getByRole("button", { name: "إظهار مصدر HTML" });
  await toggle.focus();
  await labPage.keyboard.press("Space");
  expect((await getHtmlSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("source");
  await expect(marker.getByRole("button", { name: "إظهار معاينة HTML" }))
    .toBeFocused();
  await labPage.keyboard.press("Enter");
  await waitForHtmlStatus(labPage, id, "rendered");

  const reflow = await marker.evaluate((element) => {
    const html = element as HTMLElement;
    html.style.fontSize = "200%";
    html.style.inlineSize = "220px";
    const actions = html.querySelector<HTMLElement>(".mdw-html__actions")!;
    return {
      actionsClientWidth: actions.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      markerClientWidth: html.clientWidth,
      markerScrollWidth: html.scrollWidth,
    };
  });
  expect(reflow.actionsScrollWidth).toBeLessThanOrEqual(reflow.actionsClientWidth);
  expect(reflow.markerScrollWidth).toBeLessThanOrEqual(reflow.markerClientWidth);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required inline HTML inside links has no nested controls or selection navigation", async ({ labPage }) => {
  const id = "html-inline-link";
  const initialUrl = labPage.url();
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "sync",
    id,
    markdown: "[<em>linked HTML</em>](#must-not-navigate)",
  });
  const editor = editorLocator(labPage, id);
  const link = editor.locator('a[href="#must-not-navigate"]');
  await expect(link.locator('[data-mdw-html-display="inline"]')).toHaveCount(2);
  await expect(link.locator("button")).toHaveCount(0);
  expect(await getHtmlRendererCalls(labPage, id)).toEqual([]);

  const target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  await expect(link.locator("button")).toHaveCount(0);
  expect(labPage.url()).toBe(initialUrl);
  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required Chromium CDP invokes HTML editing and copies source-only Markdown", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP input commands.");

  const id = "html-cdp";
  const initialSource = "<div>CDP</div>";
  const editedSource = "<section>CDP edited</section>";
  await mountEditor(labPage, {
    extensionMode: "html",
    htmlRendererMode: "sync",
    id,
    markdown: `${initialSource}\n\nAfter.`,
  });
  await waitForHtmlStatus(labPage, id, "rendered");
  let target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
  expect(await selectHtml(labPage, id, target)).toBe(true);
  const edit = editorLocator(labPage, id).getByRole("button", {
    name: "Edit HTML source",
  });
  const box = await edit.boundingBox();
  expect(box).not.toBeNull();

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    });
    expect((await getPendingHtmlEdit(labPage, id))?.source).toBe(initialSource);
    expect(await updatePendingHtmlEdit(labPage, id, editedSource)).toBe(true);
    await waitForHtmlCalls(labPage, id, 2);
    await waitForHtmlStatus(labPage, id, "rendered");

    await focusEditor(labPage, id, "end");
    target = (await getHtmlSnapshot(labPage, id)).nodes[0]!;
    expect(await selectHtml(labPage, id, target)).toBe(true);
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
      const targetWindow = window as typeof window & {
        __markoraHtmlCdpCopy?: { html: string; markdown: string; plain: string };
      };
      delete targetWindow.__markoraHtmlCdpCopy;
      section.addEventListener("copy", (rawEvent) => {
        const transfer = (rawEvent as ClipboardEvent).clipboardData;
        targetWindow.__markoraHtmlCdpCopy = {
          html: transfer?.getData("text/html") ?? "",
          markdown: transfer?.getData("text/markdown") ?? "",
          plain: transfer?.getData("text/plain") ?? "",
        };
      }, { once: true });
    }, id);
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      commands: ["Copy"],
      key: "c",
      modifiers: 2,
      type: "keyDown",
      windowsVirtualKeyCode: 67,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      key: "c",
      modifiers: 2,
      type: "keyUp",
      windowsVirtualKeyCode: 67,
    });
  } finally {
    await cdp.detach();
  }

  const copied = await labPage.evaluate(() => (
    window as typeof window & {
      __markoraHtmlCdpCopy?: { html: string; markdown: string; plain: string };
    }
  ).__markoraHtmlCdpCopy);
  expect(copied).toMatchObject({ markdown: editedSource, plain: editedSource });
  expect(copied?.html).toContain('data-mdw-html-kind="html-block"');
  expect(copied?.html).toContain("&lt;section&gt;CDP edited&lt;/section&gt;");
  expect(copied?.html).not.toContain("Rendered html-block HTML");
  expect(copied?.html).not.toContain("data-mdw-html-preview");
  expect(copied?.html).not.toContain("<button");
});
