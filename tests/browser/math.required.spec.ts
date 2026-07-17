import AxeBuilder from "@axe-core/playwright";
import {
  convertPendingMathEdit,
  copyEditorSelection,
  destroyEditorOnly,
  editorLocator,
  expect,
  getEditorEvents,
  getExtensionSnapshot,
  getMarkdown,
  getMathRendererCalls,
  getMathSnapshot,
  getPendingMathEdit,
  mountEditor,
  reconcileEditor,
  removePendingMathEdit,
  resetEditor,
  runEditorCommand,
  runMathCommand,
  selectMath,
  settleEditor,
  settleMathRenderer,
  test,
  updateEditorOptions,
  updatePendingMathEdit,
  type LabMathNodeTarget,
} from "./fixtures";

const PARITY_SOURCE = [
  "Inline ($x + y$).",
  "",
  "$$a+b$$",
  "",
  "$$",
  "c+d",
  "$$",
].join("\n");

const PARITY_CANONICAL = [
  "Inline ($x + y$).",
  "",
  "$$",
  "a+b",
  "$$",
  "",
  "$$",
  "c+d",
  "$$",
].join("\n");

async function waitForMathCalls(
  page: Parameters<typeof getMathRendererCalls>[0],
  id: string,
  count: number,
) {
  await expect.poll(async () => (await getMathRendererCalls(page, id)).length)
    .toBe(count);
}

async function waitForMathStatus(
  page: Parameters<typeof getMathSnapshot>[0],
  id: string,
  status: string,
) {
  await expect.poll(async () => (await getMathSnapshot(page, id)).nodes[0]?.render.status)
    .toBe(status);
}

test("@required math round-trips in root and minimal document and shadow embeds", async ({ labPage }) => {
  const canonical: string[] = [];

  for (const [id, entry, root] of [
    ["math-root-document", "root", "document"],
    ["math-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      extensionMode: "math",
      id,
      markdown: PARITY_SOURCE,
      mathRendererMode: "missing",
      root,
    });

    const editor = editorLocator(labPage, id);
    await expect(editor.locator('[data-mdw-math-kind="inline"]')).toHaveCount(1);
    await expect(editor.locator('[data-mdw-math-kind="block"]')).toHaveCount(2);

    const snapshot = await getMathSnapshot(labPage, id);
    expect(snapshot.nodes.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: "inline", source: "x + y" },
      { kind: "block", source: "a+b" },
      { kind: "block", source: "c+d" },
    ]);
    expect(snapshot.nodes.map(({ render }) => render)).toEqual([
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
      { enabled: false, errorCode: null, status: "source" },
    ]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(await getMathRendererCalls(labPage, id)).toEqual([]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-math",
      version: "0.0.1",
    });

    canonical.push(await getMarkdown(labPage, id));
    expect(canonical[canonical.length - 1]).toBe(PARITY_CANONICAL);
    expect(await resetEditor(labPage, id, PARITY_CANONICAL)).toBe(PARITY_CANONICAL);
    expect((await getMathSnapshot(labPage, id)).nodes.map(({ kind, source }) => ({
      kind,
      source,
    }))).toEqual(snapshot.nodes.map(({ kind, source }) => ({ kind, source })));
  }

  expect(canonical[1]).toBe(canonical[0]);
});

