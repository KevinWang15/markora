import {
  editorLocator,
  expect,
  mountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

test("@required trusted visual ranges survive marked layout changes", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "visual-range";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  await editorLocator(labPage, id).evaluate((element) => {
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

  const point = async (needle: string, offset: number, fraction: number) => (
    editorLocator(labPage, id).evaluate((element, target) => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (text.data !== target.needle) continue;
        const range = element.ownerDocument.createRange();
        range.setStart(text, target.offset);
        range.setEnd(text, target.offset + 1);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * target.fraction,
          y: rect.top + rect.height / 2,
        };
      }
      throw new Error(`Missing ${JSON.stringify(target.needle)} text node.`);
    }, { fraction, needle, offset })
  );

  const drag = async (options: {
    endFraction: number;
    endNeedle: string;
    endOffset: number;
    markdown: string;
    startFraction: number;
    startNeedle: string;
    startOffset: number;
  }) => {
    await labPage.mouse.click(1, 1);
    await resetEditor(labPage, id, options.markdown);
    await settleEditor(labPage, id);
    await editorLocator(labPage, id).scrollIntoViewIfNeeded();
    const start = await point(options.startNeedle, options.startOffset, options.startFraction);
    if (cdp) {
      await cdp.send("Input.dispatchMouseEvent", {
        button: "none",
        buttons: 0,
        type: "mouseMoved",
        x: start.x,
        y: start.y,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 1,
        type: "mousePressed",
        x: start.x,
        y: start.y,
      });
    } else {
      await labPage.mouse.move(start.x, start.y);
      await labPage.mouse.down();
    }
    const end = await point(options.endNeedle, options.endOffset, options.endFraction);
    if (cdp) {
      for (let step = 1; step <= 20; step += 1) {
        const progress = step / 20;
        await cdp.send("Input.dispatchMouseEvent", {
          button: "left",
          buttons: 1,
          type: "mouseMoved",
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        });
      }
      await cdp.send("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 1,
        type: "mouseReleased",
        x: end.x,
        y: end.y,
      });
    } else {
      await labPage.mouse.move(end.x, end.y, { steps: 20 });
      await labPage.mouse.up();
    }
    await settleEditor(labPage, id);
    return {
      focused: await editorLocator(labPage, id).evaluate(element => element.matches(":focus")),
      markdown: (await snapshotEditor(labPage, id)).markdown,
      selection: (await snapshotEditor(labPage, id)).selection,
      text: await editorLocator(labPage, id).evaluate(
        element => element.ownerDocument.getSelection()?.toString() ?? "",
      ),
    };
  };

  for (const testCase of [
    {
      marked: "pre***fixmid***suffix",
      markedNeedle: "fixmid",
      plain: "prefixmidsuffix",
      plainNeedle: "prefixmidsuffix",
      plainOffset: 3,
    },
    {
      expectedMarked: "pre**[fixmid](/target)**suffix",
      marked: "pre[**fixmid**](/target)suffix",
      markedNeedle: "fixmid",
      plain: "prefixmidsuffix",
      plainNeedle: "prefixmidsuffix",
      plainOffset: 3,
    },
    {
      marked: "אבג**דהו**זחט",
      markedNeedle: "דהו",
      plain: "אבגדהוזחט",
      plainNeedle: "אבגדהוזחט",
      plainOffset: 3,
    },
    {
      marked: "ابت**ثجح**خدذ",
      markedNeedle: "ثجح",
      plain: "ابتثجحخدذ",
      plainNeedle: "ابتثجحخدذ",
      plainOffset: 3,
    },
    {
      marked: "aaaaa bbbbb **ccccc ddddd** eeeee fffff",
      markedNeedle: "ccccc ddddd",
      plain: "aaaaa bbbbb ccccc ddddd eeeee fffff",
      plainNeedle: "aaaaa bbbbb ccccc ddddd eeeee fffff",
      plainOffset: 12,
    },
  ]) {
    for (const backward of [false, true]) {
      const startOffset = backward ? 2 : 0;
      const endOffset = backward ? 0 : 2;
      const startFraction = backward ? 0.8 : 0.2;
      const endFraction = backward ? 0.2 : 0.8;
      const plain = await drag({
        endFraction,
        endNeedle: testCase.plainNeedle,
        endOffset: testCase.plainOffset + endOffset,
        markdown: testCase.plain,
        startFraction,
        startNeedle: testCase.plainNeedle,
        startOffset: testCase.plainOffset + startOffset,
      });
      const marked = await drag({
        endFraction,
        endNeedle: testCase.markedNeedle,
        endOffset,
        markdown: testCase.marked,
        startFraction,
        startNeedle: testCase.markedNeedle,
        startOffset,
      });
      expect.soft(
        marked,
        `${testCase.marked} backward=${backward}`,
      ).toEqual({
        ...plain,
        markdown: "expectedMarked" in testCase
          ? testCase.expectedMarked
          : testCase.marked,
      });
    }
  }

  await cdp?.detach();
});
