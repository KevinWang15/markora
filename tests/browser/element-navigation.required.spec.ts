import { test, expect, mountEditor, focusEditor, editorLocator, snapshotEditor, getMarkdown, updateEditorOptions, settleEditor } from "./fixtures";

for (const entry of ["root", "minimal"] as const) {
  test(`@required ${entry} shared boundary deletes the directional neighbor and respects readonly`, async ({ labPage }) => {
    const id = `boundary-delete-${entry}`;
    await mountEditor(labPage, { id, entry, markdown: "```js\nfirst\n```\n\n---\n\n```js\nlast\n```" });
    const host = editorLocator(labPage, id);
    const original = await getMarkdown(labPage, id);
    await focusEditor(labPage, id, { anchor: 1 });
    await labPage.keyboard.press("Escape");
    await expect(host.locator("pre.mdw-element-selected, .mdw-element-selected pre")).toHaveCount(1);
    await labPage.keyboard.press("ArrowRight");
    const boundary = (await snapshotEditor(labPage, id)).selection.head;
    await labPage.keyboard.press("Backspace");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("first");
    expect(await getMarkdown(labPage, id)).toContain("---");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toBe(original);
    expect((await snapshotEditor(labPage, id)).selection.head).toBe(boundary);
    await labPage.keyboard.press("Delete");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("---");
    expect(await getMarkdown(labPage, id)).toContain("first");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toBe(original);
    await labPage.keyboard.press("ArrowRight");
    await expect(host.locator("hr.mdw-element-selected, .mdw-element-selected hr")).toHaveCount(1);
    await updateEditorOptions(labPage, id, { editable: false });
    await host.focus();
    await labPage.keyboard.press("Delete");
    await labPage.keyboard.press("Backspace");
    expect(await getMarkdown(labPage, id)).toBe(original);
  });

  test(`@required ${entry} consecutive elements share one gap boundary in both directions`, async ({ labPage, context, browserName }, testInfo) => {
    const id = `elements-${entry}`;
    const markdown = ["Before", "```js\nx\n```", "```mermaid\ngraph LR; A-->B\n```", "```plantuml\nAlice -> Bob\n```", "---", "> Quoted", ...(entry === "root" ? ["| A |\n| --- |\n| B |", "$$\nx\n$$", "![pic](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)"] : []), "After"].join("\n\n");
    await mountEditor(labPage, { id, entry, markdown, root: "shadow", extensionMode: entry === "root" ? "all-advanced" : "diagrams", mathEditMode: "in-place", mathRendererMode: "sync" });
    const host = editorLocator(labPage, id);
    const original = await getMarkdown(labPage, id);
    await focusEditor(labPage, id, { anchor: 7 });
    const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
    const arrow = async (key: "ArrowLeft" | "ArrowRight") => {
      if (cdp) {
        const code = key === "ArrowLeft" ? 37 : 39;
        for (const type of ["rawKeyDown", "keyUp"] as const) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      } else await labPage.keyboard.press(key);
    };
    const isGap = () => host.evaluate((el) => el.classList.contains("mdw-has-managed-block-cursor"));
    try {
      // Consecutive managed blocks: editable blocks enter directly, atoms select as whole elements,
      // and every adjacent component pair has exactly one shared Gap Space between them.
      // 1. Before| -> code_block("x") start -> end -> Gap Space before mermaid
      await arrow("ArrowRight");
      if (entry === "root") {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(true);
      } else {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).selection.head).toBe(9);
      }
      await arrow("ArrowRight"); // move past "x" inside code_block
      await arrow("ArrowRight"); // exit code_block to Gap Space before mermaid
      await expect.poll(isGap).toBe(true);
      const gapCodeToMermaid = (await snapshotEditor(labPage, id)).selection.head;

      // Reverse from Gap Space enters code_block at end, then forward returns to the exact same Gap Space.
      await arrow("ArrowLeft");
      if (entry === "root") {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(true);
      } else {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).selection.head).toBe(10);
      }
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(true);
      expect((await snapshotEditor(labPage, id)).selection.head).toBe(gapCodeToMermaid);

      // 2. Gap Space -> mermaid start -> Escape selects whole mermaid -> ArrowRight -> Gap Space before plantuml
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(false);
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
      await labPage.keyboard.press("Escape");
      await expect(host.locator('[data-mdw-diagram-kind="mermaid"].mdw-element-selected')).toHaveCount(1);
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(true);

      // 3. Gap Space -> plantuml -> Escape -> Gap Space -> hr atom -> Gap Space -> blockquote
      await arrow("ArrowRight");
      await labPage.keyboard.press("Escape");
      await expect(host.locator('[data-mdw-diagram-kind="plantuml"].mdw-element-selected')).toHaveCount(1);
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(true);
      await arrow("ArrowRight");
      await expect(host.locator("hr.mdw-element-selected, .mdw-element-selected hr")).toHaveCount(1);
      await expect(host.locator(".mdw-element-selected")).toHaveCSS("outline-style", "solid");
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(true);
      await arrow("ArrowRight");
      await expect.poll(isGap).toBe(false);
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
      await labPage.keyboard.press("Escape");
      await expect(host.locator("blockquote.mdw-element-selected")).toHaveCount(1);

      if (entry === "root") {
        // 4. blockquote -> Gap Space -> table -> Escape -> Gap Space -> math_block atom -> para before img -> img atom
        await arrow("ArrowRight");
        await expect.poll(isGap).toBe(true);
        await arrow("ArrowRight");
        await expect.poll(isGap).toBe(false);
        await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
        await labPage.keyboard.press("Escape");
        await expect(host.locator("table.mdw-element-selected, .mdw-element-selected table")).toHaveCount(1);
        await arrow("ArrowRight");
        await expect.poll(isGap).toBe(true);
        await arrow("ArrowRight");
        await expect(host.locator('[data-mdw-math-kind="block"].mdw-element-selected')).toHaveCount(1);
        await arrow("ArrowRight"); // paragraph before inline img
        await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
        await arrow("ArrowRight"); // inline img atom
        await expect(host.locator("img.mdw-element-selected, .mdw-element-selected img")).toHaveCount(1);
      }

      expect(await getMarkdown(labPage, id)).toBe(original);

      // Direct entry into code_block via ArrowRight, edit, Escape whole-select, Delete, Undo.
      await focusEditor(labPage, id, { anchor: 7 });
      await arrow("ArrowRight");
      if (entry === "root") {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(true);
      } else {
        await expect.poll(async () => (await snapshotEditor(labPage, id)).selection.head).toBe(9);
      }
      await labPage.keyboard.insertText("edited ");
      await expect.poll(() => getMarkdown(labPage, id)).toContain("edited x");
      await labPage.keyboard.press("Escape");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      expect((await snapshotEditor(labPage, id)).codeMirrorFocused).toBe(false);
      await labPage.screenshot({ path: testInfo.outputPath("selected-code.png") });
      const edited = await getMarkdown(labPage, id);
      await labPage.keyboard.press("Delete");
      await expect.poll(() => getMarkdown(labPage, id)).not.toContain("edited x");
      await labPage.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => getMarkdown(labPage, id)).toBe(edited);
    } finally { await cdp?.detach(); }
  });

  test(`@required ${entry} inline math and images have reversible three-state traversal`, async ({ labPage }, testInfo) => {
    const id = `inline-${entry}`;
    await mountEditor(labPage, { id, entry, root: "shadow", markdown: "A $x$![pic](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)$y$ Z", extensionMode: "math", mathEditMode: "in-place", mathRendererMode: "sync" });
    const host = editorLocator(labPage, id);
    await focusEditor(labPage, id, { anchor: 3 });
    for (let index = 0; index < 3; index++) {
      await labPage.keyboard.press("ArrowRight");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      await labPage.keyboard.press("ArrowRight");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
      expect((await snapshotEditor(labPage, id)).selection.head).toBe(4 + index);
    }
    for (let index = 0; index < 3; index++) {
      await labPage.keyboard.press("ArrowLeft");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(1);
      await labPage.keyboard.press("ArrowLeft");
      await expect(host.locator(".mdw-element-selected")).toHaveCount(0);
    }
    expect((await snapshotEditor(labPage, id)).selection.head).toBe(3);
    await labPage.keyboard.press("ArrowRight");
    await labPage.screenshot({ path: testInfo.outputPath("selected-inline-math.png") });
    await labPage.keyboard.press("Delete");
    await expect.poll(() => getMarkdown(labPage, id)).not.toContain("$x$");
    await labPage.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getMarkdown(labPage, id)).toContain("$x$");
  });
}

