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
import { fileURLToPath, pathToFileURL } from "node:url";
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
const extensionBundleSpecs = Object.freeze([
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-alert",
      ".mdw-alert__body",
    ]),
    graphName: "alerts",
    label: "Alerts",
    packageName: "markora-extension-alerts",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([".mdw-frontmatter"]),
    graphName: "frontmatter",
    label: "Front matter",
    packageName: "markora-extension-frontmatter",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-diagram",
      ".mdw-diagram__preview",
    ]),
    graphName: "diagrams",
    label: "Diagrams",
    packageName: "markora-extension-diagrams",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-footnote-reference",
      ".mdw-footnote-definition",
    ]),
    graphName: "footnotes",
    label: "Footnotes",
    packageName: "markora-extension-footnotes",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-html--block",
      ".mdw-html__preview",
    ]),
    graphName: "html",
    label: "HTML",
    packageName: "markora-extension-html",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-math--inline",
      ".mdw-math--block",
    ]),
    graphName: "math",
    label: "Math",
    packageName: "markora-extension-math",
  }),
  Object.freeze({
    cssSelectors: Object.freeze([
      ".mdw-toc",
      ".mdw-toc__entry",
    ]),
    graphName: "toc",
    label: "TOC",
    packageName: "markora-extension-toc",
  }),
]);
const bundleGraphNames = Object.freeze([
  "root",
  "minimal",
  ...extensionBundleSpecs.map(({ graphName }) => graphName),
  "allSeven",
]);
const forbiddenRendererEngineFragments = Object.freeze([
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
]);

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
    if (
      entry === "markora"
      || entry === "markora-ui"
      || entry === "markora-renderers"
      || entry === "demo"
      || entry === ".bin"
      || entry.startsWith("markora-extension-")
    ) {
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

function assertPackedPackage(packageInfo, extensionCssContract) {
  const packageRoot = join(smokeNodeModulesDir, packageInfo.name);
  const packageJson = JSON.parse(readFileSync(
    join(packageRoot, "package.json"),
    "utf8",
  ));

  if (packageJson.name !== packageInfo.name || packageJson.version !== packageInfo.version) {
    throw new Error(
      `Packed ${packageInfo.name} provenance mismatch: expected ${packageInfo.version}, `
      + `received ${packageJson.name}@${packageJson.version}.`,
    );
  }

  if (packageInfo.name === "markora") {
    const themesPath = join(packageRoot, "dist", "themes.css");

    if (
      packageJson.exports?.["./themes.css"] !== "./dist/themes.css"
      || !packageJson.sideEffects?.includes("./dist/themes.css")
      || !existsSync(themesPath)
    ) {
      throw new Error("Packed markora omitted the public themes.css asset contract.");
    }

    const themes = readFileSync(themesPath, "utf8");
    if (packageJson.exports?.["./themes"]?.import !== "./dist/themes.js"
      || !existsSync(join(packageRoot, "dist/themes.js"))
      || !existsSync(join(packageRoot, "dist/themes.d.ts"))) {
      throw new Error("Packed markora omitted the optional theme API.");
    }
    for (const requiredTheme of ["light", "dark", "auto", "contrast", "github", "newsprint", "sepia", "night"]) {
      if (!themes.includes(`[data-mdw-theme=\"${requiredTheme}\"]`)) {
        throw new Error(`Packed themes.css omitted the ${requiredTheme} reference theme.`);
      }
    }
  } else if (packageInfo.name.startsWith("markora-extension-")) {
    const requiredFiles = [
      "LICENSE",
      "README.md",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/styles.css",
    ];
    const missingFiles = requiredFiles.filter((fileName) => (
      !existsSync(join(packageRoot, fileName))
    ));

    if (missingFiles.length > 0) {
      throw new Error(
        `Packed ${packageInfo.name} omitted required files: ${missingFiles.join(", ")}.`,
      );
    }

    if (
      packageJson.type !== "module"
      || packageJson.exports?.["."]?.types !== "./dist/index.d.ts"
      || packageJson.exports?.["."]?.import !== "./dist/index.js"
      || packageJson.exports?.["./styles.css"] !== "./dist/styles.css"
      || JSON.stringify(packageJson.sideEffects) !== JSON.stringify(["./dist/styles.css"])
      || packageJson.peerDependencies?.markora !== "^0.1.0"
      || packageJson.license !== "MIT"
    ) {
      throw new Error(`Packed ${packageInfo.name} metadata contract is incomplete.`);
    }

    const leakedDirectories = ["src", "test", "test-d", "scripts"].filter((entry) => (
      existsSync(join(packageRoot, entry))
    ));
    if (leakedDirectories.length > 0) {
      throw new Error(
        `Packed ${packageInfo.name} leaked development directories: ${leakedDirectories.join(", ")}.`,
      );
    }

    const styles = readFileSync(join(packageRoot, "dist/styles.css"), "utf8");
    if (
      !extensionCssContract
      || !styles.includes(extensionCssContract.rootSelector)
      || !styles.includes(extensionCssContract.tokenPrefix)
    ) {
      throw new Error(`Packed ${packageInfo.name} omitted its public CSS token contract.`);
    }
  }
}

function assertPackedProvenance(
  rootReport,
  minimalReport,
  rootMeasurement,
  minimalMeasurement,
  extensionBundles,
) {
  assertPackedModule(rootReport, "/node_modules/markora/dist/index.js", "Packed markora root entry");
  assertPackedModule(rootReport, "/node_modules/markora/dist/styles.css", "Packed markora stylesheet");
  assertPackedModule(rootReport, "/node_modules/markora-ui/dist/index.js", "Packed markora-ui entry");
  assertPackedModule(rootReport, "/node_modules/markora-ui/dist/styles.css", "Packed markora-ui stylesheet");
  assertPackedModule(minimalReport, "/node_modules/markora/dist/minimal.js", "Packed markora minimal entry");
  assertPackedModule(minimalReport, "/node_modules/markora/dist/minimal.css", "Packed minimal stylesheet");
  for (const { measurement, report, spec } of extensionBundles) {
    assertPackedModule(
      report,
      `/node_modules/${spec.packageName}/dist/index.js`,
      `Packed ${spec.label.toLowerCase()} extension entry`,
    );
    assertPackedModule(
      report,
      `/node_modules/${spec.packageName}/dist/styles.css`,
      `Packed ${spec.label.toLowerCase()} extension stylesheet`,
    );

    if (
      measurement.css.fileCount !== 1
      || measurement.initialJs.chunkCount !== 1
      || measurement.lazyJs.chunkCount !== 0
      || measurement.totalJs.chunkCount !== 1
    ) {
      throw new Error(
        `Packed ${spec.label.toLowerCase()} must emit one explicit stylesheet `
        + "and no lazy JavaScript chunks.",
      );
    }

    for (const selector of spec.cssSelectors) {
      if (!report.cssSource.includes(selector)) {
        throw new Error(
          `Packed ${spec.label.toLowerCase()} stylesheet omitted public selector ${selector}.`,
        );
      }
    }
  }

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
    ".mdw-host .mdw-managed-block-cursor",
    ".mdw-host .mdw-managed-block-cursor-before:before",
    ".mdw-host .mdw-managed-block-cursor-after:after",
  ]) {
    if (!minimalReport.cssSource.includes(selector)) {
      throw new Error(`Packed minimal stylesheet omitted managed block selector ${selector}.`);
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
    throw new Error("The root bundle did not resolve the packed markora entry.");
  }

  const rootStaticCodeMirrorModules = rootReport.staticModuleIds.filter((moduleId) => (
    moduleIdIncludes(moduleId, "/node_modules/@codemirror/")
    || moduleIdIncludes(moduleId, "/node_modules/@lezer/")
    || moduleIdIncludes(moduleId, "/node_modules/markora/dist/activeCodeBlockView.js")
  ));

  if (rootStaticCodeMirrorModules.length > 0) {
    throw new Error(`The root entry eagerly included CodeMirror runtime modules:\n${rootStaticCodeMirrorModules
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
      `The root bundle omitted lazy CodeMirror runtime modules: ${missingLazyCodeMirrorFragments.join(", ")}.`,
    );
  }

  for (const externalExtensionName of ["@pack-smoke/callout", "@pack-smoke/highlight"]) {
    if (!minimalReport.chunkSource.includes(externalExtensionName)) {
      throw new Error(`The minimal bundle omitted external extension ${externalExtensionName}.`);
    }
  }

  for (const report of [rootReport, minimalReport]) {
    const leakedModules = [
      ...report.staticModuleIds,
      ...report.emittedModuleIds,
    ].filter((moduleId) => moduleIdIncludes(
      moduleId,
      "/node_modules/markora-extension-",
    ));

    const leakedSelectors = extensionBundleSpecs.flatMap(({ cssSelectors }) => (
      cssSelectors.filter((selector) => report.cssSource.includes(selector))
    ));

    if (leakedModules.length > 0 || leakedSelectors.length > 0) {
      throw new Error(
        `${report.label} included optional advanced-syntax package code or CSS by default.`,
      );
    }
  }

}

function assertExtensionBundleIsolation(report, spec) {
  const forbiddenFragments = [
    "/node_modules/markora/dist/index.js",
    "/node_modules/markora/dist/minimal.js",
    "/node_modules/markora-ui/",
    "/node_modules/@codemirror/",
    "/node_modules/@lezer/",
    "/node_modules/js-yaml/",
    "/node_modules/yaml/",
    ...forbiddenRendererEngineFragments,
  ];
  const moduleIds = [...report.staticModuleIds, ...report.emittedModuleIds];
  const leaks = forbiddenFragments.flatMap((fragment) => moduleIds
    .filter((moduleId) => moduleIdIncludes(moduleId, fragment))
    .map((moduleId) => ({ fragment, moduleId })));

  if (leaks.length > 0) {
    throw new Error(`${spec.label} feature bundle reached forbidden modules:\n${leaks
      .map(({ fragment, moduleId }) => `- ${fragment}: ${moduleId}`)
      .join("\n")}`);
  }

  const workspacePackagePrefixes = [
    resolve(rootDir, "packages"),
    realpathSync(resolve(rootDir, "packages")),
  ].map((path) => `${normalizeModuleId(path)}/`);
  const workspaceSourceLeaks = moduleIds.filter((moduleId) => (
    workspacePackagePrefixes.some((prefix) => normalizeModuleId(moduleId).startsWith(prefix))
  ));
  if (workspaceSourceLeaks.length > 0) {
    throw new Error(
      `${spec.label} feature bundle reached workspace package source:\n${workspaceSourceLeaks.join("\n")}`,
    );
  }

  const siblingExtensions = moduleIds.filter((moduleId) => (
    moduleIdIncludes(moduleId, "/node_modules/markora-extension-")
    && !moduleIdIncludes(
      moduleId,
      `/node_modules/${spec.packageName}/`,
    )
  ));
  if (siblingExtensions.length > 0) {
    throw new Error(
      `${spec.label} feature bundle reached sibling optional packages:\n`
      + siblingExtensions.join("\n"),
    );
  }

  if (!report.staticModuleIds.some((moduleId) => moduleIdIncludes(
    moduleId,
    "/node_modules/markora/dist/extension-api.js",
  ))) {
    throw new Error(`${spec.label} feature bundle omitted the packed extension API entry.`);
  }
}

function assertAllSevenBundle(report, measurement) {
  const moduleIds = [...report.staticModuleIds, ...report.emittedModuleIds];
  const forbiddenFragments = [
    "/node_modules/markora/dist/minimal.js",
    "/node_modules/markora-ui/",
    "/node_modules/js-yaml/",
    "/node_modules/yaml/",
    ...forbiddenRendererEngineFragments,
  ];
  const leaks = forbiddenFragments.flatMap((fragment) => moduleIds
    .filter((moduleId) => moduleIdIncludes(moduleId, fragment))
    .map((moduleId) => ({ fragment, moduleId })));

  if (leaks.length > 0) {
    throw new Error(`All-seven feature bundle reached forbidden modules:\n${leaks
      .map(({ fragment, moduleId }) => `- ${fragment}: ${moduleId}`)
      .join("\n")}`);
  }

  const workspacePackagePrefixes = [
    resolve(rootDir, "packages"),
    realpathSync(resolve(rootDir, "packages")),
  ].map((path) => `${normalizeModuleId(path)}/`);
  const workspaceSourceLeaks = moduleIds.filter((moduleId) => (
    workspacePackagePrefixes.some((prefix) => normalizeModuleId(moduleId).startsWith(prefix))
  ));
  if (workspaceSourceLeaks.length > 0) {
    throw new Error(
      `All-seven feature bundle reached workspace package source:\n${workspaceSourceLeaks.join("\n")}`,
    );
  }

  if (
    measurement.css.fileCount !== 1
    || measurement.initialJs.chunkCount < 1
    || measurement.totalJs.chunkCount < measurement.initialJs.chunkCount
  ) {
    throw new Error(
      "The all-seven root consumer must emit one production stylesheet and a valid JavaScript graph.",
    );
  }

  assertPackedModule(
    report,
    "/node_modules/markora/dist/index.js",
    "Packed root entry in the all-seven consumer",
  );
  assertPackedModule(
    report,
    "/node_modules/markora/dist/styles.css",
    "Packed root stylesheet in the all-seven consumer",
  );
  for (const spec of extensionBundleSpecs) {
    assertPackedModule(
      report,
      `/node_modules/${spec.packageName}/dist/index.js`,
      `Packed ${spec.label.toLowerCase()} entry in the all-seven root consumer`,
    );
    assertPackedModule(
      report,
      `/node_modules/${spec.packageName}/dist/styles.css`,
      `Packed ${spec.label.toLowerCase()} stylesheet in the all-seven root consumer`,
    );
    for (const selector of spec.cssSelectors) {
      if (!report.cssSource.includes(selector)) {
        throw new Error(
          `The all-seven root stylesheet omitted public selector ${selector}.`,
        );
      }
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

function printBundleMeasurements(measurements) {
  console.log("Packed production bundle graph (per-file gzip level 9):");
  printBundleMeasurement("markora", measurements.root);
  printBundleMeasurement("markora/minimal", measurements.minimal);
  for (const spec of extensionBundleSpecs) {
    printBundleMeasurement(spec.packageName, measurements[spec.graphName]);
  }
  printBundleMeasurement("root + all seven advanced-syntax packages", measurements.allSeven);
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

  for (const graphName of bundleGraphNames) {
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
    ...Object.fromEntries(readdirSync(join(rootDir, "scripts/pack-smoke-consumer")).sort().map(name => {
      const path = `scripts/pack-smoke-consumer/${name}`;
      return [path, sha256File(join(rootDir, path))];
    })),
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
  measurements,
  reportPath,
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
      packages: availablePackages,
    },
    invariants: {
      initialAndLazyPartitionTotal: true,
      rootInitialExcludesCodeMirror: true,
      rootLazyIncludesCodeMirror: true,
      minimalExcludesCodeMirror: true,
      minimalHasNoLazyChunks: measurements.minimal.lazyJs.chunkCount === 0,
      optionalExtensionsAbsentFromBaseline: true,
      frontmatterHasNoLazyChunks: measurements.frontmatter.lazyJs.chunkCount === 0,
      frontmatterHasNoRendererEngine: true,
      diagramsHasNoLazyChunks: measurements.diagrams.lazyJs.chunkCount === 0,
      diagramsHasNoRendererEngine: true,
      footnotesHasNoLazyChunks: measurements.footnotes.lazyJs.chunkCount === 0,
      footnotesHasNoRendererEngine: true,
      htmlHasNoLazyChunks: measurements.html.lazyJs.chunkCount === 0,
      htmlHasNoRendererEngine: true,
      mathHasNoLazyChunks: measurements.math.lazyJs.chunkCount === 0,
      mathHasNoBundledRendererEngine: true,
      alertsHasNoLazyChunks: measurements.alerts.lazyJs.chunkCount === 0,
      alertsHasNoRendererEngine: true,
      tocHasNoLazyChunks: measurements.toc.lazyJs.chunkCount === 0,
      tocHasNoRendererEngine: true,
      allSevenUsesRootEntry: true,
      allSevenContainsEveryOptionalPackage: true,
      allSevenHasNoRendererEngine: true,
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
currentPhase = "frontmatter-package";
const frontmatterPackage = packPackage(join(
  rootDir,
  "packages/extension-frontmatter",
));
rememberPackage(frontmatterPackage);
currentPhase = "footnotes-package";
const footnotesPackage = packPackage(join(
  rootDir,
  "packages/extension-footnotes",
));
rememberPackage(footnotesPackage);
currentPhase = "diagrams-package";
const diagramsPackage = packPackage(join(
  rootDir,
  "packages/extension-diagrams",
));
rememberPackage(diagramsPackage);
currentPhase = "html-package";
const htmlPackage = packPackage(join(
  rootDir,
  "packages/extension-html",
));
rememberPackage(htmlPackage);
currentPhase = "math-package";
const mathPackage = packPackage(join(
  rootDir,
  "packages/extension-math",
));
rememberPackage(mathPackage);
currentPhase = "alerts-package";
const alertsPackage = packPackage(join(
  rootDir,
  "packages/extension-alerts",
));
rememberPackage(alertsPackage);
currentPhase = "toc-package";
const tocPackage = packPackage(join(
  rootDir,
  "packages/extension-toc",
));
rememberPackage(tocPackage);
currentPhase = "components-package";
const componentsPackage = packPackage(join(rootDir, "packages/extension-components"));
rememberPackage(componentsPackage);
currentPhase = "renderers-package";
const renderersPackage = packPackage(join(rootDir, "packages/renderers"));
rememberPackage(renderersPackage);

currentPhase = "packed-dependency-isolation";
copyWorkspaceDependencies();
unpackPackage(corePackage.name, corePackage.tarballPath);
unpackPackage(uiPackage.name, uiPackage.tarballPath);
unpackPackage(frontmatterPackage.name, frontmatterPackage.tarballPath);
unpackPackage(footnotesPackage.name, footnotesPackage.tarballPath);
unpackPackage(diagramsPackage.name, diagramsPackage.tarballPath);
unpackPackage(htmlPackage.name, htmlPackage.tarballPath);
unpackPackage(mathPackage.name, mathPackage.tarballPath);
unpackPackage(alertsPackage.name, alertsPackage.tarballPath);
unpackPackage(tocPackage.name, tocPackage.tarballPath);
unpackPackage(componentsPackage.name, componentsPackage.tarballPath);
unpackPackage(renderersPackage.name, renderersPackage.tarballPath);
assertPackedPackage(renderersPackage);
const rendererRoot = join(smokeNodeModulesDir, renderersPackage.name);
for (const file of ["index.js", "index.d.ts", "styles.css", "plantuml-frame.js", "math-engine.js", "mermaid-engine.js"]) {
  if (!existsSync(join(rendererRoot, "dist", file))) throw new Error(`Packed renderers omitted ${file}.`);
}
run("node", ["--check", join(rendererRoot, "dist/plantuml-frame.js")]);
// Importing/constructing the packed API in Node must not load DOM-based engines.
run("node", ["--input-type=module", "-e", `
  const { createRenderers, createLazyRenderer } = await import("markora-renderers");
  const registry = createRenderers();
  if (typeof registry.math !== "function" || typeof registry.diagrams.plantuml !== "function"
    || typeof registry.diagrams.mermaid !== "function" || typeof createLazyRenderer !== "function") {
    throw new Error("Packed renderer API is incomplete.");
  }
  registry.destroy();
`], { cwd: smokeAppDir });
assertPackedPackage(corePackage);
assertPackedPackage(uiPackage);
assertPackedPackage(frontmatterPackage, {
  rootSelector: ".mdw-frontmatter",
  tokenPrefix: "--mdw-frontmatter-",
});
assertPackedPackage(footnotesPackage, {
  rootSelector: ".mdw-footnote-reference",
  tokenPrefix: "--mdw-footnotes-",
});
assertPackedPackage(diagramsPackage, {
  rootSelector: ".mdw-diagram",
  tokenPrefix: "--mdw-diagram-",
});
assertPackedPackage(htmlPackage, {
  rootSelector: ".mdw-html",
  tokenPrefix: "--mdw-html-",
});
assertPackedPackage(mathPackage, {
  rootSelector: ".mdw-math--inline",
  tokenPrefix: "--mdw-math-",
});
assertPackedPackage(alertsPackage, {
  rootSelector: ".mdw-alert",
  tokenPrefix: "--mdw-alert-",
});
assertPackedPackage(tocPackage, {
  rootSelector: ".mdw-toc",
  tokenPrefix: "--mdw-toc-",
});
assertPackedPackage(componentsPackage, {
  rootSelector: ".mdw-component",
  tokenPrefix: "--mdw-color-",
});

currentPhase = "consumer-generation";
writeFileSync(join(smokeAppDir, "package.json"), `${JSON.stringify({
  name: "markora-pack-smoke",
  private: true,
  type: "module",
  packageManager: rootPackageJson.packageManager,
}, null, 2)}\n`);

cpSync(join(rootDir, "scripts/pack-smoke-consumer"), join(smokeAppDir, "src"), { recursive: true });
writeFileSync(join(smokeAppDir, "src/environment.mjs"),
  `export const jsdomUrl = ${JSON.stringify(pathToFileURL(resolve(rootDir, "node_modules/jsdom/lib/api.js")).href)};\n`);

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
  const alerts = await import("markora-extension-alerts");
  const frontmatter = await import("markora-extension-frontmatter");
  const diagrams = await import("markora-extension-diagrams");
  const footnotes = await import("markora-extension-footnotes");
  const html = await import("markora-extension-html");
  const math = await import("markora-extension-math");
  const toc = await import("markora-extension-toc");
  const minimal = await import("markora/minimal");
  if (typeof extensionApi.defineMarkdownEditorExtension !== "function") {
    throw new Error("defineMarkdownEditorExtension export missing");
  }
  if (typeof extensionApi.sliceMarkdownEditorOriginalSourceLines !== "function") {
    throw new Error("sliceMarkdownEditorOriginalSourceLines export missing");
  }
  if (typeof extensionApi.closeHistory !== "function") {
    throw new Error("closeHistory export missing");
  }
  if (
    typeof alerts.createAlertsExtension !== "function"
    || !Object.isFrozen(alerts.defaultAlertsMessages)
    || !Object.isFrozen(alerts.alertKinds)
  ) {
    throw new Error("alerts package Node ESM surface is incomplete");
  }
  const alertsDefinition = alerts.createAlertsExtension({
    messages: { toggleAlert: "Toggle packed alert" },
  });
  if (
    alertsDefinition.name !== "markora-extension-alerts"
    || alerts.alertKinds.join(":") !== "note:tip:important:warning:caution"
    || alerts.defaultAlertsMessages.alertLabel("note", "Note") !== "Note alert"
    || typeof alerts.defaultAlertsMessages.invalidDocumentDiagnostic("danger") !== "string"
  ) {
    throw new Error("alerts package factory returned the wrong identity, kinds, or messages");
  }
  if (
    typeof frontmatter.createFrontmatterExtension !== "function"
    || !Object.isFrozen(frontmatter.defaultFrontmatterMessages)
  ) {
    throw new Error("front matter package Node ESM surface is incomplete");
  }
  const frontmatterDefinition = frontmatter.createFrontmatterExtension();
  if (frontmatterDefinition.name !== "markora-extension-frontmatter") {
    throw new Error("front matter package factory returned the wrong identity");
  }
  if (
    typeof diagrams.createDiagramsExtension !== "function"
    || !Object.isFrozen(diagrams.defaultDiagramMessages)
    || !Object.isFrozen(diagrams.diagramDiagnosticCodes)
    || !Object.isFrozen(diagrams.diagramKinds)
    || !Object.isFrozen(diagrams.diagramRenderErrorCodes)
    || diagrams.DIAGRAM_MAX_CONCURRENT_RENDERS !== 4
    || diagrams.DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT !== 64
    || diagrams.DIAGRAM_MAX_RENDERED_DEPTH !== 128
    || diagrams.DIAGRAM_MAX_RENDERED_NODES !== 4096
    || diagrams.DIAGRAM_MAX_RENDERED_OUTPUT_BYTES !== 1048576
    || diagrams.DIAGRAM_MAX_SOURCE_BYTES !== 262144
    || diagrams.DIAGRAM_VIEWPORT_MARGIN !== "800px"
  ) {
    throw new Error("diagrams package Node ESM surface is incomplete");
  }
  const diagramsDefinition = diagrams.createDiagramsExtension({
    messages: { showPreview: "Preview packed diagram" },
  });
  if (
    diagramsDefinition.name !== "markora-extension-diagrams"
    || diagrams.diagramKinds.join(":") !== "mermaid:plantuml:geojson:topojson:stl"
    || typeof diagrams.defaultDiagramMessages.sourceLabel(
      "mermaid",
      "mermaid theme=neutral",
    ) !== "string"
  ) {
    throw new Error("diagrams package factory returned the wrong identity, kinds, or messages");
  }
  if (
    typeof footnotes.createFootnotesExtension !== "function"
    || !Object.isFrozen(footnotes.defaultFootnotesMessages)
    || !Object.isFrozen(footnotes.footnoteDiagnosticCodes)
  ) {
    throw new Error("footnotes package Node ESM surface is incomplete");
  }
  const footnotesDefinition = footnotes.createFootnotesExtension({
    messages: { referenceText: (number) => "F" + number },
  });
  if (
    footnotesDefinition.name !== "markora-extension-footnotes"
    || footnotes.defaultFootnotesMessages.referenceText(2) !== "2"
  ) {
    throw new Error("footnotes package factory returned the wrong identity or messages");
  }
  if (
    typeof math.createMathExtension !== "function"
    || !Object.isFrozen(math.defaultMathMessages)
    || !Object.isFrozen(math.mathDiagnosticCodes)
    || math.MATH_MAX_CONCURRENT_RENDERS !== 4
  ) {
    throw new Error("math package Node ESM surface is incomplete");
  }
  const mathDefinition = math.createMathExtension();
  if (mathDefinition.name !== "markora-extension-math") {
    throw new Error("math package factory returned the wrong identity");
  }
  if (
    typeof html.createHtmlExtension !== "function"
    || !Object.isFrozen(html.defaultHtmlMessages)
    || !Object.isFrozen(html.htmlDiagnosticCodes)
    || !Object.isFrozen(html.htmlDisplays)
    || !Object.isFrozen(html.htmlRenderErrorCodes)
    || !Object.isFrozen(html.htmlSourceKinds)
    || html.HTML_MAX_CONCURRENT_RENDERS !== 4
    || html.HTML_MAX_SOURCE_BYTES !== 262144
  ) {
    throw new Error("HTML package Node ESM surface is incomplete");
  }
  const htmlDefinition = html.createHtmlExtension({
    messages: { showPreview: "Show packed HTML preview" },
  });
  if (
    htmlDefinition.name !== "markora-extension-html"
    || html.htmlDisplays.join(":") !== "block:inline"
    || html.htmlSourceKinds.join(":") !== "html-block:inline-html:html-comment"
    || typeof html.defaultHtmlMessages.sourceLabel("html-block") !== "string"
  ) {
    throw new Error("HTML package factory returned the wrong identity or surface");
  }
  if (
    typeof toc.createTocExtension !== "function"
    || !Object.isFrozen(toc.defaultTocMessages)
  ) {
    throw new Error("TOC package Node ESM surface is incomplete");
  }
  const tocDefinition = toc.createTocExtension({
    messages: {
      navigationLabel: (occurrence, total) => "Packed " + occurrence + "/" + total,
    },
  });
  if (
    tocDefinition.name !== "markora-extension-toc"
    || toc.defaultTocMessages.navigationLabel(1, 2) !== "Table of contents 1 of 2"
    || typeof toc.defaultTocMessages.goToHeadingLabel("Packed", 1, 1) !== "string"
  ) {
    throw new Error("TOC package factory returned the wrong identity or messages");
  }
  if (typeof minimal.createEditor !== "function") {
    throw new Error("markora/minimal createEditor export missing");
  }
`], { cwd: smokeAppDir });
currentPhase = "advanced-extensions-root-minimal-runtime-smoke";
run("node", ["src/frontmatter-runtime.mjs"], { cwd: smokeAppDir });

currentPhase = "bundle-configuration";
writeBundleConfig("root", "./src/root.js");
writeBundleConfig("minimal", "./src/minimal.js");
for (const spec of extensionBundleSpecs) {
  writeBundleConfig(spec.graphName, `./src/${spec.graphName}.js`);
}
writeBundleConfig("allSeven", "./src/allSeven.js");
currentPhase = "root-bundle-build";
run("node", [viteCliPath, "build", "--config", "vite.root.config.mjs"], { cwd: smokeAppDir });
currentPhase = "minimal-bundle-build";
run("node", [viteCliPath, "build", "--config", "vite.minimal.config.mjs"], { cwd: smokeAppDir });
for (const spec of extensionBundleSpecs) {
  currentPhase = `${spec.graphName}-bundle-build`;
  run(
    "node",
    [viteCliPath, "build", "--config", `vite.${spec.graphName}.config.mjs`],
    { cwd: smokeAppDir },
  );
}
currentPhase = "all-seven-bundle-build";
run(
  "node",
  [viteCliPath, "build", "--config", "vite.allSeven.config.mjs"],
  { cwd: smokeAppDir },
);

currentPhase = "bundle-validation";
const rootBundleReport = readBundleReport("root");
const minimalBundleReport = readBundleReport("minimal");
const extensionBundleReports = Object.freeze(Object.fromEntries(
  extensionBundleSpecs.map((spec) => [spec.graphName, readBundleReport(spec.graphName)]),
));
const alertsBundleReport = extensionBundleReports.alerts;
const diagramsBundleReport = extensionBundleReports.diagrams;
const frontmatterBundleReport = extensionBundleReports.frontmatter;
const footnotesBundleReport = extensionBundleReports.footnotes;
const htmlBundleReport = extensionBundleReports.html;
const mathBundleReport = extensionBundleReports.math;
const tocBundleReport = extensionBundleReports.toc;
const allSevenBundleReport = readBundleReport("allSeven");
const rootBundleMeasurement = measureBundleGraph(rootBundleReport);
const minimalBundleMeasurement = measureBundleGraph(minimalBundleReport);
const extensionBundleMeasurements = Object.freeze(Object.fromEntries(
  extensionBundleSpecs.map((spec) => [
    spec.graphName,
    measureBundleGraph(extensionBundleReports[spec.graphName]),
  ]),
));
const alertsBundleMeasurement = extensionBundleMeasurements.alerts;
const diagramsBundleMeasurement = extensionBundleMeasurements.diagrams;
const frontmatterBundleMeasurement = extensionBundleMeasurements.frontmatter;
const footnotesBundleMeasurement = extensionBundleMeasurements.footnotes;
const htmlBundleMeasurement = extensionBundleMeasurements.html;
const mathBundleMeasurement = extensionBundleMeasurements.math;
const tocBundleMeasurement = extensionBundleMeasurements.toc;
const allSevenBundleMeasurement = measureBundleGraph(allSevenBundleReport);
const extensionBundles = extensionBundleSpecs.map((spec) => ({
  measurement: extensionBundleMeasurements[spec.graphName],
  report: extensionBundleReports[spec.graphName],
  spec,
}));
assertBundleIsolation(rootBundleReport, minimalBundleReport);
for (const { report, spec } of extensionBundles) {
  assertExtensionBundleIsolation(report, spec);
}
assertAllSevenBundle(allSevenBundleReport, allSevenBundleMeasurement);
assertPackedProvenance(
  rootBundleReport,
  minimalBundleReport,
  rootBundleMeasurement,
  minimalBundleMeasurement,
  extensionBundles,
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

const alertsEntryChunk = alertsBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!alertsEntryChunk) {
  throw new Error("The alerts feature bundle did not emit an entry chunk.");
}
const alertsEntrySpecifier = `./dist/alerts/${alertsEntryChunk.fileName}`;
currentPhase = "alerts-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(alertsEntrySpecifier)});
  const names = consumer.packedAlertsDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-alerts:markora-extension-alerts") {
    throw new Error("Packed alerts feature bundle did not execute");
  }
