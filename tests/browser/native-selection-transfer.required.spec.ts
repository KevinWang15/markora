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
  defaultPrevented: boolean;
  editorId: string;
  isTrusted: boolean;
  type: string;
  types: string[];
};

const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function dragPointer(
  page: Page,
  cdp: CDPSession | null,
  start: PointerPoint,
  target: PointerPoint,
) {
  if (cdp) {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      type: "mouseMoved",
      x: start.x,
      y: start.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: start.x,
      y: start.y,
    });
    for (let step = 1; step <= 30; step += 1) {
      const progress = step / 30;
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        type: "mouseMoved",
        x: start.x + (target.x - start.x) * progress,
        y: start.y + (target.y - start.y) * progress,
      });
    }
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: target.x,
      y: target.y,
    });
    return;
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 30 });
  await page.mouse.up();
}

async function textPoint(
  page: Page,
  id: string,
  needle: string,
  offset: number,
  side: "after" | "before",
) {
  return editorLocator(page, id).evaluate((element, options) => {
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

async function armNativeDragCapture(page: Page, id: string) {
  await page.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    (window as typeof window & { __markoraNativeDrag?: unknown }).__markoraNativeDrag = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"] as const) {
      section.addEventListener(type, (rawEvent) => {
        const event = rawEvent as DragEvent;
        (window as typeof window & { __markoraNativeDrag: NativeDragRecord[] }).__markoraNativeDrag.push({
          defaultPrevented: event.defaultPrevented,
          editorId,
          isTrusted: event.isTrusted,
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
