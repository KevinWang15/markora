import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";

/** Keep semantic table DOM inside a local scroll surface. The schema serializer
 * still emits a plain table for clipboard/export; this wrapper is editor UI. */
export class TableView implements NodeView {
  readonly dom: HTMLDivElement;
  readonly contentDOM: HTMLTableSectionElement;
  private readonly table: HTMLTableElement;

  constructor(private node: ProseMirrorNode, view: EditorView) {
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("div");
    this.dom.className = "mdw-table-scroll";
    this.table = this.dom.appendChild(doc.createElement("table"));
    this.contentDOM = this.table.appendChild(doc.createElement("tbody"));
    this.updateColumns();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateColumns();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type === "attributes"
      && (mutation.target === this.dom || mutation.target === this.table);
  }

  private updateColumns() {
    let columns = 0;
    this.node.firstChild?.forEach(cell => { columns += cell.attrs.colspan ?? 1; });
    this.table.style.setProperty("--_mdw-table-columns", String(Math.max(1, columns)));
  }
}
