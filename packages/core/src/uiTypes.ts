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

export type CodeBlockLanguageEditRequest = Readonly<{
  /** The exact fenced-code info string stored on the code block. */
  language: string;
  /** Invalidates this request when a custom surface closes without saving. */
  cancel: () => void;
  /** Applies a replacement only while this edit request is still current. */
  update: (nextLanguage: string) => boolean;
}>;

export type CodeBlockLanguageEditorOverlay = {
  open: (
    view: EditorView,
    marker: HTMLElement,
    request: CodeBlockLanguageEditRequest,
  ) => boolean;
  close: (refocusTrigger: boolean) => void;
  isComposing?: () => boolean;
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
  isCellSelection: boolean;
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
  codeBlockLanguageEditor: CodeBlockLanguageEditorOverlay;
  imageEditor: ImageEditorOverlay;
  linkEditor: LinkEditorOverlay;
  tableToolbar: TableToolbarOverlay;
};

export type EditorUiFactory = (options: {
  addTableColumn: (view: EditorView, side: "before" | "after") => boolean;
  addTableRow: (view: EditorView, side: "before" | "after") => boolean;
  getTableContext: (state: EditorView["state"]) => TableUiContext | null;
  hostElement: HTMLElement;
  insertTable: (view: EditorView, dimensions: { rows: number; columns: number }) => boolean;
  /** Inserts immediately before the zero-based column boundary. */
  insertTableColumnAt: (view: EditorView, index: number) => boolean;
  /** Inserts immediately before the zero-based row boundary. */
  insertTableRowAt: (view: EditorView, index: number) => boolean;
  moveTableColumn: (view: EditorView, direction: "left" | "right") => boolean;
  /** Moves the selected columns so their first column lands at the zero-based index. */
  moveTableColumnTo: (view: EditorView, index: number) => boolean;
  moveTableRow: (view: EditorView, direction: "up" | "down") => boolean;
  /** Moves the selected rows so their first row lands at the zero-based index. */
  moveTableRowTo: (view: EditorView, index: number) => boolean;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  removeActiveImage: (view: EditorView) => void;
  removeActiveLink: (view: EditorView) => void;
  removeActiveTable: (view: EditorView) => boolean;
  removeTableColumn: (view: EditorView) => boolean;
  removeTableRow: (view: EditorView) => boolean;
  resizeTable: (view: EditorView, dimensions: { rows: number; columns: number }) => boolean;
  /** Selects the complete zero-based column. */
  selectTableColumn: (view: EditorView, index: number) => boolean;
  /** Selects the complete zero-based row. */
  selectTableRow: (view: EditorView, index: number) => boolean;
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

const noopCodeBlockLanguageEditor: CodeBlockLanguageEditorOverlay = {
  open() {
    return false;
  },
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
    codeBlockLanguageEditor: noopCodeBlockLanguageEditor,
    imageEditor: noopImageEditor,
    linkEditor: noopLinkEditor,
    tableToolbar: noopTableToolbar,
  };
}
