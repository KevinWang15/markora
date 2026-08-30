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
import { cpus, freemem, homedir, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { evaluateBudget, reportBudgetEvaluations } from "./performance/budget-evaluator.mjs";
import {
  REPRESENTATIVE_DOCUMENT_TARGETS,
  REPRESENTATIVE_DOCUMENT_VERSION,
  createRepresentativeDocument,
} from "./performance/representative-document.mjs";
import { summarizeSamples } from "./performance/statistics.mjs";

const BENCHMARK_VERSION = "packed-embedded-v3";
const CODE_BLOCK_ACTIVATION_CONTRACT = Object.freeze({
  capacityPressureShells: 9,
  maxSettledEditors: 8,
  probe: "first-middle-last-selection",
  stateAttribute: "data-mdw-code-block-state",
  strategy: "viewport-bounded-static-shell",
});
const HOT_PATH_CONTRACT = Object.freeze({
  burstIntervalMs: 80,
  burstIntervalMaximumMs: 120,
  burstIntervalMinimumMs: 75,
  burstKeys: 4,
  burstSchedule: "absolute-page-deadlines",
  changeDelivery: "idle-coalesced",
  key: "F8",
  snapshotDeadlineMs: 8_000,
});
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packedConsumerDir = join(rootDir, "scripts/performance/packed-consumer");
const workspaceNodeModulesDir = join(rootDir, "node_modules/.pnpm/node_modules");
const viteCliPath = join(rootDir, "packages/demo/node_modules/vite/bin/vite.js");
const budgetsPath = join(rootDir, "performance/budgets.json");
const defaultOutputPath = join(rootDir, "performance-results/benchmark.json");
const profileDefaults = Object.freeze({
  baseline: Object.freeze({ memorySamples: 7, samples: 20, warmups: 3 }),
  ci: Object.freeze({ memorySamples: 3, samples: 5, warmups: 1 }),
  quick: Object.freeze({ memorySamples: 1, samples: 1, warmups: 0 }),
});
const timingMetricNames = Object.freeze([
  "initialParseRenderSyncMs",
  "initialParseRenderToPresentationMs",
  "codecParseMs",
  "codecSerializeMs",
  "keydownToPresentationProxyMs",
  "dirtyTeardownMs",
]);
const hotPathMetricNames = Object.freeze([
  "defaultIdleSynchronousProcessingMs",
  "defaultIdleKeydownToPresentationProxyMs",
  "defaultIdleSnapshotLatencyMs",
]);
function flatContractEquals(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => actual[key] === expected[key]);
}
const memoryMetricNames = Object.freeze([
  "cleanTeardownMs",
  "codeBlockActivationPeakEditors",
  "mountedTrackedMemoryDeltaBytes",
  "mountedCodeMirrorEditors",
  "retainedTrackedMemoryDeltaBytes",
  "mountedJsHeapDeltaBytes",
  "retainedJsHeapDeltaBytes",
  "mountedEmbedderHeapDeltaBytes",
  "retainedEmbedderHeapDeltaBytes",
  "mountedBackingStorageDeltaBytes",
  "retainedBackingStorageDeltaBytes",
  "mountedNodeDelta",
  "retainedNodeDelta",
  "mountedListenerDelta",
  "retainedListenerDelta",
  "mountedDocumentDelta",
  "retainedDocumentDelta",
]);
const budgetedMemoryMetricNames = Object.freeze([
  "cleanTeardownMs",
  "codeBlockActivationPeakEditors",
  "mountedTrackedMemoryDeltaBytes",
  "mountedCodeMirrorEditors",
  "retainedTrackedMemoryDeltaBytes",
  "mountedNodeDelta",
  "retainedNodeDelta",
  "mountedListenerDelta",
  "retainedListenerDelta",
  "retainedDocumentDelta",
]);
const browserContextOptions = Object.freeze({
  deviceScaleFactor: 1,
  locale: "en-US",
  reducedMotion: "reduce",
  timezoneId: "UTC",
  viewport: Object.freeze({ height: 720, width: 1280 }),
});

function parsePositiveInteger(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return parsed;
}

function parseArguments(argv) {
  let profile = "baseline";
  let outputPath = defaultOutputPath;
  let check = false;
  let keepTemp = false;
  let selectedTargets = [...REPRESENTATIVE_DOCUMENT_TARGETS];
  const overrides = {};

  for (const argument of argv) {
    if (argument === "--check") {
      check = true;
    } else if (argument === "--keep-temp") {
      keepTemp = true;
    } else if (argument.startsWith("--profile=")) {
      profile = argument.slice("--profile=".length);
    } else if (argument.startsWith("--output=")) {
      outputPath = resolve(rootDir, argument.slice("--output=".length));
    } else if (argument.startsWith("--samples=")) {
      overrides.samples = parsePositiveInteger(argument.slice("--samples=".length), "--samples");
    } else if (argument.startsWith("--warmups=")) {
      overrides.warmups = parsePositiveInteger(
        argument.slice("--warmups=".length),
        "--warmups",
        { allowZero: true },
      );
    } else if (argument.startsWith("--memory-samples=")) {
      overrides.memorySamples = parsePositiveInteger(
        argument.slice("--memory-samples=".length),
        "--memory-samples",
      );
    } else if (argument.startsWith("--sizes=")) {
      selectedTargets = argument
        .slice("--sizes=".length)
        .split(",")
        .map((value) => parsePositiveInteger(value, "--sizes"));
    } else {
      throw new TypeError(`Unknown performance benchmark argument: ${argument}`);
    }
  }

  if (!Object.hasOwn(profileDefaults, profile)) {
    throw new TypeError(`--profile must be one of ${Object.keys(profileDefaults).join(", ")}.`);
  }
  if (selectedTargets.length === 0 || new Set(selectedTargets).size !== selectedTargets.length) {
    throw new TypeError("--sizes must contain at least one unique document size.");
  }
  for (const target of selectedTargets) {
    if (!REPRESENTATIVE_DOCUMENT_TARGETS.includes(target)) {
      throw new RangeError(`Unsupported representative document size: ${target}.`);
    }
  }

  const sampling = { ...profileDefaults[profile], ...overrides };
  if (check && sampling.samples < 3) {
    throw new RangeError("Budget checks require at least three timing samples per document size.");
  }
  if (check && sampling.memorySamples < 3) {
    throw new RangeError("Budget checks require at least three memory samples per document size.");
  }

  return Object.freeze({
    check,
    keepTemp,
    outputPath,
    profile,
    sampling: Object.freeze(sampling),
    targets: Object.freeze(selectedTargets),
  });
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

function commandVersion(command, args) {
  try {
    return run(command, args, { capture: true });
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function rotate(values, offset) {
  const index = values.length === 0 ? 0 : offset % values.length;
  return [...values.slice(index), ...values.slice(0, index)];
}

function copyWorkspaceDependencies(destination) {
  for (const entry of readdirSync(workspaceNodeModulesDir)) {
    if ([".bin", "demo", "markora", "markora-ui"].includes(entry)) {
      continue;
    }
    const sourcePath = join(workspaceNodeModulesDir, entry);
    const destinationPath = join(destination, entry);
    symlinkSync(sourcePath, destinationPath, process.platform === "win32" ? "junction" : "dir");
  }
}

function writeViteConfig(appDir) {
  writeFileSync(join(appDir, "vite.config.mjs"), `import { resolve } from "node:path";

function provenancePlugin() {
  return {
    name: "markora-packed-performance-provenance",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((entry) => entry.type === "chunk");
      const report = {
        chunks: chunks.map((chunk) => ({
          dynamicImports: chunk.dynamicImports,
          fileName: chunk.fileName,
          imports: chunk.imports,
          isDynamicEntry: chunk.isDynamicEntry,
          isEntry: chunk.isEntry,
          moduleIds: Object.keys(chunk.modules).sort(),
        })),
        moduleIds: [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)))].sort(),
      };
      this.emitFile({
        type: "asset",
        fileName: "packed-provenance.json",
        source: JSON.stringify(report, null, 2) + "\\n",
      });
    },
  };
}

export default {
  base: "/",
  build: {
    emptyOutDir: true,
    outDir: resolve(process.cwd(), "dist"),
    sourcemap: false,
  },
  plugins: [provenancePlugin()],
};
`);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/\?.*$/u, "");
}

function stableModuleId(moduleId, appDir) {
  const normalized = normalizePath(moduleId);
  for (const [prefix, token] of [
    [normalizePath(realpathSync(appDir)), "<packed-app>"],
    [normalizePath(realpathSync(rootDir)), "<workspace>"],
  ]) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return `${token}${normalized.slice(prefix.length)}`;
    }
  }
  return normalized;
}

