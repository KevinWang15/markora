import type { Mark } from "prosemirror-model";
import type { EditorView, MarkView, ViewMutationRecord } from "prosemirror-view";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
  resolveResourceUrl,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";

// The stored URL of each anchor a link view renders. Its `href` is the resolved open URL, so
// modifier-click opening reads the stored URL from here and resolves it once.
const storedLinkUrls = new WeakMap<Element, string>();

/** The stored URL behind a rendered link anchor: its own `href` unless a link view rendered it. */
export function storedLinkUrl(anchor: Element): string | null {
  return storedLinkUrls.get(anchor) ?? anchor.getAttribute("href");
}

/**
 * Link marks render with the URL they open (`resolveUrl` with purpose `"open"`), so the browser's
 * own link behavior (plain click while read only, middle-click, "Open in new tab", the status
 * bar) agrees with modifier-click opening. A denied link renders without `href`. Markdown,
 * clipboard and DOM parsing keep the stored URL: the schema's `toDOM` is unchanged.
 */
export function createLinkViewFactory(options: {
  onError?: (error: unknown, phase: MarkdownEditorResourceErrorPhase) => void;
  resources: NormalizedMarkdownEditorResources;
}) {
  const { onError, resources } = options;
  const instances = new Set<{ render(): void }>();

  function openUrl(storedHref: unknown) {
    const stored = typeof storedHref === "string" ? sanitizeResourceUrl(resources, "link", storedHref) : null;
    if (!stored) return null;
    try {
      return resolveResourceUrl(resources, "link", "open", stored);
    } catch (error) {
      onError?.(error, "resolve");
      return null;
    }
  }

  return {
    create(mark: Mark, view: EditorView): MarkView {
      const anchor = view.dom.ownerDocument.createElement("a");
      if (mark.attrs.autolink === true) anchor.setAttribute("data-markora-autolink", "true");
      if (mark.attrs.title) anchor.setAttribute("title", mark.attrs.title);
      if (typeof mark.attrs.href === "string") storedLinkUrls.set(anchor, mark.attrs.href);
      const instance = {
        render() {
          const url = openUrl(mark.attrs.href);
          if (url) anchor.setAttribute("href", url);
          else anchor.removeAttribute("href");
        },
      };
      instance.render();
      instances.add(instance);
      return {
        dom: anchor,
        // The view writes `href` itself (refresh); ProseMirror must not read that as an edit. Any
        // other mutation is ProseMirror's as usual.
        ignoreMutation: (mutation: ViewMutationRecord) => mutation.type === "attributes"
          && mutation.target === anchor && mutation.attributeName === "href",
        destroy: () => { instances.delete(instance); },
      };
    },
    refresh() {
      for (const instance of [...instances]) instance.render();
    },
  };
}
