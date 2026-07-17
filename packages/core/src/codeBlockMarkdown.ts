import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

const CODE_BLOCK_INFO_UNREPRESENTABLE_CHARACTER = /[\0\r\n]/u;

export function isValidCodeBlockInfo(info: string) {
  return !CODE_BLOCK_INFO_UNREPRESENTABLE_CHARACTER.test(info);
}

export function normalizeCodeBlockInfo(info: string) {
  if (!isValidCodeBlockInfo(info)) {
    throw new RangeError("Code block language must be at most 128 characters and contain no NUL or line-break characters.");
  }

  const normalized = info.trim();

  if (normalized.length > 128) {
    throw new RangeError("Code block language must be at most 128 characters and contain no NUL or line-break characters.");
  }

  return normalized;
}

export function sanitizeCodeBlockDomInfo(info: string | null) {
  return info != null && isValidCodeBlockInfo(info) ? info.trim() : null;
}

export function codeBlockFenceTokenAttrs(token: { info?: unknown }) {
  return {
    params: typeof token.info === "string" ? token.info.trim() : "",
  };
}

function longestDelimiterRun(text: string, delimiter: "`" | "~") {
  let longest = 0;
  let current = 0;

  for (const character of text) {
    if (character === delimiter) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

export function serializeCodeBlock(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
) {
  const params = typeof node.attrs.params === "string" ? node.attrs.params : "";

  if (!isValidCodeBlockInfo(params)) {
    throw new RangeError("Code block info must contain no NUL or line-break characters.");
  }

  if (params !== params.trim()) {
    throw new RangeError("Code block info must be normalized without surrounding whitespace.");
  }

  if (/[\0\r]/u.test(node.textContent)) {
    throw new RangeError("Code block text must contain no NUL or carriage-return characters.");
  }

  const delimiter = params.includes("`") ? "~" : "`";
  const fenceLength = Math.max(
    3,
    longestDelimiterRun(node.textContent, delimiter) + 1,
  );
  const fence = delimiter.repeat(fenceLength);
  const infoSeparator = delimiter === "~" && params.startsWith("~") ? " " : "";

  state.write(`${fence}${infoSeparator}${params}\n`);
  state.text(node.textContent, false);
  state.write("\n");
  state.write(fence);
  state.closeBlock(node);
}
