import type { MarkdownEditorTokenizerRule } from "markora/extension-api";

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;

type InlineRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "inline" }
>["createRule"]>;

type CoreRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "core" }
>["createRule"]>;

type MarkdownToken = Parameters<CoreRule>[0]["tokens"][number];

export type FootnoteTokenMeta = Readonly<{
  label?: string;
}>;

type ProtectedRange = Readonly<{ end: number; start: number }>;

type SourceLine = Readonly<{
  end: number;
  index: number;
  start: number;
  text: string;
}>;

type SourceAnalysis = Readonly<{
  blockProtectedLines: ReadonlySet<number>;
  inlineMathShieldRanges: readonly ProtectedRange[];
  protectedRanges: readonly ProtectedRange[];
}>;

const sourceAnalysisByEnvironment = new WeakMap<object, Map<string, SourceAnalysis>>();
const definitionDepthByEnvironment = new WeakMap<object, number>();

const htmlVoidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const htmlBlockElements = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

const uriAutolinkPattern = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*>/y;
const emailAutolinkPattern = /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?>/y;
const htmlTagPrefixPattern = /<\s*(\/)?\s*([A-Za-z][A-Za-z0-9:._-]*)(?=[\t\n\f\r ]|\/?>)/y;
const footnoteLabelPattern = /^[\p{L}\p{M}\p{N} _./:#'"-]+$/u;

type HtmlTagRead =
  | Readonly<{ closing: boolean; end: number; name: string }>
  | Readonly<{ resume: number }>;

type HtmlScanIndex = Readonly<{
  doubleQuotes: readonly number[];
  openers: readonly number[];
  singleQuotes: readonly number[];
}>;

export function normalizeFootnoteLabel(value: string) {
  const label = value.trim();
  return label && footnoteLabelPattern.test(label)
    ? label
    : null;
}

export function assertFootnoteLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Footnote labels must be strings.");
  }

  const label = normalizeFootnoteLabel(value);

  if (!label) {
    throw new TypeError(
      "Footnote labels must contain only Unicode letters, marks, numbers, spaces, _, -, ., /, :, #, or quotes.",
    );
  }

  return label;
}

function environmentObject(environment: unknown): object | null {
  return typeof environment === "object" && environment !== null
    ? environment
    : null;
}

function isEscaped(source: string, index: number) {
  let backslashes = 0;

  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

function isAsciiAlphaNumeric(value: string | undefined) {
  return !!value && /[A-Za-z0-9]/.test(value);
}

function isWhitespace(value: string | undefined) {
  return !!value && /\s/.test(value);
}

function sourceLines(source: string) {
  const lines: SourceLine[] = [];
  let start = 0;
  let index = 0;

  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    const rawEnd = newline < 0 ? source.length : newline;
    const end = rawEnd > start && source[rawEnd - 1] === "\r"
      ? rawEnd - 1
      : rawEnd;
    lines.push({
      end,
      index,
      start,
      text: source.slice(start, end),
    });

    if (newline < 0) {
      break;
    }

    start = newline + 1;
    index += 1;
  }

  return lines;
}

function mergeRanges(ranges: readonly ProtectedRange[]) {
  const ordered = [...ranges]
    .filter(({ end, start }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ end: number; start: number }> = [];

  for (const range of ordered) {
    const previous = merged[merged.length - 1];

    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return Object.freeze(merged.map((range) => Object.freeze(range)));
}

function containingRange(
  ranges: readonly ProtectedRange[],
  position: number,
): ProtectedRange | null {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;

    if (position < range.start) {
      high = middle - 1;
    } else if (position >= range.end) {
      low = middle + 1;
    } else {
      return range;
    }
  }

  return null;
}

function matchAt(pattern: RegExp, source: string, position: number) {
  pattern.lastIndex = position;
  return pattern.exec(source);
}

function nextPosition(positions: readonly number[], after: number) {
  let low = 0;
  let high = positions.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle]! <= after) low = middle + 1;
    else high = middle;
  }

  return positions[low] ?? -1;
}

function readHtmlTag(
  source: string,
  start: number,
  scanIndex?: HtmlScanIndex,
): HtmlTagRead | null {
  const prefix = matchAt(htmlTagPrefixPattern, source, start);

  if (!prefix) {
    return null;
  }

  for (let cursor = htmlTagPrefixPattern.lastIndex; cursor < source.length; cursor += 1) {
    const character = source[cursor]!;

    if (character === '"' || character === "'") {
      const positions = character === '"'
        ? scanIndex?.doubleQuotes
        : scanIndex?.singleQuotes;
      const closingQuote = positions
        ? nextPosition(positions, cursor)
        : source.indexOf(character, cursor + 1);

      if (closingQuote < 0) {
        const resume = scanIndex
          ? nextPosition(scanIndex.openers, cursor)
          : source.indexOf("<", cursor + 1);
        return { resume: resume < 0 ? source.length : resume };
      }

      cursor = closingQuote;
    } else if (character === "<") {
      // A second opener cannot occur in an unquoted HTML tag. Return a
      // forward resume point so a hostile run of unterminated prefixes is
      // scanned once rather than once per opener.
      return { resume: cursor };
    } else if (character === ">") {
      return {
        closing: !!prefix[1],
        end: cursor + 1,
        name: prefix[2]!.toLowerCase(),
      };
    }
  }

  return { resume: source.length };
}

