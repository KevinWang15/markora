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

test("@required page and document navigation ignore Markdown mark boundaries", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "page-document-navigation";
  const editor = editorLocator(labPage, id);
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const visibleLine = "0123456789abcdefghij";

  await mountEditor(labPage, { id, markdown: "" });
  await editor.evaluate((element) => {
    const target = element as HTMLElement;
    const style = target.ownerDocument.createElement("style");
    style.textContent = `
      [data-e2e-editor="page-document-navigation"] .ProseMirror
      :is(strong, em, code, s, a) {
        font: inherit !important;
        letter-spacing: inherit !important;
        padding: 0 !important;
      }
    `;
    target.ownerDocument.head.append(style);
    target.style.fontFamily = "monospace";
    target.style.fontSize = "16px";
    target.style.height = "160px";
    target.style.lineHeight = "24px";
    target.style.overflowY = "auto";
    target.style.width = "500px";
  });

  const press = async (
    key: "End" | "Home" | "PageDown" | "PageUp",
    extend: boolean,
    documentBoundary: boolean,
  ) => {
    if (!cdp) {
      await labPage.keyboard.press([
        documentBoundary ? "Control" : "",
        extend ? "Shift" : "",
        key,
      ].filter(Boolean).join("+"));
      return;
    }

    const keyCode = { End: 35, Home: 36, PageDown: 34, PageUp: 33 }[key];
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: (documentBoundary ? 2 : 0) | (extend ? 8 : 0),
        nativeVirtualKeyCode: keyCode,
        type,
        windowsVirtualKeyCode: keyCode,
      });
    }
  };

  const navigate = async (
    markdown: string,
    occurrence: number,
    key: "End" | "Home" | "PageDown" | "PageUp",
    extend: boolean,
    documentBoundary: boolean,
  ) => {
    await resetEditor(labPage, id, markdown);
    expect(await labPage.evaluate(({ editorId, nextOccurrence }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(
        editorId,
        "abcde",
        "start",
        nextOccurrence,
      )
    ), { editorId: id, nextOccurrence: occurrence })).toBe(true);
    await settleEditor(labPage, id);
    const normalizedMarkdown = await getMarkdown(labPage, id);
    await clearEditorEvents(labPage, id);
    await editor.evaluate((element) => {
      const targetWindow = window as Window & {
        __markoraPageDocumentKey?: {
          defaultPrevented: boolean;
          isTrusted: boolean;
          key: string;
        };
      };
      delete targetWindow.__markoraPageDocumentKey;
      const onKeyDown = (rawEvent: Event) => {
        const event = rawEvent as KeyboardEvent;
        if (!["End", "Home", "PageDown", "PageUp"].includes(event.key)) return;
        element.removeEventListener("keydown", onKeyDown);
        queueMicrotask(() => {
          targetWindow.__markoraPageDocumentKey = {
            defaultPrevented: event.defaultPrevented,
            isTrusted: event.isTrusted,
            key: event.key,
          };
        });
      };
      element.addEventListener("keydown", onKeyDown);
    });
    await press(key, extend, documentBoundary);
    await settleEditor(labPage, id);
    await expect(editor).toBeFocused();
    await expect(editor).not.toHaveClass(/mdw-native-visual-motion/);
    expect(await getMarkdown(labPage, id)).toBe(normalizedMarkdown);
    const events = await getEditorEvents(labPage, id);
    expect(events.counts.focus).toBe(0);
    expect(events.counts.blur).toBe(0);
    expect(await labPage.evaluate(() => {
      const targetWindow = window as Window & {
        __markoraPageDocumentKey?: {
          defaultPrevented: boolean;
          isTrusted: boolean;
          key: string;
        };
      };
      const record = targetWindow.__markoraPageDocumentKey ?? null;
      delete targetWindow.__markoraPageDocumentKey;
      return record;
    })).toEqual({ defaultPrevented: false, isTrusted: true, key });
    return labPage.evaluate((editorId) => ({
      nativeText: document.getSelection()?.toString() ?? "",
      selection: window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
    }), id);
  };

  const plainPage = Array.from({ length: 30 }, () => visibleLine).join("\n\n");
  const markedLines = [
    "01234**56789abcde**fghij",
    "01234[56789abcde](/page-navigation)fghij",
    "01234[**56789abcde**](/nested-page-navigation)fghij",
  ];
  for (const testCase of [
    { key: "PageDown", occurrence: 5 },
    { key: "PageUp", occurrence: 24 },
  ] as const) {
    for (const extend of [false, true]) {
      const plainResult = await navigate(
        plainPage,
        testCase.occurrence,
        testCase.key,
        extend,
        false,
      );
      for (const markedLine of markedLines) {
        const markedPage = Array.from({ length: 30 }, () => markedLine).join("\n\n");
        expect(await navigate(
          markedPage,
          testCase.occurrence,
          testCase.key,
          extend,
          false,
        )).toEqual(plainResult);
      }
    }
  }

  const plainDocument = [visibleLine, visibleLine, visibleLine].join("\n\n");
  for (const key of ["Home", "End"] as const) {
    for (const extend of [false, true]) {
      const plainResult = await navigate(
        plainDocument,
        1,
        key,
        extend,
        true,
      );
      for (const markedLine of markedLines) {
        const markedDocument = [markedLine, markedLine, markedLine].join("\n\n");
        expect(await navigate(
          markedDocument,
          1,
          key,
          extend,
          true,
        )).toEqual(plainResult);
      }
    }
  }

  await cdp?.detach();
});
