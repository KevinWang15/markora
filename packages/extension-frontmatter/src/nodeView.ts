import {
  MarkdownEditorExtensionError,
  Selection,
  TextSelection,
  closeHistory,
  type EditorView,
  type Node as ProseMirrorNode,
  type NodeType,
  type NodeView,
  type NodeViewConstructor,
  type Transaction,
} from "markora/extension-api";
import type { FrontmatterEditRequest } from "./index";
import type { FrontmatterMessages } from "./messages";
import { analyzeFrontmatterSource, hasFrontmatterEnvelope } from "./source";

type CreateFrontmatterNodeViewOptions = Readonly<{
  dispatch(transaction: Transaction): boolean;
  messages: FrontmatterMessages;
  nodeType: NodeType;
  onEditSource(request: FrontmatterEditRequest): void;
  refreshers: Set<() => void>;
  reportError(error: unknown, contribution?: string): void;
}>;

function readSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : "";
}

function isInside(target: EventTarget | null, element: HTMLElement) {
  const NodeConstructor = element.ownerDocument.defaultView?.Node;
  return !!NodeConstructor && target instanceof NodeConstructor && element.contains(target);
}

export function createFrontmatterNodeView(
  options: CreateFrontmatterNodeViewOptions,
): NodeViewConstructor {
  const {
    dispatch,
    messages,
    nodeType,
    onEditSource,
    refreshers,
    reportError,
  } = options;

  class FrontmatterNodeView implements NodeView {
    readonly dom: HTMLElement;

    private destroyed = false;
    private node: ProseMirrorNode;
    private readonly editButton: HTMLButtonElement;
    private renderedDisabled: boolean | null = null;
    private renderedSource: string | null = null;
    private readonly sourceElement: HTMLElement;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeType) {
        throw new RangeError(
          `Front matter NodeView expected ${nodeType.name}, received ${node.type.name}.`,
        );
      }

      this.node = node;
      const ownerDocument = view.dom.ownerDocument;
      this.dom = ownerDocument.createElement("div");
      this.dom.className = "mdw-frontmatter";
      this.dom.contentEditable = "false";
      this.dom.dataset.mdwFrontmatter = "yaml";
      this.dom.dataset.mdwFrontmatterLabel = messages.kindLabel;
      this.dom.setAttribute("aria-label", messages.sourceLabel);
      this.dom.setAttribute("role", "region");

      const header = ownerDocument.createElement("div");
      header.className = "mdw-frontmatter__header";
      const kind = ownerDocument.createElement("span");
      kind.className = "mdw-frontmatter__kind";
      kind.textContent = messages.kindLabel;
      this.editButton = ownerDocument.createElement("button");
      this.editButton.className = "mdw-frontmatter__edit";
      this.editButton.type = "button";
      this.editButton.textContent = messages.editSource;
      this.editButton.addEventListener("click", this.handleEdit);
      this.editButton.addEventListener("keydown", this.handleBoundaryKeyDown);
      header.append(kind, this.editButton);

      const pre = ownerDocument.createElement("pre");
      pre.className = "mdw-frontmatter__pre";
      this.sourceElement = ownerDocument.createElement("code");
      this.sourceElement.className = "mdw-frontmatter__source";
      this.sourceElement.dataset.mdwFrontmatterSource = "";
      pre.append(this.sourceElement);
      this.dom.append(header, pre);
      this.render(node);
      refreshers.add(this.refresh);
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType) {
        return false;
      }

      this.node = node;
      this.render(node);
      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
    }

    stopEvent(event: Event) {
      return isInside(event.target, this.editButton);
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
      this.editButton.removeEventListener("click", this.handleEdit);
      this.editButton.removeEventListener("keydown", this.handleBoundaryKeyDown);
    }

    private readonly refresh = () => {
      if (!this.destroyed) {
        this.render(this.node);
      }
    };

    private readonly handleEdit = () => {
      if (this.destroyed || !this.view.editable || this.view.composing) {
        return;
      }

      const requestedNode = this.node;
      const requestedSource = readSource(requestedNode);
      const request: FrontmatterEditRequest = Object.freeze({
        diagnostics: analyzeFrontmatterSource(requestedSource, messages),
        remove: () => this.removeRequestedNode(requestedNode, requestedSource),
        source: requestedSource,
        update: (nextSource) => this.updateRequestedNode(
          requestedNode,
          requestedSource,
          nextSource,
        ),
      });

      try {
        onEditSource(request);
      } catch (error) {
        reportError(error, "edit-source");
      }
    };

    private readonly handleBoundaryKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "ArrowDown"
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || this.destroyed
        || !this.view.editable
        || this.view.composing
      ) {
        return;
      }

      let position: number | undefined;

      try {
        position = this.getPos();
      } catch {
        return;
      }

      if (
        typeof position !== "number"
        || this.view.state.doc.nodeAt(position) !== this.node
      ) {
        return;
      }

      const after = position + this.node.nodeSize;
      const nextSelection = Selection.findFrom(
        this.view.state.doc.resolve(after),
        1,
        true,
      );
      let transaction = this.view.state.tr;

      if (nextSelection) {
        transaction = transaction.setSelection(nextSelection);
      } else {
        const paragraph = nodeType.schema.nodes.paragraph;

        if (!paragraph) {
          return;
        }

        transaction = transaction.insert(after, paragraph.create());
        transaction = transaction.setSelection(TextSelection.create(
          transaction.doc,
          after + 1,
        ));
      }

      if (!dispatch(transaction.scrollIntoView())) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.view.focus();
    };

    private resolveRequestedNode(
      requestedNode: ProseMirrorNode,
      requestedSource: string,
    ) {
      if (this.destroyed || !this.view.editable || this.view.composing) {
        return null;
      }

      let position: number | undefined;

      try {
        position = this.getPos();
      } catch {
        return null;
      }

      if (typeof position !== "number") {
        return null;
      }

      const currentNode = this.view.state.doc.nodeAt(position);

      return currentNode === requestedNode
        && currentNode.type === nodeType
        && readSource(currentNode) === requestedSource
        ? { currentNode, position }
        : null;
    }

    private updateRequestedNode(
      requestedNode: ProseMirrorNode,
      requestedSource: string,
      nextSource: string,
    ) {
      if (typeof nextSource !== "string") {
        throw new TypeError("Front matter source must be a string.");
      }

      const current = this.resolveRequestedNode(requestedNode, requestedSource);

      if (!current) {
        return false;
      }

      if (nextSource === requestedSource) {
        return true;
      }

      if (!hasFrontmatterEnvelope(nextSource)) {
        reportError(new MarkdownEditorExtensionError({
          code: "EXTENSION_FRONTMATTER_INVALID_SOURCE",
          contribution: "source-edit",
          extension: "markora-extension-frontmatter",
          message: messages.invalidStructureDiagnostic,
          phase: "node-view",
        }));
        return false;
      }

      return dispatch(closeHistory(this.view.state.tr.setNodeMarkup(
        current.position,
        nodeType,
        { ...current.currentNode.attrs, source: nextSource },
        current.currentNode.marks,
      )));
    }

    private removeRequestedNode(
      requestedNode: ProseMirrorNode,
      requestedSource: string,
    ) {
      const current = this.resolveRequestedNode(requestedNode, requestedSource);

      return current
        ? dispatch(closeHistory(this.view.state.tr.delete(
            current.position,
            current.position + current.currentNode.nodeSize,
          )))
        : false;
    }

    private render(node: ProseMirrorNode) {
      const source = readSource(node);

      if (source !== this.renderedSource) {
        this.sourceElement.textContent = source;
        this.renderedSource = source;
      }

      const disabled = !this.view.editable || this.view.composing;

      if (disabled !== this.renderedDisabled) {
        this.editButton.disabled = disabled;
        this.editButton.setAttribute("aria-disabled", disabled ? "true" : "false");
        this.renderedDisabled = disabled;
      }
    }
  }

  return (
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) => new FrontmatterNodeView(node, view, getPos);
}
