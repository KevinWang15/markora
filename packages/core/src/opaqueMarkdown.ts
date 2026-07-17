import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { sliceMarkdownEditorOriginalSourceLines } from "./markdownSource";

export const opaqueMarkdownKinds = [
  "frontmatter",
  "display-math",
  "html-block",
  "html-comment",
  "directive-container",
  "directive-leaf",
  "inline-html",
  "inline-directive",
  "unknown-fence",
] as const;

export type OpaqueMarkdownKind = (typeof opaqueMarkdownKinds)[number];

export type OpaqueMarkdownEditRequest = {
  kind: OpaqueMarkdownKind;
  source: string;
  update: (nextSource: string) => boolean;
};

type OpaqueTokenMeta = {
  markoraOpaqueKind?: OpaqueMarkdownKind;
  markoraOpaqueSource?: string;
};

const opaqueKindSet = new Set<string>(opaqueMarkdownKinds);

export function normalizeOpaqueMarkdownKind(value: unknown, fallback: OpaqueMarkdownKind): OpaqueMarkdownKind {
  return typeof value === "string" && opaqueKindSet.has(value)
    ? value as OpaqueMarkdownKind
    : fallback;
}

function stripOneTrailingLineEnding(source: string) {
  return source.replace(/(?:\r\n|\r|\n)$/, "");
}

function getLine(state: StateBlock, line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function getOpaqueBlockSource(state: StateBlock, startLine: number, endLine: number) {
  const isTopLevel = state.level === 0 && state.blkIndent === 0;

  if (isTopLevel) {
    const originalSlice = sliceMarkdownEditorOriginalSourceLines(
      state.env,
      startLine,
      endLine,
    );

    if (originalSlice !== null) {
      return originalSlice;
    }
  }

  return state.getLines(startLine, endLine, state.blkIndent, false);
}

function addOpaqueBlockToken(
  state: StateBlock,
  startLine: number,
  endLine: number,
  kind: OpaqueMarkdownKind,
) {
  const token = state.push("markora_opaque_block", "", 0);
  token.map = [startLine, endLine];
  token.meta = {
    ...(token.meta as OpaqueTokenMeta | null),
    markoraOpaqueKind: kind,
    markoraOpaqueSource: getOpaqueBlockSource(state, startLine, endLine),
  } satisfies OpaqueTokenMeta;
  state.line = endLine;
}

function frontmatterRule(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (startLine !== 0 || state.level !== 0 || state.blkIndent !== 0) {
    return false;
  }

  const opener = getLine(state, startLine).replace(/^\uFEFF/, "");

  if (!/^---[ \t]*$/.test(opener)) {
    return false;
  }

  let closingLine = startLine + 1;
  let hasYamlMappingEntry = false;

  while (closingLine < endLine && !/^(?:---|\.\.\.)[ \t]*$/.test(getLine(state, closingLine))) {
    if (/^(?:[A-Za-z_][A-Za-z0-9_.-]*|["'][^"']+["']):(?:[ \t]|$)/.test(getLine(state, closingLine).trimStart())) {
      hasYamlMappingEntry = true;
    }
    closingLine += 1;
  }

  if (closingLine >= endLine || !hasYamlMappingEntry) {
    return false;
  }

  if (silent) {
    return true;
  }

  addOpaqueBlockToken(state, startLine, closingLine + 1, "frontmatter");
  return true;
}

function displayMathRule(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const opener = getLine(state, startLine).trim();
  const isSingleLine = opener.length > 4 && opener.startsWith("$$") && opener.endsWith("$$");

  if (isSingleLine) {
    if (!silent) {
      addOpaqueBlockToken(state, startLine, startLine + 1, "display-math");
    }
    return true;
  }

  if (opener !== "$$") {
    return false;
  }

  let closingLine = startLine + 1;

  while (closingLine < endLine && getLine(state, closingLine).trim() !== "$$") {
    closingLine += 1;
  }

  if (closingLine >= endLine) {
    return false;
  }

  if (!silent) {
    addOpaqueBlockToken(state, startLine, closingLine + 1, "display-math");
  }
  return true;
}

function readBalanced(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) {
    return -1;
  }

  let depth = 0;
  let quote: "\"" | "'" | null = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if ((character === "\"" || character === "'") && open === "{") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

function matchDirective(source: string, colonCount: 1 | 2) {
  const prefix = ":".repeat(colonCount);

  if (!source.startsWith(prefix) || source[colonCount] === ":") {
    return -1;
  }

  const nameMatch = source.slice(colonCount).match(/^[A-Za-z][A-Za-z0-9_-]*/);

  if (!nameMatch) {
    return -1;
  }

  let position = colonCount + nameMatch[0].length;
  let hasPayload = false;

  while (source[position] === "[" || source[position] === "{") {
    const open = source[position]!;
    const close = open === "[" ? "]" : "}";
    const end = readBalanced(source, position, open, close);

    if (end < 0) {
      return -1;
    }

    hasPayload = true;
    position = end;
  }

  return hasPayload ? position : -1;
}

function getContainerOpening(line: string) {
  const match = line.trim().match(/^(:{3,})(?:[A-Za-z][A-Za-z0-9_-]*|\{[^}\r\n]+\})(?:[ \t].*)?$/);
  return match ? match[1]!.length : null;
}

function getContainerClosing(line: string) {
  const match = line.trim().match(/^(:{3,})$/);
  return match ? match[1]!.length : null;
}

