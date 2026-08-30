import {
  MarkdownEditorDestroyedError,
  createDefaultCodeBlockLanguageRegistry,
  createEditor,
  defaultMarkdownEditorMessages,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
  type CodeBlockLanguageRegistry,
  type CodeBlockLanguageEditRequest,
  type CodeBlockLanguageEditorOverlay,
  type CreateEditorOptions,
  type EditorUiFactory,
  type MarkdownEditor,
  type MarkdownEditorActiveMark,
  type MarkdownEditorActiveNode,
  type MarkdownEditorBuiltinChangeOrigin,
  type MarkdownEditorChangeContext,
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorCodeBlockOptions,
  type MarkdownEditorCodeBlockRuntimeErrorEvent,
  type MarkdownEditorCommands,
  type MarkdownEditorDomAttributes,
  type MarkdownEditorErrorEvent,
  type MarkdownEditorEventMap,
  type MarkdownEditorExtensionOrigin,
  type MarkdownEditorHeadingLevel,
  type MarkdownEditorMark,
  type MarkdownEditorMarkdownUpdateOptions,
  type MarkdownEditorMessageOverrides,
  type MarkdownEditorMessages,
  type MarkdownEditorAssetUploadRequest,
  type MarkdownEditorAssetUploadResult,
  type MarkdownEditorSelectionSnapshot,
  type MarkdownEditorSelectionTarget,
  type MarkdownEditorShortcutMap,
  type MarkdownEditorState,
  type MarkdownEditorStateEvent,
  type MarkdownEditorTableAlignment,
  type MarkdownEditorTableColumnMoveDirection,
  type MarkdownEditorTableInsertOptions,
  type MarkdownEditorTableInsertSide,
  type MarkdownEditorTableIssue,
  type MarkdownEditorTableOperationErrorEvent,
  type MarkdownEditorTableResizeOptions,
  type MarkdownEditorTableRowMoveDirection,
  type MarkdownEditorTypingOptions,
  type MarkdownEditorUi,
  type MarkdownEditorUnsubscribe,
  type OpaqueMarkdownEditRequest,
  type OpaqueMarkdownKind,
  type UpdateEditorOptions,
} from "../src/index";
import type { EditorView } from "prosemirror-view";

declare const hostElement: HTMLElement;

const domAttributes: MarkdownEditorDomAttributes = { "data-editor": "document" };
const initialSelection: MarkdownEditorSelectionTarget = { anchor: 1, head: 2 };
const shortcuts: MarkdownEditorShortcutMap = {
  "@markora/core/bold": "Alt-b",
  "acme-extension/action": ["Ctrl-j", "Alt-j"],
  "@markora/core/italic": false,
};
const typing: MarkdownEditorTypingOptions = {
  autoPairs: ["parentheses", "double-quotes", "strong-asterisks"],
  wrapSelection: true,
};
const defaultMessages: MarkdownEditorMessages = defaultMarkdownEditorMessages;
const messages: MarkdownEditorMessageOverrides = {
  codeBlockPlainTextLabel: "texto sin formato",
  codeBlockEditLanguageLabel: ({ language, languageLabel }) => `${language}:${languageLabel}`,
  opaqueKindLabels: { frontmatter: "Cabecera" },
  opaqueSourceLabel: ({ kind, kindLabel }) => `${kind}:${kindLabel}`,
};
const options: CreateEditorOptions = {
  ariaLabel: "Document body",
  attributes: domAttributes,
  autofocus: true,
  editable: true,
  element: hostElement,
  initialSelection,
  messages,
  placeholder: "Start writing",
  resources: {
    links: { allowedProtocols: ["https:", "acme:"], allowRelative: false },
    images: {
      allowedDataMimeTypes: ["image/png"],
      allowedProtocols: ["https:", "data:"],
      crossOrigin: "anonymous",
      maxDataUrlBytes: 4096,
      maxDataUrlCharacters: 6000,
      referrerPolicy: "no-referrer",
    },
    resolveUrl({ kind, purpose, url }) {
      void kind;
      void purpose;
      return url;
    },
    openUrl({ event, kind, storedUrl, url }) {
      void event;
      void kind;
      void storedUrl;
      void url;
    },
    loadImage({ signal, storedUrl, url }) {
      void signal;
      void storedUrl;
      return { src: url, cleanup() {} };
    },
    assets: {
      allowedMimeTypes: ["image/*", "application/pdf"],
      maxFileBytes: 1024,
      maxFiles: 2,
      upload(request: MarkdownEditorAssetUploadRequest): MarkdownEditorAssetUploadResult {
        request.reportProgress(1);
        return { kind: "image", url: `/uploads/${request.file.name}` };
      },
    },
  },
  shortcuts,
  typing,
};
void defaultMessages;
const editor = createEditor(options);
const typedEditor: MarkdownEditor = editor;
const view: EditorView = editor.view;
const commands: MarkdownEditorCommands = editor.commands;
const stateApi: MarkdownEditorState = editor.state;
const editorUi: MarkdownEditorUi | null = editor.ui;
const destroyed: boolean = editor.isDestroyed;
const builtinOrigin: MarkdownEditorBuiltinChangeOrigin = "external";
const extensionOrigin: MarkdownEditorExtensionOrigin = "extension:collaboration";
const changeOrigin: MarkdownEditorChangeOrigin = extensionOrigin;
const changeContext: MarkdownEditorChangeContext = { origin: builtinOrigin };

