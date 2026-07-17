import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  blurEditor,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

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

function compactCodeBlocks(count: number) {
  return [
    "intro paragraph",
    ...Array.from({ length: count }, (_, index) => (
      ["```text", `block-${index}`, "```"].join("\n")
    )),
  ].join("\n\n");
}

function longCodeBlocks(count: number) {
  return [
    "intro paragraph keeps the initial selection outside code",
    ...Array.from({ length: count }, (_, index) => (
      [
        "```text",
        ...Array.from({ length: 18 }, (__, line) => `block-${index} line-${line}`),
        "```",
      ].join("\n")
    )),
  ].join("\n\n");
}

test("@required passive code shells preserve exact text, ranges, copy, and DOM search", async ({
  browserName,
  context,
  labPage,
}) => {
  await reloadWithoutIntersectionObserver(labPage);
  const id = "passive-code";
  const code = "alpha  \n\tbeta 😀\nunique-passive-cdp-token <tag> & value";
  const mounted = await mountEditor(labPage, {
    editable: false,
    id,
    markdown: ["intro", "", "```custom", code, "```"].join("\n"),
  });

  expect(mounted.codeBlocks).toEqual({
    active: 0,
    codeMirrorEditors: 0,
    error: 0,
    inactive: 1,
    loading: 0,
    staticViews: 1,
    total: 1,
  });
  const shell = editorLocator(labPage, id).locator(".mdw-code-block");
  const staticCode = shell.locator(".mdw-code-block-static-code");
  expect(await staticCode.evaluate((element) => ({
    label: element.hasAttribute("aria-label"),
    readonly: element.hasAttribute("aria-readonly"),
  }))).toEqual({ label: false, readonly: false });
  await expect(staticCode).toHaveAttribute("spellcheck", "false");
  expect(await staticCode.evaluate((element) => element.tagName)).toBe("CODE");
  expect(await staticCode.textContent()).toBe(code);
  expect(await shell.locator(".mdw-code-block-static-gutter").textContent()).toBe("1\n2\n3");

  const rangeText = await staticCode.evaluate((element) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = element.ownerDocument.createRange();
    const start = 3;
    const end = element.textContent!.indexOf("😀") + "😀".length;
    let offset = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const nextOffset = offset + node.data.length;

      if (!startNode && start >= offset && start <= nextOffset) {
        startNode = node;
        startOffset = start - offset;
      }

      if (!endNode && end >= offset && end <= nextOffset) {
        endNode = node;
        endOffset = end - offset;
        break;
      }

      offset = nextOffset;
    }

    range.setStart(startNode!, startOffset);
    range.setEnd(endNode!, endOffset);
    return range.toString();
  });
  expect(rangeText).toBe(code.slice(3, code.indexOf("😀") + "😀".length));

  const copied = await labPage.evaluate(({ editorId, needle }) => {
    const lab = window.__MARKORA_BROWSER_LAB__!;
    return {
      selected: lab.selectText(editorId, needle, "all"),
      value: lab.copySelection(editorId),
    };
  }, { editorId: id, needle: "beta 😀" });
  expect(copied.selected).toBe(true);
  expect(copied.value.defaultPrevented).toBe(true);
  expect(copied.value.plain).toBe("beta 😀");
  expect((await snapshotEditor(labPage, id)).codeBlocks).toMatchObject({
    active: 0,
    codeMirrorEditors: 0,
    inactive: 1,
    loading: 0,
  });

  const domSearch = await staticCode.evaluate((element, needle) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const matches: string[] = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.includes(needle)) {
        matches.push(node.textContent);
      }
    }

    return matches;
  }, "unique-passive-cdp-token");
  expect(domSearch).toEqual([expect.stringContaining("unique-passive-cdp-token")]);

  const accessibility = await new AxeBuilder({ page: labPage })
    .include(`[data-e2e-editor="${id}"] .mdw-code-block`)
    .analyze();
  expect(
    accessibility.violations.map(({ id: rule }) => rule),
    JSON.stringify(accessibility.violations.map(({ id: rule, nodes }) => ({
      nodes: nodes.map(({ failureSummary, target }) => ({ failureSummary, target })),
      rule,
    })), null, 2),
  ).toEqual([]);

  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);

    try {
      await cdp.send("DOM.enable");
      // Populate the frontend-node map before requesting search result IDs;
      // otherwise Chromium can report matches with the sentinel nodeId 0.
      await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const search = await cdp.send("DOM.performSearch", {
        query: "unique-passive-cdp-token",
        includeUserAgentShadowDOM: true,
      });
      expect(search.resultCount).toBeGreaterThan(0);
      const results = await cdp.send("DOM.getSearchResults", {
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: search.resultCount,
      });
      const shellMatches: boolean[] = [];
      const searchDiagnostics: unknown[] = [];

      for (const nodeId of results.nodeIds) {
        let resolved: Awaited<ReturnType<typeof cdp.send<"DOM.resolveNode">>>;

        try {
          // performSearch can include transient mirror/text nodes that no
          // longer have a resolvable frontend ID. They are irrelevant as long
          // as one live hit is proven inside the passive shell.
          resolved = await cdp.send("DOM.resolveNode", { nodeId });
        } catch (error) {
          shellMatches.push(false);
          searchDiagnostics.push({ error: String(error), nodeId });
          continue;
        }
        const objectId = resolved.object.objectId;

        if (!objectId) {
          shellMatches.push(false);
          continue;
        }

        const result = await cdp.send("Runtime.callFunctionOn", {
          functionDeclaration: `function () {
            const element = this.nodeType === 1 ? this : this.parentElement;
            const code = element && element.closest && element.closest('.mdw-code-block-static-code');
            return Boolean(code && code.closest('[data-e2e-editor="${id}"]'));
          }`,
          objectId,
          returnByValue: true,
        });
        shellMatches.push(result.result.value === true);
        searchDiagnostics.push({
          description: resolved.object.description,
          exception: result.exceptionDetails?.text,
          nodeId,
          result: result.result,
        });
        await cdp.send("Runtime.releaseObject", { objectId });
      }

      expect(shellMatches, JSON.stringify(searchDiagnostics, null, 2)).toContain(true);
      await cdp.send("DOM.discardSearchResults", { searchId: search.searchId });
    } finally {
      await cdp.send("DOM.disable");
      await cdp.detach();
    }
  }
});