function assertPackedProvenance(appDir) {
  const report = JSON.parse(readFileSync(join(appDir, "dist/packed-provenance.json"), "utf8"));
  const moduleIds = report.moduleIds.map(normalizePath);
  const packedPrefix = normalizePath(realpathSync(join(appDir, "node_modules/markora/dist")));
  const requiredEntries = ["createEditor.js", "extensionApi.js", "styles.css"];

  for (const requiredEntry of requiredEntries) {
    if (!moduleIds.includes(`${packedPrefix}/${requiredEntry}`)) {
      throw new Error(`Packed performance consumer did not emit markora/${requiredEntry}.`);
    }
  }
  const workspaceSourcePrefix = normalizePath(join(rootDir, "packages/core/src"));
  const leakedSources = moduleIds.filter((moduleId) => moduleId.startsWith(workspaceSourcePrefix));
  if (leakedSources.length > 0) {
    throw new Error(`Packed performance consumer reached workspace source:\n${leakedSources.join("\n")}`);
  }

  return Object.freeze({
    chunks: report.chunks.map((chunk) => ({
      ...chunk,
      moduleIds: chunk.moduleIds.map((moduleId) => stableModuleId(moduleId, appDir)),
    })),
    moduleCount: moduleIds.length,
    resolvedMarkoraModules: moduleIds
      .filter((moduleId) => moduleId.startsWith(packedPrefix))
      .map((moduleId) => stableModuleId(moduleId, appDir)),
  });
}

