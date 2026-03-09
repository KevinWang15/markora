import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2] ?? "check";
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.resolve(rootDir, "../packages/core");
const npmCachePath = path.resolve(rootDir, "../.npm-cache");

mkdirSync(npmCachePath, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: packagePath,
    shell: process.platform === "win32",
    env: {
      ...process.env,
      npm_config_cache: npmCachePath,
      NPM_CONFIG_CACHE: npmCachePath,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function usage() {
  console.log("Usage: node ./scripts/release-core.mjs <check|pack|publish>");
}

if (!["check", "pack", "publish"].includes(mode)) {
  usage();
  process.exit(1);
}

run("pnpm", ["run", "build"]);
run("pnpm", ["run", "typecheck"]);

if (mode === "check") {
  run("npm", ["pack", "--dry-run"]);
  process.exit(0);
}

run("npm", ["pack"]);

if (mode === "pack") {
  process.exit(0);
}

run("npm", ["publish", "--access", "public"]);