test("@required math stays source-first without a renderer and reports explicit preview requests", async ({ labPage }) => {
  const id = "math-source-only";
  await mountEditor(labPage, {
    extensionMode: "math",
    id,
    markdown: "$source$",
    mathRendererMode: "missing",
  });

  const target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(target.render).toEqual({
    enabled: false,
    errorCode: null,
    status: "source",
  });
  expect(await runMathCommand(labPage, id, {
    target,
    type: "togglePreview",
  })).toBe(true);
  expect((await getMathSnapshot(labPage, id)).nodes[0]?.render).toEqual({
    enabled: true,
    errorCode: "renderer-missing",
    status: "error",
  });
  const marker = editorLocator(labPage, id).locator("[data-mdw-math]");
  await expect(marker).toHaveAttribute("data-mdw-math-state", "error");
  const diagnosticStyles = await marker.evaluate((element) => {
    const status = element.querySelector<HTMLElement>(".mdw-math__status")!;

    return {
      border: getComputedStyle(element).borderTopColor,
      status: getComputedStyle(status).color,
    };
  });
  expect(diagnosticStyles.border).toBe(diagnosticStyles.status);
  await expect(
    editorLocator(labPage, id).locator("[data-mdw-math-source]"),
  ).toHaveText("$source$");
  await expect(
    editorLocator(labPage, id).getByRole("button", { name: "Retry math preview" }),
  ).toBeVisible();
  expect((await getEditorEvents(labPage, id)).log).toContainEqual(expect.objectContaining({
    code: "EXTENSION_MATH_RENDERER_MISSING",
    contribution: "renderer",
    extension: "markora-extension-math",
    type: "error",
  }));
  expect(await getMarkdown(labPage, id)).toBe("$source$");
});

test("@required sync and deferred math previews never leak into Markdown or clipboard data", async ({ labPage }) => {
  const deferredId = "math-deferred-preview";
  const markdown = "Before $x^2$ after.";
  await mountEditor(labPage, {
    extensionMode: "math",
    id: deferredId,
    markdown,
    mathRendererMode: "deferred",
    root: "shadow",
  });
  await waitForMathCalls(labPage, deferredId, 1);
  expect(await getMathRendererCalls(labPage, deferredId)).toEqual([{
    aborted: false,
    id: 1,
    kind: "inline",
    settled: "pending",
    source: "x^2",
  }]);
  expect(await settleMathRenderer(labPage, deferredId, { callId: 1 })).toBe(true);
  await waitForMathStatus(labPage, deferredId, "rendered");

  const editor = editorLocator(labPage, deferredId);
  const rendered = editor.locator(".browser-lab-math-rendered");
  await expect(rendered).toHaveText("Rendered inline math 1: x^2");
  await expect(editor.locator("[data-mdw-math-source]")).toHaveText("$x^2$");
  expect(await getMarkdown(labPage, deferredId)).toBe(markdown);

  const target = (await getMathSnapshot(labPage, deferredId)).nodes[0]!;
  expect(await selectMath(labPage, deferredId, target)).toBe(true);
  const copied = await copyEditorSelection(labPage, deferredId);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe("$x^2$");
  expect(copied.plain).toBe("$x^2$");
  expect(copied.html).toContain('data-mdw-math-kind="inline"');
  expect(copied.html).toContain("$x^2$");
  expect(copied.html).not.toContain("browser-lab-math-rendered");
  expect(copied.html).not.toContain("data-mdw-math-preview");
  expect(copied.html).not.toContain("<button");

  const syncId = "math-sync-preview";
  await mountEditor(labPage, {
    extensionMode: "math",
    id: syncId,
    markdown: "$sync$",
    mathRendererMode: "sync",
  });
  await waitForMathStatus(labPage, syncId, "rendered");
  expect(await getMathRendererCalls(labPage, syncId)).toEqual([{
    aborted: false,
    id: 1,
    kind: "inline",
    settled: "resolved",
    source: "sync",
  }]);
  expect(await getMarkdown(labPage, syncId)).toBe("$sync$");
});

