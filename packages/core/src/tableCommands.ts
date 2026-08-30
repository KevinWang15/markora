import type {
  Node as ProseMirrorNode,
  NodeType,
  ResolvedPos,
  Schema,
} from "prosemirror-model";
import {
  NodeSelection,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type {
  MarkdownEditorTableAlignment,
  MarkdownEditorTableColumnMoveDirection,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorTableInsertSide,
  MarkdownEditorTableResizeOptions,
  MarkdownEditorTableRowMoveDirection,
} from "./editorApi";
import type { TableCellInfo, TableSelectionInfo } from "./tableTypes";

export type TableAlignment = Exclude<MarkdownEditorTableAlignment, null>;

const DEFAULT_TABLE_COLUMNS = 3;
const DEFAULT_TABLE_ROWS = 2;
const MAX_TABLE_DIMENSION = 100;

type NormalizedTableInsertOptions = Readonly<{
  columns: number;
  rows: number;
}>;

type NormalizedTableResizeOptions = Readonly<{
  columns?: number;
  discardContent: boolean;
  rows?: number;
}>;

type TableInfo = Readonly<{
  node: ProseMirrorNode;
  pos: number;
}>;

function assertTableDimension(value: unknown, name: "columns" | "rows") {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_TABLE_DIMENSION) {
    throw new RangeError(`Table ${name} must be an integer between 1 and ${MAX_TABLE_DIMENSION}.`);
  }

  return value as number;
}

export function normalizeTableInsertOptions(
  options: MarkdownEditorTableInsertOptions | undefined,
): NormalizedTableInsertOptions {
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    throw new TypeError("Table insertion options must be an object.");
  }

  const columns = assertTableDimension(options?.columns ?? DEFAULT_TABLE_COLUMNS, "columns");
  const rows = assertTableDimension(options?.rows ?? DEFAULT_TABLE_ROWS, "rows");
  return Object.freeze({ columns, rows });
}

export function normalizeTableInsertSide(
  side: MarkdownEditorTableInsertSide | undefined,
): MarkdownEditorTableInsertSide {
  if (side !== undefined && side !== "before" && side !== "after") {
    throw new RangeError('Table insertion side must be "before" or "after".');
  }

  return side ?? "after";
}

export function normalizeTableResizeOptions(
  options: MarkdownEditorTableResizeOptions,
): NormalizedTableResizeOptions {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Table resize options must be an object.");
  }

  if (options.rows === undefined && options.columns === undefined) {
    throw new TypeError("Table resize options must include rows, columns, or both.");
  }

  if (options.discardContent !== undefined && typeof options.discardContent !== "boolean") {
    throw new TypeError("Table resize discardContent must be a boolean.");
  }

  return Object.freeze({
    ...(options.columns === undefined
      ? {}
      : { columns: assertTableDimension(options.columns, "columns") }),
    discardContent: options.discardContent ?? false,
    ...(options.rows === undefined
      ? {}
      : { rows: assertTableDimension(options.rows, "rows") }),
  });
}

export function normalizeTableRowMoveDirection(
  direction: MarkdownEditorTableRowMoveDirection,
): MarkdownEditorTableRowMoveDirection {
  if (direction !== "up" && direction !== "down") {
    throw new RangeError('Table row move direction must be "up" or "down".');
  }
  return direction;
}

export function normalizeTableColumnMoveDirection(
  direction: MarkdownEditorTableColumnMoveDirection,
): MarkdownEditorTableColumnMoveDirection {
  if (direction !== "left" && direction !== "right") {
    throw new RangeError('Table column move direction must be "left" or "right".');
  }
  return direction;
}

export function normalizeTableAlignment(
  alignment: MarkdownEditorTableAlignment,
): MarkdownEditorTableAlignment {
  if (
    alignment !== null
    && alignment !== "left"
    && alignment !== "center"
    && alignment !== "right"
  ) {
    throw new RangeError('Table alignment must be "left", "center", "right", or null.');
  }

  return alignment;
}

function findAncestor(
  $pos: ResolvedPos,
  nodeType: NodeType | undefined,
) {
  if (!nodeType) {
    return null;
  }

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === nodeType) {
      return {
        depth,
        node: $pos.node(depth),
        pos: $pos.before(depth),
      };
    }
  }

  return null;
}

