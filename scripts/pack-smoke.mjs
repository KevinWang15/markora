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
    for (const requiredTheme of ["light", "dark", "auto", "contrast"]) {
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
      || packageJson.peerDependencies?.markora !== "^0.0.1"
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
    "/node_modules/katex/",
    "/node_modules/mathjax",
    "/node_modules/mermaid/",
    "/node_modules/js-yaml/",
    "/node_modules/yaml/",
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
      compatibilityInitialExcludesCodeMirror: true,
      compatibilityLazyIncludesCodeMirror: true,
      minimalExcludesCodeMirror: true,
      minimalHasNoLazyChunks: measurements.minimal.lazyJs.chunkCount === 0,
      optionalExtensionsAbsentFromBaseline: true,
      frontmatterHasNoLazyChunks: measurements.frontmatter.lazyJs.chunkCount === 0,
      frontmatterHasNoRendererEngine: true,
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

currentPhase = "packed-dependency-isolation";
copyWorkspaceDependencies();
unpackPackage(corePackage.name, corePackage.tarballPath);
unpackPackage(uiPackage.name, uiPackage.tarballPath);
unpackPackage(frontmatterPackage.name, frontmatterPackage.tarballPath);
unpackPackage(footnotesPackage.name, footnotesPackage.tarballPath);
unpackPackage(htmlPackage.name, htmlPackage.tarballPath);
unpackPackage(mathPackage.name, mathPackage.tarballPath);
unpackPackage(alertsPackage.name, alertsPackage.tarballPath);
unpackPackage(tocPackage.name, tocPackage.tarballPath);
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

writeFileSync(join(smokeAppDir, "src/frontmatter.js"), `import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  defaultFrontmatterMessages,
} from "markora-extension-frontmatter";
import "markora-extension-frontmatter/styles.css";

export const packedFrontmatterDefinitions = [
  createFrontmatterExtension(),
  createFrontmatterExtension({
    messages: { editSource: "Edit packed metadata" },
  }),
];

export const packedFrontmatterSurface = [
  FRONTMATTER_MAX_SOURCE_BYTES,
  defaultFrontmatterMessages.kindLabel,
  ...packedFrontmatterDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/footnotes.js"), `import {
  createFootnotesExtension,
  defaultFootnotesMessages,
  footnoteDiagnosticCodes,
} from "markora-extension-footnotes";
import "markora-extension-footnotes/styles.css";

export const packedFootnotesDefinitions = [
  createFootnotesExtension(),
  createFootnotesExtension({
    messages: { referenceText: (number) => "F" + number },
  }),
];

export const packedFootnotesSurface = [
  defaultFootnotesMessages.referenceText(1),
  footnoteDiagnosticCodes.join(","),
  ...packedFootnotesDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/html.js"), `import {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_SOURCE_BYTES,
  createHtmlExtension,
  defaultHtmlMessages,
  htmlDiagnosticCodes,
  htmlDisplays,
  htmlRenderErrorCodes,
  htmlSourceKinds,
} from "markora-extension-html";
import "markora-extension-html/styles.css";

export const packedHtmlDefinitions = [
  createHtmlExtension(),
  createHtmlExtension({
    messages: { showPreview: "Show packed HTML preview" },
  }),
];

export const packedHtmlSurface = [
  HTML_MAX_SOURCE_BYTES,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  defaultHtmlMessages.blockKindLabel,
  htmlDiagnosticCodes.join(","),
  htmlDisplays.join(","),
  htmlRenderErrorCodes.join(","),
  htmlSourceKinds.join(","),
  ...packedHtmlDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/alerts.js"), `import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
} from "markora-extension-alerts";
import "markora-extension-alerts/styles.css";

export const packedAlertsDefinitions = [
  createAlertsExtension(),
  createAlertsExtension({
    messages: { toggleAlert: "Toggle packed note alert" },
  }),
];

export const packedAlertsSurface = [
  alertKinds.join(","),
  defaultAlertsMessages.alertLabel("note", defaultAlertsMessages.noteKindLabel),
  defaultAlertsMessages.invalidDocumentDiagnostic("unknown"),
  ...packedAlertsDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/math.js"), `import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_SOURCE_BYTES,
  createMathExtension,
  defaultMathMessages,
  mathDiagnosticCodes,
} from "markora-extension-math";
import "markora-extension-math/styles.css";

export const packedMathDefinitions = [
  createMathExtension(),
  createMathExtension({
    messages: { showPreview: "Show packed math preview" },
  }),
];

export const packedMathSurface = [
  MATH_MAX_SOURCE_BYTES,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_CONCURRENT_RENDERS,
  defaultMathMessages.inlineKindLabel,
  mathDiagnosticCodes.join(","),
  ...packedMathDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
`);

writeFileSync(join(smokeAppDir, "src/toc.js"), `import {
  createTocExtension,
  defaultTocMessages,
} from "markora-extension-toc";
import "markora-extension-toc/styles.css";

export const packedTocDefinitions = [
  createTocExtension(),
  createTocExtension({
    messages: {
      navigationLabel: (occurrence, total) =>
        "Packed contents " + occurrence + " of " + total,
      untitledHeadingLabel: (level, index) =>
        "Packed untitled " + index + " at level " + level,
    },
  }),
];

export const packedTocSurface = [
  defaultTocMessages.navigationLabel(1, 2),
  defaultTocMessages.goToHeadingLabel("Packed", 1, 1),
  ...packedTocDefinitions.map(({ name, version }) => name + "@" + version),
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
  closeHistory,
  defineMarkdownEditorExtension,
  sliceMarkdownEditorOriginalSourceLines,
  type AnyMarkdownEditorExtension,
  type Transaction,
} from "markora/extension-api";
import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
  type AlertKind,
  type AlertSnapshot,
  type AlertsCommands,
  type AlertsExtension,
  type AlertsExtensionOptions,
  type AlertsMessageOverrides,
  type AlertsMessages,
  type AlertsState,
} from "markora-extension-alerts";
import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  defaultFrontmatterMessages,
  type FrontmatterDiagnostic,
  type FrontmatterEditRequest,
  type FrontmatterExtension,
  type FrontmatterExtensionOptions,
  type FrontmatterMessages,
  type FrontmatterSnapshot,
} from "markora-extension-frontmatter";
import {
  createFootnotesExtension,
  defaultFootnotesMessages,
  footnoteDiagnosticCodes,
  type FootnoteDefinitionSnapshot,
  type FootnoteDefinitionTarget,
  type FootnoteDiagnostic,
  type FootnoteDiagnosticCode,
  type FootnoteReferenceSnapshot,
  type FootnoteRemoveOptions,
  type FootnoteRenameOptions,
  type FootnotesExtension,
  type FootnotesExtensionOptions,
  type FootnotesMessageOverrides,
  type FootnotesMessages,
  type FootnotesSnapshot,
} from "markora-extension-footnotes";
import {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_SOURCE_BYTES,
  createHtmlExtension,
  defaultHtmlMessages,
  htmlDiagnosticCodes,
  htmlDisplays,
  htmlRenderErrorCodes,
  htmlSourceKinds,
  type HtmlCommands,
  type HtmlDiagnostic,
  type HtmlDiagnosticCode,
  type HtmlDisplay,
  type HtmlEditRequest,
  type HtmlExtension,
  type HtmlExtensionOptions,
  type HtmlMessageOverrides,
  type HtmlMessages,
  type HtmlNodeSnapshot,
  type HtmlNodeTarget,
  type HtmlRenderer,
  type HtmlRenderErrorCode,
  type HtmlRenderRequest,
  type HtmlRenderSnapshot,
  type HtmlRenderStatus,
  type HtmlSnapshot,
  type HtmlSourceKind,
  type HtmlState,
} from "markora-extension-html";
import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_SOURCE_BYTES,
  createMathExtension,
  defaultMathMessages,
  mathDiagnosticCodes,
  mathKinds,
  mathRenderErrorCodes,
  type MathDiagnostic,
  type MathEditRequest,
  type MathExtension,
  type MathExtensionOptions,
  type MathMessageOverrides,
  type MathMessages,
  type MathNodeSnapshot,
  type MathNodeTarget,
  type MathRenderRequest,
  type MathRenderer,
  type MathRenderSnapshot,
  type MathSnapshot,
} from "markora-extension-math";
import {
  createTocExtension,
  defaultTocMessages,
  type TocCommands,
  type TocExtension,
  type TocExtensionOptions,
  type TocHeadingLevel,
  type TocHeadingSnapshot,
  type TocMessageOverrides,
  type TocMessages,
  type TocNodeSnapshot,
  type TocSnapshot,
  type TocState,
} from "markora-extension-toc";
import {
  packedCalloutExtension,
  packedHighlightExtension,
} from "./extensions";

