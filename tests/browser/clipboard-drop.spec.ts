import type { CDPSession, Page } from "@playwright/test";
import {
  dispatchTransfer,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  resetEditor,
  runEditorCommand,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

type DropItem = { data: string; mimeType: string };
type Point = { x: number; y: number };

async function reloadWithoutIntersectionObserver(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  });
  await page.reload();
  await expect(page.locator("[data-e2e-browser-lab]")).toHaveAttribute("data-ready", "true");
}

async function dispatchExternalDrop(
  cdp: CDPSession,
  point: Point,
  items: DropItem[],
  files: string[] = [],
) {
  const data = { dragOperationsMask: 1, files, items };
  for (const type of ["dragEnter", "dragOver", "drop"] as const) {
    await cdp.send("Input.dispatchDragEvent", {
      data,
      type,
      x: point.x,
      y: point.y,
    });
  }
}

type NativeFileTransferCapture = {
  defaultPrevented: boolean;
  dropEffect?: string;
  files: Array<{ name: string; size: number; type: string }>;
  isTrusted: boolean;
  types: string[];
};

async function armNativeFileTransferCapture(
  page: Page,
  id: string,
  eventName: "dragover" | "drop",
) {
  await page.evaluate(({ editorId, eventName: browserEventName }) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    (window as typeof window & { __markoraNativeFileTransfer?: unknown }).__markoraNativeFileTransfer = undefined;
    section.addEventListener(browserEventName, (rawEvent) => {
      const event = rawEvent as DragEvent;
      const transfer = event.dataTransfer;
      (window as typeof window & { __markoraNativeFileTransfer?: unknown }).__markoraNativeFileTransfer = {
        defaultPrevented: event.defaultPrevented,
        dropEffect: transfer?.dropEffect,
        files: Array.from(transfer?.files ?? [], (file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
        isTrusted: event.isTrusted,
        types: Array.from(transfer?.types ?? []),
      };
    }, { once: true });
  }, { editorId: id, eventName });
}

async function readNativeFileTransferCapture(page: Page) {
  return page.evaluate(() => (
    window as typeof window & { __markoraNativeFileTransfer?: NativeFileTransferCapture }
  ).__markoraNativeFileTransfer);
}

async function textPoint(page: Page, id: string, needle: string, selector?: string) {
  const target = selector
    ? editorLocator(page, id).locator(selector)
    : editorLocator(page, id);
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((element, value) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const index = text.data.indexOf(value);
      if (index < 0) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    }
    throw new Error(`Missing ${JSON.stringify(value)} drop target.`);
  }, needle);
}

async function focusParagraphEnd(page: Page, id: string) {
  const paragraph = editorLocator(page, id).locator("p").last();
  await paragraph.click();
  await page.keyboard.press("End");
}

test("@required file-bearing paste and drop are safely rejected everywhere", async ({ labPage }) => {
  const id = "file-transfer";
  const markdown = [
    "before",
    "",
    "```text",
    "code stays",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown });
  const file = {
    contents: "must never enter the document",
    name: "local-secret.txt",
    type: "text/plain",
  };
  await editorLocator(labPage, id).locator(".cm-content").click();

  for (const target of ["prosemirror", "code-mirror"] as const) {
    for (const event of ["paste", "dragover", "drop"] as const) {
      const result = await dispatchTransfer(labPage, id, {
        event,
        files: [file],
        html: "<strong>mixed rich text must also be rejected</strong>",
        markdown: "**mixed Markdown must also be rejected**",
        plain: "mixed text must also be rejected",
        target,
      });
      expect(result.defaultPrevented).toBe(true);
      expect(result.fileCount).toBe(1);
      expect(result.types).toContain("Files");
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(markdown);
    }
  }
});

test("rich HTML wins over plain fallback and unsafe URLs are removed", async ({ labPage }) => {
  const id = "rich-paste";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: [
      '<p><strong>Rich</strong> <a href="javascript:alert(1)">unsafe</a></p>',
      "<ul><li>One</li><li>Two</li></ul>",
    ].join(""),
    plain: "plain fallback",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  expect(await getMarkdown(labPage, id)).toBe([
    "**Rich** unsafe",
    "",
    "* One",
    "",
    "* Two",
  ].join("\n"));
  await expect(editorLocator(labPage, id).locator("strong")).toHaveText("Rich");
  await expect(editorLocator(labPage, id).locator("a")).toHaveCount(0);

  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }), id))
    .toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");
});

