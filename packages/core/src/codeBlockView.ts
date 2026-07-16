import { Compartment, EditorSelection, EditorState as CodeMirrorState, type Extension } from "@codemirror/state";
import { EditorView as CodeMirrorView, keymap as codeMirrorKeymap, drawSelection, lineNumbers } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { redo, undo } from "prosemirror-history";
import { Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor } from "./managedBlockCursor";
import {
  createCodeBlockLanguageResolver,
  normalizeCodeBlockLanguage,
  type CodeBlockLanguageRegistry,
} from "./codeBlockLanguages";
import type { MarkdownEditorNestedClipboardPipeline } from "./extensionAssembly";
import { rejectFileTransferEvent } from "./fileTransferGuard";

type CodeBlockViewInstance = {
  dom: HTMLElement;
  update: (node: ProseMirrorNode) => boolean;
  selectNode: () => void;
  deselectNode: () => void;
  setSelection: (anchor: number, head: number) => void;
  stopEvent: (event: Event) => boolean;
  ignoreMutation: () => boolean;
  destroy: () => void;
};

type CodeBlockViewConstructor = new (
  node: ProseMirrorNode,
  outerView: EditorView,
  getPos: () => number,
) => CodeBlockViewInstance;

type CodeBlockViewClass = CodeBlockViewConstructor & {
  setEditable: (editable: boolean) => void;
};

type CreateCodeBlockViewClassOptions = {
  schema: Schema;
  languageRegistry?: CodeBlockLanguageRegistry;
  nestedClipboard?: MarkdownEditorNestedClipboardPipeline | null;
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  onDestroyError?: (error: unknown) => void;
  onLanguageLoadError?: (
    error: unknown,
    language: string,
    delivery: { defer: boolean; isCurrent: () => boolean },
  ) => void;
  setManagedBlockBoundarySelection: (view: EditorView, blockPos: number, side: "before" | "after") => boolean;
};

type BrowserWindow = Window & typeof globalThis;

const DEBUG_CODE_BLOCK_CURSOR = false;

const clipboardBlockElements = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

function htmlClipboardToText(ownerDocument: Document, html: string) {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;

  const readNode = (node: Node): string => {
    if (node.nodeType === 3) {
      return node.nodeValue ?? "";
    }

    if (node.nodeType !== 1 && node.nodeType !== 11) {
      return "";
    }

    if (node instanceof ownerDocument.defaultView!.HTMLElement && node.tagName === "BR") {
      return "\n";
    }

    let value = "";

    for (const child of node.childNodes) {
      value += readNode(child);
    }

    if (
      node instanceof ownerDocument.defaultView!.HTMLElement
      && clipboardBlockElements.has(node.tagName)
      && value
      && !value.endsWith("\n")
    ) {
      value += "\n";
    }

    return value;
  };

  return readNode(template.content).replace(/\n$/, "");
}

