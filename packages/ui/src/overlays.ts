import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Maximize2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelBottomOpen,
  PanelLeftOpen,
  PanelRightOpen,
  PanelTopOpen,
  Plus,
  Trash2,
  type LucideIconData,
} from "@lucide/icons";
import { buildLucideIconElement } from "@lucide/icons/build";
import type { MarkdownEditor } from "markora";
import {
  formatDefaultUiMessage,
  type DefaultUiMessages,
  type DefaultUiTableAction,
  type DefaultUiTableControl,
  type DefaultUiTableGroup,
  type DefaultUiTableSelectionContext,
} from "./messages";
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
  messages: DefaultUiMessages;
  portalRoot: PortalRoot;
  syncEnvironment: (
    target: HTMLElement,
    view: EditorView,
    onInvalidated?: () => void,
  ) => void;
  win: BrowserWindow;
};

const CODE_BLOCK_LANGUAGE_MAX_LENGTH = 128;
const OVERLAY_GAP = 8;
const TABLE_DIMENSION_MAXIMUM = 100;
const TABLE_EDGE_INSERTION_SIZE_DEFAULT = 24;
const TABLE_EDGE_SELECTOR_OVERLAP_DEFAULT = 1;
const TABLE_EDGE_SELECTOR_SIZE_DEFAULT = 12;
const TABLE_DIMENSION_MINIMUM = 1;
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
  const preferredLeft = win.getComputedStyle(dom).direction === "rtl"
    ? markerRect.right - overlayWidth
    : markerRect.left;
  const left = clamp(preferredLeft, minLeft, maxLeft);
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

