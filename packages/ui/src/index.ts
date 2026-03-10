import type { EditorUiFactory, MarkdownEditor } from "markora";
import { createImageEditorOverlay, createLinkEditorOverlay, createTableToolbarOverlay } from "./overlays";

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
    const imageEditor = createImageEditorOverlay({
      doc: ownerDocument,
      portalRoot,
      removeActiveImage: options.removeActiveImage,
      updateActiveImage: options.updateActiveImage,
      win,
    });
    const tableToolbar = createTableToolbarOverlay({
      appendTableColumn: options.appendTableColumn,
      appendTableRow: options.appendTableRow,
      doc: ownerDocument,
      getTableContext: options.getTableContext,
      normalizeTableAlignment: options.normalizeTableAlignment,
      portalRoot,
      removeActiveTable: options.removeActiveTable,
      removeTableColumn: options.removeTableColumn,
      removeTableRow: options.removeTableRow,
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
      anchor.style.left = `${coords.left + win.scrollX}px`;
      anchor.style.top = `${coords.bottom + win.scrollY}px`;
      anchor.style.width = "0";
      anchor.style.height = "0";
      anchor.style.pointerEvents = "none";
      portalRoot.append(anchor);
      ephemeralSelectionAnchor = anchor;
      return anchor;
    };

    return {
      enabled: true,
      clearSelectionAnchor,
      createSelectionAnchor,
      imageEditor,
      linkEditor,
      tableToolbar,
    };
  };
}
