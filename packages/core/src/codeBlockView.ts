import { type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { CodeBlockLanguageRegistry } from "./codeBlockLanguages";
import {
  defaultMarkdownEditorMessages,
  type MarkdownEditorMessages,
} from "./editorMessages";
import type { MarkdownEditorNestedClipboardPipeline } from "./extensionAssembly";
import { rejectFileTransferEvent } from "./fileTransferGuard";
import { isolateClipboardHistory, nestedClipboardText } from "./clipboardSemantics";
import type { NormalizedMarkdownEditorShortcutMap } from "./shortcutConfig";
import type {
  MarkdownEditorCodeAutoPairSnapshot,
  MarkdownEditorHistoryAction,
  NormalizedMarkdownEditorTypingOptions,
} from "./typingErgonomics";

type BrowserWindow = Window & typeof globalThis;

type ActiveCodeBlockView = {
  readonly composing: boolean;
  readonly dom: HTMLElement;
  readonly hasFocus: boolean;
  getGeneratedAutoPairs(): readonly MarkdownEditorCodeAutoPairSnapshot[];
  destroy(): void;
  setEditable(editable: boolean): void;
  setSelection(anchor: number, head: number): void;
  stopEvent(event: Event): boolean;
  update(node: ProseMirrorNode, historyAction?: MarkdownEditorHistoryAction | null): boolean;
};

type ActiveCodeBlockViewClass = new (
  node: ProseMirrorNode,
  outerView: EditorView,
  getPos: () => number,
  mount: {
    dom: HTMLElement;
    editorHost: HTMLElement;
    languageBadge: HTMLElement;
  },
  generatedAutoPairs?: readonly MarkdownEditorCodeAutoPairSnapshot[],
) => ActiveCodeBlockView;

type CodeBlockViewInstance = {
  contentDOM: HTMLElement;
  dom: HTMLElement;
  update(node: ProseMirrorNode): boolean;
  selectNode(): void;
  deselectNode(): void;
  setSelection(anchor: number, head: number): void;
  stopEvent(event: Event): boolean;
  ignoreMutation(mutation: MutationRecord | { target: Node; type: "selection" }): boolean;
  destroy(): void;
};

type CodeBlockViewConstructor = new (
  node: ProseMirrorNode,
  outerView: EditorView,
  getPos: () => number,
) => CodeBlockViewInstance;

type CodeBlockViewClass = CodeBlockViewConstructor & {
  isComposing(): boolean;
  setEditable(editable: boolean): void;
};

type ErrorDelivery = {
  defer: boolean;
  isCurrent(): boolean;
};

type CodeBlockLanguageEditTarget = Readonly<{
  getPos: () => number;
  marker: HTMLElement;
  node: ProseMirrorNode;
  view: EditorView;
}>;

type CreateCodeBlockViewClassOptions = {
  schema: Schema;
  languageRegistry?: CodeBlockLanguageRegistry;
  messages?: MarkdownEditorMessages;
  nestedClipboard?: MarkdownEditorNestedClipboardPipeline | null;
  getOnEditLanguage?: () => ((target: CodeBlockLanguageEditTarget) => boolean) | null;
  getHistoryAction: () => MarkdownEditorHistoryAction | null;
  historyCommands: Readonly<{ redo: Command; undo: Command }>;
  shortcuts: NormalizedMarkdownEditorShortcutMap;
  typing: NormalizedMarkdownEditorTypingOptions;
  moveBeforeManagedBlock(view: EditorView, blockPos: number): boolean;
  onActivationError?(
    error: unknown,
    language: string,
    delivery: ErrorDelivery,
  ): void;
  onDestroyError?(error: unknown): void;
  onLanguageLoadError?(
    error: unknown,
    language: string,
    delivery: ErrorDelivery,
  ): void;
  setManagedBlockBoundarySelection(
    view: EditorView,
    blockPos: number,
    side: "before" | "after",
  ): boolean;
};

type ManagedCodeBlockInstance = {
  readonly dom: HTMLElement;
  readonly isActive: boolean;
  readonly isLoading: boolean;
  readonly isNearViewport: boolean;
  activateForViewport(): void;
  cancelLoadingForCapacity(): boolean;
  cancelSupersededDirectActivation(): void;
  canDeactivate(): boolean;
  deactivateForCapacity(): void;
  handleCompositeActivity(type: "compositionend" | "focusout"): void;
  setNearViewport(nearViewport: boolean): void;
};

const CODE_BLOCK_VIEWPORT_MARGIN = "800px 0px";
const MAX_ACTIVE_CODE_BLOCKS = 8;
const DEACTIVATION_DELAY_MS = 400;
const POINTER_SETTLE_DELAY_MS = 16;
const POINTER_RELEASE_EVENTS = [
  "pointerup",
  "pointercancel",
  "mouseup",
  "touchend",
  "touchcancel",
] as const;

let activeModulePromise: Promise<typeof import("./activeCodeBlockView")> | null = null;

function loadActiveCodeBlockModule() {
  activeModulePromise ??= import("./activeCodeBlockView");
  return activeModulePromise;
}

function getOwnerWindow(view: EditorView): BrowserWindow {
  const ownerWindow = view.dom.ownerDocument.defaultView as BrowserWindow | null;

  if (!ownerWindow) {
    throw new Error("Markora code block view requires a window-backed document.");
  }

  return ownerWindow;
}

function isNodeLike(value: unknown): value is Node {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { nodeType?: unknown }).nodeType === "number",
  );
}

function containsNode(container: Node, value: unknown) {
  if (!isNodeLike(value)) {
    return false;
  }

  try {
    return container.contains(value);
  } catch {
    return false;
  }
}

function isPrimaryPointerStart(event: Event) {
  if (event.type === "touchstart") {
    return true;
  }

  const pointerEvent = event as Event & {
    button?: unknown;
    isPrimary?: unknown;
  };
  return (
    (typeof pointerEvent.button !== "number" || pointerEvent.button === 0)
    && (typeof pointerEvent.isPrimary !== "boolean" || pointerEvent.isPrimary)
  );
}