`], { cwd: smokeAppDir });

const frontmatterEntryChunk = frontmatterBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!frontmatterEntryChunk) {
  throw new Error("The front matter feature bundle did not emit an entry chunk.");
}
const frontmatterEntrySpecifier = `./dist/frontmatter/${frontmatterEntryChunk.fileName}`;
currentPhase = "frontmatter-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(frontmatterEntrySpecifier)});
  const names = consumer.packedFrontmatterDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-frontmatter:markora-extension-frontmatter") {
    throw new Error("Packed front matter feature bundle did not execute");
  }
`], { cwd: smokeAppDir });

const diagramsEntryChunk = diagramsBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!diagramsEntryChunk) {
  throw new Error("The diagrams feature bundle did not emit an entry chunk.");
}
const diagramsEntrySpecifier = `./dist/diagrams/${diagramsEntryChunk.fileName}`;
currentPhase = "diagrams-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(diagramsEntrySpecifier)});
  const names = consumer.packedDiagramDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-diagrams:markora-extension-diagrams") {
    throw new Error("Packed diagrams feature bundle did not execute");
  }
  if (!consumer.packedDiagramSurface?.includes("mermaid,plantuml,geojson,topojson,stl")) {
    throw new Error("Packed diagrams feature bundle omitted its public kind surface");
  }
