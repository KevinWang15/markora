import type { Locator } from "@playwright/test";
import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  runEditorCommand,
  settleEditor,
  test,
} from "./fixtures";

test("@required atomic image and rule boundaries remain deterministic", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressKey = async (
    key: "ArrowLeft" | "ArrowRight" | "Backspace" | "Delete",
  ) => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const keyCode = key === "Backspace" ? 8
      : key === "Delete" ? 46
        : key === "ArrowLeft" ? 37 : 39;

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
  const clickPoint = async (x: number, y: number) => {
    if (!cdp) {
      await labPage.mouse.click(x, y);
      return;
    }

    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      type: "mouseMoved",
      x,
      y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x,
      y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x,
      y,
    });
  };
  const typeText = async (text: string) => {
    if (cdp) {
      await cdp.send("Input.insertText", { text });
    } else {
      await labPage.keyboard.insertText(text);
    }
  };
  const imageMarkdown = [
    "before![alt](data:image/gif;base64,",
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)after",
  ].join("");
  const ruleMarkdown = "before\n\n---\n\nafter";
  const removedImage = "beforeafter";
  const removedRule = "before\n\nafter";

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `atomic-boundary-${entry}`;
      await mountEditor(labPage, { entry, id, markdown: "", root: "shadow" });
      const editor = editorLocator(labPage, id);
      const selectText = async (text: string, mode: "end" | "start") => {
        expect(await labPage.evaluate(({ editorId, selectionMode, target }) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(
            editorId,
            target,
            selectionMode,
          )
        ), { editorId: id, selectionMode: mode, target: text })).toBe(true);
      };
      const clickAtom = async (markdown: string, target: Locator) => {
        await resetEditor(labPage, id, markdown);
        await settleEditor(labPage, id);
        const editorBox = await editor.boundingBox();
        const firstBlockBox = await editor.locator(":scope > *").first().boundingBox();

        if (!editorBox || !firstBlockBox) {
          throw new Error("Missing editor geometry for the atomic click primer.");
        }

        await clickPoint(
          editorBox.x + editorBox.width - 4,
          firstBlockBox.y + Math.min(4, firstBlockBox.height / 2),
        );
        await resetEditor(labPage, id, markdown);
        await settleEditor(labPage, id);
        const box = await target.boundingBox();

        if (!box) {
          throw new Error("Missing atomic target geometry.");
        }

        await clickPoint(box.x + box.width / 2, box.y + box.height / 2);
        await settleEditor(labPage, id);
        await expect(editor).toBeFocused();
        await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(1);
      };
      const undoTo = async (markdown: string) => {
        expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(markdown);
      };

      for (const scenario of [
        { key: "Delete", mode: "end", target: "before" },
        { key: "Backspace", mode: "start", target: "after" },
      ] as const) {
        await resetEditor(labPage, id, imageMarkdown);
        await selectText(scenario.target, scenario.mode);
        await pressKey(scenario.key);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(removedImage);
        await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(0);
        await undoTo(imageMarkdown);
      }

      for (const key of ["Backspace", "Delete"] as const) {
        await clickAtom(imageMarkdown, editor.locator(".mdw-image"));
        await pressKey(key);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(removedImage);
        await undoTo(imageMarkdown);

        await clickAtom(ruleMarkdown, editor.locator("hr"));
        await pressKey(key);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(removedRule);
        await undoTo(ruleMarkdown);
      }

      for (const scenario of [
        { deleteKey: "Delete", direction: "ArrowRight", mode: "end", target: "before" },
        { deleteKey: "Backspace", direction: "ArrowLeft", mode: "start", target: "after" },
      ] as const) {
        await resetEditor(labPage, id, imageMarkdown);
        await selectText(scenario.target, scenario.mode);
        await pressKey(scenario.direction);
        await settleEditor(labPage, id);
        await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(1);
        expect(await getMarkdown(labPage, id)).toBe(imageMarkdown);
        await pressKey(scenario.deleteKey);
        await settleEditor(labPage, id);
        expect(await getMarkdown(labPage, id)).toBe(removedImage);
        await undoTo(imageMarkdown);
      }

      await clickAtom(imageMarkdown, editor.locator(".mdw-image"));
      await typeText("x");
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe("beforexafter");
      await undoTo(imageMarkdown);
    }
  } finally {
    await cdp?.detach();
  }
});
