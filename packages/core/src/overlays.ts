import type { EditorView } from "prosemirror-view";
import type { ActiveImageInfo } from "./overlayTypes";
import type { TableAlignment } from "./tableNavigation";

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

export function createLinkEditorOverlay(options: {
  updateLinkHref: (view: EditorView, href: string) => void;
  removeActiveLink: (view: EditorView) => void;
}): LinkEditorOverlay {
  const { updateLinkHref, removeActiveLink } = options;
  const dom = document.createElement("div");
  dom.className = "mdw-link-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", "Edit link");

  const input = document.createElement("input");
  input.className = "mdw-link-editor-input";
  input.type = "text";
  input.placeholder = "https://example.com";
  input.setAttribute("aria-label", "Link URL");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const unlinkButton = document.createElement("button");
  unlinkButton.type = "button";
  unlinkButton.textContent = "Unlink";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const reposition = () => {
    if (!activeMarker) {
      return;
    }

    const markerRect = activeMarker.getBoundingClientRect();
    const top = markerRect.bottom + window.scrollY + 8;
    const left = Math.min(
      markerRect.left + window.scrollX,
      window.scrollX + document.documentElement.clientWidth - dom.offsetWidth - 12,
    );

    dom.style.top = `${Math.max(12, top)}px`;
    dom.style.left = `${Math.max(12, left)}px`;
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

    if (!(target instanceof Node)) {
      return;
    }

    if (dom.hidden || dom.style.display === "none" || dom.contains(target) || activeMarker?.contains(target)) {
      return;
    }

    close(false);
  };

  const handleWindowChange = () => {
    if (!dom.hidden) {
      reposition();
    }
  };

  const actions = document.createElement("div");
  actions.className = "mdw-link-editor-actions";
  actions.append(saveButton, unlinkButton, cancelButton);
  dom.append(input, actions);
  document.body.append(dom);

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
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);

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
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      dom.remove();
    },
  };
}

export function createImageEditorOverlay(options: {
  updateActiveImage: (view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) => void;
  removeActiveImage: (view: EditorView) => void;
}): ImageEditorOverlay {
  const { updateActiveImage, removeActiveImage } = options;
  const dom = document.createElement("div");
  dom.className = "mdw-image-editor";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", "Edit image");

  const srcInput = document.createElement("input");
  srcInput.className = "mdw-image-editor-input";
  srcInput.type = "text";
  srcInput.placeholder = "Image URL";
  srcInput.setAttribute("aria-label", "Image URL");

  const altInput = document.createElement("input");
  altInput.className = "mdw-image-editor-input";
  altInput.type = "text";
  altInput.placeholder = "Alt text";
  altInput.setAttribute("aria-label", "Alt text");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  let activeTitle: string | null = null;
  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const reposition = () => {
    if (!activeMarker) return;
    const markerRect = activeMarker.getBoundingClientRect();
    const top = markerRect.bottom + window.scrollY + 8;
    const left = Math.min(
      markerRect.left + window.scrollX,
      window.scrollX + document.documentElement.clientWidth - dom.offsetWidth - 12,
    );
    dom.style.top = `${Math.max(12, top)}px`;
    dom.style.left = `${Math.max(12, left)}px`;
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
    if (!(target instanceof Node)) return;
    if (dom.hidden || dom.style.display === "none" || dom.contains(target) || activeMarker?.contains(target)) return;
    close(false);
  };

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const actions = document.createElement("div");
  actions.className = "mdw-image-editor-actions";
  actions.append(saveButton, removeButton, cancelButton);
  dom.append(srcInput, altInput, actions);
  document.body.append(dom);

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
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);

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
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      dom.remove();
    },
  };
}

export function createTableToolbarOverlay(options: {
  appendTableColumn: (view: EditorView) => void;
  appendTableRow: (view: EditorView) => void;
  removeTableColumn: (view: EditorView) => void;
  removeTableRow: (view: EditorView) => void;
  setTableColumnAlignment: (view: EditorView, align: TableAlignment) => void;
  removeActiveTable: (view: EditorView) => void;
  getTableContext: (state: EditorView["state"]) => { tablePos: number; cell: { attrs: Record<string, unknown> } } | null;
  normalizeTableAlignment: (value: unknown) => TableAlignment | null;
}): TableToolbarOverlay {
  const { appendTableColumn, appendTableRow, removeTableColumn, removeTableRow, setTableColumnAlignment, removeActiveTable, getTableContext, normalizeTableAlignment } = options;
  const dom = document.createElement("div");
  dom.className = "mdw-table-toolbar";
  dom.hidden = true;
  dom.style.display = "none";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", "Table controls");

  let activeView: EditorView | null = null;
  let activeMarker: HTMLElement | null = null;

  const createIcon = (paths: string[], viewBox = "0 0 24 24") => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("mdw-table-toolbar-icon");

    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }

    return svg;
  };

  const createButton = (title: string, icon: SVGElement) => {
    const button = document.createElement("button");
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
    const rect = activeMarker.getBoundingClientRect();
    const topAbove = rect.top + window.scrollY - dom.offsetHeight - 8;
    const topBelow = rect.bottom + window.scrollY + 8;
    const left = Math.min(
      rect.left + window.scrollX,
      window.scrollX + document.documentElement.clientWidth - dom.offsetWidth - 12,
    );
    dom.style.top = `${Math.max(12, topAbove > 12 ? topAbove : topBelow)}px`;
    dom.style.left = `${Math.max(12, left)}px`;
  };

  const close = () => {
    activeView = null;
    activeMarker = null;
    dom.hidden = true;
    dom.style.display = "none";
  };

  const handleWindowChange = () => {
    if (!dom.hidden) reposition();
  };

  const alignGroup = document.createElement("div");
  alignGroup.className = "mdw-table-toolbar-group";
  alignGroup.append(alignLeftButton, alignCenterButton, alignRightButton);
  dom.append(addColumnButton, removeColumnButton, addRowButton, removeRowButton, alignGroup, removeButton);
  document.body.append(dom);

  dom.addEventListener("mousedown", (event) => event.preventDefault());
  addColumnButton.addEventListener("click", () => { const view = activeView; if (!view) return; appendTableColumn(view); view.focus(); });
  removeColumnButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeTableColumn(view); view.focus(); });
  addRowButton.addEventListener("click", () => { const view = activeView; if (!view) return; appendTableRow(view); view.focus(); });
  removeRowButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeTableRow(view); view.focus(); });
  alignLeftButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "left"); view.focus(); });
  alignCenterButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "center"); view.focus(); });
  alignRightButton.addEventListener("click", () => { const view = activeView; if (!view) return; setTableColumnAlignment(view, "right"); view.focus(); });
  removeButton.addEventListener("click", () => { const view = activeView; if (!view) return; removeActiveTable(view); view.focus(); });
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);

  return {
    update(view) {
      const info = getTableContext(view.state);
      if (!info) {
        close();
        return;
      }
      const marker = view.nodeDOM(info.tablePos);
      if (!(marker instanceof HTMLElement)) {
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
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      dom.remove();
    },
  };
}
