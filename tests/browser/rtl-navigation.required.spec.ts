import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

type SelectionMode = "end" | "start";

async function selectTextBoundary(
  page: Parameters<typeof mountEditor>[0],
  id: string,
  text: string,
  mode: SelectionMode,
) {
  expect(await page.evaluate(
    ({ editorId, needle, selectionMode }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, selectionMode)
    ),
    { editorId: id, needle: text, selectionMode: mode },
  )).toBe(true);
}

test("@required bidi mark boundaries follow physical browser caret motion", async ({ labPage }) => {
  const cases = [
    {
      arrow: "ArrowRight",
      direction: "rtl" as const,
      expected: ["X**אבג**"],
      id: "rtl-strong-start",
      markdown: "**אבג**",
      mode: "start" as const,
      text: "אבג",
    },
    {
      arrow: "ArrowLeft",
      direction: "rtl" as const,
      expected: ["**אבג**X"],
      id: "rtl-strong-end",
      markdown: "**אבג**",
      mode: "end" as const,
      text: "אבג",
    },
    {
      arrow: "ArrowRight",
      direction: "rtl" as const,
      expected: ["אבג X**abc** דהו", "אבגX **abc** דהו"],
      id: "rtl-mixed-strong-start",
      markdown: "אבג **abc** דהו",
      mode: "start" as const,
      text: "abc",
    },
    {
      arrow: "ArrowLeft",
      direction: "rtl" as const,
      expected: ["אבג **abc**X דהו", "אבג **abc** Xדהו"],
      id: "rtl-mixed-strong-end",
      markdown: "אבג **abc** דהו",
      mode: "end" as const,
      text: "abc",
    },
    {
      arrow: "ArrowLeft",
      direction: "ltr" as const,
      expected: ["abc X**אבג** def", "abcX **אבג** def"],
      id: "ltr-mixed-strong-start",
      markdown: "abc **אבג** def",
      mode: "start" as const,
      text: "אבג",
    },
    {
      arrow: "ArrowRight",
      direction: "ltr" as const,
      expected: ["abc **אבג**X def", "abc **אבג** Xdef"],
      id: "ltr-mixed-strong-end",
      markdown: "abc **אבג** def",
      mode: "end" as const,
      text: "אבג",
    },
  ];

  for (const testCase of cases) {
    await mountEditor(labPage, {
      direction: testCase.direction,
      id: testCase.id,
      markdown: testCase.markdown,
    });
    await selectTextBoundary(labPage, testCase.id, testCase.text, testCase.mode);
    await settleEditor(labPage, testCase.id);
    await labPage.keyboard.press(testCase.arrow);
    await labPage.keyboard.insertText("X");
    await settleEditor(labPage, testCase.id);
    // Gecko assigns the neutral separating space to the opposite bidi run
    // from Chromium/WebKit. Both serializations are native-valid; the strong
    // text assertion proves the inserted character escaped the mark.
    expect(testCase.expected).toContain(await getMarkdown(labPage, testCase.id));
    await expect(editorLocator(labPage, testCase.id).locator("strong")).toHaveText(testCase.text);
  }
});

test("@required one physical arrow exits every coincident mark boundary", async ({
  browserName,
  context,
  labPage,
}) => {
  const cases = [
    {
      arrow: "ArrowLeft" as const,
      direction: "ltr" as const,
      expected: "pre X***fix*** suffix",
      markdown: "pre ***fix*** suffix",
      markerNames: ["strong", "em"],
      mode: "start" as const,
      text: "fix",
    },
    {
      arrow: "ArrowRight" as const,
      direction: "ltr" as const,
      expected: "pre ***fix***X suffix",
      markdown: "pre ***fix*** suffix",
      markerNames: ["strong", "em"],
      mode: "end" as const,
      text: "fix",
    },
    {
      arrow: "ArrowLeft" as const,
      direction: "ltr" as const,
      expected: "pre X**[fix](/target)** suffix",
      markdown: "pre [**fix**](/target) suffix",
      markerNames: ["link", "strong"],
      mode: "start" as const,
      text: "fix",
    },
    {
      arrow: "ArrowRight" as const,
      direction: "ltr" as const,
      expected: "pre **[fix](/target)**X suffix",
      markdown: "pre [**fix**](/target) suffix",
      markerNames: ["link", "strong"],
      mode: "end" as const,
      text: "fix",
    },
    {
      arrow: "ArrowRight" as const,
      direction: "rtl" as const,
      expected: "X***אבג***",
      markdown: "***אבג***",
      markerNames: ["strong", "em"],
      mode: "start" as const,
      text: "אבג",
    },
    {
      arrow: "ArrowLeft" as const,
      direction: "rtl" as const,
      expected: "***אבג***X",
      markdown: "***אבג***",
      markerNames: ["strong", "em"],
      mode: "end" as const,
      text: "אבג",
    },
  ];
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  const pressArrow = async (key: "ArrowLeft" | "ArrowRight") => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const keyCode = key === "ArrowLeft" ? 37 : 39;
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };

  for (const [index, testCase] of cases.entries()) {
    const id = `coincident-mark-boundary-${index}`;
    await mountEditor(labPage, {
      direction: testCase.direction,
      id,
      markdown: testCase.markdown,
      root: "shadow",
    });
    await selectTextBoundary(labPage, id, testCase.text, testCase.mode);
    await settleEditor(labPage, id);
    const boundaryHead = (await snapshotEditor(labPage, id)).selection.head;

    await pressArrow(testCase.arrow);
    await settleEditor(labPage, id);
    expect((await snapshotEditor(labPage, id)).selection.head).toBe(boundaryHead);
    for (const markerName of testCase.markerNames) {
      await expect(editorLocator(labPage, id).locator(`.mdw-marker-${markerName}`))
        .toHaveCount(0);
    }

    if (cdp) {
      await cdp.send("Input.insertText", { text: "X" });
    } else {
      await labPage.keyboard.insertText("X");
    }
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id), JSON.stringify(testCase)).toBe(testCase.expected);
  }

  await cdp?.detach();
});

