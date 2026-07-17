import {
  Compartment,
  EditorSelection,
  EditorState as CodeMirrorState,
  MapMode,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Direction,
  EditorView as CodeMirrorView,
  keymap as codeMirrorKeymap,
  drawSelection,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { Selection, TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor } from "./managedBlockCursor";
import {
  createCodeBlockLanguageResolver,
  normalizeCodeBlockLanguage,
  type CodeBlockLanguageRegistry,
} from "./codeBlockLanguages";
import type { MarkdownEditorNestedClipboardPipeline } from "./extensionAssembly";
import {
  defaultMarkdownEditorMessages,
  type MarkdownEditorMessages,
} from "./editorMessages";
import { rejectFileTransferEvent } from "./fileTransferGuard";
import { isolateClipboardHistory, nestedClipboardText } from "./clipboardSemantics";
import {
  resolveMarkdownEditorShortcutKeys,
  type NormalizedMarkdownEditorShortcutMap,
} from "./shortcutConfig";
import {
  canOpenMarkdownEditorAutoPair,
  type MarkdownEditorCodeAutoPairSnapshot,
  type MarkdownEditorHistoryAction,
  type NormalizedMarkdownEditorAutoPair,
  type NormalizedMarkdownEditorTypingOptions,
} from "./typingErgonomics";

type CodeBlockViewInstance = {
  readonly composing: boolean;
  dom: HTMLElement;
  readonly hasFocus: boolean;
  getGeneratedAutoPairs: () => readonly MarkdownEditorCodeAutoPairSnapshot[];
  update: (node: ProseMirrorNode, historyAction?: MarkdownEditorHistoryAction | null) => boolean;
  setEditable: (editable: boolean) => void;
  selectNode: () => void;
  deselectNode: () => void;
  setSelection: (anchor: number, head: number) => void;
  stopEvent: (event: Event) => boolean;
  ignoreMutation: () => boolean;
  destroy: () => void;
};

type ActiveCodeBlockMount = {
  dom: HTMLElement;
  editorHost: HTMLElement;
  languageBadge: HTMLElement;
};

type CodeBlockViewConstructor = new (
  node: ProseMirrorNode,
  outerView: EditorView,
  getPos: () => number,
  mount?: ActiveCodeBlockMount,
  generatedAutoPairs?: readonly MarkdownEditorCodeAutoPairSnapshot[],
) => CodeBlockViewInstance;

type CodeBlockViewClass = CodeBlockViewConstructor & {
  setEditable: (editable: boolean) => void;
};

type CreateCodeBlockViewClassOptions = {
  schema: Schema;
  historyCommands: Readonly<{ redo: Command; undo: Command }>;
  languageRegistry?: CodeBlockLanguageRegistry;
  messages?: MarkdownEditorMessages;
  nestedClipboard?: MarkdownEditorNestedClipboardPipeline | null;
  shortcuts: NormalizedMarkdownEditorShortcutMap;
  typing: NormalizedMarkdownEditorTypingOptions;
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

type GeneratedCloserEffect = MarkdownEditorCodeAutoPairSnapshot;

type GeneratedCloserIdentity = Readonly<Pick<GeneratedCloserEffect, "close" | "position">>;

type GeneratedCloser = GeneratedCloserEffect;

const addGeneratedCloser = StateEffect.define<GeneratedCloserEffect>({
  map(value, mapping) {
    const openPosition = mapping.mapPos(value.openPosition, -1, MapMode.TrackAfter);
    const position = mapping.mapPos(value.position, -1, MapMode.TrackAfter);
    return openPosition == null || position == null
      ? undefined
      : { ...value, openPosition, position };
  },
});

const removeGeneratedCloser = StateEffect.define<GeneratedCloserIdentity>();
const syncGeneratedClosers = StateEffect.define<MarkdownEditorHistoryAction | null>();

function generatedCloserIsValid(
  doc: CodeMirrorState["doc"],
  value: GeneratedCloser,
) {
  return doc.sliceString(value.openPosition, value.openPosition + value.open.length) === value.open
    && doc.sliceString(value.position, value.position + value.close.length) === value.close;
}

const generatedCloserState = StateField.define<readonly GeneratedCloser[]>({
  create: () => Object.freeze([]),
  update(previous, transaction) {
    let next = previous;
    const historySync = transaction.effects.find((effect) => effect.is(syncGeneratedClosers));

    if (transaction.docChanged) {
      if (historySync && historySync.value == null) {
        next = [];
      } else {
        next = previous.flatMap((value) => {
          if (!value.active && !historySync) return [];
          const positionsAreMappable = value.openPosition <= transaction.startState.doc.length
            && value.position <= transaction.startState.doc.length;
          const openPosition = positionsAreMappable
            ? transaction.changes.mapPos(
                value.openPosition,
                1,
                MapMode.TrackAfter,
              )
            : null;
          const position = positionsAreMappable
            ? transaction.changes.mapPos(
                value.position,
                1,
                MapMode.TrackAfter,
              )
            : null;

          if (openPosition != null && position != null) {
            const mapped = { ...value, active: true, openPosition, position };
            if (generatedCloserIsValid(transaction.newDoc, mapped)) return [mapped];
          }

          if (historySync) {
            const original = { ...value, active: true };
            if (generatedCloserIsValid(transaction.newDoc, original)) return [original];
            return [{ ...value, active: false }];
          }

          return [];
        });
      }
    }

    for (const effect of transaction.effects) {
      if (effect.is(removeGeneratedCloser)) {
        next = next.filter((value) => (
          value.position !== effect.value.position || value.close !== effect.value.close
        ));
      } else if (effect.is(addGeneratedCloser)) {
        next = [...next, effect.value];
      }
    }

    return Object.freeze(next.length > 64 ? next.slice(-64) : next);
  },
});

function isCodeAutoPair(pair: NormalizedMarkdownEditorAutoPair) {
  return pair.autoClose && (pair.kind === "bracket" || pair.kind === "quote");
}

function hasGeneratedCloser(
  state: CodeMirrorState,
  position: number,
  close: string,
) {
  const tracked = state.field(generatedCloserState, false);
  return tracked?.some((value) => (
    value.active && value.position === position && value.close === close
  )) ?? false;
}

function findGeneratedCloser(
  state: CodeMirrorState,
  position: number,
  close: string,
) {
  return state.field(generatedCloserState, false)?.find((value) => (
    value.active && value.position === position && value.close === close
  ));
}

function skipGeneratedCloser(state: CodeMirrorState, close: string) {
  let rejected = false;
  const changes = state.changeByRange((range) => {
    if (
      range.empty
      && state.sliceDoc(range.head, range.head + close.length) === close
      && hasGeneratedCloser(state, range.head, close)
    ) {
      return {
        effects: removeGeneratedCloser.of({ close, position: range.head }),
        range: EditorSelection.cursor(range.head + close.length),
      };
    }

    rejected = true;
    return { range };
  });

  return rejected ? null : state.update(changes, {
    scrollIntoView: true,
    userEvent: "input.type",
  });
}

function insertGeneratedPair(
  state: CodeMirrorState,
  pair: NormalizedMarkdownEditorAutoPair,
  wrapSelection: boolean,
) {
  let rejected = false;
  const changes = state.changeByRange((range) => {
    if (!range.empty) {
      if (!wrapSelection) {
        rejected = true;
        return { range };
      }

      return {
        changes: [
          { from: range.from, insert: pair.open },
          { from: range.to, insert: pair.close },
        ],
        effects: addGeneratedCloser.of({
          active: true,
          close: pair.close,
          open: pair.open,
          openPosition: range.from,
          position: range.to + pair.open.length,
        }),
        range: EditorSelection.range(
          range.anchor + pair.open.length,
          range.head + pair.open.length,
        ),
      };
    }

    if (!canOpenMarkdownEditorAutoPair(
      pair,
      state.sliceDoc(0, range.head),
      state.sliceDoc(range.head),
    )) {
      rejected = true;
      return { range };
    }

    return {
      changes: { from: range.head, insert: `${pair.open}${pair.close}` },
      effects: addGeneratedCloser.of({
        active: true,
        close: pair.close,
        open: pair.open,
        openPosition: range.head,
        position: range.head + pair.open.length,
      }),
      range: EditorSelection.cursor(range.head + pair.open.length),
    };
  });

  return rejected ? null : state.update(changes, {
    scrollIntoView: true,
    userEvent: "input.type",
  });
}

function createCodeAutoPairExtensions(
  pairs: readonly NormalizedMarkdownEditorAutoPair[],
  wrapSelection: boolean,
): Extension[] {
  if (pairs.length === 0) return [];

  return [
    generatedCloserState,
    CodeMirrorView.inputHandler.of((view, from, to, text) => {
      if (view.compositionStarted || view.state.readOnly || text.length !== 1) return false;

      const selection = view.state.selection.main;
      if (selection.from !== from || selection.to !== to) return false;

      const closingPair = pairs.find((pair) => (
        pair.close === text && hasGeneratedCloser(view.state, selection.from, text)
      ));
      const transaction = closingPair
        ? skipGeneratedCloser(view.state, closingPair.close)
        : (() => {
            const openingPair = pairs.find((pair) => pair.trigger === text);
            return openingPair
              ? insertGeneratedPair(view.state, openingPair, wrapSelection)
              : null;
          })();

      if (!transaction) return false;
      view.dispatch(transaction);
      return true;
    }),
  ];
}

function deleteGeneratedPair(
  view: CodeMirrorView,
  pairs: readonly NormalizedMarkdownEditorAutoPair[],
) {
  if (view.compositionStarted || view.state.readOnly) return false;

  let rejected = false;
  const changes = view.state.changeByRange((range) => {
    const pair = range.empty ? pairs.find((candidate) => (
      view.state.sliceDoc(range.head - candidate.open.length, range.head) === candidate.open
      && view.state.sliceDoc(range.head, range.head + candidate.close.length) === candidate.close
      && hasGeneratedCloser(view.state, range.head, candidate.close)
    )) : undefined;
    const tracked = pair
      ? findGeneratedCloser(view.state, range.head, pair.close)
      : undefined;

    if (
      !pair
      || !tracked
    ) {
      rejected = true;
      return { range };
    }

    const from = range.head - pair.open.length;

    if (tracked.open !== pair.open || tracked.openPosition !== from) {
      return {
        changes: { from, to: range.head },
        range: EditorSelection.cursor(from),
      };
    }

    return {
      changes: { from, to: range.head + pair.close.length },
      range: EditorSelection.cursor(from),
    };
  });

  if (rejected) return false;
  view.dispatch(view.state.update(changes, {
    scrollIntoView: true,
    userEvent: "delete.backward",
  }));
  return true;
}

function containsNode(container: Node, value: unknown) {
  if (
    !value
    || typeof value !== "object"
    || typeof (value as { nodeType?: unknown }).nodeType !== "number"
  ) {
    return false;
  }

  try {
    return container.contains(value as Node);
  } catch {
    return false;
  }
}

// Returns a new class per call so each instance captures its own schema and
// language registry via the closure — intentional, not a leak.
export function createActiveCodeBlockViewClass(options: CreateCodeBlockViewClassOptions): CodeBlockViewClass {
  const {
    schema,
    historyCommands,
    languageRegistry,
    messages = defaultMarkdownEditorMessages,
    nestedClipboard,
    moveBeforeManagedBlock,
    onDestroyError,
    onLanguageLoadError,
    setManagedBlockBoundarySelection,
    shortcuts,
    typing,
  } = options;
  const codeAutoPairs = typing.autoPairs.filter(isCodeAutoPair);
  const codeAutoPairExtensions = createCodeAutoPairExtensions(
    codeAutoPairs,
    typing.wrapSelection,
  );
  const historyCandidatesByKey = new Map<string, Command[]>();
  const blockedHistoryKeys = new Set<string>();

  for (const contribution of [
    {
      command: historyCommands.undo,
      defaultKeys: ["Mod-z"],
      id: "@markora/core/undo",
    },
    {
      command: historyCommands.redo,
      defaultKeys: ["Shift-Mod-z", "Mod-y"],
      id: "@markora/core/redo",
    },
  ] as const) {
    const resolvedKeys = resolveMarkdownEditorShortcutKeys(
      shortcuts,
      contribution.id,
      contribution.defaultKeys,
    );

    for (const key of resolvedKeys) {
      const candidates = historyCandidatesByKey.get(key) ?? [];
      candidates.push(contribution.command);
      historyCandidatesByKey.set(key, candidates);
    }

    for (const defaultKey of resolveMarkdownEditorShortcutKeys(
      Object.freeze({}),
      contribution.id,
      contribution.defaultKeys,
    )) {
      if (!resolvedKeys.includes(defaultKey)) blockedHistoryKeys.add(defaultKey);
    }
  }

  for (const key of blockedHistoryKeys) {
    if (!historyCandidatesByKey.has(key)) {
      historyCandidatesByKey.set(key, []);
    }
  }

  const codeHistoryBindings = [...historyCandidatesByKey].map(([key, commands]) => ({
    blocked: blockedHistoryKeys.has(key),
    commands,
    key,
  }));
  const languageResolver = createCodeBlockLanguageResolver(languageRegistry);
  const instances = new Set<CodeBlockView>();

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

  function createLanguageLoadError(language: string, errors: unknown[]) {
    const error = new Error(`Failed to load the ${language || "plain text"} code-block language.`) as Error & {
      errors: unknown[];
    };
    error.name = "AggregateError";
    error.errors = errors;
    return error;
  }

  function asHTMLElement(value: Element | null) {
    return value && value.nodeType === 1 ? value as HTMLElement : null;
  }

  function getEditorRoot(view: EditorView) {
    return view.dom.getRootNode() as Node & {
      activeElement?: Element | null;
      host?: Element;
    };
  }

  function getActiveElement(view: EditorView) {
    const root = getEditorRoot(view);
    return asHTMLElement(root.activeElement ?? view.dom.ownerDocument.activeElement);
  }

  function isNeutralFocusAfterInternalBlur(view: EditorView, activeElement: Element | null) {
    const root = getEditorRoot(view);
    return (
      !activeElement
      || activeElement === view.dom.ownerDocument.body
      || (root.nodeType === 11 && activeElement === root.host)
    );
  }

  function blurElement(element: Element) {
    const blur = (element as Element & { blur?: unknown }).blur;

    if (typeof blur === "function") {
      blur.call(element);
    }
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
      const selection = view.state.selection;
      const activeElement = getActiveElement(view);
      const cmCursorLayer = asHTMLElement(cm.dom.querySelector(".cm-cursorLayer"));
      const cmCursor = asHTMLElement(cm.dom.querySelector(".cm-cursor"));

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

    get hasFocus() {
      return this.cm.hasFocus;
    }

    get composing() {
      return this.cm.compositionStarted;
    }

    private languageBadge: HTMLElement;
    private cm: CodeMirrorView;
    private updating = false;
    private suppressForwarding = false;
    private destroyed = false;
    private activeLanguage = "";
    private languageLoadVersion = 0;
    private unsubscribeLanguageLoad: (() => void) | null = null;
    private languageCompartment = new Compartment();
    private editableCompartment = new Compartment();
    private editable: boolean;
    private outerFocusTransferVersion = 0;
    private deferredInnerBlurVersion = 0;

    constructor(
      private node: ProseMirrorNode,
      private outerView: EditorView,
      private getPos: () => number,
      mount?: ActiveCodeBlockMount,
      generatedAutoPairs: readonly MarkdownEditorCodeAutoPairSnapshot[] = [],
    ) {
      const ownerDocument = this.ownerDocument;
      this.editable = outerView.editable;

      this.dom = mount?.dom ?? ownerDocument.createElement("div");
      this.languageBadge = mount?.languageBadge ?? ownerDocument.createElement("div");
      const editorHost = mount?.editorHost ?? ownerDocument.createElement("div");

      if (!mount) {
        this.dom.className = "mdw-code-block";
        this.languageBadge.className = "mdw-code-block-language";
        editorHost.className = "mdw-code-block-editor";
        this.dom.append(this.languageBadge, editorHost);
      }

      this.cm = new CodeMirrorView({
        root: this.getEditorRoot(),
        state: CodeMirrorState.create({
          doc: node.textContent,
          extensions: this.getExtensions(),
        }),
        parent: editorHost,
      });
      const restoredAutoPairs = generatedAutoPairs.filter((value) => (
        !value.active || generatedCloserIsValid(this.cm.state.doc, value)
      ));

      if (restoredAutoPairs.length > 0) {
        this.cm.dispatch({
          effects: restoredAutoPairs.map((value) => addGeneratedCloser.of(value)),
        });
      }
      this.cm.contentDOM.setAttribute("aria-label", messages.codeBlockEditorLabel);

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

    getGeneratedAutoPairs() {
      return Object.freeze([...(this.cm.state.field(generatedCloserState, false) ?? [])]);
    }

    update(
      node: ProseMirrorNode,
      historyAction: MarkdownEditorHistoryAction | null = null,
    ) {
      if (node.type !== schema.nodes.code_block) {
        return false;
      }

      this.applyEditable(this.outerView.editable);
      this.node = node;
      const language = this.getLanguageLabel();
      this.languageBadge.textContent = language || messages.codeBlockPlainTextLabel;
      this.syncLanguageSupport(language);

      if (!this.updating && this.cm.state.doc.toString() !== node.textContent) {
        this.runWhileUpdating(() => {
          this.cm.dispatch({
            changes: { from: 0, to: this.cm.state.doc.length, insert: node.textContent },
            effects: syncGeneratedClosers.of(historyAction),
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
        if (selection instanceof ManagedBlockCursor && this.cm.hasFocus) {
          // The managed-cursor plugin transfers focus in a microtask, after
          // transaction subscribers have had a chance to supersede it.
          this.suppressForwarding = true;
        } else {
          this.releaseInnerSelectionOwnership();
        }
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

    setEditable(editable: boolean) {
      this.applyEditable(editable);
    }

    stopEvent(event: Event) {
      const target = event.target;
      const isInside = containsNode(this.cm.dom, target);
      const isClipboard = event.type === "copy" || event.type === "cut";
      const ownsClipboard = isClipboard && containsNode(this.dom, target);

      if (isClipboard && (isInside || ownsClipboard)) {
        const selectionRoot = this.getEditorRoot() as Document | (ShadowRoot & {
          getSelection?: Document["getSelection"];
        });
        const domSelection = selectionRoot.getSelection?.() ?? this.ownerDocument.getSelection();
        const blockPos = this.getPos();
        const codeStart = blockPos + 1;
        const codeEnd = blockPos + this.node.nodeSize - 1;
        const modelSelection = this.outerView.state.selection;
        const outsideCode = modelSelection.from < codeStart || modelSelection.to > codeEnd;
        const containsWholeBlock = modelSelection.from <= blockPos
          && modelSelection.to >= blockPos + this.node.nodeSize;
        const crossesDom = Boolean(domSelection) && (
          containsNode(this.cm.dom, domSelection!.anchorNode)
            !== containsNode(this.cm.dom, domSelection!.focusNode)
        );

        if (crossesDom || (outsideCode && !containsWholeBlock)) {
          let text = domSelection?.toString() ?? "";
          const inner = this.cm.state.selection.main;
          const innerText = this.cm.state.sliceDoc(inner.from, inner.to);
          if (innerText && !text.includes(innerText)) {
            text = modelSelection.from < codeStart ? `${text}${innerText}` : `${innerText}${text}`;
          }
          const clipboardEvent = event as ClipboardEvent;
          try {
            clipboardEvent.clipboardData?.clearData();
            clipboardEvent.clipboardData?.setData("text/plain", text);
          } catch {
            // A cross-surface native cut must never mutate the NodeView DOM.
          }
          event.preventDefault();
          return true;
        }

        if (outsideCode) {
          return false;
        }
      }

      if (isInside && (event.type === "mousedown" || event.type === "pointerdown" || event.type === "touchstart")) {
        this.claimInnerSelection();
      }

      return isInside || ownsClipboard;
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
      this.cancelPendingLanguageLoad();
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

    private beginOuterFocusTransfer() {
      const transferVersion = ++this.outerFocusTransferVersion;
      this.deferredInnerBlurVersion = transferVersion;
      this.suppressForwarding = true;
      return transferVersion;
    }

    private finishOuterFocusTransfer(transferVersion: number) {
      if (this.deferredInnerBlurVersion === transferVersion) {
        this.deferredInnerBlurVersion = 0;
      }
    }

    private parkOuterFocusForTransfer() {
      const activeElement = getActiveElement(this.outerView);

      if (activeElement === this.outerView.dom) {
        return;
      }

      if (!activeElement || !this.cm.dom.contains(activeElement)) {
        return;
      }

      blurElement(activeElement);

      const activeAfterBlur = getActiveElement(this.outerView);

      if (
        activeAfterBlur !== this.outerView.dom
        && !isNeutralFocusAfterInternalBlur(this.outerView, activeAfterBlur)
      ) {
        return;
      }

      this.outerView.dom.focus();
    }

    private releaseInnerSelectionOwnership() {
      this.suppressForwarding = true;

      if (this.cm.hasFocus && this.deferredInnerBlurVersion === 0) {
        blurElement(this.cm.contentDOM);
      }
    }

    private scheduleOuterFocusAfterExit(transferVersion: number) {
      const ownerWindow = this.ownerWindow;

      requestFrame(ownerWindow, () => {
        if (this.outerView.isDestroyed) {
          this.finishOuterFocusTransfer(transferVersion);
          return;
        }

        const activeElement = getActiveElement(this.outerView);

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:before", () => ({
          activeElement: describeElement(activeElement),
        }));

        // A transaction subscriber may synchronously hand focus to a host
        // control (or explicitly blur the editor) before this frame runs. Only
        // complete the transfer while focus is still owned by this code block,
        // or has already reached the outer ProseMirror root.
        if (
          !activeElement
          || (
            activeElement !== this.outerView.dom
            && !this.dom.contains(activeElement)
          )
        ) {
          this.finishOuterFocusTransfer(transferVersion);
          return;
        }

        this.finishOuterFocusTransfer(transferVersion);

        if (this.cm.dom.contains(activeElement)) {
          blurElement(activeElement);

          const activeAfterBlur = getActiveElement(this.outerView);

          if (
            activeAfterBlur !== this.outerView.dom
            && !isNeutralFocusAfterInternalBlur(this.outerView, activeAfterBlur)
          ) {
            return;
          }
        }

        if (this.destroyed || this.isOuterSelectionInsideCodeBlock()) {
          return;
        }

        if (this.outerView.state.selection instanceof ManagedBlockCursor) {
          this.outerView.dom.focus();
        } else {
          this.outerView.focus();
        }

        logCodeBlockCursor(this.outerView, this.dom, this.cm, "scheduleOuterFocusAfterExit:after", () => ({
          activeElement: describeElement(getActiveElement(this.outerView)),
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

      this.cancelPendingLanguageLoad();
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

    private cancelPendingLanguageLoad() {
      this.unsubscribeLanguageLoad?.();
      this.unsubscribeLanguageLoad = null;
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

      let subscription: ReturnType<typeof languageResolver.subscribe>;

      try {
        subscription = languageResolver.subscribe(normalized, {
          onResolved: (extension) => {
            if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
              return;
            }

            this.unsubscribeLanguageLoad = null;
            this.applyLanguageSupport(extension, normalized, loadVersion);
          },
          onRejected: (error, reportSharedFailure) => {
            if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
              return false;
            }

            this.unsubscribeLanguageLoad = null;

            if (reportSharedFailure) {
              this.recoverFromLanguageLoadFailure(error, normalized, loadVersion);
            }

            return true;
          },
        });
      } catch (error) {
        this.recoverFromLanguageLoadFailure(error, normalized, loadVersion);
        return;
      }

      if (!this.isCurrentLanguageLoad(normalized, loadVersion)) {
        if (subscription.status === "pending") {
          subscription.unsubscribe();
        }

        return;
      }

      if (subscription.status === "missing") {
        this.applyLanguageSupport([], normalized, loadVersion, false);
        return;
      }

      if (subscription.status === "pending") {
        this.unsubscribeLanguageLoad = subscription.unsubscribe;
        this.applyLanguageSupport([], normalized, loadVersion, false);
        return;
      }

      this.applyLanguageSupport(subscription.extension, normalized, loadVersion);
    }

    private maybeEscapeHorizontal(direction: "left" | "right") {
      const selection = this.cm.state.selection.main;

      if (!selection.empty) {
        return false;
      }

      const textDirection = this.cm.textDirectionAt(selection.head);
      const forward = direction === "right"
        ? textDirection === Direction.LTR
        : textDirection === Direction.RTL;
      const nextSelection = this.cm.moveByChar(selection, forward);

      if (
        !nextSelection.eq(selection, true)
        || nextSelection.bidiLevel !== selection.bidiLevel
      ) {
        return false;
      }

      // At a visual document edge the logical position may be inside the
      // line when an opposing-direction run reaches that edge. CodeMirror's
      // visual move is the source of truth; `forward` still identifies the
      // corresponding outer document side.
      return this.exitCodeBlock(forward ? 1 : -1);
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

      const transferVersion = this.beginOuterFocusTransfer();
      this.parkOuterFocusForTransfer();
      this.runWhileUpdating(() => this.outerView.dispatch(tr.scrollIntoView()));
      this.scheduleOuterFocusAfterExit(transferVersion);
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
      const transferVersion = this.beginOuterFocusTransfer();
      const ownerWindow = this.ownerWindow;

      // Park focus on the stable outer root before replacing the node that
      // currently owns it. This preserves an ownership signal across the
      // intentional CodeMirror removal; a host subscriber can still supersede
      // it by focusing another control or blurring the editor during dispatch.
      this.parkOuterFocusForTransfer();

      this.runWhileUpdating(() => this.outerView.dispatch(tr.scrollIntoView()));

      requestFrame(ownerWindow, () => {
        this.finishOuterFocusTransfer(transferVersion);

        if (this.outerView.isDestroyed) {
          return;
        }

        const activeElement = getActiveElement(this.outerView);

        if (
          !activeElement
          || (
            activeElement !== this.outerView.dom
            && !this.dom.contains(activeElement)
          )
        ) {
          return;
        }

        if (this.cm.dom.contains(activeElement)) {
          blurElement(activeElement);

          const activeAfterBlur = getActiveElement(this.outerView);

          if (
            activeAfterBlur !== this.outerView.dom
            && !isNeutralFocusAfterInternalBlur(this.outerView, activeAfterBlur)
          ) {
            return;
          }
        }

        this.outerView.focus();
      });

      return true;
    }

    private exitCodeBlock(unit: -1 | 1) {
      const codeBlockPos = this.getPos();

      const transferVersion = this.beginOuterFocusTransfer();
      this.parkOuterFocusForTransfer();

      const handled =
        unit < 0
          ? moveBeforeManagedBlock(this.outerView, codeBlockPos)
          : setManagedBlockBoundarySelection(this.outerView, codeBlockPos, "after");

      if (handled) {
        this.scheduleOuterFocusAfterExit(transferVersion);
      } else {
        this.finishOuterFocusTransfer(transferVersion);

        if (getActiveElement(this.outerView) === this.outerView.dom) {
          this.cm.focus();
        }

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

      const transferVersion = this.beginOuterFocusTransfer();
      this.parkOuterFocusForTransfer();
      this.runWhileUpdating(() => {
        this.outerView.dispatch(this.outerView.state.tr.setSelection(targetSelection).scrollIntoView());
      });
      this.scheduleOuterFocusAfterExit(transferVersion);
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

    private forwardUpdate(clipboardEdit = false) {
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
      if (clipboardEdit) isolateClipboardHistory(tr);
      this.runWhileUpdating(() => this.outerView.dispatch(tr));
    }

    private applyOuterHistory(command: Command) {
      if (!this.canEdit || this.cm.compositionStarted || this.outerView.composing) {
        return false;
      }

      if (!command(this.outerView.state)) {
        return false;
      }

      const transferVersion = this.beginOuterFocusTransfer();

      this.parkOuterFocusForTransfer();

      const applied = command(this.outerView.state, this.outerView.dispatch, this.outerView);

      if (!applied) {
        this.finishOuterFocusTransfer(transferVersion);
        this.maybeResumeForwarding();
        return false;
      }

      if (this.outerView.isDestroyed) {
        this.finishOuterFocusTransfer(transferVersion);
        return true;
      }

      const activeElement = getActiveElement(this.outerView);

      if (
        !activeElement
        || (
          activeElement !== this.outerView.dom
          && !this.dom.contains(activeElement)
        )
      ) {
        this.finishOuterFocusTransfer(transferVersion);
        return true;
      }

      this.finishOuterFocusTransfer(transferVersion);

      if (this.destroyed) {
        this.outerView.focus();
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

      return this.maybeInsertClipboardText(kind, event);
    }

    private maybeInsertClipboardText(
      kind: "drop" | "paste",
      event: ClipboardEvent | DragEvent,
    ) {
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

      const text = nestedClipboardText(
        this.ownerDocument,
        transfer,
        nestedClipboard?.transformHtml,
        nestedClipboard?.transformText,
        true,
      );

      if (text == null) return false;

      if (!text) {
        event.preventDefault();
        return true;
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
        ...codeAutoPairExtensions,
        codeMirrorKeymap.of([
          {
            key: "Enter",
            run: () => this.forwardManagedBoundaryKey("Enter"),
          },
          {
            key: "ArrowLeft",
            run: () => this.maybeEscapeHorizontal("left"),
          },
          {
            key: "ArrowRight",
            run: () => this.maybeEscapeHorizontal("right"),
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
            run: () => (
              this.forwardManagedBoundaryKey("Backspace")
              || this.maybeUnwrapCodeBlockAtStart()
              || deleteGeneratedPair(this.cm, codeAutoPairs)
            ),
          },
          ...codeHistoryBindings.map(({ blocked, commands, key }) => ({
            key,
            run: () => commands.some((command) => this.applyOuterHistory(command)) || blocked,
          })),
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

          this.forwardUpdate(update.transactions.some((transaction) => (
            transaction.isUserEvent("input.paste")
            || transaction.isUserEvent("delete.cut")
            || transaction.isUserEvent("input.drop")
          )));
        }),
      ];
    }
  }

  return CodeBlockView;
}
