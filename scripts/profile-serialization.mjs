import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { createMarkdownCodec } from "../packages/core/dist/markdownCodec.js";
import { createRepresentativeDocument, REPRESENTATIVE_DOCUMENT_TARGETS } from "./performance/representative-document.mjs";

// A focused diagnostic, not a replacement for the packed Chromium runtime gate.
// Run with node --cpu-prof --cpu-prof-dir=performance-results to inspect hot paths.
const codec = createMarkdownCodec();
const measurements = [];
for (const target of REPRESENTATIVE_DOCUMENT_TARGETS) {
  const { markdown } = createRepresentativeDocument(target);
  const doc = codec.parse(markdown);
  const expected = codec.serialize(doc);
  const samples = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const start = performance.now();
    const output = codec.serialize(doc);
    samples.push(performance.now() - start);
    if (output !== expected) throw new Error("Serialization changed between samples.");
  }
  measurements.push({ bytes: target, milliseconds: samples,
    outputSha256: createHash("sha256").update(expected).digest("hex") });
}
const report = { environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model }, measurements };
await mkdir("performance-results", { recursive: true });
await writeFile("performance-results/serialization.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
