import { test, expect, mountEditor, focusEditor, editorLocator, getMarkdown, snapshotEditor, resetEditor, updateEditorOptions, destroyEditorOnly } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const menu = (page: Page) => page.getByRole("menu", { name: "Editor context menu", exact: true });

async function openKeyboard(page: Page, id: string) {
  await focusEditor(page, id);
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
}

test("@required context menu preserves a selected range through nested keyboard formatting", async ({ labPage }) => {
  await mountEditor(labPage, { id: "menu", markdown: "hello world" });
  await focusEditor(labPage, "menu", { anchor: 7, head: 12 });
  await openKeyboard(labPage, "menu");
  await expect(menu(labPage).getByRole("menuitem", { name: "Cut", exact: true })).toBeFocused();
  await labPage.keyboard.type("fo");
  await expect(menu(labPage).getByRole("menuitem", { name: "Format", exact: true })).toBeFocused();
  await labPage.keyboard.press("ArrowRight");
  await expect(labPage.getByRole("menuitemcheckbox", { name: "Bold", exact: true })).toBeFocused();
  await labPage.keyboard.press("Enter");
  await expect(menu(labPage)).toHaveCount(0);
  expect(await getMarkdown(labPage, "menu")).toBe("hello **world**");
  await expect(editorLocator(labPage, "menu")).toBeFocused();
  await openKeyboard(labPage, "menu");
  await menu(labPage).getByRole("menuitem", { name: "Undo", exact: true }).click();
  expect(await getMarkdown(labPage, "menu")).toBe("hello world");
});

test("@required pointer context menus retain selected text and retarget outside it", async ({ labPage }) => {
  await mountEditor(labPage, { id: "pointer", markdown: "hello world\n\nsecond paragraph" });
  await focusEditor(labPage, "pointer", { anchor: 7, head: 12 });
  const before = (await snapshotEditor(labPage, "pointer")).selection;
  const point = await editorLocator(labPage, "pointer").locator("p").first().evaluate(element => {
    const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, 7); range.setEnd(element.firstChild!, 10);
    const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await labPage.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(labPage)).toBeVisible();
  expect((await snapshotEditor(labPage, "pointer")).selection).toEqual(before);
  await labPage.keyboard.press("Escape");
  await editorLocator(labPage, "pointer").locator("p").last().click({ button: "right" });
  await menu(labPage).getByRole("menuitem", { name: "Paragraph", exact: true }).click();
  await labPage.getByRole("menuitemcheckbox", { name: "Heading 2", exact: true }).click();
  expect(await getMarkdown(labPage, "pointer")).toBe("hello world\n\n## second paragraph");
});

test("@required disabled items remain discoverable, nested Escape returns to its parent, and Tab dismisses", async ({ labPage }) => {
  await mountEditor(labPage, { id: "keys", markdown: "text" });
  await openKeyboard(labPage, "keys");
  const cut = menu(labPage).getByRole("menuitem", { name: "Cut", exact: true });
  await expect(cut).toBeFocused(); await expect(cut).toHaveAttribute("aria-disabled", "true");
  await labPage.keyboard.press("Enter"); await expect(menu(labPage)).toBeVisible();
  await labPage.keyboard.type("fo"); await labPage.keyboard.press("ArrowRight");
  await expect(labPage.getByRole("menu", { name: "Format", exact: true })).toBeVisible();
  await labPage.keyboard.press("Escape");
  await expect(menu(labPage).getByRole("menuitem", { name: "Format", exact: true })).toBeFocused();
  await labPage.keyboard.press("Tab"); await expect(menu(labPage)).toHaveCount(0);
});