function getTableCellContextAtPos(
  $pos: ResolvedPos,
  schema: Schema,
): TableCellInfo | null {
  const tableType = schema.nodes.table;
  const rowType = schema.nodes.table_row;
  const cellType = schema.nodes.table_cell;
  const headerType = schema.nodes.table_header;

  if (!tableType || !rowType || (!cellType && !headerType)) {
    return null;
  }

  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (cellDepth < 0 && (node.type === cellType || node.type === headerType)) {
      cellDepth = depth;
      continue;
    }

    if (rowDepth < 0 && node.type === rowType) {
      rowDepth = depth;
      continue;
    }

    if (tableDepth < 0 && node.type === tableType) {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
    return null;
  }

  return {
    table: $pos.node(tableDepth),
    row: $pos.node(rowDepth),
    cell: $pos.node(cellDepth),
    tablePos: $pos.before(tableDepth),
    rowPos: $pos.before(rowDepth),
    cellPos: $pos.before(cellDepth),
    rowIndex: $pos.index(tableDepth),
    cellIndex: $pos.index(rowDepth),
  };
}

type CellSelectionLike = Selection & {
  $anchorCell: ResolvedPos;
  $headCell: ResolvedPos;
};

function isCellSelectionLike(selection: Selection): selection is CellSelectionLike {
  const candidate = selection as Partial<CellSelectionLike>;
  return Boolean(
    candidate.$anchorCell
    && candidate.$headCell
    && typeof candidate.$anchorCell.pos === "number"
    && typeof candidate.$headCell.pos === "number",
  );
}

function tableHasMergedCells(table: ProseMirrorNode) {
  let merged = false;
  table.forEach((row) => {
    row.forEach((cell) => {
      if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) {
        merged = true;
      }
    });
  });
  return merged;
}

function getTableCellContextAtBoundary(
  $cell: ResolvedPos,
  schema: Schema,
): TableCellInfo | null {
  const rowType = schema.nodes.table_row;
  const tableType = schema.nodes.table;
  const cell = $cell.nodeAfter;

  if (
    !rowType
    || !tableType
    || $cell.parent.type !== rowType
    || $cell.depth < 2
    || $cell.node($cell.depth - 1).type !== tableType
    || !cell
    || (cell.type !== schema.nodes.table_cell && cell.type !== schema.nodes.table_header)
  ) {
    return null;
  }

  const tableDepth = $cell.depth - 1;
  return {
    table: $cell.node(tableDepth),
    row: $cell.parent,
    cell,
    tablePos: $cell.before(tableDepth),
    rowPos: $cell.before($cell.depth),
    cellPos: $cell.pos,
    rowIndex: $cell.index(tableDepth),
    cellIndex: $cell.index(),
  };
}

export function tableCellSelectionIsActive(state: EditorState) {
  return isCellSelectionLike(state.selection);
}

export function getTableSelectionContext(
  state: EditorState,
  schema: Schema,
): TableSelectionInfo | null {
  if (isCellSelectionLike(state.selection)) {
    const anchor = getTableCellContextAtBoundary(state.selection.$anchorCell, schema);
    const head = getTableCellContextAtBoundary(state.selection.$headCell, schema);

    if (!anchor || !head || anchor.tablePos !== head.tablePos) {
      return null;
    }

    // Public structural commands use physical row children as GFM columns.
    // Merged cells have logical TableMap coordinates instead, so keep the
    // document inspectable/deletable without risking a corrupt mutation.
    if (tableHasMergedCells(head.table)) {
      return null;
    }

    return {
      ...head,
      anchorCellIndex: anchor.cellIndex,
      anchorRowIndex: anchor.rowIndex,
      columnFrom: Math.min(anchor.cellIndex, head.cellIndex),
      columnTo: Math.max(anchor.cellIndex, head.cellIndex),
      isCellSelection: true,
      rowFrom: Math.min(anchor.rowIndex, head.rowIndex),
      rowTo: Math.max(anchor.rowIndex, head.rowIndex),
    };
  }

  const from = getTableCellContextAtPos(state.selection.$from, schema);
  const to = getTableCellContextAtPos(state.selection.$to, schema);

  if (!from || !to || from.tablePos !== to.tablePos || from.cellPos !== to.cellPos) {
    return null;
  }


  if (tableHasMergedCells(from.table)) {
    return null;
  }

  return {
    ...from,
    anchorCellIndex: from.cellIndex,
    anchorRowIndex: from.rowIndex,
    columnFrom: from.cellIndex,
    columnTo: from.cellIndex,
    isCellSelection: false,
    rowFrom: from.rowIndex,
    rowTo: from.rowIndex,
  };
}

