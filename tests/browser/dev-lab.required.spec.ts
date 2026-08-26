import { expect, test, type Page } from "@playwright/test";

async function expectFocusedElementInViewport(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const element = document.activeElement;

    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0
      && bounds.left >= 0
      && bounds.bottom <= window.innerHeight
      && bounds.right <= window.innerWidth;
  })).toBe(true);
}

async function expectElementInViewport(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0
      && bounds.left >= 0
      && bounds.bottom <= window.innerHeight
      && bounds.right <= window.innerWidth;
  })).toBe(true);
}

test("@required dev source dismissal discards drafts and Apply commits only the current edit", async ({ page }) => {
  await page.goto("/__dev");

  const markdownButton = page.getByRole("button", { name: "Markdown" });
  const sourceDialog = page.getByRole("dialog", { name: "Markdown source" });
  const source = page.locator(".dev-lab-source");

  await markdownButton.click();
  await expect(sourceDialog).toBeVisible();
  await expect(source).toBeFocused();
  await expect(markdownButton).toHaveAttribute("aria-expanded", "true");
  const canonicalMarkdown = await source.inputValue();

  await source.fill("# Dismissed with Cancel\n\nThis must stay transient.");
  await sourceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(sourceDialog).toBeHidden();
  await expect(markdownButton).toBeFocused();
  await expect(markdownButton).toHaveAttribute("aria-expanded", "false");

  await markdownButton.click();
  await expect(source).toHaveValue(canonicalMarkdown);
  await source.fill("# Dismissed with Escape\n\nThis must also stay transient.");
  await source.press("Escape");
  await expect(sourceDialog).toBeHidden();
  await expect(markdownButton).toBeFocused();

  await markdownButton.click();
  await expect(source).toHaveValue(canonicalMarkdown);
  await source.fill("# Dismissed with backdrop\n\nThis must not leak either.");
  await page.locator(".dev-modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(sourceDialog).toBeHidden();
  await expect(markdownButton).toBeFocused();

  const committedMarkdown = "# Applied source\n\nThis edit is committed.";
  await markdownButton.click();
  await expect(source).toHaveValue(canonicalMarkdown);
  await source.fill(committedMarkdown);
  await sourceDialog.getByRole("button", { name: "Apply source" }).click();
  await expect(sourceDialog).toBeHidden();
  await expect(markdownButton).toBeFocused();
  await expect(page.locator(".dev-lab-editor")).toContainText("Applied source");

  await markdownButton.click();
  await expect(source).toHaveValue(committedMarkdown);
});

test("@required dev modals keep every focused control reachable in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto("/__dev");

  const presetsButton = page.getByRole("button", { name: "Presets" });
  await presetsButton.click();
  const presetsDialog = page.getByRole("dialog", { name: "Preset markdown examples" });
  const activePreset = presetsDialog.getByRole("button", { name: "codeblock-after-list" });
  await expect(activePreset).toBeFocused();
  await expect(presetsDialog.getByRole("group", { name: "Markdown presets" })).toBeVisible();
  await expect(activePreset).toHaveAttribute("aria-pressed", "true");
  await expect(presetsDialog.getByRole("button", { name: "table-with-inline-marks" }))
    .toHaveAttribute("aria-pressed", "false");
  await expectFocusedElementInViewport(page);
  await expectElementInViewport(page, "#dev-presets-dialog");
  expect(await presetsDialog.evaluate((dialog) => dialog.scrollHeight > dialog.clientHeight)).toBe(true);

  await page.keyboard.press("Shift+Tab");
  await expect(presetsDialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expectFocusedElementInViewport(page);
  await page.keyboard.press("Tab");
  await expect(activePreset).toBeFocused();

  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Tab");
    await expectFocusedElementInViewport(page);
  }

  await page.keyboard.press("Escape");
  await expect(presetsDialog).toBeHidden();
  await expect(presetsButton).toBeFocused();

  const markdownButton = page.getByRole("button", { name: "Markdown" });
  await markdownButton.click();
  const sourceDialog = page.getByRole("dialog", { name: "Markdown source" });
  const source = page.locator(".dev-lab-source");
  await expect(source).toBeFocused();
  await expectFocusedElementInViewport(page);
  await expectElementInViewport(page, "#dev-source-dialog");
  expect(await sourceDialog.evaluate((dialog) => dialog.scrollHeight > dialog.clientHeight)).toBe(true);

  await page.keyboard.press("Tab");
  await expect(sourceDialog.getByRole("button", { name: "Apply source" })).toBeFocused();
  await expectFocusedElementInViewport(page);
  await page.keyboard.press("Tab");
  await expect(sourceDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectFocusedElementInViewport(page);
  await page.keyboard.press("Tab");
  await expect(source).toBeFocused();
  await expectFocusedElementInViewport(page);
});
