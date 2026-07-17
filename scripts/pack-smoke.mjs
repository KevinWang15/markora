import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  evaluateBudget,
  reportBudgetEvaluations,
} from "./performance/budget-evaluator.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packSmokePath = fileURLToPath(import.meta.url);
const workspaceNodeModulesDir = resolve(rootDir, "node_modules/.pnpm/node_modules");
const npmCachePath = resolve(rootDir, ".npm-cache");
const viteCliPath = resolve(rootDir, "packages/demo/node_modules/vite/bin/vite.js");
const tscCliPath = resolve(rootDir, "node_modules/typescript/bin/tsc");
const defaultBudgetPath = resolve(rootDir, "performance/budgets.json");
let commandOptions;
let currentPhase = "argument-parsing";
let reportWritten = false;
let rootPackageJson;
let smokeAppDir;
let smokeNodeModulesDir;
let tarballRoot;
let tempRoot;
let availableMeasurements = null;
const availablePackages = [];

function readValueArgument(args, index, name) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }

  return value;
}

function readInlinePath(argument, prefix) {
  const value = argument.slice(prefix.length);

  if (!value) {
    throw new Error(`${prefix.slice(0, -1)} requires a path.`);
  }

  return value;
}

function parseArguments(args) {
  let budgetPath = process.env.MARKORA_BUNDLE_BUDGET_PATH ?? defaultBudgetPath;
  let reportPath = process.env.MARKORA_BUNDLE_REPORT_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--budget") {
      budgetPath = resolve(rootDir, readValueArgument(args, index, "--budget"));
      index += 1;
    } else if (argument.startsWith("--budget=")) {
      budgetPath = resolve(rootDir, readInlinePath(argument, "--budget="));
    } else if (argument === "--report") {
      reportPath = resolve(rootDir, readValueArgument(args, index, "--report"));
      index += 1;
    } else if (argument.startsWith("--report=")) {
      reportPath = resolve(rootDir, readInlinePath(argument, "--report="));
    } else {
      throw new Error(`Unknown pack smoke argument: ${argument}`);
    }
  }

  return Object.freeze({
    budgetPath: resolve(rootDir, budgetPath),
    reportPath: reportPath ? resolve(rootDir, reportPath) : undefined,
  });
}

function discoverRequestedReportPath(args) {
  let reportPath = process.env.MARKORA_BUNDLE_REPORT_PATH;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report" && args[index + 1] && !args[index + 1].startsWith("--")) {
      reportPath = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--report=") && argument.length > "--report=".length) {
      reportPath = argument.slice("--report=".length);
    }
  }
  return reportPath ? resolve(rootDir, reportPath) : undefined;
}

const requestedReportPath = discoverRequestedReportPath(process.argv.slice(2));

class CommandExecutionError extends Error {
  constructor(command, result) {
    const label = basename(command);
    const detail = result.error?.code ? ` (${result.error.code})` : "";
    super(`${label} failed with status ${result.status ?? "unavailable"}${detail}.`);
    this.name = "CommandExecutionError";
    this.command = label;
    this.exitCode = result.status ?? 1;
    this.signal = result.signal ?? null;
  }
}

function run(command, args, { cwd = rootDir, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: capture ? "pipe" : "inherit",
    encoding: capture ? "utf8" : undefined,
    env: {
      ...process.env,
      npm_config_cache: npmCachePath,
      NPM_CONFIG_CACHE: npmCachePath,
    },
  });

  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }

    throw new CommandExecutionError(command, result);
  }

  return result;
}

function packPackage(packagePath) {
  const packageJson = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
  const packageOutputDir = join(tarballRoot, packageJson.name);
  rmSync(packageOutputDir, { recursive: true, force: true });
  mkdirSync(packageOutputDir, { recursive: true });

  run("npm", ["pack", "--pack-destination", packageOutputDir], { cwd: packagePath });

  const tarballs = readdirSync(packageOutputDir).filter((entry) => entry.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball for ${packageJson.name}, found ${tarballs.length}.`);
  }

  return {
    name: packageJson.name,
    tarballPath: join(packageOutputDir, tarballs[0]),
    version: packageJson.version,
  };
}

function copyWorkspaceDependencies() {
  for (const entry of readdirSync(workspaceNodeModulesDir)) {
    if (entry === "markora" || entry === "markora-ui" || entry === "demo" || entry === ".bin") {
      continue;
    }

    cpSync(join(workspaceNodeModulesDir, entry), join(smokeNodeModulesDir, entry), {
      recursive: true,
      dereference: true,
    });
  }
}

function unpackPackage(packageName, tarballPath) {
  const packageDir = join(smokeNodeModulesDir, packageName);
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });
  run("tar", ["-xzf", tarballPath, "-C", packageDir, "--strip-components=1"]);
}

function writeBundleConfig(label, entryFile) {
  writeFileSync(join(smokeAppDir, `vite.${label}.config.mjs`), `import { resolve } from "node:path";

function createModuleGraphPlugin() {
  return {
    name: "markora-pack-smoke-module-graph",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((entry) => entry.type === "chunk");
      const entryModuleIds = chunks
        .filter((chunk) => chunk.isEntry && chunk.facadeModuleId)
        .map((chunk) => chunk.facadeModuleId);
      const staticModuleIds = new Set();
      const emittedModuleIds = new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)));

      const visit = (moduleId) => {
        if (staticModuleIds.has(moduleId)) {
          return;
        }

        staticModuleIds.add(moduleId);
        const moduleInfo = this.getModuleInfo(moduleId);

        for (const importedId of moduleInfo?.importedIds ?? []) {
          visit(importedId);
        }
      };

      for (const entryModuleId of entryModuleIds) {
        visit(entryModuleId);
      }

      const report = {
        label: ${JSON.stringify(label)},
        entryModuleIds: entryModuleIds.sort(),
        staticModuleIds: [...staticModuleIds].sort(),
        emittedModuleIds: [...emittedModuleIds].sort(),
        lazyModuleIds: [...emittedModuleIds]
          .filter((moduleId) => !staticModuleIds.has(moduleId))
          .sort(),
        chunks: chunks
          .map((chunk) => ({
            dynamicImports: [...chunk.dynamicImports].sort(),
            fileName: chunk.fileName,
            imports: [...chunk.imports].sort(),
            isEntry: chunk.isEntry,
            renderedBytes: Buffer.byteLength(chunk.code),
            moduleIds: Object.keys(chunk.modules).sort(),
          }))
          .sort((left, right) => left.fileName.localeCompare(right.fileName)),
      };

      this.emitFile({
        type: "asset",
        fileName: "module-graph.json",
        source: JSON.stringify(report, null, 2) + "\\n",
      });
    },
  };
}

