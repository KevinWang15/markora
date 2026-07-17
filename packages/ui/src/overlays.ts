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

function createOverlayMessageId(kind: "code-language" | "image" | "link" | "table") {
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

export type CodeBlockLanguageEditRequest = Readonly<{
  language: string;
  cancel?: () => void;
  update: (nextLanguage: string) => boolean;
}>;

export type CodeBlockLanguageEditorOverlay = {
  open: (
    view: EditorView,
    marker: HTMLElement,
    request: CodeBlockLanguageEditRequest,
  ) => boolean;
  close: (refocusTrigger: boolean) => void;
  isComposing: () => boolean;
  destroy: () => void;
};

export type ImageEditorOverlay = {
  open: (view: EditorView, marker: HTMLElement, imageInfo: ActiveImageInfoLike) => void;
  close: (refocusEditor: boolean) => void;
  destroy: () => void;
};

export type TableToolbarOverlay = {
  create: (view: EditorView, marker: HTMLElement, onClose?: () => void) => boolean;
  update: (view: EditorView) => void;
  focus: (view: EditorView) => boolean;
  destroy: () => void;
};

export function createCodeBlockLanguageEditorOverlay(
  options: OverlayEnvironment,
): CodeBlockLanguageEditorOverlay {
  const { doc, portalRoot, win } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-code-language-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", "Edit code block language");
  dom.setAttribute("aria-modal", "false");

  const input = doc.createElement("input");
  input.className = "mdw-code-language-editor-input";
  input.type = "text";
  input.maxLength = 128;
  input.placeholder = "Language or fence info";
  input.setAttribute("aria-label", "Code block language or fence info");

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("code-language");
  errorMessage.setAttribute("role", "alert");
  input.setAttribute("aria-describedby", errorMessage.id);
  input.setAttribute("aria-errormessage", errorMessage.id);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const actions = doc.createElement("div");
  actions.className = "mdw-code-language-editor-actions";
  actions.append(saveButton, cancelButton);
  dom.append(input, errorMessage, actions);
  portalRoot.append(dom);

  let activeMarker: HTMLElement | null = null;
  let activeRequest: CodeBlockLanguageEditRequest | null = null;
  let activeView: EditorView | null = null;
  let composing = false;
  let destroyed = false;
  let session = 0;
  const closedShadowPortal = portalRoot instanceof win.ShadowRoot
    && portalRoot.mode === "closed";
  const internalMouseDownEvents = new WeakSet<Event>();

  const clearError = () => {
    input.removeAttribute("aria-invalid");
    errorMessage.hidden = true;
    errorMessage.textContent = "";
  };

  const showError = (message: string) => {
    input.setAttribute("aria-invalid", "true");
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    input.focus();
  };

  const reposition = () => {
    if (!activeMarker) {
      return;
    }

    try {
      positionOverlay(dom, activeMarker.getBoundingClientRect(), doc, win, "below");
    } catch {
      // The code block may have been replaced while its editor was open.
    }
  };

  const restoreTrigger = (view: EditorView | null, marker: HTMLElement | null) => {
    if (!canRestoreEditorFocus(dom, doc, win)) {
      return;
    }

    if (
      marker?.isConnected
      && !marker.hasAttribute("disabled")
      && typeof marker.focus === "function"
    ) {
      marker.focus();
      return;
    }

    if (view) {
      restoreEditorFocus(view, dom, doc, win);
    }
  };

  const close = (refocusTrigger: boolean) => {
    const marker = activeMarker;
    const request = activeRequest;
    const view = activeView;
    activeMarker = null;
    activeRequest = null;
    activeView = null;
    composing = false;
    session += 1;
    dom.hidden = true;
    dom.style.display = "none";
    clearError();
    request?.cancel?.();

    if (refocusTrigger) {
      restoreTrigger(view, marker);
    }
  };

  const save = () => {
    if (composing) {
      input.focus();
      return;
    }

    const view = activeView;
    const request = activeRequest;
    const currentSession = session;

    if (!view || !request || view.isDestroyed || !view.editable) {
      close(false);
      return;
    }

    const nextLanguage = input.value;

    if (nextLanguage.length > 128 || /[\0\r\n]/u.test(nextLanguage)) {
      showError("Fence info must be at most 128 characters with no NUL or line-break characters.");
      return;
    }

    if (!request.update(nextLanguage)) {
      if (session === currentSession && activeRequest === request) {
        showError("The code block changed. Close this editor and try again.");
      }
      return;
    }

    if (session === currentSession && activeRequest === request) {
      close(true);
    }
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    if (
      dom.hidden
      || isEventInside(event, dom, NodeCtor)
      || isEventInside(event, activeMarker, NodeCtor)
    ) {
      return;
    }

    if (!closedShadowPortal) {
      close(false);
      return;
    }

    const currentSession = session;
    win.queueMicrotask(() => {
      if (
        session === currentSession
        && !dom.hidden
        && !internalMouseDownEvents.has(event)
      ) {
        close(false);
      }
    });
  };

  const handlePortalMouseDown = (event: Event) => {
    if (
      isEventInside(event, dom, NodeCtor)
      || isEventInside(event, activeMarker, NodeCtor)
    ) {
      internalMouseDownEvents.add(event);
    }
  };

  const handleWindowChange = () => {
    if (!dom.hidden) {
      reposition();
    }
  };

  saveButton.addEventListener("click", save);
  cancelButton.addEventListener("click", () => close(true));
  input.addEventListener("input", clearError);
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
  });
  dom.addEventListener("keydown", (event) => {
    if (composing || isComposingKeyboardEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      save();
    }
  });
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  if (closedShadowPortal) {
    portalRoot.addEventListener("mousedown", handlePortalMouseDown, true);
  }
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  const removeVisualViewportListeners = addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, request) {
      if (destroyed || view.isDestroyed || !view.editable || !marker.isConnected) {
        close(false);
        return false;
      }

      activeRequest?.cancel?.();
      activeMarker = marker;
      activeRequest = request;
      activeView = view;
      composing = false;
      session += 1;
      const currentSession = session;
      input.value = request.language;
      clearError();
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      input.focus();
      input.select();
      const opened = (
        !destroyed
        && session === currentSession
        && activeRequest === request
        && activeView === view
        && activeMarker === marker
        && !dom.hidden
        && view.editable
        && marker.isConnected
      );

      if (!opened && session === currentSession && activeRequest === request) {
        close(false);
      }

      return opened;
    },
    close,
    isComposing() {
      return composing;
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      close(false);
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      if (closedShadowPortal) {
        portalRoot.removeEventListener("mousedown", handlePortalMouseDown, true);
      }
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeVisualViewportListeners();
      dom.remove();
    },
  };
}

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

