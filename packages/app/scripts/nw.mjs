import path from "node:path";
import { chmod, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nwbuild from "nw-builder";

const NW_VERSION = "0.115.0";
const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const mode = process.argv[2];

if (mode !== "run" && mode !== "build") {
  throw new Error('Usage: node scripts/nw.mjs <run|build>');
}

const platform = process.platform === "win32"
  ? "win"
  : process.platform === "darwin"
    ? "osx"
    : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
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
    }
  : platform === "osx"
    ? {
        name: "Markora",
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
        icon: path.join(packageRoot, "release", "package.nw", "icon.svg"),
        categories: ["Office", "TextEditor"],
        keywords: ["Markdown", "Editor", "Writing"],
        mimeType: ["text/markdown", "text/plain"],
        exec: path.join(packageRoot, "release", "Markora"),
        startupNotify: true,
        startupWMClass: "markora-main",
        singleMainWindow: "true",
      };

await nwbuild({
  mode,
  version: NW_VERSION,
  flavor: mode === "run" ? "sdk" : "normal",
  srcDir: "./dist",
  outDir: "./release",
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
  const installerDestination = path.join(packageRoot, "release", "install.sh");
  await copyFile(
    path.join(packageRoot, "packaging", "linux", "install.sh"),
    installerDestination,
  );
  await chmod(installerDestination, 0o755);
}