export default {
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(process.cwd(), ${JSON.stringify(entryFile)}),
      formats: ["es"],
      fileName: "index",
    },
    minify: "esbuild",
    outDir: ${JSON.stringify(`dist/${label}`)},
  },
  plugins: [createModuleGraphPlugin()],
};
`);
}

function normalizeModuleId(moduleId) {
  return moduleId.replaceAll("\\", "/").replace(/\?.*$/, "");
}

function gzipByteLength(source) {
  return gzipSync(source, { level: 9, mtime: 0 }).byteLength;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function measureFiles(outputDir, fileNames) {
  return fileNames.reduce(
    (measurement, fileName) => {
      const source = readFileSync(join(outputDir, fileName));
      measurement.gzipBytes += gzipByteLength(source);
      measurement.rawBytes += source.byteLength;
      return measurement;
    },
    { gzipBytes: 0, rawBytes: 0 },
  );
}

function collectInitialChunks(report) {
  const chunksByFileName = new Map(report.chunks.map((chunk) => [chunk.fileName, chunk]));
  const initialChunks = new Set();
  const pending = report.chunks
    .filter((chunk) => chunk.isEntry)
    .map((chunk) => chunk.fileName);

  if (pending.length === 0) {
    throw new Error(`${report.label} did not emit an entry chunk.`);
  }

  while (pending.length > 0) {
    const fileName = pending.pop();

    if (initialChunks.has(fileName)) {
      continue;
    }

    const chunk = chunksByFileName.get(fileName);

    if (!chunk) {
      throw new Error(`${report.label} referenced missing static chunk ${fileName}.`);
    }

    initialChunks.add(fileName);

    for (const importedFileName of chunk.imports) {
      if (!chunksByFileName.has(importedFileName)) {
        throw new Error(`${report.label} left static import ${importedFileName} external.`);
      }

      pending.push(importedFileName);
    }
  }

  return initialChunks;
}

function measureBundleGraph(report) {
  const initialChunkNames = collectInitialChunks(report);
  const allChunkNames = report.chunks.map((chunk) => chunk.fileName).sort();
  const lazyChunkNames = allChunkNames.filter((fileName) => !initialChunkNames.has(fileName));
  const initialFileNames = [...initialChunkNames].sort();
  const cssFileNames = readdirSync(report.outputDir)
    .filter((fileName) => fileName.endsWith(".css"))
    .sort();
  const initialJs = measureFiles(report.outputDir, initialFileNames);
  const lazyJs = measureFiles(report.outputDir, lazyChunkNames);
  const totalJs = measureFiles(report.outputDir, allChunkNames);
  const css = measureFiles(report.outputDir, cssFileNames);

  for (const chunk of report.chunks) {
    const fileBytes = readFileSync(join(report.outputDir, chunk.fileName)).byteLength;

    if (fileBytes !== chunk.renderedBytes) {
      throw new Error(
        `${report.label} chunk ${chunk.fileName} changed after graph measurement `
        + `(${chunk.renderedBytes} rendered bytes, ${fileBytes} emitted bytes).`,
      );
    }
  }

  if (
    initialJs.rawBytes + lazyJs.rawBytes !== totalJs.rawBytes
    || initialJs.gzipBytes + lazyJs.gzipBytes !== totalJs.gzipBytes
  ) {
    throw new Error(`${report.label} initial and lazy bundle measurements did not equal the total.`);
  }

  return Object.freeze({
    css: Object.freeze({
      ...css,
      fileCount: cssFileNames.length,
      fileNames: Object.freeze(cssFileNames),
    }),
    initialJs: Object.freeze({
      ...initialJs,
      chunkCount: initialFileNames.length,
      chunkNames: Object.freeze(initialFileNames),
    }),
    lazyJs: Object.freeze({
      ...lazyJs,
      chunkCount: lazyChunkNames.length,
      chunkNames: Object.freeze(lazyChunkNames),
    }),
    staticModuleCount: report.staticModuleIds.length,
    totalJs: Object.freeze({
      ...totalJs,
      chunkCount: allChunkNames.length,
      chunkNames: Object.freeze(allChunkNames),
    }),
  });
}

function readBundleReport(label) {
  const outputDir = join(smokeAppDir, "dist", label);
  const report = JSON.parse(readFileSync(join(outputDir, "module-graph.json"), "utf8"));
  const chunkSource = report.chunks
    .map((chunk) => readFileSync(join(outputDir, chunk.fileName), "utf8"))
    .join("\n");
  const cssSource = readdirSync(outputDir)
    .filter((fileName) => fileName.endsWith(".css"))
    .sort()
    .map((fileName) => readFileSync(join(outputDir, fileName), "utf8"))
    .join("\n");

  return {
    ...report,
    outputDir,
    chunkSource,
    cssSource,
    chunks: report.chunks.map((chunk) => ({
      ...chunk,
      dynamicImports: chunk.dynamicImports ?? [],
      imports: chunk.imports ?? [],
    })),
    staticModuleIds: report.staticModuleIds.map(normalizeModuleId),
    emittedModuleIds: report.emittedModuleIds.map(normalizeModuleId),
    lazyModuleIds: (report.lazyModuleIds ?? report.emittedModuleIds.filter(
      (moduleId) => !report.staticModuleIds.includes(moduleId),
    )).map(normalizeModuleId),
  };
}

function moduleIdIncludes(moduleId, fragment) {
  return normalizeModuleId(moduleId).includes(fragment);
}

function assertPackedModule(report, fragment, label) {
  const packedNodeModulesPrefix = `${normalizeModuleId(realpathSync(smokeNodeModulesDir))}/`;
  const moduleIds = [...report.staticModuleIds, ...report.emittedModuleIds];
  const matchingModuleIds = moduleIds.filter((moduleId) => moduleIdIncludes(moduleId, fragment));

  if (matchingModuleIds.length === 0) {
    throw new Error(`${label} was not present in the ${report.label} graph.`);
  }

  const unpackedModuleIds = matchingModuleIds.filter(
    (moduleId) => !normalizeModuleId(moduleId).startsWith(packedNodeModulesPrefix),
  );

  if (unpackedModuleIds.length > 0) {
    throw new Error(
      `${label} did not resolve from the packed consumer node_modules:\n${unpackedModuleIds
        .map((moduleId) => `- ${moduleId}`)
        .join("\n")}`,
    );
  }
}

function assertPackedPackage(packageInfo) {
  const packageJson = JSON.parse(readFileSync(
    join(smokeNodeModulesDir, packageInfo.name, "package.json"),
    "utf8",
  ));

  if (packageJson.name !== packageInfo.name || packageJson.version !== packageInfo.version) {
    throw new Error(
      `Packed ${packageInfo.name} provenance mismatch: expected ${packageInfo.version}, `
      + `received ${packageJson.name}@${packageJson.version}.`,
    );
  }
}

function assertPackedProvenance(rootReport, minimalReport, rootMeasurement, minimalMeasurement) {
  assertPackedModule(rootReport, "/node_modules/markora/dist/index.js", "Packed markora root entry");
  assertPackedModule(rootReport, "/node_modules/markora/dist/styles.css", "Packed markora stylesheet");
  assertPackedModule(rootReport, "/node_modules/markora-ui/dist/index.js", "Packed markora-ui entry");
  assertPackedModule(rootReport, "/node_modules/markora-ui/dist/styles.css", "Packed markora-ui stylesheet");
  assertPackedModule(minimalReport, "/node_modules/markora/dist/minimal.js", "Packed markora minimal entry");
  assertPackedModule(minimalReport, "/node_modules/markora/dist/minimal.css", "Packed minimal stylesheet");

  if (minimalMeasurement.lazyJs.chunkCount !== 0) {
    throw new Error(
      `markora/minimal emitted ${minimalMeasurement.lazyJs.chunkCount} lazy chunks; `
      + "the minimal packed graph must remain a single static graph.",
    );
  }

  if (rootMeasurement.css.fileCount !== 1 || minimalMeasurement.css.fileCount !== 1) {
    throw new Error(
      "Packed root and minimal consumers must each emit exactly one production stylesheet.",
    );
  }

  for (const selector of [
    ".ProseMirror.mdw-has-managed-block-cursor",
    "pre.mdw-managed-block-cursor",
    "pre.mdw-managed-block-cursor-before:before",
    "pre.mdw-managed-block-cursor-after:after",
  ]) {
    if (!minimalReport.cssSource.includes(selector)) {
      throw new Error(`Packed minimal stylesheet omitted managed code-block selector ${selector}.`);
    }
  }
}

function assertBundleIsolation(rootReport, minimalReport) {
  const forbiddenMinimalModuleFragments = [
    "/node_modules/markora/dist/index.js",
    "/node_modules/markora/dist/createEditor.js",
    "/node_modules/markora/dist/defaultExtensionPreset.js",
    "/node_modules/markora/dist/extensionPresets.js",
    "/node_modules/markora/dist/markdownCodec.js",
    "/node_modules/markora/dist/codeBlockLanguages.js",
    "/node_modules/markora/dist/codeBlockView.js",
    "/node_modules/markora/dist/opaqueMarkdown.js",
    "/node_modules/markora/dist/opaqueNodeView.js",
    "/node_modules/markora/dist/pipeTable.js",
    "/node_modules/markora/dist/tableEditing.js",
    "/node_modules/markora/dist/tableFidelity.js",
    "/node_modules/markora/dist/tableNavigation.js",
    "/node_modules/markora/dist/taskListUtils.js",
    "/node_modules/markora-ui/",
    "/node_modules/prosemirror-tables/",
    "/node_modules/@codemirror/",
    "/node_modules/@lezer/",
  ];
  const forbiddenMinimalSourceSignatures = [
    "@markora/code-mirror",
    "@markora/opaque",
    "@markora/strike",
    "@markora/table",
    "@markora/task-list",
    "createCodeBlockViewClass",
    "createOpaqueNodeViewClass",
    "createPipeTableHelpers",
    "createTaskListHelpers",
  ];
  const allMinimalModuleIds = [
    ...minimalReport.staticModuleIds,
    ...minimalReport.emittedModuleIds,
  ];
  const forbiddenModules = forbiddenMinimalModuleFragments.flatMap((fragment) => (
    allMinimalModuleIds
      .filter((moduleId) => moduleIdIncludes(moduleId, fragment))
      .map((moduleId) => ({ fragment, moduleId }))
  ));

  if (forbiddenModules.length > 0) {
    throw new Error(`markora/minimal reached default-only modules:\n${forbiddenModules
      .map(({ fragment, moduleId }) => `- ${fragment}: ${moduleId}`)
      .join("\n")}`);
  }

  const forbiddenSignatures = forbiddenMinimalSourceSignatures.filter((signature) => (
    minimalReport.chunkSource.includes(signature)
  ));

  if (forbiddenSignatures.length > 0) {
    throw new Error(`markora/minimal emitted default-only source signatures: ${forbiddenSignatures.join(", ")}.`);
  }

  if (!minimalReport.staticModuleIds.some((moduleId) => (
    normalizeModuleId(moduleId).endsWith("/node_modules/markora/dist/minimal.js")
  ))) {
    throw new Error("The minimal bundle did not resolve the packed markora/minimal entry.");
  }

  if (!minimalReport.staticModuleIds.some((moduleId) => (
    normalizeModuleId(moduleId).endsWith("/node_modules/markora/dist/extension-api.js")
  ))) {
    throw new Error("The minimal consumer did not resolve the packed markora/extension-api entry.");
  }

  if (!rootReport.staticModuleIds.some((moduleId) => (
    normalizeModuleId(moduleId).endsWith("/node_modules/markora/dist/index.js")
  ))) {
    throw new Error("The compatibility bundle did not resolve the packed markora root entry.");
  }

  const rootStaticCodeMirrorModules = rootReport.staticModuleIds.filter((moduleId) => (
    moduleIdIncludes(moduleId, "/node_modules/@codemirror/")
    || moduleIdIncludes(moduleId, "/node_modules/@lezer/")
    || moduleIdIncludes(moduleId, "/node_modules/markora/dist/activeCodeBlockView.js")
  ));

  if (rootStaticCodeMirrorModules.length > 0) {
    throw new Error(`The compatibility entry eagerly included CodeMirror runtime modules:\n${rootStaticCodeMirrorModules
      .map((moduleId) => `- ${moduleId}`)
      .join("\n")}`);
  }

  const requiredLazyCodeMirrorFragments = [
    "/node_modules/markora/dist/activeCodeBlockView.js",
    "/node_modules/@codemirror/commands/",
    "/node_modules/@codemirror/language/",
    "/node_modules/@codemirror/state/",
    "/node_modules/@codemirror/view/",
    "/node_modules/@lezer/common/",
    "/node_modules/@lezer/highlight/",
  ];
  const missingLazyCodeMirrorFragments = requiredLazyCodeMirrorFragments.filter((fragment) => (
    !rootReport.lazyModuleIds.some((moduleId) => moduleIdIncludes(moduleId, fragment))
  ));

  if (missingLazyCodeMirrorFragments.length > 0) {
    throw new Error(
      `The compatibility bundle omitted lazy CodeMirror runtime modules: ${missingLazyCodeMirrorFragments.join(", ")}.`,
    );
  }

  for (const externalExtensionName of ["@pack-smoke/callout", "@pack-smoke/highlight"]) {
    if (!minimalReport.chunkSource.includes(externalExtensionName)) {
      throw new Error(`The minimal bundle omitted external extension ${externalExtensionName}.`);
    }
  }

}

function describeCount(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function printBundleMeasurement(label, measurement) {
  console.log([
    `  ${label}:`,
    `    initial JS: ${measurement.initialJs.rawBytes} raw / ${measurement.initialJs.gzipBytes} gzip bytes (${describeCount(measurement.initialJs.chunkCount, "chunk")})`,
    `    lazy JS: ${measurement.lazyJs.rawBytes} raw / ${measurement.lazyJs.gzipBytes} gzip bytes (${describeCount(measurement.lazyJs.chunkCount, "chunk")})`,
    `    total JS: ${measurement.totalJs.rawBytes} raw / ${measurement.totalJs.gzipBytes} gzip bytes (${describeCount(measurement.totalJs.chunkCount, "chunk")})`,
    `    CSS: ${measurement.css.rawBytes} raw / ${measurement.css.gzipBytes} gzip bytes (${describeCount(measurement.css.fileCount, "file")})`,
    `    static modules: ${measurement.staticModuleCount}`,
  ].join("\n"));
}

function printBundleMeasurements(rootMeasurement, minimalMeasurement) {
  console.log("Packed production bundle graph (per-file gzip level 9):");
  printBundleMeasurement("markora", rootMeasurement);
  printBundleMeasurement("markora/minimal", minimalMeasurement);
}

const bundleBudgetMetrics = Object.freeze([
  ["initialJs", "rawBytes"],
  ["initialJs", "gzipBytes"],
  ["lazyJs", "rawBytes"],
  ["lazyJs", "gzipBytes"],
  ["totalJs", "rawBytes"],
  ["totalJs", "gzipBytes"],
  ["css", "rawBytes"],
  ["css", "gzipBytes"],
]);

function loadBudgetConfig(filePath) {
  const config = JSON.parse(readFileSync(filePath, "utf8"));

  if (config.schemaVersion !== 1 || !config.bundle || typeof config.bundle !== "object") {
    throw new TypeError("Performance budgets must use schemaVersion 1 and define bundle budgets.");
  }

  return config;
}

function evaluateBundleBudgets(config, measurements) {
  const evaluations = [];

  for (const graphName of ["root", "minimal"]) {
    const measurement = measurements[graphName];
    const budget = config.bundle[graphName];

    if (!budget || typeof budget !== "object") {
      throw new TypeError(`Bundle budgets are missing the ${graphName} graph.`);
    }

    for (const [groupName, metricName] of bundleBudgetMetrics) {
      evaluations.push(evaluateBudget(
        `bundle.${graphName}.${groupName}.${metricName}`,
        measurement[groupName][metricName],
        budget[groupName]?.[metricName],
      ));
    }

    evaluations.push(evaluateBudget(
      `bundle.${graphName}.staticModuleCount`,
      measurement.staticModuleCount,
      budget.staticModuleCount,
    ));
  }

  return evaluations;
}

function displayPath(filePath) {
  const normalizedRoot = `${normalizeModuleId(rootDir)}/`;
  const normalizedPath = normalizeModuleId(filePath);
  if (normalizedPath.startsWith(normalizedRoot)) {
    return normalizedPath.slice(normalizedRoot.length);
  }

  for (const [directory, token] of [
    [tempRoot, "<pack-smoke-temp>"],
    [homedir(), "<home>"],
  ]) {
    if (!directory) {
      continue;
    }
    const normalizedDirectory = normalizeModuleId(directory);
    if (normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`)) {
      return `${token}${normalizedPath.slice(normalizedDirectory.length)}`;
    }
  }

  return basename(normalizedPath);
}

