import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

// Run against a production app preview, e.g. vite preview --port 4175.
const url = process.env.MARKORA_BENCHMARK_URL ?? "http://127.0.0.1:4175";
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const bytes of [100_000, 500_000, 1_000_000]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(90_000);
    await page.goto(url);
    const paragraph = "Writing should stay responsive while a document grows. ".repeat(8);
    let content = "";
    for (let index = 0; content.length < bytes; index++) content += `## Section ${index}\n\n${paragraph}\n\n`;
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open document", exact: true }).click();
    const start = performance.now();
    await (await choosing).setFiles({ name: "benchmark.md", mimeType: "text/markdown", buffer: Buffer.from(content) });
    await page.waitForFunction(() => document.querySelector(".app-editor h2")?.textContent?.includes("Section 0"));
    await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click();
    await page.getByRole("textbox", { name: "Markdown source", exact: true }).focus();
    const openAndSourceMs = performance.now() - start;
    await page.waitForTimeout(1000);
    const cdp = await page.context().newCDPSession(page);
    const samples = [];
    for (let index = 0; index < 30; index++) {
      await page.evaluate(() => { window.markoraBenchmarkStart = performance.now(); });
      await cdp.send("Input.insertText", { text: "x" });
      const elapsed = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - window.markoraBenchmarkStart)))));
      samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    const result = { bytes: content.length, openAndSourceMs, inputToTwoFramesMedianMs: samples[15], inputToTwoFramesP95Ms: samples[28] };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
} finally { await browser.close(); }
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2) + "\n");
