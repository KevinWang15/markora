import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const [platform, arch] = process.argv.slice(2);
assert.equal(platform, { win32: "win", darwin: "osx", linux: "linux" }[process.platform]);
assert.equal(arch, process.arch);
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "release", `${platform}-${arch}-sdk`);
const executable = path.join(output, platform === "osx" ? "Markora.app/Contents/MacOS/Markora" : platform === "win" ? "Markora.exe" : "Markora");
const diagnostics = path.resolve("test-results/native");
await mkdir(diagnostics, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "markora-behavior-"));
const sourceDirectory = path.join(temporary, "a"), destinationDirectory = path.join(temporary, "b");
await mkdir(sourceDirectory); await mkdir(destinationDirectory);
const documentPath = path.join(sourceDirectory, "native.md");
const copiedPath = path.join(destinationDirectory, "copy.md");
const htmlPath = path.join(destinationDirectory, "export.html");
const pdfPath = path.join(destinationDirectory, "export.pdf");
const original = '# Native behavior\n\ncat cat\n\n![local](picture%20name.svg)\n\nInline $x^2$.\n';
await writeFile(documentPath, original);
await writeFile(path.join(sourceDirectory, "picture name.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="blue"/></svg>');
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const log = createWriteStream(path.join(diagnostics, "runtime.log"));
const child = spawn(executable, [`--user-data-dir=${path.join(temporary, "profile")}`, `--remote-debugging-port=${port}`, "--no-first-run", "--disable-gpu", "--enable-logging=stderr", ...(platform === "linux" ? ["--no-sandbox"] : []), documentPath], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
let launchError, browser, page;
child.on("error", error => { launchError = error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const pass = label => { checks.push(label); console.log(`PASS: ${label}`); };
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, "Native process exited before CDP connected");
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
    catch { await pause(250); }
  }
  assert.ok(browser, "SDK runtime must expose CDP");
  for (let attempt = 0; attempt < 80; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes("index.html"));
    if (page) break;
    await pause(250);
  }
  assert.ok(page, "Packaged renderer must open");
  page.setDefaultTimeout(15_000);
  const cdp = await page.context().newCDPSession(page);
  const mod = platform === "osx" ? "Meta" : "Control";
  const end = platform === "osx" ? "Meta+ArrowDown" : "Control+End";
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  const toSource = async () => { await page.getByRole("button", { name: "Edit Markdown source", exact: true }).click(); await source.waitFor(); };
  const toRich = async () => { await page.getByRole("button", { name: "Return to rich text", exact: true }).click(); };
  await expect(page).toHaveTitle("native.md — Markora");
  await page.waitForFunction(() => document.querySelector(".mdw-image img")?.naturalWidth === 100);
  await expect(page.locator(".mdw-math__preview math")).toHaveCount(1);
  pass("native command-line open, relative image loading, and math preview");
  await toSource(); await source.click(); await page.keyboard.press(end); await cdp.send("Input.insertText", { text: "\nsaved" });
  await expect(source).toContainText("saved");
  await page.evaluate(() => {
    const fs = window.nw.require("node:fs/promises"), rename = fs.rename.bind(fs), path = window.nw.require("node:path");
    window.restoreRename = () => { fs.rename = rename; };
    window.observedRenames = [];
    // NW normalizes startup paths on Windows/macOS; target the unique fixture
    // filename so /private/var aliases and path separators do not skip the delay.
    fs.rename = async (...args) => { window.observedRenames.push(String(args[1])); if (path.basename(String(args[1])) === "native.md") await new Promise(resolve => { window.finishSave = resolve; }); return rename(...args); };
  });
  await page.getByRole("button", { name: "Save document", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.finishSave));
  await source.focus(); await page.keyboard.press(end); await cdp.send("Input.insertText", { text: " NEW" });
  await page.evaluate(() => window.finishSave());
  await expect(page.getByRole("button", { name: "Save document", exact: true })).toBeEnabled();
  assert.doesNotMatch(await readFile(documentPath, "utf8"), /NEW/u);
  assert.equal(await readFile(path.join(sourceDirectory, ".native.md.markora-backup"), "utf8"), original);
  await expect(page.locator(".app-file-location")).toHaveText("Edited");
  await page.evaluate(() => window.restoreRename());
  pass("actual atomic file save, backup, and newer edits during delayed rename");
  // Only the OS chooser is substituted; persistence below uses the real native filesystem.
  await page.evaluate(({ copiedPath, htmlPath, pdfPath }) => {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (!this.hasAttribute("nwsaveas")) return click.call(this);
      const destination = this.getAttribute("accept").includes("html") ? htmlPath : this.getAttribute("accept").includes("pdf") ? pdfPath : copiedPath;
      const file = new File([], "selected"); Object.defineProperty(file, "path", { value: destination });
      Object.defineProperty(this, "files", { value: [file] }); this.dispatchEvent(new Event("change"));
    };
  }, { copiedPath, htmlPath, pdfPath });
  await source.focus(); await page.keyboard.press(`${mod}+Shift+s`);
  await expect(page).toHaveTitle("copy.md — Markora");
  assert.match(await readFile(copiedPath, "utf8"), /NEW/u);
  assert.equal(await readFile(path.join(destinationDirectory, "picture name.svg"), "utf8"), await readFile(path.join(sourceDirectory, "picture name.svg"), "utf8"));
  await toRich(); await page.waitForFunction(() => document.querySelector(".mdw-image img")?.naturalWidth === 100);
  pass("native Save As copies relative assets and refreshes image resolution");
  await page.keyboard.press(`${mod}+f`);
  await page.getByRole("textbox", { name: "Find text", exact: true }).fill("cat");
  await page.getByRole("textbox", { name: "Replacement text" }).fill("dog");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await page.getByRole("button", { name: "Close find and replace", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await toSource(); await expect(source).toContainText("cat cat");
  pass("native find/replace and shared undo across editor modes");
  await page.getByRole("button", { name: "Export HTML", exact: true }).click();
  await expect.poll(async () => readFile(htmlPath, "utf8").catch(() => "")).toContain("data:image/svg+xml;base64,");
  assert.match(await readFile(htmlPath, "utf8"), /<math/u);
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("night");
  await page.evaluate(() => {
    const menu = window.nw.Window.get().menu;
    const file = menu.items.find(item => item.label === "File").submenu;
    const pdf = file.items.find(item => item.label === "Export").submenu.items.find(item => item.label === "PDF…");
    if (!pdf.enabled) throw new Error("Native PDF export must be available");
    pdf.click();
  });
  await expect.poll(async () => (await readFile(pdfPath).catch(() => Buffer.alloc(0))).length, { timeout: 30_000 }).toBeGreaterThan(2000);
  assert.equal((await readFile(pdfPath)).subarray(0, 5).toString(), "%PDF-");
  await writeFile(path.join(diagnostics, "export.pdf"), await readFile(pdfPath));
  await expect(page.getByRole("button", { name: "Export PDF", exact: true })).toBeEnabled();
  pass("native HTML export embeds local images and File → Export → PDF prints with the selected theme");
  await page.bringToFront(); await source.click(); await page.keyboard.press(end); await cdp.send("Input.insertText", { text: " RECOVER 中文 🙂" });
  await expect(source).toContainText("RECOVER 中文 🙂");
  await expect.poll(() => page.evaluate(async () => {
    const fs = window.nw.require("node:fs/promises"), path = window.nw.require("node:path");
    const recovery = JSON.parse(await fs.readFile(path.join(window.nw.App.dataPath, "recovery.json"), "utf8"));
    return recovery.markdown.includes("RECOVER") && recovery.markdown !== recovery.savedMarkdown;
  })).toBe(true);
  await writeFile(path.join(diagnostics, "recovery-before.json"), await page.evaluate(async () => {
    return window.nw.require("node:fs/promises").readFile(window.nw.require("node:path").join(window.nw.App.dataPath, "recovery.json"), "utf8");
  }));
  await page.reload(); await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(source).toContainText("RECOVER 中文 🙂");
  await page.evaluate(() => window.nw.Window.get().close());
  await page.getByRole("alertdialog").waitFor(); await page.keyboard.press("Escape");
  await expect(source).toContainText("RECOVER 中文 🙂");
  pass("native recovery, Unicode input, and unsaved-close cancellation");
  await page.screenshot({ path: path.join(diagnostics, "complete.png") });
} catch (error) {
  const state = await page?.evaluate(() => ({ title: document.title, renames: window.observedRenames, text: document.body.innerText })).catch(() => null);
  await writeFile(path.join(diagnostics, "failure.json"), JSON.stringify({ error: String(error), state }, null, 2));
  await page?.screenshot({ path: path.join(diagnostics, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(path.join(diagnostics, "report.json"), JSON.stringify({ platform, arch, runtime: "NW.js SDK 0.115.0", checks, limits: "File choosers substituted. Unicode insertion is synthetic; actual OS IME, screen reader, and native chooser certification remain manual." }, null, 2));
  await page?.evaluate(() => window.nw.Window.get().close(true)).catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    if (platform === "win") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      await new Promise(resolve => { killer.on("exit", resolve); killer.on("error", resolve); });
    } else { child.kill("SIGTERM"); await pause(500); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }
  log.end();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
