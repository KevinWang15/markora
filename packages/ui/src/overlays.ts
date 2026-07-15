import type { MarkdownEditor } from "markora";
import { measurePositionSpace, setViewportPosition } from "./positioning";

type EditorView = MarkdownEditor["view"];
type BrowserWindow = Window & typeof globalThis;
type TableAlignment = "left" | "center" | "right";
type PortalRoot = HTMLElement | ShadowRoot;
type ActiveImageInfoLike = {
  node: {
    attrs: {
      src?: unknown;
      alt?: unknown;
      title?: unknown;
    };
  };
};

type OverlayEnvironment = {
  doc: Document;
  portalRoot: PortalRoot;
  win: BrowserWindow;
};

const OVERLAY_GAP = 8;
const VIEWPORT_MARGIN = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getViewportBounds(doc: Document, win: Window) {
  const visualViewport = win.visualViewport;
  const left = visualViewport?.offsetLeft ?? 0;
  const top = visualViewport?.offsetTop ?? 0;
  const width = visualViewport?.width || doc.documentElement.clientWidth || win.innerWidth;
  const height = visualViewport?.height || doc.documentElement.clientHeight || win.innerHeight;

  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
  };
}

function addViewportListeners(win: Window, listener: () => void) {
  win.visualViewport?.addEventListener("resize", listener);
  win.visualViewport?.addEventListener("scroll", listener);
}

function removeViewportListeners(win: Window, listener: () => void) {
  win.visualViewport?.removeEventListener("resize", listener);
  win.visualViewport?.removeEventListener("scroll", listener);
}

function positionOverlay(
  dom: HTMLElement,
  markerRect: DOMRect,
  doc: Document,
  win: Window,
  preferredSide: "above" | "below",
) {
  const viewport = getViewportBounds(doc, win);
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
  const availableHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const initialSpace = measurePositionSpace(dom);

  dom.style.maxWidth = `${availableWidth / initialSpace.scaleX}px`;
  dom.style.maxHeight = `${availableHeight / initialSpace.scaleY}px`;

  const space = measurePositionSpace(dom);
  const overlayRect = dom.getBoundingClientRect();
  const overlayWidth = Math.min(overlayRect.width || dom.offsetWidth * space.scaleX, availableWidth);
  const overlayHeight = Math.min(overlayRect.height || dom.offsetHeight * space.scaleY, availableHeight);
  const minLeft = viewport.left + VIEWPORT_MARGIN;
  const maxLeft = Math.max(minLeft, viewport.right - overlayWidth - VIEWPORT_MARGIN);
  const left = clamp(markerRect.left, minLeft, maxLeft);
  const topAbove = markerRect.top - overlayHeight - OVERLAY_GAP;
  const topBelow = markerRect.bottom + OVERLAY_GAP;
  const aboveFits = topAbove >= viewport.top + VIEWPORT_MARGIN;
  const belowFits = topBelow + overlayHeight <= viewport.bottom - VIEWPORT_MARGIN;

  let top: number;

  if (preferredSide === "above") {
    if (aboveFits) {
      top = topAbove;
    } else if (belowFits) {
      top = topBelow;
    } else {
      top = markerRect.top - viewport.top > viewport.bottom - markerRect.bottom ? topAbove : topBelow;
    }
  } else {
    if (belowFits) {
      top = topBelow;
    } else if (aboveFits) {
      top = topAbove;
    } else {
      top = viewport.bottom - markerRect.bottom >= markerRect.top - viewport.top ? topBelow : topAbove;
    }
  }

  const minTop = viewport.top + VIEWPORT_MARGIN;
  const maxTop = Math.max(minTop, viewport.bottom - overlayHeight - VIEWPORT_MARGIN);

  setViewportPosition(dom, left, clamp(top, minTop, maxTop), space);
}

export type LinkEditorOverlay = {
  open: (view: EditorView, marker: HTMLElement, href: string) => void;
  close: (refocusEditor: boolean) => void;
  destroy: () => void;
};

export type ImageEditorOverlay = {
  open: (view: EditorView, marker: HTMLElement, imageInfo: ActiveImageInfoLike) => void;
  close: (refocusEditor: boolean) => void;
  destroy: () => void;
};

export type TableToolbarOverlay = {
  update: (view: EditorView) => void;
  destroy: () => void;
};