test("@required math renderer failures retain source and a deferred retry starts a fresh generation", async ({ labPage }) => {
  for (const [id, mode, settlement] of [
    ["math-throw", "throw", "threw"],
    ["math-reject", "reject", "rejected"],
  ] as const) {
    await mountEditor(labPage, {
      extensionMode: "math",
      id,
      markdown: "$failure$",
      mathRendererMode: mode,
    });
    await waitForMathStatus(labPage, id, "error");
    expect((await getMathSnapshot(labPage, id)).nodes[0]?.render).toEqual({
      enabled: true,
      errorCode: "renderer-failed",
      status: "error",
    });
    expect(await getMathRendererCalls(labPage, id)).toEqual([{
      aborted: true,
      id: 1,
      kind: "inline",
      settled: settlement,
      source: "failure",
    }]);
    await expect(editorLocator(labPage, id).locator("[data-mdw-math-source]"))
      .toHaveText("$failure$");
    expect((await getEditorEvents(labPage, id)).log).toContainEqual(expect.objectContaining({
      code: "EXTENSION_MATH_RENDERER_FAILED",
      type: "error",
    }));
  }

  const retryId = "math-deferred-retry";
  await mountEditor(labPage, {
    extensionMode: "math",
    id: retryId,
    markdown: "$retry$",
    mathRendererMode: "deferred",
  });
  await waitForMathCalls(labPage, retryId, 1);
  expect(await settleMathRenderer(labPage, retryId, {
    callId: 1,
    outcome: "reject",
  })).toBe(true);
  await waitForMathStatus(labPage, retryId, "error");
  const failed = (await getMathSnapshot(labPage, retryId)).nodes[0]!;
  expect(await runMathCommand(labPage, retryId, {
    target: failed,
    type: "retryPreview",
  })).toBe(true);
  await waitForMathCalls(labPage, retryId, 2);
  expect(await settleMathRenderer(labPage, retryId, { callId: 2 })).toBe(true);
  await waitForMathStatus(labPage, retryId, "rendered");
  expect(await getMathRendererCalls(labPage, retryId)).toEqual([
    {
      aborted: true,
      id: 1,
      kind: "inline",
      settled: "rejected",
      source: "retry",
    },
    {
      aborted: false,
      id: 2,
      kind: "inline",
      settled: "resolved",
      source: "retry",
    },
  ]);
});

test("@required stale math renders abort across update, removal, and editor destruction", async ({ labPage }) => {
  const id = "math-render-lifecycle";
  await mountEditor(labPage, {
    extensionMode: "math",
    id,
    markdown: "$x$",
    mathRendererMode: "deferred",
  });
  await waitForMathCalls(labPage, id, 1);
  const x = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    source: "y",
    target: x,
    type: "update",
  })).toBe(true);
  await waitForMathCalls(labPage, id, 2);
  expect((await getMathRendererCalls(labPage, id))[0]?.aborted).toBe(true);

  expect(await settleMathRenderer(labPage, id, { callId: 1 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(editorLocator(labPage, id).locator(".browser-lab-math-rendered"))
    .toHaveCount(0);
  expect((await getMathSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("rendering");

  expect(await settleMathRenderer(labPage, id, { callId: 2 })).toBe(true);
  await waitForMathStatus(labPage, id, "rendered");
  await expect(editorLocator(labPage, id).locator(".browser-lab-math-rendered"))
    .toHaveText("Rendered inline math 2: y");

  const y = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    source: "z",
    target: y,
    type: "update",
  })).toBe(true);
  await waitForMathCalls(labPage, id, 3);
  const z = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    target: z,
    type: "remove",
  })).toBe(true);
  expect((await getMathRendererCalls(labPage, id))[2]?.aborted).toBe(true);
  expect(await settleMathRenderer(labPage, id, { callId: 3 })).toBe(true);
  await settleEditor(labPage, id);
  expect((await getMathSnapshot(labPage, id)).nodes).toEqual([]);
  await expect(editorLocator(labPage, id).locator("[data-mdw-math]"))
    .toHaveCount(0);

  expect(await runMathCommand(labPage, id, {
    source: "destroyed",
    type: "insertInline",
  })).toBe(true);
  await waitForMathCalls(labPage, id, 4);
  expect(await destroyEditorOnly(labPage, id)).toBe(true);
  expect((await getMathRendererCalls(labPage, id))[3]?.aborted).toBe(true);
  expect(await settleMathRenderer(labPage, id, { callId: 4 })).toBe(true);
  await labPage.evaluate(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(editorLocator(labPage, id).locator(".browser-lab-math-rendered"))
    .toHaveCount(0);
});