function createHarnessProvenance() {
  return Object.freeze({
    "scripts/pack-smoke.mjs": sha256File(packSmokePath),
  });
}

function describePackage(packageInfo) {
  return Object.freeze({
    name: packageInfo.name,
    sha256: sha256File(packageInfo.tarballPath),
    tarball: basename(packageInfo.tarballPath),
    version: packageInfo.version,
  });
}

function rememberPackage(packageInfo) {
  availablePackages.push(describePackage(packageInfo));
}

function sanitizeReportText(value) {
  let text = String(value).replaceAll("\\", "/");
  const replacements = [];
  for (const [directory, token] of [
    [rootDir, "<workspace>"],
    [tempRoot, "<pack-smoke-temp>"],
    [homedir(), "<home>"],
  ]) {
    if (!directory) {
      continue;
    }
    replacements.push([normalizeModuleId(directory), token]);
    if (existsSync(directory)) {
      replacements.push([normalizeModuleId(realpathSync(directory)), token]);
    }
  }
  replacements.sort(([left], [right]) => right.length - left.length);
  for (const [directory, token] of replacements) {
    text = text.replaceAll(directory, token);
  }
  return text;
}

function serializeReportError(error) {
  const serialized = {
    message: sanitizeReportText(error instanceof Error ? error.message : error),
    name: error instanceof Error ? error.name : "UnknownError",
  };
  if (error instanceof CommandExecutionError) {
    serialized.command = error.command;
    serialized.exitCode = error.exitCode;
    serialized.signal = error.signal;
  }
  return Object.freeze(serialized);
}

