import type { CDPSession, Page } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

type PointerPoint = { x: number; y: number };
type NativeDragRecord = {
  ctrlKey: boolean;
  defaultPrevented: boolean;
  editorId: string;
  html: string;
  isTrusted: boolean;
  plain: string;
  type: string;
  types: string[];
};

const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function dragPointer(
  page: Page,
  cdp: CDPSession | null,
  start: PointerPoint,
  target: PointerPoint,
  options: { copy?: boolean } = {},
) {
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const modifiers = options.copy ? 2 : 0;
  const steps = Math.max(30, Math.min(120, Math.ceil(distance / 4)));

  if (cdp) {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      modifiers,
      type: "mouseMoved",
      x: start.x,
      y: start.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers,
      type: "mousePressed",
      x: start.x,
      y: start.y,
    });
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        modifiers,
        type: "mouseMoved",
        x: start.x + (target.x - start.x) * progress,
        y: start.y + (target.y - start.y) * progress,
      });
    }
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers,
      type: "mouseReleased",
      x: target.x,
      y: target.y,
    });
    return;
  }

  if (options.copy) {
    await page.keyboard.down("Control");
  }

  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps });
    await page.mouse.up();
  } finally {
    if (options.copy) {
      await page.keyboard.up("Control");
    }
  }
}

async function textPoint(
  page: Page,
  id: string,
  needle: string,
  offset: number,
  side: "after" | "before",
  selector?: string,
  surfaceIndex = 0,
) {
  const target = selector
    ? editorLocator(page, id).locator(selector).nth(surfaceIndex)
    : editorLocator(page, id);
  return target.evaluate((element, options) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const index = text.data.indexOf(options.needle);
      if (index < 0) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(text, index + options.offset);
      range.setEnd(text, index + options.offset + 1);
      const rect = range.getBoundingClientRect();
      return {
        x: options.side === "after" ? rect.right - 1 : rect.left + 1,
        y: rect.top + rect.height / 2,
      };
    }
    throw new Error(`Missing ${JSON.stringify(options.needle)} drag target.`);
  }, { needle, offset, side });
}

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

async function armNativeDragCapture(page: Page, id: string) {
  await page.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    (window as typeof window & { __markoraNativeDrag?: unknown }).__markoraNativeDrag = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"] as const) {
      section.addEventListener(type, (rawEvent) => {
        const event = rawEvent as DragEvent;
        (window as typeof window & { __markoraNativeDrag: NativeDragRecord[] }).__markoraNativeDrag.push({
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          editorId,
          html: event.dataTransfer?.getData("text/html") ?? "",
          isTrusted: event.isTrusted,
          plain: event.dataTransfer?.getData("text/plain") ?? "",
          type: event.type,
          types: Array.from(event.dataTransfer?.types ?? []),
        });
      });
    }
  }, id);
}

async function readNativeDragCapture(page: Page) {
  return page.evaluate(() => (
    window as typeof window & { __markoraNativeDrag?: NativeDragRecord[] }
  ).__markoraNativeDrag ?? []);
}