test("@required math clamps unsafe, wrong-document, and connected renderer output", async ({ labPage }) => {
  for (const [mode, errorCode, extensionCode] of [
    ["unsafe", "unsafe-output", "EXTENSION_MATH_UNSAFE_RENDERER_OUTPUT"],
    ["wrong-document", "wrong-document", "EXTENSION_MATH_INVALID_RENDERER_OUTPUT"],
    ["connected", "connected-output", "EXTENSION_MATH_INVALID_RENDERER_OUTPUT"],
  ] as const) {
    const id = `math-clamp-${mode}`;
    await mountEditor(labPage, {
      extensionMode: "math",
      id,
      markdown: "$hostile$",
      mathRendererMode: mode,
    });
    await waitForMathStatus(labPage, id, "error");
    expect((await getMathSnapshot(labPage, id)).nodes[0]?.render).toEqual({
      enabled: true,
      errorCode,
      status: "error",
    });
    await expect(editorLocator(labPage, id).locator("[data-mdw-math-source]"))
      .toHaveText("$hostile$");
    await expect(editorLocator(labPage, id).locator("[data-mdw-math-preview]"))
      .toBeEmpty();
    expect(await getMarkdown(labPage, id)).toBe("$hostile$");
    expect((await getEditorEvents(labPage, id)).log).toContainEqual(expect.objectContaining({
      code: extensionCode,
      type: "error",
    }));
  }

  expect(await labPage.evaluate(() => (
    window as typeof window & { __markoraUnsafeMathRenderer?: boolean }
  ).__markoraUnsafeMathRenderer)).toBeUndefined();
  await expect(labPage.locator("[data-e2e-math-renderer-artifact]"))
    .toHaveCount(0);
});

test("@required math commands and host edits are stale-safe, undoable, and read-only guarded", async ({ labPage }) => {
  const id = "math-commands-edits";
  await mountEditor(labPage, {
    extensionMode: "math",
    id,
    initialSelection: "end",
    markdown: "",
    mathRendererMode: "missing",
  });

  expect(await runMathCommand(labPage, id, {
    source: "x",
    type: "insertInline",
  })).toBe(true);
  const x = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    source: "x",
    target: x,
    type: "update",
  })).toBe(false);
  expect(await runMathCommand(labPage, id, {
    source: "y",
    target: x,
    type: "update",
  })).toBe(true);
  expect(await runMathCommand(labPage, id, {
    source: "stale",
    target: x,
    type: "update",
  })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("$y$");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("$x$");
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);

  let target: LabMathNodeTarget = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    kind: "block",
    target,
    type: "convert",
  })).toBe(true);
  target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(target.kind).toBe("block");
  expect(await runMathCommand(labPage, id, {
    kind: "inline",
    target,
    type: "convert",
  })).toBe(true);
  target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await runMathCommand(labPage, id, {
    target,
    type: "remove",
  })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);

  target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await selectMath(labPage, id, target)).toBe(true);
  let editButton = editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
  });
  await editButton.click();
  expect(await getPendingMathEdit(labPage, id)).toEqual({
    kind: "inline",
    position: target.position,
    render: { enabled: false, errorCode: null, status: "source" },
    source: "y",
  });
  expect(await updatePendingMathEdit(labPage, id, "z")).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("$z$");

  target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await selectMath(labPage, id, target)).toBe(true);
  editButton = editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
  });
  await editButton.click();
  expect(await reconcileEditor(labPage, id, "$external$")).toMatchObject({
    changed: true,
  });
  expect(await updatePendingMathEdit(labPage, id, "stale")).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("$external$");

  target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await selectMath(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
  }).click();
  expect(await convertPendingMathEdit(labPage, id, "block")).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("$$\nexternal\n$$");

  const block = (await getMathSnapshot(labPage, id)).nodes[0]!;
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
  }).click();
  expect((await getPendingMathEdit(labPage, id))?.kind).toBe("block");
  await updateEditorOptions(labPage, id, { editable: false });
  await expect(editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
  })).toBeDisabled();
  expect(await removePendingMathEdit(labPage, id)).toBe(false);
  expect(await runMathCommand(labPage, id, {
    source: "blocked",
    target: block,
    type: "update",
  })).toBe(false);
  await updateEditorOptions(labPage, id, { editable: true });
  expect(await removePendingMathEdit(labPage, id)).toBe(true);
  expect((await getMathSnapshot(labPage, id)).nodes).toEqual([]);
});

