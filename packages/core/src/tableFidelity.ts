import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { MarkdownEditorTableIssue } from "./editorApi";

export function getTableFidelityIssues(doc: ProseMirrorNode) {
  const issues: MarkdownEditorTableIssue[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    let expectedColumns = node.firstChild?.childCount ?? 0;
    node.forEach((row, _rowOffset, rowIndex) => {
      if (row.childCount !== expectedColumns) {
        issues.push(Object.freeze({
          code: "ragged-row" as const,
          column: null,
          message: `Row ${rowIndex + 1} has ${row.childCount} cells; ${expectedColumns} are required.`,
          row: rowIndex,
          tablePos: pos,
        }));
        expectedColumns = Math.max(expectedColumns, row.childCount);
      }

      row.forEach((cell, _cellOffset, columnIndex) => {
        if (rowIndex === 0 && (cell.type.name !== "table_header" || cell.attrs.scope !== "col")) {
          issues.push(Object.freeze({
            code: "missing-column-header" as const,
            column: columnIndex,
            message: "The first table row must contain column headers.",
            row: rowIndex,
            tablePos: pos,
          }));
        }

        if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) {
          issues.push(Object.freeze({
            code: "merged-cell" as const,
            column: columnIndex,
            message: "GFM pipe tables cannot represent merged cells.",
            row: rowIndex,
            tablePos: pos,
          }));
        }

        if (cell.childCount !== 1 || cell.firstChild?.type.name !== "paragraph") {
          issues.push(Object.freeze({
            code: "multi-block-cell" as const,
            column: columnIndex,
            message: "GFM pipe tables cannot preserve multiple or nested blocks in a cell.",
            row: rowIndex,
            tablePos: pos,
          }));
        }

        if (rowIndex > 0 && cell.type.name === "table_header" && cell.attrs.scope === "row") {
          issues.push(Object.freeze({
            code: "row-header-scope" as const,
            column: columnIndex,
            message: "GFM pipe tables cannot preserve HTML row-header scope.",
            row: rowIndex,
            tablePos: pos,
          }));
        }
      });
    });
    return false;
  });

  return Object.freeze(issues);
}
