import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/docs/components");
  await expect(page.locator('.mdw-component[data-status="ready"]')).toHaveCount(1);
});

test("@required components: CDP editing, persistence, history and screenshots", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Chrome DevTools Protocol requires Chromium.");
  await page.setViewportSize({ width: 1440, height: 1120 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  cdp.on("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.text));
  cdp.on("Log.entryAdded", event => { if (event.entry.level === "error") errors.push(event.entry.text); });
  const screenshot = async (name: string) => {
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = testInfo.outputPath(name);
    await writeFile(path, Buffer.from(capture.data, "base64"));
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  await screenshot("components-overview.png");
  const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: ["display"] });
  expect(snapshot.documents.length).toBeGreaterThan(0);
  const component = page.locator(".mdw-component");
  await expect(component).toHaveClass(/mdw-atom-block/);
  await expect(component.locator(".mdw-atom-status")).toHaveAttribute("role", "status");
  const markdown = page.locator("[data-component-markdown]");
  await component.getByRole("button", { name: "Edit component", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Configure metrics chart" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Chart title").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await cdp.send("Input.insertText", { text: "Production memory · CDP" });
  await dialog.getByLabel("Metric", { exact: true }).selectOption("memory");
  await dialog.getByLabel("Time window").selectOption("60");
  await dialog.getByLabel("Chart color").selectOption("violet");
  await screenshot("components-settings.png");
  await dialog.getByRole("button", { name: "Save chart" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(component).toContainText("Production memory · CDP");
  await expect(component).toContainText("6.4GiB");
  await expect(markdown).toContainText('"metric": "memory"');
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(component).toContainText("Production CPU");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(component).toContainText("Production memory · CDP");
  const saved = await markdown.textContent();
  await page.getByRole("button", { name: "Reload Markdown" }).click();
  await expect(component).toContainText("Production memory · CDP");
  await expect(markdown).toHaveText(saved!);
  await expect(page.locator(".components-status")).toContainText("Reloaded from Markdown");
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot("components-edited.png");
  expect(errors).toEqual([]);
  await cdp.detach();
});

test("@required components: JSON validation, keyboard apply, cancel and undo", async ({ page }) => {
  const component = page.locator(".mdw-component");
  await component.getByRole("button", { name: "Edit properties" }).click();
  const input = component.getByLabel("Component properties (JSON)");
  await input.fill('{"title":false}');
  await component.getByRole("button", { name: "Apply changes" }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(component.getByRole("alert")).toContainText("title");
  await input.fill('{"title":"HTTP traffic","metric":"requests","window":5,"color":"blue"}');
  await input.press("ControlOrMeta+Enter");
  await expect(input).toBeHidden();
  await expect(component).toContainText("HTTP traffic");
  await component.getByRole("button", { name: "Edit properties" }).click();
  await input.fill("broken JSON");
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(component).toContainText("HTTP traffic");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(component).toContainText("Production CPU");
});

test("@required components: runtime registration and read-only transitions preserve source", async ({ page }) => {
  const markdown = page.locator("[data-component-markdown]");
  const original = await markdown.textContent();
  await page.getByLabel("Chart registered").uncheck();
  await expect(page.locator('.mdw-component[data-status="unregistered"]')).toBeVisible();
  await expect(page.locator(".metrics-chart")).toHaveCount(0);
  await expect(markdown).toHaveText(original!);
  await page.getByLabel("Chart registered").check();
  await expect(page.locator('.mdw-component[data-status="ready"]')).toBeVisible();
  await page.getByLabel("Read-only", { exact: true }).check();
  await expect(page.getByRole("button", { name: "Edit component", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "+ Insert chart", exact: true })).toBeDisabled();
  await expect(page.locator(".components-editor .ProseMirror")).toHaveAttribute("contenteditable", "false");
  await page.getByLabel("Read-only", { exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Edit component", exact: true })).toBeVisible();
  await expect(markdown).toHaveText(original!);
});

test("@required components: insertion, deletion, surrounding text and history", async ({ page }) => {
  await page.getByRole("button", { name: "+ Insert chart", exact: true }).click();
  await expect(page.locator(".mdw-component")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".mdw-component")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".mdw-component")).toHaveCount(2);
  const paragraph = page.locator(".components-editor .ProseMirror > p").last();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Additional context.");
  await expect(page.locator("[data-component-markdown]")).toContainText("Additional context.");
  await expect(page.locator(".mdw-component")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(paragraph).not.toContainText("Additional context.");
  await expect(page.locator(".mdw-component")).toHaveCount(2);
});

test("@required components: settings cancel and Escape leave Markdown unchanged", async ({ page }) => {
  const markdown = page.locator("[data-component-markdown]");
  const original = await markdown.textContent();
  await page.getByRole("button", { name: "Edit component", exact: true }).click();
  await page.getByLabel("Chart title").fill("Do not save");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(markdown).toHaveText(original!);
  await expect(page.getByRole("button", { name: "Edit component", exact: true })).toBeFocused();
});

test("@required components: accessible previews and settings", async ({ page }) => {
  const preview = await new AxeBuilder({ page }).include(".components-workspace").analyze();
  expect(preview.violations).toEqual([]);
  await page.getByRole("button", { name: "Edit component", exact: true }).click();
  const settings = await new AxeBuilder({ page }).include(".metrics-dialog").analyze();
  expect(settings.violations).toEqual([]);
});

test("@required components: mobile layout, dark theme and remount", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
  await expect(page.locator(".mdw-component")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Edit component", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(390);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/docs/api");
  await page.goto("/docs/components");
  await expect(page.locator('.mdw-component[data-status="ready"]')).toHaveCount(1);
  await expect(page.locator(".mdw-component")).toContainText("Production CPU");
});

test("@required components: the selection ring follows editor focus", async ({ page }) => {
  const component = page.locator(".mdw-component");
  const ring = () => component.evaluate(element => getComputedStyle(element).outlineStyle);
  // Clicking the header selects the component as a node.
  await component.locator(".mdw-component-header").click({ position: { x: 12, y: 8 } });
  await expect.poll(ring).toBe("solid");
  // Focus leaves the editor: the selection is kept, but no longer drawn, as with text selection.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await expect.poll(ring).toBe("none");
  await expect(component).toHaveClass(/ProseMirror-selectednode/);
  // Selecting it again while focused draws the ring again.
  await component.locator(".mdw-component-header").click({ position: { x: 12, y: 8 } });
  await expect.poll(ring).toBe("solid");
});
