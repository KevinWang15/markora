import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { NodeView, EditorView } from "prosemirror-view";
import { normalizeOpaqueMarkdownKind } from "./opaqueMarkdown";
import type { OpaqueMarkdownEditRequest, OpaqueMarkdownKind } from "./opaqueMarkdown";
import {
  defaultMarkdownEditorMessages,
  type MarkdownEditorMessages,
} from "./editorMessages";

export type { OpaqueMarkdownEditRequest, OpaqueMarkdownKind } from "./opaqueMarkdown";

type OpaqueNodeViewConstructor = new (
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
) => NodeView;

type OpaqueNodeViewClass = OpaqueNodeViewConstructor & {
  refresh: () => void;
};

type CreateOpaqueNodeViewClassOptions = {
  nodeType: NodeType;
  display: "block" | "inline";
  getOnEdit?: () => ((request: OpaqueMarkdownEditRequest) => void) | undefined;
  messages?: MarkdownEditorMessages;
  onEdit?: (request: OpaqueMarkdownEditRequest) => void;
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
): OpaqueNodeViewClass {
  const {
    display,
    getOnEdit,
    messages = defaultMarkdownEditorMessages,
    nodeType,
    onEdit,
  } = options;
  const refreshers = new Set<() => void>();
  const resolveOnEdit = () => getOnEdit ? getOnEdit() : onEdit;

  return class OpaqueNodeView implements NodeView {
    static refresh() {
      for (const refresh of [...refreshers]) {
        refresh();
      }
    }

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
      refreshers.add(this.refresh);
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
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      refreshers.delete(this.refresh);
      this.editButton?.removeEventListener("click", this.handleEditClick);
    }

    private readonly refresh = () => {
      if (!this.destroyed) {
        this.renderNode(this.node);
      }
    };

    private createEditButton(ownerDocument: Document) {
      if (!onEdit && !getOnEdit) {
        return null;
      }

      const button = ownerDocument.createElement("button");
      button.className = "mdw-opaque-edit";
      button.type = "button";
      button.textContent = messages.opaqueEditSource;
      button.addEventListener("click", this.handleEditClick);
      return button;
    }

    private readonly handleEditClick = () => {
      const currentOnEdit = resolveOnEdit();

      if (!currentOnEdit || this.destroyed || !this.view.editable) {
        return;
      }

      const requestedNode = this.node;
      const kind = readOpaqueKind(requestedNode);
      const source = readOpaqueSource(requestedNode);

      currentOnEdit({
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
      if (this.destroyed || !this.view.editable) {
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
      const kindLabel = messages.opaqueKindLabels[kind];
      const context = Object.freeze({ kind, kindLabel });

      this.dom.setAttribute("data-mdw-opaque-kind", kind);
      this.dom.setAttribute("aria-label", messages.opaqueSourceLabel(context));

      if (this.kindElement) {
        this.kindElement.textContent = kindLabel;
      }

      if (this.editButton) {
        const hasEditHandler = !!resolveOnEdit();
        const editDisabled = !hasEditHandler || !this.view.editable;
        this.editButton.hidden = !hasEditHandler;
        this.editButton.disabled = editDisabled;
        this.editButton.setAttribute("aria-disabled", editDisabled ? "true" : "false");
        this.editButton.setAttribute("aria-label", messages.opaqueEditSourceLabel(context));
      }

      this.sourceElement.textContent = readOpaqueSource(node);
    }
  };
}