editor.focus("end");
editor.focus({ anchor: 1 });
editor.blur();

const updateOptions: UpdateEditorOptions = {
  ariaLabel: null,
  ariaLabelledBy: "document-heading",
  attributes: null,
  editable: false,
  onChange: null,
  onEditOpaqueMarkdown: null,
  onTransaction: null,
  placeholder: null,
};
editor.updateOptions(updateOptions);

const unsubscribeUpdate: MarkdownEditorUnsubscribe = editor.subscribe("update", (event) => {
  const type: "update" = event.type;
  const origin: MarkdownEditorChangeOrigin = event.origin;
  const selection: MarkdownEditorSelectionSnapshot = event.selection;
  const currentEditor: MarkdownEditor = event.editor;
  void type;
  void origin;
  void selection;
  void currentEditor;
});
const unsubscribeSelection = editor.subscribe("selection", (event) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  const previous: MarkdownEditorSelectionSnapshot = event.previousSelection;
  const current: MarkdownEditorSelectionSnapshot = event.selection;
  void origin;
  void previous;
  void current;
});
const unsubscribeState = editor.subscribe("state", (event: MarkdownEditorStateEvent) => {
  const type: "state" = event.type;
  const docChanged: boolean = event.docChanged;
  const selectionChanged: boolean = event.selectionChanged;
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void type;
  void docChanged;
  void selectionChanged;
  void origin;
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
  if (event.code === "code-block-language-load-failed") {
    const recoverable: true = event.recoverable;
    const language: string = event.context.language;
    void recoverable;
    void language;
  } else if (event.code === "code-block-runtime-load-failed") {
    const runtimeEvent: MarkdownEditorCodeBlockRuntimeErrorEvent = event;
    const phase: "runtime" = event.context.phase;
    const language: string = event.context.language;
    const recoverable: true = event.recoverable;
    void runtimeEvent;
    void phase;
    void language;
    void recoverable;
  } else if (event.code === "table-operation-rejected") {
    const tableEvent: MarkdownEditorTableOperationErrorEvent = event;
    const phase: "clipboard" = event.context.phase;
    void tableEvent;
    void phase;
  } else {
    const phase: string = event.context.phase;
    const recoverable: boolean = event.recoverable;
    void phase;
    void recoverable;
  }
});
const unsubscribeAsset = editor.subscribe("asset", (event) => {
  const reason = event.reason;
  const status = event.upload.status;
  const fileName: string = event.upload.file.name;
  void reason;
  void status;
  void fileName;
});
const uploads = editor.assets.getUploads();
editor.assets.cancel(uploads[0]?.id ?? "missing");
editor.assets.retry(uploads[0]?.id ?? "missing");
const eventMap: MarkdownEditorEventMap = null as never;
unsubscribeUpdate();
unsubscribeSelection();
unsubscribeState();
unsubscribeFocus();
unsubscribeBlur();
unsubscribeError();
unsubscribeAsset();

