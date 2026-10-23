import { createAtomView } from "markora/extension-api";
import type {
  AtomViewContext,
  EditorView,
  Node as ProseMirrorNode,
  NodeType,
  NodeViewConstructor,
} from "markora/extension-api";
import type { HtmlMessages } from "./messages";
import type {
  HtmlDisplay,
  HtmlSourceKind,
} from "./source";
import {
  type HtmlRenderManager,
  type HtmlRenderRegistration,
  type HtmlRenderSnapshot,
  type HtmlRenderTarget,
} from "./renderer";

export type HtmlNodeViewController = Readonly<{
  readonly display: HtmlDisplay;
  readonly kind: HtmlSourceKind;
  readonly marker: HTMLElement;
  readonly node: ProseMirrorNode;
  readonly source: string;
  getPosition(): number | null;
  getRenderSnapshot(): HtmlRenderSnapshot;
  isCurrent(): boolean;
  refresh(adoptCurrentNode?: boolean): boolean;
  requestEdit(): boolean;
  retryPreview(): boolean;
  togglePreview(): boolean;
}>;

export type CreateHtmlNodeViewOptions = Readonly<{
  display: HtmlDisplay;
  manager?: HtmlRenderManager;
  messages: HtmlMessages;
  nodeType: NodeType;
  onCreate?(controller: HtmlNodeViewController): void;
  onDestroy?(controller: HtmlNodeViewController): void;
  onEditSource?(controller: HtmlNodeViewController): void;
  readKind(node: ProseMirrorNode): HtmlSourceKind;
  readSource(node: ProseMirrorNode): string;
  reportError?(error: unknown, contribution: string): void;
}>;

let accessibleId = 0;

