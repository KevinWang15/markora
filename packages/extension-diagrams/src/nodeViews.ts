import type {
  EditorView,
  Node as ProseMirrorNode,
  NodeType,
  NodeView,
  NodeViewConstructor,
} from "markora/extension-api";
import type { DiagramMessages } from "./messages";
import {
  DIAGRAM_MAX_SOURCE_BYTES,
  type DiagramKind,
} from "./source";
import type {
  DiagramRenderManager,
  DiagramRenderRegistration,
  DiagramRenderTarget,
  InternalDiagramRenderSnapshot,
} from "./renderer";

export type DiagramNodeViewController = Readonly<{
  readonly info: string;
  readonly kind: DiagramKind;
  readonly marker: HTMLElement;
  readonly node: ProseMirrorNode;
  readonly source: string;
  getPosition(): number | null;
  getRenderSnapshot(): InternalDiagramRenderSnapshot;
  isCurrent(): boolean;
  refresh(): boolean;
  requestEdit(): boolean;
  retryPreview(): boolean;
  togglePreview(): boolean;
}>;

export type CreateDiagramNodeViewOptions = Readonly<{
  manager: DiagramRenderManager;
  messages: DiagramMessages;
  nodeType: NodeType;
  onCreate?(controller: DiagramNodeViewController): void;
  onDestroy?(controller: DiagramNodeViewController): void;
  onEditSource?(controller: DiagramNodeViewController): void;
  readInfo(node: ProseMirrorNode): string;
  readKind(node: ProseMirrorNode): DiagramKind;
  reportError?(error: unknown, contribution: string): void;
}>;

let accessibleId = 0;

function safePosition(view: EditorView, getPos: () => number | undefined, node: ProseMirrorNode) {
  if (view.isDestroyed) return null;
  try {
    const position = getPos();
    return typeof position === "number" && view.state.doc.nodeAt(position) === node
      ? position
      : null;
  } catch {
    return null;
  }
}

function sourceSnapshot(kind: DiagramKind, info: string, source: string): InternalDiagramRenderSnapshot {
  return Object.freeze({
    errorCode: null,
    info,
    kind,
    previewRequested: false,
    source,
    status: "source" as const,
  });
}

function isInside(target: EventTarget | null, element: HTMLElement) {
  const NodeConstructor = element.ownerDocument.defaultView?.Node;
  return Boolean(NodeConstructor && target instanceof NodeConstructor && element.contains(target));
}