test("@required vertical navigation visits every component and line without no-ops and stops at gap spaces", async ({ labPage }) => {
  const id = "vertical-all-components";
  const markdown = [
    "---",
    "title: Nav",
    "---",
    "",
    "Para above",
    "",
    "```js",
    "line1",
    "line2",
    "```",
    "",
    "| H1 | H2 |",
    "| --- | --- |",
    "| c1 | c2 |",
    "",
    "---",
    "",
    "```mermaid",
    "graph TD",
    "A-->B",
    "```",
    "",
    "$$",
    "x^2",
    "$$",
    "",
    "[TOC]",
  ].join("\n");
  await mountEditor(labPage, {
    id,
    markdown,
    extensionMode: "all-advanced",
    mathEditMode: "in-place",
    mathRendererMode: "sync",
    diagramRendererModes: { mermaid: "sync" },
  });

  const host = editorLocator(labPage, id);
  const readState = async () => {
    const snap = await snapshotEditor(labPage, id);
    const kind = await host.evaluate((el) => (
      el.classList.contains("mdw-has-managed-block-cursor")
        ? "gap"
        : el.querySelector(".mdw-element-selected")
          ? "node"
          : "text"
    ));
    return { kind, from: snap.selection.from, to: snap.selection.to, head: snap.selection.head, cm: snap.codeMirrorFocused };
  };

  // Start at Para above (anchor 3), walk ArrowUp through frontmatter to leading ManagedBlockCursor.
  await focusEditor(labPage, id, { anchor: 3 });
  await labPage.keyboard.press("ArrowUp");
  await settleEditor(labPage, id);
  expect((await readState()).kind).toBe("node");
  await labPage.keyboard.press("ArrowUp");
  await settleEditor(labPage, id);
  expect(await readState()).toMatchObject({ kind: "gap", head: 0 });

  // Walk ArrowDown all the way to the trailing ManagedBlockCursor after [TOC], verifying zero no-ops.
  const visitedDown: Array<{ kind: string; head: number; cm: boolean }> = [];
  let prev = await readState();
  for (let step = 0; step < 30; step++) {
    await labPage.keyboard.press("ArrowDown");
    await settleEditor(labPage, id);
    const curr = await readState();
    if (prev.kind === "gap" && curr.kind === "gap" && curr.head === prev.head && visitedDown.length > 10) {
      break;
    }
    expect(
      curr.head !== prev.head || curr.kind !== prev.kind,
      `ArrowDown step ${step} from ${prev.kind}@${prev.head} must move`,
    ).toBe(true);
    visitedDown.push({ kind: curr.kind, head: curr.head, cm: curr.cm });
    prev = curr;
  }
  expect(prev.kind).toBe("gap");
  expect(visitedDown.some((s) => s.cm)).toBe(true);
  // Every consecutive block pair produced a managed-block-cursor gap stop.
  expect(visitedDown.filter((s) => s.kind === "gap").length).toBeGreaterThanOrEqual(6);

  // Walk ArrowUp all the way back to leading ManagedBlockCursor at 0, verifying zero no-ops.
  const visitedUp: Array<{ kind: string; head: number; cm: boolean }> = [];
  for (let step = 0; step < 30; step++) {
    await labPage.keyboard.press("ArrowUp");
    await settleEditor(labPage, id);
    const curr = await readState();
    if (curr.kind === "gap" && curr.head === 0) {
      visitedUp.push({ kind: curr.kind, head: curr.head, cm: curr.cm });
      break;
    }
    expect(
      curr.head !== prev.head || curr.kind !== prev.kind,
      `ArrowUp step ${step} from ${prev.kind}@${prev.head} must move`,
    ).toBe(true);
    visitedUp.push({ kind: curr.kind, head: curr.head, cm: curr.cm });
    prev = curr;
  }
  expect(visitedUp[visitedUp.length - 1]).toMatchObject({ kind: "gap", head: 0 });
  expect(visitedUp.some((s) => s.cm)).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(markdown);
});

