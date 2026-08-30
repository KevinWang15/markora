import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { initialMarkdown, quickStartCode } from "../../packages/demo/src/lib/content";

const PUBLIC_PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function selectWorld(page: Page) {
  const paragraph = page.locator("#editor > .ProseMirror p");
  await paragraph.click();
  await page.keyboard.press("End");
  const paragraphLength = await paragraph.evaluate((element) => element.textContent?.length ?? 0);
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection();
    return selection?.isCollapsed ? selection.focusOffset : -1;
  })).toBe(paragraphLength);
  await page.keyboard.down("Shift");
  try {
    for (let index = 0; index < "world".length; index += 1) {
      await page.keyboard.press("ArrowLeft", { delay: 30 });
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0))
        .toBe(index + 1);
    }
  } finally {
    await page.keyboard.up("Shift");
  }
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("world");
  return paragraph;
}

async function dispatchTouch(cdp: CDPSession, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ force: 1, id: 1, radiusX: 1, radiusY: 1, x, y }],
    type: "touchStart",
  });
  await cdp.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
}

async function expectTouchTarget(target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function expectForcedColorsFocus(target: Locator) {
  await target.focus();
  const focusStyle = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).toBe("solid");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focusStyle.boxShadow).toBe("none");
}

test("@required playground presents and highlights its TypeScript example", async ({ page }) => {
  await page.goto("/demo");
  const codeBlock = page.locator("#editor .mdw-code-block");
  const language = codeBlock.locator(".mdw-code-block-language");

  await codeBlock.scrollIntoViewIfNeeded();
  await expect(language).toHaveText("typescript");
  await expect(language).toHaveAccessibleName("Edit code block language: typescript");
  await expect(codeBlock).toHaveAttribute("data-mdw-code-block-state", "active");
  await expect(codeBlock.locator(".cm-content")).toContainText("interface Release");
  await expect(codeBlock.locator(".cm-content")).toContainText("satisfies Release");

  const highlighting = await codeBlock.locator(".cm-content span").evaluateAll((tokens) => {
    const tokenColors = tokens.map((token) => getComputedStyle(token).color);
    const contentColor = tokens[0]?.parentElement
      ? getComputedStyle(tokens[0].parentElement).color
      : "";
    return {
      coloredTokenCount: tokenColors.filter((color) => color !== contentColor).length,
      distinctTokenColors: new Set(tokenColors).size,
    };
  });
  expect(highlighting.coloredTokenCount).toBeGreaterThan(0);
  expect(highlighting.distinctTokenColors).toBeGreaterThan(2);
  await expect(page.locator("#source")).not.toHaveValue(/title=/);
});

test("@required playground link popover validates input and preserves native Cancel behavior", async ({ page }) => {
  await page.goto("/demo");
  await page.locator("#source").fill("hello world");
  await page.getByRole("button", { name: "Apply Markdown" }).click();
  const paragraph = await selectWorld(page);

  await page.getByRole("button", { name: "Add or edit link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add link" });
  const input = dialog.getByLabel("URL");
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(input).toHaveValue("");

  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toHaveText("Enter a valid link URL.");

  await input.fill("https://example.test/docs");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toBeHidden();
  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page.locator("#output")).toHaveText("hello world");
  await expect(paragraph.locator("a")).toHaveCount(0);
});

