import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceNodeModulesDir = resolve(rootDir, "node_modules/.pnpm/node_modules");
const npmCachePath = resolve(rootDir, ".npm-cache");
const tempRoot = mkdtempSync(join(tmpdir(), "markora-pack-smoke-"));
const tarballRoot = join(tempRoot, "tarballs");
const smokeAppDir = join(tempRoot, "app");
const smokeNodeModulesDir = join(smokeAppDir, "node_modules");
const viteCliPath = resolve(rootDir, "packages/demo/node_modules/vite/bin/vite.js");
const tscCliPath = resolve(rootDir, "node_modules/typescript/bin/tsc");
const rootPackageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

mkdirSync(npmCachePath, { recursive: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(smokeAppDir, { recursive: true });
mkdirSync(smokeNodeModulesDir, { recursive: true });

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

    process.exit(result.status ?? 1);
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
        emittedModuleIds: [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)))].sort(),
        chunks: chunks.map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          renderedBytes: Buffer.byteLength(chunk.code),
          moduleIds: Object.keys(chunk.modules).sort(),
        })),
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
    minify: false,
    outDir: ${JSON.stringify(`dist/${label}`)},
  },
  plugins: [createModuleGraphPlugin()],
};
`);
}

function normalizeModuleId(moduleId) {
  return moduleId.replaceAll("\\", "/").replace(/\?.*$/, "");
}

function readBundleReport(label) {
  const outputDir = join(smokeAppDir, "dist", label);
  const report = JSON.parse(readFileSync(join(outputDir, "module-graph.json"), "utf8"));
  const chunkSource = report.chunks
    .map((chunk) => readFileSync(join(outputDir, chunk.fileName), "utf8"))
    .join("\n");

  return {
    ...report,
    outputDir,
    chunkSource,
    staticModuleIds: report.staticModuleIds.map(normalizeModuleId),
    emittedModuleIds: report.emittedModuleIds.map(normalizeModuleId),
  };
}

function moduleIdIncludes(moduleId, fragment) {
  return normalizeModuleId(moduleId).includes(fragment);
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
    "/node_modules/markora/dist/tableNavigation.js",
    "/node_modules/markora/dist/taskListUtils.js",
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

  if (!rootReport.staticModuleIds.some((moduleId) => moduleIdIncludes(
    moduleId,
    "/node_modules/@codemirror/",
  ))) {
    throw new Error("The compatibility bundle did not include CodeMirror, so the isolation assertion was not exercised.");
  }

  for (const externalExtensionName of ["@pack-smoke/callout", "@pack-smoke/highlight"]) {
    if (!minimalReport.chunkSource.includes(externalExtensionName)) {
      throw new Error(`The minimal bundle omitted external extension ${externalExtensionName}.`);
    }
  }

  const rootBytes = rootReport.chunks.reduce((total, chunk) => total + chunk.renderedBytes, 0);
  const minimalBytes = minimalReport.chunks.reduce((total, chunk) => total + chunk.renderedBytes, 0);

  console.log([
    "Packed bundle graph:",
    `  markora: ${rootBytes} bytes, ${rootReport.staticModuleIds.length} static modules`,
    `  markora/minimal: ${minimalBytes} bytes, ${minimalReport.staticModuleIds.length} static modules`,
  ].join("\n"));
}

const corePackage = packPackage(join(rootDir, "packages/core"));
const uiPackage = packPackage(join(rootDir, "packages/ui"));

copyWorkspaceDependencies();
unpackPackage(corePackage.name, corePackage.tarballPath);
unpackPackage(uiPackage.name, uiPackage.tarballPath);

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
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorEventMap,
  type MarkdownEditorExtensionOrigin,
  type UpdateEditorOptions,
} from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
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
});
const externalExtensions: readonly AnyMarkdownEditorExtension[] = [
  packedCalloutExtension,
  packedHighlightExtension,
];
const minimalEditor = createMinimalEditor({
  element,
  extensions: externalExtensions,
  markdown: ":::note\\nPacked ==extension== consumer.\\n:::",
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
  event.selection.kind satisfies "all" | "managed-block" | "node" | "other" | "text";
  void origin;
});
const unsubscribeUpdate = editor.subscribe("update", (event: MarkdownEditorEventMap["update"]) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void origin;
});
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
editor.focus("start");
editor.blur();
editor.destroy();
minimalEditor.destroy();
MARKORA_EXTENSION_API_VERSION satisfies "1.0.0";
void new MarkdownEditorDestroyedError("focus the editor");
void staticDefinition;
void legacyCreateOptions;
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

run("node", [tscCliPath, "-p", "tsconfig.json"], { cwd: smokeAppDir });
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

writeBundleConfig("root", "./src/root.js");
writeBundleConfig("minimal", "./src/minimal.js");
run("node", [viteCliPath, "build", "--config", "vite.root.config.mjs"], { cwd: smokeAppDir });
run("node", [viteCliPath, "build", "--config", "vite.minimal.config.mjs"], { cwd: smokeAppDir });

const rootBundleReport = readBundleReport("root");
const minimalBundleReport = readBundleReport("minimal");
assertBundleIsolation(rootBundleReport, minimalBundleReport);
const minimalEntryChunk = minimalBundleReport.chunks.find((chunk) => chunk.isEntry);

if (!minimalEntryChunk) {
  throw new Error("The markora/minimal bundle did not emit an entry chunk.");
}

const minimalEntrySpecifier = `./dist/minimal/${minimalEntryChunk.fileName}`;
run("node", ["--input-type=module", "-e", `
  const consumer = await import(${JSON.stringify(minimalEntrySpecifier)});
  const names = consumer.packedExternalExtensions?.map((extension) => extension.name);
  if (names?.join(":") !== "@pack-smoke/callout:@pack-smoke/highlight") {
    throw new Error("Packed external extensions did not execute through the public API");
  }
`], { cwd: smokeAppDir });

console.log(`Pack smoke test passed in ${smokeAppDir}`);