const mark: MarkdownEditorMark = "strong";
commands.toggleMark(mark);
const markdownUpdateOptions: MarkdownEditorMarkdownUpdateOptions = { emitChange: true };
const reconciled: boolean = commands.reconcileMarkdown("# Reconciled", markdownUpdateOptions);
const resetResult: void = commands.resetMarkdown("# Reset", markdownUpdateOptions);
const pastedMarkdown: boolean = commands.pasteMarkdown("# Pasted");
const pastedPlainText: boolean = commands.pastePlainText("# Literal");
const canPasteMarkdown: boolean = stateApi.can.pasteMarkdown();
const canPastePlainText: boolean = stateApi.can.pastePlainText();
commands.setLink("https://example.com");
commands.insertImage({ src: "/image.png", alt: "demo", title: null });
commands.removeLink();
commands.removeImage();
const headingLevel: MarkdownEditorHeadingLevel = 3;
const codeBlockOptions: MarkdownEditorCodeBlockOptions = { language: "ts" };
const tableOptions: MarkdownEditorTableInsertOptions = { columns: 3, rows: 2 };
const tableAlignment: MarkdownEditorTableAlignment = "center";
const tableInsertSide: MarkdownEditorTableInsertSide = "before";
const tableResizeOptions: MarkdownEditorTableResizeOptions = { columns: 4, rows: 3 };
const tableRowMoveDirection: MarkdownEditorTableRowMoveDirection = "down";
const tableColumnMoveDirection: MarkdownEditorTableColumnMoveDirection = "right";
commands.setParagraph();
commands.setHeading(headingLevel);
commands.toggleBlockquote();
commands.toggleBulletList();
commands.toggleOrderedList();
commands.sinkListItem();
commands.liftListItem();
commands.toggleTaskList();
commands.setTaskChecked(true);
commands.insertHardBreak();
commands.insertHorizontalRule();
commands.setCodeBlock(codeBlockOptions);
commands.insertTable(tableOptions);
commands.addTableRow(tableInsertSide);
commands.addTableColumn("after");
commands.resizeTable(tableResizeOptions);
commands.moveTableRow(tableRowMoveDirection);
commands.moveTableColumn(tableColumnMoveDirection);
commands.deleteTableRow();
commands.deleteTableColumn();
commands.setTableColumnAlignment(tableAlignment);
commands.deleteTable();
commands.undo();
commands.redo();

const taggedTransaction = setMarkdownEditorTransactionOrigin(
  editor.view.state.tr,
  extensionOrigin,
);
const taggedOrigin: MarkdownEditorChangeOrigin | undefined =
  getMarkdownEditorTransactionOrigin(taggedTransaction);
const untaggedOrigin: MarkdownEditorChangeOrigin | undefined =
  getMarkdownEditorTransactionOrigin(editor.view.state.tr);

stateApi.can.toggleMark("em");
stateApi.can.setLink();
stateApi.can.removeLink();
stateApi.can.insertImage();
stateApi.can.removeImage();
stateApi.can.setParagraph();
stateApi.can.setHeading(headingLevel);
stateApi.can.toggleBlockquote();
stateApi.can.toggleBulletList();
stateApi.can.toggleOrderedList();
stateApi.can.sinkListItem();
stateApi.can.liftListItem();
stateApi.can.toggleTaskList();
stateApi.can.setTaskChecked(false);
stateApi.can.insertHardBreak();
stateApi.can.insertHorizontalRule();
stateApi.can.setCodeBlock(codeBlockOptions);
stateApi.can.insertTable(tableOptions);
stateApi.can.addTableRow(tableInsertSide);
stateApi.can.addTableColumn("after");
stateApi.can.resizeTable({ rows: 4, discardContent: true });
stateApi.can.moveTableRow("up");
stateApi.can.moveTableColumn("left");
stateApi.can.deleteTableRow();
stateApi.can.deleteTableColumn();
stateApi.can.setTableColumnAlignment(null);
stateApi.can.deleteTable();
stateApi.can.undo();
stateApi.can.redo();

const activeMark: MarkdownEditorActiveMark = "link";
stateApi.isActive.mark(activeMark);
const activeNode: MarkdownEditorActiveNode = "code_block";
stateApi.isActive.node(activeNode);
stateApi.isActive.paragraph();
stateApi.isActive.heading(headingLevel);
stateApi.isActive.blockquote();
stateApi.isActive.bulletList();
stateApi.isActive.orderedList();
stateApi.isActive.taskList();
stateApi.isActive.taskChecked(false);
stateApi.isActive.hardBreak();
stateApi.isActive.horizontalRule();
stateApi.isActive.codeBlock(codeBlockOptions);
stateApi.isActive.table();
stateApi.isActive.tableCellSelection();
stateApi.isActive.tableColumnAlignment(tableAlignment);

