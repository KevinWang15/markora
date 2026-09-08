import AxeBuilder from "@axe-core/playwright";
import { chromiumTest,
  copyEditorSelection,
  dispatchTransfer,
  editorLocator,
  expect,
  focusEditor,
  getExtensionSnapshot,
  getMarkdown,
  getTocSnapshot,
  getTocState,
  mountEditor,
  reconcileEditor,
  resetEditor,
  runEditorCommand,
  runTocCommand,
  selectToc,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const PARITY_SOURCE = [
  "Preamble",
  "[toc]",
  "# Alpha",
  "",
  "### Deep **bold**",
  "",
  "## Middle",
  "",
  "   [ToC]\t",
  "",
  "# Duplicate",
  "",
  "# Duplicate",
  "",
  "Inline [TOC] marker.",
  "",
  "\\[TOC]",
  "",
  "`[TOC]`",
  "",
  "```md",
  "[TOC]",
  "```",
  "",
  "    [TOC]",
  "",
  "> [TOC]",
  "",
  "- [TOC]",
  "",
  "\u00a0[TOC]",
  "",
  "[ TOC ]",
].join("\n");

test("@required TOC parsing, negatives, canonical Markdown, reset, and reconcile match in root and minimal embeds", async ({
  labPage,
}) => {
  for (const [id, entry, root] of [
    ["toc-root-document", "root", "document"],
    ["toc-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      extensionMode: "toc",
      id,
      markdown: PARITY_SOURCE,
      root,
    });

    const editor = editorLocator(labPage, id);
    const navs = editor.locator(":scope > nav[data-mdw-toc]");
    await expect(navs).toHaveCount(2);
    await expect(navs.nth(0).locator("[data-mdw-toc-entry]")).toHaveCount(5);
    await expect(navs.nth(1).locator("[data-mdw-toc-entry]")).toHaveCount(5);
    await expect(editor.locator(":scope > blockquote")).toHaveCount(1);
    await expect(editor.locator(":scope > ul, :scope > ol")).toHaveCount(1);
    await expect(editor.locator(
      entry === "root" ? ":scope > .mdw-code-block" : ":scope > pre",
    )).toHaveCount(2);

    const snapshot = await getTocSnapshot(labPage, id);
    expect(snapshot.tocs).toHaveLength(2);
    expect(snapshot.headings.map(({ label, level }) => ({ label, level })))
      .toEqual([
        { label: "Alpha", level: 1 },
        { label: "Deep bold", level: 3 },
        { label: "Middle", level: 2 },
        { label: "Duplicate", level: 1 },
        { label: "Duplicate", level: 1 },
      ]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-toc",
      version: "0.0.1",
    });

    const canonical = await getMarkdown(labPage, id);
    expect(canonical).toContain("Preamble\n\n[TOC]\n\n# Alpha");
    expect(canonical).toContain("## Middle\n\n[TOC]\n\n# Duplicate");
    expect(canonical).toContain("Inline \\[TOC\\] marker.");
    expect(canonical).toContain("> \\[TOC\\]");
    expect(canonical).toContain("* \\[TOC\\]");
    expect(canonical).not.toContain("[toc]");
    expect(canonical).not.toContain("[ToC]");

    expect(await resetEditor(labPage, id, canonical)).toBe(canonical);
    await settleEditor(labPage, id);
    expect((await getTocSnapshot(labPage, id)).tocs).toHaveLength(2);
    await expect(navs.nth(0).locator("[data-mdw-toc-entry]")).toHaveCount(5);

    const reconciled = await reconcileEditor(
      labPage,
      id,
      canonical.replace("# Alpha", "# Reconciled Alpha"),
    );
    expect(reconciled.changed).toBe(true);
    await settleEditor(labPage, id);
    expect((await getTocSnapshot(labPage, id)).headings[0]?.label).toBe(
      "Reconciled Alpha",
    );
    await expect(
      navs.nth(0).locator('[data-mdw-toc-entry="1"]'),
    ).toHaveText("Reconciled Alpha");
  }
});