test("@required public image workflow validates URLs and identifies empty-alt authoring objects", async ({ page }) => {
  await page.goto("/demo");
  await page.locator("#source").fill("image anchor");
  await page.getByRole("button", { name: "Apply Markdown" }).click();

  const paragraph = page.locator("#editor > .ProseMirror p");
  await paragraph.click();
  await page.keyboard.press("End");
  const imageButton = page.getByRole("button", { name: "Insert or edit image" });
  const removeImageButton = page.getByRole("button", { name: "Remove image" });
  await imageButton.click();

  const insertDialog = page.getByRole("dialog", { name: "Insert image" });
  const imageUrl = insertDialog.getByLabel("Image URL");
  await imageUrl.fill("javascript:alert(1)");
  await insertDialog.getByRole("button", { name: "Apply" }).click();
  await expect(imageUrl).toHaveAttribute("aria-invalid", "true");
  await expect(insertDialog.getByRole("alert")).toHaveText("Enter a valid image URL.");
  await expect(page.locator("#output")).toHaveText("image anchor");

  await imageUrl.fill(PUBLIC_PIXEL_GIF);
  await expect(imageUrl).not.toHaveAttribute("aria-invalid", "true");
  await insertDialog.getByRole("button", { name: "Apply" }).click();

  const image = page.locator(".mdw-image img");
  await expect(insertDialog).toBeHidden();
  await expect(image).toHaveAttribute("alt", "");
  await expect(image).toHaveAttribute("aria-label", "Image without alternative text");
  await expect(image).toHaveAccessibleName("Image without alternative text");
  await expect(page.locator("#output")).toHaveText(`image anchor![](${PUBLIC_PIXEL_GIF})`);
  await expect(imageButton).toHaveAttribute("aria-pressed", "true");
  await expect(removeImageButton).toBeEnabled();

  await imageButton.click();
  const editDialog = page.getByRole("dialog", { name: "Edit image" });
  await editDialog.getByLabel("Alt text").fill("Edited alt");
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(editDialog).toBeHidden();
  await expect(image).toHaveAttribute("alt", "Edited alt");
  await expect(image).not.toHaveAttribute("aria-label");
  await expect(image).toHaveAccessibleName("Edited alt");
  await expect(page.locator("#output")).toHaveText(`image anchor![Edited alt](${PUBLIC_PIXEL_GIF})`);

  await removeImageButton.click();
  await expect(image).toHaveCount(0);
  await expect(page.locator("#output")).toHaveText("image anchor");
  await expect(imageButton).toHaveAttribute("aria-pressed", "false");
  await expect(removeImageButton).toBeDisabled();
});

test("@required public mobile navigation is compact, touch-sized, and overflow-free", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/docs/getting-started");

  const topbar = page.locator(".topbar");
  const links = page.locator(".topnav-link");
  await expect(links).toHaveCount(6);
  expect((await topbar.boundingBox())?.height).toBeLessThanOrEqual(180);

  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBe(0);
});

test("@required the keyboard skip link is immediately visible and targets content", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto("/docs/getting-started");

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  const box = await skipLink.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(256);
  await expect(skipLink).toHaveCSS("transition-duration", "0s");

  await page.keyboard.press("Enter");
  await expect(page.locator("#site-hero")).toBeFocused();
  await expect(page).toHaveURL(/#site-hero$/);
});

test("@required rapid keyboard traversal keeps the focused control in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/docs/getting-started");

  const copyInstall = page.getByRole("button", { name: "Copy Install (Shell) code" }).first();
  for (let index = 0; index < 20 && !await copyInstall.evaluate((element) => (
    element === document.activeElement
  )); index += 1) {
    await page.keyboard.press("Tab");
  }

  await expect(copyInstall).toBeFocused();
  const box = await copyInstall.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(640);
});

