import type { CDPSession, Page } from "@playwright/test";
import { chromiumTest,
  canRunEditorCommand,
  clearEditorEvents,
  copyEditorSelection,
  dispatchTransfer,
  editorLocator,
  expect,
  focusEditor,
  getEditorEvents,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

async function dispatchChromiumClipboardCommand(
  cdp: CDPSession,
  command: "Copy" | "Cut" | "Paste",
) {
  const key = command === "Copy" ? "c" : command === "Cut" ? "x" : "v";
  const code = `Key${key.toUpperCase()}`;
  const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
  await cdp.send("Input.dispatchKeyEvent", {
    code,
    commands: [command],
    key,
    modifiers: 2,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    type: "rawKeyDown",
    windowsVirtualKeyCode,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    code,
    key,
    modifiers: 2,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    type: "keyUp",
    windowsVirtualKeyCode,
  });
}

async function dragBackwardAcrossActiveCode(page: Page, id: string) {
  const editor = editorLocator(page, id);
  await editor.locator(".cm-content").click();
  await settleEditor(page, id);
  await editor.scrollIntoViewIfNeeded();
  const points = await editor.evaluate((element) => {
    const code = element.querySelector(".cm-line")!.firstChild!;
    const after = [...element.children].find((child) => (
      child.tagName === "P" && child.textContent?.includes("after paragraph")
    ))!.firstChild!;
    const point = (node: ChildNode, offset: number) => {
      const range = node.ownerDocument!.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    };
    return { end: point(code, 4), start: point(after, 5) };
  });

  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 20 });
  await page.mouse.up();
}

async function captureTrustedCut(page: Page, id: string) {
  const editor = editorLocator(page, id);
  await editor.evaluate((element) => {
    const target = window as typeof window & {
      __markoraCrossCut?: { defaultPrevented: boolean; plain: string; types: string[] };
    };
    delete target.__markoraCrossCut;
    element.addEventListener("cut", (rawEvent) => {
      const event = rawEvent as ClipboardEvent;
      target.__markoraCrossCut = {
        defaultPrevented: event.defaultPrevented,
        plain: event.clipboardData?.getData("text/plain") ?? "",
        types: Array.from(event.clipboardData?.types ?? []),
      };
    }, { once: true });
  });
  await page.keyboard.press("ControlOrMeta+x");
  return page.evaluate(() => (
    window as typeof window & {
      __markoraCrossCut?: { defaultPrevented: boolean; plain: string; types: string[] };
    }
  ).__markoraCrossCut!);
}

