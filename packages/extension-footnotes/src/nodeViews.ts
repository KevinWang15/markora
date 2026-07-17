import {
  NodeSelection,
  Selection,
  type EditorView,
  type Node as ProseMirrorNode,
  type NodeType,
  type NodeView,
  type NodeViewConstructor,
  type PluginKey,
} from "markora/extension-api";
import type { FootnotesMessages } from "./messages";
import type { FootnoteIndex, FootnoteNodeTypes } from "./model";

export type FootnoteRuntimeStorage = {
  readonly refreshers: Set<() => void>;
  readonly scopeId: string;
};

let fallbackScopeCounter = 0;

export function createFootnoteScopeId(ownerDocument: Document) {
  try {
    const values = new Uint32Array(4);
    ownerDocument.defaultView?.crypto.getRandomValues(values);

    if (values.some((value) => value !== 0)) {
      return `mdw-footnotes-${[...values]
        .map((value) => value.toString(16).padStart(8, "0"))
        .join("")}`;
    }
  } catch {
    // A deterministic per-module fallback still keeps ordinary embedded
    // editors isolated when a constrained test DOM omits Web Crypto.
  }

  fallbackScopeCounter += 1;
  return `mdw-footnotes-scope-${fallbackScopeCounter}`;
}

function readLabel(node: ProseMirrorNode) {
  return typeof node.attrs.label === "string" ? node.attrs.label : "";
}

function isInside(target: EventTarget | null, element: HTMLElement) {
  const NodeConstructor = element.ownerDocument.defaultView?.Node;
  return !!NodeConstructor && target instanceof NodeConstructor && element.contains(target);
}

function safePosition(getPos: () => number | undefined) {
  try {
    const position = getPos();
    return typeof position === "number" ? position : null;
  } catch {
    return null;
  }
}

function referenceId(scopeId: string, order: number) {
  return `${scopeId}-reference-${order}`;
}

function definitionId(scopeId: string, order: number) {
  return `${scopeId}-definition-${order}`;
}