// Returns a new class per call so each instance captures its own schema and
// language registry via the closure — intentional, not a leak.
export function createCodeBlockViewClass(options: CreateCodeBlockViewClassOptions): CodeBlockViewClass {
  const {
    schema,
    languageRegistry,
    nestedClipboard,
    moveBeforeManagedBlock,
    onDestroyError,
    onLanguageLoadError,
    setManagedBlockBoundarySelection,
  } = options;
  const languageResolver = createCodeBlockLanguageResolver(languageRegistry);
  const instances = new Set<CodeBlockView>();
  const reportedLanguageFailures = new WeakSet<object>();

  function getOwnerWindow(view: EditorView): BrowserWindow {
    const ownerWindow = view.dom.ownerDocument.defaultView as BrowserWindow | null;

    if (!ownerWindow) {
      throw new Error("Markora code block view requires a window-backed document.");
    }

    return ownerWindow;
  }

  function requestFrame(ownerWindow: BrowserWindow, callback: FrameRequestCallback) {
    return typeof ownerWindow.requestAnimationFrame === "function"
      ? ownerWindow.requestAnimationFrame(callback)
      : ownerWindow.setTimeout(() => callback(Date.now()), 16);
  }

  function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
  }

  function createLanguageLoadError(language: string, errors: unknown[]) {
    const error = new Error(`Failed to load the ${language || "plain text"} code-block language.`) as Error & {
      errors: unknown[];
    };
    error.name = "AggregateError";
    error.errors = errors;
    return error;
  }

  function asHTMLElement(value: Element | null, ownerWindow: BrowserWindow) {
    return value instanceof ownerWindow.HTMLElement ? value : null;
  }

  function getActiveElement(ownerDocument: Document, ownerWindow: BrowserWindow) {
    return asHTMLElement(ownerDocument.activeElement, ownerWindow);
  }

  function describeElement(element: HTMLElement | null) {
    return element ? {
      tag: element.tagName,
      className: element.className,
      contentEditable: element.getAttribute("contenteditable"),
    } : null;
  }

  function debugCodeBlockCursor(factory: () => unknown) {
    if (!DEBUG_CODE_BLOCK_CURSOR) {
      return;
    }

    console.debug("[code-block-debug]", factory());
  }

  function logCodeBlockCursor(
    view: EditorView,
    codeBlockDom: HTMLElement,
    cm: CodeMirrorView,
    phase: string,
    extraFactory?: () => Record<string, unknown>,
  ) {
    if (!DEBUG_CODE_BLOCK_CURSOR) {
      return;
    }

    debugCodeBlockCursor(() => {
      const ownerDocument = view.dom.ownerDocument;
      const ownerWindow = getOwnerWindow(view);
      const selection = view.state.selection;
      const activeElement = getActiveElement(ownerDocument, ownerWindow);
      const cmCursorLayer = asHTMLElement(cm.dom.querySelector(".cm-cursorLayer"), ownerWindow);
      const cmCursor = asHTMLElement(cm.dom.querySelector(".cm-cursor"), ownerWindow);

      return {
        phase,
        selectionType: selection.constructor.name,
        from: selection.from,
        to: selection.to,
        outerHasManagedClass: view.dom.classList.contains("mdw-has-managed-block-cursor"),
        codeBlockClasses: Array.from(codeBlockDom.classList),
        cmFocused: cm.hasFocus,
        activeElement: describeElement(activeElement),
        cmCursorLayer: cmCursorLayer ? {
          className: cmCursorLayer.className,
          style: cmCursorLayer.getAttribute("style"),
          childCount: cmCursorLayer.childElementCount,
        } : null,
        cmCursor: cmCursor ? {
          className: cmCursor.className,
          style: cmCursor.getAttribute("style"),
        } : null,
        ...(extraFactory ? extraFactory() : {}),
      };
    });
  }

  class CodeBlockView {
    static setEditable(editable: boolean) {
      for (const instance of [...instances]) {
        instance.applyEditable(editable);
      }
    }

    dom: HTMLElement;
    private languageBadge: HTMLElement;
    private cm: CodeMirrorView;
    private updating = false;
    private suppressForwarding = false;
    private destroyed = false;
    private activeLanguage = "";
    private languageLoadVersion = 0;
    private languageCompartment = new Compartment();
    private editableCompartment = new Compartment();
    private editable: boolean;

    constructor(
      private node: ProseMirrorNode,
      private outerView: EditorView,
      private getPos: () => number,
    ) {
      const ownerDocument = this.ownerDocument;
      this.editable = outerView.editable;

      this.dom = ownerDocument.createElement("div");
      this.dom.className = "mdw-code-block";

      this.languageBadge = ownerDocument.createElement("div");
      this.languageBadge.className = "mdw-code-block-language";

      const editorHost = ownerDocument.createElement("div");
      editorHost.className = "mdw-code-block-editor";
      this.dom.append(this.languageBadge, editorHost);

      this.cm = new CodeMirrorView({
        root: this.getEditorRoot(),
        state: CodeMirrorState.create({
          doc: node.textContent,
          extensions: this.getExtensions(),
        }),
        parent: editorHost,
      });
      this.cm.contentDOM.setAttribute("aria-label", "Code block editor");

      try {
        this.update(node);
        instances.add(this);
      } catch (error) {
        this.destroyed = true;

        try {
          this.cm.destroy();
        } catch (destroyError) {
          onDestroyError?.(destroyError);
        }

        throw error;
      }
    }

    update(node: ProseMirrorNode) {
      if (node.type !== schema.nodes.code_block) {
        return false;
      }

      this.applyEditable(this.outerView.editable);
      this.node = node;
      const language = this.getLanguageLabel();
      this.languageBadge.textContent = language || "plain text";
      this.syncLanguageSupport(language);

      if (!this.updating && this.cm.state.doc.toString() !== node.textContent) {
        this.runWhileUpdating(() => {
          this.cm.dispatch({
            changes: { from: 0, to: this.cm.state.doc.length, insert: node.textContent },
          });
        });
      }

      const selection = this.outerView.state.selection;
      const codeBlockPos = this.getPos();
      const codeStart = codeBlockPos + 1;
      const codeEnd = codeBlockPos + this.node.nodeSize - 1;
      const selectionInside = selection.from >= codeStart && selection.to <= codeEnd;
      const selectionOverlaps = selection.from <= codeEnd && selection.to >= codeStart;
      if (!selectionInside) {
        this.releaseInnerSelectionOwnership();
      } else {
        this.maybeResumeForwarding();
      }

      const currentSelection = this.cm.state.selection.main;

      if (selectionOverlaps) {
        const innerAnchor = Math.max(0, Math.min(this.cm.state.doc.length, selection.anchor - codeStart));
        const innerHead = Math.max(0, Math.min(this.cm.state.doc.length, selection.head - codeStart));

        if (currentSelection.anchor !== innerAnchor || currentSelection.head !== innerHead) {
          this.runWhileUpdating(() => {
            this.cm.dispatch({
              selection: EditorSelection.range(innerAnchor, innerHead),
            });
          });
        }
      } else if (currentSelection.anchor !== currentSelection.head) {
        this.runWhileUpdating(() => {
          this.cm.dispatch({
            selection: EditorSelection.cursor(currentSelection.head),
          });
        });
      }

      if (selection instanceof ManagedBlockCursor) {
        logCodeBlockCursor(this.outerView, this.dom, this.cm, "update", () => ({ selectionInside, selectionOverlaps, suppressForwarding: this.suppressForwarding }));
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
      this.cm.focus();

      if (this.destroyed || this.outerView.isDestroyed) {
        return;
      }

      this.cm.dispatch({
        selection: EditorSelection.range(anchor, head),
        scrollIntoView: true,
      });
    }

    stopEvent(event: Event) {
      const target = event.target;
      const isInside = target instanceof this.ownerWindow.Node && this.cm.dom.contains(target);

      if (isInside && (event.type === "mousedown" || event.type === "pointerdown" || event.type === "touchstart")) {
        this.claimInnerSelection();
      }

      return isInside;
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      this.languageLoadVersion += 1;
      instances.delete(this);

      try {
        this.cm.destroy();
      } catch (error) {
        onDestroyError?.(error);
      }
    }

    private get ownerDocument() {
      return this.outerView.dom.ownerDocument;
    }

    private get ownerWindow() {
      return getOwnerWindow(this.outerView);
    }

    private get canEdit() {
      return !this.destroyed && this.outerView.editable && this.editable;
    }

    private getEditableExtensions(editable: boolean): Extension {
      return [
        CodeMirrorState.readOnly.of(!editable),
        CodeMirrorView.editable.of(editable),
        CodeMirrorView.contentAttributes.of({
          "aria-readonly": editable ? "false" : "true",
        }),
      ];
    }

    private applyEditable(editable: boolean) {
      if (this.destroyed || this.editable === editable) {
        return;
      }

      this.editable = editable;
      this.cm.dispatch({
        effects: this.editableCompartment.reconfigure(this.getEditableExtensions(editable)),
      });
    }

    private runWhileUpdating<T>(operation: () => T) {
      const wasUpdating = this.updating;
      this.updating = true;

      try {
        return operation();
      } finally {
        this.updating = wasUpdating;
      }
    }

    private isOuterSelectionInsideCodeBlock(selection = this.outerView.state.selection) {
      const codeBlockPos = this.getPos();
      const codeStart = codeBlockPos + 1;
      const codeEnd = codeBlockPos + this.node.nodeSize - 1;
      return selection.from >= codeStart && selection.to <= codeEnd;
    }

    private releaseInnerSelectionOwnership() {
      this.suppressForwarding = true;

      if (this.cm.hasFocus) {
        this.cm.contentDOM.blur();
      }
    }

    private scheduleOuterFocusAfterExit() {
      const ownerDocument = this.ownerDocument;
      const ownerWindow = this.ownerWindow;

      requestFrame(ownerWindow, () => {
        if (this.destroyed || this.outerView.isDestroyed) {
          return;
        }

        const activeElement = getActiveElement(ownerDocument, ownerWindow);

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:before", () => ({
          activeElement: describeElement(activeElement),
        }));

        if (activeElement && this.cm.dom.contains(activeElement)) {
          activeElement.blur();
        }

        if (this.isOuterSelectionInsideCodeBlock()) {
          return;
        }

        if (this.outerView.state.selection instanceof ManagedBlockCursor) {
          this.outerView.dom.focus();
        } else {
          this.outerView.focus();
        }

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:after", () => ({
          activeElement: describeElement(getActiveElement(ownerDocument, ownerWindow)),
        }));
      });
    }

    private maybeResumeForwarding() {
      if (this.cm.hasFocus && this.isOuterSelectionInsideCodeBlock()) {
        this.suppressForwarding = false;
      }
    }

    private claimInnerSelection() {
      if (this.updating) {
        return;
      }

      this.suppressForwarding = false;
      const pos = this.getPos();
      const selection = this.cm.state.selection.main;
      // A paste can update CodeMirror in the same cycle that focus is first
      // observed. Until forwardUpdate() replaces the outer node, clamp this
      // transient ownership claim to positions valid in the current node.
      const currentNodeLength = this.node.textContent.length;
      const anchor = pos + 1 + Math.min(selection.anchor, currentNodeLength);
      const head = pos + 1 + Math.min(selection.head, currentNodeLength);
      const outerSelection = this.outerView.state.selection;

      if (outerSelection.anchor === anchor && outerSelection.head === head) {
        return;
      }

      const tr = this.outerView.state.tr.setSelection(TextSelection.create(this.outerView.state.doc, anchor, head));
      tr.setMeta("addToHistory", false);
      this.runWhileUpdating(() => this.outerView.dispatch(tr));
    }

    private getEditorRoot(): Document | ShadowRoot {
      const rootNode = this.outerView.dom.getRootNode();
      const ShadowRootCtor = this.ownerWindow.ShadowRoot;
      return ShadowRootCtor && rootNode instanceof ShadowRootCtor ? rootNode : this.ownerDocument;
    }

    private getLanguageLabel() {
      const params = this.node.attrs.params;
      return typeof params === "string" ? params.trim() : "";
    }

    private syncLanguageSupport(language: string) {
      const normalized = normalizeCodeBlockLanguage(language);

      if (normalized === this.activeLanguage) {
        return;
      }

      this.activeLanguage = normalized;
      const loadVersion = ++this.languageLoadVersion;
      const ownerWindow = this.ownerWindow;

      // Language registries and CodeMirror extensions are public extension
      // points. Running either while ProseMirror is updating its node-view
      // tree lets host code re-enter the outer editor before that tree is
      // internally consistent. Always cross a microtask boundary first.
      ownerWindow.queueMicrotask(() => {
        this.resolveLanguageSupport(normalized, loadVersion);
      });
    }

    private isCurrentLanguageLoad(normalized: string, loadVersion: number) {
      return (
        !this.destroyed
        && loadVersion === this.languageLoadVersion
        && normalized === this.activeLanguage
      );
    }

    private reportLanguageLoadFailure(error: unknown, normalized: string, loadVersion: number) {
      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      onLanguageLoadError?.(error, normalized, {
        defer: false,
        isCurrent: () => this.isCurrentLanguageLoad(normalized, loadVersion),
      });
    }

    private recoverFromLanguageLoadFailure(error: unknown, normalized: string, loadVersion: number) {
      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      const errors = [error];

      try {
        this.cm.dispatch({
          effects: this.languageCompartment.reconfigure([]),
        });
      } catch (recoveryError) {
        errors.push(recoveryError);
      }

      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      this.reportLanguageLoadFailure(
        errors.length === 1
          ? error
          : createLanguageLoadError(normalized, errors),
        normalized,
        loadVersion,
      );
    }

    private applyLanguageSupport(
      extension: Extension,
      normalized: string,
      loadVersion: number,
      recoverOnFailure = true,
    ) {
      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      try {
        this.cm.dispatch({
          effects: this.languageCompartment.reconfigure(extension),
        });
      } catch (error) {
        if (recoverOnFailure) {
          this.recoverFromLanguageLoadFailure(error, normalized, loadVersion);
        } else {
          this.reportLanguageLoadFailure(error, normalized, loadVersion);
        }
      }
    }

    private resolveLanguageSupport(normalized: string, loadVersion: number) {
      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      let nextSupport: ReturnType<typeof languageResolver.resolve>;

      try {
        nextSupport = languageResolver.resolve(normalized);
      } catch (error) {
        this.recoverFromLanguageLoadFailure(error, normalized, loadVersion);
        return;
      }

      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        return;
      }

      if (!nextSupport) {
        this.applyLanguageSupport([], normalized, loadVersion, false);
        return;
      }

      if (isPromiseLike(nextSupport)) {
        this.applyLanguageSupport([], normalized, loadVersion, false);
        void nextSupport.then((extension) => {
          this.applyLanguageSupport(extension, normalized, loadVersion);
        }).catch((error: unknown) => {
          if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
            return;
          }

          if (!reportedLanguageFailures.has(nextSupport)) {
            reportedLanguageFailures.add(nextSupport);
            this.recoverFromLanguageLoadFailure(error, normalized, loadVersion);
          }
        });
        return;
      }

      this.applyLanguageSupport(nextSupport, normalized, loadVersion);
    }

    private maybeEscapeHorizontal(unit: -1 | 1) {
      const selection = this.cm.state.selection.main;

      if (!selection.empty) {
        return false;
      }

      if (unit < 0 && selection.from > 0) {
        return false;
      }

      if (unit > 0 && selection.to < this.cm.state.doc.length) {
        return false;
      }

      return this.exitCodeBlock(unit);
    }

    private maybeEscapeVertical(unit: -1 | 1) {
      const selection = this.cm.state.selection.main;

      if (!selection.empty) {
        return false;
      }

      const line = this.cm.state.doc.lineAt(selection.head);

      if (unit < 0 && line.number > 1) {
        return false;
      }

      if (unit > 0 && line.number < this.cm.state.doc.lines) {
        return false;
      }

      return this.exitCodeBlockVertically(unit);
    }

    private maybeExtendSelectionVertical(unit: -1 | 1) {
      const selection = this.cm.state.selection.main;
      const line = this.cm.state.doc.lineAt(selection.head);

      if (unit < 0 && line.number > 1) {
        return false;
      }

      if (unit > 0 && line.number < this.cm.state.doc.lines) {
        return false;
      }

      const outerHead = this.getVerticalSelectionExitHead(unit);

      if (outerHead == null) {
        return false;
      }

      const codeBlockPos = this.getPos();
      const outerAnchor = codeBlockPos + 1 + selection.anchor;
      const tr = this.outerView.state.tr.setSelection(TextSelection.create(this.outerView.state.doc, outerAnchor, outerHead));

      this.releaseInnerSelectionOwnership();
      this.runWhileUpdating(() => this.outerView.dispatch(tr.scrollIntoView()));
      this.scheduleOuterFocusAfterExit();
      return true;
    }

    private getVerticalSelectionExitHead(unit: -1 | 1) {
      const boundaryPos = unit < 0 ? this.getPos() : this.getPos() + this.node.nodeSize;
      const selection = Selection.findFrom(this.outerView.state.doc.resolve(boundaryPos), unit < 0 ? -1 : 1, true);

      if (!selection) {
        return null;
      }

      return selection.head;
    }

    private maybeUnwrapCodeBlockAtStart() {
      if (!this.canEdit) {
        return false;
      }

      const selection = this.cm.state.selection.main;

      if (!selection.empty || selection.from !== 0) {
        return false;
      }

      const codeBlockPos = this.getPos();
      const lines = this.node.textContent.split("\n");
      const paragraphType = this.outerView.state.schema.nodes.paragraph;
      const paragraphs = lines.length > 0
        ? lines.map((line) => paragraphType.create(null, line ? this.outerView.state.schema.text(line) : null))
        : [paragraphType.create()];
      const tr = this.outerView.state.tr.replaceWith(
        codeBlockPos,
        codeBlockPos + this.node.nodeSize,
        Fragment.fromArray(paragraphs),
      );

      tr.setSelection(TextSelection.create(tr.doc, codeBlockPos + 1));
      this.runWhileUpdating(() => this.outerView.dispatch(tr.scrollIntoView()));

      requestFrame(this.ownerWindow, () => {
        if (this.destroyed || this.outerView.isDestroyed) {
          return;
        }

        this.outerView.focus();
      });

      return true;
    }

    private exitCodeBlock(unit: -1 | 1) {
      const codeBlockPos = this.getPos();

      this.releaseInnerSelectionOwnership();

      const handled =
        unit < 0
          ? moveBeforeManagedBlock(this.outerView, codeBlockPos)
          : setManagedBlockBoundarySelection(this.outerView, codeBlockPos, "after");

      if (handled) {
        this.scheduleOuterFocusAfterExit();
      } else {
        this.maybeResumeForwarding();
      }

      logCodeBlockCursor(this.outerView, this.dom, this.cm, "exitCodeBlock", () => ({ unit, handled, suppressForwarding: this.suppressForwarding }));

      return handled;
    }

    private exitCodeBlockVertically(unit: -1 | 1) {
      const boundaryPos = unit < 0 ? this.getPos() : this.getPos() + this.node.nodeSize;
      const targetSelection = Selection.findFrom(this.outerView.state.doc.resolve(boundaryPos), unit < 0 ? -1 : 1, true);

      if (!targetSelection) {
        return this.exitCodeBlock(unit);
      }

      this.releaseInnerSelectionOwnership();
      this.runWhileUpdating(() => {
        this.outerView.dispatch(this.outerView.state.tr.setSelection(targetSelection).scrollIntoView());
      });
      this.scheduleOuterFocusAfterExit();
      return true;
    }

    private forwardSelection() {
      if (this.updating || !this.cm.hasFocus) {
        return;
      }

      if (this.suppressForwarding || !this.isOuterSelectionInsideCodeBlock()) {
        return;
      }

      const pos = this.getPos();
      const selection = this.cm.state.selection.main;
      const anchor = pos + 1 + selection.anchor;
      const head = pos + 1 + selection.head;
      const outerSelection = this.outerView.state.selection;

      if (outerSelection.anchor === anchor && outerSelection.head === head) {
        return;
      }

      const tr = this.outerView.state.tr.setSelection(TextSelection.create(this.outerView.state.doc, anchor, head));
      tr.setMeta("addToHistory", false);
      this.runWhileUpdating(() => this.outerView.dispatch(tr));
    }

    private forwardUpdate() {
      if (this.updating || !this.cm.hasFocus) {
        return;
      }

      const newText = this.cm.state.doc.toString();
      const isManagedCursorEdit =
        this.outerView.state.selection instanceof ManagedBlockCursor && newText !== this.node.textContent;

      if ((this.suppressForwarding || !this.isOuterSelectionInsideCodeBlock()) && !isManagedCursorEdit) {
        return;
      }

      if (isManagedCursorEdit) {
        this.suppressForwarding = false;
      }

      if (newText === this.node.textContent) {
        this.forwardSelection();
        return;
      }

      if (!this.canEdit) {
        return;
      }

      const pos = this.getPos();
      const selection = this.cm.state.selection.main;
      const tr = this.outerView.state.tr.replaceWith(
        pos + 1,
        pos + this.node.nodeSize - 1,
        newText ? this.outerView.state.schema.text(newText) : Fragment.empty,
      );
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + selection.anchor, pos + 1 + selection.head));
      this.runWhileUpdating(() => this.outerView.dispatch(tr));
    }

    private applyOuterHistory(command: typeof undo | typeof redo) {
      if (!this.canEdit) {
        return false;
      }

      const applied = command(this.outerView.state, this.outerView.dispatch);

      if (!applied) {
        return false;
      }

      if (this.destroyed || this.outerView.isDestroyed) {
        return true;
      }

      const { selection } = this.outerView.state;
      const codeBlockPos = this.getPos();
      const codeStart = codeBlockPos + 1;
      const codeEnd = codeBlockPos + this.node.nodeSize - 1;

      if (selection.from >= codeStart && selection.to <= codeEnd) {
        this.setSelection(selection.from - codeStart, selection.to - codeStart);
      } else {
        this.outerView.dom.focus();
      }

      return true;
    }

    private forwardManagedBoundaryKey(key: string) {
      if (!this.canEdit || !(this.outerView.state.selection instanceof ManagedBlockCursor)) {
        return false;
      }

      const event = new this.ownerWindow.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      let handled = false;

      this.outerView.someProp("handleKeyDown", (handler) => {
        if (handler(this.outerView, event)) {
          handled = true;
          return true;
        }

        return undefined;
      });

      return handled;
    }

    private handleNestedClipboardEvent(
      kind: "drop" | "paste",
      event: ClipboardEvent | DragEvent,
    ) {
      if (rejectFileTransferEvent(event)) {
        return true;
      }

      if (!this.canEdit) {
        return true;
      }

      const handled = kind === "paste"
        ? nestedClipboard?.handlePaste(event as ClipboardEvent, this.outerView)
        : nestedClipboard?.handleDrop(event as DragEvent, this.outerView);

      if (handled || event.defaultPrevented || !this.canEdit) {
        return true;
      }

      return this.maybeInsertTransformedHtml(kind, event);
    }

    private maybeInsertTransformedHtml(
      kind: "drop" | "paste",
      event: ClipboardEvent | DragEvent,
    ) {
      const transformHtml = nestedClipboard?.transformHtml;

      if (!transformHtml) {
        return false;
      }

      let transfer: DataTransfer | null;

      try {
        transfer = kind === "paste"
          ? (event as ClipboardEvent).clipboardData
          : (event as DragEvent).dataTransfer;
      } catch {
        return false;
      }

      if (!transfer) {
        return false;
      }

      let html: string;

      try {
        html = transfer.getData("text/html");
      } catch {
        return false;
      }

      if (!html) {
        return false;
      }

      const transformedHtml = transformHtml(html);

      if (transformedHtml === html) {
        return false;
      }

      let text = htmlClipboardToText(this.ownerDocument, transformedHtml);

      if (nestedClipboard?.transformText) {
        text = nestedClipboard.transformText(text);
      }

      if (!this.canEdit) {
        return true;
      }

      const selection = this.cm.state.selection.main;
      let from = selection.from;
      let to = selection.to;

      if (kind === "drop") {
        let dropPosition: number | null = null;

        try {
          dropPosition = this.cm.posAtCoords({
            x: (event as DragEvent).clientX,
            y: (event as DragEvent).clientY,
          }, false);
        } catch {
          // Synthetic or protected drag events may not expose usable coordinates.
        }

        from = to = dropPosition ?? selection.head;
      }

      this.cm.focus();

      if (!this.canEdit) {
        return true;
      }

      this.cm.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
        userEvent: kind === "paste" ? "input.paste" : "input.drop",
      });
      return true;
    }

    private getExtensions(): Extension[] {
      const language = this.getLanguageLabel();
      return [
        lineNumbers(),
        drawSelection(),
        CodeMirrorView.domEventHandlers({
          paste: (event) => this.handleNestedClipboardEvent("paste", event),
          dragover: (event) => rejectFileTransferEvent(event) || !this.canEdit,
          drop: (event) => this.handleNestedClipboardEvent("drop", event),
        }),
        ...(nestedClipboard?.transformText
          ? [CodeMirrorView.clipboardInputFilter.of((value) => (
              this.canEdit ? nestedClipboard.transformText!(value) : value
            ))]
          : []),
        CodeMirrorState.transactionFilter.of((transaction) => (
          transaction.docChanged && !this.updating && !this.canEdit ? [] : transaction
        )),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        this.languageCompartment.of([]),
        this.editableCompartment.of(this.getEditableExtensions(this.editable)),
        codeMirrorKeymap.of([
          {
            key: "Enter",
            run: () => this.forwardManagedBoundaryKey("Enter"),
          },
          {
            key: "ArrowLeft",
            run: () => this.maybeEscapeHorizontal(-1),
          },
          {
            key: "ArrowRight",
            run: () => this.maybeEscapeHorizontal(1),
          },
          {
            key: "ArrowUp",
            run: () => this.maybeEscapeVertical(-1),
          },
          {
            key: "ArrowDown",
            run: () => this.maybeEscapeVertical(1),
          },
          {
            key: "Shift-ArrowUp",
            run: () => this.maybeExtendSelectionVertical(-1),
          },
          {
            key: "Shift-ArrowDown",
            run: () => this.maybeExtendSelectionVertical(1),
          },
          {
            key: "Backspace",
            run: () => this.forwardManagedBoundaryKey("Backspace") || this.maybeUnwrapCodeBlockAtStart(),
          },
          {
            key: "Mod-z",
            run: () => this.applyOuterHistory(undo),
          },
          {
            key: "Shift-Mod-z",
            run: () => this.applyOuterHistory(redo),
          },
          {
            key: "Mod-y",
            run: () => this.applyOuterHistory(redo),
          },
          ...defaultKeymap,
          indentWithTab,
        ]),
        CodeMirrorView.updateListener.of((update) => {
          if (
            update.focusChanged &&
            update.view.hasFocus &&
            !(this.outerView.state.selection instanceof ManagedBlockCursor)
          ) {
            this.claimInnerSelection();
          }

          this.forwardUpdate();
        }),
      ];
    }
  }

  return CodeBlockView;
}