function safePosition(
  view: EditorView,
  getPos: () => number | undefined,
  node: ProseMirrorNode,
) {
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

function sourceSnapshot(source: string, enabled = false): HtmlRenderSnapshot {
  return Object.freeze({
    errorCode: null,
    previewRequested: enabled,
    source,
    status: "source" as const,
  });
}

function kindLabel(kind: HtmlSourceKind, messages: HtmlMessages) {
  return kind === "html-block"
    ? messages.blockKindLabel
    : kind === "inline-html" ? messages.inlineKindLabel : messages.commentKindLabel;
}

export function createHtmlNodeView(
  options: CreateHtmlNodeViewOptions,
): NodeViewConstructor {
  const {
    display,
    manager,
    messages,
    nodeType,
    onCreate,
    onDestroy,
    onEditSource,
    readKind,
    readSource,
    reportError,
  } = options;

  class HtmlNodeView implements HtmlRenderTarget {
    readonly dom: HTMLElement;
    readonly preview: HTMLElement;
    readonly viewDom: HTMLElement;

    private readonly actions: HTMLElement;
    private readonly controller: HtmlNodeViewController;
    private destroyed = false;
    private readonly editButton: HTMLButtonElement | null;
    private readonly kindElement: HTMLElement;
    private nodeValue: ProseMirrorNode;
    private registration: HtmlRenderRegistration | null = null;
    private renderSnapshot: HtmlRenderSnapshot;
    private renderedUiKey: string | null = null;
    private readonly retryButton: HTMLButtonElement;
    private selected = false;
    private readonly sourceElement: HTMLElement;
    private readonly sourceLabelElement: HTMLElement;
    private readonly sourceShell: HTMLElement;
    private readonly status: HTMLElement;
    private readonly toggleButton: HTMLButtonElement;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
      frame: AtomViewContext,
    ) {
      if (node.type !== nodeType) {
        throw new RangeError(`HTML NodeView expected ${nodeType.name}, received ${node.type.name}.`);
      }

      this.nodeValue = node;
      const source = readSource(node);
      const kind = readKind(node);
      this.renderSnapshot = sourceSnapshot(source, Boolean(manager && kind === "html-block"));
      const ownerDocument = view.dom.ownerDocument;
      accessibleId += 1;
      const id = accessibleId;
      this.viewDom = view.dom;
      this.dom = frame.dom;
      this.dom.dataset.mdwHtml = "";
      this.dom.dataset.mdwHtmlDisplay = display;
      this.dom.dataset.mdwHtmlKind = kind;
      const header = frame.header!;
      header.classList.add("mdw-html__header");
      this.kindElement = ownerDocument.createElement("span");
      this.kindElement.className = "mdw-html__kind";
      this.kindElement.id = `mdw-html-kind-${id}`;
      this.kindElement.textContent = kindLabel(kind, messages);
      header.prepend(this.kindElement);

      this.actions = frame.controls;
      this.actions.classList.add("mdw-html__actions");
      const makeButton = (label: string, action: () => void) => {
        const button = ownerDocument.createElement("button");
        button.type = "button";
        button.className = "mdw-html__action";
        button.textContent = label;
        button.addEventListener("click", action, { signal: frame.signal });
        this.actions.append(button);
        return button;
      };

      this.editButton = onEditSource
        ? makeButton(messages.editSource, () => { this.requestEdit(); })
        : null;
      this.toggleButton = makeButton(messages.showPreview, () => { this.togglePreview(); });
      this.retryButton = makeButton(messages.retryPreview, () => { this.retryPreview(); });

      this.sourceShell = ownerDocument.createElement(display === "block" ? "pre" : "span");
      this.sourceShell.className = "mdw-html__source-shell";
      this.sourceLabelElement = ownerDocument.createElement("span");
      this.sourceLabelElement.className = "mdw-html__visually-hidden";
      this.sourceLabelElement.id = `mdw-html-source-label-${id}`;
      this.sourceLabelElement.textContent = messages.sourceLabel(kind);
      this.sourceElement = ownerDocument.createElement("code");
      this.sourceElement.className = "mdw-html__source";
      this.sourceElement.dataset.mdwHtmlSource = "";
      this.sourceElement.id = `mdw-html-source-${id}`;
      this.sourceElement.textContent = source;
      this.sourceShell.append(this.sourceLabelElement, this.sourceElement);
      frame.content.append(this.sourceShell);
      this.dom.setAttribute("aria-labelledby", [
        this.kindElement.id,
        this.sourceLabelElement.id,
        this.sourceElement.id,
      ].join(" "));

      this.preview = ownerDocument.createElement(display === "block" ? "div" : "span");
      this.preview.className = "mdw-html__preview";
      this.preview.dataset.mdwHtmlPreview = "";
      this.preview.setAttribute("aria-hidden", "true");
      this.preview.setAttribute("aria-label", messages.previewLabel);
      this.preview.setAttribute("inert", "");
      this.preview.hidden = true;
      frame.content.append(this.preview);

      this.status = frame.status;
      this.status.classList.add("mdw-html__status");

      const thisView = this;
      this.controller = Object.freeze({
        get display() { return display; },
        get kind() { return readKind(thisView.nodeValue); },
        marker: this.dom,
        get node() { return thisView.nodeValue; },
        get source() { return readSource(thisView.nodeValue); },
        getPosition: () => this.getPosition(),
        getRenderSnapshot: () => this.renderSnapshot,
        isCurrent: () => this.isCurrent(readSource(this.nodeValue)),
        refresh: (adoptCurrentNode = true) => this.refresh(adoptCurrentNode),
        requestEdit: () => this.requestEdit(),
        retryPreview: () => this.retryPreview(),
        togglePreview: () => this.togglePreview(),
      });

      // `thisView` is captured by getters only after controller construction.
      this.ensureRegistration();
      this.renderUi();
      onCreate?.(this.controller);
    }

    clearPreview() {
      this.preview.replaceChildren();
      this.preview.hidden = true;
    }

    commitPreview(fragment: DocumentFragment) {
      if (this.destroyed || !this.isCurrent(readSource(this.nodeValue))) return;
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

    setSelected(selected: boolean) {
      this.selected = selected;
      this.renderUi();
    }

    getPosition() {
      return safePosition(this.view, this.getPos, this.nodeValue);
    }

    isComposing() {
      return this.view.composing;
    }

    isCurrent(source: string) {
      return !this.destroyed
        && readSource(this.nodeValue) === source
        && this.getPosition() !== null;
    }

    refresh(adoptCurrentNode = true) {
      if (this.destroyed) return false;
      if (adoptCurrentNode) this.adoptEqualCurrentNode();
      this.renderUi();
      return true;
    }

    requestEdit() {
      if (
        !onEditSource
        || this.destroyed
        || !this.actionsAllowed()
        || !this.view.editable
        || this.view.composing
        || this.getPosition() === null
      ) return false;

      try {
        onEditSource(this.controller);
        return true;
      } catch (error) {
        reportError?.(error, "source-editor");
        return false;
      }
    }

    retryPreview() {
      if (
        this.destroyed
        || !this.view.editable
        || this.view.composing
        || this.getPosition() === null
      ) return false;
      return this.registration?.retry() ?? false;
    }

    setRenderSnapshot(next: HtmlRenderSnapshot) {
      if (this.destroyed) return;
      this.renderSnapshot = next;
      this.renderUi();
    }

    togglePreview() {
      if (
        this.destroyed
        || !this.view.editable
        || this.view.composing
        || this.getPosition() === null
      ) return false;
      return this.registration?.toggle() ?? false;
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeType) return false;
      this.nodeValue = node;
      const source = readSource(node);
      const kind = readKind(node);
      this.sourceElement.textContent = source;
      this.kindElement.textContent = kindLabel(kind, messages);
      this.sourceLabelElement.textContent = messages.sourceLabel(kind);
      this.dom.dataset.mdwHtmlKind = kind;
      this.ensureRegistration();
      this.registration?.update(source);
      if (!this.registration) this.renderSnapshot = sourceSnapshot(source);
      this.renderUi();
      return true;
    }

    private ensureRegistration() {
      const eligible = display === "block"
        && readKind(this.nodeValue) === "html-block"
        && manager;

      if (eligible && !this.registration) {
        this.registration = manager.register(this, readSource(this.nodeValue));
        this.renderSnapshot = this.registration.getSnapshot();
      } else if (!eligible && this.registration) {
        this.registration.destroy();
        this.registration = null;
        this.clearPreview();
        this.renderSnapshot = sourceSnapshot(readSource(this.nodeValue));
      }
    }

    private adoptEqualCurrentNode() {
      if (this.view.isDestroyed) return false;

      let position: number | undefined;
      try {
        position = this.getPos();
      } catch {
        return false;
      }

      if (typeof position !== "number") return false;
      const current = this.view.state.doc.nodeAt(position);

      if (
        current === this.nodeValue
        || current?.type !== nodeType
        || !current.eq(this.nodeValue)
      ) return false;

      // A hard state replacement can retain a NodeView when the freshly parsed
      // document is structurally equal. Adopt the new occurrence, but restart
      // its renderer generation so work from before reset can never commit.
      this.nodeValue = current;
      this.registration?.destroy();
      this.registration = null;
      this.clearPreview();
      this.renderSnapshot = sourceSnapshot(
        readSource(current),
        Boolean(manager && readKind(current) === "html-block"),
      );
      this.ensureRegistration();
      this.renderedUiKey = null;
      return true;
    }

    private actionsAllowed() {
      return display === "block" || !this.nodeValue.marks.some(
        (mark) => mark.type === this.view.state.schema.marks.link,
      );
    }

    private syncActionChildren(allowed: boolean) {
      if (!allowed) {
        this.actions.replaceChildren();
        return;
      }

      for (const button of [this.editButton, this.toggleButton, this.retryButton]) {
        if (button && button.parentNode !== this.actions) {
          this.actions.append(button);
        }
      }
    }

    private renderUi() {
      const editable = this.view.editable && !this.view.composing && !this.destroyed;
      const eligible = Boolean(this.registration);
      const actionsAllowed = this.actionsAllowed();
      const { errorCode, previewRequested, status } = this.renderSnapshot;
      const uiKey = [
        actionsAllowed,
        editable,
        eligible,
        errorCode,
        previewRequested,
        this.selected,
        status,
      ].join("|");

      if (uiKey === this.renderedUiKey) return;
      this.renderedUiKey = uiKey;
      this.syncActionChildren(actionsAllowed);
      this.dom.dataset.mdwHtmlState = status;
      this.dom.classList.toggle("mdw-html--preview", status === "rendered");
      this.sourceShell.classList.toggle("mdw-html__source-shell--visually-hidden", status === "rendered");
      this.editButton && (this.editButton.disabled = !editable);
      this.toggleButton.disabled = !editable || !eligible;
      this.retryButton.disabled = !editable || !eligible;
      this.toggleButton.hidden = !eligible;
      this.toggleButton.textContent = previewRequested ? messages.showSource : messages.showPreview;
      this.retryButton.hidden = !eligible || status !== "error";

      const inlineActionsVisible = display === "block" || this.selected || status === "error";
      this.actions.hidden = !actionsAllowed
        || !inlineActionsVisible
        || (!this.editButton && !eligible);
      const statusText = status === "rendering" || status === "queued"
        ? messages.previewLoading
        : status === "error"
          ? errorCode === "renderer-missing" ? messages.rendererUnavailable : messages.previewFailed
          : status === "source-too-large"
            ? messages.sourceTooLargeDiagnostic(262_144)
            : "";
      if (this.status.textContent !== statusText) this.status.textContent = statusText;
      this.status.hidden = !statusText;
    }
  }

  return (node, view, getPos) => createAtomView(node, view, getPos, {
    display,
    header: true,
    statusDisplay: "visible",
    className: `mdw-html mdw-html--${display}`,
    label: current => messages.sourceLabel(readKind(current)),
    render(frame) {
      const renderer = new HtmlNodeView(node, view, getPos, frame);
      return {
        update: current => renderer.update(current.node),
        selectionChanged: current => renderer.setSelected(current.selected),
        destroy: () => renderer.destroy(),
      };
    },
  });
}