test("rich HTML table headers keep scope and mixed rows receive body cells", async ({ labPage }) => {
  const id = "rich-table-scope";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: [
      "<table><thead>",
      '<tr><th scope="col">Name</th><th scope="col">Status</th></tr>',
      "</thead><tbody>",
      '<tr><th scope="row">Alpha</th><td>Ready</td></tr>',
      "</tbody></table>",
    ].join(""),
    plain: "Name Status Alpha Ready",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  const rows = editor.locator("table tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("th")).toHaveCount(2);
  expect(await rows.first().locator("th").evaluateAll((headers) =>
    headers.map((header) => header.getAttribute("scope")))).toEqual(["col", "col"]);
  await expect(rows.nth(1).locator('th[scope="row"]')).toHaveText("Alpha");
  await expect(rows.nth(1).locator("td")).toHaveCount(1);

  await rows.nth(1).locator("td p").click();
  const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Insert column after" }).click();
  await settleEditor(labPage, id);

  await expect(rows.first().locator("th")).toHaveCount(3);
  expect(await rows.first().locator("th").evaluateAll((headers) =>
    headers.map((header) => header.getAttribute("scope")))).toEqual(["col", "col", "col"]);
  await expect(rows.nth(1).locator('th[scope="row"]')).toHaveCount(1);
  await expect(rows.nth(1).locator("td")).toHaveCount(2);
  expect(await getMarkdown(labPage, id)).toBe([
    "| Name | Status |  |",
    "| --- | --- | --- |",
    "| Alpha | Ready |  |",
  ].join("\n"));
});

test("Markdown MIME pastes semantically while plain Markdown-looking text remains literal", async ({ labPage }) => {
  const id = "plain-paste";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const markdownLookingText = "# Literal heading\n\n**literal strong**";
  const markdownResult = await dispatchTransfer(labPage, id, {
    event: "paste",
    markdown: markdownLookingText,
    plain: markdownLookingText,
  });
  expect(markdownResult.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("# Literal heading\n\n**literal strong**");
  await expect(editorLocator(labPage, id).locator("h1, strong")).toHaveCount(2);

  await resetEditor(labPage, id, "");
  await focusParagraphEnd(labPage, id);
  const plainResult = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: "<b>literal tag</b>\n\n\nsecond block",
  });
  expect(plainResult.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  const escapedPlainMarkdown = "\\<b>literal tag\\</b>\n\nsecond block";
  expect(await getMarkdown(labPage, id)).toBe(escapedPlainMarkdown);
  const editor = editorLocator(labPage, id);
  expect(await editor.locator("p").allTextContents()).toEqual(["<b>literal tag</b>", "second block"]);
  await expect(editor.locator("strong")).toHaveCount(0);

  await resetEditor(labPage, id, escapedPlainMarkdown);
  await settleEditor(labPage, id);
  expect(await editor.locator("p").allTextContents()).toEqual(["<b>literal tag</b>", "second block"]);
  await expect(editor.locator("strong")).toHaveCount(0);
});

test("external rich and plain drops insert undoable content", async ({ labPage }) => {
  const id = "external-drop";
  await mountEditor(labPage, { id, markdown: "" });
  await focusParagraphEnd(labPage, id);

  const richDrop = await dispatchTransfer(labPage, id, {
    event: "drop",
    html: "<p><em>Dropped rich</em></p>",
    plain: "plain fallback",
  });
  expect(richDrop.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("*Dropped rich*");

  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }), id))
    .toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");

  const plainDrop = await dispatchTransfer(labPage, id, {
    event: "drop",
    plain: "Dropped plain",
  });
  expect(plainDrop.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("Dropped plain");
});