test("@required explicit Markdown and plain paste retain host selection, focus, and one-step history", async ({ labPage }) => {
  const id = "clipboard-command";
  await mountEditor(labPage, { id, markdown: "replace me" });
  const output = labPage.locator(`[data-e2e-output="${id}"]`);

  await focusEditor(labPage, id, "all");
  await output.focus();
  expect(await canRunEditorCommand(labPage, id, { type: "pasteMarkdown", text: "" })).toBe(true);
  expect(await runEditorCommand(labPage, id, {
    type: "pasteMarkdown",
    text: "# Pasted\n\n- one\n- two",
  })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("# Pasted\n\n* one\n* two");
  await expect(editorLocator(labPage, id)).toBeFocused();

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("replace me");

  await focusEditor(labPage, id, "all");
  await output.focus();
  expect(await runEditorCommand(labPage, id, {
    type: "pastePlainText",
    text: "# Literal\n\n**plain**",
  })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("\\# Literal\n\n\\*\\*plain\\*\\*");
  await expect(editorLocator(labPage, id).locator("h1, strong")).toHaveCount(0);

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  await labPage.keyboard.down("Shift");
  const plainShortcut = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: "<h1>Rich</h1>",
    markdown: "# Markdown",
    plain: "# Shortcut literal",
  });
  await labPage.keyboard.up("Shift");
  expect(plainShortcut.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("\\# Shortcut literal");

  await updateEditorOptions(labPage, id, { editable: false });
  expect(await canRunEditorCommand(labPage, id, { type: "pasteMarkdown", text: "ignored" })).toBe(false);
  expect(await runEditorCommand(labPage, id, { type: "pasteMarkdown", text: "ignored" })).toBe(false);
});

test("@required outer copy emits semantic HTML, Markdown, and useful plain text in document and Shadow DOM", async ({ labPage }) => {
  const markdown = [
    "# Clipboard",
    "",
    "- [x] done",
    "- item",
    "",
    "[link](https://example.com/docs)",
    "",
    "line  ",
    "break",
    "",
    "| Name | Value |",
    "| :--- | ---: |",
    "| A | B |",
    "",
    "```ts",
    "const value = 1;",
    "```",
  ].join("\n");

  for (const root of ["document", "shadow"] as const) {
    const id = `clipboard-copy-${root}`;
    await mountEditor(labPage, { id, initialSelection: "all", markdown, root });
    const copied = await copyEditorSelection(labPage, id);

    expect(copied.defaultPrevented).toBe(true);
    expect(new Set(copied.types)).toEqual(new Set(["text/html", "text/plain", "text/markdown"]));
    expect(copied.markdown).toContain("# Clipboard");
    expect(copied.markdown).toContain("* [x] done");
    expect(copied.markdown).toContain("| :--- | ---: |");
    expect(copied.markdown).toContain("```ts");
    expect(copied.plain).toContain("- [x] done\n- item");
    expect(copied.plain).toContain("line\nbreak");
    expect(copied.plain).toContain("Name\tValue\nA\tB");

    const html = await labPage.evaluate((value) => {
      const doc = new DOMParser().parseFromString(value, "text/html");
      return {
        hasInternalSlice: Boolean(doc.querySelector("[data-pm-slice]")),
        hasLiveTaskControl: Boolean(doc.querySelector("[data-mdw-task-control], .mdw-task-content")),
        portableTask: {
          checked: doc.querySelector<HTMLInputElement>('li[data-task="true"] > input[type="checkbox"]')?.checked,
          disabled: doc.querySelector<HTMLInputElement>('li[data-task="true"] > input[type="checkbox"]')?.disabled,
        },
        structure: {
          code: doc.querySelectorAll("pre code").length,
          heading: doc.querySelectorAll("h1").length,
          list: doc.querySelectorAll("ul li").length,
          table: doc.querySelectorAll("table").length,
        },
      };
    }, copied.html);
    expect(html).toEqual({
      hasInternalSlice: true,
      hasLiveTaskControl: false,
      portableTask: { checked: true, disabled: true },
      structure: { code: 1, heading: 1, list: 2, table: 1 },
    });
  }
});

test("@required automatic rich round-trip outranks Markdown and preserves HTML-only table scope", async ({ labPage }) => {
  const id = "clipboard-rich-roundtrip";
  await mountEditor(labPage, { id, markdown: "" });
  await focusEditor(labPage, id, "end");
  await dispatchTransfer(labPage, id, {
    event: "paste",
    html: [
      "<table><thead><tr>",
      '<th scope="col">Name</th><th scope="col">Status</th>',
      "</tr></thead><tbody><tr>",
      '<th scope="row">Alpha</th><td>Ready</td>',
      "</tr></tbody></table>",
    ].join(""),
    plain: "fallback",
  });
  await settleEditor(labPage, id);
  await focusEditor(labPage, id, "all");
  const copied = await copyEditorSelection(labPage, id);

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  await dispatchTransfer(labPage, id, {
    event: "paste",
    html: copied.html,
    markdown: copied.markdown,
    plain: copied.plain,
  });
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator('th[scope="row"]')).toHaveText("Alpha");
  await expect(editor.locator('th[scope="col"]')).toHaveCount(2);
});

test("@required Markdown clipboard input keeps raw HTML inert and clamps unsafe URLs", async ({ labPage }) => {
  const id = "clipboard-hostile-markdown";
  await mountEditor(labPage, { id, markdown: "" });
  await focusEditor(labPage, id, "end");

  const hostile = [
    "<script>window.__markoraClipboardExecuted = true</script>",
    "",
    "[unsafe](javascript:alert(1))",
    "",
    '<img src="missing" onerror="window.__markoraClipboardExecuted = true">',
  ].join("\n");
  const pasted = await dispatchTransfer(labPage, id, {
    event: "paste",
    markdown: hostile,
    plain: "fallback",
  });
  expect(pasted.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator("script, iframe, img[onerror], a[href^='javascript:']")).toHaveCount(0);
  expect(await labPage.evaluate(() => (
    window as typeof window & { __markoraClipboardExecuted?: boolean }
  ).__markoraClipboardExecuted)).toBeUndefined();
  expect(await getMarkdown(labPage, id)).toContain("window.__markoraClipboardExecuted = true");
});

