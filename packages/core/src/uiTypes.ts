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
  update: (view: EditorView) => void;
  destroy: () => void;
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
  appendTableColumn: (view: EditorView) => void;
  appendTableRow: (view: EditorView) => void;
  getTableContext: (state: EditorView["state"]) => { tablePos: number; cell: { attrs: Record<string, unknown> } } | null;
  hostElement: HTMLElement;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  removeActiveImage: (view: EditorView) => void;
  removeActiveLink: (view: EditorView) => void;
  removeActiveTable: (view: EditorView) => void;
  removeTableColumn: (view: EditorView) => void;
  removeTableRow: (view: EditorView) => void;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment) => void;
  updateActiveImage: (view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) => void;
  updateLinkHref: (view: EditorView, href: string) => void;
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
