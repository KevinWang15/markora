import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..");
const packageRoot = process.cwd();
const copyStylesPath = resolve(packageRoot, "scripts/copyStyles.mjs");
const typescriptPath = resolve(workspaceRoot, "node_modules/typescript/bin/tsc");
const stylePaths = process.argv.slice(2).map((path) => resolve(packageRoot, path));

if (stylePaths.length === 0) {
  throw new Error("dev-package.mjs requires at least one stylesheet path to watch.");
}

await Promise.all([
  access(copyStylesPath),
  access(typescriptPath),
  ...stylePaths.map((path) => access(path)),
]);

function runNode(scriptPath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: packageRoot,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(
          `${scriptPath} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
        ));
      }
    });
  });
}

await runNode(copyStylesPath);

let copyTimer;
let copyRunning = false;
let copyQueued = false;

async function copyChangedStyles() {
  if (copyRunning) {
    copyQueued = true;
    return;
  }

  copyRunning = true;

  do {
    copyQueued = false;

    try {
      await runNode(copyStylesPath);
    } catch (error) {
      console.error(error);
    }
  } while (copyQueued);

  copyRunning = false;
}

function scheduleStyleCopy() {
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyTimer = undefined;
    void copyChangedStyles();
  }, 50);
}

const styleWatchers = stylePaths.map((path) => watch(path, scheduleStyleCopy));
const typeScript = spawn(
  process.execPath,
  [typescriptPath, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
  {
    cwd: packageRoot,
    stdio: "inherit",
  },
);

let shuttingDown = false;

function closeWatchers() {
  clearTimeout(copyTimer);

  for (const watcher of styleWatchers) {
    watcher.close();
  }
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  closeWatchers();
  typeScript.kill(signal);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

typeScript.once("error", (error) => {
  closeWatchers();
  console.error(error);
  process.exitCode = 1;
});

typeScript.once("exit", (code, signal) => {
  closeWatchers();

  if (!shuttingDown && (code !== 0 || signal)) {
    process.exitCode = code ?? 1;
  }
});
