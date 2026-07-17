import type { Node as ProseMirrorNode } from "prosemirror-model";

export type TableCellInfo = {
  table: ProseMirrorNode;
  row: ProseMirrorNode;
  cell: ProseMirrorNode;
  tablePos: number;
  rowPos: number;
  cellPos: number;
  rowIndex: number;
  cellIndex: number;
};

export type TableSelectionInfo = TableCellInfo & {
  anchorCellIndex: number;
  anchorRowIndex: number;
  columnFrom: number;
  columnTo: number;
  isCellSelection: boolean;
  rowFrom: number;
  rowTo: number;
};