test("@required sticky navigation does not obscure keyboard focus in short viewports", async ({ page }) => {
  await page.setViewportSize({ width: 721, height: 256 });
  await page.goto("/docs/getting-started");

  const openPlayground = page.getByRole("link", { name: "Open core playground" });
  for (let index = 0; index < 20 && !await openPlayground.evaluate((element) => (
    element === document.activeElement
  )); index += 1) {
    await page.keyboard.press("Tab");
  }

  await expect(openPlayground).toBeFocused();
  const wrappedHeader = await page.locator(".topbar").boundingBox();
  const openPlaygroundBox = await openPlayground.boundingBox();
  expect(wrappedHeader).not.toBeNull();
  expect(openPlaygroundBox).not.toBeNull();
  expect(openPlaygroundBox!.y).toBeGreaterThanOrEqual(wrappedHeader!.y + wrappedHeader!.height);
  expect(openPlaygroundBox!.y + openPlaygroundBox!.height).toBeLessThanOrEqual(256);

  await page.setViewportSize({ width: 1025, height: 256 });
  await page.goto("/docs/getting-started");
  const sidebar = page.locator(".sidebar");
  const sidebarPlayground = sidebar.getByRole("link", { name: "Core playground" });
  for (let index = 0; index < 30 && !await sidebarPlayground.evaluate((element) => (
    element === document.activeElement
  )); index += 1) {
    await page.keyboard.press("Tab");
  }

  await expect(sidebarPlayground).toBeFocused();
  const stickyHeader = await page.locator(".topbar").boundingBox();
  const sidebarPlaygroundBox = await sidebarPlayground.boundingBox();
  expect(stickyHeader).not.toBeNull();
  expect(sidebarPlaygroundBox).not.toBeNull();
  expect(sidebarPlaygroundBox!.y).toBeGreaterThanOrEqual(stickyHeader!.y + stickyHeader!.height);
  expect(sidebarPlaygroundBox!.y + sidebarPlaygroundBox!.height).toBeLessThanOrEqual(256);
  expect(await sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("@required the desktop sidebar exposes documentation navigation", async ({ page }) => {
  await page.goto("/docs/api");
  const navigation = page.getByRole("navigation", { name: "Documentation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(5);
  await expect(navigation.getByRole("link", { name: "API overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("@required public routes reflow with WCAG text spacing at a 400-percent equivalent viewport", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "The route-wide production reflow audit is certified in Chromium.");
  await page.setViewportSize({ width: 320, height: 256 });

  for (const route of [
    "/docs/getting-started",
    "/docs/markdown",
    "/docs/api",
    "/docs/examples",
    "/demo",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.addStyleTag({
      content: `
        .docs-site :not(svg):not(path) {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        .docs-site p { margin-block-end: 2em !important; }
      `,
    });

    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const clippedControls = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0
          && (rect.left < -1 || rect.right > viewportWidth + 1);
      }).map((element) => (
        element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName
      ));

      return {
        clippedControls,
        inaccessibleCodeRegions: [
          ...document.querySelectorAll<HTMLElement>(".code-block-pre"),
        ].filter((region) => (
          (region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight)
          && region.tabIndex !== 0
        )).length,
        overflow: document.documentElement.scrollWidth - viewportWidth,
      };
    });

    expect(layout, `${route} must reflow without clipping interactive controls`).toEqual({
      clippedControls: [],
      inaccessibleCodeRegions: 0,
      overflow: 0,
    });
  }
});

test("@required public code regions track overflow from late typography changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/docs/api");
  const regions = page.locator(".code-block-pre");
  await expect(regions.first()).toBeVisible();
  const baseline = await regions.evaluateAll((elements) => elements.map((element) => (
    element.scrollWidth > element.clientWidth
  )));
  expect(baseline.some((overflows) => !overflows)).toBe(true);

  const typography = await page.addStyleTag({
    content: ".code-block-pre { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }",
  });
  await expect.poll(() => regions.evaluateAll((elements, before) => (
    elements.flatMap((element, index) => (
      !before[index] && element.scrollWidth > element.clientWidth ? [index] : []
    ))
  ), baseline)).not.toEqual([]);

  const changedIndices = await regions.evaluateAll((elements, before) => (
    elements.flatMap((element, index) => (
      !before[index] && element.scrollWidth > element.clientWidth ? [index] : []
    ))
  ), baseline);
  await expect.poll(() => regions.evaluateAll((elements, indices) => (
    indices.map((index) => ({
      hasExpectedAriaLabel: elements[index]?.getAttribute("aria-label")
        === `${elements[index]?.dataset.codeDescription}, horizontally scrollable`,
      role: elements[index]?.getAttribute("role"),
      tabIndex: elements[index]?.tabIndex,
    }))
  ), changedIndices)).toEqual(changedIndices.map(() => ({
    hasExpectedAriaLabel: true,
    role: "group",
    tabIndex: 0,
  })));

  await typography.evaluate((element) => (element as Element).remove());
  await expect.poll(() => regions.evaluateAll((elements, indices) => (
    indices.map((index) => ({
      ariaLabel: elements[index]!.getAttribute("aria-label"),
      overflows: elements[index]!.scrollWidth > elements[index]!.clientWidth,
      role: elements[index]!.getAttribute("role"),
      tabIndex: elements[index]!.tabIndex,
    }))
  ), changedIndices)).toEqual(changedIndices.map(() => ({
    ariaLabel: null,
    overflows: false,
    role: null,
    tabIndex: -1,
  })));
});

test("@required overflowing code regions have concise non-landmark names", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/docs/api");

  const titledCode = page.locator(
    '.code-block-pre[data-code-description="Host resource policy and upload pipeline (TypeScript) code"]',
  );
  await expect(titledCode).toHaveAttribute("tabindex", "0");
  await expect(titledCode).toHaveAttribute("role", "group");
  await expect(titledCode).toHaveAccessibleName(
    "Host resource policy and upload pipeline (TypeScript) code, horizontally scrollable",
  );

  await page.goto("/docs/examples");
  const languageOnlyCode = page.locator(
    '.code-block-pre[data-code-description="TypeScript code"][tabindex="0"]',
  ).first();
  await expect(languageOnlyCode).toHaveAttribute("role", "group");
  await expect(languageOnlyCode).toHaveAccessibleName(
    "TypeScript code, horizontally scrollable",
  );
  await expect(page.getByRole("region", { name: /code, horizontally scrollable/i })).toHaveCount(0);
});

test("@required code headers are direct figure captions", async ({ page }) => {
  for (const [route, count] of [["/docs/api", 16], ["/docs/examples", 11]] as const) {
    await page.goto(route);
    const figures = page.locator("figure.code-block");
    await expect(figures).toHaveCount(count);
    await expect(page.locator("figure.code-block > figcaption.code-block-header")).toHaveCount(count);
    await expect(page.locator("figure.code-block figcaption figcaption")).toHaveCount(0);
  }
});

test("@required Chromium native code copy preserves exact blank lines", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== "chromium", "The trusted native clipboard path is verified through Chromium CDP.");
  await page.goto("/docs/getting-started");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => navigator.clipboard.writeText("clipboard-marker"));

  const code = page.locator(".code-block-code").nth(1);
  const selectedText = await code.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  expect(selectedText).toBe(quickStartCode);
  expect(selectedText).not.toContain("\u200b");

  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", {
    code: "KeyC",
    key: "c",
    modifiers: 2,
    nativeVirtualKeyCode: 67,
    type: "rawKeyDown",
    windowsVirtualKeyCode: 67,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    code: "KeyC",
    key: "c",
    modifiers: 2,
    nativeVirtualKeyCode: 67,
    type: "keyUp",
    windowsVirtualKeyCode: 67,
  });
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(quickStartCode);
});

