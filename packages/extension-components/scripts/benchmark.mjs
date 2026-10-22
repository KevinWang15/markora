import { performance } from "node:perf_hooks";
import { EditorState, Schema } from "markora/extension-api";
import { buildComponentIdentities, collectChangedComponents, mapComponentIdentities } from "../dist/identity.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    custom_component: { group: "block", atom: true, attrs: { name: {}, source: {} } },
    text: {},
  },
});
const results = [];
for (const paragraphs of [1_000, 10_000]) {
  for (const components of [1, 100]) {
    const blocks = Array.from({ length: paragraphs }, (_, index) =>
      schema.nodes.paragraph.create(null, schema.text(`Paragraph ${index}: ordinary Markdown content.`)));
    for (let index = 0; index < components; index++) {
      blocks.splice(Math.floor(index * paragraphs / components), 0,
        schema.nodes.custom_component.create({ name: "chart", source: "{}" }));
    }
    const doc = schema.nodes.doc.create(null, blocks);
    const state = EditorState.create({ doc });
    const previous = buildComponentIdentities(doc);
    const positions = [];
    doc.descendants((node, position) => { if (node.type.name === "paragraph") positions.push(position + 1); });
    for (const mode of ["incremental", "full-scan-baseline"]) {
      const samples = [];
      for (let sample = 0; sample < 220; sample++) {
        const transaction = state.tr.insertText("x", positions[(sample * 97) % positions.length]);
        const start = performance.now();
        if (mode === "incremental") {
          collectChangedComponents(transaction);
          mapComponentIdentities(transaction, previous);
        } else {
          transaction.doc.descendants(node => { if (node.type.name === "custom_component") String(node.attrs.source); });
          buildComponentIdentities(transaction.doc);
        }
        if (sample >= 20) samples.push(performance.now() - start);
      }
      samples.sort((left, right) => left - right);
      results.push({ paragraphs, components, mode, p50_ms: +samples[100].toFixed(3), p95_ms: +samples[190].toFixed(3) });
    }
  }
}
console.table(results);
