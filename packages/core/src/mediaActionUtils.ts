import type { Schema } from "prosemirror-model";
import { NodeSelection, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { ActiveImageInfo } from "./overlayTypes";
import type { ImageEditorOverlay, LinkEditorOverlay } from "./overlays";
import { DEFAULT_IMAGE_PROTOCOLS, DEFAULT_LINK_PROTOCOLS, getSafeOpenUrl, sanitizeStoredUrl } from "./urlUtils";

export function createMediaActionHelpers(options: {
  schema: Schema;
  getMarkInfo: (state: EditorState, markName: "link") => { start: number; end: number; attrs?: Record<string, unknown> } | null;
}) {
  const { schema, getMarkInfo } = options;

  function canSetLink(state: EditorState) {
    const { selection } = state;

    if (!selection.empty) {
      return selection.$from.parent.inlineContent && selection.$to.parent.inlineContent;
    }

    return !!getMarkInfo(state, "link");
  }

  function setLink(view: EditorView, href: string) {
    const normalizedHref = sanitizeStoredUrl(href, DEFAULT_LINK_PROTOCOLS);

    if (!normalizedHref) {
      return false;
    }

    const markInfo = getMarkInfo(view.state, "link");

    if (markInfo) {
      return updateLinkHref(view, normalizedHref);
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
    view.dispatch(tr);
    return true;
  }

  function canInsertImage(state: EditorState) {
    const { $from } = state.selection;
    const index = $from.index();
    return $from.parent.canReplaceWith(index, index, schema.nodes.image);
  }

  function insertImage(view: EditorView, attrs: { src: string; alt?: string | null; title?: string | null }) {
    const normalizedSrc = sanitizeStoredUrl(attrs.src, DEFAULT_IMAGE_PROTOCOLS);

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

    view.dispatch(tr.scrollIntoView());
    return true;
  }

  function updateLinkHref(view: EditorView, href: string) {
    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo) {
      return false;
    }

    const normalizedHref = sanitizeStoredUrl(href, DEFAULT_LINK_PROTOCOLS);

    if (!normalizedHref) {
      return false;
    }

    const tr = view.state.tr.removeMark(markInfo.start, markInfo.end, schema.marks.link);
    tr.addMark(markInfo.start, markInfo.end, schema.marks.link.create({
      ...markInfo.attrs,
      href: normalizedHref,
    }));
    tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from));
    view.dispatch(tr);
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

    const normalizedSrc = sanitizeStoredUrl(attrs.src, DEFAULT_IMAGE_PROTOCOLS);

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

  function removeActiveImage(view: EditorView) {
    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    const tr = view.state.tr.delete(imageInfo.pos, imageInfo.pos + imageInfo.node.nodeSize);
    view.dispatch(tr);
    return true;
  }

  function removeActiveLink(view: EditorView) {
    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo) {
      return false;
    }

    const tr = view.state.tr.removeMark(markInfo.start, markInfo.end, schema.marks.link);
    tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from));
    view.dispatch(tr);
    return true;
  }

  function maybeEditActiveImage(view: EditorView, event: MouseEvent, imageEditor: ImageEditorOverlay) {
    const target = event.target;

    if (!(target instanceof HTMLElement) || event.metaKey || event.ctrlKey) {
      return false;
    }

    const sourceRow = target.closest(".mdw-image-source");
    const imageWrapper = target.closest(".mdw-image");

    if (!(sourceRow instanceof HTMLElement) && !(imageWrapper instanceof HTMLElement && event.detail >= 2)) {
      return false;
    }

    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    event.preventDefault();
    imageEditor.open(view, (sourceRow instanceof HTMLElement ? sourceRow : imageWrapper) as HTMLElement, imageInfo);
    return true;
  }

  function maybeOpenImage(event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const wrapper = target.closest(".mdw-image");
    const image = target.closest("img");
    const src =
      (wrapper instanceof HTMLElement ? wrapper.dataset.src : null) ||
      (image instanceof HTMLImageElement ? image.getAttribute("src") : null);

    if (!(event.metaKey || event.ctrlKey) || !src) {
      return false;
    }

    const safeSrc = getSafeOpenUrl(src, DEFAULT_IMAGE_PROTOCOLS);

    if (!safeSrc) {
      return false;
    }

    event.preventDefault();
    window.open(safeSrc, "_blank", "noopener,noreferrer");
    return true;
  }

  function maybeOpenLink(view: EditorView, event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const anchor = target.closest("a");

    if (!(anchor instanceof HTMLAnchorElement)) {
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

    const safeHref = getSafeOpenUrl(href, DEFAULT_LINK_PROTOCOLS);

    if (!safeHref) {
      return false;
    }

    event.preventDefault();
    window.open(safeHref, "_blank", "noopener,noreferrer");
    view.focus();
    return true;
  }

  function maybeEditActiveLink(view: EditorView, event: MouseEvent, linkEditor: LinkEditorOverlay) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const marker = target.closest(".mdw-marker-link-end");

    if (!(marker instanceof HTMLElement)) {
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