export function createDiagramNodeView(options: CreateDiagramNodeViewOptions): NodeViewConstructor {
  const {
    manager,
    messages,
    nodeType,
    onCreate,
    onDestroy,
    onEditSource,
    readInfo,
    readKind,
    reportError,
  } = options;

  class DiagramNodeView implements NodeView, DiagramRenderTarget {
    readonly contentDOM: HTMLElement;
    readonly dom: HTMLElement;
    readonly viewDom: HTMLElement;

    private readonly actions: HTMLElement;
    private readonly controller: DiagramNodeViewController;
    private destroyed = false;
    private readonly editButton: HTMLButtonElement | null;
    private readonly infoElement: HTMLElement;
    private readonly kindElement: HTMLElement;
    private nodeValue: ProseMirrorNode;
    private registration: DiagramRenderRegistration | null = null;
    private renderSnapshot: InternalDiagramRenderSnapshot;
    private renderedUiKey: string | null = null;
    private readonly retryButton: HTMLButtonElement;
    private readonly sourceLabelElement: HTMLElement;
    private readonly sourceShell: HTMLElement;
    private readonly status: HTMLElement;
    private readonly toggleButton: HTMLButtonElement;
    readonly preview: HTMLElement;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeType) {
        throw new RangeError(`Diagram NodeView expected ${nodeType.name}, received ${node.type.name}.`);
      }
      this.nodeValue = node;
      const kind = readKind(node);
      const info = readInfo(node);
      const source = node.textContent;
      this.renderSnapshot = sourceSnapshot(kind, info, source);
      const ownerDocument = view.dom.ownerDocument;
      accessibleId += 1;
      const id = accessibleId;
      this.viewDom = view.dom;

      this.dom = ownerDocument.createElement("div");
      this.dom.className = "mdw-diagram";
      this.dom.dataset.mdwDiagram = "";
      this.dom.dataset.mdwDiagramKind = kind;
      this.dom.setAttribute("role", "group");

      const header = ownerDocument.createElement("div");
      header.className = "mdw-diagram__header";
      header.contentEditable = "false";
      this.kindElement = ownerDocument.createElement("span");
      this.kindElement.className = "mdw-diagram__kind";
      this.kindElement.id = `mdw-diagram-kind-${id}`;
      this.kindElement.textContent = messages.kindLabel(kind);
      this.infoElement = ownerDocument.createElement("code");
      this.infoElement.className = "mdw-diagram__info";
      this.infoElement.id = `mdw-diagram-info-${id}`;
      this.infoElement.textContent = info;
      header.append(this.kindElement, this.infoElement);

      this.actions = ownerDocument.createElement("span");
      this.actions.className = "mdw-diagram__actions";
      const makeButton = (label: string, action: () => void) => {
        const button = ownerDocument.createElement("button");
        button.type = "button";
        button.className = "mdw-diagram__action";
        button.textContent = label;
        button.addEventListener("click", action);
        this.actions.append(button);
        return button;
      };
      this.editButton = onEditSource
        ? makeButton(messages.editSource, () => { this.requestEdit(); })
        : null;
      this.toggleButton = makeButton(messages.showPreview, () => { this.togglePreview(); });
      this.retryButton = makeButton(messages.retryPreview, () => { this.retryPreview(); });
      header.append(this.actions);
      this.dom.append(header);

      this.sourceShell = ownerDocument.createElement("pre");
      this.sourceShell.className = "mdw-diagram__source-shell";
      this.sourceLabelElement = ownerDocument.createElement("span");
      this.sourceLabelElement.className = "mdw-diagram__visually-hidden";
      this.sourceLabelElement.id = `mdw-diagram-source-label-${id}`;
      this.sourceLabelElement.textContent = messages.sourceLabel(kind, info);
      this.contentDOM = ownerDocument.createElement("code");
      this.contentDOM.className = "mdw-diagram__source";
      this.contentDOM.dataset.mdwDiagramSource = "";
      this.contentDOM.dir = "auto";
      this.contentDOM.id = `mdw-diagram-source-${id}`;
      this.sourceShell.append(this.sourceLabelElement, this.contentDOM);
      this.dom.append(this.sourceShell);
      this.dom.setAttribute("aria-labelledby", [
        this.kindElement.id,
        this.sourceLabelElement.id,
        this.infoElement.id,
        this.contentDOM.id,
      ].join(" "));

      this.preview = ownerDocument.createElement("div");
      this.preview.className = "mdw-diagram__preview";
      this.preview.dataset.mdwDiagramPreview = "";
      this.preview.contentEditable = "false";
      this.preview.setAttribute("aria-hidden", "true");
      this.preview.setAttribute("aria-label", messages.previewLabel(kind));
      this.preview.setAttribute("inert", "");
      this.preview.hidden = true;
      this.dom.append(this.preview);

      this.status = ownerDocument.createElement("p");
      this.status.className = "mdw-diagram__status";
      this.status.contentEditable = "false";
      this.status.setAttribute("aria-live", "polite");
      this.status.setAttribute("aria-atomic", "true");
      this.dom.append(this.status);

      const thisView = this;
      this.controller = Object.freeze({
        get info() { return readInfo(thisView.nodeValue); },
        get kind() { return readKind(thisView.nodeValue); },
        marker: this.dom,
        get node() { return thisView.nodeValue; },
        get source() { return thisView.nodeValue.textContent; },
        getPosition: () => this.getPosition(),
        getRenderSnapshot: () => this.renderSnapshot,
        isCurrent: () => this.isCurrent(readKind(this.nodeValue), readInfo(this.nodeValue), this.nodeValue.textContent),
        refresh: () => this.refresh(),
        requestEdit: () => this.requestEdit(),
        retryPreview: () => this.retryPreview(),
        togglePreview: () => this.togglePreview(),
      });

      this.ensureRegistration();
      this.renderUi();
      onCreate?.(this.controller);
    }

    clearPreview() {
      this.preview.replaceChildren();
      this.preview.hidden = true;
    }

    commitPreview(fragment: DocumentFragment) {
      const kind = readKind(this.nodeValue);
      const info = readInfo(this.nodeValue);
      if (this.destroyed || !this.isCurrent(kind, info, this.nodeValue.textContent)) return;
      this.preview.replaceChildren(fragment);
      this.preview.hidden = false;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.registration?.destroy();
      this.registration = null;
      onDestroy?.(this.controller);
    }

    deselectNode() {
      this.dom.classList.remove("mdw-diagram--selected");
    }

    getPosition() {
      return safePosition(this.view, this.getPos, this.nodeValue);
    }

    ignoreMutation(mutation: Parameters<NonNullable<NodeView["ignoreMutation"]>>[0]) {
      return !this.contentDOM.contains(mutation.target);
    }

    isComposing() {
      return this.view.composing;
    }

    isCurrent(kind: DiagramKind, info: string, source: string) {
      return !this.destroyed
        && readKind(this.nodeValue) === kind
        && readInfo(this.nodeValue) === info
        && this.nodeValue.textContent === source
        && this.getPosition() !== null;
    }

    refresh() {
      if (this.destroyed) return false;
      this.adoptEqualCurrentNode();
      this.renderUi();
      return true;
    }

    requestEdit() {
      if (!onEditSource || this.destroyed || !this.view.editable || this.view.composing || this.getPosition() === null) return false;
      try { onEditSource(this.controller); return true; }
      catch (error) { reportError?.(error, "source-editor"); return false; }
    }

    selectNode() {
      this.dom.classList.add("mdw-diagram--selected");
    }

    retryPreview() {
      if (this.destroyed || !this.view.editable || this.view.composing || this.getPosition() === null) return false;
      return this.registration?.retry() ?? false;
    }

    setRenderSnapshot(next: InternalDiagramRenderSnapshot) {
      if (this.destroyed) return;
      this.renderSnapshot = next;
      this.renderUi();
    }

    stopEvent(event: Event) {
      return isInside(event.target, this.actions);
    }

    togglePreview() {
      if (this.destroyed || !this.view.editable || this.view.composing || this.getPosition() === null) return false;
      return this.registration?.toggle() ?? false;
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType) return false;
      this.nodeValue = node;
      const kind = readKind(node);
      const info = readInfo(node);
      this.kindElement.textContent = messages.kindLabel(kind);
      this.infoElement.textContent = info;
      this.sourceLabelElement.textContent = messages.sourceLabel(kind, info);
      this.preview.setAttribute("aria-label", messages.previewLabel(kind));
      this.dom.dataset.mdwDiagramKind = kind;
      this.ensureRegistration();
      this.registration?.update(kind, info, node.textContent);
      this.renderUi();
      return true;
    }

    private ensureRegistration() {
      if (!this.registration) {
        const kind = readKind(this.nodeValue);
        const info = readInfo(this.nodeValue);
        this.registration = manager.register(this, kind, info, this.nodeValue.textContent);
        this.renderSnapshot = this.registration.getSnapshot();
      }
    }

    private adoptEqualCurrentNode() {
      if (this.view.isDestroyed) return false;
      let position: number | undefined;
      try { position = this.getPos(); } catch { return false; }
      if (typeof position !== "number") return false;
      const current = this.view.state.doc.nodeAt(position);
      if (current === this.nodeValue || current?.type !== nodeType || !current.eq(this.nodeValue)) return false;
      this.nodeValue = current;
      this.registration?.destroy();
      this.registration = null;
      this.clearPreview();
      this.renderSnapshot = sourceSnapshot(readKind(current), readInfo(current), current.textContent);
      this.ensureRegistration();
      this.renderedUiKey = null;
      return true;
    }

    private renderUi() {
      const editable = this.view.editable && !this.view.composing && !this.destroyed;
      const { errorCode, kind, previewRequested, status } = this.renderSnapshot;
      const position = this.getPosition();
      const selection = this.view.state.selection;
      const sourceSelectionActive = position !== null
        // Entering source owns its layout until the selection leaves. A range
        // starting in prose must not expand the preview while the mouse drags.
        && selection.anchor >= position + 1
        && selection.anchor <= position + this.nodeValue.nodeSize - 1;
      const uiKey = [editable, errorCode, kind, previewRequested, sourceSelectionActive, status]
        .join("|");
      if (uiKey === this.renderedUiKey) return;
      this.renderedUiKey = uiKey;
      this.dom.dataset.mdwDiagramState = status;
      this.dom.classList.toggle("mdw-diagram--preview", status === "rendered");
      this.sourceShell.classList.toggle(
        "mdw-diagram__source-shell--visually-hidden",
        status === "rendered" && !sourceSelectionActive,
      );
      if (this.editButton) this.editButton.disabled = !editable;
      this.toggleButton.disabled = !editable;
      this.retryButton.disabled = !editable;
      this.toggleButton.textContent = previewRequested ? messages.showSource : messages.showPreview;
      this.retryButton.hidden = status !== "error";
      const statusText = status === "rendering" || status === "queued"
        ? messages.previewLoading
        : status === "error"
          ? errorCode === "renderer-missing" ? messages.rendererUnavailable(kind) : messages.previewFailed
          : status === "source-too-large"
            ? messages.sourceTooLargeDiagnostic(DIAGRAM_MAX_SOURCE_BYTES)
            : "";
      if (this.status.textContent !== statusText) this.status.textContent = statusText;
      this.status.hidden = !statusText;
    }
  }

  return (node, view, getPos) => new DiagramNodeView(node, view, getPos);
}
