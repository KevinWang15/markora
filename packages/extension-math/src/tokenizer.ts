import type { MarkdownEditorTokenizerRule } from "markora/extension-api";
import {
  isInlineMathCloserAt,
  isInlineMathOpenerAt,
  isMarkdownCharacterEscaped,
  isValidBlockMathSource,
  normalizeMathSource,
} from "./source.js";

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

export type MathTokenMeta = Readonly<{
  source?: string;
}>;

export type MathInlineRange = Readonly<{
  end: number;
  source: string;
  start: number;
}>;

type HtmlTag = Readonly<{
  closing: boolean;
  end: number;
  name: string;
  selfClosing: boolean;
}>;

type HtmlTagRead = HtmlTag | Readonly<{ resume: number }>;

type HtmlScanIndex = Readonly<{
  doubleQuotes: readonly number[];
  openers: readonly number[];
  singleQuotes: readonly number[];
}>;

const sourceAnalysisByEnvironment = new WeakMap<
  object,
  Map<string, readonly MathInlineRange[]>
>();

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

const uriAutolinkPattern = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*>/y;
const emailAutolinkPattern = /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?>/y;
const htmlTagPrefixPattern = /<\s*(\/)?\s*([A-Za-z][A-Za-z0-9:._-]*)(?=[\t\n\f\r ]|\/?>)/y;

function environmentObject(environment: unknown): object | null {
  return typeof environment === "object" && environment !== null
    ? environment
    : null;
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

    if (positions[middle]! <= after) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return positions[low] ?? -1;
}

function createHtmlScanIndex(source: string): HtmlScanIndex {
  const doubleQuotes: number[] = [];
  const openers: number[] = [];
  const singleQuotes: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"') {
      doubleQuotes.push(index);
    } else if (source[index] === "'") {
      singleQuotes.push(index);
    } else if (source[index] === "<") {
      openers.push(index);
    }
  }

  return { doubleQuotes, openers, singleQuotes };
}

function readHtmlTag(
  source: string,
  start: number,
  scanIndex: HtmlScanIndex,
): HtmlTagRead | null {
  const prefix = matchAt(htmlTagPrefixPattern, source, start);

  if (!prefix) {
    return null;
  }

  for (
    let cursor = htmlTagPrefixPattern.lastIndex;
    cursor < source.length;
    cursor += 1
  ) {
    const character = source[cursor]!;

    if (character === '"' || character === "'") {
      const closingQuote = nextPosition(
        character === '"' ? scanIndex.doubleQuotes : scanIndex.singleQuotes,
        cursor,
      );

      if (closingQuote < 0) {
        const resume = nextPosition(scanIndex.openers, cursor);
        return { resume: resume < 0 ? source.length : resume };
      }

      cursor = closingQuote;
    } else if (character === "<") {
      return { resume: cursor };
    } else if (character === ">") {
      return {
        closing: !!prefix[1],
        end: cursor + 1,
        name: prefix[2]!.toLowerCase(),
        selfClosing: /\/\s*>$/.test(source.slice(start, cursor + 1)),
      };
    }
  }

  return { resume: source.length };
}

function specialHtmlEnd(source: string, start: number) {
  const special = source.startsWith("<!--", start)
    ? { closer: "-->", openerLength: 4 }
    : source.startsWith("<![CDATA[", start)
      ? { closer: "]]>", openerLength: 9 }
      : source.startsWith("<?", start)
        ? { closer: "?>", openerLength: 2 }
        : /^<![A-Z]/.test(source.slice(start, start + 3))
          ? { closer: ">", openerLength: 2 }
          : null;

  if (!special) {
    return null;
  }

  const found = source.indexOf(special.closer, start + special.openerLength);
  return found < 0 ? source.length : found + special.closer.length;
}

function autolinkEnd(source: string, start: number) {
  const uri = matchAt(uriAutolinkPattern, source, start);
  const email = uri ? null : matchAt(emailAutolinkPattern, source, start);
  const match = uri ?? email;
  return match ? start + match[0].length : null;
}