function scanCodeAndHtmlRanges(
  source: string,
  excludedRanges: readonly ProtectedRange[] = [],
) {
  const codeRanges: ProtectedRange[] = [];
  const htmlTokenRanges: ProtectedRange[] = [];
  const htmlContentRanges: ProtectedRange[] = [];
  const htmlStack: Array<{ name: string; start: number }> = [];
  const htmlOpenCount = new Map<string, number>();
  const backtickLastPosition = new Map<number, number>();
  let backticksScanned = false;
  const mutableScanIndex = {
    doubleQuotes: [] as number[],
    openers: [] as number[],
    singleQuotes: [] as number[],
  };

  let excludedIndex = 0;
  for (let index = 0; index < source.length; index += 1) {
    while (excludedRanges[excludedIndex]?.end <= index) excludedIndex += 1;
    const excluded = excludedRanges[excludedIndex];

    if (excluded && index >= excluded.start) {
      index = excluded.end - 1;
      continue;
    }

    if (source[index] === '"') mutableScanIndex.doubleQuotes.push(index);
    else if (source[index] === "'") mutableScanIndex.singleQuotes.push(index);
    else if (source[index] === "<") mutableScanIndex.openers.push(index);
  }

  const htmlScanIndex: HtmlScanIndex = mutableScanIndex;

  for (let cursor = 0; cursor < source.length;) {
    const excluded = containingRange(excludedRanges, cursor);

    if (excluded) {
      cursor = excluded.end;
      continue;
    }

    if (source[cursor] === "`" && !isEscaped(source, cursor)) {
      let runEnd = cursor + 1;
      while (source[runEnd] === "`") runEnd += 1;
      const markerLength = runEnd - cursor;

      if (
        backticksScanned
        && (backtickLastPosition.get(markerLength) ?? 0) <= cursor
      ) {
        cursor = runEnd;
        continue;
      }

      let closeEnd = runEnd;
      let found = false;

      while (closeEnd < source.length) {
        const close = source.indexOf("`", closeEnd);

        if (close < 0) break;
        closeEnd = close + 1;
        while (source[closeEnd] === "`") closeEnd += 1;

        if (closeEnd - close === markerLength) {
          codeRanges.push({ end: closeEnd, start: cursor });
          cursor = closeEnd;
          found = true;
          break;
        }

        backtickLastPosition.set(closeEnd - close, close);
      }

      if (found) continue;

      backticksScanned = true;
      cursor = runEnd;
      continue;
    }

    if (source[cursor] !== "<" || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const uriAutolink = matchAt(uriAutolinkPattern, source, cursor);
    const emailAutolink = uriAutolink
      ? null
      : matchAt(emailAutolinkPattern, source, cursor);
    const autolink = uriAutolink ?? emailAutolink;

    if (autolink) {
      htmlTokenRanges.push({ end: cursor + autolink[0].length, start: cursor });
      cursor += autolink[0].length;
      continue;
    }

    const special = source.startsWith("<!--", cursor)
      ? { closer: "-->", openerLength: 4 }
      : source.startsWith("<![CDATA[", cursor)
        ? { closer: "]]>", openerLength: 9 }
        : source.startsWith("<?", cursor)
          ? { closer: "?>", openerLength: 2 }
          : /^<![A-Z]/.test(source.slice(cursor, cursor + 3))
            ? { closer: ">", openerLength: 2 }
            : null;

    if (special) {
      const found = source.indexOf(special.closer, cursor + special.openerLength);
      const end = found < 0 ? source.length : found + special.closer.length;
      htmlTokenRanges.push({ end, start: cursor });
      cursor = end;
      continue;
    }

    const tag = readHtmlTag(source, cursor, htmlScanIndex);

    if (!tag) {
      cursor += 1;
      continue;
    }

    if ("resume" in tag) {
      cursor = Math.max(cursor + 1, tag.resume);
      continue;
    }

    htmlTokenRanges.push({ end: tag.end, start: cursor });

    if (tag.closing) {
      const openCount = htmlOpenCount.get(tag.name) ?? 0;

      if (openCount > 0) {
        let matching = htmlStack.length - 1;
        while (htmlStack[matching]?.name !== tag.name) matching -= 1;
        const removed = htmlStack.splice(matching);
        const opening = removed[0]!;

        for (const entry of removed) {
          const count = (htmlOpenCount.get(entry.name) ?? 1) - 1;
          if (count === 0) htmlOpenCount.delete(entry.name);
          else htmlOpenCount.set(entry.name, count);
        }

        htmlContentRanges.push({ end: tag.end, start: opening!.start });
      }
    } else if (
      !htmlVoidElements.has(tag.name)
      && !/\/\s*>$/.test(source.slice(cursor, tag.end))
    ) {
      htmlStack.push({ name: tag.name, start: cursor });
      htmlOpenCount.set(tag.name, (htmlOpenCount.get(tag.name) ?? 0) + 1);
    }

    cursor = tag.end;
  }

  for (const opening of htmlStack) {
    htmlContentRanges.push({ end: source.length, start: opening.start });
  }

  return Object.freeze({
    codeRanges: mergeRanges(codeRanges),
    htmlRanges: mergeRanges([...htmlTokenRanges, ...htmlContentRanges]),
  });
}

function fenceStart(text: string) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);

  if (match?.[1]?.[0] === "`" && match[2]?.includes("`")) {
    return null;
  }

  return match
    ? { character: match[1]![0]!, length: match[1]!.length }
    : null;
}