function preparePackedApp() {
  if (!existsSync(join(rootDir, "packages/core/dist/index.js"))) {
    throw new Error("markora is not built. Run `pnpm build:core` before the performance driver.");
  }
  if (!existsSync(join(packedConsumerDir, "index.html"))) {
    throw new Error("The packed performance consumer is missing.");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "markora-performance-"));
  try {
    const tarballDir = join(tempRoot, "tarballs");
    const appDir = join(tempRoot, "app");
    const nodeModulesDir = join(appDir, "node_modules");
    mkdirSync(tarballDir, { recursive: true });
    mkdirSync(nodeModulesDir, { recursive: true });

    run("npm", [
      "pack",
      "--ignore-scripts",
      "--pack-destination",
      tarballDir,
    ], { cwd: join(rootDir, "packages/core") });
    const tarballs = readdirSync(tarballDir).filter((entry) => entry.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      throw new Error(`Expected one packed markora tarball, found ${tarballs.length}.`);
    }
    const tarballPath = join(tarballDir, tarballs[0]);
    copyWorkspaceDependencies(nodeModulesDir);
    const packedPackageDir = join(nodeModulesDir, "markora");
    mkdirSync(packedPackageDir, { recursive: true });
    run("tar", ["-xzf", tarballPath, "-C", packedPackageDir, "--strip-components=1"]);

    for (const entry of readdirSync(packedConsumerDir)) {
      cpSync(join(packedConsumerDir, entry), join(appDir, entry), { recursive: true });
    }
    const rootPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    writeFileSync(join(appDir, "package.json"), `${JSON.stringify({
      name: "markora-packed-performance",
      packageManager: rootPackage.packageManager,
      private: true,
      type: "module",
    }, null, 2)}\n`);
    writeViteConfig(appDir);
    run("node", [viteCliPath, "build", "--config", "vite.config.mjs"], { cwd: appDir });

    const packedPackage = JSON.parse(readFileSync(join(packedPackageDir, "package.json"), "utf8"));
    return Object.freeze({
      appDir,
      distDir: join(appDir, "dist"),
      package: Object.freeze({
        name: packedPackage.name,
        tarball: tarballs[0],
        tarballSha256: sha256File(tarballPath),
        version: packedPackage.version,
      }),
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
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

async function serveDirectory(directory) {
  const canonicalDirectory = resolve(directory);
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(canonicalDirectory, requested);
      if (filePath !== canonicalDirectory && !filePath.startsWith(`${canonicalDirectory}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const resolvedFile = existsSync(filePath) && statSync(filePath).isFile()
        ? filePath
        : join(canonicalDirectory, "index.html");
      const body = readFileSync(resolvedFile);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.length,
        "Content-Type": mimeTypes[extname(resolvedFile)] ?? "application/octet-stream",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
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
  if (!address || typeof address === "string") {
    throw new Error("Performance server did not expose a TCP address.");
  }
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  });
}

function createFixture(targetBytes) {
  const fixture = createRepresentativeDocument(targetBytes);
  return Object.freeze({
    id: `${fixture.stats.version}-${targetBytes}`,
    markdown: fixture.markdown,
    sha256: sha256(fixture.markdown),
    stats: fixture.stats,
  });
}

async function openBenchmarkPage(context, baseUrl, fixture) {
  const page = await context.newPage();
  const externalRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  const origin = new URL(baseUrl).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (/^(?:data|blob):/u.test(url)) {
      return;
    }
    if (new URL(url).origin !== origin) {
      externalRequests.push(url);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (pageErrors.length > 0 || consoleErrors.length > 0) {
      throw new Error(`Performance consumer failed during initialization:\n${[
        ...pageErrors,
        ...consoleErrors,
      ].join("\n")}`);
    }
    await page.waitForFunction(
      () => Boolean(window.__MARKORA_PERFORMANCE__?.ready),
      undefined,
      { timeout: 10_000 },
    );
    const activationContract = await page.evaluate(() => (
      window.__MARKORA_PERFORMANCE__.schema.codeBlockActivation
    ));
    if (!flatContractEquals(activationContract, CODE_BLOCK_ACTIVATION_CONTRACT)) {
      throw new Error("Packed performance consumer code-block activation contract drifted from the driver.");
    }
    await page.evaluate((installedFixture) => {
      window.__MARKORA_PERFORMANCE__.installFixture(installedFixture);
    }, {
      id: fixture.id,
      markdown: fixture.markdown,
      stats: fixture.stats,
    });
  } catch (error) {
    await page.close();
    throw error;
  }

  return Object.freeze({
    assertClean() {
      if (externalRequests.length > 0) {
        throw new Error(`Performance consumer issued external requests:\n${externalRequests.join("\n")}`);
      }
      if (pageErrors.length > 0 || consoleErrors.length > 0) {
        throw new Error(`Performance consumer reported browser errors:\n${[
          ...pageErrors,
          ...consoleErrors,
        ].join("\n")}`);
      }
    },
    page,
  });
}

async function withPageDeadline(page, label, timeoutMs, operation) {
  let timeoutId;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          void page.close().catch(() => undefined);
          reject(new Error(`${label} exceeded its ${timeoutMs} ms page deadline.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runTimingSample(context, baseUrl, fixture) {
  const benchmarkPage = await openBenchmarkPage(context, baseUrl, fixture);
  const { page } = benchmarkPage;
  try {
    return await withPageDeadline(page, "Current timing sample", 120_000, async () => {
      const mounted = await page.evaluate((fixtureId) => (
        window.__MARKORA_PERFORMANCE__.mountAndSettle({
          fixtureId,
          snapshotMode: "default",
        })
      ), fixture.id);
      await page.evaluate(async () => {
        const api = window.__MARKORA_PERFORMANCE__;
        api.focusTypingTarget("middle");
        await api.settle();
      });
      await page.evaluate(() => window.__MARKORA_PERFORMANCE__.armKeystroke());
      await page.keyboard.type("x");
      const keystroke = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.awaitKeystroke()
      ));
      await page.evaluate(() => {
        const api = window.__MARKORA_PERFORMANCE__;
        api.disableSnapshots();
        api.primeDirty();
      });
      const destroyed = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.destroy("dirty")
      ));
      const parsed = await page.evaluate((fixtureId) => {
        const api = window.__MARKORA_PERFORMANCE__;
        api.prepareCodec();
        const parse = api.parseFixture(fixtureId);
        const serialization = api.serializeParsed();
        api.releaseCodec();
        return { parse, serialization };
      }, fixture.id);
      const snapshot = await page.evaluate(() => window.__MARKORA_PERFORMANCE__.editorSnapshot());

      if (keystroke.trusted !== true || keystroke.updateCount !== 1 || keystroke.updateOrigin !== "user") {
        throw new Error(`Trusted keystroke assertion failed: ${JSON.stringify(keystroke)}.`);
      }
      if (snapshot.active || Object.entries(snapshot.dom).some(
        ([name, value]) => name !== "animations" && value !== 0,
      )) {
        throw new Error(`Editor DOM remained after dirty teardown: ${JSON.stringify(snapshot)}.`);
      }
      benchmarkPage.assertClean();
      return Object.freeze({
        evidence: Object.freeze({
          snapshot: keystroke.snapshot,
          synchronousProcessingMs: keystroke.synchronousProcessingMs,
        }),
        metrics: Object.freeze({
          codecParseMs: parsed.parse.durationMs,
          codecSerializeMs: parsed.serialization.durationMs,
          dirtyTeardownMs: destroyed.syncDurationMs,
          eventTimingCensoredBelowMs: keystroke.eventTimingCensoredBelowMs,
          eventTimingDurationMs: keystroke.eventTiming?.durationMs ?? null,
          eventTimingSupported: keystroke.eventTimingSupported,
          initialParseRenderSyncMs: mounted.syncDurationMs,
          initialParseRenderToPresentationMs: mounted.toPresentationMs,
          keydownToPresentationProxyMs: keystroke.keydownToPresentationProxyMs,
        }),
      });
    });
  } finally {
    await page.close();
  }
}

async function waitForPagePerformanceDeadline(page, deadlineMs) {
  return page.evaluate(async (deadline) => {
    while (performance.now() < deadline) {
      const remaining = deadline - performance.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.ceil(remaining))));
    }
    return performance.now();
  }, deadlineMs);
}

function assertHotPathKeydowns(keydowns, expectedSnapshotCounts, label) {
  if (
    !Array.isArray(keydowns)
    || keydowns.length !== expectedSnapshotCounts.length
    || keydowns.some((entry, index) => (
      entry.code !== HOT_PATH_CONTRACT.key
      || entry.trusted !== true
      || entry.snapshotCountBeforeDispatch !== expectedSnapshotCounts[index]
      || !Number.isFinite(entry.eventStart)
      || !Number.isFinite(entry.observedAt)
    ))
  ) {
    throw new Error(`${label} keydown telemetry assertion failed: ${JSON.stringify(keydowns)}.`);
  }
}

