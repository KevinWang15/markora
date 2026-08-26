import {
  clearEditorEvents,
  editorLocator,
  expect,
  getEditorEvents,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required visual-line navigation ignores revealed Markdown marker geometry", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "marked-vertical-navigation";
  const editor = editorLocator(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const visibleLine = "0123456789abcdefghij";
  const plain = [visibleLine, visibleLine, visibleLine].join("\n\n");
  const markedLines = [
    "01234**56789abcde**fghij",
    "01234*56789abcde*fghij",
    "01234`56789abcde`fghij",
    "01234~~56789abcde~~fghij",
    "01234[56789abcde](/vertical-navigation)fghij",
    "01234[**56789abcde**](/nested-vertical-navigation)fghij",
  ];

  await mountEditor(labPage, { id, markdown: "" });
  await editor.evaluate((element) => {
    const target = element as HTMLElement;
    const style = target.ownerDocument.createElement("style");
    style.textContent = `
      [data-e2e-editor="marked-vertical-navigation"] .ProseMirror
      :is(strong, em, code, s, a) {
        font: inherit !important;
        letter-spacing: inherit !important;
        padding: 0 !important;
      }
    `;
    target.ownerDocument.head.append(style);
    target.style.fontFamily = "monospace";
    target.style.fontSize = "16px";
    target.style.lineHeight = "24px";
    target.style.width = "500px";
  });

  const pressVisualLineKey = async (
    key: "ArrowDown" | "ArrowUp" | "End" | "Home",
    extend: boolean,
  ) => {
    if (!cdp) {
      await labPage.keyboard.press(`${extend ? "Shift+" : ""}${key}`);
      return;
    }

    const keyCode = {
      ArrowDown: 40,
      ArrowUp: 38,
      End: 35,
      Home: 36,
    }[key];
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: extend ? 8 : 0,
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };

  const navigate = async (
    markdown: string,
    occurrence: number,
    key: "ArrowDown" | "ArrowUp" | "End" | "Home",
    extend: boolean,
    needle = "abcde",
  ) => {
    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(({ editorId, nextNeedle, nextOccurrence }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(
        editorId,
        nextNeedle,
        "start",
        nextOccurrence,
      )
    ), { editorId: id, nextNeedle: needle, nextOccurrence: occurrence })).toBe(true);
    await settleEditor(labPage, id);
    const normalizedMarkdown = await getMarkdown(labPage, id);
    await clearEditorEvents(labPage, id);
    await editor.evaluate((element) => {
      const targetWindow = window as Window & {
        __markoraVisualLineKey?: {
          defaultPrevented: boolean;
          isTrusted: boolean;
          key: string;
        };
      };
      delete targetWindow.__markoraVisualLineKey;
      const onKeyDown = (rawEvent: Event) => {
        const event = rawEvent as KeyboardEvent;
        if (!["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) return;
        element.removeEventListener("keydown", onKeyDown);
        queueMicrotask(() => {
          targetWindow.__markoraVisualLineKey = {
            defaultPrevented: event.defaultPrevented,
            isTrusted: event.isTrusted,
            key: event.key,
          };
        });
      };
      element.addEventListener("keydown", onKeyDown);
    });
    await pressVisualLineKey(key, extend);
    await settleEditor(labPage, id);
    await expect(editor).toBeFocused();
    await expect(editor).not.toHaveClass(/mdw-native-visual-line-motion/);
    expect(await getMarkdown(labPage, id)).toBe(normalizedMarkdown);
    const events = await getEditorEvents(labPage, id);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    expect(await labPage.evaluate(() => {
      const targetWindow = window as Window & {
        __markoraVisualLineKey?: {
          defaultPrevented: boolean;
          isTrusted: boolean;
          key: string;
        };
      };
      const record = targetWindow.__markoraVisualLineKey ?? null;
      delete targetWindow.__markoraVisualLineKey;
      return record;
    })).toEqual({ defaultPrevented: false, isTrusted: true, key });
    return labPage.evaluate((editorId) => ({
      nativeText: document.getSelection()?.toString() ?? "",
      selection: window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
    }), id);
  };

  for (const testCase of [
    { key: "ArrowDown", occurrence: 0 },
    { key: "ArrowUp", occurrence: 2 },
  ] as const) {
    for (const extend of [false, true]) {
      const plainResult = await navigate(
        plain,
        testCase.occurrence,
        testCase.key,
        extend,
      );

      for (const markedLine of markedLines) {
        const marked = [markedLine, markedLine, markedLine].join("\n\n");
        expect(await navigate(
          marked,
          testCase.occurrence,
          testCase.key,
          extend,
        )).toEqual(plainResult);
      }
    }
  }

  const wrappedVisible = "0123456789abcdefghijABCDEFGHIJklmnopqrstUVWXYZabcd";
  const wrappedMarked = [
    `**${wrappedVisible}**`,
    `*${wrappedVisible}*`,
    `\`${wrappedVisible}\``,
    `~~${wrappedVisible}~~`,
    `[${wrappedVisible}](/wrapped-line-edge-navigation)`,
    `[**${wrappedVisible}**](/nested-wrapped-line-edge-navigation)`,
  ];
  await editor.evaluate((element) => {
    (element as HTMLElement).style.width = "170px";
  });

  for (const testCase of [
    { key: "ArrowDown", needle: "abcde" },
    { key: "ArrowUp", needle: "klmno" },
  ] as const) {
    for (const extend of [false, true]) {
      const plainResult = await navigate(
        wrappedVisible,
        0,
        testCase.key,
        extend,
        testCase.needle,
      );
      expect(await navigate(
        `**${wrappedVisible}**`,
        0,
        testCase.key,
        extend,
        testCase.needle,
      )).toEqual(plainResult);
    }
  }

  for (const key of ["Home", "End"] as const) {
    for (const extend of [false, true]) {
      const plainResult = await navigate(
        wrappedVisible,
        0,
        key,
        extend,
        "klmno",
      );
      for (const marked of wrappedMarked) {
        expect(await navigate(
          marked,
          0,
          key,
          extend,
          "klmno",
        )).toEqual(plainResult);
      }
    }
  }

  await cdp?.detach();
});