function isFenceClose(
  text: string,
  fence: Readonly<{ character: string; length: number }>,
) {
  const trimmed = text.replace(/^ {0,3}/, "");
  let length = 0;
  while (trimmed[length] === fence.character) length += 1;
  return length >= fence.length && /^[ \t]*$/.test(trimmed.slice(length));
}

type HtmlBlockMode =
  | Readonly<{ canInterruptParagraph: true; closer: string; kind: "raw" }>
  | Readonly<{ canInterruptParagraph: boolean; kind: "blank" }>;

function htmlBlockStart(text: string): HtmlBlockMode | null {
  const content = text.replace(/^ {0,3}/, "");
  const rawTag = /^<(pre|script|style|textarea)(?=[\t\n\f\r ]|>)/i.exec(content);

  if (rawTag) {
    return {
      canInterruptParagraph: true,
      closer: `</${rawTag[1]!.toLowerCase()}>`,
      kind: "raw",
    };
  }

  if (content.startsWith("<!--")) {
    return { canInterruptParagraph: true, closer: "-->", kind: "raw" };
  }
  if (content.startsWith("<?")) {
    return { canInterruptParagraph: true, closer: "?>", kind: "raw" };
  }
  if (content.startsWith("<![CDATA[")) {
    return { canInterruptParagraph: true, closer: "]]>", kind: "raw" };
  }
  if (/^<![A-Z]/.test(content)) {
    return { canInterruptParagraph: true, closer: ">", kind: "raw" };
  }

  const tag = readHtmlTag(content, 0);

  if (!tag || "resume" in tag) {
    return null;
  }

  if (htmlBlockElements.has(tag.name)) {
    return { canInterruptParagraph: true, kind: "blank" };
  }

  return content.slice(tag.end).trim() === ""
    ? { canInterruptParagraph: false, kind: "blank" }
    : null;
}

function lineEndsParagraphContext(text: string) {
  // Only false-positive type-7 HTML ranges can suppress a real footnote.
  // Treat every preceding ordinary nonblank line as paragraph context and let
  // Markdown-it's actual block rules own true block HTML. This deliberately
  // conservative pre-scan never needs to guess every interrupting block form.
  return !!text.trim();
}

