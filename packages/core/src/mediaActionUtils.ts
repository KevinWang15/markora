import type { Schema } from "prosemirror-model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { ActiveImageInfo, ImageEditorOverlay, LinkEditorOverlay } from "./uiTypes";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
  resolveResourceUrl,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";

type BrowserWindow = Window & typeof globalThis;
type DispatchTransaction = (transaction: Transaction) => void;

function dispatchEditorTransaction(
  view: EditorView,
  transaction: Transaction,
  dispatch?: DispatchTransaction,
) {
  if (dispatch) {
    dispatch(transaction);
    return;
  }

  view.dispatch(transaction);
}

type TargetContext = {
  HTMLAnchorElementCtor: typeof HTMLAnchorElement;
  HTMLElementCtor: typeof HTMLElement;
  HTMLImageElementCtor: typeof HTMLImageElement;
  target: HTMLElement;
  win: BrowserWindow;
};

function getTargetContext(target: EventTarget | null): TargetContext | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  const node = target as Node;
  const win = node.ownerDocument?.defaultView as BrowserWindow | null;
  const HTMLElementCtor = win?.HTMLElement;

  if (!win || !HTMLElementCtor || !(target instanceof HTMLElementCtor)) {
    return null;
  }

  return {
    HTMLAnchorElementCtor: win.HTMLAnchorElement,
    HTMLElementCtor,
    HTMLImageElementCtor: win.HTMLImageElement,
    target,
    win,
  };
}