function htmlElementEnd(
  source: string,
  opening: HtmlTag,
  scanIndex: HtmlScanIndex,
) {
  const stack = [opening.name];
  let cursor = opening.end;

  while (cursor < source.length) {
    const next = source.indexOf("<", cursor);

    if (next < 0) {
      return source.length;
    }

    const specialEnd = specialHtmlEnd(source, next);

    if (specialEnd !== null) {
      cursor = specialEnd;
      continue;
    }

    const linkEnd = autolinkEnd(source, next);

    if (linkEnd !== null) {
      cursor = linkEnd;
      continue;
    }

    const tag = readHtmlTag(source, next, scanIndex);

    if (!tag) {
      cursor = next + 1;
      continue;
    }

    if ("resume" in tag) {
      cursor = Math.max(next + 1, tag.resume);
      continue;
    }

    if (tag.closing) {
      const matching = stack.lastIndexOf(tag.name);

      if (matching >= 0) {
        stack.splice(matching);

        if (stack.length === 0) {
          return tag.end;
        }
      }
    } else if (!tag.selfClosing && !htmlVoidElements.has(tag.name)) {
      stack.push(tag.name);
    }

    cursor = tag.end;
  }

  return source.length;
}

function nextInlineMathClosers(source: string) {
  const next = new Int32Array(source.length + 1);
  next.fill(-1);
  let closer = -1;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source[index] === "\n" || source[index] === "\r") {
      closer = -1;
      next[index] = -1;
      continue;
    }

    next[index] = closer;

    if (isInlineMathCloserAt(source, index)) {
      closer = index;
    }
  }

  return next;
}

function findBacktickEnd(
  source: string,
  start: number,
  lastPositions: Map<number, number>,
  scanState: { complete: boolean },
) {
  let openerEnd = start + 1;
  while (source[openerEnd] === "`") openerEnd += 1;
  const markerLength = openerEnd - start;

  if (
    scanState.complete
    && (lastPositions.get(markerLength) ?? 0) <= start
  ) {
    return openerEnd;
  }

  let search = openerEnd;

  while (search < source.length) {
    const close = source.indexOf("`", search);

    if (close < 0) {
      break;
    }

    let closeEnd = close + 1;
    while (source[closeEnd] === "`") closeEnd += 1;
    const closeLength = closeEnd - close;

    if (closeLength === markerLength) {
      return closeEnd;
    }

    lastPositions.set(closeLength, close);
    search = closeEnd;
  }

  scanState.complete = true;
  return openerEnd;
}

/**
 * Discover semantic single-dollar ranges using earliest-opener ownership.
 * Matched code and recognized HTML beginning first are opaque to math; a
 * matched math opener beginning first owns code/HTML-looking expression text.
 */
export function analyzeInlineMathSource(source: string) {
  const ranges: MathInlineRange[] = [];
  const nextClosers = nextInlineMathClosers(source);
  const htmlScanIndex = createHtmlScanIndex(source);
  const backtickLastPositions = new Map<number, number>();
  const backtickScanState = { complete: false };

  for (let cursor = 0; cursor < source.length;) {
    if (isInlineMathOpenerAt(source, cursor)) {
      const close = nextClosers[cursor]!;

      if (close > cursor + 1) {
        ranges.push(Object.freeze({
          end: close + 1,
          source: source.slice(cursor + 1, close),
          start: cursor,
        }));
        cursor = close + 1;
        continue;
      }
    }

    if (source[cursor] === "`" && !isMarkdownCharacterEscaped(source, cursor)) {
      cursor = findBacktickEnd(
        source,
        cursor,
        backtickLastPositions,
        backtickScanState,
      );
      continue;
    }

    if (source[cursor] !== "<" || isMarkdownCharacterEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const linkEnd = autolinkEnd(source, cursor);

    if (linkEnd !== null) {
      cursor = linkEnd;
      continue;
    }

    const specialEnd = specialHtmlEnd(source, cursor);

    if (specialEnd !== null) {
      cursor = specialEnd;
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

    cursor = (
      tag.closing
      || tag.selfClosing
      || htmlVoidElements.has(tag.name)
    )
      ? tag.end
      : htmlElementEnd(source, tag, htmlScanIndex);
  }

  return Object.freeze(ranges);
}

function inlineMathRanges(environment: unknown, source: string) {
  const object = environmentObject(environment);

  if (!object) {
    return analyzeInlineMathSource(source);
  }

  let sources = sourceAnalysisByEnvironment.get(object);

  if (!sources) {
    sources = new Map();
    sourceAnalysisByEnvironment.set(object, sources);
  }

  let ranges = sources.get(source);

  if (!ranges) {
    ranges = analyzeInlineMathSource(source);
    sources.set(source, ranges);
  }

  return ranges;
}

function rangeStartingAt(
  ranges: readonly MathInlineRange[],
  position: number,
) {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;

    if (position < range.start) {
      high = middle - 1;
    } else if (position > range.start) {
      low = middle + 1;
    } else {
      return range;
    }
  }

  return null;
}

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function blockToken(
  state: Parameters<BlockRule>[0],
  tokenType: string,
  source: string,
  startLine: number,
  endLine: number,
) {
  const token = state.push(tokenType, "div", 0);
  token.block = true;
  token.content = source;
  token.map = [startLine, endLine];
  token.markup = "$$";
  token.meta = {
    ...(token.meta as MathTokenMeta | null),
    source,
  } satisfies MathTokenMeta;
  state.line = endLine;
}

export function createMathBlockRule(tokenType: string): BlockRule {
  return (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }

    const opener = lineText(state, startLine).trim();

    if (opener.length >= 4 && opener.startsWith("$$") && opener.endsWith("$$")) {
      const source = normalizeMathSource(opener.slice(2, -2));

      if (!isValidBlockMathSource(source)) {
        return false;
      }

      if (!silent) {
        blockToken(state, tokenType, source, startLine, startLine + 1);
      }

      return true;
    }

    if (opener !== "$$") {
      return false;
    }

    let closingLine = startLine + 1;

    while (
      closingLine < endLine
      && lineText(state, closingLine).trim() !== "$$"
    ) {
      closingLine += 1;
    }

    if (closingLine >= endLine) {
      return false;
    }

    if (!silent) {
      const source = normalizeMathSource(
        state
          .getLines(startLine + 1, closingLine, state.blkIndent, false)
          .replace(/\n$/, ""),
      );
      blockToken(state, tokenType, source, startLine, closingLine + 1);
    }

    return true;
  };
}

