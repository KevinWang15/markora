import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
const isCI = Boolean(
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.CI,
);

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: isCI,
  fullyParallel: true,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: isCI ? 2 : 0,
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: (process.env.MARKORA_BROWSER_BUILD === "reuse" ? "" : "pnpm build:packages && pnpm --filter demo build && ")
      + "pnpm --filter demo exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 1_000,
    },
    reuseExistingServer: !isCI,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 180_000,
    url: baseURL,
  },
  workers: isCI ? 1 : undefined,
});