test("@required formatting toolbar uses one tab stop and arrow-key navigation", async ({ page }) => {
  await page.goto("/demo");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toHaveAttribute("aria-orientation", "horizontal");

  const iconStates = await toolbar.locator(".mdw-toolbar-icon").evaluateAll((icons) => (
    icons.map((icon) => {
      const rect = icon.getBoundingClientRect();
      return {
        decorative: icon.getAttribute("aria-hidden") === "true"
          && icon.getAttribute("focusable") === "false",
        hasGeometry: icon.childElementCount > 0,
        isLucide: icon.classList.contains("lucide"),
        size: [rect.width, rect.height],
        viewBox: icon.getAttribute("viewBox"),
      };
    })
  ));
  expect(iconStates).toHaveLength(10);
  expect(iconStates.every((icon) => (
    icon.decorative
      && icon.hasGeometry
      && icon.isLucide
      && icon.viewBox === "0 0 24 24"
      && icon.size[0] === 18
      && icon.size[1] === 18
  ))).toBe(true);

  const tabStops = await toolbar.locator("button").evaluateAll((buttons) => (
    buttons
      .filter((button) => !(button as HTMLButtonElement).disabled && (button as HTMLElement).tabIndex === 0)
      .map((button) => button.getAttribute("aria-label"))
  ));
  expect(tabStops).toEqual(["Bold (Ctrl+B)"]);
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("button", { name: /^Redo/ })).toHaveAttribute("tabindex", "-1");

  const bold = page.getByRole("button", { name: /^Bold/ });
  const italic = page.getByRole("button", { name: /^Italic/ });
  const link = page.getByRole("button", { name: "Add or edit link" });
  const image = page.getByRole("button", { name: "Insert or edit image" });
  for (const toggle of [
    bold,
    italic,
    page.getByRole("button", { name: /^Inline code/ }),
    page.getByRole("button", { name: /^Strike/ }),
    link,
    image,
  ]) {
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByRole("button", { name: /^Undo/ })).not.toHaveAttribute("aria-pressed");
  await expect(page.getByRole("button", { name: /^Redo/ })).not.toHaveAttribute("aria-pressed");
  for (const trigger of [link, image]) {
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const controlledId = await trigger.getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    await expect(page.locator(`[id="${controlledId}"]`)).toHaveAttribute("role", "dialog");
  }
  await bold.focus();
  await page.keyboard.press("ArrowRight");
  await expect(italic).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(bold).toBeFocused();
  await page.keyboard.press("End");
  await expect(image).toBeFocused();
  await page.keyboard.press("Home");
  await expect(bold).toBeFocused();

  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".mdw-toolbar")))).toBe(false);

  await page.locator("#source").fill("hello world");
  await page.getByRole("button", { name: "Apply Markdown" }).click();
  await selectWorld(page);
  await bold.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#output")).toHaveText("hello **world**");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await bold.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#output")).toHaveText("hello world");
  await expect(bold).toHaveAttribute("aria-pressed", "false");

  await image.focus();
  await page.keyboard.press("Enter");
  await expect(image).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Insert image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(image).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog", { name: "Insert image" })).toBeHidden();
  await expect(page.locator("#editor > .ProseMirror")).toBeFocused();
});