export function createMathInlineRule(tokenType: string): InlineRule {
  return (state, silent) => {
    if (state.src[state.pos] !== "$") {
      return false;
    }

    const range = rangeStartingAt(
      inlineMathRanges(state.env, state.src),
      state.pos,
    );

    if (!range || range.end > state.posMax) {
      return false;
    }

    state.pos = range.end;

    if (!silent) {
      const token = state.push(tokenType, "span", 0);
      token.content = range.source;
      token.markup = "$";
      token.meta = {
        ...(token.meta as MathTokenMeta | null),
        source: range.source,
      } satisfies MathTokenMeta;
    }

    return true;
  };
}

function mathTokenSource(token: MarkdownToken) {
  const meta = token.meta as MathTokenMeta | null;
  return typeof meta?.source === "string" ? meta.source : token.content;
}

function imageAltText(
  tokens: readonly MarkdownToken[],
  inlineTokenType: string,
): Readonly<{ content: string; hasMath: boolean }> {
  let content = "";
  let hasMath = false;

  for (const token of tokens) {
    if (token.type === inlineTokenType) {
      content += `$${mathTokenSource(token)}$`;
      hasMath = true;
    } else if (
      token.type === "text"
      || token.type === "html_inline"
      || token.type === "html_block"
      || token.type === "code_inline"
    ) {
      content += token.content;
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      content += "\n";
    } else if (token.type === "image" && token.children) {
      const nested = imageAltText(token.children, inlineTokenType);
      content += nested.content;
      hasMath ||= nested.hasMath;
    } else if (
      token.nesting === 0
      && /^\[\^[^\]\r\n]+\]$/.test(token.markup)
    ) {
      // Footnote references carry their complete literal source as markup.
      content += token.markup;
    } else if (token.nesting === 0) {
      content += token.content;
    }
  }

  return { content, hasMath };
}

function preserveImageAltMath(
  state: Parameters<CoreRule>[0],
  tokens: readonly MarkdownToken[],
  inlineTokenType: string,
) {
  for (const token of tokens) {
    if (token.type === "image" && token.children) {
      const alt = imageAltText(token.children, inlineTokenType);
      // ProseMirror's foundation image parser stores plain alt text, whereas
      // Markdown-it retains an inline token tree. Always flatten that tree so
      // a canonical escape that turns semantic math back into literal text
      // cannot expose only the first child on the next parse.
      const text = new state.Token("text", "", 0);
      text.content = alt.content;
      token.children = [text];
      token.content = alt.content;
      token.attrSet("alt", alt.content);
    } else if (token.children) {
      preserveImageAltMath(state, token.children, inlineTokenType);
    }
  }
}

/** Flatten semantic math in image descriptions back to literal alt text. */
export function createMathImageAltRule(inlineTokenType: string): CoreRule {
  return (state) => {
    preserveImageAltMath(state, state.tokens, inlineTokenType);
  };
}

export function mathTokenSourceAttrs(token: Readonly<{
  content: string;
  meta: unknown;
}>) {
  const meta = token.meta as MathTokenMeta | null;
  return {
    source: normalizeMathSource(
      typeof meta?.source === "string" ? meta.source : token.content,
    ),
  };
}
