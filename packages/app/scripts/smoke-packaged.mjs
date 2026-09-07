import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The normal NW.js flavor has no DevTools. This is a native launch/packaging
// smoke check; renderer behavior is covered separately by test:app:browser.
const [platform, arch] = process.argv.slice(2);
const host = { win32: "win", darwin: "osx", linux: "linux" }[process.platform];
assert.equal(platform, host, "Run this check on its target platform.");
assert.equal(arch, process.arch, "Run this check on its target architecture.");
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(packageRoot, "release", `${platform}-${arch}`);
const executable = platform === "osx" ? path.join(output, "Markora.app/Contents/MacOS/Markora")
  : path.join(output, platform === "win" ? "Markora.exe" : "Markora");
const app = path.join(output, platform === "osx" ? "Markora.app/Contents/Resources/app.nw" : "package.nw");
const manifest = JSON.parse(await readFile(path.join(app, "package.json"), "utf8"));
assert.equal(manifest.name, "markora-app");
assert.equal(manifest.main, "index.html");
await access(executable);
const html = await readFile(path.join(app, manifest.main), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)];
assert.ok(scripts.length > 0, "The bundle must contain a renderer entry script.");
for (const [, script] of scripts) await access(path.resolve(app, script));
const diagnostics = path.resolve("test-results/packaged");
await mkdir(diagnostics, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "markora-package-"));
const documentPath = path.join(temporary, "smoke.md");
await writeFile(documentPath, "# Packaged application\n\nMarkora native smoke test.\n");
const log = createWriteStream(path.join(diagnostics, "runtime.log"));
const child = spawn(executable, [
  `--user-data-dir=${path.join(temporary, "profile")}`, "--no-first-run", "--disable-gpu",
  "--enable-logging=stderr", ...(process.platform === "linux" ? ["--no-sandbox"] : []), documentPath,
], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
let launchError;
child.on("error", error => { launchError = error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  // Detect missing libraries, invalid signatures, and immediate startup crashes.
  // Staying alive does not certify the renderer's editing behavior.
  for (let iteration = 0; iteration < 20; iteration += 1) {
    await pause(500);
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, "Packaged application exited during startup.");
    assert.equal(child.signalCode, null, "Packaged application crashed during startup.");
  }
  console.log(`PASS ${platform}-${arch}: packaged manifest, renderer entry, and native process startup.`);
} finally {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      await new Promise(resolve => { killer.on("exit", resolve); killer.on("error", resolve); });
    } else {
      child.kill("SIGTERM");
      await Promise.race([new Promise(resolve => child.on("exit", resolve)), pause(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }
  log.end();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
