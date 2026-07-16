import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
  normalizeImageLoadResult,
  resolveResourceUrl,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";

type ImageViewInstance = {
  dom: HTMLSpanElement;
  update(node: ProseMirrorNode): boolean;
  selectNode(): void;
  deselectNode(): void;
  stopEvent(): boolean;
  ignoreMutation(): boolean;
  destroy(): void;
};

type ImageViewClass = new (node: ProseMirrorNode, ownerDocument: Document) => ImageViewInstance;

export function createImageViewClass(options: {
  imageNodeType: NodeType;
  onError?: (error: unknown, phase: MarkdownEditorResourceErrorPhase) => void;
  resources: NormalizedMarkdownEditorResources;
}): ImageViewClass {
  const { imageNodeType, onError, resources } = options;

  class ImageView {
    dom: HTMLSpanElement;
    private sourceRow: HTMLSpanElement;
    private sourceText: HTMLSpanElement;
    private frame: HTMLSpanElement;
    private img: HTMLImageElement;
    private status: HTMLSpanElement;
    private spinner: HTMLSpanElement;
    private spinnerAnimation: Animation | null = null;
    private errorIcon: HTMLSpanElement;
    private statusText: HTMLSpanElement;
    private requestVersion = 0;
    private requestController: AbortController | null = null;
    private requestCleanup: (() => void) | null = null;
    private destroyed = false;
    private loadState: "loading" | "loaded" | "error" = "loading";
    private errorUsesAltText = false;

    constructor(private node: ProseMirrorNode, private ownerDocument: Document) {
      const doc = this.ownerDocument;
      this.dom = doc.createElement("span");
      this.dom.className = "mdw-image";
      this.dom.contentEditable = "false";
      this.dom.style.display = "inline-flex";
      this.dom.style.flexDirection = "column";
      this.dom.style.gap = "8px";
      this.dom.style.maxWidth = "100%";
      this.dom.style.verticalAlign = "top";

      this.sourceRow = doc.createElement("span");
      this.sourceRow.className = "mdw-image-source";
      this.sourceRow.hidden = true;
      this.sourceRow.style.display = "inline-flex";
      this.sourceRow.style.alignItems = "center";
      this.sourceRow.style.gap = "8px";
      this.sourceRow.style.opacity = "0.72";
      this.sourceRow.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      this.sourceRow.style.fontSize = "0.95em";

      const sourceIcon = doc.createElement("span");
      sourceIcon.textContent = "🖼️";
      sourceIcon.setAttribute("aria-hidden", "true");

      this.sourceText = doc.createElement("span");
      this.sourceRow.append(sourceIcon, this.sourceText);

      this.frame = doc.createElement("span");
      this.frame.style.position = "relative";
      this.frame.style.display = "inline-flex";
      this.frame.style.alignSelf = "flex-start";
      this.frame.style.maxWidth = "100%";
      this.frame.style.minWidth = "48px";
      this.frame.style.minHeight = "48px";

      this.img = doc.createElement("img");
      this.img.draggable = false;
      this.img.style.display = "block";
      this.img.style.maxWidth = "100%";
      this.img.style.height = "auto";

      this.status = doc.createElement("span");
      this.status.style.position = "absolute";
      this.status.style.inset = "0";
      this.status.style.display = "grid";
      this.status.style.placeItems = "center";
      this.status.style.background = "rgba(148, 163, 184, 0.12)";
      this.status.style.border = "1px dashed rgba(148, 163, 184, 0.35)";
      this.status.style.borderRadius = "12px";
      this.status.style.padding = "12px";

      const statusInner = doc.createElement("span");
      statusInner.style.display = "inline-flex";
      statusInner.style.flexDirection = "column";
      statusInner.style.alignItems = "center";
      statusInner.style.gap = "8px";

      this.spinner = doc.createElement("span");
      this.spinner.style.width = "20px";
      this.spinner.style.height = "20px";
      this.spinner.style.border = "2px solid rgba(148, 163, 184, 0.35)";
      this.spinner.style.borderTopColor = "rgba(59, 130, 246, 0.95)";
      this.spinner.style.borderRadius = "999px";
      this.spinner.style.display = "inline-block";

      this.errorIcon = doc.createElement("span");
      this.errorIcon.textContent = "⚠️";
      this.errorIcon.hidden = true;

      this.statusText = doc.createElement("span");
      this.statusText.style.fontSize = "12px";
      this.statusText.style.opacity = "0.8";

      statusInner.append(this.spinner, this.errorIcon, this.statusText);
      this.status.append(statusInner);
      this.frame.append(this.img, this.status);
      this.dom.append(this.sourceRow, this.frame);

      this.syncMeta();
      this.load();
    }

    update(node: ProseMirrorNode) {
      if (node.type !== imageNodeType) {
        return false;
      }

      const previousSrc = typeof this.node.attrs.src === "string" ? this.node.attrs.src : "";
      const previousAlt = typeof this.node.attrs.alt === "string" ? this.node.attrs.alt : "";
      this.node = node;
      this.syncMeta();
      const nextAlt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";

      if (previousSrc !== (typeof node.attrs.src === "string" ? node.attrs.src : "")) {
        this.load();
      } else if (previousAlt !== nextAlt && this.loadState === "error" && this.errorUsesAltText) {
        this.setState("error", nextAlt || "Image failed to load");
      }

      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
      this.sourceRow.hidden = false;
      this.sourceRow.style.display = "inline-flex";
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
      this.sourceRow.hidden = true;
      this.sourceRow.style.display = "none";
    }

    stopEvent() {
      return false;
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      this.requestVersion += 1;
      this.stopSpinnerAnimation();
      this.cancelRequest();
      this.img.onload = null;
      this.img.onerror = null;
      this.img.removeAttribute("src");
    }

    private report(error: unknown, phase: MarkdownEditorResourceErrorPhase) {
      try {
        onError?.(error, phase);
      } catch {
        // Error observers must not break the image lifecycle.
      }
    }

    private runCleanup(cleanup: (() => void) | null) {
      if (!cleanup) {
        return;
      }

      try {
        cleanup();
      } catch (error) {
        this.report(error, "cleanup");
      }
    }

    private cancelRequest() {
      const controller = this.requestController;
      this.requestController = null;
      const cleanup = this.requestCleanup;
      this.requestCleanup = null;
      controller?.abort();
      this.runCleanup(cleanup);
    }

    private syncMeta() {
      const src = typeof this.node.attrs.src === "string" ? this.node.attrs.src : "";
      const alt = typeof this.node.attrs.alt === "string" ? this.node.attrs.alt : "";
      const title = typeof this.node.attrs.title === "string" ? this.node.attrs.title : "";
      const titleSuffix = title ? ` \"${title}\"` : "";

      this.dom.dataset.src = src;
      this.img.alt = alt;
      this.sourceText.textContent = `![${alt}](${src}${titleSuffix})`;

      if (title) {
        this.img.title = title;
      } else {
        this.img.removeAttribute("title");
      }
    }

    private startSpinnerAnimation() {
      if (this.spinnerAnimation || typeof this.spinner.animate !== "function") {
        return;
      }

      this.spinnerAnimation = this.spinner.animate(
        [
          { transform: "rotate(0deg)" },
          { transform: "rotate(360deg)" },
        ],
        { duration: 900, iterations: Infinity },
      );
    }

    private stopSpinnerAnimation() {
      const animation = this.spinnerAnimation;
      this.spinnerAnimation = null;
      animation?.cancel();
    }

    private setState(state: "loading" | "loaded" | "error", message = "") {
      this.loadState = state;

      if (state === "loading") {
        this.startSpinnerAnimation();
      } else {
        this.stopSpinnerAnimation();
      }

      if (state !== "error") {
        this.errorUsesAltText = false;
      }

      if (state === "loaded") {
        this.status.hidden = true;
        this.status.style.display = "none";
        this.spinner.hidden = true;
        this.errorIcon.hidden = true;
        this.statusText.textContent = "";
        this.img.style.opacity = "1";
        return;
      }

      this.status.hidden = false;
      this.status.style.display = "grid";
      this.img.style.opacity = state === "loading" ? "0.35" : "0";
      this.spinner.hidden = state !== "loading";
      this.errorIcon.hidden = state !== "error";
      this.statusText.textContent = message;
    }

    private load() {
      const rawSrc = typeof this.node.attrs.src === "string" ? this.node.attrs.src : "";
      const getFallbackMessage = () =>
        typeof this.node.attrs.alt === "string" && this.node.attrs.alt
          ? this.node.attrs.alt
          : "Image failed to load";
      const requestVersion = ++this.requestVersion;
      this.cancelRequest();
      this.img.onload = null;
      this.img.onerror = null;
      this.img.removeAttribute("src");

      if (this.destroyed || requestVersion !== this.requestVersion) {
        return;
      }

      const storedUrl = sanitizeResourceUrl(resources, "image", rawSrc);
      if (!storedUrl) {
        this.errorUsesAltText = false;
        this.setState("error", "Missing image URL");
        return;
      }

      this.setState("loading", "Loading image");

      let resolvedUrl: string | null;
      try {
        resolvedUrl = resolveResourceUrl(resources, "image", "load", storedUrl);
      } catch (error) {
        this.report(error, "resolve");
        this.setState("error", "Image blocked by resource policy");
        return;
      }

      if (this.destroyed || requestVersion !== this.requestVersion) {
        return;
      }

      if (!resolvedUrl) {
        this.setState("error", "Image blocked by resource policy");
        return;
      }

      const win = this.ownerDocument.defaultView as (Window & typeof globalThis) | null;
      if (!win) {
        this.setState("error", getFallbackMessage());
        return;
      }

      const controller = new win.AbortController();
      this.requestController = controller;

      const startImageLoad = (rawResult: unknown) => {
        let result;
        try {
          result = normalizeImageLoadResult(
            resources,
            rawResult as Parameters<typeof normalizeImageLoadResult>[1],
          );
        } catch (error) {
          const cleanup = typeof rawResult === "object"
            && rawResult !== null
            && "cleanup" in rawResult
            && typeof rawResult.cleanup === "function"
            ? rawResult.cleanup as () => void
            : null;
          this.runCleanup(cleanup);
          if (requestVersion === this.requestVersion && !controller.signal.aborted) {
            this.report(error, "load");
            this.setState("error", getFallbackMessage());
          }
          return;
        }

        if (
          this.destroyed
          || requestVersion !== this.requestVersion
          || controller.signal.aborted
        ) {
          this.runCleanup(result.cleanup ?? null);
          return;
        }

        let displaySrc: string;
        let revokeObjectUrl: (() => void) | null = null;
        if (typeof result.src === "string") {
          displaySrc = result.src;
        } else {
          try {
            displaySrc = win.URL.createObjectURL(result.src);
            revokeObjectUrl = () => win.URL.revokeObjectURL(displaySrc);
          } catch (error) {
            this.runCleanup(result.cleanup ?? null);
            this.report(error, "load");
            this.setState("error", getFallbackMessage());
            return;
          }
        }

        let cleaned = false;
        this.requestCleanup = () => {
          if (cleaned) {
            return;
          }
          cleaned = true;
          this.runCleanup(revokeObjectUrl);
          this.runCleanup(result.cleanup ?? null);
        };

        const crossOrigin = result.crossOrigin ?? null;
        if (crossOrigin === null) {
          this.img.removeAttribute("crossorigin");
        } else {
          this.img.crossOrigin = crossOrigin;
        }
        this.img.referrerPolicy = result.referrerPolicy ?? "no-referrer";
        this.img.decoding = "async";

        this.img.onload = () => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
            this.setState("loaded");
            return;
          }

          this.errorUsesAltText = true;
          this.setState("error", getFallbackMessage());
        };

        this.img.onerror = () => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          this.errorUsesAltText = true;
          this.setState("error", getFallbackMessage());
        };

        this.img.src = displaySrc;

        if (this.img.complete && this.img.naturalWidth > 0) {
          this.setState("loaded");
        }
      };

      let loadResult: unknown;
      try {
        loadResult = resources.loadImage
          ? resources.loadImage(Object.freeze({
              signal: controller.signal,
              storedUrl,
              url: resolvedUrl,
            }))
          : Object.freeze({ src: resolvedUrl });
      } catch (error) {
        if (requestVersion === this.requestVersion && !controller.signal.aborted) {
          this.report(error, "load");
          this.setState("error", getFallbackMessage());
        }
        return;
      }

      let isPromiseLike = false;
      try {
        isPromiseLike = Boolean(
          loadResult
          && typeof (loadResult as PromiseLike<unknown>).then === "function",
        );
      } catch (error) {
        if (requestVersion === this.requestVersion && !controller.signal.aborted) {
          this.report(error, "load");
          this.setState("error", getFallbackMessage());
        }
        return;
      }

      if (isPromiseLike) {
        Promise.resolve(loadResult).then(
          (result) => {
            if (result === null) {
              if (requestVersion === this.requestVersion && !controller.signal.aborted) {
                this.setState("error", "Image blocked by resource policy");
              }
              return;
            }
            startImageLoad(result);
          },
          (error) => {
            if (requestVersion === this.requestVersion && !controller.signal.aborted) {
              this.report(error, "load");
              this.setState("error", getFallbackMessage());
            }
          },
        );
      } else if (loadResult === null) {
        this.setState("error", "Image blocked by resource policy");
      } else {
        startImageLoad(loadResult);
      }
    }
  }

  return ImageView;
}
