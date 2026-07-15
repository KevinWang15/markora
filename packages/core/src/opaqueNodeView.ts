import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { NodeView, EditorView } from "prosemirror-view";
import { normalizeOpaqueMarkdownKind } from "./opaqueMarkdown";
import type { OpaqueMarkdownEditRequest, OpaqueMarkdownKind } from "./opaqueMarkdown";

export type { OpaqueMarkdownEditRequest, OpaqueMarkdownKind } from "./opaqueMarkdown";

type OpaqueNodeViewConstructor = new (
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
) => NodeView;

type CreateOpaqueNodeViewClassOptions = {
  nodeType: NodeType;
  display: "block" | "inline";
  onEdit?: (request: OpaqueMarkdownEditRequest) => void;
};

const OPAQUE_KIND_LABELS: Record<OpaqueMarkdownKind, string> = {
  "display-math": "Display math",
  "directive-container": "Directive container",
  "directive-leaf": "Directive",
  "frontmatter": "Front matter",
  "html-block": "HTML block",
  "html-comment": "HTML comment",
  "inline-directive": "Inline directive",
  "inline-html": "Inline HTML",
  "unknown-fence": "Unknown fenced extension",
};

function readOpaqueKind(node: ProseMirrorNode): OpaqueMarkdownKind {
  return normalizeOpaqueMarkdownKind(node.attrs.kind, "unknown-fence");
}

function readOpaqueSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : "";
}

function isEventTargetInside(target: EventTarget | null, container: HTMLElement) {
  const NodeCtor = container.ownerDocument.defaultView?.Node;
  return !!NodeCtor && target instanceof NodeCtor && container.contains(target);
}

export function createOpaqueNodeViewClass(
  options: CreateOpaqueNodeViewClassOptions,
): OpaqueNodeViewConstructor {
  const { display, nodeType, onEdit } = options;

  return class OpaqueNodeView implements NodeView {
    readonly dom: HTMLElement;

    private node: ProseMirrorNode;
    private readonly sourceElement: HTMLElement;
    private readonly kindElement: HTMLElement | null;
    private readonly editButton: HTMLButtonElement | null;
    private destroyed = false;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeType) {
        throw new RangeError(`Opaque node view expected ${nodeType.name}, received ${node.type.name}.`);
      }

      this.node = node;
      const ownerDocument = view.dom.ownerDocument;
      this.dom = ownerDocument.createElement(display === "block" ? "div" : "span");
      this.dom.className = `mdw-opaque-node mdw-opaque-${display}`;
      this.dom.setAttribute("contenteditable", "false");
      this.dom.setAttribute("role", "group");

      if (display === "block") {
        const header = ownerDocument.createElement("div");
        header.className = "mdw-opaque-header";

        this.kindElement = ownerDocument.createElement("span");
        this.kindElement.className = "mdw-opaque-kind";
        header.append(this.kindElement);

        this.editButton = this.createEditButton(ownerDocument);

        if (this.editButton) {
          header.append(this.editButton);
        }

        const pre = ownerDocument.createElement("pre");
        pre.className = "mdw-opaque-source";
        this.sourceElement = ownerDocument.createElement("code");
        pre.append(this.sourceElement);
        this.dom.append(header, pre);
      } else {
        this.kindElement = null;
        this.sourceElement = ownerDocument.createElement("code");
        this.sourceElement.className = "mdw-opaque-source";
        this.dom.append(this.sourceElement);

        this.editButton = this.createEditButton(ownerDocument);

        if (this.editButton) {
          this.dom.append(this.editButton);
        }
      }

      this.renderNode(node);
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType) {
        return false;
      }

      this.node = node;
      this.renderNode(node);
      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
    }

    stopEvent(event: Event) {
      return !!this.editButton && isEventTargetInside(event.target, this.editButton);
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      this.destroyed = true;
      this.editButton?.removeEventListener("click", this.handleEditClick);
    }

    private createEditButton(ownerDocument: Document) {
      if (!onEdit) {
        return null;
      }

      const button = ownerDocument.createElement("button");
      button.className = "mdw-opaque-edit";
      button.type = "button";
      button.textContent = "Edit source";
      button.addEventListener("click", this.handleEditClick);
      return button;
    }

    private readonly handleEditClick = () => {
      if (!onEdit || this.destroyed) {
        return;
      }

      const requestedNode = this.node;
      const kind = readOpaqueKind(requestedNode);
      const source = readOpaqueSource(requestedNode);

      onEdit({
        kind,
        source,
        update: (nextSource) => this.updateSource(requestedNode, kind, source, nextSource),
      });
    };

    private updateSource(
      requestedNode: ProseMirrorNode,
      requestedKind: OpaqueMarkdownKind,
      requestedSource: string,
      nextSource: string,
    ) {
      if (this.destroyed) {
        return false;
      }

      let pos: number | undefined;

      try {
        pos = this.getPos();
      } catch {
        return false;
      }

      if (typeof pos !== "number") {
        return false;
      }

      const currentNode = this.view.state.doc.nodeAt(pos);

      if (
        currentNode !== requestedNode ||
        currentNode.type !== nodeType ||
        readOpaqueKind(currentNode) !== requestedKind ||
        readOpaqueSource(currentNode) !== requestedSource
      ) {
        return false;
      }

      if (nextSource === requestedSource) {
        return true;
      }

      const transaction = this.view.state.tr.setNodeMarkup(
        pos,
        nodeType,
        { ...currentNode.attrs, source: nextSource },
        currentNode.marks,
      );
      this.view.dispatch(transaction);
      return true;
    }

    private renderNode(node: ProseMirrorNode) {
      const kind = readOpaqueKind(node);
      const kindLabel = OPAQUE_KIND_LABELS[kind];

      this.dom.setAttribute("data-mdw-opaque-kind", kind);
      this.dom.setAttribute("aria-label", `${kindLabel} Markdown source`);

      if (this.kindElement) {
        this.kindElement.textContent = kindLabel;
      }

      this.editButton?.setAttribute("aria-label", `Edit ${kindLabel} Markdown source`);
      this.sourceElement.textContent = readOpaqueSource(node);
    }
  };
}
