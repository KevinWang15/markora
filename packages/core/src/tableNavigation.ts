import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { Selection, TextSelection, type EditorState } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import {
  createEmptyTableRow as createSharedEmptyTableRow,
  createTableCommandSet,
  type TableAlignment,
} from "./tableCommands";
import type { TableCellInfo } from "./tableTypes";

export type { TableAlignment } from "./tableCommands";

export type CreateTableNavigationOptions = {
  schema: Schema;
  getTableCellContext: (state: EditorState) => TableCellInfo | null;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  moveAfterManagedBlock: (view: EditorView, blockPos: number) => boolean;
};

export function createTableNavigation(options: CreateTableNavigationOptions) {
  const { schema, getTableCellContext, normalizeTableAlignment, moveBeforeManagedBlock, moveAfterManagedBlock } = options;
  const tableCommands = createTableCommandSet(schema);

  function getTableCellSelection(doc: ProseMirrorNode, cellPos: number) {
    return Selection.near(doc.resolve(cellPos + 2), 1);
  }

  function createEmptyTableRow(columnCount: number, alignments?: (TableAlignment | null)[]) {
    const row = createSharedEmptyTableRow(schema, columnCount, alignments);

    if (!row) {
      throw new Error("The active schema does not support table rows.");
    }

    return row;
  }

  function addTableRow(view: EditorView, side: "before" | "after" = "after") {
    return tableCommands.addTableRow(side)(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function addTableColumn(view: EditorView, side: "before" | "after" = "after") {
    return tableCommands.addTableColumn(side)(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function insertTableRowAt(view: EditorView, index: number) {
    return tableCommands.insertTableRowAt(index)(
      view.state,
      (transaction) => view.dispatch(transaction),
      view,
    );
  }

  function insertTableColumnAt(view: EditorView, index: number) {
    return tableCommands.insertTableColumnAt(index)(
      view.state,
      (transaction) => view.dispatch(transaction),
      view,
    );
  }

  function getCellPosition(
    info: TableCellInfo,
    rowIndex: number,
    columnIndex: number,
  ) {
    const row = info.table.maybeChild(rowIndex);

    if (!row || columnIndex < 0 || columnIndex >= row.childCount) {
      return null;
    }

    let position = info.tablePos + 1;
    for (let index = 0; index < rowIndex; index += 1) {
      position += info.table.child(index).nodeSize;
    }
    position += 1;
    for (let index = 0; index < columnIndex; index += 1) {
      position += row.child(index).nodeSize;
    }
    return position;
  }

  function selectTableAxis(view: EditorView, axis: "row" | "column", index: number) {
    const info = getTableCellContext(view.state);
    const rowCount = info?.table.childCount ?? 0;
    const columnCount = info?.table.firstChild?.childCount ?? 0;

    if (
      !info
      || !Number.isInteger(index)
      || index < 0
      || (axis === "row" ? index >= rowCount : index >= columnCount)
    ) {
      return false;
    }

    const anchorRow = axis === "row" ? index : 0;
    const anchorColumn = axis === "column" ? index : 0;
    const headRow = axis === "row" ? index : rowCount - 1;
    const headColumn = axis === "column" ? index : columnCount - 1;
    const anchorPos = getCellPosition(info, anchorRow, anchorColumn);
    const headPos = getCellPosition(info, headRow, headColumn);

    if (anchorPos === null || headPos === null) {
      return false;
    }

    view.dispatch(view.state.tr.setSelection(CellSelection.create(
      view.state.doc,
      anchorPos,
      headPos,
    )));
    return true;
  }

  function selectTableRow(view: EditorView, index: number) {
    return selectTableAxis(view, "row", index);
  }

  function selectTableColumn(view: EditorView, index: number) {
    return selectTableAxis(view, "column", index);
  }

  function moveTableRow(view: EditorView, direction: "up" | "down") {
    return tableCommands.moveTableRow(direction)(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function moveTableColumn(view: EditorView, direction: "left" | "right") {
    return tableCommands.moveTableColumn(direction)(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function setTableColumnAlignment(view: EditorView, align: TableAlignment | null) {
    return tableCommands.setTableColumnAlignment(align)(
      view.state,
      (transaction) => view.dispatch(transaction),
      view,
    );
  }

  function removeTableRow(view: EditorView) {
    return tableCommands.deleteTableRow(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function removeTableColumn(view: EditorView) {
    return tableCommands.deleteTableColumn(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function removeActiveTable(view: EditorView) {
    return tableCommands.deleteTable(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function isAtVerticalTableBoundary(view: EditorView, direction: -1 | 1) {
    const { selection } = view.state;

    if (!selection.empty) {
      return false;
    }

    const { $from } = selection;

    if (!$from.parent.isTextblock) {
      return false;
    }

    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const boundarySelection = findTextSelectionInCell(view.state.doc, info.cellPos, info.cell, direction);

    if (!boundarySelection) {
      return false;
    }

    if (selection.from === boundarySelection.from && selection.to === boundarySelection.to) {
      return true;
    }

    const currentCoords = getCursorRect(view, selection.from);
    const boundaryCoords = getCursorRect(view, boundarySelection.from);

    if (!currentCoords || !boundaryCoords) {
      return false;
    }

    const lineHeight = Math.max(1, currentCoords.bottom - currentCoords.top, boundaryCoords.bottom - boundaryCoords.top);
    const tolerance = Math.max(2, lineHeight * 0.15);

    return direction < 0
      ? Math.abs(currentCoords.top - boundaryCoords.top) <= tolerance
      : Math.abs(currentCoords.bottom - boundaryCoords.bottom) <= tolerance;
  }

  function getCursorRect(view: EditorView, pos: number) {
    try {
      return view.coordsAtPos(pos);
    } catch {
      return null;
    }
  }

  function findTextSelectionInCell(
    doc: ProseMirrorNode,
    cellPos: number,
    cell: ProseMirrorNode,
    direction: -1 | 1,
  ) {
    const searchPos = direction < 0 ? cellPos + 2 : cellPos + cell.nodeSize - 2;
    const selection = Selection.near(doc.resolve(searchPos), direction);

    if (!selection || !(selection instanceof TextSelection)) {
      return null;
    }

    const from = cellPos;
    const to = cellPos + cell.nodeSize;
    return selection.from >= from && selection.to <= to ? selection : null;
  }

  function moveTableCellVertical(view: EditorView, direction: -1 | 1) {
    const info = getTableCellContext(view.state);

    if (!info || !isAtVerticalTableBoundary(view, direction)) {
      return false;
    }

    const targetRowIndex = info.rowIndex + direction;

    if (targetRowIndex < 0) {
      return moveBeforeManagedBlock(view, info.tablePos);
    }

    if (targetRowIndex >= info.table.childCount) {
      return moveAfterManagedBlock(view, info.tablePos);
    }

    const targetRow = info.table.child(targetRowIndex);
    const targetCellIndex = Math.min(info.cellIndex, targetRow.childCount - 1);
    let targetPos = info.tablePos + 1;

    for (let rowIndex = 0; rowIndex < targetRowIndex; rowIndex += 1) {
      targetPos += info.table.child(rowIndex).nodeSize;
    }

    targetPos += 1;

    for (let cellIndex = 0; cellIndex < targetCellIndex; cellIndex += 1) {
      targetPos += targetRow.child(cellIndex).nodeSize;
    }

    view.dispatch(view.state.tr.setSelection(getTableCellSelection(view.state.doc, targetPos)).scrollIntoView());
    return true;
  }

  function moveTableCell(view: EditorView, direction: -1 | 1) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const { state } = view;
    const rowCount = info.table.childCount;
    const columnCount = info.row.childCount;

    if (direction < 0) {
      if (info.cellIndex > 0) {
        let targetPos = info.cellPos - info.row.child(info.cellIndex - 1).nodeSize;
        view.dispatch(state.tr.setSelection(getTableCellSelection(state.doc, targetPos)));
        return true;
      }

      if (info.rowIndex > 0) {
        const previousRow = info.table.child(info.rowIndex - 1);
        let targetPos = info.rowPos - previousRow.nodeSize;
        for (let index = 0; index < previousRow.childCount - 1; index += 1) {
          targetPos += previousRow.child(index).nodeSize;
        }
        view.dispatch(state.tr.setSelection(getTableCellSelection(state.doc, targetPos)));
        return true;
      }

      return moveBeforeManagedBlock(view, info.tablePos);
    }

    if (info.cellIndex < columnCount - 1) {
      const targetPos = info.cellPos + info.cell.nodeSize;
      view.dispatch(state.tr.setSelection(getTableCellSelection(state.doc, targetPos)));
      return true;
    }

    if (info.rowIndex < rowCount - 1) {
      const targetPos = info.rowPos + info.row.nodeSize + 1;
      view.dispatch(state.tr.setSelection(getTableCellSelection(state.doc, targetPos)));
      return true;
    }

    return addTableRow(view, "after") || moveAfterManagedBlock(view, info.tablePos);
  }

  return {
    createEmptyTableRow,
    addTableRow,
    addTableColumn,
    insertTableRowAt,
    insertTableColumnAt,
    selectTableRow,
    selectTableColumn,
    moveTableRow,
    moveTableColumn,
    removeTableRow,
    removeTableColumn,
    setTableColumnAlignment,
    removeActiveTable,
    moveTableCellVertical,
    moveTableCell,
  };
}