type TableDimensions = { rows: number; columns: number };
type TableSizeMode = "create" | "resize";

type TableSizeEditorOverlay = {
  open: (
    view: EditorView,
    marker: HTMLElement,
    mode: TableSizeMode,
    dimensions: TableDimensions,
    onClose?: () => void,
  ) => boolean;
  close: (refocus: boolean) => void;
  closeResizeForView: (view: EditorView) => void;
  destroy: () => void;
};

function createTableSizeEditorOverlay(options: OverlayEnvironment & {
  insertTable: (view: EditorView, dimensions: TableDimensions) => boolean | void;
  resizeTable: (view: EditorView, dimensions: TableDimensions) => boolean | void;
}): TableSizeEditorOverlay {
  const { doc, insertTable, portalRoot, resizeTable, win } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-table-size-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-modal", "false");

  const form = doc.createElement("form");
  form.className = "mdw-table-size-editor-form";
  const fields = doc.createElement("div");
  fields.className = "mdw-table-size-editor-fields";

  const createDimensionField = (labelText: string) => {
    const label = doc.createElement("label");
    label.className = "mdw-table-size-editor-field";
    const labelValue = doc.createElement("span");
    labelValue.textContent = labelText;
    const input = doc.createElement("input");
    input.className = "mdw-table-size-editor-input";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "1";
    input.max = "100";
    input.step = "1";
    input.required = true;
    input.setAttribute("aria-label", labelText);
    label.append(labelValue, input);
    return { input, label };
  };

  const rowField = createDimensionField("Rows");
  const columnField = createDimensionField("Columns");
  fields.append(rowField.label, columnField.label);

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("table");
  errorMessage.setAttribute("role", "alert");
  rowField.input.setAttribute("aria-describedby", errorMessage.id);
  rowField.input.setAttribute("aria-errormessage", errorMessage.id);
  columnField.input.setAttribute("aria-describedby", errorMessage.id);
  columnField.input.setAttribute("aria-errormessage", errorMessage.id);

  const actions = doc.createElement("div");
  actions.className = "mdw-table-size-editor-actions";
  const submitButton = doc.createElement("button");
  submitButton.type = "submit";
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  actions.append(submitButton, cancelButton);
  form.append(fields, errorMessage, actions);
  dom.append(form);
  portalRoot.append(dom);

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeMode: TableSizeMode | null = null;
  let activeSession = 0;
  let destroyed = false;
  let returnFocusElement: HTMLElement | null = null;
  let closeCallback: (() => void) | null = null;

  const getOwnerActiveElement = () => descendIntoActiveShadowRoot(doc.activeElement, win);

  const reposition = () => {
    if (!activeMarker) {
      return;
    }

    try {
      positionOverlay(dom, activeMarker.getBoundingClientRect(), doc, win, "below");
    } catch {
      // The selection or table marker may have been detached.
    }
  };

  const clearError = () => {
    rowField.input.removeAttribute("aria-invalid");
    columnField.input.removeAttribute("aria-invalid");
    errorMessage.hidden = true;
    errorMessage.textContent = "";
  };

  const showError = (message: string, invalidInputs: HTMLInputElement[] = []) => {
    clearError();
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    invalidInputs.forEach((input) => input.setAttribute("aria-invalid", "true"));
    (invalidInputs[0] ?? rowField.input).focus();
  };

  const readDimension = (input: HTMLInputElement) => {
    const value = Number(input.value);
    return Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
  };

  const close = (refocus: boolean) => {
    const view = activeView;
    const focusTarget = returnFocusElement;
    const onClose = closeCallback;
    activeView = null;
    activeMarker = null;
    activeMode = null;
    returnFocusElement = null;
    closeCallback = null;
    dom.hidden = true;
    dom.style.display = "none";
    clearError();
    onClose?.();

    if (!refocus) {
      return;
    }

    if (
      focusTarget
      && focusTarget.isConnected
      && focusTarget !== doc.body
      && focusTarget !== doc.documentElement
      && !focusTarget.matches(":disabled")
      && !dom.contains(focusTarget)
    ) {
      focusTarget.focus();
      return;
    }

    if (view) {
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!activeView || !activeMode || activeView.isDestroyed || !activeView.editable) {
      close(false);
      return;
    }

    const rows = readDimension(rowField.input);
    const columns = readDimension(columnField.input);
    const invalidInputs = [
      ...(rows === null ? [rowField.input] : []),
      ...(columns === null ? [columnField.input] : []),
    ];

    if (rows === null || columns === null) {
      showError("Enter whole numbers from 1 through 100.", invalidInputs);
      return;
    }

    const view = activeView;
    const mode = activeMode;
    const session = activeSession;
    const handled = mode === "create"
      ? insertTable(view, { columns, rows })
      : resizeTable(view, { columns, rows });

    if (activeSession !== session || activeView !== view) {
      return;
    }

    if (handled === false) {
      showError(mode === "create"
        ? "The table could not be inserted at the current selection."
        : "The table could not be resized. Clear content outside the new size and try again.");
      return;
    }

    close(true);
  });
  cancelButton.addEventListener("click", () => close(true));
  dom.addEventListener("keydown", (event) => {
    if (isComposingKeyboardEvent(event) || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    close(true);
  });
  rowField.input.addEventListener("input", clearError);
  columnField.input.addEventListener("input", clearError);
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);
  const removeVisualViewportListeners = addViewportListeners(win, handleWindowChange);

  return {
    open(view, marker, mode, dimensions, onClose) {
      if (destroyed || view.isDestroyed || !view.editable) {
        close(false);
        return false;
      }

      const currentActiveElement = getOwnerActiveElement();
      if (!(currentActiveElement instanceof NodeCtor) || !dom.contains(currentActiveElement)) {
        returnFocusElement = currentActiveElement instanceof win.HTMLElement
          ? currentActiveElement
          : null;
      }
      activeView = view;
      activeMarker = marker;
      activeMode = mode;
      closeCallback = onClose ?? null;
      activeSession += 1;
      rowField.input.value = String(dimensions.rows);
      columnField.input.value = String(dimensions.columns);
      dom.setAttribute("aria-label", mode === "create" ? "Create table" : "Resize table");
      submitButton.textContent = mode === "create" ? "Create" : "Resize";
      clearError();
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      rowField.input.focus();
      rowField.input.select();
      return true;
    },
    close,
    closeResizeForView(view) {
      if (activeView === view && activeMode === "resize") {
        close(false);
      }
    },
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

type TableUiContextLike = {
  tablePos: number;
  cell: { attrs: Record<string, unknown> };
  selectedAlignment?: TableAlignment | null | "mixed";
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  selectedRowFrom: number;
  selectedRowTo: number;
  selectedColumnFrom: number;
  selectedColumnTo: number;
};

export function createTableToolbarOverlay(options: OverlayEnvironment & {
  addTableColumn: (view: EditorView, side: "before" | "after") => boolean | void;
  addTableRow: (view: EditorView, side: "before" | "after") => boolean | void;
  getTableContext: (state: EditorView["state"]) => TableUiContextLike | null;
  insertTable: (view: EditorView, dimensions: TableDimensions) => boolean | void;
  moveTableColumn: (view: EditorView, direction: "left" | "right") => boolean | void;
  moveTableRow: (view: EditorView, direction: "up" | "down") => boolean | void;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  removeActiveTable: (view: EditorView) => boolean | void;
  removeTableColumn: (view: EditorView) => boolean | void;
  removeTableRow: (view: EditorView) => boolean | void;
  resizeTable: (view: EditorView, dimensions: TableDimensions) => boolean | void;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment | null) => boolean | void;
}): TableToolbarOverlay {
  const {
    addTableColumn,
    addTableRow,
    doc,
    getTableContext,
    insertTable,
    moveTableColumn,
    moveTableRow,
    normalizeTableAlignment,
    portalRoot,
    removeActiveTable,
    removeTableColumn,
    removeTableRow,
    resizeTable,
    setTableColumnAlignment,
    win,
  } = options;
  const tableSizeEditor = createTableSizeEditorOverlay({
    doc,
    insertTable,
    portalRoot,
    resizeTable,
    win,
  });
  const HTMLElementCtor = win.HTMLElement;
  const dom = doc.createElement("div");
  dom.className = "mdw-table-toolbar";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", "Table controls");
  dom.setAttribute("aria-orientation", "horizontal");

  const status = doc.createElement("div");
  status.className = "mdw-table-toolbar-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeContextVersion = 0;
  let destroyed = false;
  let focusRestorationVersion = 0;
  let lastSelectionDescription = "";
  let repositionFrame: number | null = null;

  const restoreTableEditorFocus = (view: EditorView) => {
    if (restoreEditorFocus(view, dom, doc, win)) {
      focusRestorationVersion += 1;
    }
  };

  const createIcon = (paths: string[]) => {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
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

  const createButton = (title: string, paths: string[]) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mdw-table-toolbar-button";
    button.title = title;
    button.tabIndex = -1;
    button.setAttribute("aria-label", title);
    button.append(createIcon(paths));
    return button;
  };

  const insertRowBeforeButton = createButton("Insert row before", ["M5 9h14M5 17h14M12 3v4M9.5 5.5 12 3l2.5 2.5"]);
  const insertRowAfterButton = createButton("Insert row after", ["M5 7h14M5 15h14M12 17v4M9.5 18.5 12 21l2.5-2.5"]);
  const moveRowUpButton = createButton("Move row up", ["M5 8h14M5 16h14M12 14V3M8.5 6.5 12 3l3.5 3.5"]);
  const moveRowDownButton = createButton("Move row down", ["M5 8h14M5 16h14M12 10v11M8.5 17.5 12 21l3.5-3.5"]);
  const removeRowButton = createButton("Delete row", ["M5 8h14M5 16h14M9 12h6"]);
  const insertColumnBeforeButton = createButton("Insert column before", ["M9 5v14M17 5v14M3 12h4M5.5 9.5 3 12l2.5 2.5"]);
  const insertColumnAfterButton = createButton("Insert column after", ["M7 5v14M15 5v14M17 12h4M18.5 9.5 21 12l-2.5 2.5"]);
  const moveColumnLeftButton = createButton("Move column left", ["M8 5v14M16 5v14M14 12H3M6.5 8.5 3 12l3.5 3.5"]);
  const moveColumnRightButton = createButton("Move column right", ["M8 5v14M16 5v14M10 12h11M17.5 8.5 21 12l-3.5 3.5"]);
  const removeColumnButton = createButton("Delete column", ["M8 5v14M16 5v14M11 12h2"]);
  const alignAutomaticButton = createButton("Automatic alignment", ["M5 7h14M7 12h10M9 17h6"]);
  const alignLeftButton = createButton("Align left", ["M5 7h14M5 12h10M5 17h14"]);
  const alignCenterButton = createButton("Align center", ["M5 7h14M7 12h10M5 17h14"]);
  const alignRightButton = createButton("Align right", ["M5 7h14M9 12h10M5 17h14"]);
  const resizeButton = createButton("Resize table", ["M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4M8 8l8 8M16 8l-8 8"]);
  const removeButton = createButton("Delete table", ["M9 4.5h6M10 9v7M14 9v7M5 6h14M7 6l1 13h8l1-13"]);
  const toolbarButtons = [
    insertRowBeforeButton,
    insertRowAfterButton,
    moveRowUpButton,
    moveRowDownButton,
    removeRowButton,
    insertColumnBeforeButton,
    insertColumnAfterButton,
    moveColumnLeftButton,
    moveColumnRightButton,
    removeColumnButton,
    alignAutomaticButton,
    alignLeftButton,
    alignCenterButton,
    alignRightButton,
    resizeButton,
    removeButton,
  ];
  let rovingIndex = 0;

  const findEnabledIndex = (index: number, direction: 1 | -1) => {
    for (let offset = 0; offset < toolbarButtons.length; offset += 1) {
      const candidate = (index + offset * direction + toolbarButtons.length) % toolbarButtons.length;

      if (!toolbarButtons[candidate]?.disabled) {
        return candidate;
      }
    }

    return -1;
  };

  const setRovingIndex = (index: number, focus: boolean) => {
    const normalized = (index + toolbarButtons.length) % toolbarButtons.length;
    const nextIndex = toolbarButtons[normalized]?.disabled
      ? findEnabledIndex(normalized, 1)
      : normalized;

    if (nextIndex < 0) {
      toolbarButtons.forEach((button) => { button.tabIndex = -1; });
      return false;
    }

    rovingIndex = nextIndex;
    toolbarButtons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === rovingIndex ? 0 : -1;
    });

    if (focus) {
      toolbarButtons[rovingIndex]?.focus();
    }

    return true;
  };

  setRovingIndex(0, false);

  const setButtonState = (button: HTMLButtonElement, active: boolean) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  };

  const updateAlignmentButtons = (active: TableAlignment | null | "mixed") => {
    setButtonState(alignAutomaticButton, active === null);
    setButtonState(alignLeftButton, active === "left");
    setButtonState(alignCenterButton, active === "center");
    setButtonState(alignRightButton, active === "right");
  };

  const describeSelection = (info: TableUiContextLike) => {
    const rowFrom = Math.min(info.selectedRowFrom, info.selectedRowTo) + 1;
    const rowTo = Math.max(info.selectedRowFrom, info.selectedRowTo) + 1;
    const columnFrom = Math.min(info.selectedColumnFrom, info.selectedColumnTo) + 1;
    const columnTo = Math.max(info.selectedColumnFrom, info.selectedColumnTo) + 1;

    if (rowFrom === rowTo && columnFrom === columnTo) {
      return `Cell at row ${rowFrom}, column ${columnFrom} selected.`;
    }

    const rows = rowFrom === rowTo ? `row ${rowFrom}` : `rows ${rowFrom} through ${rowTo}`;
    const columns = columnFrom === columnTo
      ? `column ${columnFrom}`
      : `columns ${columnFrom} through ${columnTo}`;
    return `Rectangular selection: ${rows} and ${columns}.`;
  };

  const announce = (message: string, view: EditorView | null = activeView) => {
    const info = view && !view.isDestroyed ? getTableContext(view.state) : null;
    const description = info ? describeSelection(info) : "";
    status.textContent = description ? `${message} ${description}` : message;
  };

  const updateButtonAvailability = (info: TableUiContextLike) => {
    const focused = getDeepActiveElement(dom, doc, win);
    const focusedIndex = toolbarButtons.indexOf(focused as HTMLButtonElement);
    const selectedRowFrom = Math.min(info.selectedRowFrom, info.selectedRowTo);
    const selectedRowTo = Math.max(info.selectedRowFrom, info.selectedRowTo);
    const selectedColumnFrom = Math.min(info.selectedColumnFrom, info.selectedColumnTo);
    const selectedColumnTo = Math.max(info.selectedColumnFrom, info.selectedColumnTo);
    const selectionIncludesHeader = selectedRowFrom === 0;
    moveRowUpButton.disabled = selectedRowFrom <= 1;
    moveRowDownButton.disabled = selectionIncludesHeader || selectedRowTo >= info.rowCount - 1;
    moveColumnLeftButton.disabled = selectedColumnFrom <= 0;
    moveColumnRightButton.disabled = selectedColumnTo >= info.columnCount - 1;
    insertRowBeforeButton.disabled = info.rowCount >= 100;
    insertRowAfterButton.disabled = info.rowCount >= 100;
    insertColumnBeforeButton.disabled = info.columnCount >= 100;
    insertColumnAfterButton.disabled = info.columnCount >= 100;

    const preferredIndex = focusedIndex >= 0 ? focusedIndex : rovingIndex;
    const shouldMoveFocus = focusedIndex >= 0 && toolbarButtons[focusedIndex]?.disabled === true;
    setRovingIndex(preferredIndex, shouldMoveFocus);
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

  const cancelScheduledReposition = () => {
    if (repositionFrame === null) {
      return;
    }

    if (typeof win.cancelAnimationFrame === "function") {
      win.cancelAnimationFrame(repositionFrame);
    } else {
      win.clearTimeout(repositionFrame);
    }
    repositionFrame = null;
  };

  const scheduleReposition = () => {
    if (repositionFrame !== null) {
      return;
    }

    const callback = () => {
      repositionFrame = null;
      reposition();
    };
    repositionFrame = typeof win.requestAnimationFrame === "function"
      ? win.requestAnimationFrame(callback)
      : win.setTimeout(callback, 0);
  };

  const close = (refocusIfToolbarFocused = true) => {
    const view = activeView;
    const activeElement = getDeepActiveElement(dom, doc, win);
    const hadToolbarFocus = activeElement instanceof win.Node && dom.contains(activeElement);
    cancelScheduledReposition();
    activeView = null;
    activeMarker = null;
    lastSelectionDescription = "";
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

      if (index >= 0 && !toolbarButtons[index]?.disabled) {
        setRovingIndex(index, false);
      }
    }

    if (event.button === 0) {
      event.preventDefault();
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    const index = toolbarButtons.indexOf(event.target as HTMLButtonElement);

    if (index >= 0 && !toolbarButtons[index]?.disabled) {
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
      nextIndex = findEnabledIndex(currentIndex + 1, 1);
    } else if (event.key === "ArrowLeft") {
      nextIndex = findEnabledIndex(currentIndex - 1, -1);
    } else if (event.key === "Home") {
      nextIndex = findEnabledIndex(0, 1);
    } else if (event.key === "End") {
      nextIndex = findEnabledIndex(toolbarButtons.length - 1, -1);
    }

    if (nextIndex !== null && nextIndex >= 0) {
      event.preventDefault();
      setRovingIndex(nextIndex, true);
    }
  };

  const handleWindowChange = () => {
    if (!dom.hidden) {
      cancelScheduledReposition();
      reposition();
    }
  };

  const createGroup = (label: string, ...buttons: HTMLButtonElement[]) => {
    const group = doc.createElement("div");
    group.className = "mdw-table-toolbar-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    group.append(...buttons);
    return group;
  };

  dom.append(
    createGroup("Row", insertRowBeforeButton, insertRowAfterButton, moveRowUpButton, moveRowDownButton, removeRowButton),
    createGroup("Column", insertColumnBeforeButton, insertColumnAfterButton, moveColumnLeftButton, moveColumnRightButton, removeColumnButton),
    createGroup("Alignment", alignAutomaticButton, alignLeftButton, alignCenterButton, alignRightButton),
    createGroup("Table", resizeButton, removeButton),
    status,
  );
  portalRoot.append(dom);

  dom.addEventListener("mousedown", handleMouseDown);
  dom.addEventListener("focusin", handleFocusIn);
  dom.addEventListener("keydown", handleKeyDown);
  const runTableAction = (action: (view: EditorView) => boolean | void, message: string) => {
    const view = activeView;

    if (!view || view.isDestroyed || !view.editable) {
      close();
      return;
    }

    if (action(view) !== false) {
      announce(message, view);
    }
  };

  insertRowBeforeButton.addEventListener("click", () => runTableAction(
    (view) => addTableRow(view, "before"),
    "Inserted row before.",
  ));
  insertRowAfterButton.addEventListener("click", () => runTableAction(
    (view) => addTableRow(view, "after"),
    "Inserted row after.",
  ));
  moveRowUpButton.addEventListener("click", () => runTableAction(
    (view) => moveTableRow(view, "up"),
    "Moved row up.",
  ));
  moveRowDownButton.addEventListener("click", () => runTableAction(
    (view) => moveTableRow(view, "down"),
    "Moved row down.",
  ));
  removeRowButton.addEventListener("click", () => runTableAction(removeTableRow, "Deleted row."));
  insertColumnBeforeButton.addEventListener("click", () => runTableAction(
    (view) => addTableColumn(view, "before"),
    "Inserted column before.",
  ));
  insertColumnAfterButton.addEventListener("click", () => runTableAction(
    (view) => addTableColumn(view, "after"),
    "Inserted column after.",
  ));
  moveColumnLeftButton.addEventListener("click", () => runTableAction(
    (view) => moveTableColumn(view, "left"),
    "Moved column left.",
  ));
  moveColumnRightButton.addEventListener("click", () => runTableAction(
    (view) => moveTableColumn(view, "right"),
    "Moved column right.",
  ));
  removeColumnButton.addEventListener("click", () => runTableAction(removeTableColumn, "Deleted column."));
  alignAutomaticButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, null),
    "Set automatic alignment.",
  ));
  alignLeftButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "left"),
    "Aligned column left.",
  ));
  alignCenterButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "center"),
    "Aligned column center.",
  ));
  alignRightButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "right"),
    "Aligned column right.",
  ));
  resizeButton.addEventListener("click", () => {
    const view = activeView;
    const marker = activeMarker;
    const info = view && !view.isDestroyed ? getTableContext(view.state) : null;

    if (!view || !marker || !info || !view.editable) {
      close();
      return;
    }

    tableSizeEditor.open(view, marker, "resize", {
      columns: info.columnCount,
      rows: info.rowCount,
    });
  });
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
    if (removeActiveTable(view) === false) {
      return;
    }

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

  const update = (view: EditorView) => {
    if (destroyed || view.isDestroyed || !view.editable) {
      tableSizeEditor.close(false);
      close();
      return;
    }

    const info = getTableContext(view.state);
    if (!info) {
      tableSizeEditor.closeResizeForView(view);
      close();
      return;
    }
    const marker = view.nodeDOM(info.tablePos);
    if (!(marker instanceof HTMLElementCtor)) {
      close();
      return;
    }

    const contextChanged = activeView !== view || activeMarker !== marker;
    if (contextChanged) {
      activeContextVersion += 1;
    }

    activeView = view;
    activeMarker = marker;
    dom.hidden = false;
    dom.style.display = "flex";
    updateButtonAvailability(info);
    updateAlignmentButtons(
      info.selectedAlignment === undefined
        ? normalizeTableAlignment(info.cell.attrs.align)
        : info.selectedAlignment,
    );
    const selectionDescription = describeSelection(info);
    if (selectionDescription !== lastSelectionDescription) {
      lastSelectionDescription = selectionDescription;
      status.textContent = selectionDescription;
    }

    if (contextChanged) {
      cancelScheduledReposition();
      reposition();
    } else {
      scheduleReposition();
    }
  };

  return {
    create(view, marker, onClose) {
      return tableSizeEditor.open(view, marker, "create", { columns: 3, rows: 2 }, onClose);
    },
    update,
    focus(view) {
      update(view);

      if (activeView !== view || dom.hidden || dom.style.display === "none") {
        return false;
      }

      if (!setRovingIndex(rovingIndex, true)) {
        return false;
      }

      return getDeepActiveElement(dom, doc, win) === toolbarButtons[rovingIndex];
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
      tableSizeEditor.destroy();
      dom.remove();
    },
  };
}