test("@required native select-all replacement respects the active editing surface", async ({
  browserName,
  context,
  labPage,
}) => {
  const markdown = [
    "Before **bold**.",
    "",
    "```js",
    "const x = 1;",
    "const y = 2;",
    "```",
    "",
    "| A | B |",
    "| --- | --- |",
    "| C | D |",
    "",
    "After.",
  ].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressControlKey = async (code: "KeyA" | "KeyY" | "KeyZ", key: "a" | "y" | "z") => {
    if (!cdp) {
      await labPage.keyboard.press(`ControlOrMeta+${key.toUpperCase()}`);
      return;
    }

    const keyCode = key.toUpperCase().charCodeAt(0);
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code,
        key,
        modifiers: 2,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };
  const insertText = async (text: string) => {
    if (cdp) {
      await cdp.send("Input.insertText", { text });
    } else {
      await labPage.keyboard.insertText(text);
    }
  };

  const outerId = "outer-native-select-all";
  await mountEditor(labPage, {
    id: outerId,
    markdown,
    root: "shadow",
  });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "bold", "end")
  ), outerId)).toBe(true);
  await settleEditor(labPage, outerId);

  await pressControlKey("KeyA", "a");
  await settleEditor(labPage, outerId);
  const all = (await snapshotEditor(labPage, outerId)).selection;
  expect(all.from).toBe(0);
  expect(all.to).toBeGreaterThan(0);
  expect(all.anchor).toBe(all.from);
  expect(all.head).toBe(all.to);

  await insertText("X");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("X");
  await pressControlKey("KeyZ", "z");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe(markdown);
  await pressControlKey("KeyY", "y");
  await settleEditor(labPage, outerId);
  expect(await getMarkdown(labPage, outerId)).toBe("X");

  const codeId = "code-native-select-all";
  await mountEditor(labPage, {
    id: codeId,
    markdown,
    root: "shadow",
  });
  await editorLocator(labPage, codeId).locator(".cm-content").click();
  await settleEditor(labPage, codeId);
  await pressControlKey("KeyA", "a");
  await insertText("X");
  await settleEditor(labPage, codeId);
  expect(await getMarkdown(labPage, codeId)).toBe(markdown.replace(
    "const x = 1;\nconst y = 2;",
    "X",
  ));
  const codeSnapshot = await snapshotEditor(labPage, codeId);
  expect(codeSnapshot.codeMirrorFocused).toBe(true);
  expect(codeSnapshot.prosemirrorFocused).toBe(false);
  await pressControlKey("KeyZ", "z");
  await settleEditor(labPage, codeId);
  expect(await getMarkdown(labPage, codeId)).toBe(markdown);

  await cdp?.detach();
});

test("@required native rich-inline drags move one undoable semantic slice", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  for (const testCase of [
    {
      expected: "alpha  gamma delta**beta**",
      id: "native-strong-text-drag",
      markdown: "alpha **beta** gamma delta",
    },
    {
      expected: "alpha  gamma delta[beta](/target)",
      id: "native-link-text-drag",
      markdown: "alpha [beta](/target) gamma delta",
    },
  ]) {
    await mountEditor(labPage, {
      id: testCase.id,
      markdown: testCase.markdown,
      root: "shadow",
    });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
    ), testCase.id)).toBe(true);
    await settleEditor(labPage, testCase.id);
    await dragPointer(
      labPage,
      cdp,
      await textPoint(labPage, testCase.id, "beta", 1, "before"),
      await textPoint(labPage, testCase.id, "delta", 4, "after"),
    );
    await settleEditor(labPage, testCase.id);

    expect(await getMarkdown(labPage, testCase.id)).toBe(testCase.expected);
    const moved = (await snapshotEditor(labPage, testCase.id)).selection;
    expect(moved.to - moved.from).toBe("beta".length);
    await labPage.keyboard.press("ControlOrMeta+Z");
    await settleEditor(labPage, testCase.id);
    expect(await getMarkdown(labPage, testCase.id)).toBe(testCase.markdown);
    await labPage.keyboard.press("ControlOrMeta+Shift+Z");
    await settleEditor(labPage, testCase.id);
    expect(await getMarkdown(labPage, testCase.id)).toBe(testCase.expected);
  }

  await cdp?.detach();
});