declare const element: HTMLElement;
declare const transaction: Transaction;

const alertsMessageOverrides: AlertsMessageOverrides = {
  alertLabel: (kind, kindLabel) => kind + ":" + kindLabel,
  invalidDocumentDiagnostic: (kind) => "Invalid packed alert: " + kind,
  toggleAlert: "Toggle packed alert",
};
const alertsOptions: AlertsExtensionOptions = {
  messages: alertsMessageOverrides,
};
const rootAlertsExtension: AlertsExtension = createAlertsExtension(alertsOptions);
const minimalAlertsExtension: AlertsExtension = createAlertsExtension();
const frontmatterOptions: FrontmatterExtensionOptions = {
  messages: { editSource: "Edit packed metadata" },
  onEditSource(request: FrontmatterEditRequest) {
    const source: string = request.source;
    const diagnostics: readonly FrontmatterDiagnostic[] = request.diagnostics;
    const unchanged: boolean = request.update(source);
    void diagnostics;
    void unchanged;
  },
};
const rootFrontmatterExtension: FrontmatterExtension =
  createFrontmatterExtension(frontmatterOptions);
const minimalFrontmatterExtension: FrontmatterExtension =
  createFrontmatterExtension();
const footnotesMessageOverrides: FootnotesMessageOverrides = {
  referenceText: (number) => "F" + number,
};
const footnotesOptions: FootnotesExtensionOptions = {
  messages: footnotesMessageOverrides,
};
const rootFootnotesExtension: FootnotesExtension =
  createFootnotesExtension(footnotesOptions);
const minimalFootnotesExtension: FootnotesExtension =
  createFootnotesExtension();
const htmlMessages: HtmlMessageOverrides = {
  showPreview: "Show packed HTML preview",
  sourceLabel: (kind) => "Packed " + kind + " source",
};
const htmlRenderer: HtmlRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: HtmlRenderRequest) => {
  const output = ownerDocument.createElement("article");
  output.textContent = kind + ": " + source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return output;
};
const htmlOptions: HtmlExtensionOptions = {
  messages: htmlMessages,
  onEditSource(request: HtmlEditRequest) {
    const display: HtmlDisplay = request.display;
    const kind: HtmlSourceKind = request.kind;
    const render: HtmlRenderSnapshot = request.render;
    const unchanged: boolean = request.update(request.source);
    void display;
    void kind;
    void render;
    void unchanged;
  },
  renderer: htmlRenderer,
};
const rootHtmlExtension: HtmlExtension = createHtmlExtension(htmlOptions);
const mathMessages: MathMessageOverrides = {
  showPreview: "Show packed preview",
};
const mathRenderer: MathRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: MathRenderRequest) => {
  const output = ownerDocument.createElement(kind === "inline" ? "span" : "div");
  output.textContent = source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return output;
};
const mathOptions: MathExtensionOptions = {
  messages: mathMessages,
  onEditSource(request: MathEditRequest) {
    const source: string = request.source;
    const render: MathRenderSnapshot = request.render;
    const unchanged: boolean = request.update(source);
    void render;
    void unchanged;
  },
  renderer: mathRenderer,
};
const rootMathExtension: MathExtension = createMathExtension(mathOptions);
const minimalMathExtension: MathExtension = createMathExtension();
const tocMessages: TocMessageOverrides = {
  emptyState: "No packed headings",
  goToHeadingLabel: (label, level, index) =>
    "Packed heading " + index + ", level " + level + ": " + label,
  navigationLabel: (occurrence, total) =>
    "Packed contents " + occurrence + " of " + total,
  untitledHeadingLabel: (level, index) =>
    "Packed untitled " + index + " at level " + level,
};
const tocOptions: TocExtensionOptions = { messages: tocMessages };
const rootTocExtension: TocExtension = createTocExtension(tocOptions);
const minimalTocExtension: TocExtension = createTocExtension();