test("@required TOC commands and live outlines are guarded, one-step undoable, and avoid position-only repaint", async ({
  labPage,
}) => {
  const id = "toc-commands-live";
  await mountEditor(labPage, {
    extensionMode: "toc",
    id,
    markdown: "Preamble\n\n# Alpha\n\nParagraph",
  });

  expect(await getTocState(labPage, id, { type: "canInsert" })).toBe(true);
  expect(await getTocState(labPage, id, { type: "canRemove" })).toBe(false);
  await focusEditor(labPage, id, "start");
  expect(await runTocCommand(labPage, id, { type: "insert" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getTocState(labPage, id, { type: "isActive" })).toBe(true);
  expect(await getTocState(labPage, id, { type: "canInsert" })).toBe(false);
  expect(await getTocState(labPage, id, { type: "canRemove" })).toBe(true);

  const beforeNoop = await snapshotEditor(labPage, id);
  expect(await runTocCommand(labPage, id, { type: "insert" })).toBe(false);
  expect(await snapshotEditor(labPage, id)).toEqual(beforeNoop);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator('[data-mdw-toc-entry="1"]')).toHaveText("Alpha");
  await labPage.evaluate((editorId) => {
    const entry = document.querySelector(
      `[data-e2e-editor="${editorId}"] [data-mdw-toc-entry="1"]`,
    );
    (window as typeof window & { __markoraStableTocEntry?: Element })
      .__markoraStableTocEntry = entry ?? undefined;
  }, id);

  expect(
    await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(
        editorId,
        "Preamble",
        "end",
      ),
      id,
    ),
  ).toBe(true);
  await labPage.keyboard.type(" updated");
  await settleEditor(labPage, id);
  expect(
    await labPage.evaluate((editorId) => (
      (window as typeof window & { __markoraStableTocEntry?: Element })
        .__markoraStableTocEntry
      === document.querySelector(
        `[data-e2e-editor="${editorId}"] [data-mdw-toc-entry="1"]`,
      )
    ), id),
  ).toBe(true);

  expect(
    await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(
        editorId,
        "Alpha",
      ),
      id,
    ),
  ).toBe(true);
  await labPage.keyboard.type("Updated");
  await settleEditor(labPage, id);
  await expect(editor.locator('[data-mdw-toc-entry="1"]')).toHaveText("Updated");

  expect(
    await runEditorCommand(labPage, id, { level: 3, type: "setHeading" }),
  ).toBe(true);
  await expect(editor.locator('[data-mdw-toc-entry="1"]')).toHaveAttribute(
    "data-mdw-toc-level",
    "3",
  );
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await expect(editor.locator('[data-mdw-toc-entry="1"]')).toHaveAttribute(
    "data-mdw-toc-level",
    "1",
  );
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);

  expect((await reconcileEditor(
    labPage,
    id,
    "[TOC]\n\n# Reconciled\n\n## Child",
  )).changed).toBe(true);
  await settleEditor(labPage, id);
  await expect(editor.locator("[data-mdw-toc-entry]")).toHaveText([
    "Reconciled",
    "Child",
  ]);

  expect(await resetEditor(
    labPage,
    id,
    "[TOC]\n\n# Reset\n\nTrailing paragraph",
  )).toBe(
    "[TOC]\n\n# Reset\n\nTrailing paragraph",
  );
  await settleEditor(labPage, id);
  await expect(editor.locator('[data-mdw-toc-entry="1"]')).toHaveText("Reset");
  expect(
    await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(
        editorId,
        "Trailing paragraph",
        "start",
      ),
      id,
    ),
  ).toBe(true);

  const navigationEntry = editor.locator('[data-mdw-toc-entry="1"]');
  await navigationEntry.focus();

  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });
  const beforeCompositionNavigation = await snapshotEditor(labPage, id);
  const markdownBeforeCompositionNavigation = await getMarkdown(labPage, id);
  const focusBeforeCompositionNavigation = await labPage.evaluate((editorId) => {
    const editorElement = document.querySelector(
      `[data-e2e-editor="${editorId}"] .ProseMirror`,
    );
    const entry = editorElement?.querySelector('[data-mdw-toc-entry="1"]');
    const active = document.activeElement;
    return {
      isEditor: active === editorElement,
      isEntry: active === entry,
      tag: active?.tagName ?? null,
    };
  }, id);
  await navigationEntry.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Enter",
    }));
  });
  const afterCompositionKeyNavigation = await snapshotEditor(labPage, id);
  expect(afterCompositionKeyNavigation.selection).toEqual(
    beforeCompositionNavigation.selection,
  );
  expect(afterCompositionKeyNavigation.transactionCount).toBe(
    beforeCompositionNavigation.transactionCount,
  );
  await navigationEntry.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
  });
  await settleEditor(labPage, id);
  const afterCompositionPointerNavigation = await snapshotEditor(labPage, id);
  expect(afterCompositionPointerNavigation.selection).toEqual(
    beforeCompositionNavigation.selection,
  );
  expect(afterCompositionPointerNavigation.transactionCount).toBe(
    beforeCompositionNavigation.transactionCount,
  );
  expect(await getMarkdown(labPage, id)).toBe(
    markdownBeforeCompositionNavigation,
  );
  expect(await labPage.evaluate(() => window.location.hash)).toBe("");
  expect(await labPage.evaluate((editorId) => {
    const editorElement = document.querySelector(
      `[data-e2e-editor="${editorId}"] .ProseMirror`,
    );
    const entry = editorElement?.querySelector('[data-mdw-toc-entry="1"]');
    const active = document.activeElement;
    return {
      isEditor: active === editorElement,
      isEntry: active === entry,
      tag: active?.tagName ?? null,
    };
  }, id)).toEqual(focusBeforeCompositionNavigation);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
    }));
  });

  expect(await selectToc(labPage, id)).toBe(true);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });
  expect(await runTocCommand(labPage, id, { type: "remove" })).toBe(false);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
    }));
  });

  await updateEditorOptions(labPage, id, { editable: false });
  expect(await runTocCommand(labPage, id, { type: "remove" })).toBe(false);
  await updateEditorOptions(labPage, id, { editable: true });
  expect(await selectToc(labPage, id)).toBe(true);

  const beforeRemove = await snapshotEditor(labPage, id);
  expect(await runTocCommand(labPage, id, { type: "remove" })).toBe(true);
  const afterRemove = await snapshotEditor(labPage, id);
  expect(afterRemove.transactionCount).toBe(beforeRemove.transactionCount + 1);
  expect((await getTocSnapshot(labPage, id)).tocs).toEqual([]);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect((await getTocSnapshot(labPage, id)).tocs).toHaveLength(1);
  expect(await getTocState(labPage, id, { type: "isActive" })).toBe(true);
});

