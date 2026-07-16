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
let nextOverlayMessageId = 0;

function createOverlayMessageId(kind: "image" | "link") {
  nextOverlayMessageId += 1;
  return `mdw-${kind}-editor-error-${nextOverlayMessageId}`;
}

function isComposingKeyboardEvent(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}

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
  const visualViewport = win.visualViewport;
  visualViewport?.addEventListener("resize", listener);
  visualViewport?.addEventListener("scroll", listener);

  return () => {
    visualViewport?.removeEventListener("resize", listener);
    visualViewport?.removeEventListener("scroll", listener);
  };
}

function isEventInside(event: Event, element: HTMLElement | null, NodeCtor: typeof Node) {
  if (!element) {
    return false;
  }

  if (typeof event.composedPath === "function" && event.composedPath().includes(element)) {
    return true;
  }

  return event.target instanceof NodeCtor && element.contains(event.target);
}

function descendIntoActiveShadowRoot(activeElement: Element | null, win: BrowserWindow) {
  const visited = new Set<Element>();

  while (activeElement instanceof win.HTMLElement && activeElement.shadowRoot?.activeElement) {
    if (visited.has(activeElement)) {
      break;
    }

    visited.add(activeElement);
    activeElement = activeElement.shadowRoot.activeElement;
  }

  return activeElement;
}

function getDeepActiveElement(dom: HTMLElement, doc: Document, win: BrowserWindow): Element | null {
  const root = dom.getRootNode();

  if (root instanceof win.ShadowRoot && root.activeElement) {
    return descendIntoActiveShadowRoot(root.activeElement, win);
  }

  return descendIntoActiveShadowRoot(doc.activeElement, win);
}

function canRestoreEditorFocus(dom: HTMLElement, doc: Document, win: BrowserWindow) {
  const activeElement = getDeepActiveElement(dom, doc, win);

  return (
    !activeElement
    || activeElement === doc.body
    || activeElement === doc.documentElement
    || dom.contains(activeElement)
  );
}