async function runDefaultIdleHotPathSample(context, baseUrl, fixture) {
  const benchmarkPage = await openBenchmarkPage(context, baseUrl, fixture);
  const { page } = benchmarkPage;
  try {
    return await withPageDeadline(page, "Default idle hot-path sample", 120_000, async () => {
      const mounted = await page.evaluate((fixtureId) => (
        window.__MARKORA_PERFORMANCE__.mountAndSettle({
          fixtureId,
          hotPathProbe: true,
          snapshotMode: "default",
        })
      ), fixture.id);
      await page.evaluate(async () => {
        const api = window.__MARKORA_PERFORMANCE__;
        api.focusTypingTarget("middle");
        await api.settle();
      });
      const {
        burstIntervalMaximumMs,
        burstIntervalMinimumMs,
        burstIntervalMs,
        burstKeys,
        burstSchedule,
        key,
        snapshotDeadlineMs,
      } = HOT_PATH_CONTRACT;
      const burst = [];
      let anchorEventStart = null;
      for (let index = 0; index < burstKeys; index += 1) {
        if (index > 0) {
          await waitForPagePerformanceDeadline(
            page,
            anchorEventStart + index * burstIntervalMs,
          );
        }
        await page.keyboard.press(key);
        const telemetry = await page.evaluate(() => (
          window.__MARKORA_PERFORMANCE__.hotPathTelemetry()
        ));
        assertHotPathKeydowns(
          telemetry.keydowns,
          Array(index + 1).fill(0),
          "Default idle burst",
        );
        if (telemetry.snapshotCount !== 0) {
          throw new Error(`Default idle burst emitted before quiescence: ${JSON.stringify(telemetry)}.`);
        }
        const keydown = telemetry.keydowns.at(-1);
        anchorEventStart ??= keydown.eventStart;
        const targetEventStart = anchorEventStart + index * burstIntervalMs;
        burst.push(Object.freeze({
          actualOffsetMs: keydown.eventStart - anchorEventStart,
          deadlineLatenessMs: keydown.eventStart - targetEventStart,
          eventStart: keydown.eventStart,
          index,
          intervalFromPreviousMs: index === 0
            ? null
            : keydown.eventStart - telemetry.keydowns[index - 1].eventStart,
          key: keydown.key,
          observedAt: keydown.observedAt,
          snapshotCount: telemetry.snapshotCount,
          snapshotCountBeforeDispatch: keydown.snapshotCountBeforeDispatch,
          targetOffsetMs: index * burstIntervalMs,
          trusted: keydown.trusted,
        }));
      }
      await page.evaluate(
        (timeoutMs) => window.__MARKORA_PERFORMANCE__.armKeystroke({ timeoutMs }),
        snapshotDeadlineMs,
      );
      await waitForPagePerformanceDeadline(
        page,
        anchorEventStart + burstKeys * burstIntervalMs,
      );
      await page.keyboard.press(key);
      const measuredTelemetry = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.hotPathTelemetry()
      ));
      assertHotPathKeydowns(
        measuredTelemetry.keydowns,
        Array(burstKeys + 1).fill(0),
        "Default idle measured hot path",
      );
      if (measuredTelemetry.snapshotCount !== 0) {
        throw new Error(`Default idle measured key emitted synchronously: ${JSON.stringify(measuredTelemetry)}.`);
      }
      const measuredKeydown = measuredTelemetry.keydowns.at(-1);
      const keyIntervalsMs = measuredTelemetry.keydowns.slice(1).map(
        (entry, index) => entry.eventStart - measuredTelemetry.keydowns[index].eventStart,
      );
      if (keyIntervalsMs.some(
        (interval) => interval < burstIntervalMinimumMs || interval > burstIntervalMaximumMs,
      )) {
        throw new Error(
          `Default idle key interval left the ${burstIntervalMinimumMs}-${burstIntervalMaximumMs} ms tolerance: ${JSON.stringify(keyIntervalsMs)}.`,
        );
      }
      const keystroke = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.awaitKeystroke()
      ));
      const captured = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.captureSnapshotVerification()
      ));
      const destroyed = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.destroy("clean")
      ));
      const verification = await page.evaluate(() => {
        const api = window.__MARKORA_PERFORMANCE__;
        const result = api.verifyCapturedSnapshot();
        api.releaseCodec();
        return result;
      });
      const snapshot = await page.evaluate(() => window.__MARKORA_PERFORMANCE__.editorSnapshot());

      if (
        mounted.snapshotMode !== "default"
        || keystroke.trusted !== true
        || keystroke.updateCount !== 1
        || keystroke.updateOrigin !== "user"
        || keystroke.snapshot?.count !== 1
        || keystroke.snapshot.origin !== "user"
        || keystroke.snapshot.delayedAfterKeydown !== true
        || keystroke.snapshot.beforeDocumentBubble !== false
        || keystroke.snapshot.beforePresentation !== false
        || Math.abs(keystroke.eventStart - measuredKeydown.eventStart) >= 1
      ) {
        throw new Error(`Default idle keystroke assertion failed: ${JSON.stringify({ mounted, keystroke })}.`);
      }
      if (
        captured.snapshotCount !== 1
        || captured.origin !== "user"
        || captured.cachedMatchesEmitted !== true
        || captured.characters !== fixture.markdown.length + burstKeys + 1
        || captured.utf8Bytes !== fixture.stats.bytes + burstKeys + 1
        || verification.canonicalMatchesEmitted !== true
        || verification.parsedDocumentMatchesEditor !== true
      ) {
        throw new Error(`Default idle snapshot verification failed: ${JSON.stringify({ captured, verification })}.`);
      }
      if (
        destroyed.snapshotCounts.beforeDestroy !== 1
        || destroyed.snapshotCounts.afterDestroy !== 1
        || destroyed.snapshotCounts.afterSettle !== 1
      ) {
        throw new Error(`Default idle snapshot fired late during teardown: ${JSON.stringify(destroyed.snapshotCounts)}.`);
      }
      if (snapshot.active || Object.entries(snapshot.dom).some(
        ([name, value]) => name !== "animations" && value !== 0,
      )) {
        throw new Error(`Editor DOM remained after default idle teardown: ${JSON.stringify(snapshot)}.`);
      }
      benchmarkPage.assertClean();
      return Object.freeze({
        evidence: Object.freeze({
          burst: Object.freeze({
            intervalToleranceMs: Object.freeze({
              maximum: burstIntervalMaximumMs,
              minimum: burstIntervalMinimumMs,
            }),
            intervalsMs: Object.freeze(keyIntervalsMs),
            keys: burstKeys,
            measuredKey: Object.freeze({
              actualOffsetMs: measuredKeydown.eventStart - anchorEventStart,
              deadlineLatenessMs:
                measuredKeydown.eventStart - (anchorEventStart + burstKeys * burstIntervalMs),
              eventStart: measuredKeydown.eventStart,
              index: burstKeys,
              intervalFromPreviousMs: keyIntervalsMs.at(-1),
              key: measuredKeydown.key,
              observedAt: measuredKeydown.observedAt,
              snapshotCount: measuredTelemetry.snapshotCount,
              snapshotCountBeforeDispatch: measuredKeydown.snapshotCountBeforeDispatch,
              targetOffsetMs: burstKeys * burstIntervalMs,
              trusted: measuredKeydown.trusted,
            }),
            schedule: burstSchedule,
            samples: Object.freeze(burst),
            targetIntervalMs: burstIntervalMs,
            totalKeysIncludingMeasuredFinal: burstKeys + 1,
          }),
          captured,
          destroyed: destroyed.snapshotCounts,
          keystroke,
          verification,
        }),
        metrics: Object.freeze({
          defaultIdleKeydownToPresentationProxyMs: keystroke.keydownToPresentationProxyMs,
          defaultIdleSnapshotLatencyMs: keystroke.snapshot.latencyMs,
          defaultIdleSynchronousProcessingMs: keystroke.synchronousProcessingMs,
        }),
      });
    });
  } finally {
    await page.close();
  }
}

