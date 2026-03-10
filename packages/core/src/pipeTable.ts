import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { TableAlignment } from "./tableNavigation";

export function createPipeTableHelpers(options: {
  schema: Schema;
  createEmptyTableRow: (columnCount: number, alignments?: (TableAlignment | null)[]) => ProseMirrorNode;
  createTableCellContentFromMarkdown: (text: string) => ProseMirrorNode["content"];
}) {
  const { createEmptyTableRow, createTableCellContentFromMarkdown, schema } = options;

  function parsePipeTableRow(text: string) {
    const trimmed = text.trim();

    if (!trimmed.includes("|")) {
      return null;
    }

    const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let current = "";
    let escapeNext = false;
    let backtickFenceLength = 0;
    let index = 0;

    while (index < normalized.length) {
      const char = normalized[index];

      if (escapeNext) {
        current += char;
        escapeNext = false;
        index += 1;
        continue;
      }

      if (char === "\\") {
        current += char;
        escapeNext = true;
        index += 1;
        continue;
      }

      if (char === "`") {
        let fenceLength = 1;

        while (normalized[index + fenceLength] === "`") {
          fenceLength += 1;
        }

        current += "`".repeat(fenceLength);

        if (backtickFenceLength === 0) {
          backtickFenceLength = fenceLength;
        } else if (backtickFenceLength === fenceLength) {
          backtickFenceLength = 0;
        }

        index += fenceLength;
        continue;
      }

      if (char === "|" && backtickFenceLength === 0) {
        cells.push(current.trim());
        current = "";
        index += 1;
        continue;
      }

      current += char;
      index += 1;
    }

    cells.push(current.trim());

    return cells.length >= 2 ? cells : null;
  }

  function isPipeTableDividerCell(text: string) {
    return /^:?-{3,}:?$/.test(text.trim());
  }

  function parsePipeTableDivider(text: string) {
    const cells = parsePipeTableRow(text);

    if (!cells || cells.some((cell) => !isPipeTableDividerCell(cell))) {
      return null;
    }

    return cells.map((cell) => {
      const trimmed = cell.trim();

      if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
        return "center" as TableAlignment;
      }

      if (trimmed.startsWith(":")) {
        return "left" as TableAlignment;
      }

      if (trimmed.endsWith(":")) {
        return "right" as TableAlignment;
      }

      return null;
    });
  }

  function createTableNodeFromMarkdownRows(headerCells: string[], alignments: (TableAlignment | null)[]) {
    const columnCount = alignments.length;
    const normalizedHeaderCells =
      headerCells.length === columnCount ? headerCells : Array.from({ length: columnCount }, () => "");

    const headerRow = schema.nodes.table_row.create(
      null,
      normalizedHeaderCells.map((cellText, index) =>
        schema.nodes.table_header.create(
          { align: alignments[index] ?? null },
          createTableCellContentFromMarkdown(cellText),
        ),
      ),
    );

    const bodyRow = createEmptyTableRow(columnCount, alignments);

    return { table: schema.nodes.table.create(null, [headerRow, bodyRow]), headerRow };
  }

  function convertPipeTable(view: EditorView) {
    const { state } = view;
    const { selection } = state;

    if (!selection.empty) {
      return false;
    }

    const { $from } = selection;

    if ($from.parent.type !== schema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size || $from.depth < 1) {
      return false;
    }

    const alignments = parsePipeTableDivider($from.parent.textContent);

    if (!alignments) {
      return false;
    }

    const columnCount = alignments.length;
    const containerDepth = $from.depth - 1;
    const container = $from.node(containerDepth);
    const index = $from.index(containerDepth);

    let from = $from.before();
    let headerCells = Array.from({ length: columnCount }, () => "");

    if (index > 0) {
      const previousNode = container.child(index - 1);

      if (previousNode.type === schema.nodes.paragraph) {
        const parsedHeaderCells = parsePipeTableRow(previousNode.textContent);

        if (parsedHeaderCells && parsedHeaderCells.length === columnCount) {
          headerCells = parsedHeaderCells;
          from -= previousNode.nodeSize;
        }
      }
    }

    const to = $from.after();
    const { table, headerRow } = createTableNodeFromMarkdownRows(headerCells, alignments);
    const tr = state.tr.replaceWith(from, to, [table]);
    const bodyCellTextPos = from + 1 + headerRow.nodeSize + 3;
    tr.setSelection(TextSelection.create(tr.doc, bodyCellTextPos));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  return {
    convertPipeTable,
  };
}