test("@required trusted cut writes all representations, mutates once, and undoes once", async ({ labPage }) => {
  const id = "clipboard-cut";
  const markdown = "# Alpha\n\n[Beta](https://example.com/)";
  await mountEditor(labPage, { id, markdown });
  await focusEditor(labPage, id, "all");
  await clearEditorEvents(labPage, id);
  await labPage.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    const target = window as typeof window & {
      __markoraCutCapture?: { html: string; markdown: string; plain: string; types: string[] };
    };
    delete target.__markoraCutCapture;
    section.addEventListener("cut", (rawEvent) => {
      const data = (rawEvent as ClipboardEvent).clipboardData;
      target.__markoraCutCapture = {
        html: data?.getData("text/html") ?? "",
        markdown: data?.getData("text/markdown") ?? "",
        plain: data?.getData("text/plain") ?? "",
        types: Array.from(data?.types ?? []),
      };
    }, { once: true });
  }, id);

  await labPage.keyboard.press("ControlOrMeta+x");
  await settleEditor(labPage, id);
  const captured = await labPage.evaluate(() => (
    window as typeof window & {
      __markoraCutCapture?: { html: string; markdown: string; plain: string; types: string[] };
    }
  ).__markoraCutCapture);
  expect(captured).toBeDefined();
  expect(new Set(captured!.types)).toEqual(new Set(["text/html", "text/plain", "text/markdown"]));
  expect(captured!.markdown).toBe(markdown);
  expect(captured!.html).toContain("data-pm-slice");
  expect(await getMarkdown(labPage, id)).toBe("");
  expect((await getEditorEvents(labPage, id)).counts.update).toBe(1);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(false);
});

chromiumTest("@required Chromium CDP copy and paste survive the native clipboard as one semantic edit", async ({ context, labPage }) => {

  const source = "clipboard-cdp-copy-source";
  const target = "clipboard-cdp-copy-target";
  const markdown = [
    "# Native clipboard",
    "",
    "A **strong** [link](/target).",
    "",
    "* one",
    "* two",
  ].join("\n");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(labPage.url()).origin,
  });
  await mountEditor(labPage, { id: source, markdown, root: "shadow" });
  await mountEditor(labPage, { id: target, markdown: "", root: "shadow" });
  await focusEditor(labPage, source, "all");
  await labPage.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    const target = window as typeof window & {
      __markoraCdpCopy?: { markdown: string; types: string[] };
    };
    delete target.__markoraCdpCopy;
    section.addEventListener("copy", (rawEvent) => {
      const data = (rawEvent as ClipboardEvent).clipboardData;
      target.__markoraCdpCopy = {
        markdown: data?.getData("text/markdown") ?? "",
        types: Array.from(data?.types ?? []),
      };
    }, { once: true });
  }, source);

  const cdp = await context.newCDPSession(labPage);
  await dispatchChromiumClipboardCommand(cdp, "Copy");
  await expect.poll(() => labPage.evaluate(() => navigator.clipboard.readText())).toContain(
    "Native clipboard",
  );
  const copied = await labPage.evaluate(() => (
    window as typeof window & {
      __markoraCdpCopy?: { markdown: string; types: string[] };
    }
  ).__markoraCdpCopy);
  expect(copied).toEqual({
    markdown,
    types: expect.arrayContaining(["text/html", "text/plain", "text/markdown"]),
  });
  expect(await getMarkdown(labPage, source)).toBe(markdown);

  await focusEditor(labPage, target, "end");
  await dispatchChromiumClipboardCommand(cdp, "Paste");
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe(markdown);
  await expect(editorLocator(labPage, target).locator("h1")).toHaveText("Native clipboard");
  await expect(editorLocator(labPage, target).locator("strong")).toHaveText("strong");
  await expect(editorLocator(labPage, target).locator('a[href="/target"]')).toHaveText("link");
  await expect(editorLocator(labPage, target)).toBeFocused();
  const selection = (await snapshotEditor(labPage, target)).selection;
  expect(selection.from).toBe(selection.to);

  expect(await runEditorCommand(labPage, target, { type: "undo" })).toBe(true);
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe("");
  expect(await runEditorCommand(labPage, target, { type: "redo" })).toBe(true);
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe(markdown);
  await cdp.detach();
});

