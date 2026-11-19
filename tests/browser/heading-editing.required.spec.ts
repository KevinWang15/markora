import {
  blurEditor,
  editorLocator,
  expect,
  focusEditor,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
  snapshotEditor,
  test,
} from "./fixtures";

const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("@required heading marker keys change one level in root and minimal", async ({
  browserName,
  context,
  labPage,
}) => {
  const original = "### title";
  const cdp = browserName === "chromium"
    ? await context.newCDPSession(labPage)
    : null;
  const pressBackspace = async () => {
    if (!cdp) {
      await labPage.keyboard.press("Backspace");
      return;
    }

    for (const type of ["rawKeyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        code: "Backspace",
        key: "Backspace",
        nativeVirtualKeyCode: 8,
        type,
        windowsVirtualKeyCode: 8,
      });
    }
  };
  const typeHash = async () => {
    if (!cdp) {
      await labPage.keyboard.insertText("#");
      return;
    }

    await cdp.send("Input.insertText", { text: "#" });
  };

  for (const entry of ["root", "minimal"] as const) {
    const id = `heading-marker-${entry}`;
    await mountEditor(labPage, { entry, id, markdown: original, root: "shadow" });
    expect(await labPage.evaluate((editorId) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "title", "start")
    ), id)).toBe(true);

    await pressBackspace();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("## title");
    await expect(editorLocator(labPage, id).locator("h2")).toHaveCount(1);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);

    await typeHash();
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe("#### title");
    await expect(editorLocator(labPage, id).locator("h4")).toHaveCount(1);

    expect(await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
      id,
    )).toBe(true);
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toBe(original);
  }

  await cdp?.detach();
});

test("@required revealed syntax markers and image source hide while the editor is blurred", async ({ labPage }) => {
  const markdown = [
    "# Markora",
    "",
    "> Quote line",
    "",
    "Text with **bold**, *italic*, `code`, ~~strike~~, and [Docs](/docs).",
    "",
    `![Badge](${PIXEL_GIF})`,
    "",
    "---",
  ].join("\n");

  for (const root of ["document", "shadow"] as const) {
    const id = `syntax-focus-${root}`;
    await mountEditor(labPage, { id, markdown, root });
    const editor = editorLocator(labPage, id);

    // Initial unfocused mount keeps the default heading marker hidden.
    await expect(editor.locator(".mdw-marker-heading")).toBeHidden();

    // Focusing shows the heading marker; blurring hides it again.
    await focusEditor(labPage, id);
    await expect(editor.locator(".mdw-marker-heading")).toBeVisible();
    await blurEditor(labPage, id);
    await expect(editor.locator(".mdw-marker-heading")).toBeHidden();

    // Blockquote and inline mark markers follow focus too.
    const markTargets = [
      { marker: ".mdw-marker-blockquote", target: editor.locator("blockquote p") },
      { marker: ".mdw-marker-strong", target: editor.locator("strong", { hasText: "bold" }) },
      { marker: ".mdw-marker-em", target: editor.locator("em", { hasText: "italic" }) },
      { marker: ".mdw-marker-code", target: editor.locator("code", { hasText: "code" }) },
      { marker: ".mdw-marker-strike", target: editor.locator("s, del", { hasText: "strike" }) },
      { marker: ".mdw-marker-link", target: editor.locator("a", { hasText: "Docs" }) },
    ];

    for (const { marker, target } of markTargets) {
      await target.click();
      await settleEditor(labPage, id);
      await expect(editor.locator(marker).first()).toBeVisible();
      await blurEditor(labPage, id);
      await expect(editor.locator(marker).first()).toBeHidden();
    }

    // Selected image source row hides while unfocused and reappears on focus.
    const image = editor.locator(".mdw-image");
    const imageSource = image.locator(".mdw-image-source");
    await image.locator("img").click({ force: true });
    await settleEditor(labPage, id);
    await expect(imageSource).toBeVisible();
    await blurEditor(labPage, id);
    await expect(imageSource).toBeHidden();
    await focusEditor(labPage, id);
    await expect(imageSource).toBeVisible();
    await blurEditor(labPage, id);
    await expect(imageSource).toBeHidden();
  }
});