function getRootSelection(view: EditorView) {
  const root = view.dom.getRootNode();

  if ("getSelection" in root && typeof root.getSelection === "function") {
    return root.getSelection();
  }

  return view.dom.ownerDocument.getSelection();
}

function getRootActiveElement(view: EditorView) {
  const root = view.dom.getRootNode();

  if ("activeElement" in root) {
    return (root as Document | ShadowRoot).activeElement
      ?? view.dom.ownerDocument.activeElement;
  }

  return view.dom.ownerDocument.activeElement;
}

function setTextDomSelection(
  view: EditorView,
  contentDOM: HTMLElement,
  anchor: number,
  head: number,
) {
  const ownerDocument = view.dom.ownerDocument;
  const ownerWindow = getOwnerWindow(view);
  const walker = ownerDocument.createTreeWalker(contentDOM, ownerWindow.NodeFilter.SHOW_TEXT);
  const resolveOffset = (offset: number) => {
    let remaining = Math.max(0, offset);
    let current = walker.nextNode();

    while (current) {
      const length = current.nodeValue?.length ?? 0;

      if (remaining <= length) {
        return { node: current, offset: remaining };
      }

      remaining -= length;
      current = walker.nextNode();
    }

    return { node: contentDOM, offset: contentDOM.childNodes.length };
  };
  const anchorPoint = resolveOffset(anchor);
  walker.currentNode = contentDOM;
  const headPoint = resolveOffset(head);
  const selection = getRootSelection(view);

  if (!selection) {
    return;
  }

  selection.removeAllRanges();

  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      anchorPoint.node,
      anchorPoint.offset,
      headPoint.node,
      headPoint.offset,
    );
    return;
  }

  const range = ownerDocument.createRange();
  range.setStart(anchorPoint.node, anchorPoint.offset);
  range.setEnd(headPoint.node, headPoint.offset);
  selection.addRange(range);
}

function readTransfer(event: ClipboardEvent | DragEvent) {
  try {
    return event.type === "paste"
      ? (event as ClipboardEvent).clipboardData
      : (event as DragEvent).dataTransfer;
  } catch {
    return null;
  }
}