function readViteVersion() {
  try {
    return JSON.parse(readFileSync(
      resolve(rootDir, "packages/demo/node_modules/vite/package.json"),
      "utf8",
    )).version;
  } catch {
    return null;
  }
}

function writeFailureReport(error) {
  const reportPath = commandOptions?.reportPath ?? requestedReportPath;
  if (!reportPath) {
    return false;
  }
  const budgetConfigPath = commandOptions?.budgetPath ?? defaultBudgetPath;
  const report = {
    schemaVersion: 1,
    kind: "markora-packed-bundle-budget-report",
    generatedAt: new Date().toISOString(),
    status: "error",
    phase: currentPhase,
    error: serializeReportError(error),
    harness: createHarnessProvenance(),
    budgetConfig: displayPath(budgetConfigPath),
    budgetConfigSha256: existsSync(budgetConfigPath) ? sha256File(budgetConfigPath) : null,
    environment: {
      architecture: process.arch,
      node: process.version,
      platform: process.platform,
      vite: readViteVersion(),
    },
    provenance: {
      consumer: "production-minified Vite library build",
      source: "npm-pack tarballs",
      packages: availablePackages,
    },
    graphs: availableMeasurements,
    partial: true,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`Failed packed bundle report written to ${reportPath}`);
  return true;
}

