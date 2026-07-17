import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { TableAlignment } from "./tableNavigation";

export type ActiveImageInfo = {
  pos: number;
  node: ProseMirrorNode;
};

export type LinkEditorOverlay = {
  open: (view: EditorView, marker: HTMLElement, href: string) => void;
  close: (refocusEditor: boolean) => void;
  destroy: () => void;
};

export type ImageEditorOverlay = {
  open: (view: EditorView, marker: HTMLElement, imageInfo: ActiveImageInfo) => void;
  close: (refocusEditor: boolean) => void;
  destroy: () => void;
};

export type TableToolbarOverlay = {
  /** Optional default-UI entry point for inserting a table at the current selection. */
  create?: (view: EditorView, marker: HTMLElement, onClose?: () => void) => boolean;
  update: (view: EditorView) => void;
  /** Optional keyboard-entry hook for custom table toolbars. */
  focus?: (view: EditorView) => boolean;
  destroy: () => void;
};

export type TableUiContext = {
  tablePos: number;
  cell: { attrs: Record<string, unknown> };
  selectedAlignment: TableAlignment | null | "mixed";
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  selectedRowFrom: number;
  selectedRowTo: number;
  selectedColumnFrom: number;
  selectedColumnTo: number;
};

export type EditorUiControllers = {
  enabled: boolean;
  clearSelectionAnchor: () => void;
  createSelectionAnchor: (view: EditorView) => HTMLElement | null;
  imageEditor: ImageEditorOverlay;
  linkEditor: LinkEditorOverlay;
  tableToolbar: TableToolbarOverlay;
};

export type EditorUiFactory = (options: {
  addTableColumn: (view: EditorView, side: "before" | "after") => boolean;
  addTableRow: (view: EditorView, side: "before" | "after") => boolean;
  /** @deprecated Use addTableColumn(view, "after"). */
  appendTableColumn: (view: EditorView) => boolean;
  /** @deprecated Use addTableRow(view, "after"). */
  appendTableRow: (view: EditorView) => boolean;
  getTableContext: (state: EditorView["state"]) => TableUiContext | null;
  hostElement: HTMLElement;
  insertTable: (view: EditorView, dimensions: { rows: number; columns: number }) => boolean;
  moveTableColumn: (view: EditorView, direction: "left" | "right") => boolean;
  moveTableRow: (view: EditorView, direction: "up" | "down") => boolean;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  removeActiveImage: (view: EditorView) => void;
  removeActiveLink: (view: EditorView) => void;
  removeActiveTable: (view: EditorView) => boolean;
  removeTableColumn: (view: EditorView) => boolean;
  removeTableRow: (view: EditorView) => boolean;
  resizeTable: (view: EditorView, dimensions: { rows: number; columns: number }) => boolean;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment | null) => boolean;
  updateActiveImage: (view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) => boolean;
  updateLinkHref: (view: EditorView, href: string) => boolean;
}) => EditorUiControllers;

const noopLinkEditor: LinkEditorOverlay = {
  open() {},
  close() {},
  destroy() {},
};

const noopImageEditor: ImageEditorOverlay = {
  open() {},
  close() {},
  destroy() {},
};

const noopTableToolbar: TableToolbarOverlay = {
  update() {},
  focus() {
    return false;
  },
  destroy() {},
};

export function createNoopUiControllers(): EditorUiControllers {
  return {
    enabled: false,
    clearSelectionAnchor() {},
    createSelectionAnchor() {
      return null;
    },
    imageEditor: noopImageEditor,
    linkEditor: noopLinkEditor,
    tableToolbar: noopTableToolbar,
  };
}
