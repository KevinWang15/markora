// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("skips excluded engines before creating their page fixture", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  mkdirSync(join(root, ".cache"), { recursive: true });
  const directory = mkdtempSync(join(root, ".cache/browser-support-"));
  try {
    writeFileSync(join(directory, "playwright.config.ts"), `
      import { defineConfig } from "@playwright/test";
      export default defineConfig({ testDir: ".", workers: 1, retries: 0,
        reporter: "json", projects: ["chromium", "firefox", "webkit"].map(browserName => ({
          name: browserName, use: { browserName },
        })), outputDir: "./results" });
    `);
    writeFileSync(join(directory, "support.spec.ts"), `
      import { chromiumTest, expect } from "../../tests/browser/fixtures";
      const test = chromiumTest.extend({ page: async ({ browserName }, use) => {
        if (browserName !== "chromium") throw new Error("Excluded engine created a page");
        await use({ supportedPage: true });
      } });
      test("engine support precedes page setup", async ({ page }) => {
        expect(page).toEqual({ supportedPage: true });
      });
    `);
    const result = spawnSync(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"),
      "test", "--config", join(directory, "playwright.config.ts")], {
      cwd: root, encoding: "utf8", timeout: 25_000,
      env: { ...process.env, CI: "", PLAYWRIGHT_JSON_OUTPUT_NAME: "", PLAYWRIGHT_JSON_OUTPUT_FILE: "" },
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).stats).toMatchObject({ expected: 1, skipped: 2, unexpected: 0, flaky: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