for (const spec of [
  { root: "document", portal: "body" }, { root: "shadow", portal: "default" },
  { root: "shadow", portal: "body" }, { root: "document", portal: "transformed" },
] as const) test(`@required menus inherit RTL/night themes and fit ${spec.root}/${spec.portal} portals`, async ({ labPage }) => {
  await labPage.setViewportSize({ width: 390, height: 640 });
  await mountEditor(labPage, { id: "portal", markdown: "text", theme: "night", direction: "rtl", ...spec });
  await openKeyboard(labPage, "portal");
  await expect(menu(labPage)).toHaveAttribute("dir", "rtl");
  await expect(menu(labPage)).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await labPage.keyboard.type("fo"); await labPage.keyboard.press("ArrowLeft");
  await expect(labPage.getByRole("menu", { name: "Format", exact: true })).toBeVisible();
  for (const panel of await labPage.getByRole("menu").all()) {
    const box = await panel.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(6); expect(box!.y).toBeGreaterThanOrEqual(6);
    expect(box!.x + box!.width).toBeLessThanOrEqual(392); expect(box!.y + box!.height).toBeLessThanOrEqual(642);
  }
  await labPage.keyboard.press("ArrowRight");
  await expect(menu(labPage).getByRole("menuitem", { name: "Format", exact: true })).toBeFocused();
});