function writeMeasurementReport({
  budgetConfigPath,
  budgetResult,
  corePackage,
  measurements,
  reportPath,
  uiPackage,
}) {
  if (!reportPath) {
    return;
  }

  const vitePackage = JSON.parse(readFileSync(
    resolve(rootDir, "packages/demo/node_modules/vite/package.json"),
    "utf8",
  ));
  const report = {
    schemaVersion: 1,
    kind: "markora-packed-bundle-budget-report",
    generatedAt: new Date().toISOString(),
    status: budgetResult.passed ? "passed" : "failed",
    harness: createHarnessProvenance(),
    budgetConfig: displayPath(budgetConfigPath),
    budgetConfigSha256: sha256File(budgetConfigPath),
    compression: {
      algorithm: "gzip",
      level: 9,
      members: "per-emitted-file",
    },
    environment: {
      architecture: process.arch,
      node: process.version,
      platform: process.platform,
      vite: vitePackage.version,
    },
    provenance: {
      consumer: "production-minified Vite library build",
      source: "npm-pack tarballs",
      packages: [corePackage, uiPackage].map(describePackage),
    },
    invariants: {
      initialAndLazyPartitionTotal: true,
      compatibilityInitialExcludesCodeMirror: true,
      compatibilityLazyIncludesCodeMirror: true,
      minimalExcludesCodeMirror: true,
      minimalHasNoLazyChunks: measurements.minimal.lazyJs.chunkCount === 0,
      packedEntriesAndStylesResolved: true,
      packedPackageVersionsMatched: true,
      rootAndMinimalGraphsIndependent: true,
    },
    graphs: measurements,
    budgets: {
      evaluations: budgetResult.evaluations,
      failures: budgetResult.failures,
      passed: budgetResult.passed,
      warnings: budgetResult.warnings,
    },
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Packed bundle report written to ${reportPath}`);
  return true;
}

function main() {
currentPhase = "argument-parsing";
commandOptions = parseArguments(process.argv.slice(2));
currentPhase = "workspace-preparation";
rootPackageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
tempRoot = mkdtempSync(join(tmpdir(), "markora-pack-smoke-"));
tarballRoot = join(tempRoot, "tarballs");
smokeAppDir = join(tempRoot, "app");
smokeNodeModulesDir = join(smokeAppDir, "node_modules");
mkdirSync(npmCachePath, { recursive: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(smokeAppDir, { recursive: true });
mkdirSync(smokeNodeModulesDir, { recursive: true });

currentPhase = "core-package";
const corePackage = packPackage(join(rootDir, "packages/core"));
rememberPackage(corePackage);
currentPhase = "ui-package";
const uiPackage = packPackage(join(rootDir, "packages/ui"));
rememberPackage(uiPackage);

currentPhase = "packed-dependency-isolation";
copyWorkspaceDependencies();
unpackPackage(corePackage.name, corePackage.tarballPath);
unpackPackage(uiPackage.name, uiPackage.tarballPath);
assertPackedPackage(corePackage);
assertPackedPackage(uiPackage);

currentPhase = "consumer-generation";
writeFileSync(join(smokeAppDir, "package.json"), `${JSON.stringify({
  name: "markora-pack-smoke",
  private: true,
  type: "module",
  packageManager: rootPackageJson.packageManager,
}, null, 2)}\n`);

mkdirSync(join(smokeAppDir, "src"), { recursive: true });
writeFileSync(join(smokeAppDir, "src/root.js"), `import {
  createEditor,
  createDefaultCodeBlockLanguageRegistry,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
} from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

export function mountCompatibilityEditor(element) {
  return createEditor({
    element,
    markdown: "# Packed compatibility editor",
    resources: {
      images: { referrerPolicy: "no-referrer" },
      links: { allowedProtocols: ["https:"] },
    },
    ui: createDefaultUi(),
  });
}

export const packedCompatibilitySurface = [
  typeof createEditor,
  typeof createDefaultCodeBlockLanguageRegistry,
  typeof getMarkdownEditorTransactionOrigin,
  typeof setMarkdownEditorTransactionOrigin,
  typeof createDefaultUi,
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/extensions.ts"), `import {
  defineMarkdownEditorExtension,
  type MarkdownEditorTokenizerRule,
} from "markora/extension-api";

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;
type InlineRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "inline" }
>["createRule"]>;

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function createCalloutRule(openType: string, closeType: string): BlockRule {
  return (state, startLine, endLine, silent) => {
    if (lineText(state, startLine).trim() !== ":::note") {
      return false;
    }

    let closeLine = startLine + 1;

    while (closeLine < endLine && lineText(state, closeLine).trim() !== ":::") {
      closeLine += 1;
    }

    if (closeLine >= endLine) {
      return false;
    }

    if (silent) {
      return true;
    }

    const open = state.push(openType, "aside", 1);
    open.map = [startLine, closeLine + 1];
    const parentType = state.parentType;
    state.parentType = "blockquote";
    state.md.block.tokenize(state, startLine + 1, closeLine);
    state.parentType = parentType;
    state.push(closeType, "aside", -1);
    state.line = closeLine + 1;
    return true;
  };
}

function createHighlightRule(openType: string, closeType: string): InlineRule {
  return (state, silent) => {
    const start = state.pos;

    if (!state.src.startsWith("==", start)) {
      return false;
    }

    const end = state.src.indexOf("==", start + 2);
    const content = end < 0 ? "" : state.src.slice(start + 2, end);

    if (!content || content.trim() !== content) {
      return false;
    }

    state.pos = end + 2;

    if (!silent) {
      state.push(openType, "mark", 1).markup = "==";
      state.push("text", "", 0).content = content;
      state.push(closeType, "mark", -1).markup = "==";
    }

    return true;
  };
}

export const packedCalloutExtension = defineMarkdownEditorExtension({
  name: "@pack-smoke/callout",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    nodes: [{
      name: "pack_callout",
      before: "blockquote",
      spec: {
        content: "block+",
        defining: true,
        group: "block",
        parseDOM: [{ tag: "aside[data-pack-callout]" }],
        toDOM: () => ["aside", { "data-pack-callout": "note" }, 0],
      },
    }],
    managedBlocks: ["pack_callout"],
  },
  markdown: {
    tokenizerRules: [{
      id: "container",
      phase: "block",
      before: ["@markora/foundation/block/fence"],
      createRule: ({ token }) => createCalloutRule(
        token("container_open"),
        token("container_close"),
      ),
    }],
    parserTokens: { container: { block: "pack_callout" } },
    serializer: {
      nodes: {
        pack_callout(state, node) {
          state.write(":::note");
          state.ensureNewLine();
          state.renderContent(node);
          state.ensureNewLine();
          state.write(":::");
          state.closeBlock(node);
        },
      },
    },
  },
});

