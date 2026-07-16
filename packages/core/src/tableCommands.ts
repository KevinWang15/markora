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
  MarkdownEditorTableInsertOptions,
} from "./editorApi";
import type { TableCellInfo } from "./tableTypes";

export type TableAlignment = Exclude<MarkdownEditorTableAlignment, null>;

const DEFAULT_TABLE_COLUMNS = 3;
const DEFAULT_TABLE_ROWS = 2;
const MAX_TABLE_DIMENSION = 100;

type NormalizedTableInsertOptions = Readonly<{
  columns: number;
  rows: number;
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

export function getTableCellContext(
  state: EditorState,
  schema: Schema,
): TableCellInfo | null {
  const from = getTableCellContextAtPos(state.selection.$from, schema);
  const to = getTableCellContextAtPos(state.selection.$to, schema);

  return from && to && from.tablePos === to.tablePos && from.cellPos === to.cellPos
    ? from
    : null;
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

function readAlignment(value: unknown): MarkdownEditorTableAlignment {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function getTableColumnAlignments(table: ProseMirrorNode) {
  const firstRow = table.firstChild;
  return Array.from({ length: firstRow?.childCount ?? 0 }, (_, index) => (
    readAlignment(firstRow?.child(index).attrs.align)
  ));
}

function updateTableWithSelection(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  schema: Schema,
  info: TableCellInfo,
  rows: readonly ProseMirrorNode[],
  targetRowIndex: number,
  targetCellIndex: number,
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
  let cellPos = info.tablePos + 1;

  for (let rowIndex = 0; rowIndex < targetRowIndex; rowIndex += 1) {
    cellPos += rows[rowIndex].nodeSize;
  }

  cellPos += 1;

  for (let cellIndex = 0; cellIndex < targetCellIndex; cellIndex += 1) {
    cellPos += rows[targetRowIndex].child(cellIndex).nodeSize;
  }

  transaction.setSelection(getTableCellSelection(transaction.doc, cellPos));
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

function addTableRowCommand(schema: Schema): Command {
  return (state, dispatch) => {
    const info = getTableCellContext(state, schema);

    if (!info) {
      return false;
    }

    const alignments = getTableColumnAlignments(info.table);
    const nextRow = createEmptyTableRow(schema, info.row.childCount, alignments);

    if (!nextRow) {
      return false;
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, index) => {
      rows.push(row);
      if (index === info.rowIndex) {
        rows.push(nextRow);
      }
    });

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex + 1,
      0,
    );
  };
}

function addTableColumnCommand(schema: Schema): Command {
  return (state, dispatch) => {
    const info = getTableCellContext(state, schema);

    if (!info) {
      return false;
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _offset, cellIndex) => {
        cells.push(cell);
        if (cellIndex === info.cellIndex) {
          const cellType = isColumnHeaderRow(schema, row)
            ? schema.nodes.table_header
            : schema.nodes.table_cell;
          if (cellType) {
            cells.push(createParagraphCell(schema, cellType, readAlignment(cell.attrs.align)));
          }
        }
      });
      rows.push(row.type.create(row.attrs, cells, row.marks));
    });

    return updateTableWithSelection(
      state,
      dispatch,
      schema,
      info,
      rows,
      info.rowIndex,
      info.cellIndex + 1,
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
    const info = getTableCellContext(state, schema);

    if (!info) {
      return false;
    }

    if (info.table.childCount <= 1) {
      return deleteTable(state, dispatch, view);
    }

    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row, _offset, rowIndex) => {
      if (rowIndex !== info.rowIndex) {
        rows.push(row);
      }
    });

    if (info.rowIndex === 0 && isColumnHeaderRow(schema, info.row) && rows[0]) {
      rows[0] = promoteRowToColumnHeaders(schema, rows[0]);
    }

    const targetRowIndex = Math.min(info.rowIndex, rows.length - 1);
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
    const info = getTableCellContext(state, schema);

    if (!info) {
      return false;
    }

    let columnCount = 0;
    info.table.forEach((row) => {
      columnCount = Math.max(columnCount, row.childCount);
    });

    if (columnCount <= 1) {
      return deleteTable(state, dispatch, view);
    }

    const remainingAlignments = getTableColumnAlignments(info.table).filter(
      (_alignment, index) => index !== info.cellIndex,
    );
    const fallbackAlignment = remainingAlignments[0] ?? null;
    const rows: ProseMirrorNode[] = [];

    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _offset, cellIndex) => {
        if (cellIndex !== info.cellIndex) {
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
    const targetCellIndex = Math.min(info.cellIndex, rows[info.rowIndex].childCount - 1);

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
    const info = getTableCellContext(state, schema);

    if (!info) {
      return false;
    }

    let changed = false;
    const rows: ProseMirrorNode[] = [];
    info.table.forEach((row) => {
      const cells: ProseMirrorNode[] = [];
      row.forEach((cell, _offset, cellIndex) => {
        if (cellIndex === info.cellIndex && readAlignment(cell.attrs.align) !== alignment) {
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
    );
  };
}

export function tableColumnAlignmentIsActive(
  state: EditorState,
  schema: Schema,
  alignment: MarkdownEditorTableAlignment,
) {
  const info = getTableCellContext(state, schema);

  if (!info) {
    return false;
  }

  let active = true;
  info.table.forEach((row) => {
    const cell = row.maybeChild(info.cellIndex);
    if (!cell || readAlignment(cell.attrs.align) !== alignment) {
      active = false;
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
    addTableRow: addTableRowCommand(schema),
    addTableColumn: addTableColumnCommand(schema),
    deleteTableRow: deleteTableRowCommand(schema, deleteTable),
    deleteTableColumn: deleteTableColumnCommand(schema, deleteTable),
    setTableColumnAlignment(alignment: MarkdownEditorTableAlignment) {
      return setTableColumnAlignmentCommand(schema, normalizeTableAlignment(alignment));
    },
    deleteTable,
  });
}