const tableIssues: readonly MarkdownEditorTableIssue[] = stateApi.tableIssues();
void tableIssues;

editor.ui?.createTable();
editor.ui?.editLink();
editor.ui?.editImage();
editor.ui?.editTable();
editor.ui?.editCodeBlockLanguage();
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
  const insertedColumn: boolean = _options.insertTableColumnAt(view, 1);
  const insertedRow: boolean = _options.insertTableRowAt(view, 1);
  const selectedColumn: boolean = _options.selectTableColumn(view, 0);
  const selectedRow: boolean = _options.selectTableRow(view, 0);
  void linkUpdated;
  void imageUpdated;
  void insertedColumn;
  void insertedRow;
  void selectedColumn;
  void selectedRow;

  const codeBlockLanguageEditor: CodeBlockLanguageEditorOverlay = {
    open(editorView, marker, request: CodeBlockLanguageEditRequest) {
      const language: string = request.language;
      const updated: boolean = request.update(language);
      request.cancel();
      void editorView;
      void marker;
      void updated;
      return true;
    },
    close() {},
    isComposing() {
      return false;
    },
    destroy() {},
  };

  return {
    enabled: true,
    clearSelectionAnchor() {},
    codeBlockLanguageEditor,
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
      focus() {
        return true;
      },
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
const referenceDefinitionKind: OpaqueMarkdownKind = "reference-definition";
void referenceDefinitionKind;
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

const optionsWithChangeContexts: CreateEditorOptions = {
  element: hostElement,
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
  onTransaction(transaction, currentView, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void transaction;
    void currentView;
    void origin;
  },
};

const shortCallbackOptions: CreateEditorOptions = {
  element: hostElement,
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, currentView) {
    void transaction;
    void currentView;
  },
};

const updateOptionsWithChangeContexts: UpdateEditorOptions = {
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
  onTransaction(transaction, currentView, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void transaction;
    void currentView;
    void origin;
  },
};

const shortCallbackUpdateOptions: UpdateEditorOptions = {
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, currentView) {
    void transaction;
    void currentView;
  },
};

void typedEditor;
void view;
void editorUi;
void destroyed;
void changeOrigin;
void changeContext;
void pastedMarkdown;
void pastedPlainText;
void canPasteMarkdown;
void canPastePlainText;
void eventMap;
void reconciled;
void resetResult;
void taggedOrigin;
void untaggedOrigin;
void optionsWithUi;
void opaqueKind;
void optionsWithOpaqueEditor;
void optionsWithChangeContexts;
void shortCallbackOptions;
void updateOptionsWithChangeContexts;
void shortCallbackUpdateOptions;

const destroyedError = new MarkdownEditorDestroyedError("focus the editor");
const destroyedOperation: string = destroyedError.operation;
void destroyedOperation;

// @ts-expect-error link is active-only, not toggleable
commands.toggleMark("link");

// @ts-expect-error video is not part of the public active-node surface
stateApi.isActive.node("video");

// @ts-expect-error heading levels are constrained to Markdown levels
commands.setHeading(7);

// @ts-expect-error table dimensions must be numeric
commands.insertTable({ rows: "2" });

// @ts-expect-error table alignment is a closed set
stateApi.can.setTableColumnAlignment("justify");

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

// @ts-expect-error built-in origins are reserved for Markora internals
setMarkdownEditorTransactionOrigin(editor.view.state.tr, "external");

// @ts-expect-error extension origins must use the extension namespace
const invalidExtensionOrigin: MarkdownEditorExtensionOrigin = "collaboration";

void invalidExtensionOrigin;

// @ts-expect-error DOM attribute values must be strings
editor.updateOptions({ attributes: { tabindex: 0 } });

// @ts-expect-error flat aliases were removed from the public API
editor.toggleBold();
// @ts-expect-error flat aliases were removed from the public API
editor.setLink("https://example.com");
// @ts-expect-error flat aliases were removed from the public API
editor.editLink();
// @ts-expect-error flat aliases were removed from the public API
editor.undo();