export function createLinkEditorOverlay(options: OverlayEnvironment & {
  updateLinkHref: (view: EditorView, href: string) => boolean;
  removeActiveLink: (view: EditorView) => void;
}): LinkEditorOverlay {
  const { doc, portalRoot, removeActiveLink, updateLinkHref, win } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-link-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", "Edit link");

  const input = doc.createElement("input");
  input.className = "mdw-link-editor-input";
  input.type = "text";
  input.placeholder = "https://example.com";
  input.setAttribute("aria-label", "Link URL");

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const unlinkButton = doc.createElement("button");
  unlinkButton.type = "button";
  unlinkButton.textContent = "Unlink";

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const reposition = () => {
    if (!activeMarker) {
      return;
    }

    try {
      const markerRect = activeMarker.getBoundingClientRect();
      positionOverlay(dom, markerRect, doc, win, "below");
    } catch {
      // Marker may have been detached from the DOM.
    }
  };

  const close = (refocusEditor: boolean) => {
    const view = activeView;
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";

    if (refocusEditor && view) {
      view.focus();
    }
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target;
    const targetNode = target instanceof NodeCtor ? target : null;

    if (!targetNode) {
      return;
    }

    if (dom.hidden || dom.style.display === "none" || dom.contains(targetNode) || activeMarker?.contains(targetNode)) {
      return;
    }

    close(false);
  };

  const handleWindowChange = () => {
    if (!dom.hidden) {
      reposition();
    }
  };

  const actions = doc.createElement("div");
  actions.className = "mdw-link-editor-actions";
  actions.append(saveButton, unlinkButton, cancelButton);
  dom.append(input, actions);
  portalRoot.append(dom);

  saveButton.addEventListener("click", () => {
    if (!activeView) return;
    if (updateLinkHref(activeView, input.value) === false) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    close(true);
  });
  unlinkButton.addEventListener("click", () => {
    if (!activeView) return;
    removeActiveLink(activeView);
    close(true);
  });
  cancelButton.addEventListener("click", () => close(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  });
  input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, href) {
      activeView = view;
      activeMarker = marker;
      input.value = href;
      input.removeAttribute("aria-invalid");
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      input.focus();
      input.select();
    },
    close,
    destroy() {
      close(false);
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeViewportListeners(win, handleWindowChange);
      dom.remove();
    },
  };
}

export function createImageEditorOverlay(options: OverlayEnvironment & {
  updateActiveImage: (view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) => boolean;
  removeActiveImage: (view: EditorView) => void;
}): ImageEditorOverlay {
  const { doc, portalRoot, removeActiveImage, updateActiveImage, win } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-image-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", "Edit image");

  const srcInput = doc.createElement("input");
  srcInput.className = "mdw-image-editor-input";
  srcInput.type = "text";
  srcInput.placeholder = "Image URL";
  srcInput.setAttribute("aria-label", "Image URL");

  const altInput = doc.createElement("input");
  altInput.className = "mdw-image-editor-input";
  altInput.type = "text";
  altInput.placeholder = "Alt text";
  altInput.setAttribute("aria-label", "Alt text");

  const titleInput = doc.createElement("input");
  titleInput.className = "mdw-image-editor-input";
  titleInput.type = "text";
  titleInput.placeholder = "Title";
  titleInput.setAttribute("aria-label", "Title");

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const removeButton = doc.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const reposition = () => {
    if (!activeMarker) return;
    try {
      const markerRect = activeMarker.getBoundingClientRect();
      positionOverlay(dom, markerRect, doc, win, "below");
    } catch {
      // Marker may have been detached from the DOM.
    }
  };

  const close = (refocusEditor: boolean) => {
    const view = activeView;
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";
    if (refocusEditor && view) view.focus();
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target;
    const targetNode = target instanceof NodeCtor ? target : null;
    if (!targetNode) return;
    if (dom.hidden || dom.style.display === "none" || dom.contains(targetNode) || activeMarker?.contains(targetNode)) return;
    close(false);
  };

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const actions = doc.createElement("div");
  actions.className = "mdw-image-editor-actions";
  actions.append(saveButton, removeButton, cancelButton);
  dom.append(srcInput, altInput, titleInput, actions);
  portalRoot.append(dom);

  saveButton.addEventListener("click", () => {
    if (!activeView) return;
    if (updateActiveImage(activeView, { src: srcInput.value, alt: altInput.value, title: titleInput.value }) === false) {
      srcInput.setAttribute("aria-invalid", "true");
      srcInput.focus();
      return;
    }
    srcInput.removeAttribute("aria-invalid");
    close(true);
  });
  removeButton.addEventListener("click", () => {
    if (!activeView) return;
    removeActiveImage(activeView);
    close(true);
  });
  cancelButton.addEventListener("click", () => close(true));
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  });
  srcInput.addEventListener("input", () => srcInput.removeAttribute("aria-invalid"));
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, imageInfo) {
      activeView = view;
      activeMarker = marker;
      srcInput.value = typeof imageInfo.node.attrs.src === "string" ? imageInfo.node.attrs.src : "";
      altInput.value = typeof imageInfo.node.attrs.alt === "string" ? imageInfo.node.attrs.alt : "";
      titleInput.value = typeof imageInfo.node.attrs.title === "string" ? imageInfo.node.attrs.title : "";
      srcInput.removeAttribute("aria-invalid");
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      srcInput.focus();
      srcInput.select();
    },
    close,
    destroy() {
      close(false);
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeViewportListeners(win, handleWindowChange);
      dom.remove();
    },
  };
}