export function getTableCellContext(
  state: EditorState,
  schema: Schema,
): TableCellInfo | null {
  return getTableSelectionContext(state, schema);
}

function getActiveTableInfo(state: EditorState, schema: Schema): TableInfo | null {
  const tableType = schema.nodes.table;

  if (!tableType) {
    return null;
  }

  if (state.selection instanceof NodeSelection && state.selection.node.type === tableType) {
    return { node: state.selection.node, pos: state.selection.from };
  }

  const table = findAncestor(state.selection.$from, tableType);
  const endTable = findAncestor(state.selection.$to, tableType);

  return table && endTable && table.pos === endTable.pos
    ? { node: table.node, pos: table.pos }
    : null;
}

export function tableIsActive(state: EditorState, schema: Schema) {
  return Boolean(getActiveTableInfo(state, schema));
}

function getTableCellSelection(doc: ProseMirrorNode, cellPos: number) {
  return Selection.near(doc.resolve(cellPos + 2), 1);
}

function createParagraphCell(
  schema: Schema,
  cellType: NodeType,
  align: MarkdownEditorTableAlignment,
  headerScope: "col" | "row" | null = null,
) {
  const attrs = cellType === schema.nodes.table_header
    ? { align, scope: headerScope ?? "col" }
    : { align };
  return cellType.create(attrs, schema.nodes.paragraph.create());
}

export function createEmptyTableRow(
  schema: Schema,
  columnCount: number,
  alignments?: readonly MarkdownEditorTableAlignment[],
) {
  const rowType = schema.nodes.table_row;
  const cellType = schema.nodes.table_cell;

  if (!rowType || !cellType || !schema.nodes.paragraph) {
    return null;
  }

  return rowType.create(
    null,
    Array.from({ length: columnCount }, (_, index) => (
      createParagraphCell(schema, cellType, alignments?.[index] ?? null)
    )),
  );
}

function isColumnHeaderRow(schema: Schema, row: ProseMirrorNode) {
  const headerType = schema.nodes.table_header;

  if (!headerType || row.childCount === 0) {
    return false;
  }

  let isHeaderRow = true;
  row.forEach((cell) => {
    if (cell.type !== headerType || cell.attrs.scope === "row") {
      isHeaderRow = false;
    }
  });
  return isHeaderRow;
}

function promoteRowToColumnHeaders(schema: Schema, row: ProseMirrorNode) {
  const headerType = schema.nodes.table_header;

  if (!headerType) {
    return row;
  }

  const cells: ProseMirrorNode[] = [];
  row.forEach((cell) => {
    cells.push(headerType.create(
      { ...cell.attrs, scope: "col" },
      cell.content,
      cell.marks,
    ));
  });
  return row.type.create(row.attrs, cells, row.marks);
}

function demoteColumnHeaderRow(schema: Schema, row: ProseMirrorNode) {
  const cellType = schema.nodes.table_cell;

  if (!cellType) {
    return row;
  }

  const cells: ProseMirrorNode[] = [];
  row.forEach((cell) => {
    cells.push(cell.type === schema.nodes.table_header && cell.attrs.scope !== "row"
      ? cellType.create({
          align: readAlignment(cell.attrs.align),
          colspan: cell.attrs.colspan,
          rowspan: cell.attrs.rowspan,
          colwidth: cell.attrs.colwidth,
        }, cell.content, cell.marks)
      : cell);
  });
  return row.type.create(row.attrs, cells, row.marks);
}

