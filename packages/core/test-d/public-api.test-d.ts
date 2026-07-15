import { MarkdownEditorDestroyedError, createEditor, createDefaultCodeBlockLanguageRegistry, type CodeBlockLanguageRegistry, type CreateEditorOptions, type EditorUiFactory, type MarkdownEditor, type MarkdownEditorActiveMark, type MarkdownEditorActiveNode, type MarkdownEditorCommands, type MarkdownEditorDomAttributes, type MarkdownEditorErrorEvent, type MarkdownEditorEventMap, type MarkdownEditorMark, type MarkdownEditorSelectionSnapshot, type MarkdownEditorSelectionTarget, type MarkdownEditorState, type MarkdownEditorUi, type MarkdownEditorUnsubscribe, type OpaqueMarkdownEditRequest, type OpaqueMarkdownKind, type ToolbarState, type UpdateEditorOptions } from "../src/index";
import type { EditorView } from "prosemirror-view";

declare const hostElement: HTMLElement;

const domAttributes: MarkdownEditorDomAttributes = { "data-editor": "document" };
const initialSelection: MarkdownEditorSelectionTarget = { anchor: 1, head: 2 };
const options: CreateEditorOptions = {
  ariaLabel: "Document body",
  attributes: domAttributes,
  autofocus: true,
  editable: true,
  element: hostElement,
  initialSelection,
  placeholder: "Start writing",
};
const editor = createEditor(options);
const typedEditor: MarkdownEditor = editor;
const view: EditorView = editor.view;
const commands: MarkdownEditorCommands = editor.commands;
const stateApi: MarkdownEditorState = editor.state;
const toolbarState: ToolbarState = editor.getToolbarState();
const editorUi: MarkdownEditorUi | null = editor.ui;
const destroyed: boolean = editor.isDestroyed;

editor.focus("end");
editor.focus({ anchor: 1 });
editor.blur();

const updateOptions: UpdateEditorOptions = {
  ariaLabel: null,
  ariaLabelledBy: "document-heading",
  attributes: null,
  editable: false,
  onChange: null,
  onChangeMode: "animationFrame",
  onEditOpaqueMarkdown: null,
  onTransaction: null,
  placeholder: null,
};
editor.updateOptions(updateOptions);

const unsubscribeUpdate: MarkdownEditorUnsubscribe = editor.subscribe("update", (event) => {
  const type: "update" = event.type;
  const selection: MarkdownEditorSelectionSnapshot = event.selection;
  const currentEditor: MarkdownEditor = event.editor;
  void type;
  void selection;
  void currentEditor;
});
const unsubscribeSelection = editor.subscribe("selection", (event) => {
  const previous: MarkdownEditorSelectionSnapshot = event.previousSelection;
  const current: MarkdownEditorSelectionSnapshot = event.selection;
  void previous;
  void current;
});
const unsubscribeFocus = editor.subscribe("focus", (event) => {
  const nativeEvent: FocusEvent = event.nativeEvent;
  void nativeEvent;
});
const unsubscribeBlur = editor.subscribe("blur", (event) => {
  const nativeEvent: FocusEvent = event.nativeEvent;
  void nativeEvent;
});
const unsubscribeError = editor.subscribe("error", (event: MarkdownEditorErrorEvent) => {
  const code: "code-block-language-load-failed" = event.code;
  const recoverable: true = event.recoverable;
  const language: string = event.context.language;
  void code;
  void recoverable;
  void language;
});
const eventMap: MarkdownEditorEventMap = null as never;
unsubscribeUpdate();
unsubscribeSelection();
unsubscribeFocus();
unsubscribeBlur();
unsubscribeError();

const mark: MarkdownEditorMark = "strong";
commands.toggleMark(mark);
commands.setMarkdown("# Hello", { emitChange: true });
commands.setLink("https://example.com");
commands.insertImage({ src: "/image.png", alt: "demo", title: null });
commands.removeLink();
commands.removeImage();
commands.undo();
commands.redo();

stateApi.can.toggleMark("em");
stateApi.can.setLink();
stateApi.can.insertImage();
stateApi.can.undo();
stateApi.can.redo();

const activeMark: MarkdownEditorActiveMark = "link";
stateApi.isActive.mark(activeMark);
const activeNode: MarkdownEditorActiveNode = "code_block";
stateApi.isActive.node(activeNode);

editor.ui?.editLink();
editor.ui?.editImage();
editor.destroy();

const registry: CodeBlockLanguageRegistry = {
  custom: async () => [],
};
const defaultRegistry = createDefaultCodeBlockLanguageRegistry();
const maybeSupport = defaultRegistry.javascript;

if (typeof maybeSupport === "function") {
  void maybeSupport();
}

const uiFactory: EditorUiFactory = (_options) => {
  const linkUpdated: boolean = _options.updateLinkHref(view, "https://example.com");
  const imageUpdated: boolean = _options.updateActiveImage(view, { src: "/image.png", alt: null, title: null });
  void linkUpdated;
  void imageUpdated;

  return {
    enabled: true,
    clearSelectionAnchor() {},
    createSelectionAnchor() {
      return hostElement;
    },
    imageEditor: {
      open() {},
      close() {},
      destroy() {},
    },
    linkEditor: {
      open() {},
      close() {},
      destroy() {},
    },
    tableToolbar: {
      update() {},
      destroy() {},
    },
  };
};

const optionsWithUi: CreateEditorOptions = {
  element: hostElement,
  ui: uiFactory,
  codeBlockLanguages: registry,
};

const opaqueKind: OpaqueMarkdownKind = "frontmatter";
const optionsWithOpaqueEditor: CreateEditorOptions = {
  element: hostElement,
  onEditOpaqueMarkdown(request: OpaqueMarkdownEditRequest) {
    const kind: OpaqueMarkdownKind = request.kind;
    const source: string = request.source;
    const updated: boolean = request.update(source);
    void kind;
    void updated;
  },
};

void typedEditor;
void view;
void toolbarState;
void editorUi;
void destroyed;
void eventMap;
void optionsWithUi;
void opaqueKind;
void optionsWithOpaqueEditor;

const destroyedError = new MarkdownEditorDestroyedError("focus the editor");
const destroyedOperation: string = destroyedError.operation;
void destroyedOperation;

// @ts-expect-error link is active-only, not toggleable
commands.toggleMark("link");

// @ts-expect-error paragraph is not part of the public active-node surface
stateApi.isActive.node("paragraph");

// @ts-expect-error underline is not part of the public active-mark surface
stateApi.isActive.mark("underline");

// @ts-expect-error element is required
const invalidOptions: CreateEditorOptions = {};

void invalidOptions;

// @ts-expect-error unknown editor event
editor.subscribe("transaction", () => {});

// @ts-expect-error selection listeners receive a selection event, not an update event
editor.subscribe("selection", (event: MarkdownEditorEventMap["update"]) => event);

// @ts-expect-error invalid initial selection target
editor.focus("middle");

// @ts-expect-error DOM attribute values must be strings
editor.updateOptions({ attributes: { tabindex: 0 } });

// @ts-expect-error flat aliases were removed from the public API
editor.setMarkdown("next");
// @ts-expect-error flat aliases were removed from the public API
editor.toggleBold();
// @ts-expect-error flat aliases were removed from the public API
editor.setLink("https://example.com");
// @ts-expect-error flat aliases were removed from the public API
editor.editLink();
// @ts-expect-error flat aliases were removed from the public API
editor.undo();
