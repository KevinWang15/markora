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

writeFileSync(join(smokeAppDir, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Markora Pack Smoke</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`);

mkdirSync(join(smokeAppDir, "src"), { recursive: true });
writeFileSync(join(smokeAppDir, "src/main.js"), `import {
  createEditor,
  createDefaultCodeBlockLanguageRegistry,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
} from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const app = document.querySelector("#app");

if (!app) {
  throw new Error("Smoke app root not found.");
}

app.textContent = [
  typeof createEditor,
  typeof createDefaultCodeBlockLanguageRegistry,
  typeof getMarkdownEditorTransactionOrigin,
  typeof setMarkdownEditorTransactionOrigin,
  typeof createDefaultUi,
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
void new MarkdownEditorDestroyedError("focus the editor");
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
run("node", [viteCliPath, "build"], { cwd: smokeAppDir });

console.log(`Pack smoke test passed in ${smokeAppDir}`);