test("@required TOC clipboard data contains only the marker and Markdown or rich paste restores semantics", async ({
  labPage,
}) => {
  const id = "toc-clipboard";
  await mountEditor(labPage, {
    extensionMode: "toc",
    id,
    markdown: "[TOC]\n\n# Secret generated label\n\n## Child label",
  });
  expect(await selectToc(labPage, id)).toBe(true);

  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe("[TOC]");
  expect(copied.plain).toBe("[TOC]");
  expect(copied.html).toContain("data-mdw-toc");
  expect(copied.html).not.toContain("data-mdw-toc-entry");
  expect(copied.html).not.toContain("<nav");
  expect(copied.html).not.toContain("<ol");
  expect(copied.html).not.toContain("<button");
  expect(copied.html).not.toContain("Secret generated label");
  expect(copied.html).not.toContain("Child label");

  await focusEditor(labPage, id, "start");
  await labPage.keyboard.press("ControlOrMeta+A");
  await settleEditor(labPage, id);
  const wholeDocument = await copyEditorSelection(labPage, id);
  expect(wholeDocument.defaultPrevented).toBe(true);
  expect(wholeDocument.markdown).toBe(
    "[TOC]\n\n# Secret generated label\n\n## Child label",
  );
  for (const representation of [
    wholeDocument.html,
    wholeDocument.markdown,
    wholeDocument.plain,
  ]) {
    expect(representation.split("Secret generated label")).toHaveLength(2);
    expect(representation.split("Child label")).toHaveLength(2);
  }
  expect(wholeDocument.html).toContain("data-mdw-toc");
  expect(wholeDocument.html).not.toContain("data-mdw-toc-entry");
  expect(wholeDocument.html).not.toContain("data-mdw-toc-occurrence");
  expect(wholeDocument.html).not.toContain("<nav");
  expect(wholeDocument.html).not.toContain("<ol");
  expect(wholeDocument.html).not.toContain("<button");
  expect(wholeDocument.html).not.toMatch(/\sid=/);

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  expect(await runEditorCommand(labPage, id, {
    text: copied.markdown,
    type: "pasteMarkdown",
  })).toBe(true);
  expect((await getTocSnapshot(labPage, id)).tocs).toHaveLength(1);
  expect(await getMarkdown(labPage, id)).toBe("[TOC]");

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  const richPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: copied.html,
    plain: copied.plain,
  });
  expect(richPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect((await getTocSnapshot(labPage, id)).tocs).toHaveLength(1);
  expect(await getMarkdown(labPage, id)).toBe("[TOC]");

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  expect(await runEditorCommand(labPage, id, {
    text: copied.plain,
    type: "pastePlainText",
  })).toBe(true);
  expect((await getTocSnapshot(labPage, id)).tocs).toEqual([]);
  expect(await getMarkdown(labPage, id)).toBe("\\[TOC\\]");
});