function dispatchSelection(view: EditorView, selection: Selection) {
  if (view.isDestroyed || view.composing || selection.eq(view.state.selection)) {
    return false;
  }

  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

function navigateToDefinition(view: EditorView, position: number) {
  const node = view.state.doc.nodeAt(position);

  if (!node) {
    return false;
  }

  const selection = Selection.findFrom(
    view.state.doc.resolve(position + 1),
    1,
    true,
  );
  const boundedSelection = selection
    && selection.from >= position + 1
    && selection.to <= position + node.nodeSize - 1
    ? selection
    : node.type.spec.selectable === false
      ? null
      : NodeSelection.create(view.state.doc, position);

  return boundedSelection ? dispatchSelection(view, boundedSelection) : false;
}

function navigateToReference(view: EditorView, position: number, nodeType: NodeType) {
  return view.state.doc.nodeAt(position)?.type === nodeType
    ? dispatchSelection(view, NodeSelection.create(view.state.doc, position))
    : false;
}

type CreateFootnoteNodeViewsOptions = Readonly<{
  indexKey: PluginKey<FootnoteIndex>;
  messages: FootnotesMessages;
  nodeTypes: FootnoteNodeTypes;
  storage: FootnoteRuntimeStorage;
}>;

export function createFootnoteReferenceNodeView(
  options: CreateFootnoteNodeViewsOptions,
): NodeViewConstructor {
  const { indexKey, messages, nodeTypes, storage } = options;

  class FootnoteReferenceNodeView implements NodeView {
    readonly dom: HTMLElement;

    private readonly action: HTMLElement;
    private destroyed = false;
    private node: ProseMirrorNode;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeTypes.reference) {
        throw new RangeError(
          `Footnote reference NodeView expected ${nodeTypes.reference.name}, received ${node.type.name}.`,
        );
      }

      this.node = node;
      const ownerDocument = view.dom.ownerDocument;
      this.dom = ownerDocument.createElement("sup");
      this.dom.className = "mdw-footnote-reference";
      this.dom.contentEditable = "false";
      this.dom.dataset.mdwFootnoteReference = "";
      this.action = ownerDocument.createElement("span");
      this.action.className = "mdw-footnote-reference__action";
      this.action.setAttribute("role", "link");
      this.action.tabIndex = 0;
      this.action.addEventListener("click", this.handleActivate);
      this.action.addEventListener("keydown", this.handleKeyDown);
      this.dom.append(this.action);
      storage.refreshers.add(this.refresh);
      this.render();
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeTypes.reference) {
        return false;
      }

      this.node = node;
      this.render();
      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
    }

    stopEvent(event: Event) {
      return isInside(event.target, this.action);
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      storage.refreshers.delete(this.refresh);
      this.action.removeEventListener("click", this.handleActivate);
      this.action.removeEventListener("keydown", this.handleKeyDown);
    }

    private readonly refresh = () => {
      if (!this.destroyed) {
        this.render();
      }
    };

    private readonly handleActivate = (event: Event) => {
      if (this.activate()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === "Enter" || event.key === " ")
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
      ) {
        this.activate();
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private activate() {
      // A reference inside a Markdown link is part of that link's accessible
      // name and interaction target. It must not steal pointer activation
      // from the focusable outer anchor while remaining keyboard-inert itself.
      if (this.node.marks.some((mark) => mark.type.name === "link")) {
        return false;
      }

      const position = safePosition(this.getPos);
      const index = indexKey.getState(this.view.state);
      const reference = position === null ? undefined : index?.referenceByPosition.get(position);
      if (
        reference?.definitionPosition === null
        || reference?.definitionPosition === undefined
      ) {
        return false;
      }

      // A resolved role-link consumes activation even when the destination is
      // already selected, so Space never falls through to page scrolling.
      navigateToDefinition(this.view, reference.definitionPosition);
      return true;
    }

    private render() {
      const position = safePosition(this.getPos);
      const index = indexKey.getState(this.view.state);
      const reference = position === null ? undefined : index?.referenceByPosition.get(position);
      const label = reference?.label ?? readLabel(this.node);
      const insideLink = this.node.marks.some((mark) => mark.type.name === "link");

      this.dom.dataset.mdwFootnoteLabel = label;
      this.action.setAttribute("role", insideLink ? "note" : "link");
      this.action.tabIndex = insideLink ? -1 : 0;

      if (!reference || position === null || !index) {
        this.dom.dataset.mdwFootnoteState = "unresolved";
        this.action.textContent = `[^${label}]`;
        this.action.setAttribute("aria-label", messages.referenceSourceLabel(label));
        this.action.setAttribute("aria-disabled", "true");
        this.action.removeAttribute("aria-controls");
        this.action.removeAttribute("id");
        return;
      }

      const order = index.referenceOrderByPosition.get(position)!;
      this.action.id = referenceId(storage.scopeId, order);
      this.action.textContent = messages.referenceText(reference.number);

      if (reference.definitionPosition === null) {
        this.dom.dataset.mdwFootnoteState = "unresolved";
        this.action.setAttribute("aria-disabled", "true");
        this.action.setAttribute(
          "aria-label",
          messages.unresolvedReferenceLabel(
            reference.label,
            reference.number,
            reference.occurrence,
          ),
        );
        this.action.removeAttribute("aria-controls");
      } else {
        this.dom.dataset.mdwFootnoteState = "resolved";
        this.action.removeAttribute("aria-disabled");
        this.action.setAttribute(
          "aria-label",
          messages.referenceLabel(
            reference.label,
            reference.number,
            reference.occurrence,
          ),
        );
        const definitionOrder = index.definitionOrderByPosition.get(
          reference.definitionPosition,
        );

        if (definitionOrder) {
          this.action.setAttribute(
            "aria-controls",
            definitionId(storage.scopeId, definitionOrder),
          );
        } else {
          this.action.removeAttribute("aria-controls");
        }
      }
    }
  }

  return (node, view, getPos) => new FootnoteReferenceNodeView(node, view, getPos);
}