test("@required modified native rich-text drag copies one semantic slice", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-rich-copy-drag";
  const original = [
    "source **beta** end",
    "",
    "target Z",
  ].join("\n");
  const expected = [
    "source **beta** end",
    "",
    "target Z**beta**",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  await armNativeDragCapture(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "beta", 1, "before"),
    await textPoint(labPage, id, "target Z", 7, "after"),
    { copy: true },
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(dragstart[0]?.ctrlKey).toBe(true);
  expect(dragstart[0]?.plain).toBe("beta");
  expect(dragstart[0]?.html).toContain("<strong");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.prosemirrorFocused).toBe(true);
  expect(inserted.selection.to - inserted.selection.from).toBe("beta".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native cross-editor drag copies one semantic slice with isolated history", async ({
  browserName,
  context,
  labPage,
}) => {
  const sourceId = "native-cross-editor-source";
  const destinationId = "native-cross-editor-destination";
  const sourceMarkdown = "alpha **beta** omega";
  const destinationMarkdown = "left right";
  const expectedDestination = "left **beta**right";
  await mountEditor(labPage, {
    id: sourceId,
    markdown: sourceMarkdown,
    root: "shadow",
  });
  await mountEditor(labPage, {
    entry: "minimal",
    id: destinationId,
    markdown: destinationMarkdown,
    root: "document",
  });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), sourceId)).toBe(true);
  await settleEditor(labPage, sourceId);
  await armNativeDragCapture(labPage, sourceId);
  await armNativeDragCapture(labPage, destinationId);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, sourceId, "beta", 1, "before"),
    await textPoint(labPage, destinationId, "right", 0, "before"),
  );
  await settleEditor(labPage, sourceId);
  await settleEditor(labPage, destinationId);

  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);
  expect(await getMarkdown(labPage, destinationId)).toBe(expectedDestination);
  await expect(editorLocator(labPage, destinationId).locator("strong")).toHaveText("beta");
  const sourceSelection = (await snapshotEditor(labPage, sourceId)).selection;
  expect(sourceSelection.to - sourceSelection.from).toBe("beta".length);
  const destination = await snapshotEditor(labPage, destinationId);
  expect(destination.prosemirrorFocused).toBe(true);
  expect(destination.selection.to - destination.selection.from).toBe("beta".length);
  const dragEvents = await readNativeDragCapture(labPage);
  const dragstart = dragEvents.filter(({ editorId, type }) => (
    editorId === sourceId && type === "dragstart"
  ));
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
  expect(dragEvents.filter(({ editorId, type }) => (
    editorId === destinationId && type === "drop"
  ))).toHaveLength(1);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(destinationMarkdown);
  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(expectedDestination);
  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);

  await cdp?.detach();
});

test("@required native cross-editor drag copies one closed multi-block slice", async ({
  browserName,
  context,
  labPage,
}) => {
  const sourceId = "native-cross-editor-block-source";
  const destinationId = "native-cross-editor-block-destination";
  const sourceMarkdown = ["* one", "* two"].join("\n");
  const destinationMarkdown = "dest X";
  const expectedDestination = ["dest X", "", "* one", "* two"].join("\n");
  await mountEditor(labPage, {
    autofocus: true,
    entry: "minimal",
    id: sourceId,
    initialSelection: "all",
    markdown: sourceMarkdown,
    root: "document",
  });
  await mountEditor(labPage, {
    id: destinationId,
    markdown: destinationMarkdown,
    root: "shadow",
  });
  expect((await snapshotEditor(labPage, sourceId)).selection).toMatchObject({
    anchor: 0,
    from: 0,
    head: 16,
    to: 16,
  });
  await armNativeDragCapture(labPage, sourceId);
  await armNativeDragCapture(labPage, destinationId);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, sourceId, "one", 1, "before"),
    await textPoint(labPage, destinationId, "dest X", 5, "after"),
  );
  await settleEditor(labPage, sourceId);
  await settleEditor(labPage, destinationId);

  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);
  expect(await getMarkdown(labPage, destinationId)).toBe(expectedDestination);
  await expect(editorLocator(labPage, destinationId).locator("li")).toHaveCount(2);
  const destination = await snapshotEditor(labPage, destinationId);
  expect(destination.prosemirrorFocused).toBe(true);
  expect(destination.selection.to - destination.selection.from).toBe(16);
  const dragEvents = await readNativeDragCapture(labPage);
  const dragstart = dragEvents.filter(({ editorId, type }) => (
    editorId === sourceId && type === "dragstart"
  ));
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
  expect(dragEvents.filter(({ editorId, type }) => (
    editorId === destinationId && type === "drop"
  ))).toHaveLength(1);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(destinationMarkdown);
  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(expectedDestination);
  expect(await getMarkdown(labPage, sourceId)).toBe(sourceMarkdown);

  await cdp?.detach();
});