function scanBlockContexts(
  lines: readonly SourceLine[],
  externalNonMathLines: ReadonlySet<number> = new Set(),
) {
  const htmlLines = new Set<number>();
  const fenceLines = new Set<number>();
  const indentedCodeLines = new Set<number>();
  const displayMathLines = new Set<number>();
  let fence: Readonly<{ character: string; length: number }> | null = null;
  let html: HtmlBlockMode | null = null;
  let paragraphOpen = false;

  for (let lineOffset = 0; lineOffset < lines.length; lineOffset += 1) {
    const line = lines[lineOffset]!;

    if (html) {
      if (html.kind === "blank" && !line.text.trim()) {
        html = null;
        paragraphOpen = false;
      } else {
        htmlLines.add(line.index);

        if (
          html.kind === "raw"
          && line.text.toLowerCase().includes(html.closer.toLowerCase())
        ) {
          html = null;
        }
        continue;
      }
    }

    if (fence) {
      fenceLines.add(line.index);
      if (isFenceClose(line.text, fence)) {
        fence = null;
        paragraphOpen = false;
      }
      continue;
    }

    if (externalNonMathLines.has(line.index)) {
      paragraphOpen = false;
      continue;
    }

    const openingFence = fenceStart(line.text);

    if (openingFence) {
      fence = openingFence;
      fenceLines.add(line.index);
      paragraphOpen = false;
      continue;
    }

    if (/^(?: {4}|\t)/.test(line.text)) {
      indentedCodeLines.add(line.index);
      paragraphOpen = false;
      continue;
    }

    const trimmed = line.text.trim();

    if (trimmed === "$$") {
      let closingOffset = lineOffset + 1;

      while (
        closingOffset < lines.length
        && (
          externalNonMathLines.has(lines[closingOffset]!.index)
          || lines[closingOffset]!.text.trim() !== "$$"
        )
      ) {
        closingOffset += 1;
      }

      if (closingOffset < lines.length) {
        for (let offset = lineOffset; offset <= closingOffset; offset += 1) {
          displayMathLines.add(lines[offset]!.index);
        }
        lineOffset = closingOffset;
        paragraphOpen = false;
        continue;
      }
    } else if (
      trimmed.length > 4
      && trimmed.startsWith("$$")
      && trimmed.endsWith("$$")
    ) {
      displayMathLines.add(line.index);
      paragraphOpen = false;
      continue;
    }

    const openingHtml = htmlBlockStart(line.text);

    if (
      openingHtml
      && (!paragraphOpen || openingHtml.canInterruptParagraph)
    ) {
      html = openingHtml;
      htmlLines.add(line.index);
      paragraphOpen = false;

      if (
        openingHtml.kind === "raw"
        && line.text.toLowerCase().includes(openingHtml.closer.toLowerCase())
      ) {
        html = null;
      }
      continue;
    }

    paragraphOpen = lineEndsParagraphContext(line.text);
  }

  return {
    blockProtectedLines: new Set([...htmlLines, ...displayMathLines]),
    displayMathLines,
    fenceLines,
    nonMathLines: new Set([
      ...htmlLines,
      ...fenceLines,
      ...indentedCodeLines,
      ...displayMathLines,
    ]),
  };
}

function mappedLine(line: SourceLine, text: string): SourceLine {
  return { ...line, text };
}

