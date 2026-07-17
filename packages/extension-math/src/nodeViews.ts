import type {
  EditorView,
  Node as ProseMirrorNode,
  NodeType,
  NodeView,
  NodeViewConstructor,
} from "markora/extension-api";
import type { MathMessages } from "./messages";
import {
  MATH_MAX_SOURCE_BYTES,
  type MathKind,
  type MathRenderManager,
  type MathRenderRegistration,
  type MathRenderSnapshot,
  type MathRenderTarget,
} from "./renderer";

export type MathNodeViewController = Readonly<{
  readonly kind: MathKind;
  readonly marker: HTMLElement;
  readonly node: ProseMirrorNode;
  readonly source: string;
  getPosition(): number | null;
  getRenderSnapshot(): MathRenderSnapshot;
  isCurrent(): boolean;
  refresh(): boolean;
  requestEdit(): boolean;
  retryPreview(): boolean;
  togglePreview(): boolean;
}>;

export type CreateMathNodeViewOptions = Readonly<{
  kind: MathKind;
  manager: MathRenderManager;
  messages: MathMessages;
  nodeType: NodeType;
  onCreate?(controller: MathNodeViewController): void;
  onDestroy?(controller: MathNodeViewController): void;
  onEditSource?(controller: MathNodeViewController): void;
  readSource(node: ProseMirrorNode): string;
  reportError?(error: unknown, contribution: string): void;
}>;

let accessibleSourceId = 0;

function canonicalShell(kind: MathKind, source: string) {
  return kind === "inline"
    ? `$${source}$`
    : `$$\n${source}\n$$`;
}

function isInside(target: EventTarget | null, element: HTMLElement) {
  const NodeConstructor = element.ownerDocument.defaultView?.Node;
  return Boolean(
    NodeConstructor
    && target instanceof NodeConstructor
    && element.contains(target),
  );
}

function safePosition(
  view: EditorView,
  getPos: () => number | undefined,
  node: ProseMirrorNode,
) {
  if (view.isDestroyed) {
    return null;
  }

  try {
    const position = getPos();

    return typeof position === "number" && view.state.doc.nodeAt(position) === node
      ? position
      : null;
  } catch {
    return null;
  }
}

function initialSnapshot(kind: MathKind, source: string): MathRenderSnapshot {
  return Object.freeze({
    errorCode: null,
    kind,
    previewRequested: false,
    source,
    status: "source",
  });
}