export function createTableToolbarOverlay(options: OverlayEnvironment & {
  appendTableColumn: (view: EditorView) => void;
  appendTableRow: (view: EditorView) => void;
  removeTableColumn: (view: EditorView) => void;
  removeTableRow: (view: EditorView) => void;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment) => void;
  removeActiveTable: (view: EditorView) => void;
  getTableContext: (state: EditorView["state"]) => { tablePos: number; cell: { attrs: Record<string, unknown> } } | null;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
}): TableToolbarOverlay {
  const {
    appendTableColumn,
    appendTableRow,
    doc,
    getTableContext,
    normalizeTableAlignment,
    portalRoot,
    removeActiveTable,
    removeTableColumn,
    removeTableRow,
    setTableColumnAlignment,
    win,
  } = options;
  const HTMLElementCtor = win.HTMLElement;
  const dom = doc.createElement("div");
  dom.className = "mdw-table-toolbar";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", "Table controls");

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const createIcon = (paths: string[], viewBox = "0 0 24 24") => {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("mdw-table-toolbar-icon");

    for (const d of paths) {
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }

    return svg;
  };

  const createButton = (title: string, icon: SVGElement) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mdw-table-toolbar-button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(icon);
    return button;
  };

  const addColumnButton = createButton("Insert column", createIcon([
    "M8 5v14",
    "M16 5v14",
    "M5 12h14",
    "M19 7H9",
    "M19 17H9",
    "M5 7h1",
    "M5 17h1",
  ]));
  const removeColumnButton = createButton("Delete column", createIcon([
    "M8 5v14",
    "M16 5v14",
    "M10 12h9",
    "M10 7h9",
    "M10 17h9",
    "M5 7h1",
    "M5 17h1",
  ]));
  const addRowButton = createButton("Insert row", createIcon([
    "M5 8h14",
    "M5 16h14",
    "M12 5v14",
    "M7 19v-1",
    "M17 19v-1",
    "M12 18v3",
  ]));
  const removeRowButton = createButton("Delete row", createIcon([
    "M5 8h14",
    "M5 16h14",
    "M12 5v11",
    "M7 19h10",
  ]));
  const alignLeftButton = createButton("Align left", createIcon([
    "M5 7h14",
    "M5 11h10",
    "M5 15h14",
    "M5 19h10",
  ]));
  const alignCenterButton = createButton("Align center", createIcon([
    "M5 7h14",
    "M7 11h10",
    "M5 15h14",
    "M7 19h10",
  ]));
  const alignRightButton = createButton("Align right", createIcon([
    "M5 7h14",
    "M9 11h10",
    "M5 15h14",
    "M9 19h10",
  ]));
  const removeButton = createButton("Delete table", createIcon([
    "M9 4.5h6",
    "M10 9v7",
    "M14 9v7",
    "M5 6h14",
    "M7 6l1 13h8l1-13",
  ]));

  const setButtonState = (button: HTMLButtonElement, active: boolean) => {
    button.classList.toggle("is-active", active);
  };

  const updateAlignmentButtons = (active: TableAlignment | null) => {
    setButtonState(alignLeftButton, active === "left");
    setButtonState(alignCenterButton, active === "center");
    setButtonState(alignRightButton, active === "right");
  };

  const reposition = () => {
    if (!activeMarker) return;
    try {
      const rect = activeMarker.getBoundingClientRect();
      positionOverlay(dom, rect, doc, win, "above");
    } catch {
      // Marker may have been detached from the DOM.
    }
  };

  const close = () => {
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";
  };

  const handleMouseDown = (event: MouseEvent) => event.preventDefault();

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const alignGroup = doc.createElement("div");
  alignGroup.className = "mdw-table-toolbar-group";
  alignGroup.append(alignLeftButton, alignCenterButton, alignRightButton);
  dom.append(addColumnButton, removeColumnButton, addRowButton, removeRowButton, alignGroup, removeButton);
  portalRoot.append(dom);

  dom.addEventListener("mousedown", handleMouseDown);
  addColumnButton.addEventListener("click", () => { const view = activeView; if (!view) return; appendTableColumn(view); view.focus(); });
  removeColumnButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeTableColumn(view); view.focus(); });
  addRowButton.addEventListener("click", () => { const view = activeView; if (!view) return; appendTableRow(view); view.focus(); });
  removeRowButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeTableRow(view); view.focus(); });
  alignLeftButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "left"); view.focus(); });
  alignCenterButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "center"); view.focus(); });
  alignRightButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "right"); view.focus(); });
  removeButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeActiveTable(view); view.focus(); });
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  addViewportListeners(win, handleWindowChange);

  return {
    update(view) {
      const info = getTableContext(view.state);
      if (!info) {
        close();
        return;
      }
      const marker = view.nodeDOM(info.tablePos);
      if (!(marker instanceof HTMLElementCtor)) {
        close();
        return;
      }
      activeView = view;
      activeMarker = marker;
      dom.hidden = false;
      dom.style.display = "flex";
      updateAlignmentButtons(normalizeTableAlignment(info.cell.attrs.align));
      reposition();
    },
    destroy() {
      close();
      dom.removeEventListener("mousedown", handleMouseDown);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeViewportListeners(win, handleWindowChange);
      dom.remove();
    },
  };
}