function readAlignment(value: unknown): MarkdownEditorTableAlignment {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function getTableColumnAlignments(table: ProseMirrorNode) {
  const firstRow = table.firstChild;
  return Array.from({ length: firstRow?.childCount ?? 0 }, (_, index) => (
    readAlignment(firstRow?.child(index).attrs.align)
  ));
}

function getTableColumnCount(table: ProseMirrorNode) {
  let columnCount = 0;
  table.forEach((row) => {
    columnCount = Math.max(columnCount, row.childCount);
  });
  return columnCount;
}

function normalizeRowWidth(
  schema: Schema,
  row: ProseMirrorNode,
  rowIndex: number,
  columnCount: number,
  alignments: readonly MarkdownEditorTableAlignment[],
) {
  if (row.childCount === columnCount) {
    return row;
  }

  const cells: ProseMirrorNode[] = [];
  row.forEach((cell) => cells.push(cell));
  const cellType = rowIndex === 0 ? schema.nodes.table_header : schema.nodes.table_cell;

  if (!cellType) {
    return row;
  }

  while (cells.length < columnCount) {
    cells.push(createParagraphCell(
      schema,
      cellType,
      alignments[cells.length] ?? null,
      rowIndex === 0 ? "col" : null,
    ));
  }

  return row.type.create(row.attrs, cells.slice(0, columnCount), row.marks);
}

function getCellPosition(
  tablePos: number,
  rows: readonly ProseMirrorNode[],
  rowIndex: number,
  cellIndex: number,
) {
  let cellPos = tablePos + 1;

  for (let index = 0; index < rowIndex; index += 1) {
    cellPos += rows[index].nodeSize;
  }

  cellPos += 1;

  for (let index = 0; index < cellIndex; index += 1) {
    cellPos += rows[rowIndex].child(index).nodeSize;
  }

  return cellPos;
}

function clampCellIndex(row: ProseMirrorNode, cellIndex: number) {
  return Math.max(0, Math.min(cellIndex, row.childCount - 1));
}

function updateTableWithSelection(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  schema: Schema,
  info: TableSelectionInfo,
  rows: readonly ProseMirrorNode[],
  targetRowIndex: number,
  targetCellIndex: number,
  targetRange?: Readonly<{
    columnFrom: number;
    columnTo: number;
    rowFrom: number;
    rowTo: number;
  }>,
) {
  const tableType = schema.nodes.table;

  if (!tableType || rows.length === 0) {
    return false;
  }

  const nextTable = tableType.create(info.table.attrs, rows, info.table.marks);

  if (nextTable.eq(info.table)) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const transaction = state.tr.replaceWith(
    info.tablePos,
    info.tablePos + info.table.nodeSize,
    nextTable,
  );
  const safeRowIndex = Math.max(0, Math.min(targetRowIndex, rows.length - 1));
  const safeCellIndex = clampCellIndex(rows[safeRowIndex], targetCellIndex);
  const cellPos = getCellPosition(info.tablePos, rows, safeRowIndex, safeCellIndex);
  let nextSelection: Selection = getTableCellSelection(transaction.doc, cellPos);

  if (targetRange && info.isCellSelection && isCellSelectionLike(state.selection)) {
    const rowFrom = Math.max(0, Math.min(targetRange.rowFrom, rows.length - 1));
    const rowTo = Math.max(rowFrom, Math.min(targetRange.rowTo, rows.length - 1));
    const columnFrom = clampCellIndex(rows[rowFrom], targetRange.columnFrom);
    const columnTo = clampCellIndex(rows[rowTo], targetRange.columnTo);
    const anchorUsesStartRow = info.anchorRowIndex <= info.rowIndex;
    const anchorUsesStartColumn = info.anchorCellIndex <= info.cellIndex;
    const anchorRow = anchorUsesStartRow ? rowFrom : rowTo;
    const headRow = anchorUsesStartRow ? rowTo : rowFrom;
    const anchorColumn = clampCellIndex(
      rows[anchorRow],
      anchorUsesStartColumn ? columnFrom : columnTo,
    );
    const headColumn = clampCellIndex(
      rows[headRow],
      anchorUsesStartColumn ? columnTo : columnFrom,
    );
    const anchorPos = getCellPosition(info.tablePos, rows, anchorRow, anchorColumn);
    const headPos = getCellPosition(info.tablePos, rows, headRow, headColumn);

    try {
      const CellSelectionConstructor = state.selection.constructor as new (
        $anchorCell: ResolvedPos,
        $headCell: ResolvedPos,
      ) => Selection;
      nextSelection = new CellSelectionConstructor(
        transaction.doc.resolve(anchorPos),
        transaction.doc.resolve(headPos),
      );
    } catch {
      // A third-party cell selection can decline reconstruction. The edit is
      // still valid and falls back to an ordinary caret in the target cell.
    }
  }

  transaction.setSelection(nextSelection);
  dispatch(transaction.scrollIntoView());
  return true;
}

function createTableNode(
  schema: Schema,
  options: NormalizedTableInsertOptions,
) {
  const tableType = schema.nodes.table;
  const rowType = schema.nodes.table_row;
  const cellType = schema.nodes.table_cell;
  const headerType = schema.nodes.table_header;
  const paragraphType = schema.nodes.paragraph;

  if (!tableType || !rowType || !cellType || !headerType || !paragraphType) {
    return null;
  }

  const rows = Array.from({ length: options.rows }, (_, rowIndex) => {
    const isHeader = rowIndex === 0;
    const targetCellType = isHeader ? headerType : cellType;
    return rowType.create(
      null,
      Array.from({ length: options.columns }, () => (
        createParagraphCell(schema, targetCellType, null, isHeader ? "col" : null)
      )),
    );
  });

  return tableType.create(null, rows);
}

function findNearestNodePosition(
  doc: ProseMirrorNode,
  nodeType: NodeType,
  target: number,
) {
  let best: { distance: number; pos: number } | null = null;

  doc.descendants((node, pos) => {
    if (node.type === nodeType) {
      const distance = Math.abs(pos - target);
      if (!best || distance < best.distance) {
        best = { distance, pos };
      }
      return false;
    }

    return true;
  });

  return (best as { distance: number; pos: number } | null)?.pos ?? null;
}

function insertTableCommand(
  schema: Schema,
  options: NormalizedTableInsertOptions,
): Command {
  return (state, dispatch) => {
    if (tableIsActive(state, schema)) {
      return false;
    }

    const table = createTableNode(schema, options);

    if (!table) {
      return false;
    }

    let transaction: Transaction;

    try {
      transaction = state.tr.replaceSelectionWith(table);
    } catch {
      return false;
    }

    if (!transaction.docChanged) {
      return false;
    }

    const tablePos = findNearestNodePosition(
      transaction.doc,
      table.type,
      transaction.selection.from,
    );

    if (tablePos === null) {
      return false;
    }

    const insertedTable = transaction.doc.nodeAt(tablePos);
    const firstTextSelection = insertedTable
      ? Selection.findFrom(transaction.doc.resolve(tablePos + 1), 1, true)
      : null;

    if (
      firstTextSelection
      && insertedTable
      && firstTextSelection.from > tablePos
      && firstTextSelection.to < tablePos + insertedTable.nodeSize
    ) {
      transaction.setSelection(firstTextSelection);
    }

    if (dispatch) {
      dispatch(transaction.scrollIntoView());
    }

    return true;
  };
}

function addTableRowCommand(
  schema: Schema,
  side: MarkdownEditorTableInsertSide,
  insertionIndexOverride?: number,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);

    if (!info || info.table.childCount >= MAX_TABLE_DIMENSION) {
      return false;
    }

    const columnCount = getTableColumnCount(info.table);
    const alignments = getTableColumnAlignments(info.table);
    let nextRow = createEmptyTableRow(schema, columnCount, alignments);

    if (!nextRow) {
      return false;
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, rowIndex) => {
      rows.push(normalizeRowWidth(schema, row, rowIndex, columnCount, alignments));
    });
    const insertionIndex = insertionIndexOverride
      ?? (side === "before" ? info.rowFrom : info.rowTo + 1);

    if (
      !Number.isInteger(insertionIndex)
      || insertionIndex < 0
      || insertionIndex > info.table.childCount
    ) {
      return false;
    }

    if (insertionIndex === 0) {
      nextRow = promoteRowToColumnHeaders(schema, nextRow);
      rows[0] = demoteColumnHeaderRow(schema, rows[0]);
    }

    rows.splice(insertionIndex, 0, nextRow);

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      insertionIndex,
      Math.min(info.columnFrom, columnCount - 1),
    );
  };
}