function restoreEditorFocus(view: EditorView, dom: HTMLElement, doc: Document, win: BrowserWindow) {
  if (view.isDestroyed || !view.editable || !canRestoreEditorFocus(dom, doc, win)) {
    return false;
  }

  view.focus();
  return true;
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
  dom.setAttribute("aria-modal", "false");

  const input = doc.createElement("input");
  input.className = "mdw-link-editor-input";
  input.type = "text";
  input.placeholder = "https://example.com";
  input.setAttribute("aria-label", "Link URL");

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("link");
  errorMessage.setAttribute("role", "alert");
  errorMessage.textContent = "Enter a valid link URL.";
  input.setAttribute("aria-describedby", errorMessage.id);
  input.setAttribute("aria-errormessage", errorMessage.id);

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
  let activeSession = 0;
  let destroyed = false;

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
    const shouldRestoreFocus = Boolean(refocusEditor && view && canRestoreEditorFocus(dom, doc, win));
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";

    if (shouldRestoreFocus && view) {
      restoreEditorFocus(view, dom, doc, win);
    }
  };

  const isCurrentSession = (view: EditorView, session: number) => (
    activeView === view && activeSession === session
  );

  const completeAction = (view: EditorView, session: number, refocusEditor: boolean) => {
    if (activeView && !isCurrentSession(view, session)) {
      return;
    }

    const shouldRestoreFocus = refocusEditor && canRestoreEditorFocus(dom, doc, win);

    if (isCurrentSession(view, session)) {
      close(false);
    }

    if (shouldRestoreFocus) {
      restoreEditorFocus(view, dom, doc, win);
    }
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    if (
      dom.hidden
      || dom.style.display === "none"
      || isEventInside(event, dom, NodeCtor)
      || isEventInside(event, activeMarker, NodeCtor)
    ) {
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
  dom.append(input, errorMessage, actions);
  portalRoot.append(dom);

  const clearValidationError = () => {
    input.removeAttribute("aria-invalid");
    errorMessage.hidden = true;
  };

  saveButton.addEventListener("click", () => {
    if (!activeView || activeView.isDestroyed || !activeView.editable) {
      close(false);
      return;
    }
    const view = activeView;
    const session = activeSession;
    const updated = updateLinkHref(view, input.value);

    if (!isCurrentSession(view, session)) {
      completeAction(view, session, updated);
      return;
    }

    if (!updated) {
      input.setAttribute("aria-invalid", "true");
      errorMessage.hidden = false;
      input.focus();
      return;
    }
    clearValidationError();
    completeAction(view, session, true);
  });
  unlinkButton.addEventListener("click", () => {
    if (!activeView || activeView.isDestroyed || !activeView.editable) {
      close(false);
      return;
    }
    const view = activeView;
    const session = activeSession;
    removeActiveLink(view);
    completeAction(view, session, true);
  });
  cancelButton.addEventListener("click", () => close(true));
  dom.addEventListener("keydown", (event) => {
    if (isComposingKeyboardEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }

    if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      saveButton.click();
    }
  });
  input.addEventListener("input", clearValidationError);
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  const removeVisualViewportListeners = addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, href) {
      if (destroyed || view.isDestroyed || !view.editable) {
        close(false);
        return;
      }

      activeView = view;
      activeMarker = marker;
      activeSession += 1;
      input.value = href;
      clearValidationError();
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      input.focus();
      input.select();
    },
    close,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      close(false);
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeVisualViewportListeners();
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
  dom.setAttribute("aria-modal", "false");

  const srcInput = doc.createElement("input");
  srcInput.className = "mdw-image-editor-input";
  srcInput.type = "text";
  srcInput.placeholder = "Image URL";
  srcInput.setAttribute("aria-label", "Image URL");

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("image");
  errorMessage.setAttribute("role", "alert");
  errorMessage.textContent = "Enter a valid image URL.";
  srcInput.setAttribute("aria-describedby", errorMessage.id);
  srcInput.setAttribute("aria-errormessage", errorMessage.id);

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
  let activeSession = 0;
  let destroyed = false;

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
    const shouldRestoreFocus = Boolean(refocusEditor && view && canRestoreEditorFocus(dom, doc, win));
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";

    if (shouldRestoreFocus && view) {
      restoreEditorFocus(view, dom, doc, win);
    }
  };

  const isCurrentSession = (view: EditorView, session: number) => (
    activeView === view && activeSession === session
  );

  const completeAction = (view: EditorView, session: number, refocusEditor: boolean) => {
    if (activeView && !isCurrentSession(view, session)) {
      return;
    }

    const shouldRestoreFocus = refocusEditor && canRestoreEditorFocus(dom, doc, win);

    if (isCurrentSession(view, session)) {
      close(false);
    }

    if (shouldRestoreFocus) {
      restoreEditorFocus(view, dom, doc, win);
    }
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    if (
      dom.hidden
      || dom.style.display === "none"
      || isEventInside(event, dom, NodeCtor)
      || isEventInside(event, activeMarker, NodeCtor)
    ) return;
    close(false);
  };

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const actions = doc.createElement("div");
  actions.className = "mdw-image-editor-actions";
  actions.append(saveButton, removeButton, cancelButton);
  dom.append(srcInput, altInput, titleInput, errorMessage, actions);
  portalRoot.append(dom);

  const clearValidationError = () => {
    srcInput.removeAttribute("aria-invalid");
    errorMessage.hidden = true;
  };

  saveButton.addEventListener("click", () => {
    if (!activeView || activeView.isDestroyed || !activeView.editable) {
      close(false);
      return;
    }
    const view = activeView;
    const session = activeSession;
    const updated = updateActiveImage(view, {
      src: srcInput.value,
      alt: altInput.value,
      title: titleInput.value,
    });

    if (!isCurrentSession(view, session)) {
      completeAction(view, session, updated);
      return;
    }

    if (!updated) {
      srcInput.setAttribute("aria-invalid", "true");
      errorMessage.hidden = false;
      srcInput.focus();
      return;
    }
    clearValidationError();
    completeAction(view, session, true);
  });
  removeButton.addEventListener("click", () => {
    if (!activeView || activeView.isDestroyed || !activeView.editable) {
      close(false);
      return;
    }
    const view = activeView;
    const session = activeSession;
    removeActiveImage(view);
    completeAction(view, session, true);
  });
  cancelButton.addEventListener("click", () => close(true));
  dom.addEventListener("keydown", (event) => {
    if (isComposingKeyboardEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }

    if (event.key === "Enter" && event.target instanceof win.HTMLInputElement) {
      event.preventDefault();
      saveButton.click();
    }
  });
  srcInput.addEventListener("input", clearValidationError);
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  const removeVisualViewportListeners = addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, imageInfo) {
      if (destroyed || view.isDestroyed || !view.editable) {
        close(false);
        return;
      }

      activeView = view;
      activeMarker = marker;
      activeSession += 1;
      srcInput.value = typeof imageInfo.node.attrs.src === "string" ? imageInfo.node.attrs.src : "";
      altInput.value = typeof imageInfo.node.attrs.alt === "string" ? imageInfo.node.attrs.alt : "";
      titleInput.value = typeof imageInfo.node.attrs.title === "string" ? imageInfo.node.attrs.title : "";
      clearValidationError();
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      srcInput.focus();
      srcInput.select();
    },
    close,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      close(false);
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeVisualViewportListeners();
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
  dom.setAttribute("aria-orientation", "horizontal");

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeContextVersion = 0;
  let destroyed = false;
  let focusRestorationVersion = 0;

  const restoreTableEditorFocus = (view: EditorView) => {
    if (restoreEditorFocus(view, dom, doc, win)) {
      focusRestorationVersion += 1;
    }
  };

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
    button.tabIndex = -1;
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
  const toolbarButtons = [
    addColumnButton,
    removeColumnButton,
    addRowButton,
    removeRowButton,
    alignLeftButton,
    alignCenterButton,
    alignRightButton,
    removeButton,
  ];
  let rovingIndex = 0;

  const setRovingIndex = (index: number, focus: boolean) => {
    rovingIndex = (index + toolbarButtons.length) % toolbarButtons.length;

    toolbarButtons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === rovingIndex ? 0 : -1;
    });

    if (focus) {
      toolbarButtons[rovingIndex]?.focus();
    }
  };

  setRovingIndex(0, false);

  const setButtonState = (button: HTMLButtonElement, active: boolean) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
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

  const close = (refocusIfToolbarFocused = true) => {
    const view = activeView;
    const activeElement = getDeepActiveElement(dom, doc, win);
    const hadToolbarFocus = activeElement instanceof win.Node && dom.contains(activeElement);
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";

    if (refocusIfToolbarFocused && hadToolbarFocus && view) {
      restoreTableEditorFocus(view);
    }
  };

  const handleMouseDown = (event: MouseEvent) => {
    const target = event.target;

    if (target instanceof win.Element) {
      const button = target.closest("button");
      const index = toolbarButtons.indexOf(button as HTMLButtonElement);

      if (index >= 0) {
        setRovingIndex(index, false);
      }
    }

    if (event.button === 0) {
      event.preventDefault();
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    const index = toolbarButtons.indexOf(event.target as HTMLButtonElement);

    if (index >= 0) {
      setRovingIndex(index, false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isComposingKeyboardEvent(event)) {
      return;
    }

    const currentIndex = toolbarButtons.indexOf(event.target as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      const view = activeView;

      if (view) {
        restoreTableEditorFocus(view);
      }
      return;
    }

    if (currentIndex < 0) {
      return;
    }

    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = currentIndex + 1;
    } else if (event.key === "ArrowLeft") {
      nextIndex = currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = toolbarButtons.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      setRovingIndex(nextIndex, true);
    }
  };

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const alignGroup = doc.createElement("div");
  alignGroup.className = "mdw-table-toolbar-group";
  alignGroup.setAttribute("role", "group");
  alignGroup.setAttribute("aria-label", "Column alignment");
  alignGroup.append(alignLeftButton, alignCenterButton, alignRightButton);
  dom.append(addColumnButton, removeColumnButton, addRowButton, removeRowButton, alignGroup, removeButton);
  portalRoot.append(dom);

  dom.addEventListener("mousedown", handleMouseDown);
  dom.addEventListener("focusin", handleFocusIn);
  dom.addEventListener("keydown", handleKeyDown);
  const runTableAction = (action: (view: EditorView) => void) => {
    const view = activeView;

    if (!view || view.isDestroyed || !view.editable) {
      close();
      return;
    }

    action(view);
  };

  addColumnButton.addEventListener("click", () => runTableAction(appendTableColumn));
  removeColumnButton.addEventListener("click", () => runTableAction(removeTableColumn));
  addRowButton.addEventListener("click", () => runTableAction(appendTableRow));
  removeRowButton.addEventListener("click", () => runTableAction(removeTableRow));
  alignLeftButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "left"),
  ));
  alignCenterButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "center"),
  ));
  alignRightButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "right"),
  ));
  removeButton.addEventListener("click", () => {
    const view = activeView;

    if (!view || view.isDestroyed || !view.editable) {
      close();
      return;
    }

    const shouldRestoreFocus = canRestoreEditorFocus(dom, doc, win);
    const contextVersion = activeContextVersion;
    const marker = activeMarker;
    const restorationVersion = focusRestorationVersion;
    removeActiveTable(view);

    if (activeContextVersion !== contextVersion) {
      return;
    }

    if (activeView === view && activeMarker === marker) {
      close(false);
    }

    if (shouldRestoreFocus && restorationVersion === focusRestorationVersion) {
      restoreTableEditorFocus(view);
    }
  });
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  const removeVisualViewportListeners = addViewportListeners(win, handleWindowChange);

  return {
    update(view) {
      if (destroyed || view.isDestroyed || !view.editable) {
        close();
        return;
      }

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

      if (activeView !== view || activeMarker !== marker) {
        activeContextVersion += 1;
      }

      activeView = view;
      activeMarker = marker;
      dom.hidden = false;
      dom.style.display = "flex";
      updateAlignmentButtons(normalizeTableAlignment(info.cell.attrs.align));
      reposition();
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      close(false);
      dom.removeEventListener("mousedown", handleMouseDown);
      dom.removeEventListener("focusin", handleFocusIn);
      dom.removeEventListener("keydown", handleKeyDown);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeVisualViewportListeners();
      dom.remove();
    },
  };
}