test("@required Chromium CDP external drops honor exact outer and active-code coordinates", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP drag commands.");
  const cdp = await context.newCDPSession(labPage);

  const outerId = "native-drop-outer";
  await mountEditor(labPage, { id: outerId, markdown: "alpha omega", root: "shadow" });
  await labPage.evaluate((id) => {
    const section = document.querySelector(`[data-e2e-editor="${id}"]`)!;
    (window as typeof window & { __markoraNativeDrop?: unknown }).__markoraNativeDrop = undefined;
    section.addEventListener("drop", (rawEvent) => {
      const event = rawEvent as DragEvent;
      (window as typeof window & { __markoraNativeDrop?: unknown }).__markoraNativeDrop = {
        isTrusted: event.isTrusted,
        types: Array.from(event.dataTransfer?.types ?? []),
      };
    }, { once: true });
  }, outerId);
  await dispatchExternalDrop(cdp, await textPoint(labPage, outerId, "omega"), [
    { data: "<strong>DROP</strong> ", mimeType: "text/html" },
    { data: "plain fallback", mimeType: "text/plain" },
  ]);
  await settleEditor(labPage, outerId);
  const captured = await labPage.evaluate(() => (
    window as typeof window & { __markoraNativeDrop?: unknown }
  ).__markoraNativeDrop) as { isTrusted: boolean; types: string[] };
  expect(captured.isTrusted).toBe(true);
  expect(new Set(captured.types)).toEqual(new Set(["text/html", "text/plain"]));
  const serializedOuter = await getMarkdown(labPage, outerId);
  expect(serializedOuter).toBe("alpha **DROP**omega");
  await expect(editorLocator(labPage, outerId).locator("strong")).toHaveText("DROP");
  const roundTripId = "native-drop-outer-roundtrip";
  await mountEditor(labPage, { id: roundTripId, markdown: serializedOuter, root: "shadow" });
  await expect(editorLocator(labPage, roundTripId).locator("strong")).toHaveText("DROP");
  const outerSelection = (await snapshotEditor(labPage, outerId)).selection;
  expect(outerSelection.to - outerSelection.from).toBe("DROP".length);
  expect(await runEditorCommand(labPage, outerId, { type: "undo" })).toBe(true);
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("alpha omega");
  expect(await runEditorCommand(labPage, outerId, { type: "redo" })).toBe(true);
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("alpha **DROP**omega");

  const activeId = "native-drop-active-code";
  const originalCode = "```text\nalpha omega\n```";
  await mountEditor(labPage, { id: activeId, markdown: originalCode, root: "shadow" });
  await editorLocator(labPage, activeId).locator(".cm-content").click();
  await settleEditor(labPage, activeId);
  await dispatchExternalDrop(
    cdp,
    await textPoint(labPage, activeId, "omega", ".cm-content"),
    [
      { data: "<strong>WRONG</strong>", mimeType: "text/html" },
      { data: "DROP ", mimeType: "text/plain" },
    ],
  );
  await settleEditor(labPage, activeId);
  expect(await getMarkdown(labPage, activeId)).toBe("```text\nalpha DROP omega\n```");
  expect((await snapshotEditor(labPage, activeId)).codeBlocks.active).toBe(1);
  expect(await runEditorCommand(labPage, activeId, { type: "undo" })).toBe(true);
  await settleEditor(labPage, activeId);
  expect(await getMarkdown(labPage, activeId)).toBe(originalCode);
  await cdp.detach();
});

test("@required Chromium CDP external drop enters exact passive-code coordinates", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP drag commands.");
  await reloadWithoutIntersectionObserver(labPage);
  const id = "native-drop-passive-code";
  const original = "```text\nalpha omega\n```";
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const initial = await snapshotEditor(labPage, id);
  expect(initial.codeBlocks.active).toBe(0);
  expect(initial.codeBlocks.staticViews).toBe(1);
  const passiveCode = editorLocator(labPage, id).locator(".mdw-code-block-static-code");
  await expect(passiveCode).toBeVisible();
  const point = await textPoint(labPage, id, "omega", ".mdw-code-block-static-code");
  expect(await passiveCode.evaluate((element, target) => {
    const root = element.getRootNode();
    const hit = root instanceof ShadowRoot
      ? root.elementFromPoint(target.x, target.y)
      : element.ownerDocument.elementFromPoint(target.x, target.y);
    return Boolean(hit && element.closest(".mdw-code-block-static")?.contains(hit));
  }, point)).toBe(true);

  const cdp = await context.newCDPSession(labPage);
  await dispatchExternalDrop(cdp, point, [
    { data: "DROP ", mimeType: "text/plain" },
  ]);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("```text\nalpha DROP omega\n```");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await cdp.detach();
});

test("@required Chromium CDP trusted file drop uses the host uploader at its outer coordinate", async ({
  browserName,
  context,
  labPage,
}, testInfo) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP drag commands.");
  const id = "native-file-upload";
  const original = "alpha omega";
  await mountEditor(labPage, {
    id,
    markdown: original,
    resourceMode: "immediate-upload",
    root: "shadow",
  });
  await armNativeFileTransferCapture(labPage, id, "drop");

  const cdp = await context.newCDPSession(labPage);
  await dispatchExternalDrop(
    cdp,
    await textPoint(labPage, id, "omega"),
    [
      { data: "<strong>mixed rich text must not enter</strong>", mimeType: "text/html" },
      { data: "mixed plain text must not enter", mimeType: "text/plain" },
    ],
    [`${testInfo.config.rootDir}/../../banner.png`],
  );
  await settleEditor(labPage, id);

  const captured = await readNativeFileTransferCapture(labPage);
  expect(captured).toMatchObject({
    defaultPrevented: true,
    dropEffect: "copy",
    files: [{ name: "banner.png", size: 8_550, type: "image/png" }],
    isTrusted: true,
  });
  expect(new Set(captured?.types)).toEqual(new Set(["Files", "text/html", "text/plain"]));
  expect(await getMarkdown(labPage, id)).toBe("alpha [banner.png](/uploads/banner.png)omega");
  expect((await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    id,
  )).uploads).toEqual([{ fileName: "banner.png", source: "drop" }]);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("alpha [banner.png](/uploads/banner.png)omega");
  expect((await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    id,
  )).uploads).toHaveLength(1);
  await cdp.detach();
});

