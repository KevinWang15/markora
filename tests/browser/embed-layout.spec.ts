import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

type OverlayGeometry = {
  layout: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  rect: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  visual: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
};

async function readOverlayGeometry(overlay: ReturnType<typeof ownedOverlay>): Promise<OverlayGeometry> {
  return overlay.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const visualLeft = visualViewport?.offsetLeft ?? 0;
    const visualTop = visualViewport?.offsetTop ?? 0;
    const visualWidth = visualViewport?.width || document.documentElement.clientWidth;
    const visualHeight = visualViewport?.height || window.innerHeight;

    return {
      layout: {
        bottom: window.innerHeight,
        left: 0,
        right: document.documentElement.clientWidth,
        top: 0,
      },
      rect: {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      },
      visual: {
        bottom: visualTop + visualHeight,
        left: visualLeft,
        right: visualLeft + visualWidth,
        top: visualTop,
      },
    };
  });
}

function expectOverlayWithinViewport({ layout, rect, visual }: OverlayGeometry) {
  const viewportMarginWithRoundingTolerance = 10;

  expect(rect.left).toBeGreaterThanOrEqual(visual.left + viewportMarginWithRoundingTolerance);
  expect(rect.top).toBeGreaterThanOrEqual(visual.top + viewportMarginWithRoundingTolerance);
  expect(rect.right).toBeLessThanOrEqual(visual.right - viewportMarginWithRoundingTolerance);
  expect(rect.bottom).toBeLessThanOrEqual(visual.bottom - viewportMarginWithRoundingTolerance);

  expect(rect.left).toBeGreaterThanOrEqual(layout.left);
  expect(rect.top).toBeGreaterThanOrEqual(layout.top);
  expect(rect.right).toBeLessThanOrEqual(layout.right);
  expect(rect.bottom).toBeLessThanOrEqual(layout.bottom);
}

async function openLinkEditor(page: Parameters<typeof editorLocator>[0], id: string) {
  const link = editorLocator(page, id).locator("a");
  await expect(link).toBeVisible();
  const linkText = await link.textContent();
  expect(linkText).toBeTruthy();
  const selected = await page.evaluate(
    ({ editorId, text }) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, text, "start"),
    { editorId: id, text: linkText! },
  );
  expect(selected).toBe(true);

  const opened = await page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"),
    id,
  );
  expect(opened).toBe(true);

  const overlay = ownedOverlay(page, id, ".mdw-link-editor");
  await expect(overlay).toBeVisible();
  return overlay;
}

test("keeps two editors isolated when one is edited and destroyed", async ({ labPage }) => {
  await mountEditor(labPage, {
    id: "alpha",
    markdown: "Alpha one.",
    portal: "local",
  });
  await mountEditor(labPage, {
    id: "beta",
    markdown: "Beta one.",
    portal: "local",
  });

  await editorLocator(labPage, "alpha").locator("p").click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type(" changed");
  await settleEditor(labPage, "alpha");

  expect(await getMarkdown(labPage, "alpha")).toBe("Alpha one. changed");
  expect(await getMarkdown(labPage, "beta")).toBe("Beta one.");

  const alphaSnapshot = await snapshotEditor(labPage, "alpha");
  const betaSnapshot = await snapshotEditor(labPage, "beta");
  expect(alphaSnapshot.changeCount).toBeGreaterThan(0);
  expect(alphaSnapshot.transactionCount).toBeGreaterThan(0);
  expect(betaSnapshot.changeCount).toBe(0);
  expect(betaSnapshot.transactionCount).toBe(0);

  expect(await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.destroy("alpha"))).toBe(true);
  await settleEditor(labPage);

  await expect(labPage.locator('[data-e2e-editor="alpha"]')).toHaveCount(0);
  await expect(ownedOverlay(labPage, "alpha", ".mdw-link-editor")).toHaveCount(0);
  await expect(editorLocator(labPage, "beta")).toBeVisible();
  expect(await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.mountedIds())).toEqual(["beta"]);
  expect(await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.listenerSnapshot("alpha"))).toEqual({
    total: 0,
    byTargetAndType: {},
  });
  expect((await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.listenerSnapshot("beta"))).total)
    .toBeGreaterThan(0);

  await editorLocator(labPage, "beta").locator("p").click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.type(" changed");
  await settleEditor(labPage, "beta");

  expect(await getMarkdown(labPage, "beta")).toBe("Beta one. changed");
});

