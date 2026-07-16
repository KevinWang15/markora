import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

type TaskListItemViewConstructor = new (
  node: ProseMirrorNode,
  view: EditorView,
) => NodeView;

function isTask(node: ProseMirrorNode) {
  return typeof node.attrs.checked === "boolean";
}

function getTaskName(node: ProseMirrorNode) {
  return node.textBetween(0, node.content.size, " ").trim() || "Task";
}

export function createTaskListItemViewClass(nodeType: NodeType): TaskListItemViewConstructor {
  return class TaskListItemView implements NodeView {
    readonly contentDOM: HTMLElement;
    readonly dom: HTMLLIElement;

    private readonly control: HTMLButtonElement | null;
    private node: ProseMirrorNode;

    constructor(node: ProseMirrorNode, private readonly view: EditorView) {
      if (node.type !== nodeType) {
        throw new RangeError(`Task list-item view expected ${nodeType.name}, received ${node.type.name}.`);
      }

      this.node = node;
      const ownerDocument = view.dom.ownerDocument;
      this.dom = ownerDocument.createElement("li");

      if (isTask(node)) {
        this.control = ownerDocument.createElement("button");
        this.control.className = "mdw-task-checkbox";
        this.control.contentEditable = "false";
        this.control.dataset.mdwTaskControl = "true";
        this.control.setAttribute("role", "checkbox");
        this.control.type = "button";

        this.contentDOM = ownerDocument.createElement("div");
        this.contentDOM.className = "mdw-task-content";
        this.dom.append(this.control, this.contentDOM);
        this.renderTask(node);
      } else {
        this.control = null;
        this.contentDOM = this.dom;
      }
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType || isTask(node) !== isTask(this.node)) {
        return false;
      }

      this.node = node;

      if (this.control) {
        this.renderTask(node);
      }

      return true;
    }

    private renderTask(node: ProseMirrorNode) {
      if (!this.control) {
        return;
      }

      const checked = node.attrs.checked === true;
      const editable = this.view.editable;
      this.dom.dataset.task = "true";
      this.dom.dataset.checked = checked ? "true" : "false";
      this.control.setAttribute("aria-checked", checked ? "true" : "false");
      this.control.setAttribute("aria-disabled", editable ? "false" : "true");
      this.control.setAttribute("aria-label", getTaskName(node));
      this.control.disabled = !editable;
      this.control.tabIndex = editable ? 0 : -1;
    }
  };
}
