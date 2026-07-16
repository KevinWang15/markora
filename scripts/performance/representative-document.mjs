export const REPRESENTATIVE_DOCUMENT_VERSION = "mixed-embedded-v1";
export const REPRESENTATIVE_DOCUMENT_TARGETS = Object.freeze([
  100 * 1024,
  500 * 1024,
  1024 * 1024,
]);

const SECTION_PADDING_RESERVE = 32;

function createSection(index) {
  const id = String(index).padStart(4, "0");
  const prose = Array.from({ length: 8 }, (_, paragraphIndex) => (
    `Section ${id} paragraph ${paragraphIndex + 1} records an embedded editor workload with `
    + "review notes, inline `code`, **strong context**, _emphasis_, and a "
    + `[relative reference](/docs/${id}/${paragraphIndex + 1}). `
    + "The repeated prose keeps line wrapping and inline mark parsing representative without remote content."
  )).join("\n\n");
  const nestedList = [
    `1. Section ${id} planning item`,
    "   - Collect the current input",
    "     - Compare the supported Markdown shape",
    "       - Preserve a fourth-level nested detail",
    "   - Record the host integration result",
    "2. Verification item",
    "   - Exercise keyboard and pointer paths",
    "     - Retain an actionable nested follow-up",
  ].join("\n");
  const tableHeader = "| Check | Owner | State | Evidence |";
  const tableDivider = "| :--- | :---: | ---: | --- |";
  const tableRows = Array.from({ length: 12 }, (_, rowIndex) => (
    `| check-${id}-${String(rowIndex + 1).padStart(2, "0")} | team-${rowIndex % 4} | ${rowIndex * 7}% | reviewed value ${rowIndex + 1} |`
  )).join("\n");
  const table = [tableHeader, tableDivider, tableRows].join("\n");
  const code = Array.from({ length: 36 }, (_, lineIndex) => (
    `const metric_${id}_${String(lineIndex + 1).padStart(2, "0")} = measure("section-${id}", ${lineIndex + 1}, { stable: true });`
  )).join("\n");
  const codeBlock = ["```", code, "```"].join("\n");

  return [
    `## Representative section ${id}`,
    prose,
    nestedList,
    table,
    codeBlock,
    `![Architecture ${id}](/assets/architecture-${id}.png)`,
    `Inline image ![Status ${id}](/assets/status-${id}.webp) remains beside ordinary text.`,
  ].join("\n\n");
}

function assertTargetBytes(targetBytes) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1024) {
    throw new RangeError("Representative document targetBytes must be an integer of at least 1024.");
  }
}

export function createRepresentativeDocument(targetBytes) {
  assertTargetBytes(targetBytes);

  const chunks = [
    "# Markora representative embedded document\n\n"
      + "This deterministic fixture combines prose, inline marks, links, nested lists, tables, code blocks, and images."
  ];
  let byteLength = chunks[0].length;
  let sections = 0;

  while (true) {
    const section = `\n\n${createSection(sections + 1)}`;
    if (byteLength + section.length + SECTION_PADDING_RESERVE > targetBytes) {
      break;
    }

    chunks.push(section);
    byteLength += section.length;
    sections += 1;
  }

  if (sections === 0) {
    throw new RangeError("Representative document target is too small for one mixed-content section.");
  }

  const remaining = targetBytes - byteLength;
  const paddingPrefix = "\n\nBenchmark padding: ";
  chunks.push(
    remaining >= paddingPrefix.length
      ? paddingPrefix + "x".repeat(remaining - paddingPrefix.length)
      : "x".repeat(remaining),
  );

  const markdown = chunks.join("");
  if (markdown.length !== targetBytes || /[^\x00-\x7f]/u.test(markdown)) {
    throw new Error("Representative document generation did not produce the requested ASCII byte length.");
  }

  return Object.freeze({
    markdown,
    stats: Object.freeze({
      bytes: markdown.length,
      codeBlocks: sections,
      images: sections * 2,
      nestedLists: sections,
      sections,
      tables: sections,
      targetBytes,
      version: REPRESENTATIVE_DOCUMENT_VERSION,
    }),
  });
}