function addTableColumnCommand(
  schema: Schema,
  side: MarkdownEditorTableInsertSide,
  insertionIndexOverride?: number,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);
    const columnCount = info ? getTableColumnCount(info.table) : 0;

    if (!info || columnCount >= MAX_TABLE_DIMENSION) {
      return false;
    }

    const insertionIndex = insertionIndexOverride
      ?? (side === "before" ? info.columnFrom : info.columnTo + 1);

    if (
      !Number.isInteger(insertionIndex)
      || insertionIndex < 0
      || insertionIndex > columnCount
    ) {
      return false;
    }
    const alignments = getTableColumnAlignments(info.table);
    const sourceAlignment = alignments[
      Math.max(0, Math.min(insertionIndex - 1, alignments.length - 1))
    ] ?? null;
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((rawRow, _offset, rowIndex) => {
      const row = normalizeRowWidth(schema, rawRow, rowIndex, columnCount, alignments);
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell) => cells.push(cell));
      const cellType = rowIndex === 0
        ? schema.nodes.table_header
        : schema.nodes.table_cell;

      if (!cellType) {
        return;
      }

      cells.splice(insertionIndex, 0, createParagraphCell(
        schema,
        cellType,
        sourceAlignment,
        rowIndex === 0 ? "col" : null,
      ));
      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex,
      insertionIndex,
    );
  };
}

