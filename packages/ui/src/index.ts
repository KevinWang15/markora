import type { EditorUiFactory, MarkdownEditor } from "markora";
import {
  createCodeBlockLanguageEditorOverlay,
  createImageEditorOverlay,
  createLinkEditorOverlay,
  createTableToolbarOverlay,
} from "./overlays";
import { setViewportPosition } from "./positioning";

type EditorView = MarkdownEditor["view"];
type BrowserWindow = Window & typeof globalThis;
type PortalRoot = HTMLElement | ShadowRoot;

function resolvePortalRoot(hostElement: HTMLElement, explicitPortalRoot?: PortalRoot) {
  if (explicitPortalRoot) {
    return explicitPortalRoot;
  }

  const rootNode = hostElement.getRootNode();
  const shadowRootCtor = (hostElement.ownerDocument.defaultView as BrowserWindow | null)?.ShadowRoot;

  return shadowRootCtor && rootNode instanceof shadowRootCtor ? rootNode : hostElement.ownerDocument.body;
}

export function createDefaultUi(config: { portalRoot?: PortalRoot } = {}): EditorUiFactory {
  return (options) => {
    const ownerDocument = options.hostElement.ownerDocument;
    const win = ownerDocument.defaultView as BrowserWindow | null;
    const portalRoot = resolvePortalRoot(options.hostElement, config.portalRoot);

    if (!win) {
      throw new Error("Markora UI requires a window-backed document.");
    }

    const linkEditor = createLinkEditorOverlay({
      doc: ownerDocument,
      portalRoot,
      removeActiveLink: options.removeActiveLink,
      updateLinkHref: options.updateLinkHref,
      win,
    });
    const codeBlockLanguageEditor = createCodeBlockLanguageEditorOverlay({
      doc: ownerDocument,
      portalRoot,
      win,
    });
    const imageEditor = createImageEditorOverlay({
      doc: ownerDocument,
      portalRoot,
      removeActiveImage: options.removeActiveImage,
      updateActiveImage: options.updateActiveImage,
      win,
    });
    const tableToolbar = createTableToolbarOverlay({
      addTableColumn: options.addTableColumn,
      addTableRow: options.addTableRow,
      doc: ownerDocument,
      getTableContext: options.getTableContext,
      insertTable: options.insertTable,
      moveTableColumn: options.moveTableColumn,
      moveTableRow: options.moveTableRow,
      normalizeTableAlignment: options.normalizeTableAlignment,
      portalRoot,
      removeActiveTable: options.removeActiveTable,
      removeTableColumn: options.removeTableColumn,
      removeTableRow: options.removeTableRow,
      resizeTable: options.resizeTable,
      setTableColumnAlignment: options.setTableColumnAlignment,
      win,
    });

    let ephemeralSelectionAnchor: HTMLElement | null = null;

    const clearSelectionAnchor = () => {
      ephemeralSelectionAnchor?.remove();
      ephemeralSelectionAnchor = null;
    };

    const createSelectionAnchor = (view: EditorView) => {
      clearSelectionAnchor();
      const coords = view.coordsAtPos(view.state.selection.from);
      const anchor = ownerDocument.createElement("span");
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
      clearSelectionAnchor,
      codeBlockLanguageEditor,
      createSelectionAnchor,
      imageEditor,
      linkEditor,
      tableToolbar,
    };
  };
}
