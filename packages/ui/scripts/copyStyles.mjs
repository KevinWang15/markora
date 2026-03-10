import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const sourcePath = resolve(packageRoot, "src/styles.css");
const outputPath = resolve(packageRoot, "dist/styles.css");

await mkdir(dirname(outputPath), { recursive: true });
await copyFile(sourcePath, outputPath);