export function createMediaActionHelpers(options: {
  schema: Schema;
  getMarkInfo: (state: EditorState, markName: "link") => { start: number; end: number; attrs?: Record<string, unknown> } | null;
  onResourceError: (error: unknown, phase: MarkdownEditorResourceErrorPhase) => void;
  resources: NormalizedMarkdownEditorResources;
}) {
  const { schema, getMarkInfo, onResourceError, resources } = options;

  function canSetLink(state: EditorState) {
    const { selection } = state;

    if (!selection.empty) {
      return selection.$from.parent.inlineContent && selection.$to.parent.inlineContent;
    }

    return !!getMarkInfo(state, "link");
  }

  function setLink(view: EditorView, href: string, dispatch?: DispatchTransaction) {
    const normalizedHref = sanitizeResourceUrl(resources, "link", href);

    if (!normalizedHref) {
      return false;
    }

    const markInfo = getMarkInfo(view.state, "link");

    if (markInfo) {
      return updateLinkHref(view, normalizedHref, dispatch);
    }

    const { selection } = view.state;

    if (selection.empty || !selection.$from.parent.inlineContent || !selection.$to.parent.inlineContent) {
      return false;
    }

    const tr = view.state.tr.addMark(selection.from, selection.to, schema.marks.link.create({
      href: normalizedHref,
      title: null,
    }));
    tr.removeStoredMark(schema.marks.link);
    tr.setSelection(TextSelection.create(tr.doc, selection.to));
    dispatchEditorTransaction(view, tr, dispatch);
    return true;
  }

  function canInsertImage(state: EditorState) {
    const { $from } = state.selection;
    const index = $from.index();
    return $from.parent.canReplaceWith(index, index, schema.nodes.image);
  }

  function insertImage(
    view: EditorView,
    attrs: { src: string; alt?: string | null; title?: string | null },
    dispatch?: DispatchTransaction,
  ) {
    const normalizedSrc = sanitizeResourceUrl(resources, "image", attrs.src);

    if (!normalizedSrc || !canInsertImage(view.state)) {
      return false;
    }

    const insertPos = view.state.selection.from;
    const image = schema.nodes.image.create({
      src: normalizedSrc,
      alt: attrs.alt?.trim() || null,
      title: attrs.title?.trim() || null,
    });
    const tr = view.state.tr.replaceSelectionWith(image);
    const candidatePositions = [insertPos, Math.max(0, insertPos - 1), tr.selection.from, Math.max(0, tr.selection.from - 1)];
    const imagePos = candidatePositions.find((pos) => tr.doc.nodeAt(pos)?.type === schema.nodes.image);

    if (typeof imagePos === "number") {
      tr.setSelection(NodeSelection.create(tr.doc, imagePos));
    }

    dispatchEditorTransaction(view, tr.scrollIntoView(), dispatch);
    return true;
  }

  function updateLinkHref(view: EditorView, href: string, dispatch?: DispatchTransaction) {
    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo) {
      return false;
    }

    const normalizedHref = sanitizeResourceUrl(resources, "link", href);

    if (!normalizedHref) {
      return false;
    }

    const tr = view.state.tr.removeMark(markInfo.start, markInfo.end, schema.marks.link);
    tr.addMark(markInfo.start, markInfo.end, schema.marks.link.create({
      ...markInfo.attrs,
      href: normalizedHref,
    }));
    tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from));
    dispatchEditorTransaction(view, tr, dispatch);
    return true;
  }

  function getActiveImageInfo(state: EditorState): ActiveImageInfo | null {
    const { selection } = state;

    if (!(selection instanceof NodeSelection) || selection.node.type !== schema.nodes.image) {
      return null;
    }

    return {
      pos: selection.from,
      node: selection.node,
    };
  }

  function updateActiveImage(view: EditorView, attrs: { src: string; alt: string | null; title: string | null }) {
    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    const normalizedSrc = sanitizeResourceUrl(resources, "image", attrs.src);

    if (!normalizedSrc) {
      return false;
    }

    const tr = view.state.tr.setNodeMarkup(imageInfo.pos, schema.nodes.image, {
      src: normalizedSrc,
      alt: attrs.alt?.trim() || null,
      title: attrs.title?.trim() || null,
    });
    tr.setSelection(NodeSelection.create(tr.doc, imageInfo.pos));
    view.dispatch(tr);
    return true;
  }

  function removeActiveImage(view: EditorView, dispatch?: DispatchTransaction) {
    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    const tr = view.state.tr.delete(imageInfo.pos, imageInfo.pos + imageInfo.node.nodeSize);
    dispatchEditorTransaction(view, tr, dispatch);
    return true;
  }

  function removeActiveLink(view: EditorView, dispatch?: DispatchTransaction) {
    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo) {
      return false;
    }

    const tr = view.state.tr.removeMark(markInfo.start, markInfo.end, schema.marks.link);
    tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from));
    dispatchEditorTransaction(view, tr, dispatch);
    return true;
  }

  function maybeEditActiveImage(view: EditorView, event: MouseEvent, imageEditor: ImageEditorOverlay) {
    const context = getTargetContext(event.target);

    if (!context || event.metaKey || event.ctrlKey) {
      return false;
    }

    const { HTMLElementCtor, target } = context;
    const sourceRow = target.closest(".mdw-image-source");
    const imageWrapper = target.closest(".mdw-image");

    if (!(sourceRow instanceof HTMLElementCtor) && !(imageWrapper instanceof HTMLElementCtor && event.detail >= 2)) {
      return false;
    }

    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    const marker = sourceRow instanceof HTMLElementCtor ? sourceRow : imageWrapper;

    if (!(marker instanceof HTMLElementCtor)) {
      return false;
    }

    event.preventDefault();
    imageEditor.open(view, marker, imageInfo);
    return true;
  }

  function maybeOpenImage(view: EditorView, event: MouseEvent) {
    const context = getTargetContext(event.target);

    if (!context) {
      return false;
    }

    const { HTMLElementCtor, HTMLImageElementCtor, target, win } = context;
    const wrapper = target.closest(".mdw-image");
    const image = target.closest("img");
    const src =
      (wrapper instanceof HTMLElementCtor ? wrapper.dataset.src : null) ||
      (image instanceof HTMLImageElementCtor ? image.getAttribute("src") : null);

    if (!(event.metaKey || event.ctrlKey) || !src) {
      return false;
    }

    event.preventDefault();
    let safeSrc: string | null;
    let phase: MarkdownEditorResourceErrorPhase = "resolve";
    try {
      const storedSrc = sanitizeResourceUrl(resources, "image", src);
      safeSrc = storedSrc
        ? resolveResourceUrl(resources, "image", "open", storedSrc)
        : null;
      if (safeSrc && !view.isDestroyed) {
        phase = "open";
        if (resources.openUrl) {
          resources.openUrl(Object.freeze({
            event,
            kind: "image",
            storedUrl: storedSrc!,
            url: safeSrc,
          }));
        } else {
          win.open(safeSrc, "_blank", "noopener,noreferrer");
        }
      }
    } catch (error) {
      onResourceError(error, phase);
    }
    return true;
  }

  function maybeOpenLink(view: EditorView, event: MouseEvent) {
    const context = getTargetContext(event.target);

    if (!context) {
      return false;
    }

    const { HTMLAnchorElementCtor, target, win } = context;
    const anchor = target.closest("a");

    if (!(anchor instanceof HTMLAnchorElementCtor)) {
      return false;
    }

    const isModifierClick = event.metaKey || event.ctrlKey;

    if (!isModifierClick) {
      return false;
    }

    const href = anchor.getAttribute("href");

    if (!href) {
      return false;
    }

    event.preventDefault();
    let phase: MarkdownEditorResourceErrorPhase = "resolve";
    try {
      const storedHref = sanitizeResourceUrl(resources, "link", href);
      const safeHref = storedHref
        ? resolveResourceUrl(resources, "link", "open", storedHref)
        : null;

      if (safeHref && !view.isDestroyed) {
        phase = "open";
        if (resources.openUrl) {
          resources.openUrl(Object.freeze({
            event,
            kind: "link",
            storedUrl: storedHref!,
            url: safeHref,
          }));
        } else {
          win.open(safeHref, "_blank", "noopener,noreferrer");
        }
      }
    } catch (error) {
      onResourceError(error, phase);
    }

    if (!view.isDestroyed) {
      view.focus();
    }

    return true;
  }

  function maybeEditActiveLink(view: EditorView, event: MouseEvent, linkEditor: LinkEditorOverlay) {
    const context = getTargetContext(event.target);

    if (!context) {
      return false;
    }

    const { HTMLElementCtor, target } = context;
    const marker = target.closest(".mdw-marker-link-end");

    if (!(marker instanceof HTMLElementCtor)) {
      return false;
    }

    const markInfo = getMarkInfo(view.state, "link");
    const currentHref = typeof markInfo?.attrs?.href === "string" ? markInfo.attrs.href : "";
    event.preventDefault();
    linkEditor.open(view, marker, currentHref);
    return true;
  }

  return {
    canSetLink,
    setLink,
    canInsertImage,
    insertImage,
    getActiveImageInfo,
    updateLinkHref,
    updateActiveImage,
    removeActiveImage,
    removeActiveLink,
    maybeEditActiveImage,
    maybeOpenImage,
    maybeOpenLink,
    maybeEditActiveLink,
  };
}
