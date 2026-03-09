import type { Node as ProseMirrorNode, NodeType, Schema } from "prosemirror-model";
import { Selection, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { TableCellInfo } from "./tableTypes";

export type TableAlignment = "left" | "center" | "right";

export type CreateTableNavigationOptions = {
  schema: Schema;
  getTableCellContext: (state: EditorState) => TableCellInfo | null;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  moveAfterManagedBlock: (view: EditorView, blockPos: number) => boolean;
};

export function createTableNavigation(options: CreateTableNavigationOptions) {
  const { schema, getTableCellContext, normalizeTableAlignment, moveBeforeManagedBlock, moveAfterManagedBlock } = options;

  function getTableCellSelection(doc: ProseMirrorNode, cellPos: number) {
    return Selection.near(doc.resolve(cellPos + 2), 1);
  }

  function getTableColumnAlignments(table: ProseMirrorNode) {
    const firstRow = table.firstChild;

    return Array.from({ length: firstRow?.childCount ?? 0 }, (_, index) =>
      normalizeTableAlignment(firstRow?.child(index).attrs.align),
    );
  }

  function updateTableWithSelection(
    view: EditorView,
    info: TableCellInfo,
    rows: ProseMirrorNode[],
    targetRowIndex: number,
    targetCellIndex: number,
  ) {
    const nextTable = schema.nodes.table.create(info.table.attrs, rows, info.table.marks);
    const tr = view.state.tr.replaceWith(info.tablePos, info.tablePos + info.table.nodeSize, nextTable);

    let cellPos = info.tablePos + 1;

    for (let rowIndex = 0; rowIndex < targetRowIndex; rowIndex += 1) {
      cellPos += rows[rowIndex].nodeSize;
    }

    cellPos += 1;

    for (let cellIndex = 0; cellIndex < targetCellIndex; cellIndex += 1) {
      cellPos += rows[targetRowIndex].child(cellIndex).nodeSize;
    }

    tr.setSelection(getTableCellSelection(tr.doc, cellPos));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  function createParagraphCell(cellType: NodeType, align: TableAlignment | null) {
    return cellType.create({ align }, schema.nodes.paragraph.create());
  }

  function createEmptyTableRow(columnCount: number, alignments?: (TableAlignment | null)[]) {
    return schema.nodes.table_row.create(
      null,
      Array.from({ length: columnCount }, (_, index) => createParagraphCell(schema.nodes.table_cell, alignments?.[index] ?? null)),
    );
  }

  function appendTableRow(view: EditorView) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const alignments = getTableColumnAlignments(info.table);
    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row, _offset, index) => {
      rows.push(row);

      if (index === info.rowIndex) {
        rows.push(createEmptyTableRow(row.childCount, alignments));
      }
    });

    return updateTableWithSelection(view, info, rows, info.rowIndex + 1, 0);
  }

  function appendTableColumn(view: EditorView) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];

      row.forEach((cell, _offset, cellIndex) => {
        cells.push(cell);

        if (cellIndex === info.cellIndex) {
          const cellType = row.firstChild?.type === schema.nodes.table_header ? schema.nodes.table_header : schema.nodes.table_cell;
          const align = normalizeTableAlignment(cell.attrs.align);
          cells.push(createParagraphCell(cellType, align));
        }
      });

      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return updateTableWithSelection(view, info, rows, info.rowIndex, info.cellIndex + 1);
  }

  function setTableColumnAlignment(view: EditorView, align: TableAlignment) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];

      row.forEach((cell, _offset, cellIndex) => {
        if (cellIndex === info.cellIndex) {
          cells.push(cell.type.create({ ...cell.attrs, align }, cell.content, cell.marks));
          return;
        }

        cells.push(cell);
      });

      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return updateTableWithSelection(view, info, rows, info.rowIndex, info.cellIndex);
  }

  function removeTableRow(view: EditorView) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    if (info.table.childCount <= 1) {
      return removeActiveTable(view);
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, rowIndex) => {
      if (rowIndex !== info.rowIndex) {
        rows.push(row);
      }
    });

    const targetRowIndex = Math.min(info.rowIndex, rows.length - 1);
    const targetCellIndex = Math.min(info.cellIndex, rows[targetRowIndex].childCount - 1);
    return updateTableWithSelection(view, info, rows, targetRowIndex, targetCellIndex);
  }

  function removeTableColumn(view: EditorView) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    if (info.row.childCount <= 1) {
      return removeActiveTable(view);
    }

    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];

      row.forEach((cell, _offset, cellIndex) => {
        if (cellIndex !== info.cellIndex) {
          cells.push(cell);
        }
      });

      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    const targetCellIndex = Math.min(info.cellIndex, rows[info.rowIndex].childCount - 1);
    return updateTableWithSelection(view, info, rows, info.rowIndex, targetCellIndex);
  }

  function removeActiveTable(view: EditorView) {
    const info = getTableCellContext(view.state);

    if (!info) {
      return false;
    }

    const paragraph = schema.nodes.paragraph.create();
    const tr = view.state.tr.replaceWith(info.tablePos, info.tablePos + info.table.nodeSize, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, info.tablePos + 1));
    view.dispatch(tr.scrollIntoView());
    return true;
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

    return appendTableRow(view);
  }

  return {
    createEmptyTableRow,
    appendTableRow,
    appendTableColumn,
    removeTableRow,
    removeTableColumn,
    setTableColumnAlignment,
    removeActiveTable,
    moveTableCellVertical,
    moveTableCell,
  };
}
