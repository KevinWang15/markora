import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { cpus, homedir, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { evaluateBudget, evaluateSummaryBudgets, reportBudgetEvaluations } from "./performance/budget-evaluator.mjs";
import { summarizeRecords } from "./performance/statistics.mjs";
import {
  ADVANCED_SYNTAX_DOCUMENT_TARGETS,
  ADVANCED_SYNTAX_DOCUMENT_VERSION,
  createAdvancedSyntaxDocument,
} from "./performance/advanced-syntax-document.mjs";

const HARNESS_VERSION = "packed-all-seven-v2";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerSourceDir = join(rootDir, "scripts/performance/advanced-syntax-consumer");
const workspaceNodeModulesDir = join(rootDir, "node_modules/.pnpm/node_modules");
const viteCliPath = join(rootDir, "packages/demo/node_modules/vite/bin/vite.js");
const budgetPath = join(rootDir, "performance/budgets.json");
const defaultOutputPath = join(rootDir, "performance-results/advanced-syntax.json");
const packagePaths = Object.freeze([
  "packages/core",
  "packages/extension-frontmatter",
  "packages/extension-footnotes",
  "packages/extension-math",
  "packages/extension-alerts",
  "packages/extension-toc",
  "packages/extension-html",
  "packages/extension-diagrams",
]);
const expectedPackageNames = Object.freeze([
  "markora",
  "markora-extension-frontmatter",
  "markora-extension-footnotes",
  "markora-extension-math",
  "markora-extension-alerts",
  "markora-extension-toc",
  "markora-extension-html",
  "markora-extension-diagrams",
]);
const expectedOptionalNames = expectedPackageNames.filter((name) => name !== "markora");
const browserOptions = Object.freeze({
  deviceScaleFactor: 1,
  locale: "en-US",
  reducedMotion: "reduce",
  timezoneId: "UTC",
  viewport: Object.freeze({ height: 720, width: 1280 }),
});
const sampling = Object.freeze({ memorySamples: 3, timingSamples: 5, warmups: 1 });
const rendererConcurrency = 4;
const timingMetricNames = Object.freeze([
  "mountSyncMs",
  "ordinaryEditSyncMs",
  "footnoteStructuralEditSyncMs",
  "tocHeadingEditSyncMs",
  "diagramRemovalSyncMs",
  "destroySyncMs",
]);
const memoryMetricNames = Object.freeze([
  "mountedTrackedMemoryDeltaBytes",
  "retainedTrackedMemoryDeltaBytes",
  "mountedNodeDelta",
  "retainedNodeDelta",
  "mountedListenerDelta",
  "retainedListenerDelta",
  "mountedDocumentDelta",
  "retainedDocumentDelta",
]);

function parseArguments(argv) {
  let check = false;
  let keepTemp = false;
  let outputPath = defaultOutputPath;
  for (const argument of argv) {
    if (argument === "--check") check = true;
    else if (argument === "--keep-temp") keepTemp = true;
    else if (argument.startsWith("--output=")) {
      outputPath = resolve(rootDir, argument.slice("--output=".length));
    } else throw new TypeError(`Unknown advanced syntax performance argument: ${argument}`);
  }
  return Object.freeze({ check, keepTemp, outputPath });
}

function run(command, args, { capture = false, cwd = rootDir } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (capture) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}.`);
  }
  return capture ? (result.stdout ?? "").trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function copyWorkspaceDependencies(destination) {
  for (const entry of readdirSync(workspaceNodeModulesDir)) {
    if (
      entry === ".bin"
      || entry === "demo"
      || entry === "markora"
      || entry === "markora-ui"
      || entry.startsWith("markora-extension-")
    ) continue;
    symlinkSync(
      join(workspaceNodeModulesDir, entry),
      join(destination, entry),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

function packAndInstall(appDir, tempRoot) {
  const nodeModulesDir = join(appDir, "node_modules");
  const packages = [];
  copyWorkspaceDependencies(nodeModulesDir);
  for (const relativePath of packagePaths) {
    const packageDir = join(rootDir, relativePath);
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    if (!existsSync(join(packageDir, "dist/index.js"))) {
      throw new Error(`${packageJson.name} is not built; run pnpm check or pnpm pack:smoke first.`);
    }
    const tarballDir = join(tempRoot, "tarballs", packageJson.name);
    mkdirSync(tarballDir, { recursive: true });
    run("npm", ["pack", "--ignore-scripts", "--pack-destination", tarballDir], { cwd: packageDir });
    const tarballs = readdirSync(tarballDir).filter((entry) => entry.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      throw new Error(`Expected one tarball for ${packageJson.name}, found ${tarballs.length}.`);
    }
    const tarballPath = join(tarballDir, tarballs[0]);
    const destination = join(nodeModulesDir, packageJson.name);
    mkdirSync(destination, { recursive: true });
    run("tar", ["-xzf", tarballPath, "-C", destination, "--strip-components=1"]);
    packages.push(Object.freeze({
      name: packageJson.name,
      sha256: sha256File(tarballPath),
      tarball: tarballs[0],
      version: packageJson.version,
    }));
  }
  if (packages.map(({ name }) => name).join(":") !== expectedPackageNames.join(":")) {
    throw new Error("The all-seven performance consumer installed an unexpected package set.");
  }
  return Object.freeze(packages);
}

function writeViteConfig(appDir) {
  writeFileSync(join(appDir, "vite.config.mjs"), `import { resolve } from "node:path";

function provenancePlugin() {
  return {
    name: "markora-all-seven-performance-provenance",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((entry) => entry.type === "chunk");
      this.emitFile({
        type: "asset",
        fileName: "packed-provenance.json",
        source: JSON.stringify({
          moduleIds: [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)))].sort(),
        }, null, 2) + "\\n",
      });
    },
  };
}