function refreshSelectionAnchor(marker: HTMLElement, view: EditorView) {
  if (marker.dataset.mdwSelectionAnchor !== "true") {
    return;
  }

  try {
    const coords = view.coordsAtPos(view.state.selection.from);
    setViewportPosition(marker, coords.left, coords.bottom);
  } catch {
    // The selection or its owner document may have changed while the overlay
    // was open. Normal close/update handling will retire a stale anchor.
  }
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
  const { doc, messages, portalRoot, syncEnvironment, win } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-code-language-editor mdw-ui";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", messages.codeBlockLanguageDialogLabel);
  dom.setAttribute("aria-modal", "false");

  const input = doc.createElement("input");
  input.className = "mdw-code-language-editor-input";
  input.type = "text";
  input.maxLength = CODE_BLOCK_LANGUAGE_MAX_LENGTH;
  input.placeholder = messages.codeBlockLanguageInputPlaceholder;
  input.setAttribute("aria-label", messages.codeBlockLanguageInputLabel);

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("code-language");
  errorMessage.setAttribute("role", "alert");
  input.setAttribute("aria-describedby", errorMessage.id);
  input.setAttribute("aria-errormessage", errorMessage.id);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = messages.saveButtonLabel;

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = messages.cancelButtonLabel;

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

    if (activeView) {
      syncEnvironment(dom, activeView, reposition);
      refreshSelectionAnchor(activeMarker, activeView);
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

    if (
      nextLanguage.length > CODE_BLOCK_LANGUAGE_MAX_LENGTH
      || /[\0\r\n]/u.test(nextLanguage)
    ) {
      showError(formatDefaultUiMessage(
        "messages.codeBlockLanguageInvalidError",
        messages.codeBlockLanguageInvalidError,
        Object.freeze({ maximumLength: CODE_BLOCK_LANGUAGE_MAX_LENGTH }),
      ));
      return;
    }

    if (!request.update(nextLanguage)) {
      if (session === currentSession && activeRequest === request) {
        showError(messages.codeBlockLanguageStaleError);
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
      syncEnvironment(dom, view, reposition);
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
  const {
    doc,
    messages,
    portalRoot,
    removeActiveLink,
    syncEnvironment,
    updateLinkHref,
    win,
  } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-link-editor mdw-ui";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", messages.linkDialogLabel);
  dom.setAttribute("aria-modal", "false");

  const input = doc.createElement("input");
  input.className = "mdw-link-editor-input";
  input.type = "text";
  input.placeholder = messages.linkUrlInputPlaceholder;
  input.setAttribute("aria-label", messages.linkUrlInputLabel);

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("link");
  errorMessage.setAttribute("role", "alert");
  errorMessage.textContent = messages.linkUrlInvalidError;
  input.setAttribute("aria-describedby", errorMessage.id);
  input.setAttribute("aria-errormessage", errorMessage.id);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = messages.saveButtonLabel;

  const unlinkButton = doc.createElement("button");
  unlinkButton.type = "button";
  unlinkButton.textContent = messages.unlinkButtonLabel;

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = messages.cancelButtonLabel;

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeSession = 0;
  let destroyed = false;

  const reposition = () => {
    if (!activeMarker) {
      return;
    }

    if (activeView) {
      syncEnvironment(dom, activeView, reposition);
      refreshSelectionAnchor(activeMarker, activeView);
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
      syncEnvironment(dom, view, reposition);
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
  const {
    doc,
    messages,
    portalRoot,
    removeActiveImage,
    syncEnvironment,
    updateActiveImage,
    win,
  } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-image-editor mdw-ui";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", messages.imageDialogLabel);
  dom.setAttribute("aria-modal", "false");

  const srcInput = doc.createElement("input");
  srcInput.className = "mdw-image-editor-input";
  srcInput.type = "text";
  srcInput.placeholder = messages.imageUrlInputPlaceholder;
  srcInput.setAttribute("aria-label", messages.imageUrlInputLabel);

  const errorMessage = doc.createElement("div");
  errorMessage.className = "mdw-editor-error";
  errorMessage.hidden = true;
  errorMessage.id = createOverlayMessageId("image");
  errorMessage.setAttribute("role", "alert");
  errorMessage.textContent = messages.imageUrlInvalidError;
  srcInput.setAttribute("aria-describedby", errorMessage.id);
  srcInput.setAttribute("aria-errormessage", errorMessage.id);

  const altInput = doc.createElement("input");
  altInput.className = "mdw-image-editor-input";
  altInput.type = "text";
  altInput.placeholder = messages.imageAltInputPlaceholder;
  altInput.setAttribute("aria-label", messages.imageAltInputLabel);

  const titleInput = doc.createElement("input");
  titleInput.className = "mdw-image-editor-input";
  titleInput.type = "text";
  titleInput.placeholder = messages.imageTitleInputPlaceholder;
  titleInput.setAttribute("aria-label", messages.imageTitleInputLabel);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = messages.saveButtonLabel;

  const removeButton = doc.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = messages.removeButtonLabel;

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = messages.cancelButtonLabel;

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeSession = 0;
  let destroyed = false;

  const reposition = () => {
    if (!activeMarker) return;
    if (activeView) {
      syncEnvironment(dom, activeView, reposition);
      refreshSelectionAnchor(activeMarker, activeView);
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
      syncEnvironment(dom, view, reposition);
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
  const {
    doc,
    insertTable,
    messages,
    portalRoot,
    resizeTable,
    syncEnvironment,
    win,
  } = options;
  const NodeCtor = win.Node;
  const dom = doc.createElement("div");
  dom.className = "mdw-table-size-editor mdw-ui";
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
    input.min = String(TABLE_DIMENSION_MINIMUM);
    input.max = String(TABLE_DIMENSION_MAXIMUM);
    input.step = "1";
    input.required = true;
    input.setAttribute("aria-label", labelText);
    label.append(labelValue, input);
    return { input, label };
  };

  const rowField = createDimensionField(messages.tableRowsInputLabel);
  const columnField = createDimensionField(messages.tableColumnsInputLabel);
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
  cancelButton.textContent = messages.cancelButtonLabel;
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

    if (activeView) {
      syncEnvironment(dom, activeView, reposition);
      refreshSelectionAnchor(activeMarker, activeView);
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
    return Number.isInteger(value)
      && value >= TABLE_DIMENSION_MINIMUM
      && value <= TABLE_DIMENSION_MAXIMUM
      ? value
      : null;
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
      showError(formatDefaultUiMessage(
        "messages.tableDimensionsInvalidError",
        messages.tableDimensionsInvalidError,
        Object.freeze({
          maximum: TABLE_DIMENSION_MAXIMUM,
          minimum: TABLE_DIMENSION_MINIMUM,
        }),
      ), invalidInputs);
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
      showError(formatDefaultUiMessage(
        "messages.tableOperationError",
        messages.tableOperationError,
        mode,
      ));
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
      syncEnvironment(dom, view, reposition);
      activeMarker = marker;
      activeMode = mode;
      closeCallback = onClose ?? null;
      activeSession += 1;
      rowField.input.value = String(dimensions.rows);
      columnField.input.value = String(dimensions.columns);
      dom.setAttribute("aria-label", formatDefaultUiMessage(
        "messages.tableDialogLabel",
        messages.tableDialogLabel,
        mode,
      ));
      submitButton.textContent = formatDefaultUiMessage(
        "messages.tableSubmitButtonLabel",
        messages.tableSubmitButtonLabel,
        mode,
      );
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
  isCellSelection: boolean;
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
  insertTableColumnAt: (view: EditorView, index: number) => boolean | void;
  insertTableRowAt: (view: EditorView, index: number) => boolean | void;
  moveTableColumn: (view: EditorView, direction: "left" | "right") => boolean | void;
  moveTableRow: (view: EditorView, direction: "up" | "down") => boolean | void;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
  removeActiveTable: (view: EditorView) => boolean | void;
  removeTableColumn: (view: EditorView) => boolean | void;
  removeTableRow: (view: EditorView) => boolean | void;
  resizeTable: (view: EditorView, dimensions: TableDimensions) => boolean | void;
  selectTableColumn: (view: EditorView, index: number) => boolean | void;
  selectTableRow: (view: EditorView, index: number) => boolean | void;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment | null) => boolean | void;
}): TableToolbarOverlay {
  const {
    addTableColumn,
    addTableRow,
    doc,
    getTableContext,
    insertTable,
    insertTableColumnAt,
    insertTableRowAt,
    messages,
    moveTableColumn,
    moveTableRow,
    normalizeTableAlignment,
    portalRoot,
    removeActiveTable,
    removeTableColumn,
    removeTableRow,
    resizeTable,
    selectTableColumn,
    selectTableRow,
    setTableColumnAlignment,
    syncEnvironment,
    win,
  } = options;
  const tableSizeEditor = createTableSizeEditorOverlay({
    doc,
    insertTable,
    messages,
    portalRoot,
    resizeTable,
    syncEnvironment,
    win,
  });
  const HTMLElementCtor = win.HTMLElement;
  const dom = doc.createElement("div");
  dom.className = "mdw-table-toolbar mdw-ui";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", messages.tableToolbarLabel);
  dom.setAttribute("aria-orientation", "horizontal");

  const status = doc.createElement("div");
  status.className = "mdw-table-toolbar-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const edgeDom = doc.createElement("div");
  edgeDom.className = "mdw-table-edge-controls mdw-ui";
  edgeDom.hidden = true;
  edgeDom.style.display = "none";

  const rowSelectors = doc.createElement("div");
  rowSelectors.className = "mdw-table-edge-group mdw-table-row-edge-selectors";
  rowSelectors.setAttribute("role", "group");
  rowSelectors.setAttribute("aria-label", messages.tableRowSelectionControlsLabel);

  const columnSelectors = doc.createElement("div");
  columnSelectors.className = "mdw-table-edge-group mdw-table-column-edge-selectors";
  columnSelectors.setAttribute("role", "group");
  columnSelectors.setAttribute("aria-label", messages.tableColumnSelectionControlsLabel);

  const rowInsertions = doc.createElement("div");
  rowInsertions.className = "mdw-table-edge-group mdw-table-row-edge-insertions";
  rowInsertions.setAttribute("role", "group");
  rowInsertions.setAttribute("aria-label", messages.tableRowInsertionControlsLabel);

  const columnInsertions = doc.createElement("div");
  columnInsertions.className = "mdw-table-edge-group mdw-table-column-edge-insertions";
  columnInsertions.setAttribute("role", "group");
  columnInsertions.setAttribute("aria-label", messages.tableColumnInsertionControlsLabel);

  const axisDeleteButton = doc.createElement("button");
  axisDeleteButton.type = "button";
  axisDeleteButton.className = "mdw-table-axis-delete";
  axisDeleteButton.hidden = true;
  axisDeleteButton.style.display = "none";
  axisDeleteButton.append(
    buildLucideIconElement(doc, Trash2, {
      className: "mdw-table-axis-delete-icon",
      size: 16,
      strokeWidth: 2,
      attributes: {
        "aria-hidden": "true",
        focusable: "false",
      },
    }),
    doc.createElement("span"),
  );

  edgeDom.append(
    rowSelectors,
    columnSelectors,
    rowInsertions,
    columnInsertions,
    axisDeleteButton,
  );

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;
  let activeContextVersion = 0;
  let destroyed = false;
  let focusRestorationVersion = 0;
  let lastSelectionDescription = "";
  let repositionFrame: number | null = null;
  let edgeColumnCount = -1;
  let edgeRowCount = -1;
  let columnSelectorButtons: HTMLButtonElement[] = [];
  let rowSelectorButtons: HTMLButtonElement[] = [];
  let columnInsertionButtons: HTMLButtonElement[] = [];
  let rowInsertionButtons: HTMLButtonElement[] = [];
  let activeAxisAction: "row" | "column" | null = null;
  let preferredAxisAction: "row" | "column" | null = null;

  const restoreTableEditorFocus = (view: EditorView, owner = dom) => {
    if (restoreEditorFocus(view, owner, doc, win)) {
      focusRestorationVersion += 1;
    }
  };

  const createButton = (control: DefaultUiTableControl, icon: LucideIconData) => {
    const title = formatDefaultUiMessage(
      "messages.tableControlLabel",
      messages.tableControlLabel,
      control,
    );
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mdw-table-toolbar-button";
    button.title = title;
    button.tabIndex = -1;
    button.setAttribute("aria-label", title);
    button.append(buildLucideIconElement(doc, icon, {
      className: "mdw-table-toolbar-icon",
      size: 18,
      strokeWidth: 1.8,
      attributes: {
        "aria-hidden": "true",
        focusable: "false",
      },
    }));
    return button;
  };

  const insertRowBeforeButton = createButton("insert-row-before", PanelTopOpen);
  const insertRowAfterButton = createButton("insert-row-after", PanelBottomOpen);
  const moveRowUpButton = createButton("move-row-up", MoveUp);
  const moveRowDownButton = createButton("move-row-down", MoveDown);
  const removeRowButton = createButton("delete-row", Trash2);
  const insertColumnBeforeButton = createButton("insert-column-before", PanelLeftOpen);
  const insertColumnAfterButton = createButton("insert-column-after", PanelRightOpen);
  const moveColumnLeftButton = createButton("move-column-left", MoveLeft);
  const moveColumnRightButton = createButton("move-column-right", MoveRight);
  const removeColumnButton = createButton("delete-column", Trash2);
  const alignAutomaticButton = createButton("automatic-alignment", AlignJustify);
  const alignLeftButton = createButton("align-left", AlignLeft);
  const alignCenterButton = createButton("align-center", AlignCenter);
  const alignRightButton = createButton("align-right", AlignRight);
  const resizeButton = createButton("resize-table", Maximize2);
  const removeButton = createButton("delete-table", Trash2);
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

  const getSelectionContext = (
    info: TableUiContextLike,
  ): DefaultUiTableSelectionContext => Object.freeze({
    columnFrom: Math.min(info.selectedColumnFrom, info.selectedColumnTo) + 1,
    columnTo: Math.max(info.selectedColumnFrom, info.selectedColumnTo) + 1,
    rowFrom: Math.min(info.selectedRowFrom, info.selectedRowTo) + 1,
    rowTo: Math.max(info.selectedRowFrom, info.selectedRowTo) + 1,
  });

  const describeSelection = (info: TableUiContextLike) => {
    return formatDefaultUiMessage(
      "messages.tableSelectionStatus",
      messages.tableSelectionStatus,
      getSelectionContext(info),
    );
  };

  const announce = (action: DefaultUiTableAction, view: EditorView | null = activeView) => {
    const info = view && !view.isDestroyed ? getTableContext(view.state) : null;
    status.textContent = formatDefaultUiMessage(
      "messages.tableActionStatus",
      messages.tableActionStatus,
      Object.freeze({ action, selection: info ? getSelectionContext(info) : null }),
    );
  };

  const updateButtonAvailability = (info: TableUiContextLike) => {
    const focused = getDeepActiveElement(dom, doc, win);
    const focusedIndex = toolbarButtons.indexOf(focused as HTMLButtonElement);
    const selectedRowFrom = Math.min(info.selectedRowFrom, info.selectedRowTo);
    const selectedRowTo = Math.max(info.selectedRowFrom, info.selectedRowTo);
    const selectedColumnFrom = Math.min(info.selectedColumnFrom, info.selectedColumnTo);
    const selectedColumnTo = Math.max(info.selectedColumnFrom, info.selectedColumnTo);
    const selectionIncludesHeader = selectedRowFrom === 0;
    const rtl = win.getComputedStyle(dom).direction === "rtl";
    moveRowUpButton.disabled = selectedRowFrom <= 1;
    moveRowDownButton.disabled = selectionIncludesHeader || selectedRowTo >= info.rowCount - 1;
    moveColumnLeftButton.disabled = rtl
      ? selectedColumnTo >= info.columnCount - 1
      : selectedColumnFrom <= 0;
    moveColumnRightButton.disabled = rtl
      ? selectedColumnFrom <= 0
      : selectedColumnTo >= info.columnCount - 1;
    insertRowBeforeButton.disabled = info.rowCount >= TABLE_DIMENSION_MAXIMUM;
    insertRowAfterButton.disabled = info.rowCount >= TABLE_DIMENSION_MAXIMUM;
    insertColumnBeforeButton.disabled = info.columnCount >= TABLE_DIMENSION_MAXIMUM;
    insertColumnAfterButton.disabled = info.columnCount >= TABLE_DIMENSION_MAXIMUM;

    const preferredIndex = focusedIndex >= 0 ? focusedIndex : rovingIndex;
    const shouldMoveFocus = focusedIndex >= 0 && toolbarButtons[focusedIndex]?.disabled === true;
    setRovingIndex(preferredIndex, shouldMoveFocus);
  };

  const runEdgeSelection = (
    action: (view: EditorView) => boolean | void,
  ) => {
    const view = activeView;

    if (!view || view.isDestroyed || !view.editable) {
      close();
      return;
    }

    action(view);
  };

  const createEdgeSelector = (axis: "row" | "column", index: number) => {
    const oneBasedIndex = index + 1;
    const label = axis === "row"
      ? formatDefaultUiMessage(
          "messages.tableSelectRowLabel",
          messages.tableSelectRowLabel,
          Object.freeze({ row: oneBasedIndex }),
        )
      : formatDefaultUiMessage(
          "messages.tableSelectColumnLabel",
          messages.tableSelectColumnLabel,
          Object.freeze({ column: oneBasedIndex }),
        );
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mdw-table-edge-selector";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    button.dataset.mdwTableAxis = axis;
    button.dataset.mdwTableIndex = String(index);
    button.addEventListener("click", () => {
      preferredAxisAction = axis;
      runEdgeSelection((view) => (
        axis === "row" ? selectTableRow(view, index) : selectTableColumn(view, index)
      ));
    });
    return button;
  };

  const createEdgeInsertion = (axis: "row" | "column", index: number) => {
    const label = axis === "row"
      ? formatDefaultUiMessage(
          "messages.tableInsertRowBetweenLabel",
          messages.tableInsertRowBetweenLabel,
          Object.freeze({ rowBefore: index, rowAfter: index + 1 }),
        )
      : formatDefaultUiMessage(
          "messages.tableInsertColumnBetweenLabel",
          messages.tableInsertColumnBetweenLabel,
          Object.freeze({ columnBefore: index, columnAfter: index + 1 }),
        );
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mdw-table-edge-insertion";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.mdwTableAxis = axis;
    button.dataset.mdwTableIndex = String(index);
    button.append(buildLucideIconElement(doc, Plus, {
      className: "mdw-table-edge-insertion-icon",
      size: 16,
      strokeWidth: 2.5,
      attributes: {
        "aria-hidden": "true",
        focusable: "false",
      },
    }));
    button.addEventListener("click", () => {
      const view = activeView;

      if (!view || view.isDestroyed || !view.editable) {
        close();
        return;
      }

      const handled = axis === "row"
        ? insertTableRowAt(view, index)
        : insertTableColumnAt(view, index);

      if (handled !== false) {
        announce(axis === "row" ? "insert-row-after" : "insert-column-after", view);
      }
    });
    return button;
  };

  const rebuildEdgeControls = (info: TableUiContextLike) => {
    if (edgeRowCount === info.rowCount && edgeColumnCount === info.columnCount) {
      return;
    }

    edgeRowCount = info.rowCount;
    edgeColumnCount = info.columnCount;
    rowSelectors.replaceChildren();
    columnSelectors.replaceChildren();
    rowInsertions.replaceChildren();
    columnInsertions.replaceChildren();
    rowSelectorButtons = Array.from({ length: info.rowCount }, (_, index) => (
      createEdgeSelector("row", index)
    ));
    columnSelectorButtons = Array.from({ length: info.columnCount }, (_, index) => (
      createEdgeSelector("column", index)
    ));
    rowInsertionButtons = Array.from({ length: Math.max(0, info.rowCount - 1) }, (_, index) => (
      createEdgeInsertion("row", index + 1)
    ));
    columnInsertionButtons = Array.from(
      { length: Math.max(0, info.columnCount - 1) },
      (_, index) => createEdgeInsertion("column", index + 1),
    );
    rowSelectors.append(...rowSelectorButtons);
    columnSelectors.append(...columnSelectorButtons);
    rowInsertions.append(...rowInsertionButtons);
    columnInsertions.append(...columnInsertionButtons);
  };

  const updateEdgeControlState = (info: TableUiContextLike) => {
    const selectedRowFrom = Math.min(info.selectedRowFrom, info.selectedRowTo);
    const selectedRowTo = Math.max(info.selectedRowFrom, info.selectedRowTo);
    const selectedColumnFrom = Math.min(info.selectedColumnFrom, info.selectedColumnTo);
    const selectedColumnTo = Math.max(info.selectedColumnFrom, info.selectedColumnTo);
    const wholeRowSelected = selectedColumnFrom === 0
      && selectedColumnTo === info.columnCount - 1;
    const wholeColumnSelected = selectedRowFrom === 0
      && selectedRowTo === info.rowCount - 1;
    const rowAxisSelected = info.isCellSelection === true && wholeRowSelected;
    const columnAxisSelected = info.isCellSelection === true && wholeColumnSelected;

    if (rowAxisSelected && columnAxisSelected) {
      activeAxisAction = preferredAxisAction;
    } else if (rowAxisSelected) {
      activeAxisAction = "row";
    } else if (columnAxisSelected) {
      activeAxisAction = "column";
    } else {
      activeAxisAction = null;
      preferredAxisAction = null;
    }

    if (activeAxisAction) {
      const label = formatDefaultUiMessage(
        "messages.tableControlLabel",
        messages.tableControlLabel,
        activeAxisAction === "row" ? "delete-row" : "delete-column",
      );
      axisDeleteButton.hidden = false;
      axisDeleteButton.style.display = "inline-flex";
      axisDeleteButton.dataset.mdwTableAxis = activeAxisAction;
      axisDeleteButton.title = label;
      axisDeleteButton.setAttribute("aria-label", label);
      axisDeleteButton.querySelector("span")!.textContent = label;
    } else {
      axisDeleteButton.hidden = true;
      axisDeleteButton.style.display = "none";
      delete axisDeleteButton.dataset.mdwTableAxis;
    }

    rowSelectorButtons.forEach((button, index) => {
      button.setAttribute(
        "aria-pressed",
        wholeRowSelected && index >= selectedRowFrom && index <= selectedRowTo ? "true" : "false",
      );
    });
    columnSelectorButtons.forEach((button, index) => {
      button.setAttribute(
        "aria-pressed",
        wholeColumnSelected && index >= selectedColumnFrom && index <= selectedColumnTo ? "true" : "false",
      );
    });
    const insertionDisabled = info.rowCount >= TABLE_DIMENSION_MAXIMUM;
    rowInsertionButtons.forEach((button) => { button.disabled = insertionDisabled; });
    const columnInsertionDisabled = info.columnCount >= TABLE_DIMENSION_MAXIMUM;
    columnInsertionButtons.forEach((button) => { button.disabled = columnInsertionDisabled; });
  };

  const getRenderedRows = (marker: HTMLElement) => Array.from(
    marker.querySelectorAll<HTMLTableRowElement>("tr"),
  ).filter((row) => row.closest("table") === marker);

  const positionEdgeElement = (
    element: HTMLElement,
    rect: Readonly<{ height: number; left: number; top: number; width: number }>,
  ) => {
    const initialSpace = measurePositionSpace(element);
    element.style.width = `${Math.max(0, rect.width) / initialSpace.scaleX}px`;
    element.style.height = `${Math.max(0, rect.height) / initialSpace.scaleY}px`;
    setViewportPosition(element, rect.left, rect.top, measurePositionSpace(element));
  };

  const positionEdgeControls = () => {
    if (!activeMarker) {
      return;
    }

    const rows = getRenderedRows(activeMarker);
    const firstRowCells = rows[0]
      ? Array.from(rows[0].cells).filter((cell) => cell.closest("table") === activeMarker)
      : [];

    if (
      rows.length !== rowSelectorButtons.length
      || firstRowCells.length !== columnSelectorButtons.length
    ) {
      return;
    }

    const tableRect = activeMarker.getBoundingClientRect();
    const rtl = win.getComputedStyle(activeMarker).direction === "rtl";
    const edgeStyle = win.getComputedStyle(edgeDom);
    const readEdgeSize = (name: string, fallback: number) => {
      const value = Number.parseFloat(edgeStyle.getPropertyValue(name));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    const selectorSize = readEdgeSize(
      "--mdw-ui-table-edge-selector-size",
      TABLE_EDGE_SELECTOR_SIZE_DEFAULT,
    );
    const selectorOverlap = Math.min(
      selectorSize / 2,
      readEdgeSize(
        "--mdw-ui-table-edge-selector-overlap",
        TABLE_EDGE_SELECTOR_OVERLAP_DEFAULT,
      ),
    );
    const insertionSize = readEdgeSize(
      "--mdw-ui-table-edge-insertion-size",
      TABLE_EDGE_INSERTION_SIZE_DEFAULT,
    );
    const rowSelectorLeft = rtl
      ? tableRect.right - selectorOverlap
      : tableRect.left - selectorSize + selectorOverlap;
    const rowInsertionCenter = rtl
      ? tableRect.right + selectorSize / 2 - selectorOverlap
      : tableRect.left - selectorSize / 2 + selectorOverlap;
    const columnSelectorTop = tableRect.top
      - selectorSize
      + selectorOverlap;
    const columnInsertionCenter = tableRect.top
      - selectorSize / 2
      + selectorOverlap;

    rows.forEach((row, index) => {
      const rowRect = row.getBoundingClientRect();
      const button = rowSelectorButtons[index];
      if (button) {
        positionEdgeElement(button, {
          height: rowRect.height,
          left: rowSelectorLeft,
          top: rowRect.top,
          width: selectorSize,
        });
      }
    });
    firstRowCells.forEach((cell, index) => {
      const cellRect = cell.getBoundingClientRect();
      const button = columnSelectorButtons[index];
      if (button) {
        positionEdgeElement(button, {
          height: selectorSize,
          left: cellRect.left,
          top: columnSelectorTop,
          width: cellRect.width,
        });
      }
    });
    rowInsertionButtons.forEach((button, boundaryIndex) => {
      const previousRect = rows[boundaryIndex]?.getBoundingClientRect();
      const nextRect = rows[boundaryIndex + 1]?.getBoundingClientRect();
      if (!previousRect || !nextRect) return;
      const boundary = (previousRect.bottom + nextRect.top) / 2;
      positionEdgeElement(button, {
        height: insertionSize,
        left: rowInsertionCenter - insertionSize / 2,
        top: boundary - insertionSize / 2,
        width: insertionSize,
      });
    });
    columnInsertionButtons.forEach((button, boundaryIndex) => {
      const previousRect = firstRowCells[boundaryIndex]?.getBoundingClientRect();
      const nextRect = firstRowCells[boundaryIndex + 1]?.getBoundingClientRect();
      if (!previousRect || !nextRect) return;
      const boundary = rtl
        ? (previousRect.left + nextRect.right) / 2
        : (previousRect.right + nextRect.left) / 2;
      positionEdgeElement(button, {
        height: insertionSize,
        left: boundary - insertionSize / 2,
        top: columnInsertionCenter - insertionSize / 2,
        width: insertionSize,
      });
    });

    if (!axisDeleteButton.hidden && activeAxisAction) {
      axisDeleteButton.style.width = "";
      axisDeleteButton.style.height = "";
      const axisActionRect = axisDeleteButton.getBoundingClientRect();
      const actionWidth = axisActionRect.width || axisDeleteButton.offsetWidth;
      const actionHeight = axisActionRect.height || axisDeleteButton.offsetHeight;
      const inset = 8;

      if (activeAxisAction === "row") {
        const selectedRows = rowSelectorButtons.flatMap((button, index) => (
          button.getAttribute("aria-pressed") === "true" && rows[index] ? [rows[index]!] : []
        ));
        const firstSelectedRect = selectedRows[0]?.getBoundingClientRect();
        const lastSelectedRect = selectedRows[selectedRows.length - 1]?.getBoundingClientRect();
        if (firstSelectedRect && lastSelectedRect) {
          positionEdgeElement(axisDeleteButton, {
            height: actionHeight,
            left: rtl
              ? tableRect.left + inset
              : tableRect.right - actionWidth - inset,
            top: (firstSelectedRect.top + lastSelectedRect.bottom - actionHeight) / 2,
            width: actionWidth,
          });
        }
      } else {
        const selectedCells = columnSelectorButtons.flatMap((button, index) => (
          button.getAttribute("aria-pressed") === "true" && firstRowCells[index]
            ? [firstRowCells[index]!]
            : []
        ));
        const selectedRects = selectedCells.map((cell) => cell.getBoundingClientRect());
        if (selectedRects.length > 0) {
          const selectedLeft = Math.min(...selectedRects.map((rect) => rect.left));
          const selectedRight = Math.max(...selectedRects.map((rect) => rect.right));
          positionEdgeElement(axisDeleteButton, {
            height: actionHeight,
            left: clamp(
              (selectedLeft + selectedRight - actionWidth) / 2,
              tableRect.left + inset,
              Math.max(tableRect.left + inset, tableRect.right - actionWidth - inset),
            ),
            top: tableRect.bottom - actionHeight - inset,
            width: actionWidth,
          });
        }
      }
    }
  };

  const reposition = () => {
    if (!activeMarker) return;
    if (activeView) {
      syncEnvironment(dom, activeView, handleEnvironmentInvalidated);
      syncEnvironment(edgeDom, activeView, handleEnvironmentInvalidated);
      refreshSelectionAnchor(activeMarker, activeView);
    }
    try {
      const rect = activeMarker.getBoundingClientRect();
      positionOverlay(dom, rect, doc, win, "above");
      positionEdgeControls();
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
    activeAxisAction = null;
    preferredAxisAction = null;
    lastSelectionDescription = "";
    dom.hidden = true;
    dom.style.display = "none";
    edgeDom.hidden = true;
    edgeDom.style.display = "none";

    if (refocusIfToolbarFocused && hadToolbarFocus && view) {
      restoreTableEditorFocus(view);
    }
  };

  const handleEnvironmentInvalidated = () => {
    const view = activeView;

    if (!view || view.isDestroyed || dom.hidden) {
      return;
    }

    const info = getTableContext(view.state);
    if (!info) {
      close(false);
      return;
    }

    updateButtonAvailability(info);
    reposition();
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
        restoreTableEditorFocus(
          view,
          event.target instanceof win.Node && edgeDom.contains(event.target) ? edgeDom : dom,
        );
      }
      return;
    }

    if (currentIndex < 0) {
      return;
    }

    let nextIndex: number | null = null;
    const rtl = win.getComputedStyle(dom).direction === "rtl";

    if (event.key === "ArrowRight") {
      nextIndex = rtl
        ? findEnabledIndex(currentIndex - 1, -1)
        : findEnabledIndex(currentIndex + 1, 1);
    } else if (event.key === "ArrowLeft") {
      nextIndex = rtl
        ? findEnabledIndex(currentIndex + 1, 1)
        : findEnabledIndex(currentIndex - 1, -1);
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

  const createGroup = (groupName: DefaultUiTableGroup, ...buttons: HTMLButtonElement[]) => {
    const group = doc.createElement("div");
    group.className = "mdw-table-toolbar-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", formatDefaultUiMessage(
      "messages.tableGroupLabel",
      messages.tableGroupLabel,
      groupName,
    ));
    group.append(...buttons);
    return group;
  };

  dom.append(
    createGroup("row", insertRowBeforeButton, insertRowAfterButton, moveRowUpButton, moveRowDownButton, removeRowButton),
    createGroup("column", insertColumnBeforeButton, insertColumnAfterButton, moveColumnLeftButton, moveColumnRightButton, removeColumnButton),
    createGroup("alignment", alignAutomaticButton, alignLeftButton, alignCenterButton, alignRightButton),
    createGroup("table", resizeButton, removeButton),
    status,
  );
  portalRoot.append(dom);
  portalRoot.append(edgeDom);

  dom.addEventListener("mousedown", handleMouseDown);
  dom.addEventListener("focusin", handleFocusIn);
  dom.addEventListener("keydown", handleKeyDown);
  edgeDom.addEventListener("mousedown", handleMouseDown);
  edgeDom.addEventListener("keydown", handleKeyDown);
  const runTableAction = (
    action: (view: EditorView) => boolean | void,
    actionName: DefaultUiTableAction,
  ) => {
    const view = activeView;

    if (!view || view.isDestroyed || !view.editable) {
      close();
      return;
    }

    if (action(view) !== false) {
      announce(actionName, view);
    }
  };

  insertRowBeforeButton.addEventListener("click", () => runTableAction(
    (view) => addTableRow(view, "before"),
    "insert-row-before",
  ));
  insertRowAfterButton.addEventListener("click", () => runTableAction(
    (view) => addTableRow(view, "after"),
    "insert-row-after",
  ));
  moveRowUpButton.addEventListener("click", () => runTableAction(
    (view) => moveTableRow(view, "up"),
    "move-row-up",
  ));
  moveRowDownButton.addEventListener("click", () => runTableAction(
    (view) => moveTableRow(view, "down"),
    "move-row-down",
  ));
  removeRowButton.addEventListener("click", () => runTableAction(removeTableRow, "delete-row"));
  insertColumnBeforeButton.addEventListener("click", () => runTableAction(
    (view) => addTableColumn(view, "before"),
    "insert-column-before",
  ));
  insertColumnAfterButton.addEventListener("click", () => runTableAction(
    (view) => addTableColumn(view, "after"),
    "insert-column-after",
  ));
  moveColumnLeftButton.addEventListener("click", () => runTableAction(
    (view) => moveTableColumn(
      view,
      win.getComputedStyle(dom).direction === "rtl" ? "right" : "left",
    ),
    "move-column-left",
  ));
  moveColumnRightButton.addEventListener("click", () => runTableAction(
    (view) => moveTableColumn(
      view,
      win.getComputedStyle(dom).direction === "rtl" ? "left" : "right",
    ),
    "move-column-right",
  ));
  removeColumnButton.addEventListener("click", () => runTableAction(removeTableColumn, "delete-column"));
  axisDeleteButton.addEventListener("click", () => {
    const view = activeView;
    const restoreFocus = getDeepActiveElement(edgeDom, doc, win) === axisDeleteButton;
    if (activeAxisAction === "row") {
      runTableAction(removeTableRow, "delete-row");
    } else if (activeAxisAction === "column") {
      runTableAction(removeTableColumn, "delete-column");
    }
    if (restoreFocus && view) {
      restoreTableEditorFocus(view, edgeDom);
    }
  });
  alignAutomaticButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, null),
    "automatic-alignment",
  ));
  alignLeftButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "left"),
    "align-left",
  ));
  alignCenterButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "center"),
    "align-center",
  ));
  alignRightButton.addEventListener("click", () => runTableAction(
    (view) => setTableColumnAlignment(view, "right"),
    "align-right",
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
    syncEnvironment(dom, view, handleEnvironmentInvalidated);
    syncEnvironment(edgeDom, view, handleEnvironmentInvalidated);
    dom.hidden = false;
    dom.style.display = "flex";
    edgeDom.hidden = false;
    edgeDom.style.display = "block";
    rebuildEdgeControls(info);
    updateEdgeControlState(info);
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
      edgeDom.removeEventListener("mousedown", handleMouseDown);
      edgeDom.removeEventListener("keydown", handleKeyDown);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      removeVisualViewportListeners();
      tableSizeEditor.destroy();
      edgeDom.remove();
      dom.remove();
    },
  };
}
