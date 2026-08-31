import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = path.join(packageRoot, "nw-manifest.json");
const outputPath = path.join(packageRoot, "dist", "package.json");
const licenseSource = path.resolve(packageRoot, "..", "..", "LICENSE");
const licenseOutput = path.join(packageRoot, "dist", "LICENSE");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await copyFile(licenseSource, licenseOutput);
