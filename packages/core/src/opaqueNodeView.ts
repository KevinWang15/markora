import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { NodeView, EditorView } from "prosemirror-view";
import { createAtomView, type AtomControl, type AtomView, type AtomViewContext } from "./atomView";
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

function updateSource(
  context: AtomViewContext,
  requestedKind: OpaqueMarkdownKind,
  requestedSource: string,
  nextSource: string,
) {
  const { node, view, getPos, signal } = context;
  if (signal.aborted || !view.editable) return false;
  let position: number | undefined;
  try {
    position = getPos();
  } catch {
    return false;
  }
  if (typeof position !== "number") return false;
  const currentNode = view.state.doc.nodeAt(position);
  if (currentNode !== node || readOpaqueKind(currentNode) !== requestedKind
    || readOpaqueSource(currentNode) !== requestedSource) return false;
  if (nextSource === requestedSource) return true;
  view.dispatch(view.state.tr.setNodeMarkup(
    position, node.type, { ...node.attrs, source: nextSource }, node.marks,
  ));
  return true;
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
  const views = new Set<AtomView>();
  const resolveOnEdit = () => getOnEdit ? getOnEdit() : onEdit;
  const labelContext = (node: ProseMirrorNode) => {
    const kind = readOpaqueKind(node);
    return Object.freeze({ kind, kindLabel: messages.opaqueKindLabels[kind] });
  };
  const controls: readonly AtomControl[] = onEdit || getOnEdit ? [{
    className: "mdw-opaque-edit",
    label: messages.opaqueEditSource,
    ariaLabel: ({ node }) => messages.opaqueEditSourceLabel(labelContext(node)),
    hidden: () => !resolveOnEdit(),
    onClick(context) {
      const kind = readOpaqueKind(context.node);
      const source = readOpaqueSource(context.node);
      resolveOnEdit()?.({
        kind,
        source,
        update: nextSource => updateSource(context, kind, source, nextSource),
      });
    },
  }] : [];

  return class OpaqueNodeView implements NodeView {
    static refresh() {
      for (const atom of [...views]) atom.refresh();
    }

    readonly dom: HTMLElement;

    constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
      if (node.type !== nodeType) {
        throw new RangeError(`Opaque node view expected ${nodeType.name}, received ${node.type.name}.`);
      }

      let atom: AtomView | undefined;
      atom = createAtomView(node, view, getPos, {
        display,
        className: `mdw-opaque-node mdw-opaque-${display}`,
        label: current => messages.opaqueSourceLabel(labelContext(current)),
        controls,
        render(context) {
          const ownerDocument = context.dom.ownerDocument;
          const kindElement = context.header ? ownerDocument.createElement("span") : null;
          if (context.header && kindElement) {
            context.header.classList.add("mdw-opaque-header");
            kindElement.className = "mdw-opaque-kind";
            context.header.prepend(kindElement);
          }
          const sourceElement = ownerDocument.createElement("code");
          if (display === "block") {
            const pre = ownerDocument.createElement("pre");
            pre.className = "mdw-opaque-source";
            pre.append(sourceElement);
            context.content.append(pre);
          } else {
            sourceElement.className = "mdw-opaque-source";
            context.content.append(sourceElement);
          }
          const renderNode = ({ node, dom }: AtomViewContext) => {
            const { kind, kindLabel } = labelContext(node);
            dom.setAttribute("data-mdw-opaque-kind", kind);
            if (kindElement) kindElement.textContent = kindLabel;
            sourceElement.textContent = readOpaqueSource(node);
          };
          renderNode(context);
          return {
            update: renderNode,
            destroy() {
              if (atom) views.delete(atom);
            },
          };
        },
      });
      this.dom = atom.dom;
      views.add(atom);
      return atom;
    }
  };
}