test("@required Chromium CDP trusted file drops are rejected by outer and nested-code guards", async ({
  browserName,
  context,
  labPage,
}, testInfo) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP drag commands.");
  await reloadWithoutIntersectionObserver(labPage);
  const cdp = await context.newCDPSession(labPage);
  const file = `${testInfo.config.rootDir}/../../banner.png`;
  const mixedItems = [
    { data: "<strong>mixed rich text must not enter</strong>", mimeType: "text/html" },
    { data: "mixed plain text must not enter", mimeType: "text/plain" },
  ];

  const outerId = "native-file-reject-outer";
  const outerOriginal = "alpha omega";
  await mountEditor(labPage, { id: outerId, markdown: outerOriginal, root: "shadow" });
  await armNativeFileTransferCapture(labPage, outerId, "dragover");
  await dispatchExternalDrop(
    cdp,
    await textPoint(labPage, outerId, "omega"),
    mixedItems,
    [file],
  );
  await settleEditor(labPage, outerId);
  const outerCapture = await readNativeFileTransferCapture(labPage);
  expect(outerCapture).toMatchObject({
    defaultPrevented: true,
    dropEffect: "none",
    files: [],
    isTrusted: true,
  });
  expect(new Set(outerCapture?.types)).toEqual(new Set(["Files", "text/html", "text/plain"]));
  expect(await getMarkdown(labPage, outerId)).toBe(outerOriginal);

  const activeId = "native-file-reject-active-code";
  const activeOriginal = "```text\nalpha omega\n```";
  await mountEditor(labPage, {
    id: activeId,
    markdown: activeOriginal,
    resourceMode: "immediate-upload",
    root: "shadow",
  });
  const activeCode = editorLocator(labPage, activeId).locator(".mdw-code-block");
  await activeCode.locator(".mdw-code-block-static-code").click({ position: { x: 5, y: 5 } });
  await expect(activeCode).toHaveAttribute("data-mdw-code-block-state", "active");
  await expect(activeCode.locator(".cm-content")).toBeFocused();
  await settleEditor(labPage, activeId);
  await armNativeFileTransferCapture(labPage, activeId, "dragover");
  await dispatchExternalDrop(
    cdp,
    await textPoint(labPage, activeId, "omega", ".cm-content"),
    mixedItems,
    [file],
  );
  await settleEditor(labPage, activeId);
  const activeCapture = await readNativeFileTransferCapture(labPage);
  expect(activeCapture).toMatchObject({
    defaultPrevented: true,
    dropEffect: "none",
    files: [],
    isTrusted: true,
  });
  expect(new Set(activeCapture?.types)).toEqual(new Set(["Files", "text/html", "text/plain"]));
  expect(await getMarkdown(labPage, activeId)).toBe(activeOriginal);
  expect((await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    activeId,
  )).uploads).toEqual([]);

  const passiveId = "native-file-reject-passive-code";
  const passiveOriginal = "```text\nalpha omega\n```";
  await mountEditor(labPage, {
    id: passiveId,
    markdown: passiveOriginal,
    resourceMode: "immediate-upload",
    root: "shadow",
  });
  expect((await snapshotEditor(labPage, passiveId)).codeBlocks.active).toBe(0);
  await armNativeFileTransferCapture(labPage, passiveId, "dragover");
  await dispatchExternalDrop(
    cdp,
    await textPoint(labPage, passiveId, "omega", ".mdw-code-block-static-code"),
    mixedItems,
    [file],
  );
  await settleEditor(labPage, passiveId);
  const passiveCapture = await readNativeFileTransferCapture(labPage);
  expect(passiveCapture).toMatchObject({
    defaultPrevented: true,
    dropEffect: "none",
    files: [],
    isTrusted: true,
  });
  expect(new Set(passiveCapture?.types)).toEqual(new Set(["Files", "text/html", "text/plain"]));
  expect(await getMarkdown(labPage, passiveId)).toBe(passiveOriginal);
  expect((await snapshotEditor(labPage, passiveId)).codeBlocks.active).toBe(0);
  expect((await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    passiveId,
  )).uploads).toEqual([]);
  await cdp.detach();
});

test("CodeMirror accepts ordinary multiline text paste while rejecting files", async ({ labPage }) => {
  const id = "code-paste";
  await mountEditor(labPage, {
    id,
    markdown: ["```text", "before", "```"].join("\n"),
  });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await labPage.keyboard.press("End");

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: "<strong>ignored rich fallback</strong>",
    plain: "\nafter\nthird",
    target: "code-mirror",
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe([
    "```text",
    "before",
    "after",
    "third",
    "```",
  ].join("\n"));
});