export default {
  base: "/",
  build: { emptyOutDir: true, minify: "esbuild", outDir: resolve(process.cwd(), "dist") },
  plugins: [provenancePlugin()],
};
`);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/\?.*$/u, "");
}

function assertPackedProvenance(appDir) {
  const report = JSON.parse(readFileSync(join(appDir, "dist/packed-provenance.json"), "utf8"));
  const moduleIds = report.moduleIds.map(normalizePath);
  const nodeModulesPath = join(appDir, "node_modules");
  const packedNodeModulesPrefixes = new Set([
    normalizePath(resolve(nodeModulesPath)),
    normalizePath(realpathSync(nodeModulesPath)),
  ]);
  const resolvedEntries = [];
  for (const name of expectedPackageNames) {
    // Rollup can collapse the side-effect-free root barrel after resolving it.
    // The concrete createEditor implementation remains a stronger packed-root
    // provenance proof; optional extension barrels remain in the graph.
    const entry = name === "markora" ? "createEditor.js" : "index.js";
    const suffix = `/node_modules/${name}/dist/${entry}`;
    const matches = moduleIds.filter((moduleId) => moduleId.endsWith(suffix));
    if (
      matches.length !== 1
      || ![...packedNodeModulesPrefixes].some((prefix) => matches[0].startsWith(prefix))
    ) {
      throw new Error(
        `Packed all-seven performance graph did not resolve ${name} from its isolated consumer. `
        + `matches=${JSON.stringify(matches)} prefixes=${JSON.stringify([...packedNodeModulesPrefixes])}`,
      );
    }
    resolvedEntries.push(`${name}/dist/${entry}`);
  }
  const forbidden = [
    "/node_modules/@mermaid-js/",
    "/node_modules/@viz-js/",
    "/node_modules/dompurify/",
    "/node_modules/katex/",
    "/node_modules/leaflet/",
    "/node_modules/mapbox-gl/",
    "/node_modules/mathjax",
    "/node_modules/mermaid/",
    "/node_modules/three/",
    "/node_modules/topojson-client/",
  ];
  const leaks = moduleIds.filter((moduleId) => forbidden.some((fragment) => moduleId.includes(fragment)));
  if (leaks.length > 0) {
    throw new Error(`Packed all-seven performance graph reached renderer engines:\n${leaks.join("\n")}`);
  }
  const workspaceSource = normalizePath(join(rootDir, "packages"));
  const sourceLeaks = moduleIds.filter((moduleId) => moduleId.startsWith(workspaceSource));
  if (sourceLeaks.length > 0) {
    throw new Error(`Packed all-seven performance graph reached workspace source:\n${sourceLeaks.join("\n")}`);
  }
  return Object.freeze({
    moduleCount: moduleIds.length,
    resolvedEntries: Object.freeze(resolvedEntries),
  });
}

function preparePackedApp() {
  const tempRoot = mkdtempSync(join(tmpdir(), "markora-all-seven-performance-"));
  try {
    const appDir = join(tempRoot, "app");
    mkdirSync(join(appDir, "node_modules"), { recursive: true });
    const packages = packAndInstall(appDir, tempRoot);
    cpSync(consumerSourceDir, appDir, { recursive: true });
    writeFileSync(join(appDir, "package.json"), `${JSON.stringify({
      name: "markora-all-seven-performance",
      private: true,
      type: "module",
    }, null, 2)}\n`);
    writeViteConfig(appDir);
    run("node", [viteCliPath, "build", "--config", "vite.config.mjs"], { cwd: appDir });
    return Object.freeze({
      appDir,
      distDir: join(appDir, "dist"),
      packages,
      provenance: assertPackedProvenance(appDir),
      tempRoot,
    });
  } catch (error) {
    rmSync(tempRoot, { force: true, recursive: true });
    throw error;
  }
}

const mimeTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
});

async function serveDirectory(directory) {
  const canonical = resolve(directory);
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidate = resolve(canonical, requested);
      if (candidate !== canonical && !candidate.startsWith(`${canonical}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const file = existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(canonical, "index.html");
      const body = readFileSync(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.length,
        "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Performance server has no TCP address.");
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => (
      error ? reject(error) : resolveClose()
    ))),
  });
}