test("@required source apply action exposes clean, dirty, and completion states", async ({ page }) => {
  await page.goto("/demo");
  const applyButton = page.getByRole("button", { name: "Apply Markdown" });
  const source = page.locator("#source");
  const output = page.locator("#output");
  const status = page.locator("#playground-source-status");
  await expect(output).toContainText("* [x] Deliberate rich, Markdown, and plain-text paste");
  const initialOutput = await output.textContent();

  await expect(applyButton).toHaveAttribute("aria-disabled", "true");
  await expect(applyButton).toHaveAccessibleDescription("No source changes to apply.");
  await expect(status).toHaveText("No source changes to apply.");
  await applyButton.focus();
  await page.keyboard.press("Enter");
  await expect(applyButton).toBeFocused();
  await expect(output).toHaveText(initialOutput ?? "");

  const draft = "# Source action state\n\nReady to apply.";
  await source.fill(draft);
  await expect(applyButton).toHaveAttribute("aria-disabled", "false");
  await expect(applyButton).toHaveAccessibleDescription("Source changes are ready to apply.");
  await expect(status).toHaveText("Source changes are ready to apply.");

  await applyButton.focus();
  await page.keyboard.press("Enter");
  await expect(output).toHaveText(draft);
  await expect(applyButton).toBeFocused();
  await expect(applyButton).toHaveAttribute("aria-disabled", "true");
  await expect(applyButton).toHaveAccessibleDescription("Markdown applied to the visual editor.");
  await expect(status).toHaveText("Markdown applied to the visual editor.");
});

test("@required visual edits preserve an unapplied source draft", async ({ page }) => {
  await page.goto("/demo");
  const source = page.locator("#source");
  const output = page.locator("#output");
  const applyButton = page.getByRole("button", { name: "Apply Markdown" });
  const draft = `${initialMarkdown}\n\nUNAPPLIED SOURCE DRAFT`;

  await source.fill(draft);
  await expect(applyButton).toHaveAttribute("aria-disabled", "false");
  await expect(applyButton).toHaveAccessibleDescription("Source changes are ready to apply.");

  const firstTask = page.locator(".mdw-task-checkbox").first();
  await expect(firstTask).toHaveAttribute("aria-checked", "true");
  await firstTask.click();
  await expect(firstTask).toHaveAttribute("aria-checked", "false");
  await expect(output).toContainText("* [ ] Deliberate rich, Markdown, and plain-text paste");

  await expect(source).toHaveValue(draft);
  await expect(applyButton).toHaveAttribute("aria-disabled", "false");
  await expect(applyButton).toHaveAccessibleDescription("Source changes are ready to apply.");

  await applyButton.click();
  await expect(firstTask).toHaveAttribute("aria-checked", "true");
  await expect(output).toContainText("UNAPPLIED SOURCE DRAFT");
  await page.waitForTimeout(250);
  await expect(applyButton).toHaveAttribute("aria-disabled", "true");
  await expect(applyButton).toHaveAccessibleDescription("Markdown applied to the visual editor.");
});

