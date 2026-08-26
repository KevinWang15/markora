import {
  editorLocator,
  expect,
  mountEditor,
  resetEditor,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

test("@required trusted single-click caret placement survives revealed inline markers", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "single-click-caret";
  await mountEditor(labPage, { id, markdown: "", root: "shadow" });
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;

  const clickCharacter = async (
    markdown: string,
    needle: string,
    offset: number,
    fraction: number,
    initialSelection?: "all",
  ) => {
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const editorBox = await editorLocator(labPage, id).boundingBox();
    const paragraphBox = await editorLocator(labPage, id).locator("p").boundingBox();

    if (!editorBox || !paragraphBox) {
      throw new Error("Missing editor geometry for the single-click primer.");
    }

    // ProseMirror recognizes multi-clicks from its own timing and coordinate
    // history, independently of MouseEvent.detail. Prime that history well
    // away from the target so every measured press is a genuine single click.
    await labPage.mouse.click(
      editorBox.x + editorBox.width - 8,
      paragraphBox.y + paragraphBox.height / 2,
    );
    await resetEditor(labPage, id, markdown);
    await settleEditor(labPage, id);
    const point = await editorLocator(labPage, id).evaluate(
      (element, target) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text: Text | null = null;

        while (walker.nextNode()) {
          const candidate = walker.currentNode as Text;
          if (candidate.data === target.needle) {
            text = candidate;
            break;
          }
        }

        if (!text) {
          throw new Error(`Missing ${JSON.stringify(target.needle)} text node.`);
        }

        const range = element.ownerDocument.createRange();
        range.setStart(text, target.offset);
        range.setEnd(text, target.offset + 1);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * target.fraction,
          y: rect.top + rect.height / 2,
        };
      },
      { fraction, needle, offset },
    );

    if (initialSelection) {
      await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, "all"),
        id,
      );
      await labPage.mouse.click(1, 1);
      await settleEditor(labPage, id);
    }

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
    await settleEditor(labPage, id);

    return {
      focused: await editorLocator(labPage, id).evaluate(element => element.matches(":focus")),
      markdown: (await snapshotEditor(labPage, id)).markdown,
      selection: (await snapshotEditor(labPage, id)).selection,
    };
  };

  for (const testCase of [
    { marked: "pre**fixmid**suffix", needle: "fixmid" },
    { marked: "pre*fixmid*suffix", needle: "fixmid" },
    { marked: "pre`fixmid`suffix", needle: "fixmid" },
    { marked: "pre~~fixmid~~suffix", needle: "fixmid" },
    { marked: "pre[fixmid](/target)suffix", needle: "fixmid" },
  ]) {
    for (const offset of [0, 2, 5]) {
      for (const fraction of [0.2, 0.8]) {
        const plain = await clickCharacter("prefixmidsuffix", "prefixmidsuffix", offset + 3, fraction);
        const marked = await clickCharacter(testCase.marked, testCase.needle, offset, fraction);
        expect(marked, `${testCase.marked} offset ${offset} fraction ${fraction}`).toEqual({
          ...plain,
          markdown: testCase.marked,
        });
      }
    }
  }

  const plainFromRange = await clickCharacter(
    "prefixmidsuffix",
    "prefixmidsuffix",
    3,
    0.2,
    "all",
  );
  const markedFromRange = await clickCharacter(
    "pre**fixmid**suffix",
    "fixmid",
    0,
    0.2,
    "all",
  );
  expect(markedFromRange).toEqual({
    ...plainFromRange,
    markdown: "pre**fixmid**suffix",
  });

  await cdp?.detach();
});
