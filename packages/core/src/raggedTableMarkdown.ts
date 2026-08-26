import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

// Keep the same expansion ceiling as Markdown-it's table rule. When a ragged
// table would exceed it, declining the table preserves its source as ordinary
// Markdown instead of constructing an unexpectedly large document.
const MAX_AUTOCOMPLETED_CELLS = 0x10000;

function isSpace(code: number) {
  return code === 0x09 || code === 0x20;
}

function getLine(state: StateBlock, line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

// This deliberately matches Markdown-it's GFM table splitting semantics.
// Pipes must be backslash-escaped even when they appear in a code span.
function splitTableRow(source: string) {
  const cells: string[] = [];
  let current = "";
  let lastPosition = 0;
  let escaped = false;

  for (let position = 0; position < source.length; position += 1) {
    const character = source.charCodeAt(position);

    if (character === 0x7c) {
      if (!escaped) {
        cells.push(current + source.slice(lastPosition, position));
        current = "";
        lastPosition = position + 1;
      } else {
        current += source.slice(lastPosition, position - 1);
        lastPosition = position;
      }
    }

    escaped = character === 0x5c;
  }

  cells.push(current + source.slice(lastPosition));
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * Markdown-it-compatible GFM table rule that expands the table to its widest
 * authored row. Upstream intentionally truncates body cells beyond the header
 * width; Markora instead adds empty header/divider cells so authored content
 * remains editable and canonicalizes to a rectangular pipe table.
 */
export function widestRowTableRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) {
  if (startLine + 2 > endLine) return false;

  const dividerLine = startLine + 1;
  if (
    state.sCount[dividerLine] < state.blkIndent
    || state.sCount[dividerLine] - state.blkIndent >= 4
  ) {
    return false;
  }

  let position = state.bMarks[dividerLine] + state.tShift[dividerLine];
  if (position >= state.eMarks[dividerLine]) return false;

  const firstCharacter = state.src.charCodeAt(position);
  position += 1;
  if (firstCharacter !== 0x7c && firstCharacter !== 0x2d && firstCharacter !== 0x3a) {
    return false;
  }
  if (position >= state.eMarks[dividerLine]) return false;

  const secondCharacter = state.src.charCodeAt(position);
  position += 1;
  if (
    secondCharacter !== 0x7c
    && secondCharacter !== 0x2d
    && secondCharacter !== 0x3a
    && !isSpace(secondCharacter)
  ) {
    return false;
  }
  if (firstCharacter === 0x2d && isSpace(secondCharacter)) return false;

  while (position < state.eMarks[dividerLine]) {
    const character = state.src.charCodeAt(position);
    if (
      character !== 0x7c
      && character !== 0x2d
      && character !== 0x3a
      && !isSpace(character)
    ) {
      return false;
    }
    position += 1;
  }

  const dividerParts = getLine(state, dividerLine).split("|");
  const alignments: string[] = [];
  for (let index = 0; index < dividerParts.length; index += 1) {
    const part = dividerParts[index].trim();
    if (!part) {
      if (index === 0 || index === dividerParts.length - 1) continue;
      return false;
    }
    if (!/^:?-+:?$/.test(part)) return false;

    if (part.endsWith(":")) {
      alignments.push(part.startsWith(":") ? "center" : "right");
    } else {
      alignments.push(part.startsWith(":") ? "left" : "");
    }
  }

  const headerLine = getLine(state, startLine).trim();
  if (
    !headerLine.includes("|")
    || state.sCount[startLine] - state.blkIndent >= 4
  ) {
    return false;
  }
  const headerCells = splitTableRow(headerLine);
  const headerWidth = headerCells.length;
  if (headerWidth === 0 || headerWidth !== alignments.length) return false;
  if (silent) return true;

  const terminators = state.md.block.ruler.getRules("blockquote");
  const bodyRows: Array<{ cells: string[]; line: number }> = [];
  let widest = headerWidth;
  let nextLine = startLine + 2;

  for (; nextLine < endLine; nextLine += 1) {
    if (state.sCount[nextLine] < state.blkIndent) break;

    let terminate = false;
    for (const terminator of terminators) {
      if (terminator(state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;

    const source = getLine(state, nextLine).trim();
    if (!source || state.sCount[nextLine] - state.blkIndent >= 4) break;

    const cells = splitTableRow(source);
    bodyRows.push({ cells, line: nextLine });
    widest = Math.max(widest, cells.length);
  }

  const autocompletedCells = widest - headerWidth
    + bodyRows.reduce((total, row) => total + widest - row.cells.length, 0);
  if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) return false;

  const paddedAlignments = [
    ...alignments,
    ...Array.from({ length: widest - headerWidth }, () => ""),
  ];
  const runtimeState = state as unknown as { parentType: string };
  const oldParentType = runtimeState.parentType;
  runtimeState.parentType = "table";

  const tableOpen = state.push("table_open", "table", 1);
  tableOpen.map = [startLine, nextLine];
  const headOpen = state.push("thead_open", "thead", 1);
  headOpen.map = [startLine, startLine + 1];
  const headerRowOpen = state.push("tr_open", "tr", 1);
  headerRowOpen.map = [startLine, startLine + 1];

  for (let column = 0; column < widest; column += 1) {
    const cellOpen = state.push("th_open", "th", 1);
    if (paddedAlignments[column]) {
      cellOpen.attrs = [["style", `text-align:${paddedAlignments[column]}`]];
    }
    const inline = state.push("inline", "", 0);
    inline.content = headerCells[column]?.trim() ?? "";
    inline.children = [];
    state.push("th_close", "th", -1);
  }

  state.push("tr_close", "tr", -1);
  state.push("thead_close", "thead", -1);

  if (bodyRows.length > 0) {
    const bodyOpen = state.push("tbody_open", "tbody", 1);
    bodyOpen.map = [startLine + 2, nextLine];

    for (const row of bodyRows) {
      const rowOpen = state.push("tr_open", "tr", 1);
      rowOpen.map = [row.line, row.line + 1];

      for (let column = 0; column < widest; column += 1) {
        const cellOpen = state.push("td_open", "td", 1);
        if (paddedAlignments[column]) {
          cellOpen.attrs = [["style", `text-align:${paddedAlignments[column]}`]];
        }
        const inline = state.push("inline", "", 0);
        inline.content = row.cells[column]?.trim() ?? "";
        inline.children = [];
        state.push("td_close", "td", -1);
      }

      state.push("tr_close", "tr", -1);
    }

    state.push("tbody_close", "tbody", -1);
  }

  state.push("table_close", "table", -1);
  runtimeState.parentType = oldParentType;
  state.line = nextLine;
  return true;
}