function directiveContainerRule(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const openingLength = getContainerOpening(getLine(state, startLine));

  if (openingLength === null) {
    return false;
  }

  const openFences = [openingLength];
  let line = startLine + 1;

  for (; line < endLine; line += 1) {
    const nestedOpening = getContainerOpening(getLine(state, line));

    if (nestedOpening !== null) {
      openFences.push(nestedOpening);
      continue;
    }

    const closingLength = getContainerClosing(getLine(state, line));
    const activeLength = openFences[openFences.length - 1];

    if (closingLength !== null && activeLength !== undefined && closingLength >= activeLength) {
      openFences.pop();

      if (openFences.length === 0) {
        break;
      }
    }
  }

  if (line >= endLine || openFences.length > 0) {
    return false;
  }

  if (!silent) {
    addOpaqueBlockToken(state, startLine, line + 1, "directive-container");
  }
  return true;
}

function directiveLeafRule(state: StateBlock, startLine: number, _endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const line = getLine(state, startLine).trim();
  const end = matchDirective(line, 2);

  if (end < 0 || line.slice(end).trim().length > 0) {
    return false;
  }

  if (!silent) {
    addOpaqueBlockToken(state, startLine, startLine + 1, "directive-leaf");
  }
  return true;
}

function inlineDirectiveRule(state: StateInline, silent: boolean) {
  if (state.src[state.pos] !== ":") {
    return false;
  }

  const source = state.src.slice(state.pos, state.posMax);
  const length = matchDirective(source, 1);

  if (length < 0) {
    return false;
  }

  if (!silent) {
    const rawSource = source.slice(0, length);
    const token = state.push("markora_opaque_inline", "", 0);
    token.content = rawSource;
    token.meta = {
      ...(token.meta as OpaqueTokenMeta | null),
      markoraOpaqueKind: "inline-directive",
      markoraOpaqueSource: rawSource,
    } satisfies OpaqueTokenMeta;
  }

  state.pos += length;
  return true;
}

function hydrateHtmlBlockSources(state: StateCore) {
  for (const token of state.tokens) {
    if (token.type !== "html_block") {
      continue;
    }

    const isTopLevel = token.level === 0;
    const originalSlice = isTopLevel && token.map
      ? sliceMarkdownEditorOriginalSourceLines(state.env, token.map[0], token.map[1])
      : null;
    const source = originalSlice ?? stripOneTrailingLineEnding(token.content);

    token.meta = {
      ...(token.meta as OpaqueTokenMeta | null),
      markoraOpaqueKind: source.trimStart().startsWith("<!--") ? "html-comment" : "html-block",
      markoraOpaqueSource: source,
    } satisfies OpaqueTokenMeta;
  }
}

function createNormalizedSourceMap(source: string) {
  const boundaries = [0];
  let normalized = "";

  for (let index = 0; index < source.length;) {
    const character = source[index];

    if (character === "\r") {
      normalized += "\n";
      index += source[index + 1] === "\n" ? 2 : 1;
    } else {
      normalized += character;
      index += 1;
    }

    boundaries.push(index);
  }

  return { boundaries, normalized };
}

function hydrateInlineSources(state: StateCore) {
  for (const token of state.tokens) {
    if (token.type !== "inline" || token.level !== 1 || !token.map || !token.children) {
      continue;
    }

    const originalSlice = sliceMarkdownEditorOriginalSourceLines(
      state.env,
      token.map[0],
      token.map[1],
    );

    if (originalSlice === null) {
      continue;
    }

    const { boundaries, normalized } = createNormalizedSourceMap(originalSlice);
    const contentStart = normalized.indexOf(token.content);

    if (contentStart < 0) {
      continue;
    }

    let searchOffset = 0;

    for (const child of token.children) {
      if (child.type !== "html_inline" && child.type !== "markora_opaque_inline") {
        continue;
      }

      const meta = child.meta as OpaqueTokenMeta | null;
      const normalizedSource = meta?.markoraOpaqueSource ?? child.content;
      const childStart = token.content.indexOf(normalizedSource, searchOffset);

      if (childStart < 0) {
        continue;
      }

      const sourceStart = boundaries[contentStart + childStart];
      const sourceEnd = boundaries[contentStart + childStart + normalizedSource.length];

      if (sourceStart === undefined || sourceEnd === undefined) {
        continue;
      }

      child.meta = {
        ...meta,
        markoraOpaqueSource: originalSlice.slice(sourceStart, sourceEnd),
      } satisfies OpaqueTokenMeta;
      searchOffset = childStart + normalizedSource.length;
    }
  }
}

export function configureOpaqueMarkdown(tokenizer: MarkdownIt) {
  const blockAlternates = ["paragraph", "reference", "blockquote", "list"];

  tokenizer.block.ruler.before("table", "markora_frontmatter", frontmatterRule, { alt: blockAlternates });
  tokenizer.block.ruler.before("fence", "markora_display_math", displayMathRule, { alt: blockAlternates });
  tokenizer.block.ruler.before("fence", "markora_directive_container", directiveContainerRule, { alt: blockAlternates });
  tokenizer.block.ruler.before("fence", "markora_directive_leaf", directiveLeafRule, { alt: blockAlternates });
  tokenizer.inline.ruler.before("text", "markora_inline_directive", inlineDirectiveRule);
  tokenizer.core.ruler.after("block", "markora_html_source", hydrateHtmlBlockSources);
  tokenizer.core.ruler.after("inline", "markora_inline_source", hydrateInlineSources);
}

export function getOpaqueTokenAttrs(token: Token, fallback: OpaqueMarkdownKind) {
  const meta = token.meta as OpaqueTokenMeta | null;
  const source = meta?.markoraOpaqueSource ?? stripOneTrailingLineEnding(token.content);
  const inferredFallback = fallback === "inline-html" && source.trimStart().startsWith("<!--")
    ? "html-comment"
    : fallback;

  return {
    kind: normalizeOpaqueMarkdownKind(meta?.markoraOpaqueKind, inferredFallback),
    source,
  };
}