export function createFootnoteDefinitionNodeView(
  options: CreateFootnoteNodeViewsOptions,
): NodeViewConstructor {
  const { indexKey, messages, nodeTypes, storage } = options;

  class FootnoteDefinitionNodeView implements NodeView {
    readonly contentDOM: HTMLElement;
    readonly dom: HTMLElement;

    private readonly backReferences: HTMLElement;
    private destroyed = false;
    private readonly header: HTMLElement;
    private readonly labelElement: HTMLElement;
    private node: ProseMirrorNode;
    private renderedBackReferenceSignature = "";

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeTypes.definition) {
        throw new RangeError(
          `Footnote definition NodeView expected ${nodeTypes.definition.name}, received ${node.type.name}.`,
        );
      }

      this.node = node;
      const ownerDocument = view.dom.ownerDocument;
      this.dom = ownerDocument.createElement("section");
      this.dom.className = "mdw-footnote-definition";
      this.dom.dataset.mdwFootnoteDefinition = "";
      this.dom.setAttribute("role", "group");
      this.header = ownerDocument.createElement("div");
      this.header.className = "mdw-footnote-definition__header";
      this.header.contentEditable = "false";
      this.labelElement = ownerDocument.createElement("span");
      this.labelElement.className = "mdw-footnote-definition__label";
      this.backReferences = ownerDocument.createElement("span");
      this.backReferences.className = "mdw-footnote-definition__backrefs";
      this.backReferences.setAttribute("role", "group");
      this.header.append(this.labelElement, this.backReferences);
      this.contentDOM = ownerDocument.createElement("div");
      this.contentDOM.className = "mdw-footnote-definition__content";
      this.contentDOM.dataset.mdwFootnoteContent = "";
      this.dom.append(this.header, this.contentDOM);
      storage.refreshers.add(this.refresh);
      this.render();
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeTypes.definition) {
        return false;
      }

      this.node = node;
      this.render();
      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
    }

    stopEvent(event: Event) {
      return isInside(event.target, this.header);
    }

    ignoreMutation(
      mutation: Parameters<NonNullable<NodeView["ignoreMutation"]>>[0],
    ) {
      if (mutation.type === "selection") {
        return false;
      }

      return mutation.target !== this.contentDOM
        && !this.contentDOM.contains(mutation.target);
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      storage.refreshers.delete(this.refresh);
      this.backReferences.replaceChildren();
    }

    private readonly refresh = () => {
      if (!this.destroyed) {
        this.render();
      }
    };

    private render() {
      const position = safePosition(this.getPos);
      const index = indexKey.getState(this.view.state);
      const definition = position === null ? undefined : index?.definitionByPosition.get(position);
      const label = definition?.label ?? readLabel(this.node);

      this.dom.dataset.mdwFootnoteLabel = label;

      if (!definition || position === null || !index) {
        this.dom.dataset.mdwFootnoteState = "unresolved";
        this.dom.removeAttribute("id");
        this.dom.setAttribute("aria-label", messages.definitionSourceLabel(label));
        this.labelElement.textContent = messages.definitionSourceLabel(label);
        this.backReferences.hidden = true;
        this.backReferences.replaceChildren();
        this.renderedBackReferenceSignature = "";
        return;
      }

      const order = index.definitionOrderByPosition.get(position)!;
      this.dom.id = definitionId(storage.scopeId, order);
      this.dom.dataset.mdwFootnoteState = definition.duplicate ? "duplicate" : "resolved";
      const accessibleLabel = definition.duplicate
        ? messages.duplicateDefinitionLabel(
            definition.label,
            definition.number,
            definition.occurrence,
          )
        : messages.definitionLabel(definition.label, definition.number);
      this.dom.setAttribute("aria-label", accessibleLabel);
      this.labelElement.textContent = definition.duplicate
        ? accessibleLabel
        : messages.definitionText(definition.label, definition.number);
      this.backReferences.setAttribute(
        "aria-label",
        messages.referencesLabel(definition.label),
      );

      const signature = [
        definition.label,
        definition.number,
        definition.occurrence,
        ...definition.referencePositions.map((referencePosition) => (
          index.referenceOrderByPosition.get(referencePosition) ?? 0
        )),
      ].join("|");

      if (signature === this.renderedBackReferenceSignature) {
        return;
      }

      this.renderedBackReferenceSignature = signature;
      this.backReferences.hidden = definition.referencePositions.length === 0;
      const buttons = definition.referencePositions.map((referencePosition, offset) => {
        const button = this.view.dom.ownerDocument.createElement("button");
        const occurrence = offset + 1;
        const referenceOrder = index.referenceOrderByPosition.get(referencePosition);
        button.className = "mdw-footnote-definition__backref";
        button.type = "button";
        button.textContent = messages.backReferenceText(occurrence);
        button.setAttribute(
          "aria-label",
          messages.backReferenceLabel(
            definition.label,
            definition.number,
            occurrence,
          ),
        );
        button.dataset.mdwFootnoteBackReference = String(occurrence);

        if (referenceOrder) {
          button.setAttribute(
            "aria-controls",
            referenceId(storage.scopeId, referenceOrder),
          );
        }

        button.addEventListener("click", (event) => {
          const currentPosition = safePosition(this.getPos);
          const currentIndex = indexKey.getState(this.view.state);
          const currentDefinition = currentPosition === null
            ? undefined
            : currentIndex?.definitionByPosition.get(currentPosition);
          const referencePosition = currentDefinition?.referencePositions[offset];

          if (
            referencePosition !== undefined
            && navigateToReference(this.view, referencePosition, nodeTypes.reference)
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
        return button;
      });
      this.backReferences.replaceChildren(...buttons);
    }
  }

  return (node, view, getPos) => new FootnoteDefinitionNodeView(node, view, getPos);
}