async function runTimingSamples(
  context,
  baseUrl,
  fixture,
  { hotPathFirst, onScenarioComplete, onScenarioStart },
) {
  const runScenario = async (scenario, operation) => {
    onScenarioStart?.(scenario);
    const result = await operation();
    onScenarioComplete?.(scenario, result);
    return result;
  };

  let timing;
  let hotPath;
  if (hotPathFirst) {
    hotPath = await runScenario(
      "current-hot-path",
      () => runDefaultIdleHotPathSample(context, baseUrl, fixture),
    );
    timing = await runScenario(
      "current-timing",
      () => runTimingSample(context, baseUrl, fixture),
    );
  } else {
    timing = await runScenario(
      "current-timing",
      () => runTimingSample(context, baseUrl, fixture),
    );
    hotPath = await runScenario(
      "current-hot-path",
      () => runDefaultIdleHotPathSample(context, baseUrl, fixture),
    );
  }

  return Object.freeze({
    hotPath,
    timing,
  });
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

async function collectGarbage(cdp, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
  }
}

function subtract(left, right, key) {
  if (typeof left[key] !== "number" || typeof right[key] !== "number") {
    throw new TypeError(`Chromium did not expose the required ${key} memory counter.`);
  }
  return left[key] - right[key];
}

async function runMemorySample(context, baseUrl, fixture) {
  const benchmarkPage = await openBenchmarkPage(context, baseUrl, fixture);
  const { page } = benchmarkPage;
  const cdp = await context.newCDPSession(page);
  try {
    return await withPageDeadline(page, "Memory sample", 120_000, async () => {
      await cdp.send("Runtime.enable");
      await cdp.send("HeapProfiler.enable");
      // Establish steady-state editor/runtime caches before the memory baseline.
      // The measured fixture remains resident for this warm lifecycle and every
      // snapshot below.
      await page.evaluate(async (fixtureId) => {
        const api = window.__MARKORA_PERFORMANCE__;
        await api.mountAndSettle({ fixtureId, snapshotMode: "none" });
        await api.probeCodeBlockActivation();
        await api.destroy("clean");
        await api.settle();
      }, fixture.id);
      await collectGarbage(cdp, 2);
      const baseline = await collectMemorySnapshot(cdp);
      const codeBlockActivation = await page.evaluate(async (fixtureId) => {
        const api = window.__MARKORA_PERFORMANCE__;
        await api.mountAndSettle({ fixtureId, snapshotMode: "none" });
        return api.probeCodeBlockActivation();
      }, fixture.id);
      await collectGarbage(cdp, 1);
      const mounted = await collectMemorySnapshot(cdp);
      await page.evaluate(() => window.__MARKORA_PERFORMANCE__.primeClean());
      const destroyed = await page.evaluate(() => (
        window.__MARKORA_PERFORMANCE__.destroy("clean")
      ));
      await page.evaluate(() => window.__MARKORA_PERFORMANCE__.settle());
      await collectGarbage(cdp, 2);
      const retained = await collectMemorySnapshot(cdp);
      const snapshot = await page.evaluate(() => window.__MARKORA_PERFORMANCE__.editorSnapshot());
      if (snapshot.active || Object.entries(snapshot.dom).some(
        ([name, value]) => name !== "animations" && value !== 0,
      )) {
        throw new Error(`Editor DOM remained after clean teardown: ${JSON.stringify(snapshot)}.`);
      }
      benchmarkPage.assertClean();
      const mountedJsHeapDeltaBytes = subtract(mounted, baseline, "usedHeapBytes");
      const mountedEmbedderHeapDeltaBytes = subtract(mounted, baseline, "embedderHeapBytes");
      const mountedBackingStorageDeltaBytes = subtract(mounted, baseline, "backingStorageBytes");
      const retainedJsHeapDeltaBytes = subtract(retained, baseline, "usedHeapBytes");
      const retainedEmbedderHeapDeltaBytes = subtract(retained, baseline, "embedderHeapBytes");
      const retainedBackingStorageDeltaBytes = subtract(retained, baseline, "backingStorageBytes");
      return Object.freeze({
        baseline,
        cleanTeardownMs: destroyed.syncDurationMs,
        codeBlockActivation,
        codeBlockActivationPeakEditors: codeBlockActivation.peakCodeMirrorEditors,
        mounted,
        mountedCodeMirrorEditors: destroyed.beforeDom.codeMirrorEditors,
        mountedDom: destroyed.beforeDom,
        mountedBackingStorageDeltaBytes,
        mountedDocumentDelta: subtract(mounted, baseline, "documents"),
        mountedEmbedderHeapDeltaBytes,
        mountedJsHeapDeltaBytes,
        mountedListenerDelta: subtract(mounted, baseline, "jsEventListeners"),
        mountedNodeDelta: subtract(mounted, baseline, "nodes"),
        mountedTrackedMemoryDeltaBytes:
          mountedJsHeapDeltaBytes + mountedEmbedderHeapDeltaBytes + mountedBackingStorageDeltaBytes,
        retained,
        retainedBackingStorageDeltaBytes,
        retainedDocumentDelta: subtract(retained, baseline, "documents"),
        retainedEmbedderHeapDeltaBytes,
        retainedJsHeapDeltaBytes,
        retainedListenerDelta: subtract(retained, baseline, "jsEventListeners"),
        retainedNodeDelta: subtract(retained, baseline, "nodes"),
        retainedTrackedMemoryDeltaBytes:
          retainedJsHeapDeltaBytes + retainedEmbedderHeapDeltaBytes + retainedBackingStorageDeltaBytes,
      });
    });
  } finally {
    await cdp.detach().catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

function summarizeRecords(records, metricNames) {
  const summaries = {};
  for (const metricName of metricNames) {
    summaries[metricName] = summarizeSamples(records.map((record) => record.metrics[metricName]));
  }
  return Object.freeze(summaries);
}

async function collectTiming(context, baseUrl, fixtures, sampling, progress) {
  const { hotPath: hotPathProgress, timing: timingProgress } = progress.runtime;
  const { samples, warmups } = timingProgress;

  const collectTarget = async ({ hotPathFirst, phase, round, targetBytes }) => {
    const timingRecords = phase === "warmup" ? warmups : samples;
    const hotPathRecords = phase === "warmup" ? hotPathProgress.warmups : hotPathProgress.samples;
    const result = await runTimingSamples(context, baseUrl, fixtures.get(targetBytes), {
      hotPathFirst,
      onScenarioComplete(scenario, result) {
        progress.runtime.scenarios.push(Object.freeze({
          phase,
          result,
          round,
          scenario,
          targetBytes,
        }));
        if (scenario === "current-timing") {
          timingRecords.push(Object.freeze({ ...result, round, targetBytes }));
        }
      },
      onScenarioStart(scenario) {
        progress.current = Object.freeze({ phase, round, scenario, targetBytes });
      },
    });
    hotPathRecords.push(Object.freeze({ ...result.hotPath, round, targetBytes }));
    progress.current = null;
  };

  for (let round = 0; round < sampling.warmups; round += 1) {
    const targets = rotate([...fixtures.keys()], round);
    for (const [targetIndex, targetBytes] of targets.entries()) {
      console.log(`Timing warmup ${round + 1}/${sampling.warmups}: ${targetBytes} bytes`);
      await collectTarget({
        hotPathFirst: (round + targetIndex) % 2 === 1,
        phase: "warmup",
        round,
        targetBytes,
      });
    }
  }
  for (let round = 0; round < sampling.samples; round += 1) {
    const targets = rotate([...fixtures.keys()], round + sampling.warmups);
    for (const [targetIndex, targetBytes] of targets.entries()) {
      console.log(`Timing sample ${round + 1}/${sampling.samples}: ${targetBytes} bytes`);
      await collectTarget({
        hotPathFirst: (round + sampling.warmups + targetIndex) % 2 === 1,
        phase: "sample",
        round,
        targetBytes,
      });
    }
  }

  const timingSummaries = {};
  const hotPathSummaries = {};
  for (const targetBytes of fixtures.keys()) {
    timingSummaries[targetBytes] = summarizeRecords(
      samples.filter((sample) => sample.targetBytes === targetBytes),
      timingMetricNames,
    );
    hotPathSummaries[targetBytes] = summarizeRecords(
      hotPathProgress.samples.filter((sample) => sample.targetBytes === targetBytes),
      hotPathMetricNames,
    );
  }
  return Object.freeze({
    hotPath: Object.freeze({
      samples: Object.freeze(hotPathProgress.samples),
      summaries: Object.freeze(hotPathSummaries),
      warmups: Object.freeze(hotPathProgress.warmups),
    }),
    timing: Object.freeze({
      samples: Object.freeze(samples),
      summaries: Object.freeze(timingSummaries),
      warmups: Object.freeze(warmups),
    }),
  });
}

async function collectMemory(baseUrl, fixtures, sampling, progress) {
  const { samples } = progress;
  for (let round = 0; round < sampling.memorySamples; round += 1) {
    for (const targetBytes of rotate([...fixtures.keys()], round)) {
      console.log(`Memory sample ${round + 1}/${sampling.memorySamples}: ${targetBytes} bytes`);
      const isolatedBrowser = await chromium.launch({ headless: true });
      let isolatedContext;
      try {
        isolatedContext = await isolatedBrowser.newContext(browserContextOptions);
        const metrics = await runMemorySample(
          isolatedContext,
          baseUrl,
          fixtures.get(targetBytes),
        );
        samples.push(Object.freeze({ metrics, round, targetBytes }));
      } finally {
        await isolatedContext?.close().catch(() => undefined);
        await isolatedBrowser.close().catch(() => undefined);
      }
    }
  }

  const summaries = {};
  for (const targetBytes of fixtures.keys()) {
    summaries[targetBytes] = summarizeRecords(
      samples.filter((sample) => sample.targetBytes === targetBytes),
      memoryMetricNames,
    );
  }
  return Object.freeze({ samples: Object.freeze(samples), summaries: Object.freeze(summaries) });
}

function readPackageVersion(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).version;
  } catch {
    return null;
  }
}

