import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/app",
  outputDir: "test-results/app",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: (process.env.MARKORA_BROWSER_BUILD === "reuse" ? "" : "pnpm build:packages && pnpm --filter markora-app build && ")
      + "pnpm --filter markora-app exec vite preview --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
