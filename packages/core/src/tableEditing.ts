import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { Plugin, Selection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  CellSelection,
  TableMap,
  handlePaste as handleTablePaste,
  tableEditing,
} from "prosemirror-tables";
import type {
  TableClipboardAdapter,
  TableClipboardSelection,
} from "./clipboardSemantics";
import {
  hasMarkdownEditorExternalUpdatePermission,
  setMarkdownEditorExternalUpdatePermission,
} from "./transactionOrigin";

const MAX_TABLE_DIMENSION = 100;
const MAX_TSV_SOURCE_LENGTH = 1_048_576;

type CreateTableEditingOptions = {
  reportBrowserError: (error: unknown) => void;
  schema: Schema;
};

type TrackedRootListener = Readonly<{
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
  root: Document | ShadowRoot;
  type: "dragstart" | "mousemove" | "mouseup";
}>;

function createLifecycleSafeTableEditingPlugin() {
  const upstream = tableEditing({ allowTableNodeSelection: true });
  const upstreamMouseDown = upstream.spec.props?.handleDOMEvents?.mousedown;
  const upstreamAppendTransaction = upstream.spec.appendTransaction;
  const trackedByView = new WeakMap<EditorView, TrackedRootListener[]>();

  const removeListeners = (listeners: readonly TrackedRootListener[]) => {
    for (const entry of listeners) {
      entry.root.removeEventListener(entry.type, entry.listener, entry.options);
    }
  };

  const removeTrackedListeners = (view: EditorView) => {
    const listeners = trackedByView.get(view);
    if (!listeners) return;
    trackedByView.delete(view);
    removeListeners(listeners);
  };

  return new Plugin({
    ...upstream.spec,
    appendTransaction(transactions, oldState, state) {
      const transaction = upstreamAppendTransaction?.call(
        upstream,
        transactions,
        oldState,
        state,
      ) ?? null;
      if (transaction && transactions.some(hasMarkdownEditorExternalUpdatePermission)) {
        setMarkdownEditorExternalUpdatePermission(transaction);
      }
      return transaction;
    },
    props: {
      ...upstream.spec.props,
      handleDOMEvents: {
        ...upstream.spec.props?.handleDOMEvents,
        mousedown(view, event) {
          if (!upstreamMouseDown) return false;
          removeTrackedListeners(view);
          const root = view.root;
          const ownDescriptor = Object.getOwnPropertyDescriptor(root, "addEventListener");
          const originalAdd = root.addEventListener;
          const tracked: TrackedRootListener[] = [];
          const interceptAdd = function (
            this: Document | ShadowRoot,
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
          ) {
            if (
              listener
              && (type === "dragstart" || type === "mousemove" || type === "mouseup")
            ) {
              tracked.push({ listener, options, root, type });
            }
            originalAdd.call(this, type, listener as EventListenerOrEventListenerObject, options);
          };

          try {
            Object.defineProperty(root, "addEventListener", {
              configurable: true,
              value: interceptAdd,
              writable: true,
            });
          } catch {
            return upstreamMouseDown.call(upstream, view, event);
          }

          let completed = false;
          try {
            const handled = upstreamMouseDown.call(upstream, view, event);
            completed = true;
            return handled;
          } finally {
            try {
              if (ownDescriptor) {
                Object.defineProperty(root, "addEventListener", ownDescriptor);
              } else {
                Reflect.deleteProperty(root, "addEventListener");
              }
            } finally {
              if (tracked.length > 0) {
                if (completed && !view.isDestroyed) {
                  trackedByView.set(view, tracked);
                } else {
                  removeListeners(tracked);
                }
              }
            }
          }
        },
      },
    },
    view(view) {
      const upstreamView = upstream.spec.view?.(view);
      return {
        update(nextView, previousState) {
          upstreamView?.update?.(nextView, previousState);
        },
        destroy() {
          removeTrackedListeners(view);
          upstreamView?.destroy?.();
        },
      };
    },
  });
}