async function settlePage(page, delay = 50) {
  await page.evaluate((wait) => new Promise((resolveSettle) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolveSettle, wait)));
  }), delay);
}

function assertFeatureCounts(snapshot, stats) {
  const expected = {
    alerts: stats.alerts,
    diagrams: stats.diagrams,
    footnoteDefinitions: stats.footnoteDefinitions,
    footnoteReferences: stats.footnoteReferences,
    frontmatter: 1,
    html: stats.htmlBlocks + stats.htmlInlineAtoms,
    math: stats.mathBlocks + stats.mathInline,
    tocHeadings: stats.sections + 1,
    tocs: stats.tocs,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (snapshot.features[key] !== value) {
      throw new Error(`Advanced syntax ${key} count ${snapshot.features[key]} did not match ${value}.`);
    }
  }
}

function fixtureId(fixture) {
  return `${fixture.stats.version}-${fixture.stats.targetBytes}`.replaceAll(/[^a-z0-9_-]/giu, "-");
}

async function openAdvancedPage(context, baseUrl, fixture) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({
    failure: request.failure()?.errorText ?? "unknown",
    url: request.url(),
  }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector('body[data-advanced-syntax-performance-ready="true"]');
  await page.evaluate((input) => window.__MARKORA_ADVANCED_PERFORMANCE__.installFixture(input), {
    id: fixtureId(fixture),
    markdown: fixture.markdown,
    stats: fixture.stats,
  });
  return Object.freeze({ consoleErrors, failedRequests, page, pageErrors });
}

function assertPageClean(pageRecord) {
  const { consoleErrors, failedRequests, pageErrors } = pageRecord;
  if (consoleErrors.length || pageErrors.length || failedRequests.length) {
    throw new Error(`Advanced syntax page emitted browser failures: ${JSON.stringify({
      consoleErrors,
      failedRequests,
      pageErrors,
    })}`);
  }
}

function assertMountContract(mount) {
  if (
    mount.immediateRendererCalls !== 0
    || mount.immediateChangeCallbacks !== 0
    || mount.manifest.join(":") !== expectedOptionalNames.join(":")
  ) {
    throw new Error("Advanced syntax mount performed synchronous renderer/change work or lost manifest order.");
  }
}

async function waitForInitialRenderer(page) {
  const activation = await page.evaluate(() => (
    window.__MARKORA_ADVANCED_PERFORMANCE__.activateFirstDiagram()
  ));
  await page.waitForFunction((target) => (
    window.__MARKORA_ADVANCED_PERFORMANCE__.diagramTargetSnapshot(target)?.status === "rendered"
  ), activation.target, { timeout: 8_000 });
  await waitForRendererIdle(page);
  await settlePage(page);
  return activation;
}

async function waitForRendererIdle(page) {
  await page.waitForFunction(() => {
    const snapshot = window.__MARKORA_ADVANCED_PERFORMANCE__.renderWorkSnapshot();
    const { statuses } = snapshot;
    return snapshot.ledger.activeRendererJobs === 0
      && snapshot.ledger.pendingRendererPromises === 0
      && (statuses.queued ?? 0) === 0
      && (statuses.rendering ?? 0) === 0;
  }, undefined, { timeout: 8_000 });
}

function assertZeroLifecycle(snapshot, label) {
  const { ledger } = snapshot;
  const retained = {
    activeRendererJobs: ledger.activeRendererJobs,
    activeRendererSignals: ledger.activeRendererSignals,
    hostChildren: snapshot.hostChildren ?? ledger.hostChildren,
    liveIntersectionObservers: ledger.liveIntersectionObservers,
    observedRendererTargets: ledger.observedRendererTargets,
    pendingRendererPromises: ledger.pendingRendererPromises,
    pressureResolvers: ledger.pressureResolvers,
    rendererArtifacts: ledger.rendererArtifacts,
  };
  if (Object.values(retained).some((value) => value !== 0)) {
    throw new Error(`${label} retained resources: ${JSON.stringify(retained)}`);
  }
}