test("@required native rich-text drag copies literal text into active nested code", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-active-code-destination";
  const original = [
    "source **beta** end",
    "",
    "```text",
    "code omega",
    "```",
  ].join("\n");
  const expected = [
    "source **beta** end",
    "",
    "```text",
    "code betaomega",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  await editorLocator(labPage, id).locator(".cm-content").click();
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).codeBlocks.active).toBe(1);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  await armNativeDragCapture(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "beta", 1, "before"),
    await textPoint(labPage, id, "omega", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.codeBlocks.active).toBe(1);
  expect(inserted.codeMirrorFocused).toBe(true);
  expect(inserted.selection.to - inserted.selection.from).toBe("beta".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native rich-text drag copies literal text into passive nested code", async ({
  browserName,
  context,
  labPage,
}) => {
  await reloadWithoutIntersectionObserver(labPage);
  const id = "native-passive-code-destination";
  const original = [
    "source **beta** end",
    "",
    "```text",
    "code omega",
    "```",
  ].join("\n");
  const expected = [
    "source **beta** end",
    "",
    "```text",
    "code betaomega",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const initial = await snapshotEditor(labPage, id);
  expect(initial.codeBlocks.active).toBe(0);
  expect(initial.codeBlocks.staticViews).toBe(1);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  await armNativeDragCapture(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "beta", 1, "before"),
    await textPoint(labPage, id, "omega", 0, "before", ".mdw-code-block-static-code"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.selection.from).toBe(inserted.selection.to);

  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" })
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "redo" })
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native active-code drag moves one plain selection inside CodeMirror", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  const id = "native-active-code-internal";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
  ].join("\n");
  const expected = [
    "```text",
    "alpha  omegaCODE",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await settleEditor(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content"),
    await textPoint(labPage, id, "omega", 4, "after", ".cm-content"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types.filter((type) => !type.startsWith("text/_moz_"))))
    .toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const moved = await snapshotEditor(labPage, id);
  expect(moved.codeMirrorFocused).toBe(true);
  expect(moved.prosemirrorFocused).toBe(false);
  expect(moved.selection.to - moved.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required modified native active-code drag copies inside CodeMirror", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  const id = "native-active-code-internal-copy";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
  ].join("\n");
  const expected = [
    "```text",
    "alpha CODE omegaCODE",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await settleEditor(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content"),
    await textPoint(labPage, id, "omega", 4, "after", ".cm-content"),
    { copy: true },
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(dragstart[0]?.ctrlKey).toBe(true);
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragEvents.filter(({ type }) => type === "drop")).toHaveLength(1);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.codeMirrorFocused).toBe(true);
  expect(inserted.selection.to - inserted.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native active-code drag copies between editors with isolated history", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  const sourceId = "native-active-code-cross-source";
  const destinationId = "native-active-code-cross-destination";
  const source = [
    "```text",
    "alpha CODE omega",
    "```",
  ].join("\n");
  const destination = [
    "```text",
    "target Z",
    "```",
  ].join("\n");
  const expectedDestination = [
    "```text",
    "target ZCODE",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id: sourceId, markdown: source, root: "shadow" });
  await mountEditor(labPage, {
    id: destinationId,
    markdown: destination,
    root: "shadow",
  });
  const sourceCode = editorLocator(labPage, sourceId).locator(".cm-content");
  const destinationCode = editorLocator(labPage, destinationId).locator(".cm-content");
  await destinationCode.click();
  await sourceCode.click();
  await settleEditor(labPage, sourceId);
  await settleEditor(labPage, destinationId);
  expect((await snapshotEditor(labPage, sourceId)).codeBlocks.active).toBe(1);
  expect((await snapshotEditor(labPage, destinationId)).codeBlocks.active).toBe(1);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, sourceId, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, sourceId, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, sourceId);
  const selected = await snapshotEditor(labPage, sourceId);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  expect(await sourceCode.evaluate((element) => {
    const root = element.getRootNode() as Document | (ShadowRoot & {
      getSelection?: Document["getSelection"];
    });
    const selection = root.getSelection?.() ?? element.ownerDocument.getSelection();
    return selection?.toString() ?? "";
  })).toBe("CODE");
  await armNativeDragCapture(labPage, sourceId);
  await armNativeDragCapture(labPage, destinationId);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, sourceId, "CODE", 1, "before", ".cm-content"),
    await textPoint(labPage, destinationId, "target Z", 7, "after", ".cm-content"),
  );
  await settleEditor(labPage, sourceId);
  await settleEditor(labPage, destinationId);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, sourceId), JSON.stringify(dragEvents)).toBe(source);
  expect(await getMarkdown(labPage, destinationId), JSON.stringify(dragEvents))
    .toBe(expectedDestination);
  const dragstart = dragEvents.filter(({ editorId, type }) => (
    editorId === sourceId && type === "dragstart"
  ));
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types.filter((type) => !type.startsWith("text/_moz_"))))
    .toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ editorId, type }) => (
    editorId === destinationId && type === "drop"
  ));
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, destinationId);
  expect(inserted.codeMirrorFocused).toBe(true);
  expect(inserted.prosemirrorFocused).toBe(false);
  expect(inserted.selection.to - inserted.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(destination);
  expect(await getMarkdown(labPage, sourceId)).toBe(source);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, destinationId);
  expect(await getMarkdown(labPage, destinationId)).toBe(expectedDestination);
  expect(await getMarkdown(labPage, sourceId)).toBe(source);

  await cdp?.detach();
});