function readAlignment(value: unknown) {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function assertSimpleCell(cell: ProseMirrorNode) {
  if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) {
    throw new RangeError(
      "Merged table cells cannot be represented by Markora's GFM table clipboard format.",
    );
  }
}

function markdownCell(
  schema: Schema,
  cell: ProseMirrorNode,
  header: boolean,
) {
  assertSimpleCell(cell);
  const type = header ? schema.nodes.table_header : schema.nodes.table_cell;

  if (!type) {
    throw new RangeError("The active schema does not support GFM table cells.");
  }

  return type.create(
    header
      ? {
          align: readAlignment(cell.attrs.align),
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          scope: "col",
        }
      : {
          align: readAlignment(cell.attrs.align),
          colspan: 1,
          rowspan: 1,
          colwidth: null,
        },
    cell.content,
    cell.marks,
  );
}

function readCellSelection(
  schema: Schema,
  selection: Selection,
): TableClipboardSelection | null {
  if (!(selection instanceof CellSelection)) {
    return null;
  }

  const table = selection.$anchorCell.node(-1);
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  );
  const rows: ProseMirrorNode[][] = [];
  const markdownRows: ProseMirrorNode[] = [];
  const rowType = schema.nodes.table_row;
  const tableType = schema.nodes.table;

  if (!rowType || !tableType) {
    return null;
  }

  for (let rowIndex = rect.top; rowIndex < rect.bottom; rowIndex += 1) {
    const row: ProseMirrorNode[] = [];
    const markdownRow: ProseMirrorNode[] = [];

    for (let columnIndex = rect.left; columnIndex < rect.right; columnIndex += 1) {
      const relativePos = map.map[rowIndex * map.width + columnIndex];
      const cell = table.nodeAt(relativePos);

      if (!cell) {
        throw new RangeError("The selected table rectangle contains a missing cell.");
      }

      assertSimpleCell(cell);
      row.push(cell);
      markdownRow.push(markdownCell(schema, cell, rows.length === 0));
    }

    rows.push(row);
    markdownRows.push(rowType.create(null, markdownRow));
  }

  const markdownTable = tableType.create(null, markdownRows);
  return {
    markdownDocument: schema.topNodeType.create(null, markdownTable),
    rows,
  };
}

function clearCellSelection(schema: Schema, transaction: Transaction) {
  const selection = transaction.selection;

  if (!(selection instanceof CellSelection)) {
    return transaction.deleteSelection();
  }

  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return transaction;
  const cells: Array<{ node: ProseMirrorNode; pos: number }> = [];
  selection.forEachCell((node, pos) => cells.push({ node, pos }));
  cells.sort((left, right) => right.pos - left.pos);

  for (const { node, pos } of cells) {
    transaction.replaceWith(pos + 1, pos + node.nodeSize - 1, paragraph.create());
  }

  return transaction;
}

function parseTsv(source: string) {
  if (source.length > MAX_TSV_SOURCE_LENGTH) {
    throw new RangeError("Pasted table text exceeds the 1 MiB table clipboard limit.");
  }

  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;

  const commitCell = () => {
    rows[rows.length - 1].push(value);
    value = "";
  };
  const commitRow = () => {
    commitCell();
    if (rows.length >= MAX_TABLE_DIMENSION) {
      throw new RangeError(`Pasted table text exceeds ${MAX_TABLE_DIMENSION} rows.`);
    }
    rows.push([]);
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === "\t") {
      commitCell();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      commitRow();
    } else {
      value += character;
    }

    if (rows[rows.length - 1].length >= MAX_TABLE_DIMENSION) {
      throw new RangeError(`Pasted table text exceeds ${MAX_TABLE_DIMENSION} columns.`);
    }
  }

  commitCell();
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }

  const width = Math.max(...rows.map((row) => row.length));
  if (width > MAX_TABLE_DIMENSION) {
    throw new RangeError(`Pasted table text exceeds ${MAX_TABLE_DIMENSION} columns.`);
  }
  for (const row of rows) {
    while (row.length < width) row.push("");
  }
  return rows;
}

