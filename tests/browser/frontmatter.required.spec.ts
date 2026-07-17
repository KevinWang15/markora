import AxeBuilder from "@axe-core/playwright";
import {
  copyEditorSelection,
  editorLocator,
  expect,
  focusEditor,
  getExtensionSnapshot,
  getMarkdown,
  mountEditor,
  reconcileEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const EXACT_SOURCE = "\uFEFF---\r\ntitle: Exact\r\nanchor: &base value\r\ncopy: *base\r\n...";
const FIRST_SOURCE = "---\ntitle: First\n---";
const SECOND_SOURCE = "---\ntitle: Second\n---";

test("@required front matter preserves exact source in root and minimal embedded editors", async ({ labPage }) => {
  for (const [id, entry, root] of [
    ["frontmatter-root", "root", "document"],
    ["frontmatter-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      extensionMode: "frontmatter",
      id,
      initialSelection: "all",
      markdown: `${EXACT_SOURCE}\r\nBody`,
      root,
    });

    const editor = editorLocator(labPage, id);
    const sourceRegion = editor.getByRole("region", { name: "YAML front matter source" });
    await expect(sourceRegion).toContainText("title: Exact");
    await expect(sourceRegion.locator("[data-mdw-frontmatter-source]")).toHaveText(EXACT_SOURCE);
    expect(await getMarkdown(labPage, id)).toBe(`${EXACT_SOURCE}\n\nBody`);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-frontmatter",
      version: "0.0.1",
    });

    const snapshot = await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.frontmatterSnapshot(editorId),
      id,
    );
    expect(snapshot).toEqual({ diagnostics: [], source: EXACT_SOURCE });

    const copied = await copyEditorSelection(labPage, id);
    expect(copied.defaultPrevented).toBe(true);
    expect(copied.markdown).toBe(`${EXACT_SOURCE}\n\nBody`);
    expect(copied.plain).toContain("title: Exact");

    expect(await resetEditor(labPage, id, `${EXACT_SOURCE}\nReset body`))
      .toBe(`${EXACT_SOURCE}\n\nReset body`);
    const reconciled = await reconcileEditor(labPage, id, `${EXACT_SOURCE}\r\nReconciled body`);
    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.markdown).toBe(`${EXACT_SOURCE}\n\nReconciled body`);
  }
});