test("@required localized RTL math actions are keyboard operable and accessible", async ({ labPage }) => {
  const id = "math-rtl-localized";
  await mountEditor(labPage, {
    direction: "rtl",
    extensionMode: "math",
    id,
    language: "ar",
    markdown: "$x+y$",
    mathMessages: {
      editSource: "تحرير الصيغة",
      inlineKindLabel: "صيغة مضمنة",
      inlineSourceLabel: "مصدر الصيغة المضمنة",
      previewLabel: "معاينة الصيغة",
      retryPreview: "إعادة المحاولة",
      showPreview: "إظهار المعاينة",
      showSource: "إظهار المصدر",
    },
    mathRendererMode: "sync",
    root: "shadow",
  });
  await waitForMathStatus(labPage, id, "rendered");
  const target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await selectMath(labPage, id, target)).toBe(true);

  const editor = editorLocator(labPage, id);
  const marker = editor.locator('[data-mdw-math-kind="inline"]');
  await expect(editor.getByRole("group", { name: "صيغة مضمنة" }))
    .toBeVisible();
  await expect(marker.getByRole("math", { name: "مصدر الصيغة المضمنة" }))
    .toBeAttached();
  await expect(marker.locator(".mdw-math__kind")).toHaveText("صيغة مضمنة");
  expect(await marker.evaluate((element) => getComputedStyle(element).direction))
    .toBe("rtl");

  const edit = marker.getByRole("button", { name: "تحرير الصيغة" });
  await edit.focus();
  await labPage.keyboard.press("Enter");
  expect((await getPendingMathEdit(labPage, id))?.source).toBe("x+y");

  const toggle = marker.getByRole("button", { name: "إظهار المصدر" });
  await toggle.focus();
  await labPage.keyboard.press("Space");
  expect((await getMathSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("source");
  await expect(marker.getByRole("button", { name: "إظهار المعاينة" }))
    .toBeFocused();
  await labPage.keyboard.press("Enter");
  await waitForMathStatus(labPage, id, "rendered");

  const reflow = await marker.evaluate((element) => {
    const math = element as HTMLElement;
    math.style.fontSize = "200%";
    math.style.inlineSize = "220px";
    const actions = math.querySelector<HTMLElement>(".mdw-math__actions")!;
    return {
      actionsClientWidth: actions.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      markerClientWidth: math.clientWidth,
      markerScrollWidth: math.scrollWidth,
    };
  });
  expect(reflow.actionsScrollWidth).toBeLessThanOrEqual(reflow.actionsClientWidth);
  expect(reflow.markerScrollWidth).toBeLessThanOrEqual(reflow.markerClientWidth);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required Chromium CDP invokes math editing and copies source-only Markdown", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP input commands.");

  const id = "math-cdp";
  await mountEditor(labPage, {
    extensionMode: "math",
    id,
    markdown: "$cdp$",
    mathRendererMode: "sync",
  });
  await waitForMathStatus(labPage, id, "rendered");
  const target = (await getMathSnapshot(labPage, id)).nodes[0]!;
  expect(await selectMath(labPage, id, target)).toBe(true);
  const edit = editorLocator(labPage, id).getByRole("button", {
    name: "Edit math source",
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
    expect((await getPendingMathEdit(labPage, id))?.source).toBe("cdp");

    expect(await selectMath(labPage, id, target)).toBe(true);
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
      const targetWindow = window as typeof window & {
        __markoraMathCdpCopy?: { html: string; markdown: string; plain: string };
      };
      delete targetWindow.__markoraMathCdpCopy;
      section.addEventListener("copy", (rawEvent) => {
        const transfer = (rawEvent as ClipboardEvent).clipboardData;
        targetWindow.__markoraMathCdpCopy = {
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
      __markoraMathCdpCopy?: { html: string; markdown: string; plain: string };
    }
  ).__markoraMathCdpCopy);
  expect(copied).toMatchObject({ markdown: "$cdp$", plain: "$cdp$" });
  expect(copied?.html).toContain("$cdp$");
  expect(copied?.html).not.toContain("browser-lab-math-rendered");
});