function sanitizeSystemInfo(systemInfo) {
  if (!systemInfo) {
    return null;
  }
  return Object.freeze({
    gpu: Object.freeze({
      devices: (systemInfo.gpu?.devices ?? []).map((device) => ({
        deviceId: device.deviceId,
        deviceString: device.deviceString,
        driverVendor: device.driverVendor,
        driverVersion: device.driverVersion,
        vendorId: device.vendorId,
        vendorString: device.vendorString,
      })),
      displayType: systemInfo.gpu?.auxAttributes?.displayType ?? null,
      featureStatus: systemInfo.gpu?.featureStatus ?? null,
      glRenderer: systemInfo.gpu?.auxAttributes?.glRenderer ?? null,
    }),
    modelName: systemInfo.modelName ?? null,
    modelVersion: systemInfo.modelVersion ?? null,
  });
}

async function collectEnvironment(browser, context, config) {
  const page = await context.newPage();
  try {
    await page.goto(config.baseUrl, { waitUntil: "networkidle" });
    const browserCdp = await browser.newBrowserCDPSession();
    let systemInfo = null;
    try {
      systemInfo = await browserCdp.send("SystemInfo.getInfo");
    } catch {
      // Older Chromium revisions may omit SystemInfo on the browser target.
    }
    const browserVersion = await browserCdp.send("Browser.getVersion");
    await browserCdp.detach();
    const pageEnvironment = await page.evaluate(() => ({
      crossOriginIsolated,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
      viewport: { height: innerHeight, width: innerWidth },
    }));
    const gitStatus = commandVersion("git", ["status", "--porcelain"]);
    const cpuList = cpus();
    return Object.freeze({
      browser: Object.freeze({
        cdp: browserVersion,
        headless: true,
        playwrightVersion: readPackageVersion(join(rootDir, "node_modules/@playwright/test/package.json")),
        productVersion: browser.version(),
        systemInfo: sanitizeSystemInfo(systemInfo),
      }),
      ci: Object.freeze({
        githubActions: Boolean(process.env.GITHUB_ACTIONS),
        runnerImage: process.env.ImageOS ?? null,
        runnerName: process.env.RUNNER_NAME ?? null,
      }),
      git: Object.freeze({
        dirty: Boolean(gitStatus),
        revision: commandVersion("git", ["rev-parse", "HEAD"]),
      }),
      host: Object.freeze({
        architecture: process.arch,
        cpuModel: cpuList[0]?.model ?? null,
        freeMemoryBytesAtStart: freemem(),
        logicalCpuCount: cpuList.length,
        node: process.version,
        os: platform(),
        osRelease: release(),
        platform: process.platform,
        pnpm: commandVersion("pnpm", ["--version"]),
        totalMemoryBytes: totalmem(),
        vite: readPackageVersion(join(rootDir, "packages/demo/node_modules/vite/package.json")),
      }),
      page: pageEnvironment,
    });
  } finally {
    await page.close();
  }
}

