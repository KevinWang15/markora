import { rm, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
await rm("dist", { recursive: true, force: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { stdio: "inherit", shell: process.platform === "win32" });
execFileSync(process.execPath, ["../../scripts/fix-node-esm-specifiers.mjs", "dist"], { stdio: "inherit" });
// A self-contained classic script also works in an opaque-origin sandbox and
// in packaged file:// applications. Hosts emit it as a lazy URL asset.
await build({ entryPoints: ["src/plantuml-frame.ts"], outfile: "dist/plantuml-frame.js", bundle: true,
  format: "iife", platform: "browser", target: "es2022", minifyWhitespace: true, legalComments: "inline",
  // Keep notices in the asset itself: host bundlers copy this URL independently.
  banner: { js: await readFile("node_modules/@plantuml/core/LICENSE", "utf8") },
  // Viz's Node-only branch is unreachable in this browser frame. PlantUML's
  // package currently mislabels its global theme registration as side-effect-free.
  external: ["url"], ignoreAnnotations: true });
execFileSync(process.execPath, ["--check", "dist/plantuml-frame.js"], { stdio: "inherit" });
await copyFile("src/styles.css", "dist/styles.css");
