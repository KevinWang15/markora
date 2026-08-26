import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required list boundaries and zero starts survive edit and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const markdown = [
    "0. zero",
    "1. one",
    "",
    "* alpha",
    "- beta",
    "+ gamma",
    "",
    "1. first",
    "2) second",
    "3. third",
  ].join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  for (const entry of ["root", "minimal"] as const) {
    const id = `list-fidelity-${entry}`;
    await mountEditor(labPage, { entry, id, markdown, root: "shadow" });
    const editor = editorLocator(labPage, id);
    await expect(editor.locator("ol").first()).toHaveAttribute("start", "0");
    expect(await editor.locator("ol").count()).toBe(4);
    expect(await editor.locator("ul").count()).toBe(3);
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "gamma", "end")
    ), id)).toBe(true);

    if (cdp) {
      await cdp.send("Input.insertText", { text: "!" });
    } else {
      await labPage.keyboard.insertText("!");
    }
    await settleEditor(labPage, id);
    const serialized = await getMarkdown(labPage, id);
    expect(serialized).toContain("0. zero\n1. one");
    expect(serialized).toContain("* alpha\n- beta\n* gamma!");
    expect(serialized).toContain("1. first\n2) second\n3. third");

    await resetEditor(labPage, id, serialized);
    await settleEditor(labPage, id);
    await expect(editor.locator("ol").first()).toHaveAttribute("start", "0");
    expect(await editor.locator("ol").count()).toBe(4);
    expect(await editor.locator("ul").count()).toBe(3);
    expect(await getMarkdown(labPage, id)).toBe(serialized);
  }

  await cdp?.detach();
});