function requireRuntimeBudgets(budgets, targetBytes, category) {
  const selected = budgets.runtime?.[category]?.[String(targetBytes)];
  if (!selected || typeof selected !== "object") {
    throw new Error(`Missing runtime.${category}.${targetBytes} performance budgets.`);
  }
  return selected;
}

const supportedSummaryStatistics = new Set([
  "maximum",
  "mean",
  "median",
  "medianAbsoluteDeviation",
  "minimum",
  "p90",
  "p95",
  "standardDeviation",
]);

function loadPerformanceBudgetConfig(options) {
  const config = JSON.parse(readFileSync(budgetsPath, "utf8"));
  if (config.schemaVersion !== 1 || !config.bundle || !config.runtime) {
    throw new TypeError("Performance budgets must use schemaVersion 1 and define bundle and runtime sections.");
  }
  if (!options.check) {
    return config;
  }

  const { contract } = config.runtime;
  if (
    contract?.benchmarkVersion !== BENCHMARK_VERSION
    || contract.documentVersion !== REPRESENTATIVE_DOCUMENT_VERSION
    || contract.browser !== "chromium"
    || contract.profile !== options.profile
    || contract.deviceScaleFactor !== browserContextOptions.deviceScaleFactor
    || contract.viewport?.width !== browserContextOptions.viewport.width
    || contract.viewport?.height !== browserContextOptions.viewport.height
    || contract.locale !== browserContextOptions.locale
    || contract.timezone !== browserContextOptions.timezoneId
    || contract.reducedMotion !== browserContextOptions.reducedMotion
    || contract.sampling?.warmups !== options.sampling.warmups
    || contract.sampling?.timingSamples !== options.sampling.samples
    || contract.sampling?.memorySamples !== options.sampling.memorySamples
    || contract.timingIsolation !== "fresh-page-shared-browser-process"
    || contract.hotPathIsolation !== "fresh-page-per-scenario-shared-browser-process"
    || contract.memoryIsolation !== "fresh-browser-process-per-sample"
    || contract.changeDelivery !== "idle-coalesced"
    || !flatContractEquals(contract.codeBlockActivation, CODE_BLOCK_ACTIVATION_CONTRACT)
    || !flatContractEquals(contract.hotPath, HOT_PATH_CONTRACT)
    || JSON.stringify(contract.requiredTargets) !== JSON.stringify(options.targets)
  ) {
    throw new Error("Runtime budget contract does not match this benchmark profile, browser, viewport, or fixture set.");
  }
  if (options.sampling.samples < config.runtime.minimumTimingSamples) {
    throw new Error("The selected profile has fewer timing samples than the approved budget contract.");
  }
  if (options.sampling.memorySamples < config.runtime.minimumMemorySamples) {
    throw new Error("The selected profile has fewer memory samples than the approved budget contract.");
  }

  for (const targetBytes of options.targets) {
    for (const [category, metricNames] of [
      ["timing", timingMetricNames],
      ["hotPath", hotPathMetricNames],
      ["memory", budgetedMemoryMetricNames],
    ]) {
      const categoryBudgets = requireRuntimeBudgets(config, targetBytes, category);
      for (const metricName of metricNames) {
        const budget = categoryBudgets[metricName];
        evaluateBudget(`${category}.${targetBytes}.${metricName}`, 0, budget);
        if (!supportedSummaryStatistics.has(budget.statistic)) {
          throw new TypeError(`${category}.${targetBytes}.${metricName} has an unsupported statistic.`);
        }
      }
    }
  }
  if (config.runtime.variance?.timing) {
    evaluateBudget("runtime.variance.timing", 0, config.runtime.variance.timing);
  }
  return config;
}

