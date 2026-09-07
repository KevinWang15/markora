import path from "node:path";
import { chmod, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nwbuild from "nw-builder";

const NW_VERSION = "0.115.0";
const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const mode = process.argv[2];
const requestedPlatform = process.argv[3];
const requestedArch = process.argv[4];

if (mode !== "run" && mode !== "build") {
  throw new Error('Usage: node scripts/nw.mjs <run|build> [linux|osx|win] [x64|arm64]');
}

const hostPlatform = process.platform === "win32"
  ? "win"
  : process.platform === "darwin"
    ? "osx"
    : "linux";
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
const platform = requestedPlatform ?? hostPlatform;
const arch = requestedArch ?? hostArch;

if (!["linux", "osx", "win"].includes(platform)) {
  throw new Error(`Unsupported NW.js platform: ${platform}`);
}
if (!["x64", "arm64"].includes(arch)) {
  throw new Error(`Unsupported NW.js architecture: ${arch}`);
}
if (mode === "run" && (platform !== hostPlatform || arch !== hostArch)) {
  throw new Error(`Cannot run the ${platform}-${arch} NW.js runtime on ${hostPlatform}-${hostArch}. Use build instead.`);
}

const outDir = path.join(packageRoot, "release", `${platform}-${arch}`);
process.chdir(packageRoot);
const app = platform === "win"
  ? {
      name: "Markora",
      version: "0.1.0",
      company: "Markora",
      fileDescription: "Markora Markdown Editor",
      fileVersion: "0.1.0",
      internalName: "markora-app",
      originalFilename: "Markora.exe",
      productName: "Markora",
      productVersion: "0.1.0",
      icon: path.join(packageRoot, "dist", "icon.ico"),
    }
  : platform === "osx"
    ? {
        name: "Markora",
        icon: path.join(packageRoot, "dist", "icon.icns"),
        NSHumanReadableCopyright: "Copyright (c) 2026 Kevin Wang. MIT License.",
        CFBundleIdentifier: "app.markora.desktop",
        CFBundleName: "Markora",
        CFBundleDisplayName: "Markora",
        CFBundleVersion: "0.1.0",
        CFBundleShortVersionString: "0.1.0",
        LSApplicationCategoryType: "public.app-category.productivity",
      }
    : {
        name: "Markora",
        genericName: "Markdown Editor",
        comment: "A calm, local-first Markdown writing application",
        icon: path.join(outDir, "package.nw", "icon.svg"),
        categories: ["Office", "TextEditor"],
        keywords: ["Markdown", "Editor", "Writing"],
        mimeType: ["text/markdown", "text/plain"],
        exec: path.join(outDir, "Markora"),
        startupNotify: true,
        startupWMClass: "markora-main",
        singleMainWindow: "true",
      };

await nwbuild({
  mode,
  version: NW_VERSION,
  flavor: mode === "run" ? "sdk" : "normal",
  srcDir: "./dist",
  outDir,
  cacheDir: path.join(repositoryRoot, ".cache", "nwjs"),
  platform,
  arch,
  glob: false,
  zip: false,
  ...(mode === "run"
    ? { argv: ["--remote-debugging-port=9223"] }
    : { app }),
});

if (mode === "build" && platform === "linux") {
  const installerDestination = path.join(outDir, "install.sh");
  await copyFile(
    path.join(packageRoot, "packaging", "linux", "install.sh"),
    installerDestination,
  );
  await chmod(installerDestination, 0o755);
}
