import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  snapshotEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required deep lists retain every editable item in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const depth = 100;
  const markdown = Array.from(
    { length: depth },
    (_, index) => `${"  ".repeat(index)}* level-${index + 1}`,
  ).join("\n");
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;

  for (const entry of ["root", "minimal"] as const) {
    const id = `deep-list-${entry}`;
    await mountEditor(labPage, { entry, id, markdown, root: "shadow" });
    expect(await editorLocator(labPage, id).locator("li").count()).toBe(depth);
    expect(await getMarkdown(labPage, id)).toBe(markdown);
    expect(await labPage.evaluate(({ editorId, needle }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, needle, "end")
    ), { editorId: id, needle: `level-${depth}` })).toBe(true);

    if (cdp) {
      await cdp.send("Input.insertText", { text: "-edited" });
    } else {
      await labPage.keyboard.insertText("-edited");
    }
    await settleEditor(labPage, id);

    expect(await getMarkdown(labPage, id)).toBe(
      markdown.replace(`level-${depth}`, `level-${depth}-edited`),
    );
    const { selection } = await snapshotEditor(labPage, id);
    expect(selection.from).toBe(selection.to);
    await expect(editorLocator(labPage, id)).toBeFocused();
  }

  await cdp?.detach();
});