test("@required public docs defer noninitial docs and route-only editor runtimes", async ({ page }) => {
  const scripts = new Set<string>();
  page.on("response", (response) => {
    const url = response.url();
    if (response.request().resourceType() === "script") {
      scripts.add(url);
    }
  });

  await page.goto("/docs/getting-started");
  await page.waitForLoadState("networkidle");
  expect([...scripts].some((url) => url.includes("ApiPage-"))).toBe(false);
  expect([...scripts].some((url) => url.includes("ExamplesPage-"))).toBe(false);
  expect([...scripts].some((url) => url.includes("MarkdownCompatibilityPage-"))).toBe(false);
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(false);
  expect([...scripts].some((url) => url.includes("BrowserLabPage-"))).toBe(false);

  await page.getByRole("link", { name: "API overview" }).first().click();
  await expect(page.getByRole("heading", {
    level: 1,
    name: "A compact host API with explicit product boundaries.",
  })).toBeVisible();
  expect([...scripts].some((url) => url.includes("ApiPage-"))).toBe(true);
  expect([...scripts].some((url) => url.includes("ExamplesPage-"))).toBe(false);
  expect([...scripts].some((url) => url.includes("MarkdownCompatibilityPage-"))).toBe(false);
  const overflowingCodeTabStops = await page.locator(".code-block-pre").evaluateAll((regions) => (
    regions
      .filter((region) => region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight)
      .map((region) => (region as HTMLElement).tabIndex)
  ));
  expect(overflowingCodeTabStops.length).toBeGreaterThan(0);
  expect(overflowingCodeTabStops.every((tabIndex) => tabIndex === 0)).toBe(true);

  const playgroundLink = page.getByRole("link", { name: "Core playground" }).first();
  await playgroundLink.hover();
  await expect.poll(() => [...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(true);
  await expect(page).toHaveURL(/\/docs\/api$/);
  await playgroundLink.click();
  await expect(page.locator("#editor > .ProseMirror")).toHaveAccessibleName("Markdown document editor");
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(true);
  expect([...scripts].some((url) => url.includes("BrowserLabPage-"))).toBe(false);
});

test("@required transient keyboard focus does not download the playground runtime", async ({ page }) => {
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") {
      scripts.add(request.url());
    }
  });

  await page.goto("/docs/getting-started");
  const playgroundLink = page.getByRole("link", { name: "Core playground" }).first();
  await page.locator(".topnav").evaluate((navigation) => {
    const transientTarget = navigation.querySelector<HTMLElement>('a[href="/demo"]');
    const nextTarget = navigation.querySelector<HTMLElement>('a[href^="https://github.com/"]');
    transientTarget?.focus();
    nextTarget?.focus();
  });
  await page.waitForTimeout(250);
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(false);

  await playgroundLink.focus();
  await expect.poll(() => [...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(true);
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
});

test("@required playground intent preload respects data-saving preferences", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "4g", saveData: true },
    });
  });
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") {
      scripts.add(request.url());
    }
  });

  await page.goto("/docs/getting-started");
  const playgroundLink = page.getByRole("link", { name: "Core playground" }).first();
  await playgroundLink.focus();
  await page.waitForTimeout(250);
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(false);

  await page.keyboard.press("Enter");
  await expect(page.locator("#editor > .ProseMirror")).toHaveAccessibleName("Markdown document editor");
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(true);
});

test("@required playground intent preload respects slow effective connections", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "2g", saveData: false },
    });
  });
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") {
      scripts.add(request.url());
    }
  });

  await page.goto("/docs/getting-started");
  const playgroundLink = page.getByRole("link", { name: "Core playground" }).first();
  await playgroundLink.hover();
  await page.waitForTimeout(250);
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(false);

  await playgroundLink.click();
  await expect(page.locator("#editor > .ProseMirror")).toHaveAccessibleName("Markdown document editor");
  expect([...scripts].some((url) => url.includes("EditorPlayground-"))).toBe(true);
});

test("@required public site honors reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/getting-started");

  const motion = await page.evaluate(() => ({
    buttonTransition: getComputedStyle(document.querySelector<HTMLElement>(".button")!).transitionDuration,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    skipLinkTransition: getComputedStyle(document.querySelector<HTMLElement>(".skip-link")!).transitionDuration,
  }));

  expect(motion).toEqual({
    buttonTransition: "0s",
    scrollBehavior: "auto",
    skipLinkTransition: "0s",
  });
});