export function createMathNodeView(
  options: CreateMathNodeViewOptions,
): NodeViewConstructor {
  const {
    kind,
    manager,
    messages,
    nodeType,
    onCreate,
    onDestroy,
    onEditSource,
    readSource,
    reportError,
  } = options;

  class MathNodeView implements NodeView, MathRenderTarget {
    readonly dom: HTMLElement;
    readonly preview: HTMLElement;
    readonly viewDom: HTMLElement;

    private readonly actions: HTMLElement;
    private readonly controller: MathNodeViewController;
    private destroyed = false;
    private readonly editButton: HTMLButtonElement | null;
    private readonly header: HTMLElement;
    private readonly kindElement: HTMLElement;
    private nodeValue: ProseMirrorNode;
    private readonly retryButton: HTMLButtonElement;
    private readonly sourceElement: HTMLElement;
    private readonly sourceShell: HTMLElement;
    private readonly srSource: HTMLElement;
    private readonly status: HTMLElement;
    private registration!: MathRenderRegistration;
    private renderSnapshot: MathRenderSnapshot;
    private renderedDisabled: boolean | null = null;
    private renderedSelected = false;
    private renderedUiKey: string | null = null;
    private readonly toggleButton: HTMLButtonElement;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
    ) {
      if (node.type !== nodeType) {
        throw new RangeError(
          `Math NodeView expected ${nodeType.name}, received ${node.type.name}.`,
        );
      }

      this.nodeValue = node;
      const source = readSource(node);
      this.renderSnapshot = initialSnapshot(kind, source);
      const ownerDocument = view.dom.ownerDocument;
      this.viewDom = view.dom;
      this.dom = ownerDocument.createElement(kind === "inline" ? "span" : "div");
      this.dom.className = `mdw-math mdw-math--${kind}`;
      this.dom.contentEditable = "false";
      this.dom.dataset.mdwMath = "";
      this.dom.dataset.mdwMathKind = kind;
      this.dom.dataset.mdwMathState = "source";
      this.dom.setAttribute("role", "group");

      this.header = ownerDocument.createElement("span");
      this.header.className = "mdw-math__header";
      this.header.contentEditable = "false";
      this.kindElement = ownerDocument.createElement("span");
      this.kindElement.className = "mdw-math__kind";
      this.kindElement.textContent = kind === "inline"
        ? messages.inlineKindLabel
        : messages.blockKindLabel;
      this.dom.setAttribute("aria-label", this.kindElement.textContent);

      this.actions = ownerDocument.createElement("span");
      this.actions.className = "mdw-math__actions";
      this.actions.addEventListener("keydown", this.handleActionKeyDown);

      if (onEditSource) {
        this.editButton = this.createActionButton(
          "edit",
          messages.editSource,
          this.handleEdit,
        );
        this.actions.append(this.editButton);
      } else {
        this.editButton = null;
      }

      this.toggleButton = this.createActionButton(
        "toggle",
        messages.showPreview,
        this.handleToggle,
      );
      this.toggleButton.setAttribute("aria-pressed", "false");
      this.retryButton = this.createActionButton(
        "retry",
        messages.retryPreview,
        this.handleRetry,
      );
      this.retryButton.hidden = true;
      this.actions.append(this.toggleButton, this.retryButton);
      this.header.append(this.kindElement, this.actions);

      this.sourceShell = ownerDocument.createElement(kind === "inline" ? "span" : "pre");
      this.sourceShell.className = "mdw-math__source-shell";
      this.sourceElement = ownerDocument.createElement("code");
      this.sourceElement.className = "mdw-math__source";
      this.sourceElement.dataset.mdwMathSource = "";
      this.sourceElement.setAttribute("aria-hidden", "true");
      this.sourceShell.append(this.sourceElement);

      this.preview = ownerDocument.createElement(kind === "inline" ? "span" : "div");
      this.preview.className = "mdw-math__preview";
      this.preview.dataset.mdwMathPreview = "";
      this.preview.hidden = true;
      this.preview.inert = true;
      this.preview.setAttribute("aria-hidden", "true");
      this.preview.setAttribute("aria-label", messages.previewLabel(kind));

      this.status = ownerDocument.createElement("span");
      this.status.className = "mdw-math__status";
      this.status.dataset.mdwMathStatus = "";
      this.status.hidden = true;
      this.status.setAttribute("aria-atomic", "true");
      this.status.setAttribute("aria-live", "polite");
      this.status.setAttribute("role", "status");

      this.srSource = ownerDocument.createElement("span");
      this.srSource.className = "mdw-math__sr-source";
      this.srSource.setAttribute("role", "math");
      accessibleSourceId += 1;
      this.srSource.id = `mdw-math-source-${accessibleSourceId}`;
      this.dom.append(
        this.header,
        this.sourceShell,
        this.preview,
        this.status,
        this.srSource,
      );

      const instance = this;
      this.controller = Object.freeze({
        get kind() {
          return kind;
        },
        get marker() {
          return instance.dom;
        },
        get node() {
          return instance.nodeValue;
        },
        get source() {
          return readSource(instance.nodeValue);
        },
        getPosition: () => instance.getCurrentPosition(),
        getRenderSnapshot: () => instance.getRenderSnapshot(),
        isCurrent: () => instance.isCurrent(kind, readSource(instance.nodeValue)),
        refresh: () => instance.refresh(),
        requestEdit: () => instance.requestEdit(),
        retryPreview: () => instance.retryPreview(),
        togglePreview: () => instance.togglePreview(),
      });

      try {
        this.renderSource(source);
        this.registration = manager.register(this, kind, source);
        this.render(this.registration.snapshot());
        onCreate?.(this.controller);
      } catch (error) {
        this.cleanup(false);
        throw error;
      }
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType || this.destroyed) {
        return false;
      }

      const previousSource = readSource(this.nodeValue);
      const source = readSource(node);
      this.nodeValue = node;

      if (source !== previousSource) {
        this.renderSource(source);
        this.registration.sync(kind, source);
      }

      this.render(this.registration.snapshot());
      return true;
    }

    selectNode() {
      this.renderedSelected = true;
      this.dom.classList.add("ProseMirror-selectednode");
      this.render(this.registration.snapshot());
    }

    deselectNode() {
      this.renderedSelected = false;
      this.dom.classList.remove("ProseMirror-selectednode");
      this.render(this.registration.snapshot());
    }

    stopEvent(event: Event) {
      return isInside(event.target, this.actions);
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      this.cleanup(true);
    }

    clearPreview() {
      this.preview.replaceChildren();
      this.preview.hidden = true;
    }

    commitPreview(fragment: DocumentFragment) {
      if (this.destroyed) {
        return;
      }

      this.preview.replaceChildren(fragment);
      this.preview.hidden = false;
    }

    isComposing() {
      return !this.destroyed && !this.view.isDestroyed && this.view.composing;
    }

    isCurrent(expectedKind: MathKind, expectedSource: string) {
      return (
        !this.destroyed
        && !this.view.isDestroyed
        && expectedKind === kind
        && expectedSource === readSource(this.nodeValue)
        && this.getCurrentPosition() !== null
      );
    }

    setRenderSnapshot(snapshot: MathRenderSnapshot) {
      if (this.destroyed) {
        return;
      }

      this.renderSnapshot = snapshot;
      this.render(snapshot);
    }

    private createActionButton(
      action: "edit" | "retry" | "toggle",
      label: string,
      listener: (event: MouseEvent) => void,
    ) {
      const button = this.view.dom.ownerDocument.createElement("button");
      button.className = "mdw-math__action";
      button.dataset.mdwMathAction = action;
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", listener);
      return button;
    }

    private getCurrentPosition() {
      return safePosition(this.view, this.getPos, this.nodeValue);
    }

    private getRenderSnapshot() {
      return Object.freeze({ ...this.renderSnapshot });
    }

    private refresh() {
      if (this.destroyed) {
        return false;
      }

      this.render(this.registration.snapshot());
      return true;
    }

    private requestEdit() {
      if (
        this.destroyed
        || this.view.isDestroyed
        || !this.view.editable
        || this.view.composing
        || !onEditSource
        || !this.isCurrent(kind, readSource(this.nodeValue))
      ) {
        return false;
      }

      try {
        onEditSource(this.controller);
        return true;
      } catch (error) {
        this.report(error, "edit-source");
        return false;
      }
    }

    private retryPreview() {
      if (!this.canRunAction()) {
        return false;
      }

      return this.registration.retry();
    }

    private togglePreview() {
      if (!this.canRunAction()) {
        return false;
      }

      return this.registration.togglePreview();
    }

    private canRunAction() {
      return (
        !this.destroyed
        && !this.view.isDestroyed
        && this.view.editable
        && !this.view.composing
        && this.isCurrent(kind, readSource(this.nodeValue))
      );
    }

    private readonly handleEdit = (event: MouseEvent) => {
      if (this.requestEdit()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private readonly handleToggle = (event: MouseEvent) => {
      if (this.togglePreview()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private readonly handleRetry = (event: MouseEvent) => {
      if (this.retryPreview()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private readonly handleActionKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || this.view.composing) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    private renderSource(source: string) {
      const shell = canonicalShell(kind, source);
      const sourceLabel = kind === "inline"
        ? messages.inlineSourceLabel(source)
        : messages.blockSourceLabel(source);
      this.sourceElement.textContent = shell;
      this.srSource.textContent = shell;
      this.srSource.setAttribute("aria-label", sourceLabel);
    }

    private statusText(snapshot: MathRenderSnapshot) {
      if (snapshot.status === "queued" || snapshot.status === "rendering") {
        return messages.previewLoading;
      }

      if (snapshot.status === "source-too-large") {
        return messages.sourceTooLargeDiagnostic(MATH_MAX_SOURCE_BYTES);
      }

      if (snapshot.status === "error") {
        return snapshot.errorCode === "renderer-missing"
          ? messages.rendererUnavailable
          : messages.previewFailed;
      }

      return "";
    }

    private render(snapshot: MathRenderSnapshot) {
      this.renderSnapshot = snapshot;
      const disabled = !this.view.editable || this.view.composing;
      const uiKey = [
        snapshot.status,
        snapshot.errorCode ?? "",
        snapshot.previewRequested ? "preview" : "source",
        disabled ? "disabled" : "enabled",
        this.renderedSelected ? "selected" : "unselected",
      ].join(":");

      if (uiKey === this.renderedUiKey) {
        return;
      }

      this.renderedUiKey = uiKey;
      this.dom.dataset.mdwMathState = snapshot.status;
      this.dom.dataset.mdwMathPreviewRequested = snapshot.previewRequested ? "true" : "false";

      if (disabled !== this.renderedDisabled) {
        for (const button of [this.editButton, this.toggleButton, this.retryButton]) {
          if (!button) {
            continue;
          }

          button.disabled = disabled;
          button.setAttribute("aria-disabled", disabled ? "true" : "false");
        }

        this.renderedDisabled = disabled;
      }

      this.toggleButton.textContent = snapshot.previewRequested
        ? messages.showSource
        : messages.showPreview;
      this.toggleButton.setAttribute(
        "aria-pressed",
        snapshot.previewRequested ? "true" : "false",
      );

      const retryVisible = snapshot.status === "error";
      this.retryButton.hidden = !retryVisible;
      this.header.hidden = kind === "inline" && !this.renderedSelected && !retryVisible;

      const showPreview = snapshot.status === "rendered";
      this.preview.hidden = !showPreview;
      this.sourceShell.hidden = showPreview;

      const text = this.statusText(snapshot);

      if (this.status.textContent !== text) {
        this.status.textContent = text;
      }

      this.status.hidden = !text;
    }

    private report(error: unknown, contribution: string) {
      try {
        reportError?.(error, contribution);
      } catch {
        // Host error observers must not destabilize DOM event handling.
      }
    }

    private cleanup(notify: boolean) {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      this.actions.removeEventListener("keydown", this.handleActionKeyDown);
      this.editButton?.removeEventListener("click", this.handleEdit);
      this.toggleButton.removeEventListener("click", this.handleToggle);
      this.retryButton.removeEventListener("click", this.handleRetry);
      this.registration?.destroy();
      this.preview.replaceChildren();

      if (notify) {
        onDestroy?.(this.controller);
      }
    }
  }

  return (node, view, getPos) => new MathNodeView(node, view, getPos);
}