export const packedHighlightExtension = defineMarkdownEditorExtension({
  name: "@pack-smoke/highlight",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  schema: {
    marks: [{
      name: "pack_highlight",
      spec: {
        parseDOM: [{ tag: "mark" }],
        toDOM: () => ["mark", 0],
      },
    }],
  },
  markdown: {
    tokenizerRules: [{
      id: "delimiter",
      phase: "inline",
      before: ["@markora/foundation/inline/emphasis"],
      createRule: ({ token }) => createHighlightRule(
        token("delimiter_open"),
        token("delimiter_close"),
      ),
    }],
    parserTokens: { delimiter: { mark: "pack_highlight" } },
    serializer: {
      marks: {
        pack_highlight: {
          open: "==",
          close: "==",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    },
  },
});
`);

writeFileSync(join(smokeAppDir, "src/minimal.js"), `import {
  createEditor,
  createMinimalMarkdownEditorPreset,
} from "markora/minimal";
import {
  packedCalloutExtension,
  packedHighlightExtension,
} from "./extensions";
import "markora/minimal.css";

export const packedExternalExtensions = [
  packedCalloutExtension,
  packedHighlightExtension,
];

export function mountMinimalEditor(element) {
  return createEditor({
    element,
    extensions: packedExternalExtensions,
    markdown: ":::note\\nPacked ==extension== consumer.\\n:::",
  });
}

export const packedMinimalSurface = [
  typeof createEditor,
  typeof createMinimalMarkdownEditorPreset,
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/api.ts"), `import {
  MarkdownEditorDestroyedError,
  createEditor,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
  type CreateEditorOptions,
  type MarkdownEditorActiveNode,
  type MarkdownEditorChangeMode,
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorCodeBlockOptions,
  type MarkdownEditorCommands,
  type MarkdownEditorEventMap,
  type MarkdownEditorExtensionOrigin,
  type MarkdownEditorHeadingLevel,
  type MarkdownEditorState,
  type MarkdownEditorStateEvent,
  type MarkdownEditorTableAlignment,
  type MarkdownEditorTableInsertOptions,
  type UpdateEditorOptions,
} from "markora";
import {
  createEditor as createMinimalEditor,
  type MarkdownEditorActiveNode as MinimalMarkdownEditorActiveNode,
  type MarkdownEditorChangeMode as MinimalMarkdownEditorChangeMode,
  type MarkdownEditorCodeBlockOptions as MinimalMarkdownEditorCodeBlockOptions,
  type MarkdownEditorCommands as MinimalMarkdownEditorCommands,
  type MarkdownEditorHeadingLevel as MinimalMarkdownEditorHeadingLevel,
  type MarkdownEditorState as MinimalMarkdownEditorState,
  type MarkdownEditorStateEvent as MinimalMarkdownEditorStateEvent,
  type MarkdownEditorTableAlignment as MinimalMarkdownEditorTableAlignment,
  type MarkdownEditorTableInsertOptions as MinimalMarkdownEditorTableInsertOptions,
} from "markora/minimal";
import {
  MARKORA_EXTENSION_API_VERSION,
  defineMarkdownEditorExtension,
  type AnyMarkdownEditorExtension,
} from "markora/extension-api";
import {
  packedCalloutExtension,
  packedHighlightExtension,
} from "./extensions";

declare const element: HTMLElement;

const editor = createEditor({
  ariaLabel: "Packed editor",
  autofocus: true,
  editable: true,
  element,
  initialSelection: "end",
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
  onTransaction(transaction, view, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void transaction;
    void view;
    void origin;
  },
  placeholder: "Start writing",
  resources: {
    links: { allowedProtocols: ["https:", "acme:"] },
    images: { maxDataUrlBytes: 4096, referrerPolicy: "no-referrer" },
    resolveUrl: ({ url }) => url,
    openUrl: ({ url }) => { void url; },
    loadImage: ({ url }) => ({ src: url }),
    assets: {
      allowedMimeTypes: ["image/*"],
      maxFileBytes: 4096,
      maxFiles: 2,
      upload: ({ file, reportProgress }) => {
        reportProgress(1);
        return { kind: "image", alt: file.name, url: "/packed.png" };
      },
    },
  },
});
const externalExtensions: readonly AnyMarkdownEditorExtension[] = [
  packedCalloutExtension,
  packedHighlightExtension,
];
const minimalEditor = createMinimalEditor({
  element,
  extensions: externalExtensions,
  markdown: ":::note\\nPacked ==extension== consumer.\\n:::",
  onChangeMode: "idle",
  resources: { links: { allowRelative: false } },
});
const headingLevel: MarkdownEditorHeadingLevel = 3;
const codeBlockOptions: MarkdownEditorCodeBlockOptions = { language: "ts" };
const tableAlignment: MarkdownEditorTableAlignment = null;
const tableInsertOptions: MarkdownEditorTableInsertOptions = { columns: 3, rows: 2 };
const activeNode: MarkdownEditorActiveNode = "paragraph";
const idleChangeMode: MarkdownEditorChangeMode = "idle";
const minimalIdleChangeMode: MinimalMarkdownEditorChangeMode = idleChangeMode;
const minimalHeadingLevel: MinimalMarkdownEditorHeadingLevel = headingLevel;
const minimalCodeBlockOptions: MinimalMarkdownEditorCodeBlockOptions = codeBlockOptions;
const minimalTableAlignment: MinimalMarkdownEditorTableAlignment = tableAlignment;
const minimalTableInsertOptions: MinimalMarkdownEditorTableInsertOptions = tableInsertOptions;
const minimalActiveNode: MinimalMarkdownEditorActiveNode = activeNode;
const rootCommands: MarkdownEditorCommands = editor.commands;
const rootState: MarkdownEditorState = editor.state;
const minimalCommands: MinimalMarkdownEditorCommands = minimalEditor.commands;
const minimalState: MinimalMarkdownEditorState = minimalEditor.state;

function exerciseStructuralSurface(
  commands: MarkdownEditorCommands,
  state: MarkdownEditorState,
  values: {
    activeNode: MarkdownEditorActiveNode;
    codeBlockOptions: MarkdownEditorCodeBlockOptions;
    headingLevel: MarkdownEditorHeadingLevel;
    tableAlignment: MarkdownEditorTableAlignment;
    tableInsertOptions: MarkdownEditorTableInsertOptions;
  },
) {
  const commandResults: boolean[] = [
    commands.setParagraph(),
    commands.setHeading(values.headingLevel),
    commands.toggleBlockquote(),
    commands.toggleBulletList(),
    commands.toggleOrderedList(),
    commands.sinkListItem(),
    commands.liftListItem(),
    commands.toggleTaskList(),
    commands.setTaskChecked(true),
    commands.insertHardBreak(),
    commands.insertHorizontalRule(),
    commands.setCodeBlock(values.codeBlockOptions),
    commands.insertTable(values.tableInsertOptions),
    commands.addTableRow(),
    commands.addTableColumn(),
    commands.deleteTableRow(),
    commands.deleteTableColumn(),
    commands.setTableColumnAlignment(values.tableAlignment),
    commands.deleteTable(),
  ];
  const canResults: boolean[] = [
    state.can.removeLink(),
    state.can.removeImage(),
    state.can.setParagraph(),
    state.can.setHeading(values.headingLevel),
    state.can.toggleBlockquote(),
    state.can.toggleBulletList(),
    state.can.toggleOrderedList(),
    state.can.sinkListItem(),
    state.can.liftListItem(),
    state.can.toggleTaskList(),
    state.can.setTaskChecked(false),
    state.can.insertHardBreak(),
    state.can.insertHorizontalRule(),
    state.can.setCodeBlock(values.codeBlockOptions),
    state.can.insertTable(values.tableInsertOptions),
    state.can.addTableRow(),
    state.can.addTableColumn(),
    state.can.deleteTableRow(),
    state.can.deleteTableColumn(),
    state.can.setTableColumnAlignment(values.tableAlignment),
    state.can.deleteTable(),
  ];
  const activeResults: boolean[] = [
    state.isActive.node(values.activeNode),
    state.isActive.paragraph(),
    state.isActive.heading(),
    state.isActive.heading(values.headingLevel),
    state.isActive.blockquote(),
    state.isActive.bulletList(),
    state.isActive.orderedList(),
    state.isActive.taskList(),
    state.isActive.taskChecked(),
    state.isActive.taskChecked(false),
    state.isActive.hardBreak(),
    state.isActive.horizontalRule(),
    state.isActive.codeBlock(),
    state.isActive.codeBlock(values.codeBlockOptions),
    state.isActive.table(),
    state.isActive.tableColumnAlignment(values.tableAlignment),
  ];
  void commandResults;
  void canResults;
  void activeResults;
}

exerciseStructuralSurface(rootCommands, rootState, {
  activeNode,
  codeBlockOptions,
  headingLevel,
  tableAlignment,
  tableInsertOptions,
});
exerciseStructuralSurface(minimalCommands, minimalState, {
  activeNode: minimalActiveNode,
  codeBlockOptions: minimalCodeBlockOptions,
  headingLevel: minimalHeadingLevel,
  tableAlignment: minimalTableAlignment,
  tableInsertOptions: minimalTableInsertOptions,
});
const staticDefinition = defineMarkdownEditorExtension({
  name: "@pack-smoke/static",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
});
const legacyCreateOptions: CreateEditorOptions = {
  element,
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, view) {
    void transaction;
    void view;
  },
};
const options: UpdateEditorOptions = {
  editable: false,
  onChangeMode: idleChangeMode,
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, view) {
    void transaction;
    void view;
  },
  placeholder: null,
};
editor.updateOptions(options);
const unsubscribe = editor.subscribe("selection", (event: MarkdownEditorEventMap["selection"]) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  event.selection.kind satisfies "all" | "managed-block" | "node" | "other" | "table-cell" | "text";
  void origin;
});
const unsubscribeUpdate = editor.subscribe("update", (event: MarkdownEditorEventMap["update"]) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void origin;
});
const unsubscribeState = editor.subscribe("state", (event: MarkdownEditorStateEvent) => {
  const docChanged: boolean = event.docChanged;
  const selectionChanged: boolean = event.selectionChanged;
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void docChanged;
  void selectionChanged;
  void origin;
});
const unsubscribeMinimalState = minimalEditor.subscribe("state", (event: MinimalMarkdownEditorStateEvent) => {
  const docChanged: boolean = event.docChanged;
  const selectionChanged: boolean = event.selectionChanged;
  void docChanged;
  void selectionChanged;
});
const unsubscribeAsset = editor.subscribe("asset", (event: MarkdownEditorEventMap["asset"]) => {
  const status = event.upload.status;
  void status;
});
editor.assets.getUploads();
const reconciled: boolean = editor.commands.reconcileMarkdown("# Reconciled");
editor.commands.resetMarkdown("# Reset", { emitChange: true });
editor.commands.setMarkdown("# Compatibility reset");
const extensionOrigin: MarkdownEditorExtensionOrigin = "extension:pack-smoke";
const taggedTransaction = setMarkdownEditorTransactionOrigin(
  editor.view.state.tr,
  extensionOrigin,
);
const transactionOrigin: MarkdownEditorChangeOrigin | undefined =
  getMarkdownEditorTransactionOrigin(taggedTransaction);