test("@required public controls retain focus and active states in forced colors", async ({
  browserName,
  page,
}) => {
  test.skip(browserName === "webkit", "WebKit exposes the media query without a forced-colors presentation.");
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/demo");

  const activeNavigation = page.locator(".topnav-link.is-active").first();
  await expectForcedColorsFocus(activeNavigation);
  const activeStyle = await activeNavigation.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      forcedColorAdjust: style.forcedColorAdjust,
    };
  });
  expect(activeStyle.forcedColorAdjust).toBe("none");
  expect(activeStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(activeStyle.background).not.toBe(activeStyle.color);

  await expectForcedColorsFocus(page.getByRole("button", { name: /^Bold/ }));
  await expectForcedColorsFocus(page.locator("#source"));
  const codePaneStyles = await page.locator("#source, #output").evaluateAll((elements) => (
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        forcedColorAdjust: style.forcedColorAdjust,
      };
    })
  ));
  for (const style of codePaneStyles) {
    expect(style.forcedColorAdjust).toBe("none");
    expect(style.background).not.toBe(style.color);
  }
  await expectForcedColorsFocus(page.getByRole("button", { name: "Apply Markdown" }));
  await page.getByRole("button", { name: "Insert or edit image" }).click();
  await expectForcedColorsFocus(page.getByRole("dialog", { name: "Insert image" }).getByLabel("Image URL"));

  await page.goto("/docs/getting-started");
  await expectForcedColorsFocus(page.locator(".code-block-copy").first());
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBe(0);
});

test("@required route chunk failures preserve the shell and offer recovery", async ({ page }) => {
  await page.route("**/assets/ApiPage-*.js", async (route) => route.abort("failed"));
  await page.goto("/docs/getting-started");
  await page.getByRole("link", { name: "API overview" }).first().click();

  await expect(page).toHaveURL(/\/docs\/api$/);
  const failure = page.getByRole("alert");
  await expect(failure.getByRole("heading", { name: "This page could not be loaded." })).toBeVisible();
  await expect(failure.getByRole("button", { name: "Reload page" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  await page.getByRole("link", { name: "Getting started" }).first().click();
  await expect(page.getByRole("heading", {
    level: 1,
    name: "Production-minded Markdown editing, inside your product.",
  })).toBeVisible();
});

test("@required code-copy controls are distinguishable and report success or failure", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard permission denied for the regression fixture.");
        },
      },
    });
  });
  await page.goto("/docs/api");
  const buttons = page.locator(".code-block-copy");
  await expect(buttons).toHaveCount(16);
  const labels = await buttons.evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("aria-label"))
  ));
  expect(labels.every(Boolean)).toBe(true);
  expect(new Set(labels).size).toBe(labels.length);

  const failedButton = buttons.first();
  await failedButton.click();
  await expect(failedButton).toHaveText("Copy failed");
  await expect(failedButton).toHaveAttribute("aria-label", /Host resource policy and upload pipeline/);
  const failureStatusId = await failedButton.getAttribute("aria-describedby");
  expect(failureStatusId).toBeTruthy();
  await expect(page.locator(`[id="${failureStatusId}"]`)).toContainText("Could not copy");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  const copiedButton = buttons.nth(1);
  await copiedButton.click();
  await expect(copiedButton).toHaveText("Copied");
  const successStatusId = await copiedButton.getAttribute("aria-describedby");
  expect(successStatusId).toBeTruthy();
  await expect(page.locator(`[id="${successStatusId}"]`)).toContainText("copied to the clipboard");
});

test("@required SPA navigation resets new routes and restores history scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/docs/getting-started");
  await page.evaluate(() => window.scrollTo({
    behavior: "instant",
    top: document.body.scrollHeight,
  }));
  const nextPageLink = page
    .getByRole("navigation", { name: "Page navigation" })
    .getByRole("link", { name: "Next Markdown contract" });
  await nextPageLink.focus();
  const gettingStartedScroll = await page.evaluate(() => window.scrollY);
  expect(gettingStartedScroll).toBeGreaterThan(0);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/docs\/markdown$/);
  await expect(page.getByRole("heading", {
    level: 1,
    name: "A documented dialect with predictable output.",
  })).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate(() => window.scrollTo({
    behavior: "instant",
    top: document.body.scrollHeight,
  }));
  const markdownScroll = await page.evaluate(() => window.scrollY);
  expect(markdownScroll).toBeGreaterThan(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  await expect(page.locator("#site-hero")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(gettingStartedScroll);

  await page.goForward();
  await expect(page).toHaveURL(/\/docs\/markdown$/);
  await expect(page.getByRole("heading", {
    level: 1,
    name: "A documented dialect with predictable output.",
  })).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(markdownScroll);
});