test("@required root and minimal exit coincident marks before native caret motion", async ({
  browserName,
  context,
  labPage,
}) => {
  const cases = [
    {
      arrow: "ArrowLeft" as const,
      expected: "pre X***fix*** suffix",
      markdown: "pre ***fix*** suffix",
      mode: "start" as const,
    },
    {
      arrow: "ArrowRight" as const,
      expected: "pre ***fix***X suffix",
      markdown: "pre ***fix*** suffix",
      mode: "end" as const,
    },
    {
      arrow: "ArrowRight" as const,
      expected: "pre **[fix](/target)**X suffix",
      markdown: "pre [**fix**](/target) suffix",
      mode: "end" as const,
    },
  ];
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressArrow = async (key: "ArrowLeft" | "ArrowRight") => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const keyCode = key === "ArrowLeft" ? 37 : 39;
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };

  for (const entry of ["root", "minimal"] as const) {
    for (const [index, testCase] of cases.entries()) {
      const id = `shared-mark-boundary-${entry}-${index}`;
      await mountEditor(labPage, {
        entry,
        id,
        markdown: testCase.markdown,
        root: "shadow",
      });
      await selectTextBoundary(labPage, id, "fix", testCase.mode);
      await settleEditor(labPage, id);
      const boundaryHead = (await snapshotEditor(labPage, id)).selection.head;

      await pressArrow(testCase.arrow);
      await settleEditor(labPage, id);
      expect((await snapshotEditor(labPage, id)).selection.head).toBe(boundaryHead);

      if (cdp) {
        await cdp.send("Input.insertText", { text: "X" });
      } else {
        await labPage.keyboard.insertText("X");
      }
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(testCase.expected);
    }
  }

  await cdp?.detach();
});