function cellIsEmpty(schema: Schema, cell: ProseMirrorNode) {
  const paragraph = schema.nodes.paragraph?.create();
  return Boolean(paragraph && cell.childCount === 1 && cell.firstChild?.eq(paragraph));
}

function resizeTableCommand(
  schema: Schema,
  options: NormalizedTableResizeOptions,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);

    if (!info) {
      return false;
    }

    const currentRows = info.table.childCount;
    const currentColumns = getTableColumnCount(info.table);
    const targetRows = options.rows ?? currentRows;
    const targetColumns = options.columns ?? currentColumns;

    if (targetRows === currentRows && targetColumns === currentColumns) {
      return false;
    }

    if (!options.discardContent && (targetRows < currentRows || targetColumns < currentColumns)) {
      let removesContent = false;
      info.table.forEach((row, _offset, rowIndex) => {
        row.forEach((cell, _cellOffset, cellIndex) => {
          if (
            (rowIndex >= targetRows || cellIndex >= targetColumns)
            && !cellIsEmpty(schema, cell)
          ) {
            removesContent = true;
          }
        });
      });

      if (removesContent) {
        return false;
      }
    }

    const alignments = getTableColumnAlignments(info.table);
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((rawRow, _offset, rowIndex) => {
      if (rowIndex >= targetRows) {
        return;
      }

      const row = normalizeRowWidth(schema, rawRow, rowIndex, currentColumns, alignments);
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _cellOffset, cellIndex) => {
        if (cellIndex < targetColumns) {
          cells.push(cell);
        }
      });
      const cellType = rowIndex === 0 ? schema.nodes.table_header : schema.nodes.table_cell;

      if (!cellType) {
        return;
      }

      while (cells.length < targetColumns) {
        cells.push(createParagraphCell(
          schema,
          cellType,
          alignments[cells.length] ?? null,
          rowIndex === 0 ? "col" : null,
        ));
      }
      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    while (rows.length < targetRows) {
      const row = createEmptyTableRow(schema, targetColumns, alignments);
      if (!row) return false;
      rows.push(row);
    }

    rows[0] = promoteRowToColumnHeaders(schema, rows[0]);
    const rowFrom = Math.min(info.rowFrom, targetRows - 1);
    const rowTo = Math.min(info.rowTo, targetRows - 1);
    const columnFrom = Math.min(info.columnFrom, targetColumns - 1);
    const columnTo = Math.min(info.columnTo, targetColumns - 1);

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      Math.min(info.rowIndex, targetRows - 1),
      Math.min(info.cellIndex, targetColumns - 1),
      { rowFrom, rowTo, columnFrom, columnTo },
    );
  };
}