const editor = createEditor({
  ariaLabel: "Packed editor",
  autofocus: true,
  editable: true,
  element,
  extensions: [
    rootAlertsExtension,
    rootFrontmatterExtension,
    rootFootnotesExtension,
    rootHtmlExtension,
    rootMathExtension,
    rootTocExtension,
  ],
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
  minimalAlertsExtension,
  minimalFrontmatterExtension,
  minimalFootnotesExtension,
  minimalMathExtension,
  minimalTocExtension,
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
const rootAlertsHandle = editor.extensions.get(rootAlertsExtension);
const minimalAlertsHandle = minimalEditor.extensions.get(minimalAlertsExtension);
const rootFrontmatterHandle = editor.extensions.get(rootFrontmatterExtension);
const minimalFrontmatterHandle = minimalEditor.extensions.get(minimalFrontmatterExtension);
const rootFootnotesHandle = editor.extensions.get(rootFootnotesExtension);
const minimalFootnotesHandle = minimalEditor.extensions.get(minimalFootnotesExtension);
const rootHtmlHandle = editor.extensions.get(rootHtmlExtension);
const rootMathHandle = editor.extensions.get(rootMathExtension);
const minimalMathHandle = minimalEditor.extensions.get(minimalMathExtension);
const rootTocHandle = editor.extensions.get(rootTocExtension);
const minimalTocHandle = minimalEditor.extensions.get(minimalTocExtension);
const alertsCommands: AlertsCommands = rootAlertsHandle.commands;
const alertsState: AlertsState = minimalAlertsHandle.state;
const alertsMessages: AlertsMessages = defaultAlertsMessages;
const alertKind: AlertKind = alertKinds[0];
const alertLabel: string = alertsMessages.alertLabel(
  alertKind,
  alertsMessages.noteKindLabel,
);
const invalidAlertDiagnostic: string = alertsMessages.invalidDocumentDiagnostic("danger");
const alerts: readonly AlertSnapshot[] = rootAlertsHandle.state.getAlerts();
const activeAlert: AlertSnapshot | null = minimalAlertsHandle.state.getActive();
const wrappedAlert: boolean = rootAlertsHandle.commands.wrap("warning");
const toggledAlert: boolean = minimalAlertsHandle.commands.toggle();
const changedAlertKind: boolean = rootAlertsHandle.commands.setKind("caution");
const unwrappedAlert: boolean = minimalAlertsHandle.commands.unwrap();
const canWrapAlert: boolean = rootAlertsHandle.state.canWrap("important");
const canToggleAlert: boolean = minimalAlertsHandle.state.canToggle("tip");
const canSetAlertKind: boolean = rootAlertsHandle.state.canSetKind("warning");
const canUnwrapAlert: boolean = minimalAlertsHandle.state.canUnwrap();
const alertIsActive: boolean = rootAlertsHandle.state.isActive();
const rootFrontmatterSnapshot: FrontmatterSnapshot | null =
  rootFrontmatterHandle.state.getSnapshot();
const frontmatterMessages: FrontmatterMessages = defaultFrontmatterMessages;
const frontmatterMaximum: number = FRONTMATTER_MAX_SOURCE_BYTES;
const insertedFrontmatter: boolean = rootFrontmatterHandle.commands.insert(
  "---\\ntitle: Packed\\n---",
);
const updatedFrontmatter: boolean = minimalFrontmatterHandle.commands.update(
  "---\\ntitle: Minimal\\n---",
);
const footnoteTarget: FootnoteDefinitionTarget = { label: "note", occurrence: 1 };
const footnoteRenameOptions: FootnoteRenameOptions = { references: "rename" };
const footnoteRemoveOptions: FootnoteRemoveOptions = { references: "preserve" };
const footnotesSnapshot: FootnotesSnapshot = rootFootnotesHandle.state.getSnapshot();
const footnoteDefinition: FootnoteDefinitionSnapshot | null =
  rootFootnotesHandle.state.getDefinition(footnoteTarget);
const footnoteReferences: readonly FootnoteReferenceSnapshot[] =
  rootFootnotesHandle.state.getReferences("note");
const footnoteDiagnostics: readonly FootnoteDiagnostic[] =
  rootFootnotesHandle.state.getDiagnostics();
const footnoteDiagnosticCode: FootnoteDiagnosticCode = footnoteDiagnosticCodes[0];
const footnotesMessages: FootnotesMessages = defaultFootnotesMessages;
const insertedFootnoteReference: boolean =
  rootFootnotesHandle.commands.insertReference("note");
const insertedFootnoteDefinition: boolean =
  minimalFootnotesHandle.commands.insertDefinition("note");
const navigatedToFootnoteDefinition: boolean =
  rootFootnotesHandle.commands.navigateToDefinition("note", 1);
const navigatedToFootnoteReference: boolean =
  rootFootnotesHandle.commands.navigateToReference("note", 1);
const renamedFootnote: boolean = rootFootnotesHandle.commands.renameDefinition(
  footnoteTarget,
  "renamed",
  footnoteRenameOptions,
);
const removedFootnote: boolean = minimalFootnotesHandle.commands.removeDefinition(
  footnoteTarget,
  footnoteRemoveOptions,
);
const htmlTarget: HtmlNodeTarget = {
  display: "block",
  identity: 1,
  kind: "html-block",
  position: 0,
  source: "<div>packed</div>",
};
const htmlCommands: HtmlCommands = rootHtmlHandle.commands;
const htmlState: HtmlState = rootHtmlHandle.state;
const htmlSnapshot: HtmlSnapshot = htmlState.getSnapshot();
const htmlNode: HtmlNodeSnapshot | null = htmlState.getNode(htmlTarget);
const htmlNodes: readonly HtmlNodeSnapshot[] = htmlState.getNodes("block");
const htmlDiagnostics: readonly HtmlDiagnostic[] = htmlState.getDiagnostics();
const htmlRender: HtmlRenderSnapshot | null = htmlState.getRenderState(htmlTarget);
const updatedHtml: boolean = htmlCommands.update(htmlTarget, "<aside>packed</aside>");
const removedHtml: boolean = htmlCommands.remove(htmlTarget);
const toggledHtml: boolean = htmlCommands.togglePreview(htmlTarget);
const retriedHtml: boolean = htmlCommands.retryPreview(htmlTarget);
const publicHtmlMessages: HtmlMessages = defaultHtmlMessages;
const htmlDisplay: HtmlDisplay = htmlDisplays[0];
const htmlSourceKind: HtmlSourceKind = htmlSourceKinds[0];
const htmlDiagnosticCode: HtmlDiagnosticCode = htmlDiagnosticCodes[0];
const htmlRenderErrorCode: HtmlRenderErrorCode = htmlRenderErrorCodes[0];
const htmlRenderStatus: HtmlRenderStatus = "rendering";
const htmlLimits: readonly number[] = [
  HTML_MAX_SOURCE_BYTES,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
];
const mathTarget: MathNodeTarget = {
  identity: 1,
  kind: "inline",
  position: 1,
  source: "x",
};
const mathSnapshot: MathSnapshot = rootMathHandle.state.getSnapshot();
const mathNodes: readonly MathNodeSnapshot[] = minimalMathHandle.state.getNodes();
const mathDiagnostics: readonly MathDiagnostic[] = rootMathHandle.state.getDiagnostics();
const mathRender: MathRenderSnapshot | null = rootMathHandle.state.getRenderState(mathTarget);
const insertedInlineMath: boolean = rootMathHandle.commands.insertInline("x");
const insertedBlockMath: boolean = minimalMathHandle.commands.insertBlock("x\\ny");
const updatedMath: boolean = rootMathHandle.commands.update(mathTarget, "y");
const removedMath: boolean = rootMathHandle.commands.remove(mathTarget);
const convertedMath: boolean = rootMathHandle.commands.convert(mathTarget, "block");
const toggledMath: boolean = rootMathHandle.commands.togglePreview(mathTarget);
const retriedMath: boolean = rootMathHandle.commands.retryPreview(mathTarget);
const publicMathMessages: MathMessages = defaultMathMessages;
const mathLimits: readonly number[] = [
  MATH_MAX_SOURCE_BYTES,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_CONCURRENT_RENDERS,
];
const mathKind = mathKinds[0];
const mathDiagnosticCode = mathDiagnosticCodes[0];
const mathRenderErrorCode = mathRenderErrorCodes[0];
const tocCommands: TocCommands = rootTocHandle.commands;
const tocState: TocState = minimalTocHandle.state;
const tocSnapshot: TocSnapshot = rootTocHandle.state.getSnapshot();
const tocHeadings: readonly TocHeadingSnapshot[] = tocSnapshot.headings;
const tocNodes: readonly TocNodeSnapshot[] = tocSnapshot.tocs;
const tocHeading: TocHeadingSnapshot = {
  label: "Packed heading",
  level: 2,
  position: 1,
};
const tocNode: TocNodeSnapshot = { position: 0 };
const tocHeadingLevel: TocHeadingLevel = tocHeading.level;
const tocPublicMessages: TocMessages = defaultTocMessages;
const tocNavigationLabel: string = tocPublicMessages.navigationLabel(1, 2);
const tocEntryLabel: string = tocPublicMessages.goToHeadingLabel(
  tocHeading.label,
  tocHeading.level,
  1,
);
const insertedToc: boolean = rootTocHandle.commands.insert();
const removedToc: boolean = minimalTocHandle.commands.remove();
const canInsertToc: boolean = rootTocHandle.state.canInsert();
const canRemoveToc: boolean = minimalTocHandle.state.canRemove();
const tocIsActive: boolean = rootTocHandle.state.isActive();
const closedTransaction: Transaction = closeHistory(transaction);
void alertsCommands;
void alertsState;
void alertsMessages;
void alertKind;
void alertLabel;
void invalidAlertDiagnostic;
void alerts;
void activeAlert;
void wrappedAlert;
void toggledAlert;
void changedAlertKind;
void unwrappedAlert;
void canWrapAlert;
void canToggleAlert;
void canSetAlertKind;
void canUnwrapAlert;
void alertIsActive;
void rootFrontmatterSnapshot;
void frontmatterMessages;
void frontmatterMaximum;
void insertedFrontmatter;
void updatedFrontmatter;
void footnotesSnapshot;
void footnoteDefinition;
void footnoteReferences;
void footnoteDiagnostics;
void footnoteDiagnosticCode;
void footnotesMessages;
void insertedFootnoteReference;
void insertedFootnoteDefinition;
void navigatedToFootnoteDefinition;
void navigatedToFootnoteReference;
void renamedFootnote;
void removedFootnote;
void htmlCommands;
void htmlState;
void htmlSnapshot;
void htmlNode;
void htmlNodes;
void htmlDiagnostics;
void htmlRender;
void updatedHtml;
void removedHtml;
void toggledHtml;
void retriedHtml;
void publicHtmlMessages;
void htmlDisplay;
void htmlSourceKind;
void htmlDiagnosticCode;
void htmlRenderErrorCode;
void htmlRenderStatus;
void htmlLimits;
void mathSnapshot;
void mathNodes;
void mathDiagnostics;
void mathRender;
void insertedInlineMath;
void insertedBlockMath;
void updatedMath;
void removedMath;
void convertedMath;
void toggledMath;
void retriedMath;
void publicMathMessages;
void mathLimits;
void mathKind;
void mathDiagnosticCode;
void mathRenderErrorCode;
void tocCommands;
void tocState;
void tocSnapshot;
void tocHeadings;
void tocNodes;
void tocHeading;
void tocNode;
void tocHeadingLevel;
void tocPublicMessages;
void tocNavigationLabel;
void tocEntryLabel;
void insertedToc;
void removedToc;
void canInsertToc;
void canRemoveToc;
void tocIsActive;
void closedTransaction;

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
MARKORA_EXTENSION_API_VERSION satisfies "1.3.0";
const unavailableSourceSlice: string | null =
  sliceMarkdownEditorOriginalSourceLines({}, 0, 1);
void new MarkdownEditorDestroyedError("focus the editor");
void staticDefinition;
void legacyCreateOptions;
void minimalIdleChangeMode;
void reconciled;
void transactionOrigin;
void unavailableSourceSlice;
// @ts-expect-error Alert commands reject unsupported kinds.
rootAlertsHandle.commands.wrap("danger");
// @ts-expect-error Alert factory options reject undeclared keys.
createAlertsExtension({ unknownOption: true });
// @ts-expect-error Alert messages reject undeclared keys.
createAlertsExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error The public alert kind tuple is immutable.
alertKinds.push("note");
// @ts-expect-error Public alert snapshot arrays are immutable.
alerts.push({ kind: "note", position: 0 });
// @ts-expect-error Front matter source commands only accept strings.
rootFrontmatterHandle.commands.update(42);
// @ts-expect-error Front matter messages reject undeclared keys.
createFrontmatterExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error Footnote labels must be strings.
rootFootnotesHandle.commands.insertReference(42);
// @ts-expect-error Footnote rename requires an explicit reference policy.
rootFootnotesHandle.commands.renameDefinition(footnoteTarget, "renamed", {});
// @ts-expect-error Footnote remove policies cannot invent orphan behavior.
minimalFootnotesHandle.commands.removeDefinition(footnoteTarget, { references: "rename" });
// @ts-expect-error Footnote messages reject undeclared keys.
createFootnotesExtension({ messages: { unknownLabel: () => "Unknown" } });
// @ts-expect-error HTML source commands accept strings only.
rootHtmlHandle.commands.update(htmlTarget, 42);
// @ts-expect-error HTML targets require an opaque occurrence identity.
rootHtmlHandle.commands.remove({
  display: "block",
  kind: "html-block",
  position: 0,
  source: "<div>packed</div>",
});
// @ts-expect-error HTML renderers return owner-document DOM, never strings.
createHtmlExtension({ renderer: () => "<p>packed</p>" });
// @ts-expect-error HTML messages reject undeclared keys.
createHtmlExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error HTML source kinds are a closed public union.
const invalidHtmlKind: HtmlSourceKind = "script";
// @ts-expect-error Public HTML snapshots are immutable.
htmlSnapshot.nodes.push(htmlTarget);
void invalidHtmlKind;
// @ts-expect-error Math source commands accept strings only.
rootMathHandle.commands.insertInline(42);
// @ts-expect-error Math targets require their stale-safe source identity.
rootMathHandle.commands.remove({ kind: "inline", position: 1 });
// @ts-expect-error Math renderers return DOM, not HTML strings.
createMathExtension({ renderer: () => "<span>x</span>" });
// @ts-expect-error Math messages reject undeclared keys.
createMathExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error TOC commands accept no marker or position arguments.
rootTocHandle.commands.insert("[TOC]");
// @ts-expect-error TOC remove targets are selected through editor state.
minimalTocHandle.commands.remove({ position: 0 });
// @ts-expect-error TOC factory options reject undeclared keys.
createTocExtension({ unknownOption: true });
// @ts-expect-error TOC messages reject undeclared keys.
createTocExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error TOC navigation formatter arguments are numeric.
defaultTocMessages.navigationLabel("first", 2);
// @ts-expect-error TOC heading levels are closed to one through six.
const invalidTocHeadingLevel: TocHeadingLevel = 7;
// @ts-expect-error Public TOC heading arrays are immutable.
tocSnapshot.headings.push(tocHeading);
// @ts-expect-error Public TOC node snapshots are immutable.
tocNode.position = 2;
void invalidTocHeadingLevel;
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

writeFileSync(join(smokeAppDir, "src/frontmatter-runtime.mjs"), `import { JSDOM } from ${JSON.stringify(
  pathToFileURL(resolve(rootDir, "node_modules/jsdom/lib/api.js")).href,
)};

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://pack-smoke.invalid/",
});
const ownerWindow = dom.window;
for (const name of [
  "CompositionEvent",
  "CustomEvent",
  "DOMParser",
  "Element",
  "Event",
  "HTMLElement",
  "KeyboardEvent",
  "MutationObserver",
  "Node",
  "Range",
  "Selection",
  "Text",
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: ownerWindow[name],
  });
}
Object.defineProperties(globalThis, {
  document: { configurable: true, value: ownerWindow.document },
  getComputedStyle: { configurable: true, value: ownerWindow.getComputedStyle.bind(ownerWindow) },
  navigator: { configurable: true, value: ownerWindow.navigator },
  window: { configurable: true, value: ownerWindow },
});
ownerWindow.requestAnimationFrame ??= (callback) => ownerWindow.setTimeout(
  () => callback(ownerWindow.performance.now()),
  0,
);
ownerWindow.cancelAnimationFrame ??= (handle) => ownerWindow.clearTimeout(handle);
globalThis.requestAnimationFrame = ownerWindow.requestAnimationFrame.bind(ownerWindow);
globalThis.cancelAnimationFrame = ownerWindow.cancelAnimationFrame.bind(ownerWindow);
if (!ownerWindow.Range.prototype.getClientRects) {
  ownerWindow.Range.prototype.getClientRects = () => [];
}
if (!ownerWindow.Range.prototype.getBoundingClientRect) {
  ownerWindow.Range.prototype.getBoundingClientRect = () => new ownerWindow.DOMRect();
}

const [
  { createEditor },
  { createEditor: createMinimalEditor },
  alerts,
  frontmatter,
  footnotes,
  html,
  math,
  toc,
] = await Promise.all([
  import("markora"),
  import("markora/minimal"),
  import("markora-extension-alerts"),
  import("markora-extension-frontmatter"),
  import("markora-extension-footnotes"),
  import("markora-extension-html"),
  import("markora-extension-math"),
  import("markora-extension-toc"),
]);
const SOURCE = "\\uFEFF---\\r\\ntitle: Packed\\r\\nanchor: &base value\\r\\ncopy: *base\\r\\n...";
const OPTIONAL_EXTENSION_NAMES = new Set([
  "markora-extension-alerts",
  "markora-extension-frontmatter",
  "markora-extension-footnotes",
  "markora-extension-html",
  "markora-extension-math",
  "markora-extension-toc",
]);

for (const [label, create] of [["root", createEditor], ["minimal", createMinimalEditor]]) {
  const element = ownerWindow.document.createElement("div");
  ownerWindow.document.body.append(element);
  const baseline = create({ element, markdown: "Body" });
  if (baseline.extensions.manifest.extensions.some(({ name }) => (
    OPTIONAL_EXTENSION_NAMES.has(name)
  ))) {
    throw new Error("Packed " + label + " baseline unexpectedly installed an optional extension.");
  }
  baseline.destroy();
  element.replaceChildren();

  const alertsDefinition = alerts.createAlertsExtension({
    messages: { toggleAlert: "Toggle packed alert" },
  });
  const alertsEditor = create({
    element,
    extensions: [alertsDefinition],
    markdown: "> [!warning]\\n> Packed alert.",
  });
  const alertsHandle = alertsEditor.extensions.get(alertsDefinition);
  alertsEditor.focus("start");
  const alertsSnapshot = alertsHandle.state.getAlerts();
  if (
    alertsSnapshot.length !== 1
    || alertsSnapshot[0]?.kind !== "warning"
    || alertsHandle.state.getActive()?.kind !== "warning"
    || !alertsHandle.state.isActive()
    || alertsEditor.getMarkdown() !== "> [!WARNING]\\n> Packed alert."
    || alertsEditor.view.dom.querySelector("[data-mdw-alert-kind=warning]") === null
    || !alertsEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-alerts"
    ))
  ) {
    throw new Error("Packed alerts " + label + " consumer lost semantic or manifest state.");
  }
  if (
    !alertsHandle.state.canSetKind("caution")
    || !alertsHandle.commands.setKind("caution")
    || alertsHandle.state.canSetKind("caution")
    || alertsEditor.getMarkdown() !== "> [!CAUTION]\\n> Packed alert."
    || !alertsEditor.commands.undo()
    || alertsEditor.getMarkdown() !== "> [!WARNING]\\n> Packed alert."
    || !alertsHandle.commands.toggle()
    || alertsEditor.getMarkdown() !== "Packed alert."
    || !alertsEditor.commands.undo()
    || alertsHandle.state.getAlerts()[0]?.kind !== "warning"
  ) {
    throw new Error("Packed alerts " + label + " command, state, or history smoke failed.");
  }
  alertsEditor.destroy();
  element.replaceChildren();

  const definition = frontmatter.createFrontmatterExtension();
  const editor = create({
    element,
    extensions: [definition],
    markdown: SOURCE + "\\r\\nBody",
  });
  const handle = editor.extensions.get(definition);
  if (
    handle.state.getSource() !== SOURCE
    || editor.getMarkdown() !== SOURCE + "\\n\\nBody"
    || !editor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-frontmatter"
    ))
  ) {
    throw new Error("Packed front matter " + label + " consumer lost exact source or manifest state.");
  }
  if (!handle.commands.update("---\\ntitle: Updated\\n---")) {
    throw new Error("Packed front matter " + label + " consumer command failed.");
  }
  if (!editor.commands.undo() || handle.state.getSource() !== SOURCE) {
    throw new Error("Packed front matter " + label + " consumer history failed.");
  }
  editor.destroy();
  element.replaceChildren();

  const footnotesDefinition = footnotes.createFootnotesExtension({
    messages: { referenceText: (number) => "F" + number },
  });
  const footnotesEditor = create({
    element,
    extensions: [footnotesDefinition],
    markdown: "Body",
  });
  const footnotesHandle = footnotesEditor.extensions.get(footnotesDefinition);
  footnotesEditor.focus("end");
  if (
    !footnotesHandle.commands.insertReference("note")
    || !footnotesHandle.commands.insertDefinition("note")
    || footnotesEditor.getMarkdown() !== "Body[^note]\\n\\n[^note]: "
  ) {
    throw new Error("Packed footnotes " + label + " insertion commands failed.");
  }
  const snapshot = footnotesHandle.state.getSnapshot();
  if (
    snapshot.references.length !== 1
    || snapshot.definitions.length !== 1
    || snapshot.diagnostics.length !== 0
    || footnotesHandle.state.getReferences("note").length !== 1
    || footnotesHandle.state.getDefinition({ label: "note" })?.label !== "note"
    || !footnotesEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-footnotes"
    ))
  ) {
    throw new Error("Packed footnotes " + label + " consumer lost indexed or manifest state.");
  }
  if (
    !footnotesHandle.commands.renameDefinition(
      { label: "note" },
      "renamed",
      { references: "rename" },
    )
    || footnotesHandle.state.getDefinition({ label: "renamed" })?.label !== "renamed"
    || !footnotesEditor.commands.undo()
    || !footnotesHandle.commands.navigateToReference("note")
    || !footnotesHandle.commands.navigateToDefinition("note")
    || !footnotesHandle.commands.removeDefinition(
      { label: "note" },
      { references: "preserve" },
    )
    || footnotesHandle.state.getDiagnostics()[0]?.code !== "unresolved-reference"
    || !footnotesEditor.commands.undo()
  ) {
    throw new Error("Packed footnotes " + label + " command, state, or history smoke failed.");
  }
  footnotesEditor.destroy();

  element.replaceChildren();
  const mathDefinition = math.createMathExtension();
  const mathEditor = create({
    element,
    extensions: [mathDefinition],
    markdown: "Math: $x$\\n\\n$$\\ny\\n$$",
  });
  const mathHandle = mathEditor.extensions.get(mathDefinition);
  const mathSnapshot = mathHandle.state.getSnapshot();
  if (
    mathSnapshot.nodes.length !== 2
    || mathSnapshot.nodes[0]?.kind !== "inline"
    || mathSnapshot.nodes[1]?.kind !== "block"
    || mathEditor.getMarkdown() !== "Math: $x$\\n\\n$$\\ny\\n$$"
    || !mathEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-math"
    ))
  ) {
    throw new Error("Packed math " + label + " consumer lost semantic or manifest state.");
  }
  if (
    !mathHandle.commands.update(mathSnapshot.nodes[0], "z")
    || mathEditor.getMarkdown() !== "Math: $z$\\n\\n$$\\ny\\n$$"
    || !mathEditor.commands.undo()
    || mathEditor.getMarkdown() !== "Math: $x$\\n\\n$$\\ny\\n$$"
  ) {
    throw new Error("Packed math " + label + " command or history smoke failed.");
  }
  mathEditor.destroy();

  element.replaceChildren();
  const tocDefinition = toc.createTocExtension({
    messages: {
      goToHeadingLabel: (headingLabel, level, index) =>
        "Go to packed heading " + index + ", level " + level + ": " + headingLabel,
      navigationLabel: (occurrence, total) =>
        "Packed contents " + occurrence + " of " + total,
    },
  });
  const tocEditor = create({
    element,
    extensions: [tocDefinition],
    markdown: "[toc]\\n\\n# Packed heading\\n\\n## Packed child\\n\\n[TOC]",
  });
  const tocHandle = tocEditor.extensions.get(tocDefinition);
  const tocSnapshot = tocHandle.state.getSnapshot();
  const tocNavs = [...tocEditor.view.dom.querySelectorAll("nav[data-mdw-toc]")];
  const secondEntry = tocNavs[0]?.querySelector('[data-mdw-toc-entry="2"]');
  if (
    tocSnapshot.headings.length !== 2
    || tocSnapshot.headings[0]?.label !== "Packed heading"
    || tocSnapshot.headings[0]?.level !== 1
    || tocSnapshot.headings[1]?.label !== "Packed child"
    || tocSnapshot.headings[1]?.level !== 2
    || tocSnapshot.tocs.length !== 2
    || tocEditor.getMarkdown()
      !== "[TOC]\\n\\n# Packed heading\\n\\n## Packed child\\n\\n[TOC]"
    || tocNavs.length !== 2
    || tocNavs[0]?.getAttribute("aria-label") !== "Packed contents 1 of 2"
    || tocNavs[1]?.getAttribute("aria-label") !== "Packed contents 2 of 2"
    || tocNavs.some((nav) => nav.querySelectorAll("[data-mdw-toc-entry]").length !== 2)
    || secondEntry === null
    || !Object.isFrozen(tocSnapshot)
    || !Object.isFrozen(tocSnapshot.headings)
    || !tocEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-toc"
    ))
  ) {
    throw new Error("Packed TOC " + label + " consumer lost semantic, DOM, or manifest state.");
  }
  secondEntry.click();
  if (
    tocEditor.view.state.selection.from !== tocSnapshot.headings[1].position + 1
    || tocEditor.view.dom.querySelector("h1[id], h2[id]") !== null
  ) {
    throw new Error("Packed TOC " + label + " model-position navigation failed.");
  }
  if (
    !tocHandle.state.canInsert()
    || !tocHandle.commands.insert()
    || tocHandle.state.getSnapshot().tocs.length !== 3
    || !tocHandle.state.isActive()
    || !tocHandle.state.canRemove()
    || !tocEditor.commands.undo()
    || tocHandle.state.getSnapshot().tocs.length !== 2
    || !tocEditor.commands.redo()
    || tocHandle.state.getSnapshot().tocs.length !== 3
    || !tocHandle.commands.remove()
    || tocHandle.state.getSnapshot().tocs.length !== 2
    || !tocEditor.commands.undo()
    || tocHandle.state.getSnapshot().tocs.length !== 3
  ) {
    throw new Error("Packed TOC " + label + " command, state, or history smoke failed.");
  }
  tocEditor.destroy();
  element.remove();
}

const htmlElement = ownerWindow.document.createElement("div");
ownerWindow.document.body.append(htmlElement);
const HTML_BLOCK = [
  "<script>",
  "globalThis.__markoraPackedHtmlExecuted = true;",
  "</script>",
].join("\\r\\n");
const HTML_INLINE = '<img src="/must-not-load.png" onerror="globalThis.__markoraPackedHtmlExecuted = true">';
const HTML_MARKDOWN = HTML_BLOCK + "\\r\\n\\r\\nBefore " + HTML_INLINE + " after.";
const htmlDefinition = html.createHtmlExtension({
  renderer({ ownerDocument, signal, source }) {
    const article = ownerDocument.createElement("article");
    article.className = "host-renderer-class";
    article.id = "host-renderer-id";
    article.dataset.hostRenderer = "dropped";
    article.setAttribute("aria-label", "dropped");
    article.setAttribute("role", "document");
    article.title = "Packed sanitized preview";
    const strong = ownerDocument.createElement("strong");
    strong.textContent = source;
    article.append(strong);
    signal.addEventListener("abort", () => undefined, { once: true });
    return article;
  },
});
const htmlEditor = createEditor({
  element: htmlElement,
  extensions: [htmlDefinition],
  markdown: HTML_MARKDOWN,
});
const htmlHandle = htmlEditor.extensions.get(htmlDefinition);
const initialHtmlNodes = htmlHandle.state.getNodes();
if (
  initialHtmlNodes.length !== 2
  || initialHtmlNodes[0]?.display !== "block"
  || initialHtmlNodes[0]?.kind !== "html-block"
  || initialHtmlNodes[0]?.source !== HTML_BLOCK
  || initialHtmlNodes[1]?.display !== "inline"
  || initialHtmlNodes[1]?.kind !== "inline-html"
  || initialHtmlNodes[1]?.source !== HTML_INLINE
  || htmlEditor.getMarkdown() !== HTML_BLOCK + "\\n\\nBefore " + HTML_INLINE + " after."
  || !htmlEditor.extensions.manifest.extensions.some(({ name }) => (
    name === "markora-extension-html"
  ))
) {
  throw new Error("Packed HTML root consumer lost exact source, atom classification, or manifest state.");
}

let preview = null;
for (let attempt = 0; attempt < 100; attempt += 1) {
  preview = htmlEditor.view.dom.querySelector("[data-mdw-html-preview]");
  if (preview?.querySelector("article > strong")) break;
  await new Promise((resolve) => ownerWindow.setTimeout(resolve, 10));
}
const sanitizedArticle = preview?.querySelector("article");
if (
  !sanitizedArticle
  || sanitizedArticle.textContent !== HTML_BLOCK
  || sanitizedArticle.title !== "Packed sanitized preview"
  || sanitizedArticle.hasAttribute("class")
  || sanitizedArticle.hasAttribute("id")
  || sanitizedArticle.hasAttribute("data-host-renderer")
  || sanitizedArticle.hasAttribute("aria-label")
  || sanitizedArticle.hasAttribute("role")
  || preview.getAttribute("aria-hidden") !== "true"
  || !preview.hasAttribute("inert")
  || htmlEditor.view.dom.querySelector("script, img, iframe, object, embed") !== null
  || globalThis.__markoraPackedHtmlExecuted !== undefined
) {
  throw new Error("Packed HTML root consumer failed the inert, clamped renderer smoke.");
}

const initialBlock = initialHtmlNodes[0];
const UPDATED_HTML_BLOCK = '<section data-packed="updated">\\r\\nUpdated\\r\\n</section>';
if (
  !htmlHandle.commands.update(initialBlock, UPDATED_HTML_BLOCK)
  || htmlHandle.state.getNodes("block")[0]?.source !== UPDATED_HTML_BLOCK
  || htmlEditor.getMarkdown() !== UPDATED_HTML_BLOCK + "\\n\\nBefore " + HTML_INLINE + " after."
  || !htmlEditor.commands.undo()
  || htmlHandle.state.getNodes("block")[0]?.source !== HTML_BLOCK
  || htmlEditor.getMarkdown() !== HTML_BLOCK + "\\n\\nBefore " + HTML_INLINE + " after."
) {
  throw new Error("Packed HTML root consumer command, exact-source, or history smoke failed.");
}
htmlEditor.destroy();
htmlElement.remove();
delete globalThis.__markoraPackedHtmlExecuted;

const minimalHtmlElement = ownerWindow.document.createElement("div");
const minimalHtmlSentinel = ownerWindow.document.createElement("span");
minimalHtmlSentinel.textContent = "minimal HTML sentinel";
minimalHtmlElement.append(minimalHtmlSentinel);
ownerWindow.document.body.append(minimalHtmlElement);
let minimalHtmlError;
try {
  const unexpectedEditor = createMinimalEditor({
    element: minimalHtmlElement,
    extensions: [html.createHtmlExtension()],
    markdown: "<div>must not be claimed</div>",
  });
  unexpectedEditor.destroy();
} catch (error) {
  minimalHtmlError = error;
}
if (
  minimalHtmlError?.code !== "EXTENSION_INCOMPATIBLE"
  || minimalHtmlError?.extension !== "markora-extension-html"
  || minimalHtmlError?.phase !== "resolve"
  || minimalHtmlElement.firstChild !== minimalHtmlSentinel
  || minimalHtmlElement.childNodes.length !== 1
  || minimalHtmlElement.classList.contains("mdw-host")
) {
  throw new Error("Packed HTML minimal consumer was not rejected before host claim.");
}
minimalHtmlElement.remove();

ownerWindow.close();
`);

currentPhase = "consumer-typecheck";
run("node", [tscCliPath, "-p", "tsconfig.json"], { cwd: smokeAppDir });
currentPhase = "node-import-smoke";
run("node", ["--input-type=module", "-e", `
  const extensionApi = await import("markora/extension-api");
  const alerts = await import("markora-extension-alerts");
  const frontmatter = await import("markora-extension-frontmatter");
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
    || htmlDefinition.compatibility?.runtime !== "root-default"
    || html.htmlDisplays.join(":") !== "block:inline"
    || html.htmlSourceKinds.join(":") !== "html-block:inline-html:html-comment"
    || typeof html.defaultHtmlMessages.sourceLabel("html-block") !== "string"
  ) {
    throw new Error("HTML package factory returned the wrong identity, compatibility, or surface");
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

currentPhase = "bundle-validation";
const rootBundleReport = readBundleReport("root");
const minimalBundleReport = readBundleReport("minimal");
const extensionBundleReports = Object.freeze(Object.fromEntries(
  extensionBundleSpecs.map((spec) => [spec.graphName, readBundleReport(spec.graphName)]),
));
const alertsBundleReport = extensionBundleReports.alerts;
const frontmatterBundleReport = extensionBundleReports.frontmatter;
const footnotesBundleReport = extensionBundleReports.footnotes;
const htmlBundleReport = extensionBundleReports.html;
const mathBundleReport = extensionBundleReports.math;
const tocBundleReport = extensionBundleReports.toc;
const rootBundleMeasurement = measureBundleGraph(rootBundleReport);
const minimalBundleMeasurement = measureBundleGraph(minimalBundleReport);
const extensionBundleMeasurements = Object.freeze(Object.fromEntries(
  extensionBundleSpecs.map((spec) => [
    spec.graphName,
    measureBundleGraph(extensionBundleReports[spec.graphName]),
  ]),
));
const alertsBundleMeasurement = extensionBundleMeasurements.alerts;
const frontmatterBundleMeasurement = extensionBundleMeasurements.frontmatter;
const footnotesBundleMeasurement = extensionBundleMeasurements.footnotes;
const htmlBundleMeasurement = extensionBundleMeasurements.html;
const mathBundleMeasurement = extensionBundleMeasurements.math;
const tocBundleMeasurement = extensionBundleMeasurements.toc;
const extensionBundles = extensionBundleSpecs.map((spec) => ({
  measurement: extensionBundleMeasurements[spec.graphName],
  report: extensionBundleReports[spec.graphName],
  spec,
}));
assertBundleIsolation(rootBundleReport, minimalBundleReport);
for (const { report, spec } of extensionBundles) {
  assertExtensionBundleIsolation(report, spec);
}
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

const measurements = Object.freeze({
  alerts: alertsBundleMeasurement,
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
