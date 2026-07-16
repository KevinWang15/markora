import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
  resolveResourceUrl,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";

type BrowserWindow = Window & typeof globalThis;

export function createResourceOpenPlugin(options: {
  onError: (error: unknown, phase: MarkdownEditorResourceErrorPhase) => void;
  resources: NormalizedMarkdownEditorResources;
}) {
  const { onError, resources } = options;

  return new Plugin({
    props: {
      handleDOMEvents: {
        click(view: EditorView, event: MouseEvent) {
          if (!(event.metaKey || event.ctrlKey)) {
            return false;
          }

          const target = event.target;
          if (!target || typeof target !== "object") {
            return false;
          }

          const node = target as Node;
          const win = node.ownerDocument?.defaultView as BrowserWindow | null;
          if (!win || !(target instanceof win.HTMLElement)) {
            return false;
          }

          const anchor = target.closest("a");
          const imageWrapper = target.closest<HTMLElement>(".mdw-image");
          const image = target.closest("img");
          const kind = imageWrapper || image ? "image" : anchor ? "link" : null;
          const rawUrl = imageWrapper?.dataset.src
            ?? image?.getAttribute("src")
            ?? anchor?.getAttribute("href")
            ?? null;

          if (!kind || !rawUrl) {
            return false;
          }

          event.preventDefault();
          let phase: MarkdownEditorResourceErrorPhase = "resolve";
          try {
            const storedUrl = sanitizeResourceUrl(resources, kind, rawUrl);
            const url = storedUrl
              ? resolveResourceUrl(resources, kind, "open", storedUrl)
              : null;

            if (url && !view.isDestroyed) {
              phase = "open";
              if (resources.openUrl) {
                resources.openUrl(Object.freeze({ event, kind, storedUrl: storedUrl!, url }));
              } else {
                win.open(url, "_blank", "noopener,noreferrer");
              }
            }
          } catch (error) {
            onError(error, phase);
          }

          if (kind === "link" && !view.isDestroyed) {
            view.focus();
          }
          return true;
        },
      },
    },
  });
}