function moveTableRowCommand(
  schema: Schema,
  direction: MarkdownEditorTableRowMoveDirection,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);

    if (
      !info
      || info.rowFrom === 0
      || (direction === "up" ? info.rowFrom <= 1 : info.rowTo >= info.table.childCount - 1)
    ) {
      return false;
    }

    const columnCount = getTableColumnCount(info.table);
    const alignments = getTableColumnAlignments(info.table);
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, rowIndex) => {
      rows.push(normalizeRowWidth(schema, row, rowIndex, columnCount, alignments));
    });
    const count = info.rowTo - info.rowFrom + 1;
    const moved = rows.splice(info.rowFrom, count);
    const targetFrom = direction === "up" ? info.rowFrom - 1 : info.rowFrom + 1;
    rows.splice(targetFrom, 0, ...moved);

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      targetFrom + (info.rowIndex - info.rowFrom),
      info.cellIndex,
      {
        rowFrom: targetFrom,
        rowTo: targetFrom + count - 1,
        columnFrom: info.columnFrom,
        columnTo: info.columnTo,
      },
    );
  };
}

function moveTableColumnCommand(
  schema: Schema,
  direction: MarkdownEditorTableColumnMoveDirection,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);
    const columnCount = info ? getTableColumnCount(info.table) : 0;

    if (
      !info
      || (direction === "left" ? info.columnFrom === 0 : info.columnTo >= columnCount - 1)
    ) {
      return false;
    }

    const alignments = getTableColumnAlignments(info.table);
    const count = info.columnTo - info.columnFrom + 1;
    const targetFrom = direction === "left" ? info.columnFrom - 1 : info.columnFrom + 1;
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((rawRow, _offset, rowIndex) => {
      const row = normalizeRowWidth(schema, rawRow, rowIndex, columnCount, alignments);
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell) => cells.push(cell));
      const moved = cells.splice(info.columnFrom, count);
      cells.splice(targetFrom, 0, ...moved);
      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex,
      targetFrom + (info.cellIndex - info.columnFrom),
      {
        rowFrom: info.rowFrom,
        rowTo: info.rowTo,
        columnFrom: targetFrom,
        columnTo: targetFrom + count - 1,
      },
    );
  };
}

function deleteTableCommand(schema: Schema): Command {
  return (state, dispatch) => {
    const info = getActiveTableInfo(state, schema);
    const paragraphType = schema.nodes.paragraph;

    if (!info || !paragraphType) {
      return false;
    }

    if (dispatch) {
      const transaction = state.tr.replaceWith(
        info.pos,
        info.pos + info.node.nodeSize,
        paragraphType.create(),
      );
      transaction.setSelection(TextSelection.create(transaction.doc, info.pos + 1));
      dispatch(transaction.scrollIntoView());
    }

    return true;
  };
}

function deleteTableRowCommand(schema: Schema, deleteTable: Command): Command {
  return (state, dispatch, view) => {
    const info = getTableSelectionContext(state, schema);

    if (!info) {
      return false;
    }

    const removedCount = info.rowTo - info.rowFrom + 1;
    if (removedCount >= info.table.childCount) {
      return deleteTable(state, dispatch, view);
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, rowIndex) => {
      if (rowIndex < info.rowFrom || rowIndex > info.rowTo) {
        rows.push(row);
      }
    });

    if (info.rowFrom === 0 && rows[0]) {
      rows[0] = promoteRowToColumnHeaders(schema, rows[0]);
    }

    const targetRowIndex = Math.min(info.rowFrom, rows.length - 1);
    const targetCellIndex = Math.min(info.cellIndex, rows[targetRowIndex].childCount - 1);

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      targetRowIndex,
      targetCellIndex,
    );
  };
}