chromiumTest("@required Chromium CDP cut and paste retain a linked slice with independent history", async ({ context, labPage }) => {

  const source = "clipboard-cdp-cut-source";
  const target = "clipboard-cdp-cut-target";
  const original = "alpha [beta](/target) gamma";
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(labPage.url()).origin,
  });
  await mountEditor(labPage, { id: source, markdown: original, root: "shadow" });
  await mountEditor(labPage, { id: target, markdown: "delta suffix", root: "shadow" });
  expect(await labPage.evaluate((id) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(id, "beta", "all")
  ), source)).toBe(true);
  const cdp = await context.newCDPSession(labPage);

  await dispatchChromiumClipboardCommand(cdp, "Cut");
  await expect.poll(() => labPage.evaluate(() => navigator.clipboard.readText())).toBe("beta");
  await settleEditor(labPage, source);
  expect(await getMarkdown(labPage, source)).toBe("alpha  gamma");
  expect(await runEditorCommand(labPage, source, { type: "undo" })).toBe(true);
  await settleEditor(labPage, source);
  expect(await getMarkdown(labPage, source)).toBe(original);

  expect(await labPage.evaluate((id) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(id, "suffix", "all")
  ), target)).toBe(true);
  await dispatchChromiumClipboardCommand(cdp, "Paste");
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe("delta [beta](/target)");
  await expect(editorLocator(labPage, target).locator('a[href="/target"]')).toHaveText("beta");
  await expect(editorLocator(labPage, target)).toBeFocused();
  const selection = (await snapshotEditor(labPage, target)).selection;
  expect(selection.from).toBe(selection.to);

  expect(await runEditorCommand(labPage, target, { type: "undo" })).toBe(true);
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe("delta suffix");
  expect(await runEditorCommand(labPage, target, { type: "redo" })).toBe(true);
  await settleEditor(labPage, target);
  expect(await getMarkdown(labPage, target)).toBe("delta [beta](/target)");
  await cdp.detach();
});

test("@required passive code cut owns native DOM mutation and remains one-step undoable", async ({ labPage }) => {
  const id = "clipboard-passive-cut";
  const markdown = "```text\nbefore selected after\n```";
  await mountEditor(labPage, { id, markdown });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "selected", "all"),
    id,
  )).toBe(true);
  await clearEditorEvents(labPage, id);
  await labPage.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    const target = window as typeof window & {
      __markoraPassiveCut?: { plain: string; types: string[] };
    };
    delete target.__markoraPassiveCut;
    section.addEventListener("cut", (rawEvent) => {
      const data = (rawEvent as ClipboardEvent).clipboardData;
      target.__markoraPassiveCut = {
        plain: data?.getData("text/plain") ?? "",
        types: Array.from(data?.types ?? []),
      };
    }, { once: true });
  }, id);

  await labPage.keyboard.press("ControlOrMeta+x");
  await settleEditor(labPage, id);
  expect(await labPage.evaluate(() => (
    window as typeof window & {
      __markoraPassiveCut?: { plain: string; types: string[] };
    }
  ).__markoraPassiveCut)).toEqual({ plain: "selected", types: ["text/plain"] });
  expect(await getMarkdown(labPage, id)).toBe("```text\nbefore  after\n```");
  expect((await getEditorEvents(labPage, id)).counts.update).toBe(1);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(false);
});

test("@required active code cut stays plain and remains one-step undoable", async ({ labPage }) => {
  const id = "clipboard-active-cut";
  const markdown = "```text\nalpha beta gamma\n```";
  await mountEditor(labPage, { id, markdown });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await labPage.keyboard.press("ControlOrMeta+a");
  await clearEditorEvents(labPage, id);
  await labPage.evaluate((editorId) => {
    const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
    const target = window as typeof window & {
      __markoraActiveCut?: { plain: string; types: string[] };
    };
    delete target.__markoraActiveCut;
    section.addEventListener("cut", (rawEvent) => {
      const data = (rawEvent as ClipboardEvent).clipboardData;
      target.__markoraActiveCut = {
        plain: data?.getData("text/plain") ?? "",
        types: Array.from(data?.types ?? []),
      };
    }, { once: true });
  }, id);

  await labPage.keyboard.press("ControlOrMeta+x");
  await settleEditor(labPage, id);
  expect(await labPage.evaluate(() => (
    window as typeof window & {
      __markoraActiveCut?: { plain: string; types: string[] };
    }
  ).__markoraActiveCut)).toEqual({ plain: "alpha beta gamma", types: ["text/plain"] });
  expect(await getMarkdown(labPage, id)).toBe("```text\n\n```");
  expect((await getEditorEvents(labPage, id)).counts.update).toBe(1);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(false);
});

