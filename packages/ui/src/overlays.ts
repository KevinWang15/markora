import type { MarkdownEditor } from "markora";

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

function getViewportWidth(doc: Document, win: Window) {
  return doc.documentElement.clientWidth || win.innerWidth;
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
  updateLinkHref: (view: EditorView, href: string) => void;
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
      const top = markerRect.bottom + win.scrollY + 8;
      const left = Math.min(
        markerRect.left + win.scrollX,
        win.scrollX + getViewportWidth(doc, win) - dom.offsetWidth - 12,
      );

      dom.style.top = `${Math.max(12, top)}px`;
      dom.style.left = `${Math.max(12, left)}px`;
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
    updateLinkHref(activeView, input.value);
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
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);

  return {
    open(view, marker, href) {
      activeView = view;
      activeMarker = marker;
      input.value = href;
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      input.focus();
      input.select();
    },
    close,
    destroy() {
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      dom.remove();
    },
  };
}

export function createImageEditorOverlay(options: OverlayEnvironment & {
  updateActiveImage: (view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) => void;
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

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const removeButton = doc.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  let activeTitle: string | null = null;
  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const reposition = () => {
    if (!activeMarker) return;
    try {
      const markerRect = activeMarker.getBoundingClientRect();
      const top = markerRect.bottom + win.scrollY + 8;
      const left = Math.min(
        markerRect.left + win.scrollX,
        win.scrollX + getViewportWidth(doc, win) - dom.offsetWidth - 12,
      );
      dom.style.top = `${Math.max(12, top)}px`;
      dom.style.left = `${Math.max(12, left)}px`;
    } catch {
      // Marker may have been detached from the DOM.
    }
  };

  const close = (refocusEditor: boolean) => {
    const view = activeView;
    activeTitle = null;
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
  dom.append(srcInput, altInput, actions);
  portalRoot.append(dom);

  saveButton.addEventListener("click", () => {
    if (!activeView) return;
    updateActiveImage(activeView, { src: srcInput.value, alt: altInput.value, title: activeTitle });
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
  doc.addEventListener("mousedown", handleDocumentMouseDown, true);
  win.addEventListener("resize", handleWindowChange);
  win.addEventListener("scroll", handleWindowChange, true);

  return {
    open(view, marker, imageInfo) {
      activeView = view;
      activeMarker = marker;
      activeTitle = typeof imageInfo.node.attrs.title === "string" ? imageInfo.node.attrs.title : null;
      srcInput.value = typeof imageInfo.node.attrs.src === "string" ? imageInfo.node.attrs.src : "";
      altInput.value = typeof imageInfo.node.attrs.alt === "string" ? imageInfo.node.attrs.alt : "";
      dom.hidden = false;
      dom.style.display = "flex";
      reposition();
      srcInput.focus();
      srcInput.select();
    },
    close,
    destroy() {
      doc.removeEventListener("mousedown", handleDocumentMouseDown, true);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
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
      const topAbove = rect.top + win.scrollY - dom.offsetHeight - 8;
      const topBelow = rect.bottom + win.scrollY + 8;
      const left = Math.min(
        rect.left + win.scrollX,
        win.scrollX + getViewportWidth(doc, win) - dom.offsetWidth - 12,
      );
      dom.style.top = `${Math.max(12, topAbove > 12 ? topAbove : topBelow)}px`;
      dom.style.left = `${Math.max(12, left)}px`;
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
      dom.removeEventListener("mousedown", handleMouseDown);
      win.removeEventListener("resize", handleWindowChange);
      win.removeEventListener("scroll", handleWindowChange, true);
      dom.remove();
    },
  };
}