function tsvSlice(schema: Schema, source: string) {
  const rows = parseTsv(source);
  const rowType = schema.nodes.table_row;
  const cellType = schema.nodes.table_cell;
  const paragraphType = schema.nodes.paragraph;

  if (!rowType || !cellType || !paragraphType) {
    return null;
  }

  const rowNodes = rows.map((row) => rowType.create(
    null,
    row.map((value) => cellType.create(
      { align: null, colspan: 1, rowspan: 1, colwidth: null },
      paragraphType.create(null, value ? schema.text(value) : undefined),
    )),
  ));
  return new Slice(Fragment.from(rowNodes), 1, 1);
}

function sliceTableDimensions(slice: Slice) {
  let rows = 0;
  let columns = 0;
  slice.content.descendants((node) => {
    const role = node.type.spec.tableRole;
    if (role === "row") {
      rows += 1;
      let rowWidth = 0;
      node.forEach((cell) => {
        const colspan = Number.isInteger(cell.attrs.colspan)
          ? cell.attrs.colspan as number
          : 1;
        rowWidth += Math.max(1, colspan);
      });
      columns = Math.max(columns, rowWidth);
      return false;
    }
    return role !== "cell" && role !== "header_cell";
  });
  return rows > 0 ? { rows, columns } : null;
}

function sliceContainsMergedCells(slice: Slice) {
  let merged = false;
  slice.content.descendants((node) => {
    const role = node.type.spec.tableRole;
    if (
      (role === "cell" || role === "header_cell")
      && (node.attrs.colspan !== 1 || node.attrs.rowspan !== 1)
    ) {
      merged = true;
      return false;
    }
    return !merged;
  });
  return merged;
}

function pasteWouldOverflow(view: EditorView, slice: Slice) {
  const dimensions = sliceTableDimensions(slice);
  if (!dimensions) return false;
  if (
    dimensions.rows > MAX_TABLE_DIMENSION
    || dimensions.columns > MAX_TABLE_DIMENSION
  ) {
    return true;
  }
  if (view.state.selection instanceof CellSelection) return false;

  const $from = view.state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.spec.tableRole !== "table") continue;
    const table = $from.node(depth);
    const row = $from.node(depth + 1);
    const rowIndex = $from.index(depth);
    const columnIndex = $from.index(depth + 1);
    let columns = 0;
    table.forEach((child) => { columns = Math.max(columns, child.childCount); });
    return rowIndex + dimensions.rows > MAX_TABLE_DIMENSION
      || columnIndex + dimensions.columns > MAX_TABLE_DIMENSION
      || table.childCount > MAX_TABLE_DIMENSION
      || columns > MAX_TABLE_DIMENSION
      || row.childCount > MAX_TABLE_DIMENSION;
  }
  return false;
}

function normalizeGfmTable(schema: Schema, table: ProseMirrorNode) {
  const headerType = schema.nodes.table_header;
  const cellType = schema.nodes.table_cell;
  if (!headerType || !cellType) return table;
  const rows: ProseMirrorNode[] = [];

  table.forEach((row, _offset, rowIndex) => {
    const cells: ProseMirrorNode[] = [];
    row.forEach((cell) => {
      if (rowIndex === 0 && (cell.type !== headerType || cell.attrs.scope !== "col")) {
        cells.push(headerType.create({ ...cell.attrs, scope: "col" }, cell.content, cell.marks));
      } else if (
        rowIndex > 0
        && cell.type === headerType
        && cell.attrs.scope !== "row"
      ) {
        cells.push(cellType.create({
          align: readAlignment(cell.attrs.align),
          colspan: cell.attrs.colspan,
          rowspan: cell.attrs.rowspan,
          colwidth: cell.attrs.colwidth,
        }, cell.content, cell.marks));
      } else {
        cells.push(cell);
      }
    });
    rows.push(row.type.create(row.attrs, cells, row.marks));
  });

  return table.type.create(table.attrs, rows, table.marks);
}