function blockquoteGroups(lines: readonly SourceLine[]) {
  const groups: SourceLine[][] = [];
  let current: SourceLine[] = [];

  for (const line of lines) {
    let text = line.text;
    let stripped = false;

    while (true) {
      const marker = /^ {0,3}>[ \t]?/.exec(text);
      if (!marker) break;
      text = text.slice(marker[0].length);
      stripped = true;
    }

    if (stripped) {
      current.push(mappedLine(line, text));
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function listItemGroups(lines: readonly SourceLine[]) {
  const groups: SourceLine[][] = [];

  const columnAt = (text: string, end: number) => {
    let column = 0;
    for (let index = 0; index < end; index += 1) {
      column = text[index] === "\t"
        ? column + 4 - column % 4
        : column + 1;
    }
    return column;
  };

  const indentationOffset = (text: string, requiredColumns: number) => {
    let column = 0;
    let offset = 0;

    while (offset < text.length && (text[offset] === " " || text[offset] === "\t")) {
      column = text[offset] === "\t"
        ? column + 4 - column % 4
        : column + 1;
      offset += 1;
      if (column >= requiredColumns) return offset;
    }

    return null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = /^ {0,3}(?:[*+-]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line.text);

    if (!marker) continue;

    const content = marker[2] ?? "";
    const prefixLength = marker[0].length - content.length;
    const indentation = columnAt(line.text, prefixLength);
    const group = [mappedLine(line, content)];
    const lazyDisplayMath = content.trim() === "$$";
    let continuation = index + 1;

    for (; continuation < lines.length; continuation += 1) {
      const next = lines[continuation]!;

      if (!next.text.trim()) {
        group.push(mappedLine(next, ""));
        continue;
      }

      const offset = indentationOffset(next.text, indentation);
      if (offset === null && !lazyDisplayMath) break;
      const logicalText = offset === null ? next.text : next.text.slice(offset);
      group.push(mappedLine(next, logicalText));

      if (lazyDisplayMath && logicalText.trim() === "$$") {
        continuation += 1;
        break;
      }
    }

    groups.push(group);
    index = Math.max(index, continuation - 1);
  }

  return groups;
}

function containerGroups(lines: readonly SourceLine[]) {
  const groups: SourceLine[][] = [];
  const queue: Array<Readonly<{ depth: number; lines: readonly SourceLine[] }>> = [{
    depth: 0,
    lines,
  }];
  const seen = new Set<string>();
  const maximumContainerDepth = 64;

  const keyFor = (group: readonly SourceLine[]) => {
    let hash = 2166136261;

    for (const line of group) {
      hash ^= line.index;
      hash = Math.imul(hash, 16777619);
      for (let index = 0; index < line.text.length; index += 1) {
        hash ^= line.text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }

    return `${group[0]?.index ?? -1}:${group[group.length - 1]?.index ?? -1}:${group.length}:${hash}`;
  };

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const nested = [
      ...blockquoteGroups(current.lines),
      ...listItemGroups(current.lines),
    ];

    for (const group of nested) {
      const key = keyFor(group);
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push(group);

      if (current.depth < maximumContainerDepth) {
        queue.push({ depth: current.depth + 1, lines: group });
      }
    }
  }

  return groups;
}

function findMathRanges(
  source: string,
  lines: readonly SourceLine[],
  excludedRanges: readonly ProtectedRange[],
  inlineContextRanges: readonly ProtectedRange[],
) {
  const ranges: ProtectedRange[] = [];

  for (const line of lines) {
    let opener = -1;

    for (let cursor = line.start; cursor < line.end; cursor += 1) {
      const excluded = containingRange(excludedRanges, cursor);

      if (excluded) {
        cursor = excluded.end - 1;
        continue;
      }

      const inlineContext = containingRange(inlineContextRanges, cursor);

      // Context ownership follows the earliest opener. HTML that begins before
      // a math delimiter remains authoritative, as does a preceding code span;
      // either construct starting after a valid math opener is inert math
      // content and must not swallow syntax following the closing delimiter.
      if (
        inlineContext
        && opener < 0
        && !containingRange(ranges, inlineContext.start)
      ) {
        cursor = inlineContext.end - 1;
        continue;
      }

      if (source[cursor] !== "$" || isEscaped(source, cursor)) {
        continue;
      }

      if (source[cursor + 1] === "$") {
        let close = cursor + 2;

        while (close < line.end) {
          close = source.indexOf("$$", close);
          if (close < 0 || close >= line.end) break;

          if (!isEscaped(source, close) && !containingRange(excludedRanges, close)) {
            ranges.push({ end: close + 2, start: cursor });
            cursor = close + 1;
            opener = -1;
            break;
          }
          close += 2;
        }
        continue;
      }

      if (opener < 0) {
        if (
          !isWhitespace(source[cursor + 1])
          && !isAsciiAlphaNumeric(source[cursor - 1])
        ) {
          opener = cursor;
        }
        continue;
      }

      if (
        !isWhitespace(source[cursor - 1])
        && !isAsciiAlphaNumeric(source[cursor + 1])
      ) {
        ranges.push({ end: cursor + 1, start: opener });
        opener = -1;
      }
    }
  }

  return ranges;
}

function buildSourceAnalysis(source: string): SourceAnalysis {
  const lines = sourceLines(source);
  const groupAnalyses = containerGroups(lines).map((group) => (
    scanBlockContexts(group)
  ));
  const containerNonMathLines = new Set<number>();

  for (const analysis of groupAnalyses) {
    for (const line of analysis.nonMathLines) containerNonMathLines.add(line);
  }

  const rootAnalysis = scanBlockContexts(lines, containerNonMathLines);
  const blockProtectedLines = new Set(rootAnalysis.blockProtectedLines);
  const displayMathLines = new Set(rootAnalysis.displayMathLines);

  for (const analysis of groupAnalyses) {
    for (const line of analysis.blockProtectedLines) {
      blockProtectedLines.add(line);
    }
    for (const line of analysis.displayMathLines) {
      displayMathLines.add(line);
    }
  }

  const rangesForLines = (lineIndexes: ReadonlySet<number>) => (
    [...lineIndexes].map((lineIndex) => {
      const line = lines[lineIndex]!;
      return { end: line.end, start: line.start };
    })
  );
  const blockRanges = mergeRanges(rangesForLines(blockProtectedLines));
  const displayMathBlockRanges = mergeRanges(rangesForLines(displayMathLines));
  const provisionalContexts = scanCodeAndHtmlRanges(
    source,
    displayMathBlockRanges,
  );
  const inlineContextRanges = mergeRanges([
    ...provisionalContexts.codeRanges,
    ...provisionalContexts.htmlRanges,
  ]);
  const mathRanges = mergeRanges(findMathRanges(
    source,
    lines,
    blockRanges,
    inlineContextRanges,
  ));
  const inlineMathShieldRanges: ProtectedRange[] = [];
  let provisionalCodeIndex = 0;

  for (const mathRange of mathRanges) {
    while (
      provisionalContexts.codeRanges[provisionalCodeIndex]
      && provisionalContexts.codeRanges[provisionalCodeIndex]!.start < mathRange.start
    ) {
      provisionalCodeIndex += 1;
    }

    if (
      provisionalContexts.codeRanges[provisionalCodeIndex]
      && provisionalContexts.codeRanges[provisionalCodeIndex]!.start < mathRange.end
    ) {
      inlineMathShieldRanges.push(mathRange);
    }
  }

  // The provisional pass exists only to decide which opener owns an overlap.
  // Scan again with matched math removed so inert code/HTML openers inside math
  // cannot hide independent contexts that begin after the math closes.
  const finalContexts = scanCodeAndHtmlRanges(
    source,
    mergeRanges([...displayMathBlockRanges, ...mathRanges]),
  );
  const baseRanges = mergeRanges([
    ...finalContexts.codeRanges,
    ...finalContexts.htmlRanges,
    ...blockRanges,
  ]);

  return Object.freeze({
    blockProtectedLines,
    inlineMathShieldRanges: mergeRanges(inlineMathShieldRanges),
    protectedRanges: mergeRanges([...baseRanges, ...mathRanges]),
  });
}

/** @internal Exported for bounded adversarial scanner verification. */
export function analyzeFootnoteSource(source: string) {
  return buildSourceAnalysis(source);
}

function sourceAnalysis(environment: unknown, source: string) {
  const object = environmentObject(environment);

  if (!object) {
    return buildSourceAnalysis(source);
  }

  let analyses = sourceAnalysisByEnvironment.get(object);

  if (!analyses) {
    analyses = new Map();
    sourceAnalysisByEnvironment.set(object, analyses);
  }

  let analysis = analyses.get(source);

  if (!analysis) {
    analysis = buildSourceAnalysis(source);
    analyses.set(source, analysis);
  }

  return analysis;
}

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function isIndentedCode(state: Parameters<BlockRule>[0], line: number) {
  return state.sCount[line] - state.blkIndent >= 4;
}

function continuationText(state: Parameters<BlockRule>[0], line: number) {
  if (state.sCount[line] - state.blkIndent < 4) {
    return null;
  }

  // The accepted dialect deliberately requires four literal spaces. A tab
  // may advance Markdown-it's indentation counter by four columns, but does
  // not satisfy the portable continuation spelling promised by the package.
  const indentation = state.src.slice(
    state.bMarks[line],
    state.bMarks[line] + state.tShift[line],
  );

  if (!indentation.startsWith("    ")) {
    return null;
  }

  return state
    .getLines(line, line + 1, state.blkIndent + 4, false)
    .replace(/(?:\r\n|\r|\n)$/, "");
}

function definitionEnd(
  state: Parameters<BlockRule>[0],
  startLine: number,
  endLine: number,
) {
  let cursor = startLine + 1;
  let end = startLine + 1;

  while (cursor < endLine) {
    if (state.isEmpty(cursor)) {
      cursor += 1;
      continue;
    }

    const continuation = continuationText(state, cursor);

    if (continuation === null) {
      break;
    }

    cursor += 1;
    end = cursor;
  }

  return end;
}

function pushLiteralDefinition(
  state: Parameters<BlockRule>[0],
  startLine: number,
) {
  const paragraphOpen = state.push("paragraph_open", "p", 1);
  paragraphOpen.block = true;
  paragraphOpen.map = [startLine, startLine + 1];
  const inline = state.push("inline", "", 0);
  inline.content = `\\${lineText(state, startLine)}`;
  inline.map = [startLine, startLine + 1];
  inline.children = [];
  const paragraphClose = state.push("paragraph_close", "p", -1);
  paragraphClose.block = true;
  state.line = startLine + 1;
}

function definitionDepth(environment: unknown) {
  const object = environmentObject(environment);
  return object ? definitionDepthByEnvironment.get(object) ?? 0 : 0;
}

function setDefinitionDepth(
  environment: unknown,
  depth: number,
) {
  const object = environmentObject(environment);

  if (!object) return;

  if (depth === 0) {
    definitionDepthByEnvironment.delete(object);
  } else {
    definitionDepthByEnvironment.set(object, depth);
  }
}

function scanIndentation(
  state: Parameters<BlockRule>[0],
  line: number,
) {
  const start = state.bMarks[line];
  const end = state.eMarks[line];
  let cursor = start;
  let columns = 0;

  while (cursor < end) {
    const character = state.src[cursor];

    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += 4 - columns % 4;
    } else {
      break;
    }

    cursor += 1;
  }

  state.tShift[line] = cursor - start;
  state.sCount[line] = columns;
  state.bsCount[line] = 0;
}

function projectDefinitionBodyContexts(
  state: Parameters<BlockRule>[0],
  startLine: number,
  endLine: number,
) {
  const bodySource = state.getLines(startLine, endLine, 0, false);
  const bodyAnalysis = buildSourceAnalysis(bodySource);
  const documentAnalysis = sourceAnalysis(state.env, state.src);
  const documentProtectedLines = documentAnalysis.blockProtectedLines as Set<number>;

  for (const bodyLine of bodyAnalysis.blockProtectedLines) {
    const documentLine = startLine + bodyLine;

    if (documentLine < endLine) {
      documentProtectedLines.add(documentLine);
    }
  }
}

function tokenizeDefinitionBody(
  state: Parameters<BlockRule>[0],
  startLine: number,
  endLine: number,
  firstContentOffset: number,
) {
  const oldBMarks: number[] = [];
  const oldBSCount: number[] = [];
  const oldSCount: number[] = [];
  const oldTShift: number[] = [];

  for (let line = startLine; line < endLine; line += 1) {
    oldBMarks.push(state.bMarks[line]);
    oldBSCount.push(state.bsCount[line]);
    oldSCount.push(state.sCount[line]);
    oldTShift.push(state.tShift[line]);

    if (line === startLine) {
      state.bMarks[line] = state.bMarks[line] + state.tShift[line] + firstContentOffset;
      scanIndentation(state, line);
    } else if (
      state.src.slice(state.bMarks[line], state.eMarks[line]).startsWith("    ")
    ) {
      state.bMarks[line] += 4;
      scanIndentation(state, line);
    }
  }

  // Inline tokenization runs after block tokenization. Project multiline math
  // and HTML contexts from the logical, de-indented body onto global source
  // lines now so blank-separated body paragraphs retain that shared context.
  projectDefinitionBodyContexts(state, startLine, endLine);

  const oldDepth = definitionDepth(state.env);
  const oldIndent = state.blkIndent;
  const oldLineMax = state.lineMax;
  const oldParentType = state.parentType;
  state.blkIndent = 0;
  state.lineMax = endLine;
  // Markdown-it exposes a closed parent-type union. The private depth map owns
  // footnote ancestry; blockquote supplies the equivalent container behavior
  // to nested foundation rules without inventing an unsupported parent type.
  state.parentType = "blockquote";
  setDefinitionDepth(state.env, oldDepth + 1);

  try {
    state.md.block.tokenize(state, startLine, endLine);
  } finally {
    setDefinitionDepth(state.env, oldDepth);
    state.blkIndent = oldIndent;
    state.lineMax = oldLineMax;
    state.parentType = oldParentType;

    for (let offset = 0; offset < oldBMarks.length; offset += 1) {
      const line = startLine + offset;
      state.bMarks[line] = oldBMarks[offset]!;
      state.bsCount[line] = oldBSCount[offset]!;
      state.sCount[line] = oldSCount[offset]!;
      state.tShift[line] = oldTShift[offset]!;
    }
  }
}

export function createFootnoteDefinitionRule(
  openType: string,
  closeType: string,
): BlockRule {
  return (state, startLine, endLine, silent) => {
    if (isIndentedCode(state, startLine)) {
      return false;
    }

    const opening = /^\[\^([^\]\r\n]+)\]:(.*)$/.exec(lineText(state, startLine));
    const label = opening ? normalizeFootnoteLabel(opening[1]) : null;

    if (!opening || !label) {
      return false;
    }

    if (silent) {
      return true;
    }

    const analysis = sourceAnalysis(state.env, state.src);

    if (
      definitionDepth(state.env) > 0
      || analysis.blockProtectedLines.has(startLine)
    ) {
      pushLiteralDefinition(state, startLine);
      return true;
    }

    const rawFirstLine = opening[2] ?? "";
    const markerLength = opening[0].length - rawFirstLine.length;
    const firstContentOffset = markerLength + (/^[ \t]/.test(rawFirstLine) ? 1 : 0);
    const end = definitionEnd(state, startLine, endLine);
    const open = state.push(openType, "section", 1);
    open.block = true;
    open.map = [startLine, end];
    open.markup = `[^${label}]:`;
    open.meta = { label } satisfies FootnoteTokenMeta;

    tokenizeDefinitionBody(
      state,
      startLine,
      end,
      firstContentOffset,
    );

    const close = state.push(closeType, "section", -1);
    close.block = true;
    close.map = [startLine, end];
    close.markup = `[^${label}]:`;
    state.line = end;
    return true;
  };
}

export function createFootnoteReferenceRule(tokenType: string): InlineRule {
  return (state, silent) => {
    const start = state.pos;

    if (
      state.src[start] !== "["
      || state.src[start + 1] !== "^"
      || isEscaped(state.src, start)
      || containingRange(
        sourceAnalysis(state.env, state.src).protectedRanges,
        start,
      )
    ) {
      return false;
    }

    const close = state.src.indexOf("]", start + 2);

    if (close < 0 || close >= state.posMax) {
      return false;
    }

    const label = normalizeFootnoteLabel(state.src.slice(start + 2, close));

    if (!label) {
      return false;
    }

    if (silent) {
      // Markdown-it uses silent rules to balance brackets while discovering
      // link labels. Claiming the inner footnote marker here makes the outer
      // link look unbalanced and drops its mark.
      return false;
    }

    state.pos = close + 1;

    const token = state.push(tokenType, "span", 0);
    token.content = label;
    token.markup = `[^${label}]`;
    token.meta = { label } satisfies FootnoteTokenMeta;
    return true;
  };
}

/**
 * Markdown-it recognizes code spans before a later footnote reference rule can
 * run. When a backtick opener starts inside already-matched math, consume only
 * that math range as literal pending text so the inert backtick cannot pair
 * with a delimiter after the math close and swallow following footnotes.
 */
export function createFootnoteMathShieldRule(): InlineRule {
  return (state, silent) => {
    const range = containingRange(
      sourceAnalysis(state.env, state.src).inlineMathShieldRanges,
      state.pos,
    );

    if (
      !range
      || range.start !== state.pos
      || range.end > state.posMax
    ) {
      return false;
    }

    if (!silent) {
      state.pending += state.src.slice(range.start, range.end);
    }
    state.pos = range.end;
    return true;
  };
}

function referenceCandidates(source: string, environment: unknown) {
  const candidates: Array<{ label: string; line: number }> = [];
  const ranges = sourceAnalysis(environment, source).protectedRanges;
  let line = 0;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
      continue;
    }

    const protectedRange = containingRange(ranges, cursor);

    if (protectedRange) {
      for (let index = cursor; index < protectedRange.end; index += 1) {
        if (source[index] === "\n") line += 1;
      }
      cursor = protectedRange.end - 1;
      continue;
    }

    if (
      source[cursor] !== "["
      || source[cursor + 1] !== "^"
      || isEscaped(source, cursor)
    ) {
      continue;
    }

    const close = source.indexOf("]", cursor + 2);

    if (close < 0) {
      continue;
    }

    const label = normalizeFootnoteLabel(source.slice(cursor + 2, close));

    if (label) {
      candidates.push({ label, line });
      cursor = close;
    }
  }

  return candidates;
}

