export type DocumentOutlineItem = Readonly<{
  id: string;
  level: number;
  text: string;
}>;

export type RecentDocument = Readonly<{
  name: string;
  path: string;
  touchedAt: number;
}>;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".txt"]);

function pathBasename(path: string) {
  const segments = path.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<([^>]+)>/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .trim();
}

export function documentNameFromPath(path: string | null) {
  return path ? pathBasename(path) : "Untitled.md";
}

export function isMarkdownPath(path: string) {
  const match = /\.[^./\\]+$/u.exec(pathBasename(path));
  return match ? MARKDOWN_EXTENSIONS.has(match[0].toLowerCase()) : false;
}

export function parseDocumentOutline(markdown: string): readonly DocumentOutlineItem[] {
  const headings: DocumentOutlineItem[] = [];
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/u)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === marker) fence = null;
      else if (!fence) fence = marker;
      continue;
    }
    if (fence) continue;

    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) continue;

    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;

    headings.push({
      id: `heading-${headings.length + 1}`,
      level: match[1].length,
      text,
    });
  }

  return headings;
}

export function countDocumentCharacters(markdown: string) {
  return Array.from(markdown.replace(/\s/gu, "")).length;
}

export function countDocumentWords(markdown: string) {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    const segments = new Segmenter(undefined, { granularity: "word" }).segment(markdown);
    let count = 0;
    for (const segment of segments) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }

  return markdown.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

export function upsertRecentDocument(
  recents: readonly RecentDocument[],
  path: string,
  touchedAt = Date.now(),
  limit = 8,
) {
  const comparablePath = path.toLocaleLowerCase();
  return [
    { name: documentNameFromPath(path), path, touchedAt },
    ...recents.filter((item) => item.path.toLocaleLowerCase() !== comparablePath),
  ].slice(0, limit);
}

export function parseCommandLineArguments(commandLine: string) {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    const next = commandLine[index + 1];
    if (character === "\\" && quote !== "'" && (next === '"' || next === "\\" || /\s/u.test(next ?? ""))) {
      current += next;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) args.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  if (current) args.push(current);
  return args;
}

export function extractOpenPath(args: readonly string[]) {
  return args.find((argument) => !argument.startsWith("-") && isMarkdownPath(argument)) ?? null;
}
