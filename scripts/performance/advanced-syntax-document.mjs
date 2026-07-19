export const ADVANCED_SYNTAX_DOCUMENT_VERSION = "all-seven-source-v1";
export const ADVANCED_SYNTAX_DOCUMENT_TARGETS = Object.freeze([
  100 * 1024,
  500 * 1024,
  1024 * 1024,
]);

const diagramKinds = Object.freeze(["mermaid", "geojson", "topojson", "stl"]);
const paddingPrefix = "\n\nAdvanced syntax padding: ";

function createDiagram(kind, id) {
  if (kind === "mermaid") {
    return [
      `\`\`\`mermaid theme=neutral section=${id}`,
      "graph TD",
      `A${id}[\"$diagram-${id}$\"] --> B${id}`,
      "```",
    ].join("\n");
  }
  if (kind === "geojson") {
    return [
      `\`\`\`geojson section=${id}`,
      `{"type":"Point","coordinates":[${Number(id)},${Number(id) + 1}]}`,
      "```",
    ].join("\n");
  }
  if (kind === "topojson") {
    return [
      `\`\`\`topojson section=${id}`,
      `{"type":"Topology","objects":{"section${id}":{"type":"GeometryCollection","geometries":[]}},"arcs":[]}`,
      "```",
    ].join("\n");
  }
  return [
    `\`\`\`stl section=${id}`,
    `solid section_${id}`,
    `endsolid section_${id}`,
    "```",
  ].join("\n");
}

function createSection(index) {
  const id = String(index).padStart(4, "0");
  const kind = diagramKinds[(index - 1) % diagramKinds.length];
  const prose = Array.from({ length: 12 }, (_, paragraphIndex) => (
    `Section ${id} workload paragraph ${paragraphIndex + 1} keeps ordinary embedded-editor typing representative `
    + "with stable ASCII prose, **strong context**, *emphasis*, `inline code`, and a "
    + `[relative reference](/advanced/${id}/${paragraphIndex + 1}) around the optional syntax nodes.`
  )).join("\n\n");
  return [
    `## Advanced section ${id}`,
    createDiagram(kind, id),
    prose,
    `> [!NOTE]\n> Alert ${id} keeps semantic body text.`,
    `Section ${id} has inline math $x_${index}$, note[^note-${id}], and <span data-section="${id}">inline HTML</span>.`,
    `$$\ny_${index} = x_${index}^2\n$$`,
    `<div data-section="${id}">Block HTML ${id}</div>`,
    `[^note-${id}]: Footnote definition ${id}.`,
  ].join("\n\n");
}

function assertTarget(targetBytes) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 16 * 1024) {
    throw new RangeError("Advanced syntax targetBytes must be an integer of at least 16 KiB.");
  }
}

export function createAdvancedSyntaxDocument(targetBytes) {
  assertTarget(targetBytes);
  const chunks = [
    [
      "---",
      "title: All-seven advanced syntax performance fixture",
      "suite: EE-021",
      "---",
      "",
      "[TOC]",
      "",
      "# All-seven source workload",
    ].join("\n"),
  ];
  let bytes = chunks[0].length;
  let sections = 0;

  while (true) {
    const section = `\n\n${createSection(sections + 1)}`;
    if (bytes + section.length + paddingPrefix.length > targetBytes) break;
    chunks.push(section);
    bytes += section.length;
    sections += 1;
  }

  if (sections < diagramKinds.length) {
    throw new RangeError("Advanced syntax target is too small to contain every diagram kind.");
  }

  chunks.push(paddingPrefix + "x".repeat(targetBytes - bytes - paddingPrefix.length));
  const markdown = chunks.join("");
  if (markdown.length !== targetBytes || /[^\x00-\x7f]/u.test(markdown)) {
    throw new Error("Advanced syntax generation did not produce the requested ASCII byte length.");
  }

  return Object.freeze({
    markdown,
    stats: Object.freeze({
      alerts: sections,
      bytes: markdown.length,
      diagrams: sections,
      footnoteDefinitions: sections,
      footnoteReferences: sections,
      htmlBlocks: sections,
      htmlInlineAtoms: sections * 2,
      mathBlocks: sections,
      mathInline: sections,
      sections,
      targetBytes,
      tocs: 1,
      version: ADVANCED_SYNTAX_DOCUMENT_VERSION,
    }),
  });
}
