import { NodeSelection, Selection, closeHistory } from "markora/extension-api";
import { isValidInlineMathSource, isValidBlockMathSource, normalizeMathSource } from "./source";
import { createMathSourceEditor, type MathSourceEditor } from "./sourceEditor";
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
  resetEditing(): void;
  finishEditing(): boolean;
  requestEdit(joinHistory?: boolean): boolean;
  retryPreview(): boolean;
  togglePreview(): boolean;
}>;

export type CreateMathNodeViewOptions = Readonly<{
  kind: MathKind;
  manager: MathRenderManager;
  messages: MathMessages;
  rendererAvailable: boolean;
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
    rendererAvailable,
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
    private sourceEditor: MathSourceEditor | null = null;
    private writingSource = false;
    private finishing = false;
    private readonly editButton: HTMLButtonElement;
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
      this.dom.addEventListener("click", this.handleClick);
      this.dom.addEventListener("keydown", this.handleNodeKeyDown);
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

      this.editButton = this.createActionButton("edit", messages.editSource);
      this.actions.append(this.editButton);

      this.toggleButton = this.createActionButton(
        "toggle",
        messages.showPreview,
      );
      this.toggleButton.setAttribute("aria-pressed", "false");
      this.retryButton = this.createActionButton(
        "retry",
        messages.retryPreview,
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
        resetEditing: () => instance.resetEditing(),
        finishEditing: () => {
          if (instance.sourceEditor?.composing) return false;
          instance.finishEditing(null);
          return true;
        },
        requestEdit: (joinHistory) => instance.requestEdit(joinHistory),
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
        if (!this.writingSource) this.sourceEditor?.sync(source);
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
      return isInside(event.target, this.actions) || !!this.sourceEditor && isInside(event.target, this.sourceEditor.dom);
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

      // Keep renderer-owned content inert while the surrounding preview remains
      // a native scroll target for expressions wider than the editor.
      const rendered = this.dom.ownerDocument.createElement(kind === "inline" ? "span" : "div");
      rendered.className = "mdw-math__render";
      rendered.inert = true;
      rendered.append(fragment);
      this.preview.replaceChildren(rendered);
      this.preview.hidden = false;
    }

    isComposing() {
      return !this.destroyed && !this.view.isDestroyed && (this.view.composing || !!this.sourceEditor?.composing);
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
    ) {
      const button = this.view.dom.ownerDocument.createElement("button");
      button.className = "mdw-math__action";
      button.dataset.mdwMathAction = action;
      button.type = "button";
      button.textContent = label;
      return button;
    }

    private getCurrentPosition() {
      return safePosition(this.view, this.getPos, this.nodeValue);
    }

    private getRenderSnapshot() {
      return Object.freeze({ ...this.renderSnapshot });
    }

    private resetEditing() {
      if (!this.sourceEditor) return;
      this.sourceEditor.destroy();
      this.sourceEditor = null;
      if (rendererAvailable && !this.registration.snapshot().previewRequested) this.registration.togglePreview();
      this.render(this.registration.snapshot());
    }

    private refresh() {
      if (this.destroyed) {
        return false;
      }

      if (!this.view.editable) this.resetEditing();
      this.render(this.registration.snapshot());
      return true;
    }

    private requestEdit(joinHistory = false) {
      if (
        this.destroyed
        || this.view.isDestroyed
        || !this.view.editable
        || this.view.composing
        || !this.isCurrent(kind, readSource(this.nodeValue))
      ) {
        return false;
      }

      try {
        if (onEditSource) {
          onEditSource(this.controller);
          return true;
        }
        if (this.sourceEditor) { this.sourceEditor.focus(); return true; }
        const position = this.getCurrentPosition()!;
        const transaction = this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, position));
        this.view.dispatch(joinHistory ? transaction : closeHistory(transaction));
        if (!this.canRunAction()) return false;
        this.sourceEditor = createMathSourceEditor({
          document: this.dom.ownerDocument,
          source: readSource(this.nodeValue),
          inline: kind === "inline",
          label: messages.sourceInputLabel,
          hint: messages.editingHint,
          onChange: (source) => this.writeSource(source),
          onExit: (direction) => this.finishEditing(direction),
        });
        this.dom.append(this.sourceEditor.dom);
        if (this.registration.snapshot().previewRequested) this.registration.togglePreview();
        this.render(this.registration.snapshot());
        this.sourceEditor.focus();
        return true;
      } catch (error) {
        this.report(error, "edit-source");
        return false;
      }
    }

    private writeSource(value: string) {
      if (!this.canRunAction()) return;
      const source = normalizeMathSource(value);
      const valid = kind === "inline" ? isValidInlineMathSource(source) : isValidBlockMathSource(source);
      this.sourceEditor?.input.setAttribute("aria-invalid", valid || !source ? "false" : "true");
      this.status.textContent = !valid && source ? messages.invalidEditingSource : "";
      this.status.hidden = valid || !source;
      if (!valid || source === readSource(this.nodeValue)) return;
      const position = this.getCurrentPosition()!;
      this.writingSource = true;
      try {
        this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, { ...this.nodeValue.attrs, source }));
      } finally { this.writingSource = false; }
    }

    private finishEditing(direction: -1 | 1 | null) {
      const editor = this.sourceEditor;
      if (!editor || this.finishing || editor.composing) return;
      this.finishing = true;
      const focused = (editor.input.getRootNode() as Document | ShadowRoot).activeElement === editor.input;
      const source = normalizeMathSource(editor.input.value);
      const position = this.getCurrentPosition();
      this.sourceEditor = null;
      try {
        if (position === null || this.view.isDestroyed) return;
        const valid = kind === "inline" ? isValidInlineMathSource(source) : isValidBlockMathSource(source);
        let endPosition = position + this.nodeValue.nodeSize;
        // Empty formulas are removed. Source that cannot round-trip through a math
        // delimiter is kept as ordinary text, never silently discarded on blur.
        if (this.view.editable && (!source.trim() || !valid)) {
          const replacement = source ? (kind === "inline"
            ? this.view.state.schema.text(source, this.nodeValue.marks)
            : this.view.state.schema.nodes.paragraph.create(null, this.view.state.schema.text(source))) : null;
          const replacementTransaction = this.view.state.tr.replaceWith(position, endPosition, replacement ? [replacement] : []);
          endPosition = replacementTransaction.mapping.map(endPosition);
          this.view.dispatch(replacementTransaction);
        }
        if (this.view.isDestroyed) return;
        let tr = this.view.state.tr;
        if (focused && direction !== null) {
          let next = Math.min((direction > 0 ? endPosition : position), tr.doc.content.size);
          if (direction > 0 && kind === "block" && next === tr.doc.content.size) {
            tr = tr.insert(next, this.view.state.schema.nodes.paragraph.create());
          }
          next = Math.min(next, tr.doc.content.size);
          tr = tr.setSelection(Selection.near(tr.doc.resolve(next), direction));
        }
        this.view.dispatch(tr);
        if (!this.view.isDestroyed) this.view.dispatch(closeHistory(this.view.state.tr));
        if (!this.destroyed) {
          if (rendererAvailable && !this.registration.snapshot().previewRequested) this.registration.togglePreview();
          this.render(this.registration.snapshot());
        }
        if (focused && !this.view.isDestroyed) this.view.focus();
      } finally { editor.destroy(); this.finishing = false; }
    }

    private readonly handleNodeKeyDown = (event: KeyboardEvent) => {
      if (isInside(event.target, this.actions)) {
        if (event.isComposing || event.keyCode === 229 || this.view.composing) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.target !== this.dom || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === "Enter" || event.key === " ") && this.requestEdit()) {
        event.preventDefault(); event.stopPropagation();
      }
    };

    private readonly handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || this.sourceEditor) return;
      // One shell listener owns both formula activation and its action buttons.
      // Per-button listeners would multiply with every formula in large documents.
      let handled = false;
      if (isInside(event.target, this.actions)) {
        if (!this.editButton.disabled && isInside(event.target, this.editButton)) {
          handled = this.requestEdit();
        } else if (!this.toggleButton.disabled && isInside(event.target, this.toggleButton)) {
          handled = this.togglePreview();
        } else if (!this.retryButton.disabled && isInside(event.target, this.retryButton)) {
          handled = this.retryPreview();
        }
      } else {
        handled = this.requestEdit();
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

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
        this.sourceEditor ? "editing" : "reading",
      ].join(":");

      if (uiKey === this.renderedUiKey) {
        return;
      }

      this.renderedUiKey = uiKey;
      this.dom.dataset.mdwMathState = snapshot.status;
      this.dom.dataset.mdwMathEditing = this.sourceEditor ? "true" : "false";
      if (this.sourceEditor) this.sourceEditor.input.readOnly = disabled;
      this.dom.dataset.mdwMathPreviewRequested = snapshot.previewRequested ? "true" : "false";

      if (disabled !== this.renderedDisabled) {
        for (const button of [this.editButton, this.toggleButton, this.retryButton]) {
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
      this.header.hidden = !!this.sourceEditor || (!onEditSource && !retryVisible)
        || (kind === "inline" && !this.renderedSelected && !retryVisible);
      this.dom.tabIndex = disabled ? -1 : 0;

      const showPreview = !this.sourceEditor && snapshot.status === "rendered";
      this.preview.hidden = !showPreview;
      this.sourceShell.hidden = !!this.sourceEditor || showPreview;

      const text = this.statusText(snapshot);

      if (this.status.textContent !== text) {
        this.status.textContent = text;
      }

      this.status.hidden = !!this.sourceEditor || !text;
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
      this.sourceEditor?.destroy();
      this.sourceEditor = null;
      this.dom.removeEventListener("click", this.handleClick);
      this.dom.removeEventListener("keydown", this.handleNodeKeyDown);
      this.registration?.destroy();
      this.preview.replaceChildren();

      if (notify) {
        onDestroy?.(this.controller);
      }
    }
  }

  return (node, view, getPos) => new MathNodeView(node, view, getPos);
}