function imageAltWithLiteralReferences(
  tokens: readonly MarkdownToken[],
  referenceType: string,
): Readonly<{ content: string; hasReference: boolean }> {
  let content = "";
  let hasReference = false;

  for (const token of tokens) {
    if (token.type === referenceType) {
      const meta = token.meta as FootnoteTokenMeta | null;
      const label = typeof meta?.label === "string" ? meta.label : token.content;
      content += `[^${label}]`;
      hasReference = true;
    } else if (
      token.type === "text"
      || token.type === "html_inline"
      || token.type === "html_block"
    ) {
      content += token.content;
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      content += "\n";
    } else if (token.type === "image" && token.children) {
      const nested = imageAltWithLiteralReferences(token.children, referenceType);
      content += nested.content;
      hasReference ||= nested.hasReference;
    } else if (token.nesting === 0) {
      content += token.content;
    }
  }

  return { content, hasReference };
}

function preserveImageAltReferences(
  state: Parameters<CoreRule>[0],
  tokens: readonly MarkdownToken[],
  referenceType: string,
) {
  for (const token of tokens) {
    if (token.type === "image" && token.children) {
      const alt = imageAltWithLiteralReferences(token.children, referenceType);

      if (
        alt.hasReference
        || /\[\^[^\]\r\n]+\]/.test(alt.content)
      ) {
        const text = new state.Token("text", "", 0);
        text.content = alt.content;
        token.children = [text];
        token.content = alt.content;
        token.attrSet("alt", alt.content);
      }
    } else if (token.children) {
      preserveImageAltReferences(state, token.children, referenceType);
    }
  }
}

export function createFootnoteContextRule(referenceType: string): CoreRule {
  return (state) => {
    preserveImageAltReferences(state, state.tokens, referenceType);
    const protectedLines = sourceAnalysis(state.env, state.src).blockProtectedLines;

    if (protectedLines.size === 0) {
      return;
    }

    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children || !token.map) {
        continue;
      }

      const candidates = referenceCandidates(token.content, state.env);
      let candidateIndex = 0;

      for (const child of token.children) {
        if (child.type !== referenceType) {
          continue;
        }

        const candidate = candidates[candidateIndex];
        candidateIndex += 1;

        if (!candidate || !protectedLines.has(token.map[0] + candidate.line)) {
          continue;
        }

        const meta = child.meta as FootnoteTokenMeta | null;
        const label = typeof meta?.label === "string" ? meta.label : child.content;
        child.type = "text";
        child.tag = "";
        child.nesting = 0;
        child.content = `[^${label}]`;
        child.markup = "";
        child.meta = null;
      }
    }
  };
}