test("@required bidi mark exits preserve native physical-arrow progression", async ({ labPage }) => {
  const cases = [
    {
      arrow: "ArrowLeft",
      direction: "ltr" as const,
      markedMarkdown: "abc **אבג** def",
      mode: "start" as const,
      text: "אבג",
      visibleText: "abc אבג def",
    },
    {
      arrow: "ArrowRight",
      direction: "ltr" as const,
      markedMarkdown: "abc **אבג** def",
      mode: "end" as const,
      text: "אבג",
      visibleText: "abc אבג def",
    },
    {
      arrow: "ArrowRight",
      direction: "rtl" as const,
      markedMarkdown: "אבג **abc** דהו",
      mode: "start" as const,
      text: "abc",
      visibleText: "אבג abc דהו",
    },
    {
      arrow: "ArrowLeft",
      direction: "rtl" as const,
      markedMarkdown: "אבג **abc** דהו",
      mode: "end" as const,
      text: "abc",
      visibleText: "אבג abc דהו",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const markedId = `bidi-sequence-marked-${index}`;
    const plainId = `bidi-sequence-plain-${index}`;
    await mountEditor(labPage, {
      direction: testCase.direction,
      id: plainId,
      markdown: testCase.visibleText,
    });
    await mountEditor(labPage, {
      direction: testCase.direction,
      id: markedId,
      markdown: testCase.markedMarkdown,
    });

    const collectProgression = async (id: string) => {
      await selectTextBoundary(labPage, id, testCase.text, testCase.mode);
      const positions = [(await snapshotEditor(labPage, id)).selection.head];
      for (let step = 0; step < 10; step += 1) {
        await labPage.keyboard.press(testCase.arrow);
        await settleEditor(labPage, id);
        positions.push((await snapshotEditor(labPage, id)).selection.head);
      }
      return positions.filter((position, positionIndex) => (
        positionIndex === 0 || position !== positions[positionIndex - 1]
      ));
    };

    const plainProgression = await collectProgression(plainId);

    await selectTextBoundary(labPage, markedId, testCase.text, testCase.mode);
    const boundaryHead = (await snapshotEditor(labPage, markedId)).selection.head;
    await labPage.keyboard.press(testCase.arrow);
    await settleEditor(labPage, markedId);
    expect((await snapshotEditor(labPage, markedId)).selection.head).toBe(boundaryHead);
    await expect(editorLocator(labPage, markedId).locator(".mdw-marker-strong")).toHaveCount(0);

    const markedPositions = [boundaryHead];
    for (let step = 0; step < 10; step += 1) {
      await labPage.keyboard.press(testCase.arrow);
      await settleEditor(labPage, markedId);
      markedPositions.push((await snapshotEditor(labPage, markedId)).selection.head);
    }
    const markedProgression = markedPositions.filter((position, positionIndex) => (
      positionIndex === 0 || position !== markedPositions[positionIndex - 1]
    ));

    // WebKit can consume an arrow press to change an internal bidi caret level
    // without changing the model position. Compare the native position order,
    // rather than the number of keypresses needed to traverse that order.
    expect(markedProgression, JSON.stringify(testCase)).toEqual(plainProgression);
  }
});

test("@required RTL tables exit and re-enter on their physical visual edges", async ({ labPage }) => {
  const id = "rtl-table-boundaries";
  await mountEditor(labPage, {
    direction: "rtl",
    id,
    markdown: [
      "| ראשון | שני |",
      "| --- | --- |",
      "| א | ב |",
    ].join("\n"),
  });
  const editor = editorLocator(labPage, id);
  const table = editor.locator(".mdw-table-scroll");

  await selectTextBoundary(labPage, id, "ראשון", "start");
  await labPage.keyboard.press("ArrowRight");
  await expect(table).toHaveClass(/mdw-managed-block-cursor-before/);

  await labPage.keyboard.press("ArrowLeft");
  await expect(table).not.toHaveClass(/mdw-managed-block-cursor/);

  await selectTextBoundary(labPage, id, "ב", "end");
  await labPage.keyboard.press("ArrowLeft");
  await expect(table).toHaveClass(/mdw-managed-block-cursor-after/);

  await labPage.keyboard.press("ArrowRight");
  await expect(table).not.toHaveClass(/mdw-managed-block-cursor/);
});

test("@required active RTL and mixed-bidi code blocks use physical visual edges", async ({ labPage }) => {
  await labPage.addStyleTag({
    content: [
      '[data-e2e-editor^="rtl-code-"] .cm-editor,',
      '[data-e2e-editor^="rtl-code-"] .cm-content,',
      '[data-e2e-editor^="rtl-code-"] .cm-line {',
      "  direction: rtl !important;",
      "}",
    ].join("\n"),
  });

  const beforeId = "rtl-code-before";
  const afterId = "rtl-code-after";
  const mixedId = "mixed-code-before";
  const markdown = ["```", "אבג", "```"].join("\n");
  await mountEditor(labPage, { direction: "rtl", id: beforeId, markdown });
  await mountEditor(labPage, { direction: "rtl", id: afterId, markdown });
  await mountEditor(labPage, {
    direction: "ltr",
    id: mixedId,
    markdown: ["```", "אבג abc", "```"].join("\n"),
  });

  const beforeEditor = editorLocator(labPage, beforeId);
  const beforeCode = beforeEditor.locator(".cm-content");
  await expect(beforeCode).toBeVisible();
  await beforeCode.click();
  await labPage.keyboard.press("Home");
  await labPage.keyboard.press("ArrowRight");
  await expect(beforeEditor.locator(".mdw-code-block")).toHaveClass(/mdw-managed-block-cursor-before/);

  const afterEditor = editorLocator(labPage, afterId);
  const afterCode = afterEditor.locator(".cm-content");
  await expect(afterCode).toBeVisible();
  await afterCode.click();
  await labPage.keyboard.press("End");
  await labPage.keyboard.press("ArrowLeft");
  await expect(afterEditor.locator(".mdw-code-block")).toHaveClass(/mdw-managed-block-cursor-after/);

  // The visual leading edge of an opposing RTL run can be an internal
  // logical position, so this specifically guards against offset-only exits.
  const mixedEditor = editorLocator(labPage, mixedId);
  const mixedCode = mixedEditor.locator(".cm-content");
  await expect(mixedCode).toBeVisible();
  await mixedCode.click();
  await labPage.keyboard.press("Home");
  for (let step = 0; step < 4; step += 1) {
    await labPage.keyboard.press("ArrowLeft");
  }
  await expect(mixedEditor.locator(".mdw-code-block")).toHaveClass(/mdw-managed-block-cursor-before/);
});
