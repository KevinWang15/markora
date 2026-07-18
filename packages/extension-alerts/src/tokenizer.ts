import type { MarkdownEditorTokenizerRule } from "markora/extension-api";
import type { AlertKind } from "./index.js";

type CoreRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "core" }
>["createRule"]>;

type MarkdownToken = Parameters<CoreRule>[0]["tokens"][number];

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;

export type AlertTokenMeta = Readonly<{
  kind?: AlertKind;
}>;

const markerPattern = /^[\t ]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*$/i;
const claimsByEnvironment = new WeakMap<object, Map<number, AlertKind>>();

function environmentObject(environment: unknown): object | null {
  return typeof environment === "object" && environment !== null
    ? environment
    : null;
}

function blockLine(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

/**
 * Record the exact authored marker while Markdown-it is tokenizing the inside
 * of a blockquote. This rule deliberately returns false so the foundation
 * blockquote state machine remains the authority for lazy lines and nesting.
 */
export function createAlertMarkerClaimRule(): BlockRule {
  return (state, startLine, _endLine, silent) => {
    if (
      silent
      || state.sCount[startLine] - state.blkIndent >= 4
    ) {
      return false;
    }

    const marker = markerKind(blockLine(state, startLine));
    const environment = environmentObject(state.env);

    if (marker && marker.lineEnd < 0 && environment) {
      let claims = claimsByEnvironment.get(environment);

      if (!claims) {
        claims = new Map();
        claimsByEnvironment.set(environment, claims);
      }

      claims.set(startLine, marker.kind);
    }

    return false;
  };
}

function markerKind(content: string) {
  const lineEnd = content.indexOf("\n");
  const firstLine = lineEnd < 0 ? content : content.slice(0, lineEnd);
  const match = markerPattern.exec(firstLine);

  return match
    ? {
        kind: match[1]!.toLowerCase() as AlertKind,
        lineEnd,
      }
    : null;
}

function matchingBlockquoteClose(tokens: readonly MarkdownToken[], openAt: number) {
  let depth = 1;

  for (let index = openAt + 1; index < tokens.length; index += 1) {
    if (tokens[index]!.type === "blockquote_open") {
      depth += 1;
    } else if (tokens[index]!.type === "blockquote_close") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function directMarkerBlock(tokens: readonly MarkdownToken[], openAt: number) {
  const blockOpen = tokens[openAt + 1];
  const inline = tokens[openAt + 2];
  const blockClose = tokens[openAt + 3];
  const paragraph = blockOpen?.type === "paragraph_open"
    && blockClose?.type === "paragraph_close";
  const setextHeading = blockOpen?.type === "heading_open"
    && blockClose?.type === "heading_close"
    && (blockOpen.markup === "=" || blockOpen.markup === "-");

  if (
    (!paragraph && !setextHeading)
    || inline?.type !== "inline"
  ) {
    return null;
  }

  const marker = markerKind(inline.content);

  if (!marker || (setextHeading && marker.lineEnd < 0 && blockOpen.markup !== "-")) {
    return null;
  }

  return { blockOpen, inline, marker, setextHeading };
}

/**
 * Reclassify only blockquotes already accepted by Markdown-it. Running after
 * block parsing and before inline parsing lets the alert body keep ordinary
 * blockquote semantics while a malformed marker remains untouched.
 */
export function createAlertTransformRule(
  alertOpenType: string,
  alertCloseType: string,
): CoreRule {
  return (state) => {
    const tokens = state.tokens;
    const environment = environmentObject(state.env);
    const claims = environment ? claimsByEnvironment.get(environment) : undefined;

    try {
      for (let index = 0; index < tokens.length; index += 1) {
        const open = tokens[index]!;

        if (open.type !== "blockquote_open") {
          continue;
        }

        const markerBlock = directMarkerBlock(tokens, index);

        if (
          !markerBlock
          || !open.map
          || !markerBlock.inline.map
          || open.map[0] !== markerBlock.inline.map[0]
          || claims?.get(markerBlock.inline.map[0]) !== markerBlock.marker.kind
        ) {
          continue;
        }

        let closeAt = matchingBlockquoteClose(tokens, index);

        if (closeAt < 0) {
          continue;
        }

        const { blockOpen, inline, marker, setextHeading } = markerBlock;
        const inlineMap = inline.map!;
        open.type = alertOpenType;
        open.tag = "aside";
        open.meta = { kind: marker.kind } satisfies AlertTokenMeta;
        tokens[closeAt]!.type = alertCloseType;
        tokens[closeAt]!.tag = "aside";

        if (setextHeading && marker.lineEnd < 0) {
          // `---` immediately after the marker is tokenized as a Setext
          // underline for that marker. The authored marker claim proves the
          // first line was extension syntax, so recover the remaining line as
          // the thematic break it represents inside the alert body.
          blockOpen.type = "hr";
          blockOpen.tag = "hr";
          blockOpen.nesting = 0;
          blockOpen.markup = "---";
          blockOpen.content = "";
          blockOpen.children = null;
          blockOpen.map = [inlineMap[1], blockOpen.map?.[1] ?? inlineMap[1] + 1];
          tokens.splice(index + 2, 2);
          closeAt -= 2;
        } else if (marker.lineEnd >= 0) {
          inline.content = inline.content.slice(marker.lineEnd + 1);

          if (inline.map) {
            inline.map = [inline.map[0] + 1, inline.map[1]];
          }

          if (blockOpen.map) {
            blockOpen.map = [blockOpen.map[0] + 1, blockOpen.map[1]];
          }
        } else if (closeAt > index + 4) {
          // A blank line after the marker gives it a standalone paragraph.
          // Remove that parser-only wrapper when real body blocks follow. A
          // marker-only alert keeps an empty paragraph so the editable block+
          // schema always has a valid cursor position.
          tokens.splice(index + 1, 3);
          closeAt -= 3;
        } else {
          inline.content = "";
        }
      }
    } finally {
      if (environment) {
        claimsByEnvironment.delete(environment);
      }
    }
  };
}