test("@required active and passive code paste every text representation literally", async ({ labPage }) => {
  const passiveId = "clipboard-passive-code";
  await mountEditor(labPage, {
    id: passiveId,
    markdown: "```text\nbefore\n```",
  });
  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "before", "end"),
    passiveId,
  )).toBe(true);
  const passive = await dispatchTransfer(labPage, passiveId, {
    event: "paste",
    markdown: "\n# literal **source**",
    target: "static-code",
  });
  expect(passive.defaultPrevented).toBe(true);
  const passiveMixed = await dispatchTransfer(labPage, passiveId, {
    event: "paste",
    html: "<p>wrong HTML</p>",
    markdown: "\n## mixed source",
    target: "static-code",
  });
  expect(passiveMixed.defaultPrevented).toBe(true);
  await settleEditor(labPage, passiveId);
  expect(await getMarkdown(labPage, passiveId)).toBe([
    "```text",
    "before",
    "# literal **source**",
    "## mixed source",
    "```",
  ].join("\n"));

  const activeId = "clipboard-active-code";
  await mountEditor(labPage, {
    id: activeId,
    markdown: "```text\nbefore\n```",
  });
  const code = editorLocator(labPage, activeId).locator(".cm-content");
  await code.click();
  await labPage.keyboard.press("End");
  const markdownOnly = await dispatchTransfer(labPage, activeId, {
    event: "paste",
    markdown: "\n## still literal",
    target: "code-mirror",
  });
  expect(markdownOnly.defaultPrevented).toBe(true);
  const mixed = await dispatchTransfer(labPage, activeId, {
    event: "paste",
    html: "<p>wrong HTML</p>",
    markdown: " mixed-source",
    target: "code-mirror",
  });
  expect(mixed.defaultPrevented).toBe(true);
  const htmlOnly = await dispatchTransfer(labPage, activeId, {
    event: "paste",
    html: "<p>html<br>lines</p>",
    target: "code-mirror",
  });
  expect(htmlOnly.defaultPrevented).toBe(true);
  expect(await runEditorCommand(labPage, activeId, {
    type: "pasteMarkdown",
    text: "\n# command literal",
  })).toBe(true);
  await settleEditor(labPage, activeId);
  expect(await getMarkdown(labPage, activeId)).toBe([
    "```text",
    "before",
    "## still literal mixed-sourcehtml",
    "lines",
    "# command literal",
    "```",
  ].join("\n"));
  await expect(editorLocator(labPage, activeId).locator("h2")).toHaveCount(0);
});

test("@required split active-code cut is copy-only instead of mutating across DOM owners", async ({
  browserName,
  labPage,
}) => {
  test.skip(
    browserName !== "firefox",
    "Only Firefox reliably exposes a split active-code/outer range to automation.",
  );
  const initial = "before paragraph\n\n```text\ncode-line\n```\n\nafter paragraph";

  for (const root of ["document", "shadow"] as const) {
    const id = `clipboard-cross-cut-${root}`;
    await mountEditor(labPage, { id, markdown: initial, root });
    await dragBackwardAcrossActiveCode(labPage, id);
    const captured = await captureTrustedCut(labPage, id);
    await settleEditor(labPage, id);

    expect(captured.defaultPrevented).toBe(true);
    expect(captured.types).toEqual(["text/plain"]);
    expect(captured.plain).not.toBe("");
    expect(await getMarkdown(labPage, id)).toBe(initial);
    await expect(editorLocator(labPage, id).locator(".cm-line")).toHaveText("code-line");
    await expect(editorLocator(labPage, id).locator(":scope > p").last()).toHaveText("after paragraph");
  }
});

test("@required host paste commands wait for active CodeMirror composition", async ({ labPage }) => {
  const id = "clipboard-code-composition";
  await mountEditor(labPage, { id, markdown: "```text\nbefore\n```" });
  const code = editorLocator(labPage, id).locator(".cm-content");
  await code.click();
  await code.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });

  expect(await canRunEditorCommand(labPage, id, { type: "pasteMarkdown", text: "ignored" })).toBe(false);
  expect(await runEditorCommand(labPage, id, { type: "pasteMarkdown", text: "ignored" })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe("```text\nbefore\n```");

  await code.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
    }));
  });
  expect(await canRunEditorCommand(labPage, id, { type: "pasteMarkdown", text: "literal" })).toBe(true);
});
