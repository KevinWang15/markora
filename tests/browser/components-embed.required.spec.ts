import { expect, test } from "@playwright/test";

for (const root of ["iframe", "shadow"] as const) {
  for (const entry of ["root", "minimal"] as const) {
    test(`@required components: ${entry} in ${root} edits, restores history and cleans up`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/__browser");
      await expect(page.locator("[data-e2e-browser-lab]")).toHaveAttribute("data-ready", "true");
      await page.evaluate(({ root, entry }) => window.__MARKORA_COMPONENTS_LAB__!.mount(root, entry), { root, entry });
      const embed = root === "iframe" ? page.frameLocator("[data-components-embed]") : page.locator("[data-components-embed]");
      const component = embed.locator(".mdw-component");
      await expect(component).toContainText("Embedded CPU");
      await component.getByRole("button", { name: "Edit component", exact: true }).click();
      const dialog = root === "iframe" ? embed.getByRole("dialog") : page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Chart title").fill(`${root} memory`);
      await dialog.getByLabel("Metric", { exact: true }).selectOption("memory");
      await dialog.getByRole("button", { name: "Save chart" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(component).toContainText(`${root} memory`);
      await expect.poll(() => page.evaluate(() => window.__MARKORA_COMPONENTS_LAB__!.markdown())).toContain(`${root} memory`);
      await page.evaluate(() => window.__MARKORA_COMPONENTS_LAB__!.undo());
      await expect(component).toContainText("Embedded CPU");
      await component.getByRole("button", { name: "Edit properties" }).click();
      const source = component.getByLabel("Component properties (JSON)");
      await source.fill('{"title":"Source edit","metric":"cpu","window":5,"color":"blue"}');
      await source.press("ControlOrMeta+Enter");
      await expect(source).toBeHidden();
      await expect(component).toContainText("Source edit");
      await component.getByRole("button", { name: "Edit component", exact: true }).click();
      await page.evaluate(() => window.__MARKORA_COMPONENTS_LAB__!.reset());
      await expect(dialog).toHaveCount(0);
      await expect(component).toContainText("Source edit");
      await component.getByRole("button", { name: "Edit component", exact: true }).click();
      await page.evaluate(() => window.__MARKORA_COMPONENTS_LAB__!.readonly());
      await expect(dialog).toHaveCount(0);
      await expect(component.getByRole("button", { name: "Edit component", exact: true })).toBeHidden();
      await page.evaluate(() => window.__MARKORA_COMPONENTS_LAB__!.destroy());
      await expect(page.locator("[data-components-embed]")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