test("@required native active-code drag copies between code blocks in one history", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  const id = "native-active-code-sibling-transfer";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "middle",
    "",
    "```text",
    "target Z",
    "```",
  ].join("\n");
  const expected = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "middle",
    "",
    "```text",
    "target ZCODE",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const codeBlocks = editorLocator(labPage, id).locator(".cm-content");
  await codeBlocks.nth(1).click();
  await codeBlocks.nth(0).click();
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).codeBlocks.active).toBe(2);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content", 0),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content", 0),
  );
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content", 0),
    await textPoint(labPage, id, "target Z", 7, "after", ".cm-content", 1),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types.filter((type) => !type.startsWith("text/_moz_"))))
    .toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.codeBlocks.active).toBe(2);
  expect(inserted.codeMirrorFocused).toBe(true);
  expect(inserted.prosemirrorFocused).toBe(false);
  expect(inserted.selection.to - inserted.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native active-code drag copies into a passive sibling before activation", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  await reloadWithoutIntersectionObserver(labPage);
  const id = "native-active-to-passive-code";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "middle",
    "",
    "```text",
    "target Z",
    "```",
  ].join("\n");
  const expected = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "middle",
    "",
    "```text",
    "target ZCODE",
    "```",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const shells = editor.locator(".mdw-code-block");
  const staticCode = editor.locator(".mdw-code-block-static-code");
  await staticCode.nth(0).click();
  await expect(shells.nth(0)).toHaveAttribute("data-mdw-code-block-state", "active");
  await expect(shells.nth(0).locator(".cm-content")).toBeFocused();
  await settleEditor(labPage, id);
  const activated = await snapshotEditor(labPage, id);
  expect(activated.codeBlocks.active).toBe(1);
  expect(activated.codeBlocks.inactive).toBe(1);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content"),
    await textPoint(
      labPage,
      id,
      "target Z",
      7,
      "after",
      ".mdw-code-block-static-code",
      1,
    ),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types.filter((type) => !type.startsWith("text/_moz_"))))
    .toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.codeBlocks.active).toBe(2);
  expect(inserted.codeMirrorFocused).toBe(true);
  expect(inserted.prosemirrorFocused).toBe(false);
  expect(inserted.selection.from).toBe(inserted.selection.to);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native active-code drag copies plain text into the rich surface", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit does not synthesize dragstart from a live active-CodeMirror text selection.",
  );
  const id = "native-active-code-source";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "target Z",
  ].join("\n");
  const expected = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "target ZCODE",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await settleEditor(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.codeBlocks.active).toBe(1);
  expect(selected.codeMirrorFocused).toBe(true);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  expect(await code.evaluate((element) => {
    const root = element.getRootNode() as Document | (ShadowRoot & {
      getSelection?: Document["getSelection"];
    });
    const selection = root.getSelection?.() ?? element.ownerDocument.getSelection();
    return selection?.toString() ?? "";
  })).toBe("CODE");
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content"),
    await textPoint(labPage, id, "target Z", 7, "after"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types.filter((type) => !type.startsWith("text/_moz_"))))
    .toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.prosemirrorFocused).toBe(true);
  expect(inserted.selection.to - inserted.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await code.click();
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 3, "after", ".cm-content"),
    await textPoint(labPage, id, "CODE", 0, "before", ".cm-content"),
  );
  await settleEditor(labPage, id);
  const hostButton = labPage.locator("#native-active-code-host-handoff");
  await labPage.evaluate((editorId) => {
    const button = document.createElement("button");
    button.id = "native-active-code-host-handoff";
    button.textContent = "Host handoff";
    document.body.append(button);
    document.querySelector(`[data-e2e-editor="${editorId}"]`)!.addEventListener("drop", () => {
      button.focus();
    }, { once: true });
  }, id);
  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".cm-content"),
    await textPoint(labPage, id, "target Z", 7, "after"),
  );
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);
  await expect(hostButton).toBeFocused();
  const handedOff = await snapshotEditor(labPage, id);
  expect(handedOff.codeMirrorFocused).toBe(false);
  expect(handedOff.prosemirrorFocused).toBe(false);

  await cdp?.detach();
});