test("@required playground work survives route history without durable storage", async ({ page }) => {
  await page.goto("/demo");
  const storageBefore = await page.evaluate(() => ({
    local: Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right)),
    session: Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right)),
  }));
  const source = page.locator("#source");
  const output = page.locator("#output");
  const appliedDraft = "# Applied route draft\n\nKeep this editor work.";
  const unappliedDraft = `${appliedDraft}\n\nUnapplied source work.`;

  await source.fill(appliedDraft);
  await page.getByRole("button", { name: "Apply Markdown" }).click();
  await expect(output).toHaveText(appliedDraft);
  await page.getByRole("link", { name: "Getting started" }).first().click();
  await page.goBack();
  await expect(source).toHaveValue(appliedDraft);
  await expect(output).toHaveText(appliedDraft);

  await source.fill(unappliedDraft);
  await page.getByRole("link", { name: "Getting started" }).first().click();
  await page.goBack();
  await expect(source).toHaveValue(unappliedDraft);
  await expect(output).toHaveText(appliedDraft);
  await expect(page.getByRole("button", { name: "Apply Markdown" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await expect(page.locator("#playground-source-status")).toHaveText(
    "Source changes are ready to apply.",
  );

  const storageAfter = await page.evaluate(() => ({
    local: Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right)),
    session: Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right)),
  }));
  expect(storageAfter).toEqual(storageBefore);

  await page.reload();
  await expect(source).toHaveValue(initialMarkdown);
  await expect(output).not.toContainText("Applied route draft");
  await expect(output).not.toContainText("Unapplied source work");
  await expect(page.getByRole("button", { name: "Apply Markdown" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.locator("#playground-source-status")).toHaveText("No source changes to apply.");
});

test("@required coarse-pointer toolbar taps preserve the editor selection", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== "chromium", "Raw touch input is exercised through Chromium CDP.");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "hover", value: "none" },
    ],
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/demo");
  await page.locator("#source").fill("hello world");
  await page.getByRole("button", { name: "Apply Markdown" }).click();
  const paragraph = await selectWorld(page);

  const linkButton = page.getByRole("button", { name: "Add or edit link" });
  await linkButton.scrollIntoViewIfNeeded();
  await dispatchTouch(cdp, linkButton);
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("URL").fill("https://example.test/touch");
  await dispatchTouch(cdp, dialog.getByRole("button", { name: "Apply" }));

  await expect(dialog).toBeHidden();
  await expect(paragraph.locator("a")).toHaveAttribute("href", "https://example.test/touch");
  await expect(page.locator("#output")).toHaveText("hello [world](https://example.test/touch)");
});

test("@required coarse-pointer controls and short-viewport popovers stay reachable", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== "chromium", "Pointer media and visual viewport are exercised through Chromium CDP.");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "hover", value: "none" },
    ],
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/docs/getting-started");

  for (const target of await page.locator(".brand, .topnav-link, .button, .code-block-copy").all()) {
    await expectTouchTarget(target);
  }

  await page.goto("/demo");
  for (const target of await page.locator(".mdw-toolbar-button, .button").all()) {
    await expectTouchTarget(target);
  }

  await page.getByRole("button", { name: "Insert or edit image" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert image" });
  for (const target of await dialog.locator("input, button").all()) {
    await expectTouchTarget(target);
  }

  await dialog.getByLabel("Title").focus();
  await page.setViewportSize({ width: 320, height: 240 });
  const expectFocusedControlWithinViewport = async () => {
    await expect.poll(() => page.evaluate(() => {
      const dialogElement = document.querySelector<HTMLElement>(".mdw-toolbar-popover:not([hidden])")!;
      const activeElement = document.activeElement as HTMLElement;
      const dialogRect = dialogElement.getBoundingClientRect();
      const activeRect = activeElement.getBoundingClientRect();
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      return dialogRect.top >= viewportTop + 10
        && dialogRect.bottom <= viewportBottom - 10
        && activeRect.top >= dialogRect.top
        && activeRect.bottom <= dialogRect.bottom;
    })).toBe(true);
  };

  await expectFocusedControlWithinViewport();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeFocused();
  await expectFocusedControlWithinViewport();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectFocusedControlWithinViewport();
});
