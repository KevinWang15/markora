import type { Locator } from "@playwright/test";
import { chromiumTest,
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
  test,
} from "./fixtures";

async function expectTouchTarget(target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function expectWithinVisualViewport(target: Locator) {
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? document.documentElement.clientWidth;
    const height = viewport?.height ?? window.innerHeight;
    return {
      rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top },
      viewport: { bottom: top + height, left, right: left + width, top },
    };
  });
  const tolerance = 2;
  expect(geometry.rect.left).toBeGreaterThanOrEqual(geometry.viewport.left - tolerance);
  expect(geometry.rect.top).toBeGreaterThanOrEqual(geometry.viewport.top - tolerance);
  expect(geometry.rect.right).toBeLessThanOrEqual(geometry.viewport.right + tolerance);
  expect(geometry.rect.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + tolerance);
}

test.describe("coarse-pointer layouts", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 640 } });

  test("task and overlay controls remain touch-sized and activate exactly once", async ({ labPage }) => {
    expect(await labPage.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const id = "touch-controls";
    await mountEditor(labPage, {
      id,
      markdown: "[Docs](/before)\n\n* [ ] Tap once",
      placement: "bottom-right",
      portal: "local",
    });
    const editor = editorLocator(labPage, id);
    const checkbox = editor.locator("[data-mdw-task-control=true]");
    await expectTouchTarget(checkbox);
    await checkbox.tap();
    await settleEditor(labPage, id);
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(await getMarkdown(labPage, id)).toContain("* [x] Tap once");

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "Docs", "start"),
      id,
    )).toBe(true);
    expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"), id))
      .toBe(true);
    const dialog = ownedOverlay(labPage, id, ".mdw-link-editor");
    await expect(dialog).toBeVisible();
    await expectTouchTarget(dialog.getByLabel("Link URL"));

    for (const button of await dialog.getByRole("button").all()) {
      await expectTouchTarget(button);
    }

    await expectWithinVisualViewport(dialog);
  });

  test("viewport shrink while an overlay input is focused keeps every control reachable", async ({ labPage }) => {
    const id = "virtual-keyboard";
    await mountEditor(labPage, {
      id,
      markdown: "Bottom [link](/before)",
      placement: "bottom-right",
      portal: "transformed",
    });
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "link", "start"),
      id,
    )).toBe(true);
    expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"), id))
      .toBe(true);

    const dialog = ownedOverlay(labPage, id, ".mdw-link-editor");
    const input = dialog.getByLabel("Link URL");
    await input.focus();
    await expectWithinVisualViewport(dialog);

    await labPage.setViewportSize({ width: 320, height: 320 });
    await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("resize"));
    await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("scroll"));
    await settleEditor(labPage, id);
    await expect(input).toBeFocused();
    await expectWithinVisualViewport(dialog);
  });

  test("table controls expose coarse-pointer targets without overflowing", async ({ labPage }) => {
    const id = "touch-table";
    await mountEditor(labPage, {
      id,
      markdown: [
        "| A | B |",
        "| --- | --- |",
        "| one | two |",
      ].join("\n"),
      portal: "local",
    });
    await editorLocator(labPage, id).locator("td p").last().tap();
    const toolbar = ownedOverlay(labPage, id, ".mdw-table-toolbar");
    await expect(toolbar).toBeVisible();

    for (const button of await toolbar.getByRole("button").all()) {
      await expectTouchTarget(button);
    }

    await expectWithinVisualViewport(toolbar);
  });
});

chromiumTest("Chromium 200 percent page zoom preserves overlay access", async ({ context, labPage }) => {
  await labPage.setViewportSize({ width: 640, height: 640 });
  const id = "zoom";
  await mountEditor(labPage, {
    id,
    markdown: "Zoomed [link](/before)",
    placement: "bottom-right",
  });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "link", "start"),
    id,
  )).toBe(true);
  expect(await labPage.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"), id))
    .toBe(true);
  const dialog = ownedOverlay(labPage, id, ".mdw-link-editor");

  const cdp = await context.newCDPSession(labPage);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("resize"));
  await settleEditor(labPage, id);
  await expectWithinVisualViewport(dialog);
});