`], { cwd: smokeAppDir });

const footnotesEntryChunk = footnotesBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!footnotesEntryChunk) {
  throw new Error("The footnotes feature bundle did not emit an entry chunk.");
}
const footnotesEntrySpecifier = `./dist/footnotes/${footnotesEntryChunk.fileName}`;
currentPhase = "footnotes-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(footnotesEntrySpecifier)});
  const names = consumer.packedFootnotesDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-footnotes:markora-extension-footnotes") {
    throw new Error("Packed footnotes feature bundle did not execute");
  }
`], { cwd: smokeAppDir });

const htmlEntryChunk = htmlBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!htmlEntryChunk) {
  throw new Error("The HTML feature bundle did not emit an entry chunk.");
}
const htmlEntrySpecifier = `./dist/html/${htmlEntryChunk.fileName}`;
currentPhase = "html-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(htmlEntrySpecifier)});
  const names = consumer.packedHtmlDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-html:markora-extension-html") {
    throw new Error("Packed HTML feature bundle did not execute");
  }
  if (!consumer.packedHtmlSurface?.includes("HTML block")) {
    throw new Error("Packed HTML feature bundle omitted its public message surface");
  }
`], { cwd: smokeAppDir });

const mathEntryChunk = mathBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!mathEntryChunk) {
  throw new Error("The math feature bundle did not emit an entry chunk.");
}
const mathEntrySpecifier = `./dist/math/${mathEntryChunk.fileName}`;
currentPhase = "math-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(mathEntrySpecifier)});
  const names = consumer.packedMathDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-math:markora-extension-math") {
    throw new Error("Packed math feature bundle did not execute");
  }
`], { cwd: smokeAppDir });

