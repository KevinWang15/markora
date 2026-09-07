import type { EditorUiFactory, MarkdownEditor } from "markora";
import {
  normalizeDefaultUiMessages,
  type DefaultUiMessageOverrides,
} from "./messages";
import {
  createCodeBlockLanguageEditorOverlay,
  createImageEditorOverlay,
  createLinkEditorOverlay,
  createTableToolbarOverlay,
} from "./overlays";
import { setViewportPosition } from "./positioning";

import { createOverlayEnvironmentController, resolvePortalRoot } from "./environment";
import { createContextMenu } from "./contextMenu";
import { normalizeContextMenuConfig } from "./contextMenuModel";
import type { ContextMenuConfig } from "./contextMenuTypes";

type EditorView = MarkdownEditor["view"];
type BrowserWindow = Window & typeof globalThis;

export type DefaultUiConfig = {
  messages?: DefaultUiMessageOverrides;
  portalRoot?: HTMLElement | ShadowRoot;
  /** Set false to retain the browser's context menu. */
  contextMenu?: false | ContextMenuConfig;
};

export { defaultUiMessages } from "./messages";
export type {
  DefaultUiMessageOverrides, DefaultUiMessages, DefaultUiTableAction,
  DefaultUiTableActionStatusContext, DefaultUiTableControl, DefaultUiTableGroup,
  DefaultUiTableMode, DefaultUiTableSelectionContext,
} from "./messages";
export type * from "./contextMenuTypes";

function releaseEnvironmentWith<T extends { destroy: () => void }>(
  controller: T,
  release: () => void,
): T {
  let destroyed = false;
  return {
    ...controller,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      try {
        controller.destroy();
      } finally {
        release();
      }
    },
  };
}

export function createDefaultUi(config: DefaultUiConfig = {}): EditorUiFactory {
  const messages = normalizeDefaultUiMessages(config.messages);
  const contextMenu = config.contextMenu === false ? false : normalizeContextMenuConfig(config.contextMenu);

  return (options) => {
    const ownerDocument = options.hostElement.ownerDocument;
    const win = ownerDocument.defaultView as BrowserWindow | null;
    const portalRoot = resolvePortalRoot(options.hostElement, config.portalRoot);

    if (!win) {
      throw new Error("Markora UI requires a window-backed document.");
    }

    const environment = createOverlayEnvironmentController(options.hostElement, win);
    let remainingEnvironmentUsers = 4;
    const releaseEnvironment = () => {
      remainingEnvironmentUsers -= 1;
      if (remainingEnvironmentUsers === 0) {
        environment.destroy();
      }
    };

    const linkEditor = releaseEnvironmentWith(createLinkEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      removeActiveLink: options.removeActiveLink,
      updateLinkHref: options.updateLinkHref,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);
    const codeBlockLanguageEditor = releaseEnvironmentWith(createCodeBlockLanguageEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);
    const imageEditor = releaseEnvironmentWith(createImageEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      removeActiveImage: options.removeActiveImage,
      syncEnvironment: environment.sync,
      updateActiveImage: options.updateActiveImage,
      win,
    }), releaseEnvironment);
    const tableToolbar = releaseEnvironmentWith(createTableToolbarOverlay({
      addTableColumn: options.addTableColumn,
      addTableRow: options.addTableRow,
      doc: ownerDocument,
      getTableContext: options.getTableContext,
      insertTable: options.insertTable,
      insertTableColumnAt: options.insertTableColumnAt,
      insertTableRowAt: options.insertTableRowAt,
      messages,
      moveTableColumn: options.moveTableColumn,
      moveTableColumnTo: options.moveTableColumnTo,
      moveTableRow: options.moveTableRow,
      moveTableRowTo: options.moveTableRowTo,
      normalizeTableAlignment: options.normalizeTableAlignment,
      portalRoot,
      removeActiveTable: options.removeActiveTable,
      removeTableColumn: options.removeTableColumn,
      removeTableRow: options.removeTableRow,
      resizeTable: options.resizeTable,
      selectTableColumn: options.selectTableColumn,
      selectTableRow: options.selectTableRow,
      setTableColumnAlignment: options.setTableColumnAlignment,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);

    let ephemeralSelectionAnchor: HTMLElement | null = null;

    const clearSelectionAnchor = () => {
      ephemeralSelectionAnchor?.remove();
      ephemeralSelectionAnchor = null;
    };

    const createSelectionAnchor = (view: EditorView) => {
      clearSelectionAnchor();
      const coords = view.coordsAtPos(view.state.selection.from);
      const anchor = ownerDocument.createElement("span");
      anchor.dataset.mdwSelectionAnchor = "true";
      anchor.setAttribute("aria-hidden", "true");
      anchor.style.position = "absolute";
      anchor.style.left = "0";
      anchor.style.top = "0";
      anchor.style.width = "0";
      anchor.style.height = "0";
      anchor.style.pointerEvents = "none";
      portalRoot.append(anchor);
      setViewportPosition(anchor, coords.left, coords.bottom);
      ephemeralSelectionAnchor = anchor;
      return anchor;
    };

    return {
      enabled: true,
      mount(editor) {
        if (contextMenu === false) return;
        const menu = createContextMenu({
          editor,
          config: contextMenu,
          portalRoot,
          syncEnvironment: environment.sync,
          releaseEnvironment: environment.release,
          beforeOpen() {
            linkEditor.close(false);
            imageEditor.close(false);
            codeBlockLanguageEditor.close(false);
          },
        });
        return () => menu.destroy();
      },
      clearSelectionAnchor,
      codeBlockLanguageEditor,
      createSelectionAnchor,
      imageEditor,
      linkEditor,
      tableToolbar,
    };
  };
}