test("@required clicking inside an unfocused heading places the caret accurately as # reveals", async ({ labPage }) => {
  const id = "unfocused-heading-click";
  await mountEditor(labPage, { id, markdown: "# Markora\n\nSecond paragraph" });
  const editor = editorLocator(labPage, id);
  await expect(editor.locator(".mdw-marker-heading")).toBeHidden();

  // Click the right edge of 'k' (offset 3 -> model position 5: "Mark|ora") while blurred.
  const point = await editor.locator("h1").evaluate((heading) => {
    const walker = heading.ownerDocument.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text;
      if (candidate.data === "Markora") {
        text = candidate;
        break;
      }
    }
    if (!text) throw new Error("Missing Markora text node.");
    const range = heading.ownerDocument.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 4);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.85, y: rect.top + rect.height / 2 };
  });

  await labPage.mouse.click(point.x, point.y);
  await settleEditor(labPage, id);
  await expect(editor.locator(".mdw-marker-heading")).toBeVisible();
  expect((await snapshotEditor(labPage, id)).selection).toEqual({
    anchor: 5,
    from: 5,
    head: 5,
    to: 5,
  });
});

test("@required link and image dialogs stay anchored on resize after their trigger marker hides on blur", async ({ labPage }) => {
  const id = "overlay-hidden-marker-anchor";
  await mountEditor(labPage, {
    id,
    markdown: `Paragraph with [Docs](/docs) link.\n\n![Badge](${PIXEL_GIF})`,
  });
  const editor = editorLocator(labPage, id);

  // Open link editor by clicking the revealed link-end marker.
  const link = editor.locator("a", { hasText: "Docs" });
  await link.click();
  await settleEditor(labPage, id);
  const linkEndMarker = editor.locator(".mdw-marker-link-end");
  await expect(linkEndMarker).toBeVisible();
  await linkEndMarker.click();

  const linkDialog = ownedOverlay(labPage, id, ".mdw-link-editor");
  await expect(linkDialog).toBeVisible();
  // Focus moved into the dialog input, hiding the revealed link marker.
  await expect(linkEndMarker).toBeHidden();

  // Trigger reposition via window resize and verify the dialog stays anchored near the link without jumping.
  const initialLinkDialogBox = (await linkDialog.boundingBox())!;
  await labPage.evaluate(() => window.dispatchEvent(new Event("resize")));
  const linkBox = (await link.boundingBox())!;
  const linkDialogBox = (await linkDialog.boundingBox())!;
  expect(Math.abs(linkDialogBox.x - initialLinkDialogBox.x)).toBeLessThan(20);
  expect(Math.abs(linkDialogBox.y - (linkBox.y + linkBox.height))).toBeLessThan(80);

  // Clicking the link text dismisses the link editor cleanly (anchor is not the <a> itself).
  await link.click();
  await expect(linkDialog).toBeHidden();

  // Open image editor by clicking the revealed image source row.
  const image = editor.locator(".mdw-image");
  await image.locator("img").click({ force: true });
  await settleEditor(labPage, id);
  const imageSource = image.locator(".mdw-image-source");
  await expect(imageSource).toBeVisible();
  await imageSource.click({ position: { x: 16, y: 10 } });

  const imageDialog = ownedOverlay(labPage, id, ".mdw-image-editor");
  await expect(imageDialog).toBeVisible();
  await expect(imageSource).toBeHidden();

  await labPage.evaluate(() => window.dispatchEvent(new Event("resize")));
  const imageBox = (await image.boundingBox())!;
  const imageDialogBox = (await imageDialog.boundingBox())!;
  expect(Math.abs(imageDialogBox.y - (imageBox.y + imageBox.height))).toBeLessThan(80);
});