unsubscribe();
unsubscribeUpdate();
unsubscribeState();
unsubscribeMinimalState();
unsubscribeAsset();
editor.focus("start");
editor.blur();
editor.destroy();
minimalEditor.destroy();
MARKORA_EXTENSION_API_VERSION satisfies "1.0.0";
void new MarkdownEditorDestroyedError("focus the editor");
void staticDefinition;
void legacyCreateOptions;
void minimalIdleChangeMode;
void reconciled;
void transactionOrigin;
`);

writeFileSync(join(smokeAppDir, "tsconfig.json"), `${JSON.stringify({
  compilerOptions: {
    lib: ["DOM", "ES2022"],
    module: "ESNext",
    moduleResolution: "Bundler",
    noEmit: true,
    strict: true,
    target: "ES2022",
  },
  include: ["src/api.ts"],
}, null, 2)}\n`);

currentPhase = "consumer-typecheck";
run("node", [tscCliPath, "-p", "tsconfig.json"], { cwd: smokeAppDir });
currentPhase = "node-import-smoke";
run("node", ["--input-type=module", "-e", `
  const extensionApi = await import("markora/extension-api");
  const minimal = await import("markora/minimal");
  if (typeof extensionApi.defineMarkdownEditorExtension !== "function") {
    throw new Error("defineMarkdownEditorExtension export missing");
  }
  if (typeof minimal.createEditor !== "function") {
    throw new Error("markora/minimal createEditor export missing");
  }
