type MarkdownEditorOriginalSource = Readonly<{
  ends: readonly number[];
  source: string;
  starts: readonly number[];
}>;

const originalSources = new WeakMap<object, MarkdownEditorOriginalSource>();

function createOriginalSource(source: string): MarkdownEditorOriginalSource {
  const starts = [0];
  const ends: number[] = [];
  const lineEnding = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;

  while ((match = lineEnding.exec(source))) {
    ends.push(match.index);
    starts.push(match.index + match[0].length);
  }

  ends.push(source.length);
  return Object.freeze({
    ends: Object.freeze(ends),
    source,
    starts: Object.freeze(starts),
  });
}

/** @internal Create one mutable Markdown-it environment with private source metadata. */
export function createMarkdownEditorSourceEnvironment(source: string): object {
  const environment = {};
  originalSources.set(environment, createOriginalSource(source));
  return environment;
}

/**
 * Return an exact half-open, zero-based line range from Markora's original
 * Markdown input. Invalid ranges and foreign environments return `null`.
 */
export function sliceMarkdownEditorOriginalSourceLines(
  environment: unknown,
  startLine: number,
  endLine: number,
): string | null {
  if (
    typeof environment !== "object"
    || environment === null
    || !Number.isSafeInteger(startLine)
    || !Number.isSafeInteger(endLine)
    || startLine < 0
    || endLine <= startLine
  ) {
    return null;
  }

  const original = originalSources.get(environment);

  if (!original) {
    return null;
  }

  const start = original.starts[startLine];
  const end = original.ends[endLine - 1];

  if (start === undefined || end === undefined || end < start) {
    return null;
  }

  return original.source.slice(start, end);
}
