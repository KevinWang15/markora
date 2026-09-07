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

// Reuse the ICO's original 256px PNG without resampling. An ICNS ic08 element
// wraps that PNG for Finder/Dock; the renderer continues using the SVG.
const ico = await readFile(path.join(packageRoot, "public", "icon.ico"));
let iconPng;
for (let index = 0; index < ico.readUInt16LE(4); index += 1) {
  const entry = 6 + index * 16;
  if (ico[entry] !== 0 || ico[entry + 1] !== 0) continue;
  const size = ico.readUInt32LE(entry + 8);
  const offset = ico.readUInt32LE(entry + 12);
  iconPng = ico.subarray(offset, offset + size);
  break;
}
if (!iconPng || !iconPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error("The application ICO must contain a 256px PNG for macOS packaging.");
}
const iconHeader = Buffer.alloc(16);
iconHeader.write("icns", 0);
iconHeader.writeUInt32BE(16 + iconPng.length, 4);
iconHeader.write("ic08", 8);
iconHeader.writeUInt32BE(8 + iconPng.length, 12);
await writeFile(path.join(packageRoot, "dist", "icon.icns"), Buffer.concat([iconHeader, iconPng]));