`], { cwd: smokeAppDir });

currentPhase = "bundle-configuration";
writeBundleConfig("root", "./src/root.js");
writeBundleConfig("minimal", "./src/minimal.js");
currentPhase = "root-bundle-build";
run("node", [viteCliPath, "build", "--config", "vite.root.config.mjs"], { cwd: smokeAppDir });
currentPhase = "minimal-bundle-build";
run("node", [viteCliPath, "build", "--config", "vite.minimal.config.mjs"], { cwd: smokeAppDir });

currentPhase = "bundle-validation";
const rootBundleReport = readBundleReport("root");
const minimalBundleReport = readBundleReport("minimal");
const rootBundleMeasurement = measureBundleGraph(rootBundleReport);
const minimalBundleMeasurement = measureBundleGraph(minimalBundleReport);
assertBundleIsolation(rootBundleReport, minimalBundleReport);
assertPackedProvenance(
  rootBundleReport,
  minimalBundleReport,
  rootBundleMeasurement,
  minimalBundleMeasurement,
);
const minimalEntryChunk = minimalBundleReport.chunks.find((chunk) => chunk.isEntry);

if (!minimalEntryChunk) {
  throw new Error("The markora/minimal bundle did not emit an entry chunk.");
}

const minimalEntrySpecifier = `./dist/minimal/${minimalEntryChunk.fileName}`;
currentPhase = "minimal-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(minimalEntrySpecifier)});
  const names = consumer.packedExternalExtensions?.map((extension) => extension.name);
  if (names?.join(":") !== "@pack-smoke/callout:@pack-smoke/highlight") {
    throw new Error("Packed external extensions did not execute through the public API");
  }
`], { cwd: smokeAppDir });

const measurements = Object.freeze({
  minimal: minimalBundleMeasurement,
  root: rootBundleMeasurement,
});
availableMeasurements = measurements;
printBundleMeasurements(rootBundleMeasurement, minimalBundleMeasurement);
currentPhase = "budget-evaluation";
const budgetConfig = loadBudgetConfig(commandOptions.budgetPath);
const evaluations = evaluateBundleBudgets(budgetConfig, measurements);
const budgetSummary = reportBudgetEvaluations(evaluations, {
  title: "Markora packed bundle budget",
});
const budgetResult = Object.freeze({
  evaluations: Object.freeze(evaluations),
  failures: budgetSummary.failures,
  passed: budgetSummary.passed,
  warnings: budgetSummary.warnings,
});
currentPhase = "report-writing";
reportWritten = Boolean(writeMeasurementReport({
  budgetConfigPath: commandOptions.budgetPath,
  budgetResult,
  corePackage,
  measurements,
  reportPath: commandOptions.reportPath,
  uiPackage,
}));

if (!budgetResult.passed) {
  throw new Error(`${budgetResult.failures.length} packed bundle budget(s) exceeded their failure ceilings.`);
}

currentPhase = "complete";
console.log(`Pack smoke test passed in ${smokeAppDir}`);
}

try {
  main();
} catch (error) {
  if (!reportWritten) {
    try {
      reportWritten = writeFailureReport(error);
    } catch (reportError) {
      console.error("Could not write failed packed bundle report:", reportError);
    }
  }
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = error instanceof CommandExecutionError ? error.exitCode : 1;
}