function deleteTableColumnCommand(schema: Schema, deleteTable: Command): Command {
  return (state, dispatch, view) => {
    const info = getTableSelectionContext(state, schema);

    if (!info) {
      return false;
    }

    const columnCount = getTableColumnCount(info.table);
    const removedCount = info.columnTo - info.columnFrom + 1;

    if (removedCount >= columnCount) {
      return deleteTable(state, dispatch, view);
    }

    const remainingAlignments = getTableColumnAlignments(info.table).filter(
      (_alignment, index) => index < info.columnFrom || index > info.columnTo,
    );
    const fallbackAlignment = remainingAlignments[0] ?? null;
    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _offset, cellIndex) => {
        if (cellIndex < info.columnFrom || cellIndex > info.columnTo) {
          cells.push(cell);
        }
      });

      if (cells.length === 0) {
        const cellType = isColumnHeaderRow(schema, row)
          ? schema.nodes.table_header
          : schema.nodes.table_cell;
        if (cellType) {
          cells.push(createParagraphCell(schema, cellType, fallbackAlignment));
        }
      }

      rows.push(row.type.create(row.attrs, cells, row.marks));
    });
    const targetCellIndex = Math.min(info.columnFrom, rows[info.rowIndex].childCount - 1);

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex,
      targetCellIndex,
    );
  };
}

function setTableColumnAlignmentCommand(
  schema: Schema,
  alignment: MarkdownEditorTableAlignment,
): Command {
  return (state, dispatch) => {
    const info = getTableSelectionContext(state, schema);

    if (!info) {
      return false;
    }

    let changed = false;
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _offset, cellIndex) => {
        if (
          cellIndex >= info.columnFrom
          && cellIndex <= info.columnTo
          && readAlignment(cell.attrs.align) !== alignment
        ) {
          changed = true;
          cells.push(cell.type.create({ ...cell.attrs, align: alignment }, cell.content, cell.marks));
        } else {
          cells.push(cell);
        }
      });
      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return changed && updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex,
      info.cellIndex,
      {
        rowFrom: info.rowFrom,
        rowTo: info.rowTo,
        columnFrom: info.columnFrom,
        columnTo: info.columnTo,
      },
    );
  };
}

export function tableColumnAlignmentIsActive(
  state: EditorState,
  schema: Schema,
  alignment: MarkdownEditorTableAlignment,
) {
  const info = getTableSelectionContext(state, schema);

  if (!info) {
    return false;
  }

  let active = true;
  info.table.forEach((row) => {
    for (let column = info.columnFrom; column <= info.columnTo; column += 1) {
      const cell = row.maybeChild(column);
      if (!cell || readAlignment(cell.attrs.align) !== alignment) {
        active = false;
        break;
      }
    }
  });
  return active;
}

export function createTableCommandSet(schema: Schema) {
  const deleteTable = deleteTableCommand(schema);

  return Object.freeze({
    insertTable(options?: MarkdownEditorTableInsertOptions) {
      return insertTableCommand(schema, normalizeTableInsertOptions(options));
    },
    addTableRow(side?: MarkdownEditorTableInsertSide) {
      return addTableRowCommand(schema, normalizeTableInsertSide(side));
    },
    addTableColumn(side?: MarkdownEditorTableInsertSide) {
      return addTableColumnCommand(schema, normalizeTableInsertSide(side));
    },
    insertTableRowAt(index: number) {
      return addTableRowCommand(schema, "before", index);
    },
    insertTableColumnAt(index: number) {
      return addTableColumnCommand(schema, "before", index);
    },
    resizeTable(options: MarkdownEditorTableResizeOptions) {
      return resizeTableCommand(schema, normalizeTableResizeOptions(options));
    },
    moveTableRow(direction: MarkdownEditorTableRowMoveDirection) {
      return moveTableRowCommand(schema, normalizeTableRowMoveDirection(direction));
    },
    moveTableColumn(direction: MarkdownEditorTableColumnMoveDirection) {
      return moveTableColumnCommand(schema, normalizeTableColumnMoveDirection(direction));
    },
    deleteTableRow: deleteTableRowCommand(schema, deleteTable),
    deleteTableColumn: deleteTableColumnCommand(schema, deleteTable),
    setTableColumnAlignment(alignment: MarkdownEditorTableAlignment) {
      return setTableColumnAlignmentCommand(schema, normalizeTableAlignment(alignment));
    },
    deleteTable,
  });
}