test("@required front matter commands and localized host editing are guarded, stale-safe, and accessible", async ({ labPage }) => {
  const body = "> Body";
  const id = "frontmatter-host-edit";
  await mountEditor(labPage, {
    extensionMode: "frontmatter",
    frontmatterMessages: {
      editSource: "Edit metadata",
      insertFrontmatter: "Add metadata",
      kindLabel: "Document metadata",
      sourceLabel: "Document metadata source",
    },
    id,
    markdown: body,
    root: "shadow",
  });

  const command = (request:
    | { type: "insert"; source?: string }
    | { type: "remove" }
    | { type: "update"; source: string }) => labPage.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.frontmatterCommand(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );

  const insertAction = labPage.getByRole("button", { name: "Add metadata" });
  await expect(insertAction).toBeEnabled();
  expect(await command({ source: FIRST_SOURCE, type: "insert" })).toBe(true);
  expect(await command({ source: FIRST_SOURCE, type: "insert" })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);
  await expect(insertAction).toBeDisabled();

  const editor = editorLocator(labPage, id);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });
  expect(await command({ source: SECOND_SOURCE, type: "update" })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
    }));
  });

  expect(await command({ source: FIRST_SOURCE, type: "update" })).toBe(false);
  expect(await command({ source: SECOND_SOURCE, type: "update" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(`${SECOND_SOURCE}\n\n${body}`);

  const region = editor.getByRole("region", { name: "Document metadata source" });
  await expect(region).toHaveAttribute("data-mdw-frontmatter-label", "Document metadata");
  const edit = region.getByRole("button", { name: "Edit metadata" });
  await edit.focus();
  await labPage.keyboard.press("Enter");
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.pendingFrontmatterEdit(editorId),
    id,
  )).toEqual({ diagnostics: [], source: SECOND_SOURCE });

  const externalSource = "---\ntitle: External\n---";
  await reconcileEditor(labPage, id, `${externalSource}\n\n${body}`);
  expect(await labPage.evaluate(
    ({ editorId, source }) => (
      window.__MARKORA_BROWSER_LAB__!.frontmatterEditUpdate(editorId, source)
    ),
    { editorId: id, source: "---\ntitle: Stale\n---" },
  )).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(`${externalSource}\n\n${body}`);

  await edit.focus();
  await labPage.keyboard.press("Enter");
  expect(await labPage.evaluate(
    ({ editorId, source }) => (
      window.__MARKORA_BROWSER_LAB__!.frontmatterEditUpdate(editorId, source)
    ),
    { editorId: id, source: FIRST_SOURCE },
  )).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);

  await edit.focus();
  await labPage.keyboard.press("ArrowDown");
  const boundarySnapshot = await snapshotEditor(labPage, id);
  expect(boundarySnapshot.prosemirrorFocused).toBe(true);
  expect(boundarySnapshot.selection.anchor).toBeGreaterThan(1);
  expect(boundarySnapshot.selection.head).toBe(boundarySnapshot.selection.anchor);
  expect(boundarySnapshot.markdown).toBe(`${FIRST_SOURCE}\n\n${body}`);
  await labPage.keyboard.insertText("x");
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n> xBody`);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);

  await updateEditorOptions(labPage, id, { editable: false });
  await expect(edit).toBeDisabled();
  expect(await command({ type: "remove" })).toBe(false);
  await updateEditorOptions(labPage, id, { editable: true });
  await expect(edit).toBeEnabled();

  const reflow = await region.evaluate((element) => {
    element.style.inlineSize = "220px";
    element.style.fontSize = "200%";
    const header = element.querySelector<HTMLElement>(".mdw-frontmatter__header")!;
    const button = element.querySelector<HTMLButtonElement>(".mdw-frontmatter__edit")!;
    const headerRect = header.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    return {
      buttonBottom: buttonRect.bottom,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      buttonTop: buttonRect.top,
      headerBottom: headerRect.bottom,
      headerClientWidth: header.clientWidth,
      headerLeft: headerRect.left,
      headerRight: headerRect.right,
      headerScrollWidth: header.scrollWidth,
      headerTop: headerRect.top,
    };
  });
  expect(reflow.headerScrollWidth).toBeLessThanOrEqual(reflow.headerClientWidth);
  expect(reflow.buttonLeft).toBeGreaterThanOrEqual(reflow.headerLeft);
  expect(reflow.buttonRight).toBeLessThanOrEqual(reflow.headerRight);
  expect(reflow.buttonTop).toBeGreaterThanOrEqual(reflow.headerTop);
  expect(reflow.buttonBottom).toBeLessThanOrEqual(reflow.headerBottom);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);

  expect(await command({ type: "remove" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(body);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(`${FIRST_SOURCE}\n\n${body}`);
});

test("@required Chromium CDP invokes front matter editing and copies its exact Markdown", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP input commands.");

  const id = "frontmatter-cdp";
  await mountEditor(labPage, {
    extensionMode: "frontmatter",
    id,
    initialSelection: "all",
    markdown: `${EXACT_SOURCE}\r\nBody`,
  });
  const edit = editorLocator(labPage, id).getByRole("button", {
    name: "Edit front matter source",
  });
  const editBox = await edit.boundingBox();
  expect(editBox).not.toBeNull();

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: editBox!.x + editBox!.width / 2,
      y: editBox!.y + editBox!.height / 2,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: editBox!.x + editBox!.width / 2,
      y: editBox!.y + editBox!.height / 2,
    });
    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.pendingFrontmatterEdit(editorId)?.source,
      id,
    )).toBe(EXACT_SOURCE);

    await focusEditor(labPage, id, "all");
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
      const target = window as typeof window & { __markoraFrontmatterCdpCopy?: string };
      delete target.__markoraFrontmatterCdpCopy;
      section.addEventListener("copy", (rawEvent) => {
        target.__markoraFrontmatterCdpCopy = (rawEvent as ClipboardEvent)
          .clipboardData?.getData("text/markdown") ?? "";
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
  expect(await labPage.evaluate(() => (
    window as typeof window & { __markoraFrontmatterCdpCopy?: string }
  ).__markoraFrontmatterCdpCopy)).toBe(`${EXACT_SOURCE}\n\nBody`);
  await settleEditor(labPage, id);
});
