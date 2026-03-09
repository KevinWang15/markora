import { Compartment, EditorSelection, EditorState as CodeMirrorState, type Extension } from "@codemirror/state";
import { EditorView as CodeMirrorView, keymap as codeMirrorKeymap, drawSelection, lineNumbers } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css as cssLanguage } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { redo, undo } from "prosemirror-history";
import { Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor } from "./managedBlockCursor";

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
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  setManagedBlockBoundarySelection: (view: EditorView, blockPos: number, side: "before" | "after") => boolean;
};

export function createCodeBlockViewClass(options: CreateCodeBlockViewClassOptions): CodeBlockViewConstructor {
  const { schema, moveBeforeManagedBlock, setManagedBlockBoundarySelection } = options;

  function debugCodeBlockCursor(..._args: unknown[]) {
  }

  function logCodeBlockCursor(view: EditorView, codeBlockDom: HTMLElement, cm: CodeMirrorView, phase: string, extra: Record<string, unknown> = {}) {
    const selection = view.state.selection;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cmCursorLayer = cm.dom.querySelector(".cm-cursorLayer");
    const cmCursor = cm.dom.querySelector(".cm-cursor");

    debugCodeBlockCursor("[code-block-debug]", JSON.stringify({
      phase,
      selectionType: selection.constructor.name,
      from: selection.from,
      to: selection.to,
      outerHasManagedClass: view.dom.classList.contains("mdw-has-managed-block-cursor"),
      codeBlockClasses: Array.from(codeBlockDom.classList),
      cmFocused: cm.hasFocus,
      activeElement: activeElement ? {
        tag: activeElement.tagName,
        className: activeElement.className,
        contentEditable: activeElement.getAttribute("contenteditable"),
      } : null,
      cmCursorLayer: cmCursorLayer instanceof HTMLElement ? {
        className: cmCursorLayer.className,
        style: cmCursorLayer.getAttribute("style"),
        childCount: cmCursorLayer.childElementCount,
      } : null,
      cmCursor: cmCursor instanceof HTMLElement ? {
        className: cmCursor.className,
        style: cmCursor.getAttribute("style"),
      } : null,
      ...extra,
    }));
  }

  class CodeBlockView {
    dom: HTMLElement;
    private languageBadge: HTMLElement;
    private cm: CodeMirrorView;
    private updating = false;
    private suppressForwarding = false;
    private languageCompartment = new Compartment();

    constructor(
      private node: ProseMirrorNode,
      private outerView: EditorView,
      private getPos: () => number,
    ) {
      this.dom = document.createElement("div");
      this.dom.className = "mdw-code-block";

      this.languageBadge = document.createElement("div");
      this.languageBadge.className = "mdw-code-block-language";

      const editorHost = document.createElement("div");
      editorHost.className = "mdw-code-block-editor";
      this.dom.append(this.languageBadge, editorHost);

      this.cm = new CodeMirrorView({
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
      this.cm.dispatch({
        effects: this.languageCompartment.reconfigure(this.getLanguageExtension(language)),
      });

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
        logCodeBlockCursor(this.outerView, this.dom, this.cm, "update", { selectionInside, selectionOverlaps, suppressForwarding: this.suppressForwarding });
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
      return target instanceof Node && this.cm.dom.contains(target);
    }

    ignoreMutation() {
      return true;
    }

    destroy() {
      this.cm.destroy();
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
      requestAnimationFrame(() => {
        const activeElement = document.activeElement;

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:before", {
          activeElement: activeElement instanceof HTMLElement
            ? {
                tag: activeElement.tagName,
                className: activeElement.className,
                contentEditable: activeElement.getAttribute("contenteditable"),
              }
            : null,
        });

        if (activeElement instanceof HTMLElement && this.cm.dom.contains(activeElement)) {
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

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:after", {
          activeElement: document.activeElement instanceof HTMLElement
            ? {
                tag: document.activeElement.tagName,
                className: document.activeElement.className,
                contentEditable: document.activeElement.getAttribute("contenteditable"),
              }
            : null,
        });
      });
    }

    private maybeResumeForwarding() {
      if (this.cm.hasFocus && this.isOuterSelectionInsideCodeBlock()) {
        this.suppressForwarding = false;
      }
    }

    private getLanguageLabel() {
      const params = this.node.attrs.params;
      return typeof params === "string" ? params.trim() : "";
    }

    private getLanguageExtension(language: string): Extension {
      const normalized = language.toLowerCase();
      switch (normalized) {
        case "javascript":
        case "js":
          return javascript();
        case "typescript":
        case "ts":
          return javascript({ typescript: true });
        case "json":
          return json();
        case "css":
          return cssLanguage();
        case "html":
          return html();
        case "xml":
          return xml();
        case "markdown":
        case "md":
          return markdownLanguage();
        case "python":
        case "py":
          return python();
        case "c":
        case "cpp":
        case "c++":
          return cpp();
        case "java":
          return java();
        case "rust":
        case "rs":
          return rust();
        case "bash":
        case "sh":
        case "shell":
          return StreamLanguage.define(shell);
        default:
          return [];
      }
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

      requestAnimationFrame(() => {
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

      logCodeBlockCursor(this.outerView, this.dom, this.cm, "exitCodeBlock", { unit, handled, suppressForwarding: this.suppressForwarding });

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

      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
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
        this.languageCompartment.of(this.getLanguageExtension(language)),
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
