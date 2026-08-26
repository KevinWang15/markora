import {
  editorLocator,
  expect,
  mountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

test("@required nested, bidi, and wrapped text retain exact trusted caret hit-testing", async ({
  browserName,
  context,
  labPage,
}) => {
  const ltrId = "visual-caret-ltr";
  const rtlId = "visual-caret-rtl";
  const wrappedId = "visual-caret-wrapped";
  await mountEditor(labPage, { id: ltrId, markdown: "", root: "shadow" });
  await mountEditor(labPage, { direction: "rtl", id: rtlId, markdown: "", root: "shadow" });
  await mountEditor(labPage, { id: wrappedId, markdown: "", root: "shadow" });
  await editorLocator(labPage, wrappedId).evaluate((element) => {
    element.setAttribute("style", "box-sizing: border-box; font: 16px/24px monospace; width: 168px;");
    const style = element.ownerDocument.createElement("style");
    style.textContent = [
      ".ProseMirror :is(strong, em, code, s, a) {",
      "  font: inherit !important;",
      "  letter-spacing: inherit !important;",
      "  padding: 0 !important;",
      "}",
    ].join("\n");
    element.getRootNode().appendChild(style);
  });
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  const clickCharacter = async (options: {
    fraction: number;
    id: string;
    markdown: string;
    needle: string;
    offset: number;
    rangeLength?: number;
  }) => {
    await resetEditor(labPage, options.id, options.markdown);
    await settleEditor(labPage, options.id);
    await editorLocator(labPage, options.id).scrollIntoViewIfNeeded();
    const locate = () => editorLocator(labPage, options.id).evaluate(
      (element, target) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          if (text.data !== target.needle) continue;
          const range = element.ownerDocument.createRange();
          range.setStart(text, target.offset);
          range.setEnd(text, target.offset + (target.rangeLength ?? 1));
          const rect = range.getBoundingClientRect();
          return {
            x: rect.left + rect.width * target.fraction,
            y: rect.top + rect.height / 2,
          };
        }
        throw new Error(`Missing ${JSON.stringify(target.needle)} text node.`);
      },
      options,
    );
    const initialPoint = await locate();
    const box = await editorLocator(labPage, options.id).boundingBox();
    if (!box) throw new Error("Missing visual-caret editor geometry.");
    const primeX = initialPoint.x < box.x + box.width / 2
      ? box.x + box.width - 4
      : box.x + 4;
    await labPage.mouse.click(primeX, initialPoint.y);
    await resetEditor(labPage, options.id, options.markdown);
    await settleEditor(labPage, options.id);
    const point = await locate();
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "none",
        buttons: 0,
        type: "mouseMoved",
        x: point.x,
        y: point.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 1,
        type: "mousePressed",
        x: point.x,
        y: point.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 1,
        type: "mouseReleased",
        x: point.x,
        y: point.y,
      });
    } else {
      await labPage.mouse.click(point.x, point.y);
    }
    await settleEditor(labPage, options.id);
    return {
      focused: await editorLocator(labPage, options.id).evaluate(element => element.matches(":focus")),
      markdown: (await snapshotEditor(labPage, options.id)).markdown,
      selection: (await snapshotEditor(labPage, options.id)).selection,
    };
  };

  for (const testCase of [
    {
      id: ltrId,
      marked: "pre***fixmid***suffix",
      markedNeedle: "fixmid",
      plain: "prefixmidsuffix",
      plainNeedle: "prefixmidsuffix",
      plainOffset: 3,
    },
    {
      id: ltrId,
      expectedMarked: "pre**[fixmid](/target)**suffix",
      marked: "pre[**fixmid**](/target)suffix",
      markedNeedle: "fixmid",
      plain: "prefixmidsuffix",
      plainNeedle: "prefixmidsuffix",
      plainOffset: 3,
    },
    {
      id: rtlId,
      marked: "אבג**דהו**זחט",
      markedNeedle: "דהו",
      plain: "אבגדהוזחט",
      plainNeedle: "אבגדהוזחט",
      plainOffset: 3,
    },
    {
      id: ltrId,
      marked: "pre**e\u0301mid**suffix",
      markedNeedle: "e\u0301mid",
      offsets: [0],
      plain: "pree\u0301midsuffix",
      plainNeedle: "pree\u0301midsuffix",
      plainOffset: 3,
      rangeLength: 2,
    },
    {
      id: ltrId,
      marked: "pre**👩‍💻mid**suffix",
      markedNeedle: "👩‍💻mid",
      offsets: [0],
      plain: "pre👩‍💻midsuffix",
      plainNeedle: "pre👩‍💻midsuffix",
      plainOffset: 3,
      rangeLength: 5,
      requireExactSide: false,
    },
    {
      id: rtlId,
      marked: "ابت**ثجح**خدذ",
      markedNeedle: "ثجح",
      plain: "ابتثجحخدذ",
      plainNeedle: "ابتثجحخدذ",
      plainOffset: 3,
    },
    {
      id: wrappedId,
      marked: "aaaaa bbbbb **ccccc ddddd** eeeee fffff",
      markedNeedle: "ccccc ddddd",
      plain: "aaaaa bbbbb ccccc ddddd eeeee fffff",
      plainNeedle: "aaaaa bbbbb ccccc ddddd eeeee fffff",
      plainOffset: 12,
    },
  ]) {
    for (const markedOffset of (
      "offsets" in testCase && testCase.offsets
        ? testCase.offsets
        : [0, 2]
    )) {
      for (const fraction of [0.2, 0.8]) {
        const plain = await clickCharacter({
          fraction,
          id: testCase.id,
          markdown: testCase.plain,
          needle: testCase.plainNeedle,
          offset: testCase.plainOffset + markedOffset,
          rangeLength: "rangeLength" in testCase ? testCase.rangeLength : undefined,
        });
        const marked = await clickCharacter({
          fraction,
          id: testCase.id,
          markdown: testCase.marked,
          needle: testCase.markedNeedle,
          offset: markedOffset,
          rangeLength: "rangeLength" in testCase ? testCase.rangeLength : undefined,
        });
        expect(
          marked,
          `${testCase.marked} offset ${markedOffset} fraction ${fraction}`,
        ).toEqual({
          ...plain,
          markdown: "expectedMarked" in testCase
            ? testCase.expectedMarked
            : testCase.marked,
        });
        const rangeLength = "rangeLength" in testCase
          ? testCase.rangeLength ?? 1
          : 1;
        const before = 1 + testCase.plainOffset + markedOffset;
        const after = before + rangeLength;
        const expectedPosition = testCase.id === rtlId
          ? fraction < 0.5 ? after : before
          : fraction < 0.5 ? before : after;
        if (!("requireExactSide" in testCase) || testCase.requireExactSide) {
          expect(
            marked.selection,
            `${testCase.marked} logical offset ${markedOffset} fraction ${fraction}`,
          ).toEqual({
            anchor: expectedPosition,
            from: expectedPosition,
            head: expectedPosition,
            to: expectedPosition,
          });
        } else {
          expect(
            marked.selection.from <= before || marked.selection.from >= after,
            `${testCase.marked} must not split its ZWJ grapheme`,
          ).toBe(true);
        }
      }
    }
  }

  await cdp?.detach();
});
