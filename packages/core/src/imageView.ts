import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";

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

export function createImageViewClass(options: { imageNodeType: NodeType }): ImageViewClass {
  const { imageNodeType } = options;

  class ImageView {
    dom: HTMLSpanElement;
    private sourceRow: HTMLSpanElement;
    private sourceText: HTMLSpanElement;
    private frame: HTMLSpanElement;
    private img: HTMLImageElement;
    private status: HTMLSpanElement;
    private spinner: HTMLSpanElement;
    private errorIcon: HTMLSpanElement;
    private statusText: HTMLSpanElement;
    private requestVersion = 0;

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
      this.spinner.animate(
        [
          { transform: "rotate(0deg)" },
          { transform: "rotate(360deg)" },
        ],
        { duration: 900, iterations: Infinity },
      );

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
      this.node = node;
      this.syncMeta();

      if (previousSrc !== (typeof node.attrs.src === "string" ? node.attrs.src : "")) {
        this.load();
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
      this.requestVersion += 1;
      this.img.removeAttribute("src");
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

    private setState(state: "loading" | "loaded" | "error", message = "") {
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
      const src = typeof this.node.attrs.src === "string" ? this.node.attrs.src.trim() : "";
      const fallbackMessage = typeof this.node.attrs.alt === "string" && this.node.attrs.alt ? this.node.attrs.alt : "Image failed to load";
      const requestVersion = ++this.requestVersion;

      if (!src) {
        this.img.removeAttribute("src");
        this.setState("error", "Missing image URL");
        return;
      }

      this.setState("loading", "Loading image");

      const startImageLoad = () => {
        if (requestVersion !== this.requestVersion) {
          return;
        }

        this.img.onload = () => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
            this.setState("loaded");
            return;
          }

          this.setState("error", fallbackMessage);
        };

        this.img.onerror = () => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          this.setState("error", fallbackMessage);
        };

        this.img.src = src;

        if (this.img.complete && this.img.naturalWidth > 0) {
          this.setState("loaded");
        }
      };

      startImageLoad();
    }
  }

  return ImageView;
}
