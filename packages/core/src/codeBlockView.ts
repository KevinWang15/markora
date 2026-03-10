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

type CreateCodeBlockViewClassOptions = {
  schema: Schema;
  languageRegistry?: CodeBlockLanguageRegistry;
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  setManagedBlockBoundarySelection: (view: EditorView, blockPos: number, side: "before" | "after") => boolean;
};

type BrowserWindow = Window & typeof globalThis;

const DEBUG_CODE_BLOCK_CURSOR = false;

export function createCodeBlockViewClass(options: CreateCodeBlockViewClassOptions): CodeBlockViewConstructor {
  const { schema, languageRegistry, moveBeforeManagedBlock, setManagedBlockBoundarySelection } = options;
  const languageResolver = createCodeBlockLanguageResolver(languageRegistry);

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
    dom: HTMLElement;
    private languageBadge: HTMLElement;
    private cm: CodeMirrorView;
    private updating = false;
    private suppressForwarding = false;
    private destroyed = false;
    private activeLanguage = "";
    private languageLoadVersion = 0;
    private languageCompartment = new Compartment();

    constructor(
      private node: ProseMirrorNode,
      private outerView: EditorView,
      private getPos: () => number,
    ) {
      const ownerDocument = this.ownerDocument;

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

      this.update(node);
    }

    update(node: ProseMirrorNode) {
      if (node.type !== schema.nodes.code_block) {
        return false;
      }

      this.node = node;
      const language = this.getLanguageLabel();
      this.languageBadge.textContent = language || "plain text";
      this.syncLanguageSupport(language);

      if (!this.updating && this.cm.state.doc.toString() !== node.textContent) {
        this.cm.dispatch({
          changes: { from: 0, to: this.cm.state.doc.length, insert: node.textContent },
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
          this.updating = true;
          this.cm.dispatch({
            selection: EditorSelection.range(innerAnchor, innerHead),
          });
          this.updating = false;
        }
      } else if (currentSelection.anchor !== currentSelection.head) {
        this.updating = true;
        this.cm.dispatch({
          selection: EditorSelection.cursor(currentSelection.head),
        });
        this.updating = false;
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
      this.cm.dispatch({
        selection: EditorSelection.range(anchor, head),
        scrollIntoView: true,
      });
    }

    stopEvent(event: Event) {
      const target = event.target;
      return target instanceof this.ownerWindow.Node && this.cm.dom.contains(target);
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      this.destroyed = true;
      this.languageLoadVersion += 1;
      this.cm.destroy();
    }

    private get ownerDocument() {
      return this.outerView.dom.ownerDocument;
    }

    private get ownerWindow() {
      return getOwnerWindow(this.outerView);
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
      const nextSupport = languageResolver.resolve(normalized);
      const loadVersion = ++this.languageLoadVersion;

      if (!nextSupport) {
        this.cm.dispatch({
          effects: this.languageCompartment.reconfigure([]),
        });
        return;
      }

      if (isPromiseLike(nextSupport)) {
        this.cm.dispatch({
          effects: this.languageCompartment.reconfigure([]),
        });
        void nextSupport.then((extension) => {
          if (this.destroyed || loadVersion !== this.languageLoadVersion || normalized !== this.activeLanguage) {
            return;
          }

          this.cm.dispatch({
            effects: this.languageCompartment.reconfigure(extension),
          });
        }).catch(() => {
          if (this.destroyed || loadVersion !== this.languageLoadVersion || normalized !== this.activeLanguage) {
            return;
          }

          this.cm.dispatch({
            effects: this.languageCompartment.reconfigure([]),
          });
        });
        return;
      }

      this.cm.dispatch({
        effects: this.languageCompartment.reconfigure(nextSupport),
      });
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
      this.updating = true;
      this.outerView.dispatch(tr.scrollIntoView());
      this.updating = false;
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
      this.updating = true;
      this.outerView.dispatch(tr.scrollIntoView());
      this.updating = false;

      requestFrame(this.ownerWindow, () => {
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
      this.updating = true;
      this.outerView.dispatch(this.outerView.state.tr.setSelection(targetSelection).scrollIntoView());
      this.updating = false;
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
      this.updating = true;
      this.outerView.dispatch(tr);
      this.updating = false;
    }

    private forwardUpdate() {
      if (this.updating || !this.cm.hasFocus) {
        return;
      }

      if (this.suppressForwarding || !this.isOuterSelectionInsideCodeBlock()) {
        return;
      }

      const newText = this.cm.state.doc.toString();
      if (newText === this.node.textContent) {
        this.forwardSelection();
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
      this.updating = true;
      this.outerView.dispatch(tr);
      this.updating = false;
    }

    private applyOuterHistory(command: typeof undo | typeof redo) {
      const applied = command(this.outerView.state, this.outerView.dispatch);

      if (!applied) {
        return false;
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
      if (!(this.outerView.state.selection instanceof ManagedBlockCursor)) {
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

    private getExtensions(): Extension[] {
      const language = this.getLanguageLabel();
      return [
        lineNumbers(),
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        this.languageCompartment.of([]),
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
        CodeMirrorView.updateListener.of(() => {
          this.forwardUpdate();
        }),
      ];
    }
  }

  return CodeBlockView;
}