test("@required native passive-code drag moves plain text into the rich surface", async ({
  browserName,
  context,
  labPage,
}) => {
  await reloadWithoutIntersectionObserver(labPage);
  const id = "native-passive-code-source";
  const original = [
    "```text",
    "alpha CODE omega",
    "```",
    "",
    "target Z",
  ].join("\n");
  const expected = [
    "```text",
    "alpha  omega",
    "```",
    "",
    "target ZCODE",
  ].join("\n");
  await mountEditor(labPage, { id, markdown: original, root: "shadow" });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "CODE", "all")
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  const selected = await snapshotEditor(labPage, id);
  expect(selected.codeBlocks.active).toBe(0);
  expect(selected.codeBlocks.staticViews).toBe(1);
  expect(selected.selection.to - selected.selection.from).toBe("CODE".length);
  await armNativeDragCapture(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "CODE", 1, "before", ".mdw-code-block-static-code"),
    await textPoint(labPage, id, "target Z", 7, "after"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
  expect(dragstart).toHaveLength(1);
  expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
  expect(dragstart[0]?.plain).toBe("CODE");
  expect(dragstart[0]?.html).toContain("CODE");
  const drop = dragEvents.filter(({ type }) => type === "drop");
  expect(drop).toHaveLength(1);
  expect(drop[0]?.defaultPrevented).toBe(true);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  const inserted = await snapshotEditor(labPage, id);
  expect(inserted.prosemirrorFocused).toBe(true);
  expect(inserted.selection.to - inserted.selection.from).toBe("CODE".length);

  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(original);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native multi-block drag moves one open semantic slice", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  for (const testCase of [
    {
      expected: ["left  right", "", "target ZAAA", "", "BBB"].join("\n"),
      id: "native-multi-block-drag-forward",
      markdown: ["left AAA", "", "BBB right", "", "target Z"].join("\n"),
      selection: { anchor: 6, head: 14 },
    },
    {
      expected: ["target ZAAA", "", "BBB", "", "left  right"].join("\n"),
      id: "native-multi-block-drag-backward",
      markdown: ["target Z", "", "left AAA", "", "BBB right"].join("\n"),
      selection: { anchor: 16, head: 24 },
    },
  ]) {
    await mountEditor(labPage, {
      autofocus: true,
      id: testCase.id,
      initialSelection: testCase.selection,
      markdown: testCase.markdown,
      root: "shadow",
    });
    const initial = (await snapshotEditor(labPage, testCase.id)).selection;
    expect(initial).toMatchObject({
      ...testCase.selection,
      from: testCase.selection.anchor,
      to: testCase.selection.head,
    });
    await armNativeDragCapture(labPage, testCase.id);

    await dragPointer(
      labPage,
      cdp,
      await textPoint(labPage, testCase.id, "left AAA", 6, "before"),
      await textPoint(labPage, testCase.id, "target Z", 7, "after"),
    );
    await settleEditor(labPage, testCase.id);

    const dragEvents = await readNativeDragCapture(labPage);
    expect(await getMarkdown(labPage, testCase.id), JSON.stringify(dragEvents)).toBe(testCase.expected);
    const dragstart = dragEvents.filter(({ type }) => type === "dragstart");
    expect(dragstart).toHaveLength(1);
    expect(new Set(dragstart[0]?.types)).toEqual(new Set(["text/html", "text/plain"]));
    const drop = dragEvents.filter(({ type }) => type === "drop");
    expect(drop).toHaveLength(1);
    expect(drop[0]?.defaultPrevented).toBe(true);
    expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
    const moved = (await snapshotEditor(labPage, testCase.id)).selection;
    expect(moved.to - moved.from).toBe(8);
    await labPage.keyboard.press("ControlOrMeta+Z");
    await settleEditor(labPage, testCase.id);
    expect(await getMarkdown(labPage, testCase.id)).toBe(testCase.markdown);
    await labPage.keyboard.press("ControlOrMeta+Shift+Z");
    await settleEditor(labPage, testCase.id);
    expect(await getMarkdown(labPage, testCase.id)).toBe(testCase.expected);
  }

  await cdp?.detach();
});

