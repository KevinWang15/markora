import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const [, , sourcePath, destinationPath] = process.argv;

if (!sourcePath || !destinationPath) {
  throw new TypeError("Usage: node scripts/import-gfm-spec.mjs <spec.txt> <fixture.json>");
}

const source = readFileSync(resolve(sourcePath), "utf8").replace(/\r\n?/g, "\n");
if (!source.includes("version: 0.29") || !source.includes("date: '2019-04-06'")) {
  throw new Error("The input is not the pinned GFM 0.29 specification source.");
}

const lines = source.split("\n");
const fence = "````````````````````````````````";
const cases = [];
let section = "Introduction";

for (let index = 0; index < lines.length; index += 1) {
  const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
  if (heading) {
    section = heading[2].replace(/\s+\(extension\)$/u, "");
  }

  if (!lines[index].startsWith(`${fence} example`)) {
    continue;
  }

  const extensions = lines[index]
    .slice(`${fence} example`.length)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const markdownLines = [];
  index += 1;

  while (index < lines.length && lines[index] !== ".") {
    markdownLines.push(lines[index].replaceAll("→", "\t"));
    index += 1;
  }

  if (lines[index] !== ".") {
    throw new Error(`GFM example ${cases.length + 1} has no Markdown/HTML divider.`);
  }

  index += 1;
  while (index < lines.length && lines[index] !== fence) {
    index += 1;
  }
  if (lines[index] !== fence) {
    throw new Error(`GFM example ${cases.length + 1} has no closing fence.`);
  }

  cases.push({
    example: cases.length + 1,
    section,
    extensions,
    markdown: `${markdownLines.join("\n")}\n`,
  });
}

if (cases.length !== 672) {
  throw new Error(`Expected 672 GFM examples, received ${cases.length}.`);
}

const fixture = {
  schemaVersion: 1,
  source: {
    id: "gfm-0.29",
    title: "GitHub Flavored Markdown Specification 0.29-gfm",
    url: "https://github.github.com/gfm/",
    input: "https://raw.githubusercontent.com/github/cmark-gfm/828322d1ee4facdab56f0d3edccb13e9af90dcd2/test/spec.txt",
    sha256: createHash("sha256").update(source).digest("hex"),
    license: "CC BY-SA 4.0",
  },
  cases,
};

writeFileSync(resolve(destinationPath), `${JSON.stringify(fixture, null, 2)}\n`);