// Returns a new class per editor. The closure owns one observer, one active
// runtime class, and one bounded activation pool for all code blocks.
export function createCodeBlockViewClass(options: CreateCodeBlockViewClassOptions): CodeBlockViewClass {
  const {
    schema,
    getOnEditLanguage,
    getHistoryAction,
    historyCommands,
    languageRegistry,
    messages = defaultMarkdownEditorMessages,
    nestedClipboard,
    moveBeforeManagedBlock,
    onActivationError,
    onDestroyError,
    onLanguageLoadError,
    setManagedBlockBoundarySelection,
    shortcuts,
    typing,
  } = options;
  const instances = new Set<CodeBlockView>();
  const instancesByDom = new Map<HTMLElement, CodeBlockView>();
  const activeInstances = new Map<ManagedCodeBlockInstance, number>();
  const loadingInstances = new Map<ManagedCodeBlockInstance, number>();
  const nearViewportInstances = new Set<ManagedCodeBlockInstance>();
  let activeSequence = 0;
  let activeViewClass: ActiveCodeBlockViewClass | null = null;
  let activeViewClassPromise: Promise<ActiveCodeBlockViewClass> | null = null;
  let activationErrorReported = false;
  let compositionResumeQueued = false;
  let directLoadingInstance: ManagedCodeBlockInstance | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let delegatedView: EditorView | null = null;
  let pointerDocument: Document | null = null;
  let pointerInstance: CodeBlockView | null = null;

  const loadActiveViewClass = () => {
    activeViewClassPromise ??= loadActiveCodeBlockModule().then((module) => {
      if (!activeViewClass) {
        activeViewClass = module.createActiveCodeBlockViewClass({
          historyCommands,
          languageRegistry,
          messages,
          moveBeforeManagedBlock,
          nestedClipboard,
          onDestroyError,
          onLanguageLoadError,
          schema,
          setManagedBlockBoundarySelection,
          shortcuts,
          typing,
        });
      }

      return activeViewClass!;
    });

    return activeViewClassPromise;
  };

  const pumpViewportActivations = () => {
    if (delegatedView?.composing) {
      return;
    }

    for (const instance of nearViewportInstances) {
      if (activeInstances.size + loadingInstances.size >= MAX_ACTIVE_CODE_BLOCKS) {
        return;
      }

      if (!instance.isActive && !instance.isLoading) {
        instance.activateForViewport();
      }
    }
  };

  const noteLoading = (
    instance: ManagedCodeBlockInstance,
    loading: boolean,
    version?: number,
  ) => {
    if (loading) {
      loadingInstances.set(instance, version ?? 0);
    } else {
      if (version != null && loadingInstances.get(instance) !== version) {
        return;
      }

      loadingInstances.delete(instance);

      if (directLoadingInstance === instance) {
        directLoadingInstance = null;
      }

      pumpViewportActivations();
    }
  };

  const noteActive = (instance: ManagedCodeBlockInstance, active: boolean) => {
    if (active) {
      activeInstances.delete(instance);
      activeInstances.set(instance, ++activeSequence);

      while (activeInstances.size > MAX_ACTIVE_CODE_BLOCKS) {
        const candidate = [...activeInstances.keys()].find((entry) => (
          entry !== instance && entry.canDeactivate()
        ));

        if (!candidate) {
          break;
        }

        candidate.deactivateForCapacity();
      }
    } else {
      activeInstances.delete(instance);
      pumpViewportActivations();
    }
  };

  const enforceActivationBound = (priority: ManagedCodeBlockInstance) => {
    while (activeInstances.size + loadingInstances.size > MAX_ACTIVE_CODE_BLOCKS) {
      const activeCandidate = [...activeInstances.keys()].find((entry) => (
        entry !== priority && entry.canDeactivate()
      ));

      if (activeCandidate) {
        activeCandidate.deactivateForCapacity();
        continue;
      }

      let cancelledLoading = false;

      for (const candidate of loadingInstances.keys()) {
        if (candidate !== priority && candidate.cancelLoadingForCapacity()) {
          cancelledLoading = true;
          break;
        }
      }

      if (!cancelledLoading) {
        break;
      }
    }
  };

  const claimDirectLoading = (instance: ManagedCodeBlockInstance) => {
    const previous = directLoadingInstance;
    directLoadingInstance = instance;

    if (previous && previous !== instance) {
      previous.cancelSupersededDirectActivation();
    }

    enforceActivationBound(instance);
  };

  const supersedeDirectLoading = (instance: ManagedCodeBlockInstance) => {
    const previous = directLoadingInstance;

    if (!previous || previous === instance) {
      if (previous === instance && !instance.isLoading) {
        directLoadingInstance = null;
      }
      return;
    }

    directLoadingInstance = null;
    previous.cancelSupersededDirectActivation();
  };

  const reportActivationFailure = (
    instance: CodeBlockView,
    error: unknown,
    language: string,
    version: number,
  ) => {
    if (activationErrorReported || !instance.isCurrentActivationFailure(version)) {
      return;
    }

    activationErrorReported = true;
    onActivationError?.(error, language, {
      defer: false,
      isCurrent: () => instance.isCurrentActivationFailure(version),
    });
  };

  const handleDelegatedActivity = (event: Event) => {
    if (event.type === "compositionend") {
      if (compositionResumeQueued || !delegatedView) {
        return;
      }

      compositionResumeQueued = true;
      const view = delegatedView;
      getOwnerWindow(view).queueMicrotask(() => {
        compositionResumeQueued = false;

        if (delegatedView !== view || view.isDestroyed) {
          return;
        }

        for (const instance of instances) {
          instance.handleCompositeActivity("compositionend");
        }

        pumpViewportActivations();
      });
      return;
    }

    const target = event.target;

    if (!isNodeLike(target)) {
      return;
    }

    const targetElement = target.nodeType === 1
      ? target as Element
      : target.parentElement;
    const shell = targetElement?.closest<HTMLElement>(".mdw-code-block");
    if (shell) {
      instancesByDom.get(shell)?.handleCompositeActivity("focusout");
    }
  };

  const attachDelegatedActivity = (view: EditorView) => {
    if (delegatedView) {
      return;
    }

    delegatedView = view;
    view.dom.addEventListener("focusout", handleDelegatedActivity);
    view.dom.addEventListener("compositionend", handleDelegatedActivity);
  };

  const detachDelegatedActivity = () => {
    if (!delegatedView || instances.size > 0) {
      return;
    }

    delegatedView.dom.removeEventListener("focusout", handleDelegatedActivity);
    delegatedView.dom.removeEventListener("compositionend", handleDelegatedActivity);
    delegatedView = null;
  };

  const detachPointerRelease = () => {
    if (pointerDocument) {
      for (const type of POINTER_RELEASE_EVENTS) {
        pointerDocument.removeEventListener(type, handlePointerRelease, true);
      }

      pointerDocument = null;
    }
  };

  const handlePointerRelease = (event: Event) => {
    const instance = pointerInstance;
    pointerInstance = null;
    detachPointerRelease();
    instance?.finishPointerInteraction(event);
  };

  const beginPointerInteraction = (instance: CodeBlockView, event: Event) => {
    if (pointerInstance && pointerInstance !== instance) {
      pointerInstance.cancelPointerInteraction();
    }

    pointerInstance = instance;
    instance.beginPointerInteraction(event);

    if (pointerDocument) {
      return;
    }

    pointerDocument = instance.outerViewForManager.dom.ownerDocument;

    for (const type of POINTER_RELEASE_EVENTS) {
      pointerDocument.addEventListener(type, handlePointerRelease, true);
    }
  };

  const releasePointerInteraction = (instance: CodeBlockView) => {
    if (pointerInstance !== instance) {
      return;
    }

    pointerInstance = null;
    detachPointerRelease();
  };

  const observeInstance = (instance: CodeBlockView) => {
    const ownerWindow = getOwnerWindow(instance.outerViewForManager);
    const IntersectionObserverConstructor = ownerWindow.IntersectionObserver;

    if (typeof IntersectionObserverConstructor !== "function") {
      return;
    }

    if (!intersectionObserver) {
      intersectionObserver = new IntersectionObserverConstructor((entries) => {
        for (const entry of entries) {
          instancesByDom.get(entry.target as HTMLElement)?.setNearViewport(entry.isIntersecting);
        }
      }, {
        root: null,
        rootMargin: CODE_BLOCK_VIEWPORT_MARGIN,
        threshold: 0,
      });
    }

    intersectionObserver.observe(instance.dom);
  };

  const unobserveInstance = (instance: CodeBlockView) => {
    intersectionObserver?.unobserve(instance.dom);

    if (instances.size === 0) {
      intersectionObserver?.disconnect();
      intersectionObserver = null;
    }
  };

  class CodeBlockView implements ManagedCodeBlockInstance {
    static isComposing() {
      return [...instances].some((instance) => instance.activeView?.composing);
    }

    static setEditable(editable: boolean) {
      for (const instance of [...instances]) {
        instance.applyEditable(editable);
      }
    }

    readonly contentDOM: HTMLElement;
    readonly dom: HTMLElement;
    readonly outerViewForManager: EditorView;
    private readonly activeHost: HTMLElement;
    private readonly languageBadge: HTMLElement;
    private readonly onEditLanguage: ((target: CodeBlockLanguageEditTarget) => boolean) | null;
    private readonly staticGutter: HTMLElement;
    private readonly staticView: HTMLElement;
    private activeView: ActiveCodeBlockView | null = null;
    private activationVersion = 0;
    private activateAfterComposition = false;
    private deactivateHandle: number | null = null;
    private destroyed = false;
    private editable: boolean;
    private focusOnActivation = false;
    private focusAfterComposition = false;
    private focusRetryHandle: number | null = null;
    private generatedAutoPairs: readonly MarkdownEditorCodeAutoPairSnapshot[] = Object.freeze([]);
    private nearViewport = false;
    private pointerActivationHandle: number | null = null;
    private pendingPointerPosition: number | null = null;
    private pointerInteraction = false;
    private presentedLanguage: string | null = null;
    private presentedLineCount = 0;
    private preserveStaticSelection = false;
    private state: "active" | "error" | "inactive" | "loading" = "inactive";

    constructor(
      private node: ProseMirrorNode,
      private outerView: EditorView,
      private getPos: () => number,
    ) {
      const ownerDocument = outerView.dom.ownerDocument;
      this.outerViewForManager = outerView;
      this.editable = outerView.editable;
      this.onEditLanguage = getOnEditLanguage?.() ?? null;
      this.dom = ownerDocument.createElement("div");
      this.dom.className = "mdw-code-block";
      this.dom.setAttribute("data-mdw-code-block-state", "inactive");

      this.languageBadge = ownerDocument.createElement(this.onEditLanguage ? "button" : "div");
      this.languageBadge.className = "mdw-code-block-language";
      this.languageBadge.contentEditable = "false";

      if (this.onEditLanguage) {
        this.languageBadge.setAttribute("type", "button");
        this.languageBadge.addEventListener("click", this.handleLanguageClick);
        this.syncLanguageButtonState();
      }

      const editorHost = ownerDocument.createElement("div");
      editorHost.className = "mdw-code-block-editor";

      this.staticView = ownerDocument.createElement("div");
      this.staticView.className = "mdw-code-block-static";

      this.staticGutter = ownerDocument.createElement("div");
      this.staticGutter.className = "mdw-code-block-static-gutter";
      this.staticGutter.contentEditable = "false";
      this.staticGutter.setAttribute("aria-hidden", "true");

      const staticPre = ownerDocument.createElement("pre");
      staticPre.className = "mdw-code-block-static-pre";
      this.contentDOM = ownerDocument.createElement("code");
      this.contentDOM.className = "mdw-code-block-static-code";
      this.contentDOM.setAttribute("spellcheck", "false");
      staticPre.append(this.contentDOM);
      this.staticView.append(this.staticGutter, staticPre);

      this.activeHost = ownerDocument.createElement("div");
      this.activeHost.className = "mdw-code-block-active";
      // Establish an independent editing boundary so CodeMirror's nested
      // contenteditable can receive focus inside ProseMirror's editing host.
      this.activeHost.contentEditable = "false";
      this.activeHost.hidden = true;
      editorHost.append(this.staticView, this.activeHost);
      this.dom.append(this.languageBadge, editorHost);

      instances.add(this);
      instancesByDom.set(this.dom, this);
      attachDelegatedActivity(outerView);

      try {
        this.update(node);
        observeInstance(this);
      } catch (error) {
        this.destroy();
        throw error;
      }
    }

    get isActive() {
      return this.state === "active";
    }

    get isLoading() {
      return this.state === "loading";
    }

    get isNearViewport() {
      return this.nearViewport;
    }

    update(node: ProseMirrorNode) {
      if (node.type !== schema.nodes.code_block) {
        return false;
      }

      // Attribute-only replacements, such as editing the fence info, cannot
      // invalidate generated closer provenance.
      if (!this.activeView && node !== this.node && node.textContent !== this.node.textContent) {
        if (getHistoryAction()) {
          this.generatedAutoPairs = Object.freeze(this.generatedAutoPairs.map((value) => ({
            ...value,
            active: node.textContent.slice(
              value.openPosition,
              value.openPosition + value.open.length,
            ) === value.open && node.textContent.slice(
              value.position,
              value.position + value.close.length,
            ) === value.close,
          })));
        } else {
          this.generatedAutoPairs = Object.freeze([]);
        }
      }

      this.applyEditable(this.outerView.editable);
      this.node = node;
      this.refreshLanguageBadge();

      // While CodeMirror is active, contentDOM stays synchronized by
      // ProseMirror but remains hidden. Defer the O(lines) gutter rebuild until
      // the passive shell is actually needed again.
      if (!this.activeView) {
        this.refreshStaticGutter();
      }
      const selectionInside = this.isOuterSelectionInsideCodeBlock();
      const selectionIsRange = selectionInside && !this.outerView.state.selection.empty;

      if (this.preserveStaticSelection && !selectionIsRange) {
        this.preserveStaticSelection = false;
      }

      if (
        selectionInside
        && !(selectionIsRange && (this.pointerInteraction || this.preserveStaticSelection))
        && !this.pointerInteraction
        && this.state === "inactive"
      ) {
        this.requestActivation(false);
      }

      if (
        !selectionInside
        && !this.nearViewport
        && this.state === "loading"
        && this.focusOnActivation
      ) {
        this.cancelPendingActivation();
      }

      if (this.activeView && !this.activeView.update(node, getHistoryAction())) {
        return false;
      }

      if (this.activeView && !selectionInside && !this.nearViewport) {
        this.scheduleDeactivation();
      }

      return true;
    }

    selectNode() {
      this.dom.classList.add("ProseMirror-selectednode");
    }

    deselectNode() {
      this.dom.classList.remove("ProseMirror-selectednode");
    }

    setSelection(anchor: number, head: number) {
      if (this.destroyed || this.outerView.isDestroyed) {
        return;
      }

      if (this.activeView) {
        this.activeView.setSelection(anchor, head);
        noteActive(this, true);
        return;
      }

      // ProseMirror reports each intermediate Chrome drag caret through this
      // hook. Writing it back into contentDOM would replace the browser's
      // original anchor, so leave the native DOM selection untouched until
      // the pointer gesture settles.
      if (this.pointerInteraction) {
        if (anchor !== head) {
          this.focusOnActivation = false;
          this.preserveStaticSelection = true;
          this.cancelPendingActivation();
        }

        return;
      }

      setTextDomSelection(this.outerView, this.contentDOM, anchor, head);

      if (anchor !== head) {
        this.focusOnActivation = false;
        this.preserveStaticSelection = true;
        this.cancelPendingActivation();
        return;
      }

      this.preserveStaticSelection = false;
      this.focusOnActivation = true;
      this.requestActivation(true);
    }

    stopEvent(event: Event) {
      const target = event.target;

      if (this.onEditLanguage && containsNode(this.languageBadge, target)) {
        return true;
      }

      if (
        this.activeView
        && (event.type === "copy" || event.type === "cut")
        && containsNode(this.dom, target)
      ) {
        return this.activeView.stopEvent(event);
      }

      if (
        this.activeView
        && containsNode(this.activeHost, target)
      ) {
        return this.activeView.stopEvent(event);
      }

      if (
        !containsNode(this.staticView, target)
      ) {
        return false;
      }

      if (
        event.type === "mousedown"
        || event.type === "pointerdown"
        || event.type === "touchstart"
      ) {
        if (!isPrimaryPointerStart(event)) {
          return false;
        }

        beginPointerInteraction(this, event);
        // Let ProseMirror observe the native gesture. Its Chrome drag path
        // deliberately delays selection-to-DOM synchronization while the
        // browser is extending a range; hiding mousedown from it collapses
        // the anchor to each successive pointer position.
        return false;
      }

      if (event.type === "click") {
        this.finishPointerInteraction(event);
        return true;
      }

      if (event.type === "paste") {
        return this.handleStaticClipboardEvent("paste", event as ClipboardEvent);
      }

      if (event.type === "drop") {
        return this.handleStaticClipboardEvent("drop", event as DragEvent);
      }

      if (event.type === "dragover") {
        return rejectFileTransferEvent(event) || !this.canEdit;
      }

      if (event.type === "copy" || event.type === "cut") {
        return this.handleStaticCopy(event as ClipboardEvent);
      }

      return false;
    }

    ignoreMutation(mutation: MutationRecord | { target: Node; type: "selection" }) {
      const target = mutation.target;

      // The wrapper, passive presentation, and live CodeMirror host are all
      // owned by this node view. Only text/child mutations in contentDOM are
      // ProseMirror document edits; reparsing wrapper state changes would
      // destroy an activation while its runtime import is still pending.
      // Avoid realm-based instanceof checks here: CodeMirror may create DOM
      // through the embedding window before the browser adopts it into an
      // iframe document, and adopted nodes retain their original prototype.
      if (mutation.type === "selection") {
        return (
          this.pointerInteraction
          || this.preserveStaticSelection
          || this.activeHost.contains(target)
        );
      }

      if (mutation.type === "attributes") {
        return true;
      }

      return target !== this.contentDOM && !this.contentDOM.contains(target);
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      this.languageBadge.removeEventListener("click", this.handleLanguageClick);
      this.activationVersion += 1;
      this.cancelDeactivation();
      this.cancelFocusRetry();
      this.cancelPointerInteraction();
      this.activateAfterComposition = false;
      this.focusAfterComposition = false;
      nearViewportInstances.delete(this);
      noteLoading(this, false);
      this.destroyActiveView();
      instances.delete(this);
      instancesByDom.delete(this.dom);
      unobserveInstance(this);
      detachDelegatedActivity();
    }

    activateForViewport() {
      if (
        this.nearViewport
        && !this.pointerInteraction
        && !this.shouldPreserveStaticSelection()
      ) {
        this.requestActivation(false);
      }
    }

    cancelLoadingForCapacity() {
      if (
        this.state !== "loading"
        || this.focusOnActivation
        || this.pointerInteraction
        || this.isOuterSelectionInsideCodeBlock()
      ) {
        return false;
      }

      this.cancelPendingActivation();
      return true;
    }

    cancelSupersededDirectActivation() {
      this.focusOnActivation = false;

      if (
        this.state === "loading"
        && !this.nearViewport
        && !this.isOuterSelectionInsideCodeBlock()
      ) {
        this.cancelPendingActivation();
      }
    }

    canDeactivate() {
      return Boolean(
        this.activeView
        && !this.activeView.hasFocus
        && !this.activeView.composing
        && !this.outerView.composing
        && !this.isOuterSelectionInsideCodeBlock(),
      );
    }

    deactivateForCapacity() {
      if (this.canDeactivate()) {
        this.deactivate();
      }
    }

    handleCompositeActivity(type: "compositionend" | "focusout") {
      if (type === "compositionend") {
        if (this.destroyed) {
          return;
        }

        if (this.activateAfterComposition && !this.outerView.composing) {
          const focus = this.focusAfterComposition;
          this.activateAfterComposition = false;
          this.focusAfterComposition = false;
          this.requestActivation(focus);
        }

        if (!this.nearViewport && this.activeView) {
          this.scheduleDeactivation();
        }

        return;
      }

      getOwnerWindow(this.outerView).queueMicrotask(() => {
        if (this.destroyed) {
          return;
        }

        if (!this.nearViewport) {
          this.scheduleDeactivation();
        }
      });
    }

    beginPointerInteraction(event: Event) {
      if (this.destroyed || this.outerView.isDestroyed) {
        return;
      }

      this.clearPointerActivationHandle();
      this.pointerInteraction = true;
      this.preserveStaticSelection = false;
      this.focusOnActivation = false;
      this.pendingPointerPosition = this.resolveEventPosition(event);
      this.cancelPendingActivation();
    }

    cancelPointerInteraction() {
      releasePointerInteraction(this);
      this.pointerInteraction = false;
      this.clearPointerActivationHandle();
      this.pendingPointerPosition = null;
    }

    finishPointerInteraction(event: Event) {
      if (this.destroyed || this.outerView.isDestroyed) {
        this.cancelPointerInteraction();
        return;
      }

      releasePointerInteraction(this);

      if (event.type === "pointercancel" || event.type === "touchcancel") {
        this.pointerInteraction = false;
        this.clearPointerActivationHandle();
        this.pendingPointerPosition = null;
        return;
      }

      this.pendingPointerPosition = this.resolveEventPosition(event)
        ?? this.pendingPointerPosition;

      if (this.pointerInteraction) {
        if (this.pointerActivationHandle != null) {
          return;
        }

        this.pointerActivationHandle = this.ownerWindow.setTimeout(() => {
          this.pointerActivationHandle = null;
          this.pointerInteraction = false;
          const latestSelection = this.readStaticDomSelection();

          if (latestSelection?.isRange) {
            this.preserveNativeStaticSelection();
            return;
          }

          const pendingPosition = latestSelection?.position ?? this.pendingPointerPosition;
          this.pendingPointerPosition = null;

          if (pendingPosition != null) {
            this.activatePointerPosition(pendingPosition);
          }
        }, POINTER_SETTLE_DELAY_MS);
        return;
      }

      const domSelection = this.readStaticDomSelection();

      if (domSelection?.isRange) {
        this.preserveNativeStaticSelection();
        return;
      }

      const position = domSelection?.position ?? this.pendingPointerPosition;
      this.pendingPointerPosition = null;

      if (position != null) {
        this.activatePointerPosition(position);
      }
    }

    setNearViewport(nearViewport: boolean) {
      if (this.destroyed || this.nearViewport === nearViewport) {
        return;
      }

      this.nearViewport = nearViewport;

      if (nearViewport) {
        this.cancelDeactivation();
        nearViewportInstances.add(this);
        pumpViewportActivations();
      } else {
        nearViewportInstances.delete(this);
        this.scheduleDeactivation();
        pumpViewportActivations();
      }
    }

    isCurrentActivationFailure(version: number) {
      return (
        !this.destroyed
        && this.state === "error"
        && version === this.activationVersion
      );
    }

    private get ownerWindow() {
      return getOwnerWindow(this.outerView);
    }

    private get canEdit() {
      return !this.destroyed && this.outerView.editable && this.editable;
    }

    private applyEditable(editable: boolean) {
      if (this.destroyed || this.editable === editable) {
        return;
      }

      this.editable = editable;
      this.activeView?.setEditable(editable);
      this.syncLanguageButtonState(editable);
    }

    private readonly handleLanguageClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        !this.onEditLanguage
        || !this.canEdit
        || this.outerView.composing
        || this.activeView?.composing
      ) {
        return;
      }

      this.onEditLanguage({
        getPos: this.getPos,
        marker: this.languageBadge,
        node: this.node,
        view: this.outerView,
      });
    };

    private syncLanguageButtonState(editable = this.canEdit) {
      if (this.languageBadge.tagName === "BUTTON") {
        (this.languageBadge as HTMLButtonElement).disabled = !editable;
      }
    }

    private refreshLanguageBadge() {
      const params = this.node.attrs.params;
      const language = typeof params === "string" ? params.trim() : "";

      if (language === this.presentedLanguage) {
        return;
      }

      this.presentedLanguage = language;
      const languageLabel = language || messages.codeBlockPlainTextLabel;
      this.languageBadge.textContent = languageLabel;

      if (this.onEditLanguage) {
        this.languageBadge.setAttribute(
          "aria-label",
          messages.codeBlockEditLanguageLabel(Object.freeze({ language, languageLabel })),
        );
      }
    }

    private refreshStaticGutter() {
      const text = this.node.textContent;
      let lineCount = 1;

      for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
        lineCount += 1;
      }

      if (lineCount === this.presentedLineCount) {
        return;
      }

      this.presentedLineCount = lineCount;
      this.staticGutter.textContent = Array.from(
        { length: lineCount },
        (_, index) => String(index + 1),
      ).join("\n");
    }

    private requestActivation(focus: boolean) {
      if (
        this.destroyed
        || this.outerView.isDestroyed
        || this.state === "error"
      ) {
        return;
      }

      if (this.outerView.composing) {
        if (focus || this.isOuterSelectionInsideCodeBlock()) {
          this.activateAfterComposition = true;
          this.focusAfterComposition ||= focus;
        }
        return;
      }

      this.focusOnActivation ||= focus;
      this.cancelDeactivation();

      if (this.activeView) {
        if (focus) {
          supersedeDirectLoading(this);
        }

        noteActive(this, true);

        if (this.focusOnActivation) {
          this.focusActiveSelection();
        }

        return;
      }

      if (this.state === "loading") {
        if (focus) {
          claimDirectLoading(this);
        }

        return;
      }

      const version = ++this.activationVersion;
      this.setState("loading");
      noteLoading(this, true, version);

      if (focus) {
        claimDirectLoading(this);
      }

      void loadActiveViewClass().then((ActiveView) => {
        if (
          this.destroyed
          || this.outerView.isDestroyed
          || version !== this.activationVersion
          || this.state !== "loading"
          || !this.isCurrentNode()
        ) {
          return;
        }

        if (this.outerView.composing) {
          this.activateAfterComposition ||= (
            this.focusOnActivation
            || this.isOuterSelectionInsideCodeBlock()
          );
          this.focusAfterComposition ||= this.focusOnActivation;
          this.activationVersion += 1;
          this.focusOnActivation = false;
          this.setState("inactive");
          noteLoading(this, false, version);
          return;
        }

        if (
          !this.nearViewport
          && !this.focusOnActivation
          && !this.isOuterSelectionInsideCodeBlock()
        ) {
          this.activationVersion += 1;
          this.setState("inactive");
          return;
        }

        let activeView: ActiveCodeBlockView | null = null;

        try {
          this.staticView.hidden = true;
          this.activeHost.hidden = false;
          activeView = new ActiveView(this.node, this.outerView, this.getPos, {
            dom: this.dom,
            editorHost: this.activeHost,
            languageBadge: this.languageBadge,
          }, this.generatedAutoPairs);
          this.generatedAutoPairs = Object.freeze([]);
          this.activeView = activeView;
          this.setState("active");
          noteActive(this, true);

          if (this.focusOnActivation) {
            this.focusActiveSelection();
          }

          if (!this.nearViewport && !this.isOuterSelectionInsideCodeBlock()) {
            this.scheduleDeactivation();
          }
        } catch (error) {
          this.setState("error");

          if (activeView && this.activeView === activeView) {
            this.destroyActiveView();
          } else {
            activeView?.destroy();
          }

          this.activeHost.replaceChildren();
          this.staticView.hidden = false;
          this.activeHost.hidden = true;
          reportActivationFailure(this, error, this.getLanguageLabel(), version);
        }
      }).catch((error: unknown) => {
        if (
          this.destroyed
          || version !== this.activationVersion
          || this.state !== "loading"
        ) {
          return;
        }

        this.staticView.hidden = false;
        this.activeHost.hidden = true;
        this.setState("error");
        reportActivationFailure(this, error, this.getLanguageLabel(), version);
      }).finally(() => {
        noteLoading(this, false, version);
      });
    }

    private focusActiveSelection() {
      const activeView = this.activeView;

      if (
        !activeView
        || !this.isOuterSelectionInsideCodeBlock()
        || this.activationFocusWasSuperseded()
      ) {
        this.focusOnActivation = false;
        return;
      }

      const selection = this.outerView.state.selection;
      const codeStart = this.getPos() + 1;
      const length = this.node.textContent.length;
      const domSelection = getRootSelection(this.outerView);

      // The permanent contentDOM remains in ProseMirror while its static
      // presentation is hidden. Clear a collapsed selection left there by
      // the activating click so the outer editable cannot reclaim focus when
      // CodeMirror installs its own selection.
      if (
        domSelection
        && (
          containsNode(this.contentDOM, domSelection.anchorNode)
          || containsNode(this.contentDOM, domSelection.focusNode)
        )
      ) {
        domSelection.removeAllRanges();
      }

      activeView.setSelection(
        Math.max(0, Math.min(length, selection.anchor - codeStart)),
        Math.max(0, Math.min(length, selection.head - codeStart)),
      );
      this.focusOnActivation = false;
      this.scheduleFocusRetry(activeView);
    }

    private scheduleFocusRetry(activeView: ActiveCodeBlockView) {
      this.cancelFocusRetry();
      this.focusRetryHandle = this.ownerWindow.requestAnimationFrame(() => {
        this.focusRetryHandle = null;

        if (
          this.destroyed
          || this.outerView.isDestroyed
          || this.activeView !== activeView
          || activeView.hasFocus
          || !this.isOuterSelectionInsideCodeBlock()
        ) {
          return;
        }

        // Retry only while focus is still within this composite editor. A
        // host control focused after the click must never lose focus to a
        // late lazy-activation frame.
        if (this.activationFocusWasSuperseded()) {
          return;
        }

        const selection = this.outerView.state.selection;
        const codeStart = this.getPos() + 1;
        const length = this.node.textContent.length;
        activeView.setSelection(
          Math.max(0, Math.min(length, selection.anchor - codeStart)),
          Math.max(0, Math.min(length, selection.head - codeStart)),
        );
      });
    }

    private activationFocusWasSuperseded() {
      const activeElement = getRootActiveElement(this.outerView);

      return (
        !activeElement
        || (
          activeElement !== this.outerView.dom
          && !containsNode(this.dom, activeElement)
        )
      );
    }

    private cancelFocusRetry() {
      if (this.focusRetryHandle == null) {
        return;
      }

      this.ownerWindow.cancelAnimationFrame(this.focusRetryHandle);
      this.focusRetryHandle = null;
    }

    private cancelPendingActivation() {
      this.activateAfterComposition = false;
      this.focusAfterComposition = false;

      if (this.state !== "loading") {
        return;
      }

      this.activationVersion += 1;
      this.focusOnActivation = false;
      this.setState("inactive");
      noteLoading(this, false);
    }

    private activatePointerPosition(position: number) {
      if (this.destroyed || this.outerView.isDestroyed) {
        return;
      }

      const clampedPosition = this.clampCodePosition(position);
      this.preserveStaticSelection = false;
      this.focusOnActivation = true;
      const currentSelection = this.outerView.state.selection;

      if (
        currentSelection.anchor !== clampedPosition
        || currentSelection.head !== clampedPosition
      ) {
        const tr = this.outerView.state.tr.setSelection(
          TextSelection.create(this.outerView.state.doc, clampedPosition),
        );
        tr.setMeta("addToHistory", false);
        this.outerView.dispatch(tr);
      }

      this.requestActivation(true);
    }

    private clearPointerActivationHandle() {
      if (this.pointerActivationHandle == null) {
        return;
      }

      this.ownerWindow.clearTimeout(this.pointerActivationHandle);
      this.pointerActivationHandle = null;
    }

    private preserveNativeStaticSelection() {
      this.clearPointerActivationHandle();
      this.pendingPointerPosition = null;
      this.focusOnActivation = false;
      this.preserveStaticSelection = true;
      this.cancelPendingActivation();
    }

    private clampCodePosition(position: number) {
      const blockPos = this.getPos();
      return Math.max(
        blockPos + 1,
        Math.min(blockPos + this.node.nodeSize - 1, position),
      );
    }

    private readStaticDomSelection() {
      const selection = getRootSelection(this.outerView);
      const anchorNode = selection?.anchorNode;
      const focusNode = selection?.focusNode;

      if (!selection || !anchorNode || !focusNode) {
        return null;
      }

      const anchorInside = anchorNode === this.contentDOM || this.contentDOM.contains(anchorNode);
      const focusInside = focusNode === this.contentDOM || this.contentDOM.contains(focusNode);

      if (!selection.isCollapsed) {
        return anchorInside || focusInside
          ? { isRange: true as const, position: null }
          : null;
      }

      if (!anchorInside) {
        return null;
      }

      try {
        return {
          isRange: false as const,
          position: this.clampCodePosition(
            this.outerView.posAtDOM(anchorNode, selection.anchorOffset, 1),
          ),
        };
      } catch {
        return null;
      }
    }

    private resolveEventPosition(event: Event) {
      const pointerEvent = event as Event & {
        changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
        clientX?: unknown;
        clientY?: unknown;
      };
      let left = typeof pointerEvent.clientX === "number" ? pointerEvent.clientX : null;
      let top = typeof pointerEvent.clientY === "number" ? pointerEvent.clientY : null;
      const touch = pointerEvent.changedTouches?.[0];

      if ((left == null || top == null) && touch) {
        left = touch.clientX;
        top = touch.clientY;
      }

      if (left == null || top == null) {
        return null;
      }

      try {
        const position = this.outerView.posAtCoords({ left, top })?.pos;
        return position == null ? null : this.clampCodePosition(position);
      } catch {
        return null;
      }
    }

    private shouldPreserveStaticSelection() {
      if (!this.preserveStaticSelection) {
        return false;
      }

      if (this.readStaticDomSelection()?.isRange) {
        return true;
      }

      if (
        !this.outerView.state.selection.empty
        && this.isOuterSelectionInsideCodeBlock()
      ) {
        return true;
      }

      this.preserveStaticSelection = false;
      return false;
    }

    private scheduleDeactivation() {
      if (!this.activeView || this.deactivateHandle != null) {
        return;
      }

      this.deactivateHandle = this.ownerWindow.setTimeout(() => {
        this.deactivateHandle = null;

        if (!this.nearViewport && this.canDeactivate()) {
          this.deactivate();
        }
      }, DEACTIVATION_DELAY_MS);
    }

    private cancelDeactivation() {
      if (this.deactivateHandle == null) {
        return;
      }

      this.ownerWindow.clearTimeout(this.deactivateHandle);
      this.deactivateHandle = null;
    }

    private deactivate() {
      if (!this.canDeactivate()) {
        return;
      }

      this.activationVersion += 1;
      this.focusOnActivation = false;
      this.cancelFocusRetry();
      this.destroyActiveView();
      this.refreshStaticGutter();
      this.staticView.hidden = false;
      this.activeHost.hidden = true;
      this.setState("inactive");
    }

    private destroyActiveView() {
      const activeView = this.activeView;
      this.activeView = null;
      noteActive(this, false);

      if (!activeView) {
        this.activeHost.replaceChildren();
        return;
      }

      try {
        this.generatedAutoPairs = activeView.getGeneratedAutoPairs();
      } catch (error) {
        this.generatedAutoPairs = Object.freeze([]);
        onDestroyError?.(error);
      }

      activeView.destroy();
      this.activeHost.replaceChildren();
    }

    private setState(state: "active" | "error" | "inactive" | "loading") {
      this.state = state;
      this.dom.setAttribute("data-mdw-code-block-state", state);
    }

    private isCurrentNode() {
      try {
        const current = this.outerView.state.doc.nodeAt(this.getPos());
        return current?.type === schema.nodes.code_block;
      } catch {
        return false;
      }
    }

    private isOuterSelectionInsideCodeBlock() {
      try {
        const blockPos = this.getPos();
        const codeStart = blockPos + 1;
        const codeEnd = blockPos + this.node.nodeSize - 1;
        const { selection } = this.outerView.state;
        return selection.from >= codeStart && selection.to <= codeEnd;
      } catch {
        return false;
      }
    }

    private getLanguageLabel() {
      const params = this.node.attrs.params;
      return typeof params === "string" ? params.trim() : "";
    }

    private handleStaticClipboardEvent(
      kind: "drop" | "paste",
      event: ClipboardEvent | DragEvent,
    ) {
      if (rejectFileTransferEvent(event) || !this.canEdit) {
        event.preventDefault();
        return true;
      }

      this.requestActivation(true);

      let handled: boolean | undefined;

      try {
        handled = kind === "paste"
          ? nestedClipboard?.handlePaste(event as ClipboardEvent, this.outerView)
          : nestedClipboard?.handleDrop(event as DragEvent, this.outerView);
      } catch (error) {
        event.preventDefault();
        throw error;
      }

      if (handled || event.defaultPrevented || !this.canEdit) {
        event.preventDefault();
        return true;
      }

      const transfer = readTransfer(event);

      if (!transfer) {
        event.preventDefault();
        return true;
      }

      const text = nestedClipboardText(
        this.outerView.dom.ownerDocument,
        transfer,
        nestedClipboard?.transformHtml,
        nestedClipboard?.transformText,
      );

      if (text == null) return false;

      if (!this.canEdit) {
        event.preventDefault();
        return true;
      }

      if (!text) {
        event.preventDefault();
        return true;
      }

      const blockPos = this.getPos();
      const codeStart = blockPos + 1;
      const codeEnd = blockPos + this.node.nodeSize - 1;
      const selection = this.outerView.state.selection;
      let from = Math.max(codeStart, Math.min(codeEnd, selection.from));
      let to = Math.max(codeStart, Math.min(codeEnd, selection.to));

      if (kind === "drop") {
        try {
          const drop = this.outerView.posAtCoords({
            left: (event as DragEvent).clientX,
            top: (event as DragEvent).clientY,
          })?.pos;

          if (drop != null) {
            from = to = Math.max(codeStart, Math.min(codeEnd, drop));
          }
        } catch {
          // Synthetic and protected drag events may not expose coordinates.
        }
      }

      const tr = this.outerView.state.tr.insertText(text, from, to);
      const cursor = Math.max(codeStart, Math.min(
        tr.doc.content.size,
        from + text.length,
      ));
      tr.setSelection(TextSelection.create(tr.doc, cursor));
      tr.setMeta("uiEvent", kind);
      isolateClipboardHistory(tr);
      event.preventDefault();
      this.outerView.dispatch(tr.scrollIntoView());
      return true;
    }

    private handleStaticCopy(event: ClipboardEvent) {
      const blockPos = this.getPos();
      const codeStart = blockPos + 1;
      const codeEnd = blockPos + this.node.nodeSize - 1;
      const selection = this.outerView.state.selection;

      if (selection.from < codeStart || selection.to > codeEnd) {
        return false;
      }

      const from = Math.max(codeStart, Math.min(codeEnd, selection.from));
      const to = Math.max(codeStart, Math.min(codeEnd, selection.to));

      if (from >= to) {
        event.preventDefault();
        return true;
      }

      const text = this.node.textContent.slice(from - codeStart, to - codeStart);
      let wrote = false;

      try {
        if (event.clipboardData) {
          event.clipboardData.clearData();
          event.clipboardData.setData("text/plain", text);
          wrote = true;
        }
      } catch {
        // The event is still owned so native DOM cut cannot mutate the shell.
      }

      event.preventDefault();

      if (event.type === "cut" && this.canEdit && wrote) {
        const tr = this.outerView.state.tr.delete(from, to);
        tr.setSelection(TextSelection.create(tr.doc, Math.min(from, tr.doc.content.size)));
        tr.setMeta("uiEvent", "cut");
        isolateClipboardHistory(tr);
        this.outerView.dispatch(tr.scrollIntoView());
      }

      return true;
    }
  }

  return CodeBlockView;
}