test("@required table menus use the clicked cell and expose guarded row and alignment commands", async ({ labPage }) => {
  await mountEditor(labPage, { id: "table-menu", markdown: "| A | B |\n| --- | --- |\n| c | d |" });
  const editor = editorLocator(labPage, "table-menu");
  await editor.locator("td p").first().click({ button: "right" });
  await menu(labPage).getByRole("menuitem", { name: "Row", exact: true }).click();
  await labPage.getByRole("menuitem", { name: "Insert row after", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(3);
  await openKeyboard(labPage, "table-menu");
  await menu(labPage).getByRole("menuitem", { name: "Column alignment", exact: true }).click();
  await labPage.getByRole("menuitemcheckbox", { name: "Center", exact: true }).click();
  expect(await getMarkdown(labPage, "table-menu")).toContain(":---:");
});

test("@required link and image actions hand focus to their existing editors", async ({ labPage }) => {
  await labPage.route("https://example.com/menu-image.png", route => route.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64") }));
  await mountEditor(labPage, { id: "objects", markdown: "[link](https://example.com)\n\n![alt](https://example.com/menu-image.png)" });
  const editor = editorLocator(labPage, "objects");
  await editor.locator("a").click({ button: "right" });
  await menu(labPage).getByRole("menuitem", { name: "Edit link…", exact: true }).click();
  const link = labPage.getByRole("dialog", { name: "Edit link", exact: true });
  await expect(link).toBeVisible(); await expect(link.locator("input").first()).toBeFocused();
  await labPage.keyboard.press("Escape");
  await editor.getByRole("img", { name: "alt", exact: true }).click({ button: "right" });
  await menu(labPage).getByRole("menuitem", { name: "Edit image…", exact: true }).click();
  const image = labPage.getByRole("dialog", { name: "Edit image", exact: true });
  await expect(image).toBeVisible(); await expect(image.locator("input").first()).toBeFocused();
});

test("@required menus close on document/read-only changes and editor destruction", async ({ labPage }) => {
  await mountEditor(labPage, { id: "lifetime", markdown: "old" });
  await openKeyboard(labPage, "lifetime"); await resetEditor(labPage, "lifetime", "new");
  await expect(menu(labPage)).toHaveCount(0);
  await openKeyboard(labPage, "lifetime"); await updateEditorOptions(labPage, "lifetime", { editable: false });
  await expect(menu(labPage)).toHaveCount(0);
  await openKeyboard(labPage, "lifetime");
  await expect(menu(labPage).getByRole("menuitem", { name: "Paste", exact: true })).toHaveAttribute("aria-disabled", "true");
  await destroyEditorOnly(labPage, "lifetime"); await expect(labPage.getByRole("menu")).toHaveCount(0);
});

test("@required context menu opt-out and nested code editors preserve platform menu handling", async ({ labPage }) => {
  await mountEditor(labPage, { id: "native", markdown: "native", contextMenu: false });
  await editorLocator(labPage, "native").locator("p").click({ button: "right" });
  await expect(menu(labPage)).toHaveCount(0);
  await mountEditor(labPage, { id: "code-native", markdown: "```js\nconst x = 1;\n```" });
  const code = editorLocator(labPage, "code-native").locator(".cm-content");
  await expect(code).toBeVisible(); await code.click({ button: "right" });
  await expect(menu(labPage)).toHaveCount(0);
});

test("@required hosts can contribute nested localized actions without sharing menu DOM", async ({ labPage }) => {
  await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.mount({ id: "custom", markdown: "custom",
    contextMenu: { includeDefaults: false, includeExtensionActions: false,
      messages: { menuLabel: "Document actions", itemLabel: (id, label) => id === "host.heading" ? "Titre" : label },
      providers: [{ id: "host", items: () => [{ type: "submenu", id: "host.more", label: "More", items: [
        { type: "action", id: "host.heading", label: "Heading", run: ({ editor }) => editor.commands.setHeading(2) },
      ] }] }],
    },
  }));
  await focusEditor(labPage, "custom"); await labPage.keyboard.press("Shift+F10");
  await labPage.getByRole("menuitem", { name: "More", exact: true }).click();
  await labPage.getByRole("menuitem", { name: "Titre", exact: true }).click();
  expect(await getMarkdown(labPage, "custom")).toBe("## custom");
});

test("@required extension registry actions appear in the shared menu", async ({ labPage }) => {
  await mountEditor(labPage, { id: "ext-menu", extensionMode: "toc", markdown: "# Heading\n\ntext" });
  await openKeyboard(labPage, "ext-menu");
  await menu(labPage).getByRole("menuitem", { name: "Extensions", exact: true }).click();
  const extensions = labPage.getByRole("menu", { name: "Extensions", exact: true });
  await expect(extensions.getByRole("menuitemcheckbox")).toHaveCount(2);
  await extensions.getByRole("menuitemcheckbox").first().click();
  expect(await getMarkdown(labPage, "ext-menu")).toContain("[TOC]");
});

test("@required failed Cut reports an error without deletion and stale pending Paste is cancelled", async ({ labPage }) => {
  await labPage.evaluate(() => window.__MARKORA_BROWSER_LAB__!.mount({ id: "clipboard-fail", markdown: "keep this",
    contextMenu: { clipboard: {
      write: async () => { throw new Error("denied"); },
      read: () => new Promise(resolve => Reflect.set(window, "resolveContextClipboard", resolve)),
    } },
  }));
  await focusEditor(labPage, "clipboard-fail", "all"); await openKeyboard(labPage, "clipboard-fail");
  await menu(labPage).getByRole("menuitem", { name: "Cut", exact: true }).click();
  await expect(menu(labPage).getByRole("alert")).toContainText("Clipboard access failed");
  expect(await getMarkdown(labPage, "clipboard-fail")).toBe("keep this");
  await menu(labPage).getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(menu(labPage)).toHaveAttribute("aria-busy", "true");
  await resetEditor(labPage, "clipboard-fail", "replacement");
  await labPage.evaluate(() => Reflect.get(window, "resolveContextClipboard")({ text: "stale" }));
  await expect(menu(labPage)).toHaveCount(0); expect(await getMarkdown(labPage, "clipboard-fail")).toBe("replacement");
});

test("@required browser clipboard menus copy rich content, paste it, cut it, and restore it with undo", async ({ labPage, browserName, context }) => {
  test.skip(browserName !== "chromium", "Automated browser clipboard permissions are Chromium-specific.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mountEditor(labPage, { id: "clipboard", markdown: "hello **world**" });
  await focusEditor(labPage, "clipboard", { anchor: 7, head: 12 }); await openKeyboard(labPage, "clipboard");
  await menu(labPage).getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect(menu(labPage)).toHaveCount(0);
  expect(await labPage.evaluate(() => navigator.clipboard.readText())).toBe("world");
  await focusEditor(labPage, "clipboard", "start"); await openKeyboard(labPage, "clipboard");
  await menu(labPage).getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect.poll(() => getMarkdown(labPage, "clipboard")).toBe("**world**hello **world**");
  await focusEditor(labPage, "clipboard", "all"); await openKeyboard(labPage, "clipboard");
  await menu(labPage).getByRole("menuitem", { name: "Cut", exact: true }).click();
  await expect.poll(() => getMarkdown(labPage, "clipboard")).toBe("");
  await openKeyboard(labPage, "clipboard"); await menu(labPage).getByRole("menuitem", { name: "Undo", exact: true }).click();
  expect(await getMarkdown(labPage, "clipboard")).toBe("**world**hello **world**");
});

test("@required context menu and nested controls expose accessible roles and names", async ({ labPage }) => {
  await mountEditor(labPage, { id: "accessible-menu", markdown: "text", theme: "github" });
  await openKeyboard(labPage, "accessible-menu");
  await menu(labPage).getByRole("menuitem", { name: "Paragraph", exact: true }).click();
  const results = await new AxeBuilder({ page: labPage }).include(".mdw-context-menu").analyze();
  expect(results.violations).toEqual([]);
});

test("@required playground math menus select the formula and open the shared LaTeX editor", async ({ page }) => {
  // Exercise the idle scheduler's five-second watchdog deterministically.
  // Editing updates the model immediately; serialized host output is coalesced.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
    window.cancelIdleCallback = () => {};
  });
  await page.goto("/"); await page.locator("#source").fill("$$\nx^2\n$$");
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  await page.locator("#editor .mdw-math").click({ button: "right", position: { x: 12, y: 12 } });
  await menu(page).getByRole("menuitem", { name: "Edit formula", exact: true }).click();
  const source = page.getByRole("textbox", { name: "LaTeX source", exact: true });
  await expect(source).toBeFocused();
  await expect(source).toHaveValue("x^2");
  await source.fill("y^3");
  await expect(page.locator("#editor [data-mdw-math-source]")).toHaveText("$$\ny^3\n$$");
  await source.press("Escape");
  await expect(page.locator("#output")).toHaveText("$$\ny^3\n$$", { timeout: 10_000 });
});


test("@required queued scroll events preserve the menu while subsequent ancestor scrolling dismisses it", async ({ labPage }) => {
  await mountEditor(labPage, { id: "scroll-menu", markdown: "text" });
  await labPage.evaluate(() => { document.body.style.minHeight = "3000px"; });
  await openKeyboard(labPage, "scroll-menu");
  await labPage.evaluate(() => document.dispatchEvent(new Event("scroll")));
  await expect(menu(labPage)).toBeVisible();
  await labPage.evaluate(() => window.scrollTo(0, 150));
  await expect(menu(labPage)).toHaveCount(0);
});

test("@required typeahead starts fresh when entering and leaving a submenu", async ({ labPage }) => {
  await mountEditor(labPage, { id: "typeahead-levels", markdown: "hello world" });
  await focusEditor(labPage, "typeahead-levels", { anchor: 7, head: 12 });
  await openKeyboard(labPage, "typeahead-levels");
  await labPage.keyboard.type("fo"); await labPage.keyboard.press("ArrowRight");
  await labPage.keyboard.type("it");
  await expect(labPage.getByRole("menuitemcheckbox", { name: "Italic", exact: true })).toBeFocused();
  await labPage.keyboard.press("Escape"); await labPage.keyboard.type("pa");
  await expect(menu(labPage).getByRole("menuitem", { name: "Paragraph", exact: true })).toBeFocused();
  await labPage.keyboard.press("ArrowRight"); await labPage.keyboard.type("he");
  await expect(labPage.getByRole("menuitemcheckbox", { name: "Heading 1", exact: true })).toBeFocused();
  await labPage.keyboard.press("Home"); await labPage.keyboard.type("hH");
  await expect(labPage.getByRole("menuitemcheckbox", { name: "Heading 2", exact: true })).toBeFocused();
});
