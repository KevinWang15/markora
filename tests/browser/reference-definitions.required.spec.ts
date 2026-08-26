import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  resetEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required reference definitions survive CDP edits and reset", async ({
  browserName,
  context,
  labPage,
}) => {
  const id = "reference-definition-fidelity";
  const input = [
    "[unused]: https://example.com \"kept\"",
    "",
    "Before edit.",
    "",
    "[used]: /target \"title\"",
    "",
    "Use [label][used].",
  ].join("\n");
  const canonical = input.replace("[label][used]", "[label](/target \"title\")");

  await mountEditor(labPage, { entry: "root", id, markdown: input, root: "shadow" });
  const editor = editorLocator(labPage, id);
  const definitions = editor.locator('[data-mdw-opaque-kind="reference-definition"]');
  await expect(definitions).toHaveCount(2);
  await expect(definitions.nth(0)).toContainText("[unused]: https://example.com");
  await expect(definitions.nth(1)).toContainText("[used]: /target");
  expect(await getMarkdown(labPage, id)).toBe(canonical);

  await definitions.nth(0).getByRole("button", {
    name: "Edit Link reference definition Markdown source",
  }).click();
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.pendingOpaqueEdit(editorId)
  ), id)).toEqual({
    kind: "reference-definition",
    source: "[unused]: https://example.com \"kept\"",
  });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.updateOpaque(
      editorId,
      "[unused]: https://example.org \"changed\"",
    )
  ), id)).toBe(true);
  await settleEditor(labPage, id);
  const updatedDefinitions = canonical.replace(
    "[unused]: https://example.com \"kept\"",
    "[unused]: https://example.org \"changed\"",
  );
  expect(await getMarkdown(labPage, id)).toBe(updatedDefinitions);
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "edit", "end")
  ), id)).toBe(true);

  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);
    await cdp.send("Input.insertText", { text: "ed" });
    await cdp.detach();
  } else {
    await labPage.keyboard.insertText("ed");
  }
  await settleEditor(labPage, id);
  const edited = updatedDefinitions.replace("Before edit.", "Before edited.");
  expect(await getMarkdown(labPage, id)).toBe(edited);

  await resetEditor(labPage, id, edited);
  await settleEditor(labPage, id);
  await expect(definitions).toHaveCount(2);
  expect(await getMarkdown(labPage, id)).toBe(edited);
});
