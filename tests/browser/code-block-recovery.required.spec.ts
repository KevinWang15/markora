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

test("@required Backspace unwraps a code block at its first caret in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = ["```js", "alpha", "beta", "```"].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressKey = async (key: "Backspace" | "Home") => {
    if (!cdp) {
      await labPage.keyboard.press(key);
      return;
    }

    const virtualKeyCode = key === "Backspace" ? 8 : 36;

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        nativeVirtualKeyCode: virtualKeyCode,
        type,
        windowsVirtualKeyCode: virtualKeyCode,
      });
    }
  };

  try {
    for (const entry of ["root", "minimal"] as const) {
      const id = `code-block-recovery-${entry}`;
      await mountEditor(labPage, {
        entry,
        id,
        markdown: original,
        root: "shadow",
      });
      const editor = editorLocator(labPage, id);

      if (entry === "root") {
        await editor.locator(".cm-line").first().click();
      } else {
        await editor.evaluate((element) => {
          // Exercise the WebKit focus-restoration race: real key handlers
          // can keep the main thread busy while the native caret is moving.
          element.addEventListener("keydown", () => {
            const until = performance.now() + 20;
            while (performance.now() < until) { /* simulate synchronous plugin work */ }
          }, { capture: true, once: true });
        });
        await editor.locator("pre").click({ position: { x: 8, y: 8 } });
      }
      await pressKey("Home");
      await settleEditor(labPage, id);
      if (entry === "root") {
        await expect(editor.locator(".cm-content")).toBeFocused();
      } else {
        await expect(editor).toBeFocused();
      }
      expect((await labPage.evaluate(
        (editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId).selection,
        id,
      )).anchor).toBe(1);
      await pressKey("Backspace");
      await settleEditor(labPage, id);

      expect(await getMarkdown(labPage, id)).toBe("alpha\n\nbeta");
      await expect(editor.locator("pre, .cm-editor")).toHaveCount(0);
      await expect(editor.locator("p")).toHaveCount(2);
      await expect(editor).toBeFocused();

      expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
      await settleEditor(labPage, id);
      expect(await getMarkdown(labPage, id)).toBe(original);

      const empty = ["```js", "", "```"].join("\n");
      await resetEditor(labPage, id, empty);
      if (entry === "root") {
        await editor.locator(".cm-line").click();
      } else {
        await editor.locator("pre").click({ position: { x: 8, y: 8 } });
      }
      await pressKey("Home");
      await settleEditor(labPage, id);
      if (entry === "root") {
        await expect(editor.locator(".cm-content")).toBeFocused();
      } else {
        await expect(editor).toBeFocused();
      }
      await pressKey("Backspace");
      await settleEditor(labPage, id);

      expect(await getMarkdown(labPage, id)).toBe("");
      await expect(editor.locator("pre, .cm-editor")).toHaveCount(0);
      await expect(editor.locator("p")).toHaveCount(1);
    }
  } finally {
    await cdp?.detach();
  }
});

test("@required native code-line Home and End preserve selection and wrapped-line navigation", async ({
  browserName,
  context,
  labPage,
}) => {
  const cdp = browserName === "chromium" ? await context.newCDPSession(labPage) : null;
  const pressKey = async (key: "Home" | "End", extend = false) => {
    if (!cdp) {
      await labPage.keyboard.press(`${extend ? "Shift+" : ""}${key}`);
      return;
    }
    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: key,
        key,
        modifiers: extend ? 8 : 0,
        nativeVirtualKeyCode: key === "Home" ? 36 : 35,
        windowsVirtualKeyCode: key === "Home" ? 36 : 35,
        type,
      });
    }
  };

  try {
    for (const root of ["document", "shadow"] as const) {
      const id = `code-line-edges-${root}`;
      const markdown = "```\nalpha\nbeta\ngamma\n```";
      await mountEditor(labPage, { id, entry: "minimal", root, markdown });
      const editor = editorLocator(labPage, id);
      await editor.evaluate((element) => {
        element.addEventListener("keydown", (rawEvent) => {
          const event = rawEvent as KeyboardEvent;
          element.setAttribute("data-key-trusted", String(event.isTrusted));
          element.setAttribute("data-key-handled", String(event.defaultPrevented));
        });
      });

      for (const step of [
        { needle: "alp", key: "Home", extend: false, anchor: 1, head: 1 },
        { needle: "be", key: "End", extend: false, anchor: 11, head: 11 },
        { needle: "be", key: "Home", extend: true, anchor: 9, head: 7 },
        { needle: "ga", key: "End", extend: true, anchor: 14, head: 17 },
      ] as const) {
        expect(await labPage.evaluate(({ id, needle }) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(id, needle, "end")
        ), { id, needle: step.needle })).toBe(true);
        await pressKey(step.key, step.extend);
        await settleEditor(labPage, id);
        expect(await labPage.evaluate((id) => (
          window.__MARKORA_BROWSER_LAB__!.snapshot(id).selection
        ), id)).toMatchObject({ anchor: step.anchor, head: step.head });
        await expect(editor).toHaveAttribute("data-key-trusted", "true");
        await expect(editor).toHaveAttribute("data-key-handled", "true");
      }
      expect(await getMarkdown(labPage, id)).toBe(markdown);

      // This logical line spans several visual lines. Its Home/End behavior
      // must remain native, since a model position cannot encode affinity.
      await resetEditor(labPage, id, "```\nabcdefghijklmnopqrstuvwxyz\n```");
      await editor.evaluate((element) => {
        (element as HTMLElement).style.width = "80px";
        const style = document.createElement("style");
        style.textContent = ".ProseMirror pre, .ProseMirror pre code { white-space: pre-wrap; overflow-wrap: anywhere; font: 16px monospace; }";
        const root = element.getRootNode();
        (root instanceof ShadowRoot ? root : document.head).append(style);
      });
      for (const key of ["Home", "End"] as const) {
        expect(await labPage.evaluate((id) => (
          window.__MARKORA_BROWSER_LAB__!.selectText(id, "mnop", "end")
        ), id)).toBe(true);
        await pressKey(key);
        await settleEditor(labPage, id);
        await expect(editor).toHaveAttribute("data-key-trusted", "true");
        await expect(editor).toHaveAttribute("data-key-handled", "false");
      }
    }
  } finally {
    await cdp?.detach();
  }
});