async function runTimingSample(context, baseUrl, fixture) {
  const pageRecord = await openAdvancedPage(context, baseUrl, fixture);
  const { page } = pageRecord;
  try {
    const mount = await page.evaluate((id) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.mountFixture(id)
    ), fixtureId(fixture));
    assertMountContract(mount);
    const firstActivation = await waitForInitialRenderer(page);
    const initial = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    assertFeatureCounts(initial, fixture.stats);
    if (
      initial.canonical !== fixture.markdown
      || initial.rendererCalls <= 0
      || initial.rendererCalls >= fixture.stats.diagrams
      || initial.errors.length > 0
    ) {
      throw new Error("Advanced syntax source round trip or initial viewport renderer gate failed.");
    }

    const lastActivation = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.activateLastDiagram()
    ));
    if (lastActivation.statusBefore !== "offscreen") {
      throw new Error(`The last diagram was not deferred offscreen: ${JSON.stringify(lastActivation)}`);
    }
    await page.waitForFunction((target) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.diagramTargetSnapshot(target)?.status === "rendered"
    ), lastActivation.target, { timeout: 8_000 });
    await waitForRendererIdle(page);
    await settlePage(page);
    const afterViewport = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    if (
      afterViewport.rendererCalls <= lastActivation.callsBefore
      || afterViewport.rendererCalls >= fixture.stats.diagrams
    ) {
      throw new Error("The last offscreen diagram did not activate without rendering the full document.");
    }
    const stableRendererCalls = afterViewport.rendererCalls;

    const edit = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.ordinaryEdit());
    if (
      edit.immediateRendererCalls !== 0
      || edit.immediateChangeCallbacks !== 0
      || !edit.footnoteDomRetained
      || edit.footnoteMutations !== 0
      || !edit.footnotePositionsMapped
      || !edit.tocDomRetained
      || edit.tocMutations !== 0
      || !edit.tocPositionsMapped
    ) {
      throw new Error(`Ordinary all-seven typing violated retained indexes: ${JSON.stringify(edit)}`);
    }
    await settlePage(page, 400);
    const afterEdit = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    if (
      afterEdit.callbacks !== 1
      || afterEdit.rendererCalls !== stableRendererCalls
      || afterEdit.canonical.length !== fixture.markdown.length + 1
    ) {
      throw new Error("Advanced syntax ordinary typing lost render identity or deferred output.");
    }

    const footnote = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.structuralFootnoteEdit()
    ));
    if (
      !footnote.changed
      || !footnote.rebuilt
      || !footnote.renamedDefinition
      || !footnote.renamedReference
      || !footnote.stableCounts
      || footnote.immediateChangeCallbacks !== 0
      || footnote.immediateRendererCalls !== 0
    ) {
      throw new Error(`Structural footnote rebuild probe failed: ${JSON.stringify(footnote)}`);
    }
    await settlePage(page, 400);
    const afterFootnote = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    if (afterFootnote.callbacks !== 2 || afterFootnote.rendererCalls !== stableRendererCalls) {
      throw new Error("Structural footnote editing lost deferred-callback or render isolation.");
    }

    const toc = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.tocHeadingEdit());
    if (
      !toc.headingCountStable
      || !toc.rebuiltLabel
      || !toc.tocCountStable
      || toc.immediateChangeCallbacks !== 0
      || toc.immediateRendererCalls !== 0
    ) {
      throw new Error(`TOC bounded-rebuild probe failed: ${JSON.stringify(toc)}`);
    }
    await settlePage(page, 400);
    const afterToc = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    if (afterToc.callbacks !== 3 || afterToc.rendererCalls !== stableRendererCalls) {
      throw new Error("TOC heading editing lost deferred-callback or render isolation.");
    }

    const removal = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.removeRenderedDiagram()
    ));
    if (
      !removal.removed
      || !removal.signalWasTracked
      || !removal.artifactWasTracked
      || removal.immediateChangeCallbacks !== 0
      || removal.immediateRendererCalls !== 0
    ) {
      throw new Error(`Diagram removal probe failed: ${JSON.stringify(removal)}`);
    }
    await settlePage(page, 400);
    const removalCleanup = await page.evaluate((info) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.removalSnapshot(info)
    ), removal.info);
    const afterRemoval = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    if (
      Object.values(removalCleanup).some((value) => value !== true)
      || afterRemoval.callbacks !== 4
      || afterRemoval.rendererCalls !== stableRendererCalls
    ) {
      throw new Error(`Diagram removal retained its generation: ${JSON.stringify(removalCleanup)}`);
    }

    const destroyed = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.destroy());
    await settlePage(page);
    const afterDestroy = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot()
    ));
    assertZeroLifecycle(afterDestroy, "Full-size all-seven destroy");
    if (
      afterDestroy.callbacks !== destroyed.callbacksBefore
      || afterDestroy.rendererCalls !== destroyed.rendererCallsBefore
      || afterDestroy.errors !== 0
      || destroyed.recordedErrors.length !== 0
    ) {
      throw new Error("Full-size destroy delivered a late renderer or host callback.");
    }

    const failedCreation = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.failedCreationProbe()
    ));
    await settlePage(page);
    const afterFailedCreation = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot()
    ));
    assertZeroLifecycle(afterFailedCreation, "Failed all-seven creation");
    if (
      !failedCreation.caught
      || failedCreation.message !== "Expected all-seven creation failure probe."
      || failedCreation.hostChildren !== 0
      || failedCreation.observersCreated < 1
      || failedCreation.disconnectedObservers !== failedCreation.observersCreated
      || afterFailedCreation.callbacks !== afterDestroy.callbacks
      || afterFailedCreation.rendererCalls !== afterDestroy.rendererCalls
      || afterFailedCreation.errors !== 0
    ) {
      throw new Error(`Failed creation did not clean its observer/host: ${JSON.stringify(failedCreation)}`);
    }

    const pressureMount = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.mountPressure()
    ));
    assertMountContract(pressureMount);
    await page.waitForFunction((maximum) => {
      const pressure = window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot();
      return pressure.ledger.activeRendererJobs === maximum
        && pressure.ledger.pendingRendererPromises === maximum;
    }, rendererConcurrency, { timeout: 8_000 });
    const heldPressure = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot()
    ));
    if (
      heldPressure.ledger.maxConcurrentRendererJobs !== rendererConcurrency
      || heldPressure.rendererCalls !== rendererConcurrency
    ) {
      throw new Error(`Renderer pressure did not saturate four slots: ${JSON.stringify(heldPressure)}`);
    }
    await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.releasePressure());
    await page.waitForFunction(() => {
      const pressure = window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot();
      const working = (pressure.statuses.queued ?? 0) + (pressure.statuses.rendering ?? 0);
      return pressure.outputByteLimitErrors === 1
        && pressure.ledger.activeRendererJobs === 0
        && pressure.ledger.pendingRendererPromises === 0
        && working === 0;
    }, undefined, { timeout: 8_000 });
    const releasedPressure = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot()
    ));
    if (
      releasedPressure.ledger.maxConcurrentRendererJobs !== rendererConcurrency
      || releasedPressure.outputByteLimitErrors !== 1
      || releasedPressure.rendererCalls !== 8
      || releasedPressure.statuses.error !== 1
      || releasedPressure.statuses.rendered !== 7
      || releasedPressure.errors.length !== 1
      || releasedPressure.errors[0]?.code !== "EXTENSION_DIAGRAM_RENDER_OUTPUT_LIMIT"
      || releasedPressure.errors[0]?.extension !== "markora-extension-diagrams"
    ) {
      throw new Error(`Renderer pressure/output bounds failed: ${JSON.stringify(releasedPressure)}`);
    }

    await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.restartPressure());
    await page.waitForFunction((maximum) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot().ledger.activeRendererJobs === maximum
    ), rendererConcurrency, { timeout: 8_000 });
    const reset = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.resetPressureToSentinel()
    ));
    await settlePage(page, 400);
    const afterReset = await page.evaluate(() => ({
      lifecycle: window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot(),
      pressure: window.__MARKORA_ADVANCED_PERFORMANCE__.pressureSnapshot(),
      source: window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot().canonical,
    }));
    if (
      afterReset.source !== "Reset cleanup sentinel."
      || afterReset.lifecycle.callbacks !== reset.callbacksBefore
      || afterReset.lifecycle.rendererCalls !== reset.callsBefore
      || afterReset.lifecycle.errors !== 0
      || afterReset.pressure.ledger.activeRendererJobs !== 0
      || afterReset.pressure.ledger.activeRendererSignals !== 0
      || afterReset.pressure.ledger.observedRendererTargets !== 0
      || afterReset.pressure.ledger.pendingRendererPromises !== 0
      || afterReset.pressure.ledger.pressureResolvers !== 0
      || afterReset.pressure.ledger.rendererArtifacts !== 0
    ) {
      throw new Error(`Hard reset retained renderer work: ${JSON.stringify(afterReset)}`);
    }

    const pressureDestroyed = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.destroy()
    ));
    await settlePage(page);
    const afterPressureDestroy = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot()
    ));
    assertZeroLifecycle(afterPressureDestroy, "Pressure-probe destroy");
    if (
      afterPressureDestroy.callbacks !== pressureDestroyed.callbacksBefore
      || afterPressureDestroy.rendererCalls !== pressureDestroyed.rendererCallsBefore
      || afterPressureDestroy.errors !== 0
      || pressureDestroyed.recordedErrors.length !== 0
    ) {
      throw new Error("Pressure-probe destroy delivered a late renderer or host callback.");
    }

    assertPageClean(pageRecord);
    return Object.freeze({
      evidence: Object.freeze({
        failedCreation,
        firstActivation: {
          callsBefore: firstActivation.callsBefore,
          statusBefore: firstActivation.statusBefore,
        },
        initialRendererCalls: initial.rendererCalls,
        rendererCallsAfterLastViewport: afterViewport.rendererCalls,
        manifest: mount.manifest,
        ordinaryEdit: edit,
        pressure: { held: heldPressure, released: releasedPressure, reset: afterReset.pressure },
        removal: removalCleanup,
        sections: fixture.stats.sections,
      }),
      metrics: Object.freeze({
        destroySyncMs: destroyed.durationMs,
        diagramRemovalSyncMs: removal.durationMs,
        footnoteStructuralEditSyncMs: footnote.durationMs,
        mountSyncMs: mount.durationMs,
        ordinaryEditSyncMs: edit.durationMs,
        tocHeadingEditSyncMs: toc.durationMs,
      }),
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function collectGarbage(cdp, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
  }
}

async function collectMemorySnapshot(cdp) {
  const [heap, dom] = await Promise.all([
    cdp.send("Runtime.getHeapUsage"),
    cdp.send("Memory.getDOMCounters"),
  ]);
  return Object.freeze({
    backingStorageBytes: heap.backingStorageSize ?? null,
    documents: dom.documents,
    embedderHeapBytes: heap.embedderHeapUsedSize ?? null,
    jsEventListeners: dom.jsEventListeners,
    nodes: dom.nodes,
    totalHeapBytes: heap.totalSize,
    usedHeapBytes: heap.usedSize,
  });
}

function subtract(left, right, key) {
  if (typeof left[key] !== "number" || typeof right[key] !== "number") {
    throw new TypeError(`Chromium did not expose the required ${key} memory counter.`);
  }
  return left[key] - right[key];
}

async function runMemorySample(context, baseUrl, fixture) {
  const pageRecord = await openAdvancedPage(context, baseUrl, fixture);
  const { page } = pageRecord;
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("HeapProfiler.enable");

    // Establish steady-state editor/runtime caches before the baseline. The
    // exact fixture stays resident in the page across every snapshot.
    const warmMount = await page.evaluate((id) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.mountFixture(id)
    ), fixtureId(fixture));
    assertMountContract(warmMount);
    await waitForInitialRenderer(page);
    const warmDestroyed = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.destroy()
    ));
    await settlePage(page);
    const afterWarmup = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot()
    ));
    assertZeroLifecycle(afterWarmup, "Memory warmup lifecycle");
    if (
      afterWarmup.callbacks !== warmDestroyed.callbacksBefore
      || afterWarmup.rendererCalls !== warmDestroyed.rendererCallsBefore
      || afterWarmup.errors !== 0
      || warmDestroyed.recordedErrors.length !== 0
    ) {
      throw new Error("Memory warmup lifecycle delivered a late callback, renderer, or error.");
    }

    await collectGarbage(cdp, 2);
    const baseline = await collectMemorySnapshot(cdp);
    const mount = await page.evaluate((id) => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.mountFixture(id)
    ), fixtureId(fixture));
    assertMountContract(mount);
    await waitForInitialRenderer(page);
    const initial = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.snapshot());
    assertFeatureCounts(initial, fixture.stats);
    if (initial.canonical !== fixture.markdown || initial.errors.length > 0) {
      throw new Error("The measured memory lifecycle lost exact all-seven source ownership.");
    }
    // Remove diagnostic records before the mounted heap snapshot so the
    // harness cannot retain authored renderer inputs on the editor's behalf.
    await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.clearTelemetry());
    await collectGarbage(cdp, 1);
    const mounted = await collectMemorySnapshot(cdp);
    const destroyed = await page.evaluate(() => window.__MARKORA_ADVANCED_PERFORMANCE__.destroy());
    await settlePage(page);
    const afterDestroy = await page.evaluate(() => (
      window.__MARKORA_ADVANCED_PERFORMANCE__.postLifecycleSnapshot()
    ));
    assertZeroLifecycle(afterDestroy, "Measured memory lifecycle");
    if (
      afterDestroy.callbacks !== destroyed.callbacksBefore
      || afterDestroy.rendererCalls !== destroyed.rendererCallsBefore
      || afterDestroy.errors !== 0
      || destroyed.recordedErrors.length !== 0
    ) {
      throw new Error("Measured memory lifecycle delivered a late callback, renderer, or error.");
    }
    await collectGarbage(cdp, 2);
    const retained = await collectMemorySnapshot(cdp);
    const retainedNodeDelta = subtract(retained, baseline, "nodes");
    const retainedListenerDelta = subtract(retained, baseline, "jsEventListeners");
    const retainedDocumentDelta = subtract(retained, baseline, "documents");
    if (retainedNodeDelta !== 0 || retainedListenerDelta !== 0 || retainedDocumentDelta !== 0) {
      throw new Error(`All-seven memory teardown retained DOM counters: ${JSON.stringify({
        retainedDocumentDelta,
        retainedListenerDelta,
        retainedNodeDelta,
      })}`);
    }
    assertPageClean(pageRecord);

    const mountedJs = subtract(mounted, baseline, "usedHeapBytes");
    const mountedEmbedder = subtract(mounted, baseline, "embedderHeapBytes");
    const mountedBacking = subtract(mounted, baseline, "backingStorageBytes");
    const retainedJs = subtract(retained, baseline, "usedHeapBytes");
    const retainedEmbedder = subtract(retained, baseline, "embedderHeapBytes");
    const retainedBacking = subtract(retained, baseline, "backingStorageBytes");
    return Object.freeze({
      evidence: Object.freeze({ baseline, destroyed, mounted, retained }),
      metrics: Object.freeze({
        mountedDocumentDelta: subtract(mounted, baseline, "documents"),
        mountedListenerDelta: subtract(mounted, baseline, "jsEventListeners"),
        mountedNodeDelta: subtract(mounted, baseline, "nodes"),
        mountedTrackedMemoryDeltaBytes: mountedJs + mountedEmbedder + mountedBacking,
        retainedDocumentDelta,
        retainedListenerDelta,
        retainedNodeDelta,
        retainedTrackedMemoryDeltaBytes: retainedJs + retainedEmbedder + retainedBacking,
      }),
    });
  } finally {
    await cdp.detach().catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

function rotate(values, offset) {
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}



function summarizeByTarget(records, metricNames) {
  return Object.freeze(Object.fromEntries(ADVANCED_SYNTAX_DOCUMENT_TARGETS.map((target) => [
    target,
    summarizeRecords(records.filter((record) => record.targetBytes === target), metricNames),
  ])));
}

async function collectTiming(context, baseUrl, fixtures) {
  const warmups = [];
  const samples = [];
  const rounds = sampling.warmups + sampling.timingSamples;
  for (let round = 0; round < rounds; round += 1) {
    const warmup = round < sampling.warmups;
    const phase = warmup ? "warmup" : "sample";
    const sampleRound = warmup ? round : round - sampling.warmups;
    const count = warmup ? sampling.warmups : sampling.timingSamples;
    for (const target of rotate(ADVANCED_SYNTAX_DOCUMENT_TARGETS, round)) {
      console.log(`All-seven timing ${phase} ${sampleRound + 1}/${count}: ${target} bytes`);
      const result = await runTimingSample(context, baseUrl, fixtures.get(target));
      (warmup ? warmups : samples).push(Object.freeze({
        ...result,
        round: sampleRound,
        targetBytes: target,
      }));
    }
  }
  return Object.freeze({
    samples: Object.freeze(samples),
    summaries: summarizeByTarget(samples, timingMetricNames),
    warmups: Object.freeze(warmups),
  });
}

async function collectMemory(baseUrl, fixtures) {
  const samples = [];
  for (let round = 0; round < sampling.memorySamples; round += 1) {
    for (const target of rotate(ADVANCED_SYNTAX_DOCUMENT_TARGETS, round)) {
      console.log(`All-seven memory sample ${round + 1}/${sampling.memorySamples}: ${target} bytes`);
      const browser = await chromium.launch({ headless: true });
      let context;
      try {
        context = await browser.newContext(browserOptions);
        const result = await runMemorySample(context, baseUrl, fixtures.get(target));
        samples.push(Object.freeze({ ...result, round, targetBytes: target }));
      } finally {
        await context?.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    }
  }
  return Object.freeze({
    samples: Object.freeze(samples),
    summaries: summarizeByTarget(samples, memoryMetricNames),
  });
}

function loadBudgets() {
  const config = JSON.parse(readFileSync(budgetPath, "utf8"));
  const contract = config.advancedSyntax?.contract;
  if (
    config.schemaVersion !== 1
    || contract?.version !== HARNESS_VERSION
    || contract?.documentVersion !== ADVANCED_SYNTAX_DOCUMENT_VERSION
    || JSON.stringify(contract?.requiredTargets) !== JSON.stringify(ADVANCED_SYNTAX_DOCUMENT_TARGETS)
    || JSON.stringify(contract?.sampling) !== JSON.stringify(sampling)
    || contract?.browser !== "chromium"
    || contract?.viewport?.width !== browserOptions.viewport.width
    || contract?.viewport?.height !== browserOptions.viewport.height
    || contract?.deviceScaleFactor !== browserOptions.deviceScaleFactor
    || contract?.locale !== browserOptions.locale
    || contract?.timezone !== browserOptions.timezoneId
    || contract?.reducedMotion !== browserOptions.reducedMotion
    || contract?.timingIsolation !== "fresh-page-shared-browser-process"
    || contract?.memoryIsolation !== "fresh-browser-process-per-sample"
    || contract?.defaultChangeMode !== "idle"
    || contract?.noRendererEngine !== true
    || contract?.renderer !== "host-supplied-inert-dom-stub"
    || JSON.stringify(contract?.rendererPressure) !== JSON.stringify({
      jobs: 8,
      maxConcurrent: rendererConcurrency,
      oversizedOutputs: 1,
    })
  ) {
    throw new Error("Advanced syntax performance budget contract does not match the retained harness.");
  }
  return config;
}



function evaluateBudgets(config, timing, memory) {
  const evaluations = [];
  for (const target of ADVANCED_SYNTAX_DOCUMENT_TARGETS) {
    const timingBudgets = config.advancedSyntax.timing[String(target)];
    for (const metric of timingMetricNames) {
      const budget = timingBudgets?.[metric];
      const metricSummary = timing.summaries[String(target)]?.[metric];
      evaluations.push(...evaluateSummaryBudgets(
        `advancedSyntax.timing.${target}.${metric}`, metricSummary, budget,
      ));
      evaluations.push(evaluateBudget(
        `advancedSyntax.variance.timing.${target}.${metric}`,
        metricSummary.coefficientOfVariation,
        config.advancedSyntax.variance?.timing,
      ));
    }
    const memoryBudgets = config.advancedSyntax.memory[String(target)];
    for (const metric of memoryMetricNames) {
      const budget = memoryBudgets?.[metric];
      evaluations.push(...evaluateSummaryBudgets(
        `advancedSyntax.memory.${target}.${metric}`,
        memory.summaries[String(target)]?.[metric], budget,
      ));
    }
  }
  return evaluations;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
    stdio: "pipe",
  });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function packageVersion(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

async function collectEnvironment(browser, context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const pageRecord = await page.evaluate(() => ({
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
      viewport: { height: innerHeight, width: innerWidth },
    }));
    const cpuList = cpus();
    const gitStatus = commandOutput("git", ["status", "--porcelain"]);
    return Object.freeze({
      browser: Object.freeze({
        headless: true,
        playwright: packageVersion(join(rootDir, "node_modules/@playwright/test/package.json")),
        productVersion: browser.version(),
        userAgent: pageRecord.userAgent,
      }),
      git: Object.freeze({
        dirty: Boolean(gitStatus),
        revision: commandOutput("git", ["rev-parse", "HEAD"]),
      }),
      host: Object.freeze({
        architecture: process.arch,
        cpuModel: cpuList[0]?.model ?? "unknown",
        logicalCpus: cpuList.length,
        node: process.version,
        os: platform(),
        osRelease: release(),
        pnpm: commandOutput("pnpm", ["--version"]),
        totalMemoryBytes: totalmem(),
      }),
      page: Object.freeze({
        devicePixelRatio: pageRecord.devicePixelRatio,
        hardwareConcurrency: pageRecord.hardwareConcurrency,
        language: pageRecord.language,
        timeZone: pageRecord.timeZone,
        viewport: pageRecord.viewport,
      }),
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

function displayPath(path) {
  const normalized = normalizePath(path);
  const root = `${normalizePath(rootDir)}/`;
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let packed;
  let server;
  let browser;
  const startedAt = new Date().toISOString();
  try {
    packed = preparePackedApp();
    server = await serveDirectory(packed.distDir);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(browserOptions);
    const fixtures = new Map(ADVANCED_SYNTAX_DOCUMENT_TARGETS.map((target) => [
      target,
      createAdvancedSyntaxDocument(target),
    ]));
    const environment = await collectEnvironment(browser, context, server.baseUrl);
    const timing = await collectTiming(context, server.baseUrl, fixtures);
    await context.close();
    await browser.close();
    browser = null;
    const memory = await collectMemory(server.baseUrl, fixtures);
    const config = loadBudgets();
    const evaluations = evaluateBudgets(config, timing, memory);
    const summary = reportBudgetEvaluations(evaluations, {
      title: "Markora all-seven advanced syntax performance budget",
    });
    const report = {
      schemaVersion: 1,
      kind: "markora-all-seven-advanced-syntax-performance",
      status: !options.check || summary.passed ? "passed" : "failed",
      generatedAt: new Date().toISOString(),
      startedAt,
      budgetConfig: displayPath(budgetPath),
      budgetConfigSha256: sha256File(budgetPath),
      contract: config.advancedSyntax.contract,
      environment,
      fixtures: Object.fromEntries([...fixtures].map(([target, fixture]) => [target, {
        sha256: sha256(fixture.markdown),
        stats: fixture.stats,
      }])),
      provenance: {
        consumer: "production-minified Vite application",
        harness: {
          "scripts/advanced-syntax-performance.mjs": sha256File(fileURLToPath(import.meta.url)),
          "scripts/performance/advanced-syntax-consumer/runtime.mjs": sha256File(join(consumerSourceDir, "runtime.mjs")),
          "scripts/performance/advanced-syntax-document.mjs": sha256File(join(rootDir, "scripts/performance/advanced-syntax-document.mjs")),
        },
        moduleCount: packed.provenance.moduleCount,
        packages: packed.packages,
        resolvedEntries: packed.provenance.resolvedEntries,
      },
      results: { memory, timing },
      budgets: {
        evaluations,
        failures: summary.failures,
        passed: summary.passed,
        warnings: summary.warnings,
      },
    };
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`All-seven advanced syntax performance report written to ${displayPath(options.outputPath)}`);
    if (options.check && !summary.passed) {
      throw new Error(`${summary.failures.length} advanced syntax performance budget(s) failed.`);
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    if (packed && !options.keepTemp) rmSync(packed.tempRoot, { force: true, recursive: true });
    else if (packed) console.log(`Retained packed all-seven app at ${packed.tempRoot}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message.replaceAll(normalizePath(rootDir), "<workspace>").replaceAll(normalizePath(homedir()), "<home>"));
  process.exitCode = 1;
});