test("@required viewport activation stays bounded and offscreen editors return to static shells", async ({
  labPage,
}) => {
  const id = "bounded-code";
  await mountEditor(labPage, { id, markdown: longCodeBlocks(12) });
  const editor = editorLocator(labPage, id);
  const shells = editor.locator(".mdw-code-block");
  await expect(shells).toHaveCount(12);
  await expect(shells.nth(0)).toHaveAttribute("data-mdw-code-block-state", "active");

  await expect.poll(async () => {
    const snapshot = await snapshotEditor(labPage, id);
    return snapshot.codeBlocks.active + snapshot.codeBlocks.loading;
  }).toBeLessThanOrEqual(8);

  const last = shells.nth(11);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute("data-mdw-code-block-state", "active");
  await labPage.waitForTimeout(550);
  await expect(shells.nth(0)).toHaveAttribute("data-mdw-code-block-state", "inactive");
  await expect(shells.nth(0).locator(".mdw-code-block-static-code")).toContainText("block-0 line-0");
  await expect(shells.nth(0).locator(".cm-editor")).toHaveCount(0);

  const snapshot = await snapshotEditor(labPage, id);
  expect(snapshot.codeBlocks.total).toBe(12);
  expect(snapshot.codeBlocks.staticViews).toBe(12);
  expect(snapshot.codeBlocks.active + snapshot.codeBlocks.loading).toBeLessThanOrEqual(8);
  expect(snapshot.codeBlocks.inactive).toBeGreaterThan(0);

  const activeContent = last.locator(".cm-content");
  await last.locator(".cm-line").first().click({ position: { x: 5, y: 5 } });
  await expect(activeContent).toBeFocused();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type(" // edited");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toContain("block-11 line-0 // edited");
  expect((await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(true);
});

test("@required inactive code-block click hands the caret to a warm lazy editor", async ({
  labPage,
}) => {
  await reloadWithoutIntersectionObserver(labPage);
  const id = "warm-pointer";
  await mountEditor(labPage, { id, markdown: compactCodeBlocks(9) });
  let firstBounds = { from: -1, to: -1 };

  for (let index = 0; index < 9; index += 1) {
    expect(await labPage.evaluate(({ editorId, needle }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "start")
    ), { editorId: id, needle: `block-${index}` })).toBe(true);
    await settleEditor(labPage, id);

    if (index === 0) {
      const selection = (await snapshotEditor(labPage, id)).selection;
      firstBounds = { from: selection.from, to: selection.from + "block-0".length };
    }
  }

  const editor = editorLocator(labPage, id);
  const first = editor.locator(".mdw-code-block").nth(0);
  await expect(first).toHaveAttribute("data-mdw-code-block-state", "inactive");
  expect((await snapshotEditor(labPage, id)).codeBlocks.active).toBeLessThanOrEqual(8);

  await first.locator(".mdw-code-block-static-code").click({ position: { x: 5, y: 5 } });
  await expect(first).toHaveAttribute("data-mdw-code-block-state", "active");
  await expect(first.locator(".cm-content")).toBeFocused();
  const afterClick = await snapshotEditor(labPage, id);
  expect(afterClick.selection.anchor).toBe(afterClick.selection.head);
  expect(afterClick.selection.from).toBe(afterClick.selection.to);
  expect(afterClick.selection.from).toBeGreaterThanOrEqual(firstBounds.from);
  expect(afterClick.selection.to).toBeLessThanOrEqual(firstBounds.to);
  expect(afterClick.codeBlocks.active + afterClick.codeBlocks.loading).toBeLessThanOrEqual(8);
});

for (const root of ["document", "shadow"] as const) {
  for (const handoff of ["host control", "public blur"] as const) {
    test(`@required cold lazy activation respects ${handoff} in a ${root} root`, async ({
      browserName,
      labPage,
    }) => {
      test.skip(browserName !== "chromium", "The delayed runtime handoff is certified in Chromium.");
      await reloadWithoutIntersectionObserver(labPage);

      let releaseRuntime!: () => void;
      const runtimeGate = new Promise<void>((resolve) => {
        releaseRuntime = resolve;
      });
      let observeRuntimeRequest!: () => void;
      const runtimeRequested = new Promise<void>((resolve) => {
        observeRuntimeRequest = resolve;
      });
      await labPage.route(/activeCodeBlockView-[^/]+\.js$/, async (route) => {
        observeRuntimeRequest();
        await runtimeGate;
        await route.continue();
      });

      const id = `cold-focus-${root}-${handoff.replace(" ", "-")}`;
      await mountEditor(labPage, {
        id,
        markdown: ["intro", "", "```text", "cold focus", "```"].join("\n"),
        root,
      });
      if (handoff === "host control") {
        await labPage.evaluate(() => {
          const button = document.createElement("button");
          button.id = "activation-race-host-button";
          button.textContent = "Open host dialog";
          document.body.append(button);
        });
      }
      const hostButton = labPage.locator("#activation-race-host-button");
      const shell = editorLocator(labPage, id).locator(".mdw-code-block");

      await shell.locator(".mdw-code-block-static-code").click({ position: { x: 5, y: 5 } });
      await runtimeRequested;
      if (handoff === "host control") {
        await hostButton.focus();
        await expect(hostButton).toBeFocused();
      } else {
        await blurEditor(labPage, id);
        expect(await labPage.evaluate(() => document.activeElement === document.body)).toBe(true);
      }
      releaseRuntime();

      await expect(shell).toHaveAttribute("data-mdw-code-block-state", "active");
      if (handoff === "host control") {
        await expect(hostButton).toBeFocused();
      } else {
        expect(await labPage.evaluate(() => document.activeElement === document.body)).toBe(true);
      }
      await expect(shell.locator(".cm-content")).not.toBeFocused();
      await labPage.unroute(/activeCodeBlockView-[^/]+\.js$/);
    });
  }
}

test("@required passive code-block drag keeps the native range and does not activate", async ({
  browserName,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Trusted drag geometry is asserted in Chromium.");
  await reloadWithoutIntersectionObserver(labPage);
  const id = "passive-drag";
  const target = "drag-target-value";
  await mountEditor(labPage, {
    id,
    markdown: ["intro", "", "```text", `${target} suffix`, "```"].join("\n"),
  });
  const staticCode = editorLocator(labPage, id).locator(".mdw-code-block-static-code");
  const points = await staticCode.evaluate((element, length) => {
    const text = element.firstChild!;
    const first = element.ownerDocument.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    const firstRect = first.getBoundingClientRect();
    const last = element.ownerDocument.createRange();
    last.setStart(text, length - 1);
    last.setEnd(text, length);
    const lastRect = last.getBoundingClientRect();
    return {
      end: { x: lastRect.right - 1, y: lastRect.top + lastRect.height / 2 },
      start: { x: firstRect.left + 1, y: firstRect.top + firstRect.height / 2 },
    };
  }, target.length);

  await labPage.mouse.move(points.end.x, points.end.y);
  await labPage.mouse.down();
  await labPage.mouse.move(points.start.x, points.start.y, { steps: 12 });
  await labPage.mouse.up();

  const selection = await staticCode.evaluate((element) => {
    const rootSelection = element.ownerDocument.getSelection()!;
    const anchorElement = rootSelection.anchorNode instanceof Element
      ? rootSelection.anchorNode
      : rootSelection.anchorNode?.parentElement;
    const focusElement = rootSelection.focusNode instanceof Element
      ? rootSelection.focusNode
      : rootSelection.focusNode?.parentElement;
    return {
      anchorInside: Boolean(anchorElement && element.contains(anchorElement)),
      focusInside: Boolean(focusElement && element.contains(focusElement)),
      text: rootSelection.toString(),
    };
  });
  expect(selection).toEqual({
    anchorInside: true,
    focusInside: true,
    text: target,
  });
  const afterDrag = await snapshotEditor(labPage, id);
  expect(afterDrag.selection.to - afterDrag.selection.from).toBe(target.length);
  expect(afterDrag.selection.anchor).not.toBe(afterDrag.selection.head);

  const nativeCopy = await staticCode.evaluate((element) => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
      composed: true,
    });
    element.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      plain: transfer.getData("text/plain"),
      selection: element.ownerDocument.getSelection()?.toString() ?? "",
      types: Array.from(transfer.types),
    };
  });
  expect(nativeCopy).toEqual({
    defaultPrevented: true,
    plain: target,
    selection: target,
    types: ["text/plain"],
  });
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).codeBlocks).toMatchObject({
    active: 0,
    codeMirrorEditors: 0,
    inactive: 1,
  });
});