function evaluateRuntimeBudgets(runtime, budgets, targets, sampling) {
  if (sampling.samples < (budgets.runtime?.minimumTimingSamples ?? 3)) {
    throw new Error("The benchmark produced fewer timing samples than the approved minimum.");
  }
  if (sampling.memorySamples < (budgets.runtime?.minimumMemorySamples ?? 3)) {
    throw new Error("The benchmark produced fewer memory samples than the approved minimum.");
  }
  const evaluations = [];
  for (const targetBytes of targets) {
    for (const [category, metricNames] of [
      ["timing", timingMetricNames],
      ["hotPath", hotPathMetricNames],
      ["memory", budgetedMemoryMetricNames],
    ]) {
      const categoryBudgets = requireRuntimeBudgets(budgets, targetBytes, category);
      for (const metricName of metricNames) {
        const budget = categoryBudgets[metricName];
        if (!budget) {
          throw new Error(`Missing ${category}.${targetBytes}.${metricName} performance budget.`);
        }
        const statistic = budget.statistic ?? (category === "timing" ? "p95" : "median");
        const summary = runtime[category].summaries[targetBytes]?.[metricName];
        if (!summary || typeof summary[statistic] !== "number") {
          throw new Error(`Missing ${category}.${targetBytes}.${metricName}.${statistic} result.`);
        }
        evaluations.push(evaluateBudget(
          `${targetBytes} B ${metricName} ${statistic}`,
          summary[statistic],
          budget,
        ));
        const varianceBudget = budgets.runtime?.variance?.[category];
        if (varianceBudget) {
          evaluations.push(evaluateBudget(
            `${targetBytes} B ${metricName} coefficient of variation`,
            summary.coefficientOfVariation,
            varianceBudget,
          ));
        }
      }
    }
  }
  return Object.freeze(evaluations);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeReportText(value) {
  let text = String(value).replaceAll("\\", "/");
  const replacements = [];
  for (const [directory, token] of [
    [rootDir, "<workspace>"],
    [tmpdir(), "<performance-temp>"],
    [homedir(), "<home>"],
  ]) {
    replacements.push([directory.replaceAll("\\", "/"), token]);
    if (existsSync(directory)) {
      replacements.push([realpathSync(directory).replaceAll("\\", "/"), token]);
    }
  }
  replacements.sort(([left], [right]) => right.length - left.length);
  for (const [directory, token] of replacements) {
    text = text.replaceAll(directory, token);
  }
  text = text.replace(
    /<performance-temp>\/markora-performance-[^/\s]+/gu,
    "<performance-temp>",
  );
  return text;
}

function serializeError(error) {
  if (error instanceof Error) {
    return Object.freeze({
      message: sanitizeReportText(error.message),
      name: error.name,
      stack: error.stack ? sanitizeReportText(error.stack) : null,
    });
  }
  return Object.freeze({
    message: sanitizeReportText(error),
    name: "UnknownError",
    stack: null,
  });
}

function createReportConfig(options) {
  return Object.freeze({
    codeBlockActivation: CODE_BLOCK_ACTIVATION_CONTRACT,
    documentVersion: REPRESENTATIVE_DOCUMENT_VERSION,
    hotPath: HOT_PATH_CONTRACT,
    isolation: Object.freeze({
      hotPath: "fresh-page-per-scenario-shared-browser-process",
      memory: "fresh-browser-process-per-sample",
      timing: "fresh-page-shared-browser-process",
    }),
    profile: options.profile,
    sampling: options.sampling,
    sizeOrder: options.targets,
  });
}

function createHarnessManifest() {
  const paths = [
    "performance/budgets.json",
    "scripts/performance-benchmark.mjs",
    "scripts/performance/budget-evaluator.mjs",
    "scripts/performance/packed-consumer/index.html",
    "scripts/performance/packed-consumer/runtime.mjs",
    "scripts/performance/representative-document.mjs",
    "scripts/performance/statistics.mjs",
  ];
  return Object.freeze(Object.fromEntries(paths.map((path) => [
    path,
    sha256File(join(rootDir, path)),
  ])));
}

function createFixtureManifest(fixtures) {
  if (!fixtures) {
    return {};
  }
  return Object.fromEntries([...fixtures].map(([targetBytes, fixture]) => [
    targetBytes,
    {
      id: fixture.id,
      sha256: fixture.sha256,
      stats: fixture.stats,
    },
  ]));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const harness = createHarnessManifest();
  const progress = {
    current: null,
    phase: "initialization",
    runtime: {
      hotPath: { samples: [], warmups: [] },
      memory: { samples: [] },
      scenarios: [],
      timing: { samples: [], warmups: [] },
    },
  };
  let fixtures;
  let packedApp;
  let server;
  let browser;
  let context;
  let report;
  let budgetConfig;
  let environment;

  try {
    progress.phase = "budget-validation";
    budgetConfig = loadPerformanceBudgetConfig(options);
    progress.phase = "fixture-generation";
    fixtures = new Map(options.targets.map((target) => [target, createFixture(target)]));
    progress.phase = "packed-consumer-preparation";
    packedApp = preparePackedApp();
    server = await serveDirectory(packedApp.distDir);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(browserContextOptions);
    progress.phase = "environment-capture";
    environment = await collectEnvironment(browser, context, { baseUrl: server.baseUrl });
    if (!environment.page.crossOriginIsolated) {
      throw new Error("Packed performance consumer is not cross-origin isolated.");
    }
    progress.phase = "timing";
    const timingResult = await collectTiming(
      context,
      server.baseUrl,
      fixtures,
      options.sampling,
      progress,
    );
    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;
    progress.phase = "memory";
    const memory = await collectMemory(
      server.baseUrl,
      fixtures,
      options.sampling,
      progress.runtime.memory,
    );

    const fixtureManifest = createFixtureManifest(fixtures);
    const runtime = Object.freeze({
      hotPath: timingResult.hotPath,
      memory,
      timing: timingResult.timing,
    });
    progress.phase = "budget-evaluation";
    const evaluations = options.check
      ? evaluateRuntimeBudgets(runtime, budgetConfig, options.targets, options.sampling)
      : [];
    const budgetResult = options.check
      ? reportBudgetEvaluations(evaluations, { title: "Markora runtime performance budget" })
      : { failures: [], passed: true, warnings: [] };

    report = Object.freeze({
      benchmarkVersion: BENCHMARK_VERSION,
      budgets: Object.freeze({
        checked: options.check,
        configSha256: budgetConfig ? sha256(JSON.stringify(budgetConfig)) : null,
        evaluations,
        passed: budgetResult.passed,
      }),
      config: createReportConfig(options),
      createdAt: new Date().toISOString(),
      environment,
      fixtures: fixtureManifest,
      harness,
      package: packedApp.package,
      provenance: packedApp.provenance,
      runtime,
      schemaVersion: 1,
      status: budgetResult.passed ? "passed" : "failed",
    });
    writeJson(options.outputPath, report);
    console.log(`Performance report written to ${relative(rootDir, options.outputPath)}.`);
    if (!budgetResult.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (!report) {
      try {
        writeJson(options.outputPath, {
          benchmarkVersion: BENCHMARK_VERSION,
          budgets: {
            checked: options.check,
            configSha256: budgetConfig ? sha256(JSON.stringify(budgetConfig)) : null,
            evaluations: [],
            passed: false,
          },
          config: createReportConfig(options),
          createdAt: new Date().toISOString(),
          environment: environment ?? null,
          error: serializeError(error),
          fixtures: createFixtureManifest(fixtures),
          harness,
          package: packedApp?.package ?? null,
          partial: {
            current: progress.current,
            phase: progress.phase,
            runtime: progress.runtime,
          },
          provenance: packedApp?.provenance ?? null,
          schemaVersion: 1,
          status: "error",
        });
        console.error(`Failed performance report written to ${relative(rootDir, options.outputPath)}.`);
      } catch (reportError) {
        console.error(`Could not write failed performance report: ${serializeError(reportError).message}`);
      }
    }
    throw error;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    if (packedApp) {
      if (options.keepTemp) {
        console.log(`Packed performance app retained at ${packedApp.tempRoot}.`);
      } else {
        rmSync(packedApp.tempRoot, { force: true, recursive: true });
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