test("@required start-of-component Backspace unwraps table, diagram, footnote, and math and math exits horizontally", async ({ labPage }) => {
  // 1. Table unwrap
  await mountEditor(labPage, { id: "unwrap-table", markdown: "| H1 | H2 |\n| --- | --- |\n| **a** | b |" });
  const tableEditor = editorLocator(labPage, "unwrap-table");
  await tableEditor.locator("th").first().click();
  await labPage.keyboard.press("Home");
  await labPage.keyboard.press("Backspace");
  await expect.poll(() => getMarkdown(labPage, "unwrap-table")).toBe("H1 H2\n\n**a** b");
  await labPage.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => getMarkdown(labPage, "unwrap-table")).toBe("| H1 | H2 |\n| --- | --- |\n| **a** | b |");

  // 2. Diagram unwrap
  await mountEditor(labPage, {
    id: "unwrap-diagram",
    markdown: "Before\n\n```mermaid\ngraph TD\nA-->B\n```",
    extensionMode: "diagrams",
    diagramRendererModes: { mermaid: "sync" },
  });
  await focusEditor(labPage, "unwrap-diagram", { anchor: 7 });
  await labPage.keyboard.press("ArrowRight");
  await settleEditor(labPage, "unwrap-diagram");
  await labPage.keyboard.press("Backspace");
  await expect.poll(() => getMarkdown(labPage, "unwrap-diagram")).toBe("Before\n\ngraph TD\n\nA-->B");
  await labPage.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => getMarkdown(labPage, "unwrap-diagram")).toContain("```mermaid");

  // 3. Footnote definition unwrap
  await mountEditor(labPage, {
    id: "unwrap-footnote",
    markdown: "Body[^1]\n\n[^1]: Note text",
    extensionMode: "footnotes",
  });
  const fnEditor = editorLocator(labPage, "unwrap-footnote");
  await fnEditor.locator("[data-mdw-footnote-content] p").click();
  await labPage.keyboard.press("Home");
  await labPage.keyboard.press("Backspace");
  await expect.poll(() => getMarkdown(labPage, "unwrap-footnote")).toBe("Body[^1]\n\nNote text");
  await labPage.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => getMarkdown(labPage, "unwrap-footnote")).toBe("Body[^1]\n\n[^1]: Note text");

  // 4. Math inline & block horizontal arrow exit + Backspace unwrap
  await mountEditor(labPage, {
    id: "unwrap-math",
    markdown: "Before $x^2$ after\n\n$$\na + b\n$$",
    extensionMode: "math",
    mathEditMode: "in-place",
    mathRendererMode: "sync",
  });
  const mathEditor = editorLocator(labPage, "unwrap-math");
  await mathEditor.locator('[data-mdw-math-kind="inline"]').click();
  await expect(mathEditor.locator("textarea")).toBeFocused();
  await labPage.keyboard.press("ArrowLeft"); // collapse to 0
  await labPage.keyboard.press("ArrowLeft"); // exit left!
  await expect(mathEditor.locator("textarea")).toHaveCount(0);
  expect((await snapshotEditor(labPage, "unwrap-math")).selection.head).toBe(8);

  await mathEditor.locator('[data-mdw-math-kind="inline"]').click();
  await expect(mathEditor.locator("textarea")).toBeFocused();
  await labPage.keyboard.press("ArrowLeft"); // collapse to 0
  await labPage.keyboard.press("Backspace"); // unwrap inline math
  await expect(mathEditor.locator("textarea")).toHaveCount(0);
  await expect.poll(() => getMarkdown(labPage, "unwrap-math")).toBe("Before x^2 after\n\n$$\na + b\n$$");
  await labPage.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => getMarkdown(labPage, "unwrap-math")).toBe("Before $x^2$ after\n\n$$\na + b\n$$");

  await mathEditor.locator('[data-mdw-math-kind="block"]').click();
  await expect(mathEditor.locator("textarea")).toBeFocused();
  await labPage.keyboard.press("ArrowRight"); // collapse to end
  await labPage.keyboard.press("ArrowRight"); // exit right to trailing ManagedBlockCursor (no doc mutation)
  await expect(mathEditor.locator("textarea")).toHaveCount(0);
  await expect(mathEditor).toHaveClass(/mdw-has-managed-block-cursor/);
  expect(await getMarkdown(labPage, "unwrap-math")).toBe("Before $x^2$ after\n\n$$\na + b\n$$");

  await mathEditor.locator('[data-mdw-math-kind="block"]').click();
  await expect(mathEditor.locator("textarea")).toBeFocused();
  await labPage.keyboard.press("ArrowLeft"); // collapse to 0
  await labPage.keyboard.press("Backspace"); // unwrap block math
  await expect(mathEditor.locator("textarea")).toHaveCount(0);
  await expect.poll(() => getMarkdown(labPage, "unwrap-math")).toBe("Before $x^2$ after\n\na + b");
  await labPage.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => getMarkdown(labPage, "unwrap-math")).toBe("Before $x^2$ after\n\n$$\na + b\n$$");
});
