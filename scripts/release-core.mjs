import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2] ?? "check";
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.resolve(rootDir, "../packages/core");
const npmCachePath = path.resolve(rootDir, "../.npm-cache");
const artifactPath = path.resolve(rootDir, "../artifacts/npm");
const packageJson = JSON.parse(readFileSync(path.join(packagePath, "package.json"), "utf8"));
const registry = "https://registry.npmjs.org/";

process.umask(0o022);
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

if (packageJson.name !== "markora" || packageJson.publishConfig?.registry !== registry) {
  throw new Error("The core release must target markora on the public npm registry.");
}

run("pnpm", ["run", "build"]);
run("pnpm", ["run", "typecheck"]);
run("pnpm", ["run", "typecheck:api"]);
run("pnpm", ["run", "smoke:node-esm"]);

const { MARKORA_VERSION } = await import(pathToFileURL(path.join(packagePath, "dist/extensionVersion.js")).href);
if (MARKORA_VERSION !== packageJson.version) {
  throw new Error(`Runtime version ${MARKORA_VERSION} does not match package version ${packageJson.version}.`);
}

if (mode === "check") {
  run("npm", ["pack", "--dry-run"]);
  process.exit(0);
}

mkdirSync(artifactPath, { recursive: true });
run("npm", ["pack", "--pack-destination", artifactPath]);
const tarballPath = path.join(artifactPath, `markora-${packageJson.version}.tgz`);
const checksum = createHash("sha256").update(readFileSync(tarballPath)).digest("hex");
writeFileSync(`${tarballPath}.sha256`, `${checksum}  ${path.basename(tarballPath)}\n`);
chmodSync(tarballPath, 0o644);
chmodSync(`${tarballPath}.sha256`, 0o644);
console.log(`Prepared ${tarballPath}\nSHA-256: ${checksum}`);

if (mode === "pack") {
  process.exit(0);
}

run("npm", ["publish", tarballPath, "--access", "public", "--tag", "latest", "--registry", registry]);