test("@required localized RTL Shadow DOM TOC navigation handles duplicates by keyboard without hashes and passes Axe", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "toc-a11y-rtl-shadow";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  if (cdp) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "forced-colors", value: "active" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
  } else {
    await labPage.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
  }
  await mountEditor(labPage, {
    direction: "rtl",
    entry: "minimal",
    extensionMode: "toc",
    id,
    language: "ar",
    markdown: "[TOC]",
    motion: "reduce",
    root: "shadow",
    theme: "contrast",
    tocMessages: {
      emptyState: "لا توجد عناوين",
      goToHeadingLabel: "انتقل إلى العنوان",
      navigationLabel: "فهرس المستند",
    },
  });

  const editor = editorLocator(labPage, id);
  const nav = editor.getByRole("navigation", { name: "فهرس المستند" });
  await expect(nav).toBeVisible();
  await expect(nav.locator("[data-mdw-toc-source]")).toHaveText("[TOC]");
  await expect(nav.locator("[data-mdw-toc-empty]")).toHaveText(
    "لا توجد عناوين",
  );

  expect((await reconcileEditor(labPage, id, [
    "[TOC]",
    "",
    "# مكرر",
    "",
    "## وسط",
    "",
    "### عميق",
    "",
    "# مكرر",
  ].join("\n"))).changed).toBe(true);
  await settleEditor(labPage, id);

  const entries = nav.locator("[data-mdw-toc-entry]");
  await expect(entries).toHaveCount(4);
  await expect(entries).toHaveText(["مكرر", "وسط", "عميق", "مكرر"]);
  await expect.poll(() => labPage.evaluate(() => ({
    forcedColors: matchMedia("(forced-colors: active)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }))).toEqual({ forcedColors: true, reducedMotion: true });
  await entries.nth(0).evaluate((element) => {
    element.style.transition = "color 60s linear";
  });
  await expect.poll(() => entries.nth(0).evaluate((element) => (
    getComputedStyle(element).transitionProperty
  ))).toBe("none");
  const rootList = nav.locator('ol[data-mdw-toc-list="root"]');
  await expect(rootList.locator(":scope > li")).toHaveCount(2);
  await expect(rootList.locator('ol[data-mdw-toc-list="nested"]')).toHaveCount(2);

  const environment = await nav.evaluate((element) => {
    const nested = element.querySelector<HTMLElement>(
      'ol[data-mdw-toc-list="nested"]',
    )!;
    return {
      borderInlineStartWidth: getComputedStyle(nested).borderInlineStartWidth,
      direction: getComputedStyle(element).direction,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  expect(environment.direction).toBe("rtl");
  expect(environment.borderInlineStartWidth).toBe("1px");
  expect(environment.scrollWidth).toBeLessThanOrEqual(environment.clientWidth);

  // WebKit can match forced-colors on macOS without applying a Windows
  // forced-colors palette. Chromium and Firefox verify the shipped system
  // color overrides; WebKit retains that platform capability boundary.
  if (browserName !== "webkit") {
    const forcedPresentation = await nav.evaluate((element) => {
      const systemColor = (value: string, property: "backgroundColor" | "color") => {
        const probe = element.ownerDocument.createElement("span");
        probe.style.forcedColorAdjust = "none";
        probe.style[property] = value;
        element.append(probe);
        const resolved = getComputedStyle(probe)[property];
        probe.remove();
        return resolved;
      };
      const entry = element.querySelector<HTMLElement>("[data-mdw-toc-entry]")!;
      const nested = element.querySelector<HTMLElement>(
        'ol[data-mdw-toc-list="nested"]',
      )!;
      const style = getComputedStyle(element);

      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        canvas: systemColor("Canvas", "backgroundColor"),
        canvasText: systemColor("CanvasText", "color"),
        entry: getComputedStyle(entry).color,
        grayText: systemColor("GrayText", "color"),
        linkText: systemColor("LinkText", "color"),
        nestedGuide: getComputedStyle(nested).borderInlineStartColor,
      };
    });
    expect(forcedPresentation).toEqual({
      background: forcedPresentation.canvas,
      border: forcedPresentation.canvasText,
      canvas: forcedPresentation.canvas,
      canvasText: forcedPresentation.canvasText,
      entry: forcedPresentation.linkText,
      grayText: forcedPresentation.grayText,
      linkText: forcedPresentation.linkText,
      nestedGuide: forcedPresentation.grayText,
    });
  }

  const snapshot = await getTocSnapshot(labPage, id);
  await entries.nth(0).focus();
  await labPage.keyboard.press("Tab");
  await expect(entries.nth(1)).toBeFocused();
  await entries.nth(0).focus();
  await labPage.keyboard.press("Enter");
  expect((await snapshotEditor(labPage, id)).selection.from).toBe(
    snapshot.headings[0]!.position + 1,
  );

  await updateEditorOptions(labPage, id, { editable: false });
  await entries.nth(3).focus();
  await labPage.keyboard.press("Space");
  expect((await snapshotEditor(labPage, id)).selection.from).toBe(
    snapshot.headings[3]!.position + 1,
  );
  expect(await labPage.evaluate(() => window.location.hash)).toBe("");
  await expect(editor.locator("h1[id], h2[id], h3[id]")).toHaveCount(0);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
  await cdp?.detach();
});

chromiumTest("@required Chromium CDP activates a TOC entry and copies only canonical marker data", async ({ context, labPage }) => {

  const id = "toc-cdp";
  await mountEditor(labPage, {
    extensionMode: "toc",
    id,
    markdown: "[TOC]\n\n# First heading\n\n# Second heading",
  });
  const snapshot = await getTocSnapshot(labPage, id);
  const secondEntry = editorLocator(labPage, id).locator(
    '[data-mdw-toc-entry="2"]',
  );
  await secondEntry.focus();

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      type: "keyDown",
      windowsVirtualKeyCode: 13,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      type: "keyUp",
      windowsVirtualKeyCode: 13,
    });
    await settleEditor(labPage, id);
    const activation = await snapshotEditor(labPage, id);
    expect(activation.selection.from).toBe(snapshot.headings[1]!.position + 1);
    expect(activation.prosemirrorFocused).toBe(true);
    expect(await labPage.evaluate(() => window.location.hash)).toBe("");

    expect(await selectToc(labPage, id)).toBe(true);
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(
        `[data-e2e-editor="${editorId}"]`,
      )!;
      const targetWindow = window as typeof window & {
        __markoraTocCdpCopy?: {
          html: string;
          markdown: string;
          plain: string;
        };
      };
      delete targetWindow.__markoraTocCdpCopy;
      section.addEventListener("copy", (rawEvent) => {
        const transfer = (rawEvent as ClipboardEvent).clipboardData;
        targetWindow.__markoraTocCdpCopy = {
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
      __markoraTocCdpCopy?: {
        html: string;
        markdown: string;
        plain: string;
      };
    }
  ).__markoraTocCdpCopy);
  expect(copied?.markdown).toBe("[TOC]");
  expect(copied?.plain).toBe("[TOC]");
  expect(copied?.html).toContain("data-mdw-toc");
  expect(copied?.html).not.toContain("data-mdw-toc-entry");
  expect(copied?.html).not.toContain("First heading");
  expect(copied?.html).not.toContain("Second heading");
});