function createGfmTableInvariantPlugin(schema: Schema) {
  return new Plugin({
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const replacements: Array<{ node: ProseMirrorNode; pos: number }> = [];
      state.doc.descendants((node, pos) => {
        if (node.type.spec.tableRole === "table") {
          const normalized = normalizeGfmTable(schema, node);
          if (!normalized.eq(node)) replacements.push({ node: normalized, pos });
          return false;
        }
        return true;
      });
      if (replacements.length === 0) return null;
      const transaction = state.tr;
      for (const replacement of replacements.reverse()) {
        transaction.replaceWith(
          replacement.pos,
          replacement.pos + state.doc.nodeAt(replacement.pos)!.nodeSize,
          replacement.node,
        );
      }
      if (transactions.some(hasMarkdownEditorExternalUpdatePermission)) {
        setMarkdownEditorExternalUpdatePermission(transaction);
      }
      return transaction;
    },
  });
}

function collapseCellSelection(view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof CellSelection)) return false;
  const next = Selection.near(view.state.doc.resolve(selection.$headCell.pos + 1), 1);
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  return true;
}

function selectionIsInTable(view: EditorView) {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.spec.tableRole === "table") return true;
  }
  return false;
}

export function isTableCellSelection(selection: Selection) {
  return selection instanceof CellSelection;
}

export function createTableEditing(options: CreateTableEditingOptions) {
  const { reportBrowserError, schema } = options;
  const rejectedTextPastes = new WeakSet<EditorView>();
  const clipboard: TableClipboardAdapter = {
    clearSelection: (transaction) => clearCellSelection(schema, transaction),
    readSelection: (selection) => readCellSelection(schema, selection),
    reportError: reportBrowserError,
  };
  const adapterPlugin = new Plugin({
    props: {
      clipboardTextParser(text, _context, _plain, view) {
        const shouldParse = selectionIsInTable(view)
          && (view.state.selection instanceof CellSelection || /[\t\r\n]/.test(text));
        if (!shouldParse) return undefined as unknown as Slice;

        try {
          return tsvSlice(schema, text) ?? undefined as unknown as Slice;
        } catch (error) {
          rejectedTextPastes.add(view);
          const clearRejectedPaste = () => rejectedTextPastes.delete(view);
          const ownerWindow = view.dom.ownerDocument.defaultView;
          if (typeof ownerWindow?.queueMicrotask === "function") {
            ownerWindow.queueMicrotask(clearRejectedPaste);
          } else {
            Promise.resolve().then(clearRejectedPaste);
          }
          reportBrowserError(error);
          return Slice.empty;
        }
      },
      handleDOMEvents: {
        compositionstart(view) {
          collapseCellSelection(view);
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (
          view.state.selection instanceof CellSelection
          && (event.key === "Escape" || event.key === "Enter" || event.key === "F2")
        ) {
          return collapseCellSelection(view);
        }
        return false;
      },
      handlePaste(view, event, slice) {
        if (rejectedTextPastes.delete(view)) {
          event.preventDefault();
          return true;
        }

        if (sliceContainsMergedCells(slice)) {
          event.preventDefault();
          reportBrowserError(new RangeError(
            "Pasted merged table cells cannot be represented by GFM pipe tables.",
          ));
          return true;
        }

        if (pasteWouldOverflow(view, slice)) {
          event.preventDefault();
          reportBrowserError(new RangeError(
            `Pasted table content would exceed ${MAX_TABLE_DIMENSION} rows or columns.`,
          ));
          return true;
        }

        const dispatch = (transaction: Transaction) => {
          view.dispatch(closeHistory(transaction)
            .setTime(0)
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste"));
        };
        return handleTablePaste({ state: view.state, dispatch } as EditorView, event, slice);
      },
    },
  });

  return Object.freeze({
    clipboard,
    plugins: Object.freeze([
      adapterPlugin,
      createLifecycleSafeTableEditingPlugin(),
      createGfmTableInvariantPlugin(schema),
    ]),
  });
}