test("keeps default UI and CodeMirror functional inside an open Shadow DOM", async ({ labPage }) => {
  const initialMarkdown = [
    "Before [Docs](#before).",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "",
    "After.",
  ].join("\n");
  const expectedMarkdown = [
    "Before [Docs](#after).",
    "",
    "```ts",
    "const value = 1;",
    "const next = 2;",
    "```",
    "",
    "After.",
  ].join("\n");

  await mountEditor(labPage, {
    id: "shadow",
    markdown: initialMarkdown,
    portal: "default",
    root: "shadow",
  });

  const shadowHost = labPage.locator('[data-e2e-shadow-host="shadow"]');
  await expect(shadowHost.locator(".ProseMirror")).toBeVisible();
  await expect(shadowHost.locator('.mdw-link-editor[data-e2e-owner="shadow"]')).toHaveCount(1);
  await expect(labPage.locator('body > .mdw-link-editor[data-e2e-owner="shadow"]')).toHaveCount(0);

  const linkOverlay = await openLinkEditor(labPage, "shadow");
  await linkOverlay.getByLabel("Link URL").fill("#after");
  await linkOverlay.getByRole("button", { name: "Save" }).click();
  await expect(linkOverlay).toBeHidden();

  const codeMirror = shadowHost.locator(".mdw-code-block .cm-content");
  await expect(codeMirror).toBeVisible();
  await codeMirror.click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.press("Enter");
  await labPage.keyboard.type("const next = 2;");
  await settleEditor(labPage, "shadow");

  const snapshot = await snapshotEditor(labPage, "shadow");
  expect(snapshot.codeMirrorFocused).toBe(true);
  expect(snapshot.activeElement).toBe("code-mirror");
  expect(snapshot.markdown).toBe(expectedMarkdown);
  expect(await getMarkdown(labPage, "shadow")).toBe(expectedMarkdown);
});

for (const portal of ["local", "positioned", "transformed"] as const) {
  test(`keeps the ${portal} link overlay inside a resized visual viewport`, async ({ labPage }) => {
    await labPage.setViewportSize({ width: 380, height: 440 });
    await mountEditor(labPage, {
      id: portal,
      markdown: "Portal [link](#before).",
      placement: "bottom-right",
      portal,
    });

    const overlay = await openLinkEditor(labPage, portal);
    await overlay.getByLabel("Link URL").fill(`#${portal}-after`);
    expectOverlayWithinViewport(await readOverlayGeometry(overlay));

    await labPage.setViewportSize({ width: 320, height: 360 });
    await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("resize"));
    await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("scroll"));
    await settleEditor(labPage, portal);

    expectOverlayWithinViewport(await readOverlayGeometry(overlay));
    await overlay.getByRole("button", { name: "Save" }).click();
    await settleEditor(labPage, portal);

    expect(await getMarkdown(labPage, portal)).toBe(`Portal [link](#${portal}-after).`);

    expect(await labPage.evaluate((id) => window.__MARKORA_BROWSER_LAB__!.destroy(id), portal)).toBe(true);
    await settleEditor(labPage);
    expect(await labPage.evaluate((id) => window.__MARKORA_BROWSER_LAB__!.listenerSnapshot(id), portal)).toEqual({
      total: 0,
      byTargetAndType: {},
    });
  });
}

test("keeps the responsive table toolbar usable in a transformed portal", async ({ labPage }) => {
  const initialMarkdown = [
    "| A | B |",
    "| --- | --- |",
    "| one | two |",
  ].join("\n");
  const expectedMarkdown = [
    "| A | B |  |",
    "| --- | --- | --- |",
    "| one | two |  |",
  ].join("\n");

  await labPage.setViewportSize({ width: 380, height: 440 });
  await mountEditor(labPage, {
    id: "responsive-table",
    markdown: initialMarkdown,
    placement: "bottom-right",
    portal: "transformed",
  });

  const secondBodyCell = editorLocator(labPage, "responsive-table")
    .locator("tbody tr:nth-child(2) td:nth-child(2) p");
  await secondBodyCell.click();

  const toolbar = ownedOverlay(labPage, "responsive-table", ".mdw-table-toolbar");
  await expect(toolbar).toBeVisible();
  expectOverlayWithinViewport(await readOverlayGeometry(toolbar));

  await labPage.setViewportSize({ width: 320, height: 360 });
  await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.dispatchViewportEvent("resize"));
  await settleEditor(labPage, "responsive-table");
  expectOverlayWithinViewport(await readOverlayGeometry(toolbar));

  await toolbar.getByRole("button", { name: "Insert column after" }).click();
  await settleEditor(labPage, "responsive-table");

  await expect(editorLocator(labPage, "responsive-table").locator("tbody tr").first().locator("th"))
    .toHaveCount(3);
  await expect(editorLocator(labPage, "responsive-table").locator("tbody tr").nth(1).locator("td"))
    .toHaveCount(3);
  expect(await getMarkdown(labPage, "responsive-table")).toBe(expectedMarkdown);
});