test("@required native multi-block drag preserves nested list-item structure", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-list-multi-block-drag";
  const markdown = ["* target Z", "* left AAA", "* BBB right"].join("\n");
  const expected = ["* target ZAAA", "* BBB", "* left  right"].join("\n");
  await mountEditor(labPage, {
    autofocus: true,
    id,
    initialSelection: { anchor: 20, head: 30 },
    markdown,
    root: "shadow",
  });
  expect((await snapshotEditor(labPage, id)).selection).toMatchObject({
    anchor: 20,
    from: 20,
    head: 30,
    to: 30,
  });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  await armNativeDragCapture(labPage, id);

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "left AAA", 6, "before"),
    await textPoint(labPage, id, "target Z", 7, "after"),
  );
  await settleEditor(labPage, id);

  const dragEvents = await readNativeDragCapture(labPage);
  expect(await getMarkdown(labPage, id), JSON.stringify(dragEvents)).toBe(expected);
  expect(dragEvents.filter(({ type }) => type === "dragstart")).toHaveLength(1);
  expect(dragEvents.filter(({ type }) => type === "drop")).toHaveLength(1);
  expect(dragEvents.every(({ isTrusted }) => isTrusted)).toBe(true);
  await expect(editorLocator(labPage, id).locator("li")).toHaveCount(3);
  const moved = (await snapshotEditor(labPage, id)).selection;
  expect(moved.to - moved.from).toBe(10);
  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required native multi-block drag preserves an enclosed managed code block", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-managed-multi-block-drag";
  const markdown = [
    "left AAA",
    "",
    "```text",
    "code",
    "```",
    "",
    "BBB right",
    "",
    "target Z",
  ].join("\n");
  const expected = [
    "left  right",
    "",
    "target ZAAA",
    "",
    "```text",
    "code",
    "```",
    "",
    "BBB",
  ].join("\n");
  await mountEditor(labPage, {
    autofocus: true,
    id,
    initialSelection: { anchor: 6, head: 20 },
    markdown,
    root: "shadow",
  });
  expect((await snapshotEditor(labPage, id)).selection).toMatchObject({
    anchor: 6,
    from: 6,
    head: 20,
    to: 20,
  });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    await textPoint(labPage, id, "left AAA", 6, "before"),
    await textPoint(labPage, id, "target Z", 7, "after"),
  );
  await settleEditor(labPage, id);

  expect(await getMarkdown(labPage, id)).toBe(expected);
  const moved = await snapshotEditor(labPage, id);
  expect(moved.selection.to - moved.selection.from).toBe(14);
  expect(moved.codeBlocks).toMatchObject({
    active: 1,
    codeMirrorEditors: 1,
    staticViews: 1,
    total: 1,
  });
  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});

test("@required direct image drag moves one undoable image atom", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "native-image-drag";
  const markdown = `alpha ![alt](${PIXEL_GIF}) delta`;
  const expected = `alpha  delta![alt](${PIXEL_GIF})`;
  await mountEditor(labPage, { id, markdown, root: "shadow" });
  const image = editorLocator(labPage, id).locator(".mdw-image");
  const start = await image.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  await dragPointer(
    labPage,
    cdp,
    start,
    await textPoint(labPage, id, "delta", 4, "after"),
  );
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);
  await expect(image).toHaveCount(1);
  const moved = (await snapshotEditor(labPage, id)).selection;
  expect(moved.to - moved.from).toBe(1);
  await labPage.keyboard.press("ControlOrMeta+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  await labPage.keyboard.press("ControlOrMeta+Shift+Z");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(expected);

  await cdp?.detach();
});