const tocEntryChunk = tocBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!tocEntryChunk) {
  throw new Error("The TOC feature bundle did not emit an entry chunk.");
}
const tocEntrySpecifier = `./dist/toc/${tocEntryChunk.fileName}`;
currentPhase = "toc-feature-runtime-smoke";
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(tocEntrySpecifier)});
  const names = consumer.packedTocDefinitions?.map((extension) => extension.name);
  if (names?.join(":") !== "markora-extension-toc:markora-extension-toc") {
    throw new Error("Packed TOC feature bundle did not execute");
  }
  if (!consumer.packedTocSurface?.includes("Table of contents 1 of 2")) {
    throw new Error("Packed TOC feature bundle omitted its public message surface");
  }
`], { cwd: smokeAppDir });

const allSevenEntryChunk = allSevenBundleReport.chunks.find((chunk) => chunk.isEntry);
if (!allSevenEntryChunk) {
  throw new Error("The all-seven root consumer did not emit an entry chunk.");
}
const allSevenEntrySpecifier = pathToFileURL(join(
  smokeAppDir,
  "dist",
  "allSeven",
  allSevenEntryChunk.fileName,
)).href;
currentPhase = "all-seven-root-runtime-smoke";
run(
  "node",
  ["src/all-seven-runtime.mjs", allSevenEntrySpecifier],
  { cwd: smokeAppDir },
);

const measurements = Object.freeze({
  alerts: alertsBundleMeasurement,
  allSeven: allSevenBundleMeasurement,
  diagrams: diagramsBundleMeasurement,
  footnotes: footnotesBundleMeasurement,
  frontmatter: frontmatterBundleMeasurement,
  html: htmlBundleMeasurement,
  math: mathBundleMeasurement,
  minimal: minimalBundleMeasurement,
  root: rootBundleMeasurement,
  toc: tocBundleMeasurement,
});
availableMeasurements = measurements;
printBundleMeasurements(measurements);
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
  measurements,
  reportPath: commandOptions.reportPath,
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
