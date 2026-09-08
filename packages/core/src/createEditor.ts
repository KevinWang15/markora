import { createElementInteractionPlugins, createManagedBlockBoundaryHelpers } from "./elementInteraction";
import { moveToElementBoundary } from "./elementNavigation";
import { baseKeymap,chainCommands,liftEmptyBlock,toggleMark } from "prosemirror-commands";
import { closeHistory,history,redo,undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { type NodeType,type Node as ProseMirrorNode } from "prosemirror-model";
import { liftListItem,sinkListItem } from "prosemirror-schema-list";
import {
EditorState,
NodeSelection,
Plugin,
Selection
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createInputRobustnessPlugin } from "./androidInput";
import { createAssetUploadController } from "./assetUploads";
import { createChangeEmitter } from "./changeEmitter";
import { createClipboardSemantics } from "./clipboardSemantics";
import { normalizeCodeBlockInfo } from "./codeBlockMarkdown";
import { createCodeBlockSelectionHelpers } from "./codeBlockSelection";
import { createCodeBlockViewClass } from "./codeBlockView";
import { buildReconciledDocumentTransaction } from "./documentUpdate";
import type {
CreateEditorOptions,
MarkdownEditor,
MarkdownEditorActiveMark,
MarkdownEditorActiveNode,
MarkdownEditorCommands,
MarkdownEditorMark,
MarkdownEditorMarkdownUpdateOptions,
MarkdownEditorState,
UpdateEditorOptions
} from "./editorApi";
import { createTypingShortcuts,getMarkInfo,isLinkActive,isMarkActive as isMarkdownMarkActive,type EditorCommand } from "./editorCommands";
import { blurElement,buildEditorDomAttributes,copyEditorAttributes,editorAttributesEqual,getEditorRootActiveElement,isActiveElementInsideEditor,normalizeAccessibleName,normalizePlaceholder } from "./editorDom";
import {
createEditorEventDispatcher,
MarkdownEditorDestroyedError
} from "./editorEvents";
import { observeEditorFocus } from "./editorFocus";
import {
normalizeMarkdownEditorMessages,
type MarkdownEditorMessages,
} from "./editorMessages";
import { createCodeBlockOuterSelectionPlugin,createCodeFenceEditingPlugin,createHeadingEditingPlugin,createHorizontalRulePlugin,createImagePlugin,createInputRuleRecoveryPlugin,createMarkBoundaryPlugin,createMarkdownRevealPlugin,type RevealMarkConfig } from "./editorPlugins";
import { getSelectionKind,resolveSelectionTarget,snapshotSelection as snapshotBaseSelection } from "./editorSelection";
import { createStateEventEmitter } from "./editorStateEvents";
import { createChangeContext,createTransactionDispatcher } from "./editorTransactionRuntime";
import { MarkdownEditorExtensionError } from "./extensionApi";
import { createMarkdownEditorExtensionAssembly } from "./extensionAssembly";
import { runInitialMarkdownParse } from "./extensionErrorBoundary";
import {
createDefaultMarkdownEditorPreset,
MARKORA_VERSION,
} from "./extensionPresets";
import { resolveMarkdownEditorExtensions } from "./extensionResolver";
import { assertEditorHostAvailable,claimEditorHost } from "./hostOwnership";
import { createHostIdleScheduler } from "./idleScheduler";
import { createImageViewClass } from "./imageView";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "./managedBlockCursor";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";
import {
createMarkdownCodec,
normalizeTableAlignment,
type MarkdownEditorCodec,
} from "./markdownCodec";
import { createMediaActionHelpers } from "./mediaActionUtils";
import { createNativeHistoryPlugin } from "./nativeHistory";
import type { OpaqueMarkdownEditRequest } from "./opaqueMarkdown";
import { createOpaqueNodeViewClass } from "./opaqueNodeView";
import { createPipeTableHelpers } from "./pipeTable";
import { createPlaceholderPlugin } from "./placeholderPlugin";
import { destroyProseMirrorView } from "./proseMirrorCompatibility";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
normalizeMarkdownEditorResources,
type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";
import { createCleanupError,disposeEditorRuntime,throwCollectedErrors } from "./runtimeErrors";
import {
createMarkdownEditorShortcutKeymap,
normalizeMarkdownEditorShortcuts,
} from "./shortcutConfig";
import {
createListItemBackspaceCommand,
createListItemDeleteCommand,
createListItemSplitCommand,
createStructuralCommandSet,
} from "./structuralCommands";
import { getTableSelectionContext as getSharedTableSelectionContext } from "./tableCommands";
import { createTableEditing,isTableCellSelection } from "./tableEditing";
import { getTableFidelityIssues } from "./tableFidelity";
import { createTableNavigation } from "./tableNavigation";
import type { TableCellInfo } from "./tableTypes";
import { createTaskListItemViewClass } from "./taskListItemView";
import { createTaskListHelpers } from "./taskListUtils";
import {
hasMarkdownEditorExternalUpdatePermission,
setBuiltinMarkdownEditorTransactionOrigin,
setMarkdownEditorExternalUpdatePermission,
setMarkdownEditorTransactionEmitChange,
type MarkdownEditorChangeContext
} from "./transactionOrigin";
import {
createAutoPairPlugin,
createTrackedHistoryCommand,
MARKDOWN_EDITOR_HISTORY_ACTION_META,
normalizeMarkdownEditorTypingOptions,
type MarkdownEditorHistoryAction,
} from "./typingErgonomics";
import type {
CodeBlockLanguageEditorOverlay,
EditorUiControllers,
ImageEditorOverlay,
LinkEditorOverlay,
TableToolbarOverlay,
TableUiContext
} from "./uiTypes";
import { createNoopUiControllers } from "./uiTypes";
export type {
CreateEditorOptions,
MarkdownEditor,
MarkdownEditorActiveMark,
MarkdownEditorActiveNode,
MarkdownEditorCodeBlockOptions,
MarkdownEditorCommands,
MarkdownEditorDomAttributes,
MarkdownEditorHeadingLevel,
MarkdownEditorMark,
MarkdownEditorMarkdownUpdateOptions,
MarkdownEditorSelectionTarget,
MarkdownEditorState,
MarkdownEditorTableAlignment,
MarkdownEditorTableColumnMoveDirection,
MarkdownEditorTableInsertOptions,
MarkdownEditorTableInsertSide,
MarkdownEditorTableIssue,
MarkdownEditorTableIssueCode,
MarkdownEditorTableResizeOptions,
MarkdownEditorTableRowMoveDirection,
MarkdownEditorUi,
UpdateEditorOptions
} from "./editorApi";
export { defaultMarkdownEditorMessages } from "./editorMessages";
export type {
MarkdownEditorCodeBlockLanguageMessageContext,
MarkdownEditorMessageOverrides,
MarkdownEditorMessages,
MarkdownEditorOpaqueMessageContext
} from "./editorMessages";
export { ManagedBlockCursor } from "./managedBlockCursor";
export type {
MarkdownEditorShortcutBinding,
MarkdownEditorShortcutMap
} from "./shortcutConfig";
export type {
MarkdownEditorAutoPair,
MarkdownEditorTypingOptions
} from "./typingErgonomics";

const snapshotSelection = (selection: Selection) => snapshotBaseSelection(selection, value => isTableCellSelection(value) ? "table-cell" : getSelectionKind(value));

type ActiveLineMarker = {
  pos: number;
  marker: string;
  className: string;
};

type AncestorInfo = {
  depth: number;
  node: ProseMirrorNode;
  pos: number;
};

type ActiveListItemInfo = {
  from: number;
  to: number;
};

type CodeBlockLanguageEditTarget = Readonly<{
  getPos: () => number;
  marker: HTMLElement;
  node: ProseMirrorNode;
  view: EditorView;
}>;


type BrowserWindow = Window & typeof globalThis;

type EditorRuntimeOptions = {
  ariaLabel: string | null | undefined;
  ariaLabelledBy: string | null | undefined;
  attributes: Record<string, string>;
  editable: boolean;
  onChange: ((markdown: string, context: MarkdownEditorChangeContext) => void) | undefined;
  onEditOpaqueMarkdown: ((request: OpaqueMarkdownEditRequest) => void) | undefined;
  onTransaction: CreateEditorOptions["onTransaction"];
  placeholder: string | null;
};

function syncReadonlyControls(view: EditorView) {
  const editable = view.editable;
  const ownerWindow = view.dom.ownerDocument.defaultView;

  for (const control of view.dom.querySelectorAll<HTMLElement>('[data-mdw-task-control="true"]')) {
    control.setAttribute("aria-disabled", editable ? "false" : "true");
    control.tabIndex = editable ? 0 : -1;

    if (ownerWindow && control instanceof ownerWindow.HTMLButtonElement) {
      control.disabled = !editable;
    }
  }
}

function createSchemaRuntimeHelpers(
  codec: MarkdownEditorCodec,
  messages: MarkdownEditorMessages,
  resources: NormalizedMarkdownEditorResources,
  onResourceError: (error: unknown, phase: MarkdownEditorResourceErrorPhase) => void,
) {
const { schema } = codec;
const { createTableCellContentFromMarkdown } = codec;
const {
  handleNativeTaskControlKeyDown,
  maybeToggleTaskListItem,
} = createTaskListHelpers(schema);
const {
  canSetLink,
  setLink,
  canInsertImage,
  insertImage,
  getActiveImageInfo,
  updateLinkHref,
  updateActiveImage,
  removeActiveImage,
  removeActiveLink,
  maybeEditActiveImage,
  maybeOpenImage,
  maybeOpenLink,
  maybeEditActiveLink,
} = createMediaActionHelpers({ schema, getMarkInfo, resources, onResourceError });
const {
  isEscapedOutsideBoundary,

  createEscapedBoundaryPlugin,
} = createMarkBoundaryHelpers({ getMarkInfo });

const revealMarkConfigs: RevealMarkConfig[] = [
  {
    markName: "strong",
    getMarkers: () => ({ start: "**", end: "**" }),
  },
  {
    markName: "em",
    getMarkers: () => ({ start: "*", end: "*" }),
  },
  {
    markName: "code",
    getMarkers: () => ({ start: "`", end: "`" }),
  },
  {
    markName: "strike",
    getMarkers: () => ({ start: "~~", end: "~~" }),
  },
  {
    markName: "link",
    getMarkers: (markInfo) => {
      const href = typeof markInfo.attrs?.href === "string" ? markInfo.attrs.href : "";
      return { start: "[", end: `](${href})` };
    },
  },
];

const ImageView = createImageViewClass({
  imageNodeType: schema.nodes.image,
  messages,
  onError: onResourceError,
  resources,
});

function getAncestorInfo(state: EditorState, nodeType: NodeType): AncestorInfo | null {
  const { selection } = state;

  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === nodeType) {
      return {
        depth,
        node: $from.node(depth),
        pos: $from.before(depth),
      };
    }
  }

  return null;
}

function isOnPrimaryListLine(state: EditorState) {
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === schema.nodes.list_item) {
      return $from.index(depth) === 0;
    }
  }

  return false;
}

function getActiveListItemInfo(state: EditorState): ActiveListItemInfo | null {
  const { selection } = state;

  if (!selection.empty || !isOnPrimaryListLine(state)) {
    return null;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === schema.nodes.list_item) {
      return {
        from: $from.before(depth),
        to: $from.after(depth),
      };
    }
  }

  return null;
}

function getActiveLineMarker(state: EditorState): ActiveLineMarker | null {
  const { selection } = state;

  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  const parent = $from.parent;
  const pos = $from.start();

  if (parent.type === schema.nodes.heading) {
    const level = parent.attrs.level;

    if (typeof level === "number" && level >= 1 && level <= 6) {
      return {
        pos,
        marker: `${"#".repeat(level)} `,
        className: "mdw-marker-heading",
      };
    }
  }

  const blockquote = getAncestorInfo(state, schema.nodes.blockquote);

  if (blockquote) {
    return {
      pos,
      marker: "> ",
      className: "mdw-marker-blockquote",
    };
  }

  return null;
}

function getTableCellContext(state: EditorState): TableCellInfo | null {
  return getSharedTableSelectionContext(state, schema);
}

function getTableUiContext(state: EditorState): TableUiContext | null {
  const info = getSharedTableSelectionContext(state, schema);

  if (!info) {
    return null;
  }

  let columnCount = 0;
  info.table.forEach((row) => {
    columnCount = Math.max(columnCount, row.childCount);
  });
  let selectedAlignment: TableUiContext["selectedAlignment"] | undefined;
  info.table.forEach((row) => {
    for (let column = info.columnFrom; column <= info.columnTo; column += 1) {
      const cell = row.maybeChild(column);
      if (!cell || selectedAlignment === "mixed") continue;
      const alignment = normalizeTableAlignment(cell.attrs.align);
      if (selectedAlignment === undefined) {
        selectedAlignment = alignment;
      } else if (selectedAlignment !== alignment) {
        selectedAlignment = "mixed";
      }
    }
  });

  return {
    tablePos: info.tablePos,
    cell: info.cell,
    isCellSelection: info.isCellSelection,
    selectedAlignment: selectedAlignment ?? null,
    rowIndex: info.rowIndex,
    columnIndex: info.cellIndex,
    rowCount: info.table.childCount,
    columnCount,
    selectedRowFrom: info.rowFrom,
    selectedRowTo: info.rowTo,
    selectedColumnFrom: info.columnFrom,
    selectedColumnTo: info.columnTo,
  };
}

const { maybeExtendSelectionAcrossCodeBlock } = createCodeBlockSelectionHelpers({ schema });

function isManagedBlockNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return isManagedBlockNodeFromSchema(schema, node, codec.managedBlocks);
}

const setManagedBlockBoundarySelection = (view: EditorView, pos: number, side: "before" | "after") =>
  moveToElementBoundary(view, pos, side, codec.managedBlocks);
const moveBeforeManagedBlock = (view: EditorView, pos: number) => setManagedBlockBoundarySelection(view, pos, "before");

const {
  insertParagraphAtManagedBlockBoundary,
  removeManagedBlockAtBoundary,
  getManagedBlockBoundary,
} = createManagedBlockBoundaryHelpers({
  schema,
  isManagedBlockNode,
});

const {
  createEmptyTableRow,
  addTableRow,
  addTableColumn,
  insertTableRowAt,
  insertTableColumnAt,
  selectTableRow,
  selectTableColumn,
  moveTableRow,
  moveTableRowTo,
  moveTableColumn,
  moveTableColumnTo,
  removeTableRow,
  removeTableColumn,
  setTableColumnAlignment,
  removeActiveTable,
  moveTableCellVertical,
  moveTableCell,
} = createTableNavigation({
  schema,
  getTableCellContext,
  moveBeforeManagedBlock,
  moveAfterManagedBlock: (view, blockPos) => setManagedBlockBoundarySelection(view, blockPos, "after"),
});

const { convertPipeTable } = createPipeTableHelpers({
  schema,
  createEmptyTableRow,
  createTableCellContentFromMarkdown,
});

  return {
    handleNativeTaskControlKeyDown,
    maybeToggleTaskListItem,
    canSetLink,
    setLink,
    canInsertImage,
    insertImage,
    getActiveImageInfo,
    updateLinkHref,
    updateActiveImage,
    removeActiveImage,
    removeActiveLink,
    maybeEditActiveImage,
    maybeOpenImage,
    maybeOpenLink,
    maybeEditActiveLink,
    isEscapedOutsideBoundary,

    createEscapedBoundaryPlugin,
    revealMarkConfigs,
    ImageView,
    getActiveListItemInfo,
    getActiveLineMarker,
    getTableUiContext,
    maybeExtendSelectionAcrossCodeBlock,
    isManagedBlockNode,
    setManagedBlockBoundarySelection,
    moveBeforeManagedBlock,
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
    createEmptyTableRow,
    addTableRow,
    addTableColumn,
    insertTableRowAt,
    insertTableColumnAt,
    selectTableRow,
    selectTableColumn,
    moveTableRow,
    moveTableRowTo,
    moveTableColumn,
    moveTableColumnTo,
    removeTableRow,
    removeTableColumn,
    setTableColumnAlignment,
    removeActiveTable,
    moveTableCellVertical,
    moveTableCell,
    convertPipeTable,
  };
}

export function createEditor(options: CreateEditorOptions): MarkdownEditor {
  const {
    autofocus = false,
    codeBlockLanguages,
    element,
    extensionPreset,
    extensions,
    initialSelection,
    markdown = "",
    shortcuts: shortcutOptions,
    typing: typingOptions,
    ui,
  } = options;
  const ownerWindow = element.ownerDocument.defaultView as BrowserWindow | null;

  if (!ownerWindow) {
    throw new Error("Markora requires a window-backed document.");
  }

  const shortcuts = normalizeMarkdownEditorShortcuts(shortcutOptions);
  const typing = normalizeMarkdownEditorTypingOptions(typingOptions);
  const messages = normalizeMarkdownEditorMessages(options.messages);
  const resources = normalizeMarkdownEditorResources(options.resources);
  let handleResourceError: (
    error: unknown,
    phase: MarkdownEditorResourceErrorPhase,
  ) => void = () => undefined;

  const extensionResolution = resolveMarkdownEditorExtensions({
    markoraVersion: MARKORA_VERSION,
    preset: extensionPreset ?? createDefaultMarkdownEditorPreset(),
    extensions,
  });
  const codec = createMarkdownCodec(extensionResolution.extensions, resources, messages);
  const { schema } = codec;
  const {
    handleNativeTaskControlKeyDown,
    maybeToggleTaskListItem,
    canSetLink,
    setLink,
    canInsertImage,
    insertImage,
    getActiveImageInfo,
    updateLinkHref,
    updateActiveImage,
    removeActiveImage,
    removeActiveLink,
    maybeEditActiveImage,
    maybeOpenImage,
    maybeOpenLink,
    maybeEditActiveLink,
    isEscapedOutsideBoundary,

    createEscapedBoundaryPlugin,
    revealMarkConfigs,
    ImageView,
    getActiveListItemInfo,
    getActiveLineMarker,
    getTableUiContext,
    maybeExtendSelectionAcrossCodeBlock,
    isManagedBlockNode,
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
    addTableRow,
    addTableColumn,
    insertTableRowAt,
    insertTableColumnAt,
    selectTableRow,
    selectTableColumn,
    moveTableRow,
    moveTableRowTo,
    moveTableColumn,
    moveTableColumnTo,
    removeTableRow,
    removeTableColumn,
    setTableColumnAlignment,
    removeActiveTable,
    moveTableCellVertical,
    moveTableCell,
    convertPipeTable,
  } = createSchemaRuntimeHelpers(
    codec,
    messages,
    resources,
    (error, phase) => handleResourceError(error, phase),
  );
  const idleScheduler = createHostIdleScheduler(ownerWindow);
  const doc = runInitialMarkdownParse(() => codec.parse(markdown));

  if (!doc) {
    throw new Error("Failed to create an empty ProseMirror document.");
  }

  // Canonicalize before claiming the host so extension serializer failures
  // cannot strand construction-owned DOM or host ownership.
  const initialMarkdown = codec.serialize(doc);
  assertEditorHostAvailable(element);

  const runtimeOptions: EditorRuntimeOptions = {
    ariaLabel: normalizeAccessibleName(options.ariaLabel, "ariaLabel"),
    ariaLabelledBy: normalizeAccessibleName(options.ariaLabelledBy, "ariaLabelledBy"),
    attributes: copyEditorAttributes(options.attributes, element.ownerDocument),
    editable: options.editable ?? true,
    onChange: options.onChange,
    onEditOpaqueMarkdown: options.onEditOpaqueMarkdown,
    onTransaction: options.onTransaction,
    placeholder: normalizePlaceholder(options.placeholder),
  };
  const resolvedInitialSelection = initialSelection
    ? resolveSelectionTarget(doc, initialSelection)
    : undefined;
  let lifecycle: "active" | "constructing" | "destroyed" | "destroying" = "constructing";
  let editor: MarkdownEditor;
  let creationComplete = false;

  const reportUnhandled = (error: unknown) => {
    const reportError = (ownerWindow as BrowserWindow & { reportError?: (error: unknown) => void }).reportError;

    if (typeof reportError === "function") {
      reportError.call(ownerWindow, error);
      return;
    }

    ownerWindow.setTimeout(() => {
      throw error instanceof Error ? error : new Error(String(error));
    }, 0);
  };
  const eventDispatcher = createEditorEventDispatcher(reportUnhandled);
  handleResourceError = (error, phase) => {
    if (lifecycle === "destroying") {
      collectViewError(error);
      return;
    }
    if (lifecycle === "destroyed") {
      return;
    }

    const deliver = () => {
      if (!editor || lifecycle !== "active" || view.isDestroyed) {
        return;
      }
      const delivered = eventDispatcher.emit("error", {
        code: "resource-callback-failed",
        context: { phase },
        editor,
        error,
        recoverable: true,
        type: "error",
      });
      if (delivered === 0) {
        reportUnhandled(error);
      }
    };

    if (!creationComplete) {
      ownerWindow.queueMicrotask(deliver);
    } else {
      deliver();
    }
  };
  const pendingExtensionErrors: Array<{
    error: MarkdownEditorExtensionError;
    useGlobalFallback: boolean;
  }> = [];
  const reportExtensionError = (
    error: MarkdownEditorExtensionError,
    useGlobalFallback = true,
  ) => {
    if (lifecycle === "destroying" || lifecycle === "destroyed") {
      return false;
    }

    if (!creationComplete) {
      pendingExtensionErrors.push({ error, useGlobalFallback });
      return false;
    }

    const delivered = eventDispatcher.emit("error", {
      code: error.code as `EXTENSION_${string}`,
      context: {
        phase: error.phase,
        ...(error.extension ? { extension: error.extension } : {}),
        ...(error.contribution ? { contribution: error.contribution } : {}),
        ...(error.participants ? { participants: error.participants } : {}),
      },
      editor,
      error,
      recoverable: true,
      type: "error",
    });

    if (delivered === 0 && useGlobalFallback) {
      reportUnhandled(error);
    }
    return delivered > 0;
  };
  const synchronouslyReportedExtensionErrors = new WeakSet<MarkdownEditorExtensionError>();
  const runReportedExtensionOperation = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof MarkdownEditorExtensionError) {
        if (reportExtensionError(error, false)) {
          synchronouslyReportedExtensionErrors.add(error);
          ownerWindow.queueMicrotask(() => synchronouslyReportedExtensionErrors.delete(error));
        }
      }

      throw error;
    }
  };
  const extensionAssembly = createMarkdownEditorExtensionAssembly({
    resolution: extensionResolution,
    codec,
    ownerDocument: element.ownerDocument,
    shortcuts,
    reservedNodeViews: ["code_block", "image", "raw_block", "raw_inline"],
    reportError: reportExtensionError,
  });

  const listItemType = schema.nodes.list_item;
  const listBackspaceForInput = createListItemBackspaceCommand(listItemType);
  const listDeleteForInput = createListItemDeleteCommand(listItemType);
  const splitListItemForInput = createListItemSplitCommand(listItemType);
  const structuralCommandSet = createStructuralCommandSet(schema);
  const createToggleMarkCommand = (name: MarkdownEditorMark): EditorCommand => {
    const markType = schema.marks[name];
    return markType ? toggleMark(markType) : () => false;
  };
  const trackedUndo = createTrackedHistoryCommand(undo, "undo");
  const trackedRedo = createTrackedHistoryCommand(redo, "redo");
  const commands = {
    toggleBold: createToggleMarkCommand("strong"),
    toggleItalic: createToggleMarkCommand("em"),
    toggleCode: createToggleMarkCommand("code"),
    toggleStrike: createToggleMarkCommand("strike"),
    undo: trackedUndo,
    redo: trackedRedo,
  } satisfies Record<string, EditorCommand>;
  const pendingLanguageLoadErrors: Array<{ error: unknown; language: string }> = [];
  const pluginInitializationErrors: unknown[] = [];
  const deferredViewErrors: unknown[] = [];
  let activeViewErrorCollector: unknown[] | null = null;

  const collectViewError = (error: unknown) => {
    (activeViewErrorCollector ?? deferredViewErrors).push(error);
  };

  const runWithViewErrorCollector = <T>(
    errors: unknown[],
    operation: () => T,
  ) => {
    const previousCollector = activeViewErrorCollector;
    activeViewErrorCollector = errors;

    try {
      return operation();
    } finally {
      activeViewErrorCollector = previousCollector;
    }
  };
  let uiControllers!: EditorUiControllers;
  let unmountUi: (() => void) | undefined;
  let codeBlockLanguageEditor: CodeBlockLanguageEditorOverlay | null = null;
  let imageEditor!: ImageEditorOverlay;
  let linkEditor!: LinkEditorOverlay;
  let tableToolbar!: TableToolbarOverlay;
  let uiEnabled = false;
  let uiFactoryReturned = false;
  let codeBlockLanguageEditVersion = 0;
  let codeBlockHistoryAction: MarkdownEditorHistoryAction | null = null;
  let openCodeBlockLanguageEditor = (_target: CodeBlockLanguageEditTarget) => false;
  const CodeBlockView = createCodeBlockViewClass({
    getOnEditLanguage: () => (
      uiEnabled && codeBlockLanguageEditor ? openCodeBlockLanguageEditor : null
    ),
    getHistoryAction: () => codeBlockHistoryAction,
    historyCommands: { redo: trackedRedo, undo: trackedUndo },
    languageRegistry: codeBlockLanguages,
    messages,
    nestedClipboard: extensionAssembly.contributions.nestedClipboard,
    shortcuts,
    typing,
    onActivationError(error, language, delivery) {
      const deliver = () => {
        if (
          lifecycle !== "active"
          || !editor
          || view.isDestroyed
          || !delivery.isCurrent()
        ) {
          return;
        }

        const delivered = eventDispatcher.emit("error", {
          code: "code-block-runtime-load-failed",
          context: { language, phase: "runtime" },
          editor,
          error,
          recoverable: true,
          type: "error",
        });

        if (delivered === 0) {
          reportUnhandled(error);
        }
      };

      if (delivery.defer || !editor) {
        ownerWindow.queueMicrotask(deliver);
      } else {
        deliver();
      }
    },
    onLanguageLoadError(error, language, delivery) {
      if (lifecycle !== "active") {
        return;
      }

      if (!editor) {
        pendingLanguageLoadErrors.push({ error, language });
        return;
      }

      const deliver = () => {
        if (
          lifecycle !== "active"
          || view.isDestroyed
          || !delivery.isCurrent()
        ) {
          return;
        }

        const delivered = eventDispatcher.emit("error", {
          code: "code-block-language-load-failed",
          context: { language },
          editor,
          error,
          recoverable: true,
          type: "error",
        });

        if (delivered === 0) {
          reportUnhandled(error);
        }
      };

      if (delivery.defer) {
        ownerWindow.queueMicrotask(deliver);
      } else {
        deliver();
      }
    },
    onDestroyError(error) {
      collectViewError(error);
    },
    schema,
    moveBeforeManagedBlock: (view, pos) => moveToElementBoundary(view, pos, "before", codec.managedBlocks),
    setManagedBlockBoundarySelection: (view, pos, side) => moveToElementBoundary(view, pos, side, codec.managedBlocks),
  });
  const TaskListItemView = createTaskListItemViewClass(schema.nodes.list_item, messages);
  const RawBlockView = createOpaqueNodeViewClass({
    display: "block",
    getOnEdit: () => runtimeOptions.onEditOpaqueMarkdown,
    messages,
    nodeType: schema.nodes.raw_block,
  });
  const RawInlineView = createOpaqueNodeViewClass({
    display: "inline",
    getOnEdit: () => runtimeOptions.onEditOpaqueMarkdown,
    messages,
    nodeType: schema.nodes.raw_inline,
  });
  let releaseHostOwnership: () => void;

  const canRunUiAction = (targetView: EditorView) => (
    lifecycle === "active"
    && !targetView.isDestroyed
    && targetView.editable
  );
  const canRunUiMutation = (targetView: EditorView) => (
    canRunUiAction(targetView)
    && !targetView.composing
    && !CodeBlockView.isComposing()
  );
  const runUiTableMutation = (
    targetView: EditorView,
    action: () => boolean,
  ) => canRunUiMutation(targetView) && action();
  const runUiStructuralCommand = (targetView: EditorView, command: EditorCommand) => {
    if (!canRunUiMutation(targetView)) {
      return false;
    }

    return command(
      targetView.state,
      (transaction) => {
        setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
        targetView.dispatch(transaction);
      },
      targetView,
    );
  };

  try {
    releaseHostOwnership = claimEditorHost(element);
  } catch (error) {
    extensionAssembly.beginDestroy();
    const cleanupErrors = extensionAssembly.cleanupAssembly();
    throwCollectedErrors(
      "Markora host ownership failed and extension cleanup also failed.",
      [error, ...cleanupErrors],
    );
    throw error;
  }

  try {
    uiControllers = ui?.({
      updateLinkHref: (view, href) => canRunUiAction(view) && updateLinkHref(view, href),
      removeActiveLink: (view) => { if (canRunUiAction(view)) removeActiveLink(view); },
      updateActiveImage: (view, attrs) => {
        if (!canRunUiAction(view)) {
          return false;
        }

        const src = attrs.src;

        if (!canRunUiAction(view)) {
          return false;
        }

        const alt = attrs.alt;

        if (!canRunUiAction(view)) {
          return false;
        }

        const title = attrs.title;
        return canRunUiAction(view) && updateActiveImage(view, { src, alt, title });
      },
      removeActiveImage: (view) => { if (canRunUiAction(view)) removeActiveImage(view); },
      hostElement: element,
      addTableColumn: (view, side) => runUiTableMutation(view, () => addTableColumn(view, side)),
      addTableRow: (view, side) => runUiTableMutation(view, () => addTableRow(view, side)),
      insertTableColumnAt: (view, index) => runUiTableMutation(
        view,
        () => insertTableColumnAt(view, index),
      ),
      insertTableRowAt: (view, index) => runUiTableMutation(
        view,
        () => insertTableRowAt(view, index),
      ),
      insertTable: (view, dimensions) => {
        const handled = runUiStructuralCommand(
          view,
          structuralCommandSet.commands.insertTable(dimensions),
        );

        if (handled && lifecycle === "active" && !view.isDestroyed) {
          uiControllers.clearSelectionAnchor();
        }

        return handled;
      },
      moveTableColumn: (view, direction) => runUiTableMutation(view, () => moveTableColumn(view, direction)),
      moveTableColumnTo: (view, index) => runUiTableMutation(view, () => moveTableColumnTo(view, index)),
      moveTableRow: (view, direction) => runUiTableMutation(view, () => moveTableRow(view, direction)),
      moveTableRowTo: (view, index) => runUiTableMutation(view, () => moveTableRowTo(view, index)),
      removeTableColumn: (view) => runUiTableMutation(view, () => removeTableColumn(view)),
      removeTableRow: (view) => runUiTableMutation(view, () => removeTableRow(view)),
      resizeTable: (view, dimensions) => runUiStructuralCommand(
        view,
        structuralCommandSet.commands.resizeTable(dimensions),
      ),
      selectTableColumn: (view, index) => runUiTableMutation(
        view,
        () => selectTableColumn(view, index),
      ),
      selectTableRow: (view, index) => runUiTableMutation(
        view,
        () => selectTableRow(view, index),
      ),
      setTableColumnAlignment: (view, alignment) => runUiTableMutation(
        view,
        () => setTableColumnAlignment(view, alignment),
      ),
      removeActiveTable: (view) => runUiTableMutation(view, () => removeActiveTable(view)),
      getTableContext: getTableUiContext,
      normalizeTableAlignment,
    }) ?? createNoopUiControllers();
    uiFactoryReturned = true;
    uiEnabled = Boolean(uiControllers.enabled);
    codeBlockLanguageEditor = uiControllers.codeBlockLanguageEditor;
    imageEditor = uiControllers.imageEditor;
    linkEditor = uiControllers.linkEditor;
    tableToolbar = uiControllers.tableToolbar;
    openCodeBlockLanguageEditor = (target) => {
      const controller = codeBlockLanguageEditor;

      if (
        !controller
        || !uiEnabled
        || target.view !== view
        || target.node.type !== schema.nodes.code_block
        || !target.marker.isConnected
        || !canRunUiMutation(target.view)
        || controller.isComposing?.()
      ) {
        return false;
      }

      let capturedPos: number;

      try {
        capturedPos = target.getPos();
      } catch {
        return false;
      }

      if (
        !Number.isInteger(capturedPos)
        || capturedPos < 0
        || capturedPos > target.view.state.doc.content.size
        || target.view.state.doc.nodeAt(capturedPos) !== target.node
      ) {
        return false;
      }

      const capturedNode = target.node;
      const editVersion = ++codeBlockLanguageEditVersion;
      const language = typeof capturedNode.attrs.params === "string"
        ? capturedNode.attrs.params
        : "";
      const request = Object.freeze({
        language,
        cancel() {
          if (editVersion === codeBlockLanguageEditVersion) {
            codeBlockLanguageEditVersion += 1;
          }
        },
        update(nextLanguage: string) {
          if (
            typeof nextLanguage !== "string"
            || editVersion !== codeBlockLanguageEditVersion
            || !canRunUiMutation(target.view)
            || controller.isComposing?.()
          ) {
            return false;
          }

          let normalized: string;
          let pos: number;

          try {
            normalized = normalizeCodeBlockInfo(nextLanguage);
            pos = target.getPos();
          } catch {
            return false;
          }

          if (
            !Number.isInteger(pos)
            || pos < 0
            || pos > target.view.state.doc.content.size
          ) {
            return false;
          }

          let currentNode: ProseMirrorNode | null;

          try {
            currentNode = target.view.state.doc.nodeAt(pos);
          } catch {
            return false;
          }

          if (currentNode !== capturedNode || currentNode.type !== schema.nodes.code_block) {
            return false;
          }

          const currentLanguage = typeof currentNode.attrs.params === "string"
            ? currentNode.attrs.params
            : "";

          if (normalized === currentLanguage) {
            return true;
          }

          const transaction = target.view.state.tr.setNodeMarkup(
            pos,
            undefined,
            { ...currentNode.attrs, params: normalized },
            currentNode.marks,
          );
          setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
          target.view.dispatch(transaction);
          return true;
        },
      });

      let opened: boolean;

      try {
        opened = controller.open(target.view, target.marker, request) === true;
      } catch (error) {
        if (editVersion === codeBlockLanguageEditVersion) {
          codeBlockLanguageEditVersion += 1;
        }

        throw error;
      }

      if (!opened && editVersion === codeBlockLanguageEditVersion) {
        codeBlockLanguageEditVersion += 1;
      }

      return opened;
    };
  } catch (error) {
    const cleanupErrors = [error];

    if (uiFactoryReturned) {
      try {
        codeBlockLanguageEditor?.destroy();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }

      for (const controllerName of ["linkEditor", "imageEditor", "tableToolbar"] as const) {
        try {
          uiControllers[controllerName].destroy();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
    }

    extensionAssembly.beginDestroy();
    cleanupErrors.push(...extensionAssembly.cleanupAssembly());

    lifecycle = "destroyed";
    releaseHostOwnership();

    if (cleanupErrors.length > 1) {
      throw createCleanupError("Markora UI initialization failed and cleanup also failed.", cleanupErrors);
    }

    throw error;
  }

  let view!: EditorView;
  const assertActive = (operation: string) => {
    if (lifecycle !== "active" || view.isDestroyed) {
      throw new MarkdownEditorDestroyedError(operation);
    }
  };
  const assetController = createAssetUploadController({
    assertActive,
    emit(reason, upload) {
      if (lifecycle === "active" && editor && !view.isDestroyed) {
        eventDispatcher.emit("asset", { editor, reason, type: "asset", upload });
      }
    },
    getView: () => view || null,
    isActive: () => lifecycle === "active",
    messages,
    ownerWindow,
    reportUnhandled,
    resources,
    schema,
  });
  const advancedTables = createTableEditing({
    schema,
    reportBrowserError(error) {
      if (lifecycle !== "active" || view.isDestroyed) return;
      eventDispatcher.emit("error", {
        code: "table-operation-rejected",
        context: { phase: "clipboard" },
        editor,
        error,
        recoverable: true,
        type: "error",
      });
    },
  });
  const clipboard = createClipboardSemantics({
    codec,
    reportBrowserError(error) {
      if (error instanceof MarkdownEditorExtensionError) {
        reportExtensionError(error);
      } else {
        reportUnhandled(error);
      }
    },
    tableClipboard: advancedTables.clipboard,
    takeExtensionFailure: extensionAssembly.contributions.takeClipboardFailure,
  });
  const builtinTypingShortcuts = createTypingShortcuts({
    codec,
    linkify: codec.tokenizer.linkify,
    resources,
  });
  const inputRulePlugins = [
    builtinTypingShortcuts,
    ...(extensionAssembly.contributions.inputRules
      ? [extensionAssembly.contributions.inputRules]
      : []),
  ];
  const autoPairPlugin = createAutoPairPlugin({
    inputRulePlugins,
    schema,
    typing,
  });
  const shortcutKeymap = createMarkdownEditorShortcutKeymap([
    {
      command: structuralCommandSet.commands.insertHardBreak,
      defaultKeys: ["Shift-Enter"],
      id: "@markora/core/hard-break",
    },
    {
      command: (_state, _dispatch, activeView) => Boolean(
        activeView
        && canRunUiMutation(activeView)
        && (tableToolbar.focus?.(activeView) ?? false),
      ),
      defaultKeys: ["Alt-F10"],
      id: "@markora/core/table-toolbar",
    },
    { command: commands.toggleBold, defaultKeys: ["Mod-b"], id: "@markora/core/bold" },
    { command: commands.toggleItalic, defaultKeys: ["Mod-i"], id: "@markora/core/italic" },
    { command: commands.toggleCode, defaultKeys: ["Mod-e"], id: "@markora/core/inline-code" },
    { command: commands.toggleStrike, defaultKeys: ["Mod-Shift-x"], id: "@markora/core/strikethrough" },
    { command: commands.undo, defaultKeys: ["Mod-z"], id: "@markora/core/undo" },
    { command: commands.redo, defaultKeys: ["Shift-Mod-z", "Mod-y"], id: "@markora/core/redo" },
  ], shortcuts);

  const plugins = [
    new Plugin({
      filterTransaction(transaction) {
        return (
          runtimeOptions.editable
          || !transaction.docChanged
          || hasMarkdownEditorExternalUpdatePermission(transaction)
        );
      },
    }),
    createPlaceholderPlugin(() => runtimeOptions.placeholder),
    assetController.plugin,
    codec.createImportedContentSanitizerPlugin(),
    ...(extensionAssembly.contributions.clipboard
      ? [extensionAssembly.contributions.clipboard]
      : []),
    builtinTypingShortcuts,
    ...(extensionAssembly.contributions.inputRules
      ? [extensionAssembly.contributions.inputRules]
      : []),
    createInputRuleRecoveryPlugin({ inputRulePlugins }),
    ...(autoPairPlugin ? [autoPairPlugin] : []),
    createHeadingEditingPlugin({ schema, convertPipeTable }),
    createCodeFenceEditingPlugin({ codec }),
    createHorizontalRulePlugin({
      schema,
      createManagedBlockCursor: (doc, blockPos, side) => ManagedBlockCursor.create(doc, blockPos, side, isManagedBlockNode),
      isManagedBlockNode,
    }),
    createImagePlugin({ schema, resources }),
    createEscapedBoundaryPlugin(),
    ...createElementInteractionPlugins(codec.managedBlocks, {
      isManagedBlockNode,
      getManagedBlockBoundary,
      insertParagraphAtManagedBlockBoundary,
      removeManagedBlockAtBoundary,
    }),
    createMarkBoundaryPlugin({
      linkEditor,
      imageEditor,
      tableToolbar,
      enableDefaultUi: uiEnabled,
      handleNativeTaskControlKeyDown,
      maybeExtendSelectionAcrossCodeBlock,

      maybeToggleTaskListItem,
      maybeOpenImage,
      maybeOpenLink,
      maybeEditActiveImage,
      maybeEditActiveLink,
      getMarkInfo,
      getActiveImageInfo,
      onDestroyError(error) {
        collectViewError(error);
      },
      onInitializeError(error) {
        collectViewError(error);
      },
      onUpdateError(error) {
        collectViewError(error);
      },
    }),
    createCodeBlockOuterSelectionPlugin({ schema }),
    createMarkdownRevealPlugin({
      revealMarkConfigs,
      getMarkInfo,
      isEscapedOutsideBoundary,
      getActiveListItemInfo,
      getActiveLineMarker,
    }),
    ...extensionAssembly.contributions.plugins,
    createInputRobustnessPlugin(ownerWindow),
    clipboard.plugin,
    // Clamp the final slice after both structured transforms and raw extension
    // plugins so extension precedence cannot reintroduce unsafe URLs.
    codec.createImportedContentSanitizerPlugin(),
    history(),
    createNativeHistoryPlugin(),
    ...(extensionAssembly.contributions.keymap
      ? [extensionAssembly.contributions.keymap]
      : []),
    ...(shortcutKeymap ? [shortcutKeymap] : []),
    keymap({
      Backspace: listBackspaceForInput,
      Delete: listDeleteForInput,
      Enter: chainCommands(splitListItemForInput, liftEmptyBlock),
      Tab: (state, dispatch, view) => moveTableCell(view!, 1) || sinkListItem(listItemType)(state, dispatch, view),
      "Shift-Tab": (state, dispatch, view) => moveTableCell(view!, -1) || liftListItem(listItemType)(state, dispatch, view),
      ArrowUp: (_state, _dispatch, view) => moveTableCellVertical(view!, -1),
      ArrowDown: (_state, _dispatch, view) => moveTableCellVertical(view!, 1),
    }),
    ...advancedTables.plugins,
    keymap(baseKeymap),
  ];

  let finalMarkdown = "";
  const changeEmitter = createChangeEmitter<ProseMirrorNode, MarkdownEditorChangeContext>({
    initialDoc: doc,
    initialMarkdown,
    isDeliveryValid: (targetDoc) => (
      lifecycle === "active"
      && !view.isDestroyed
      && view.state.doc === targetDoc
    ),
    onChange: runtimeOptions.onChange,
    reportAsyncError(error) {
      if (
        error instanceof MarkdownEditorExtensionError
        && synchronouslyReportedExtensionErrors.delete(error)
      ) {
        return;
      }
      reportUnhandled(error);
    },
    scheduleIdle: idleScheduler.schedule,
    serialize: (targetDoc) => runReportedExtensionOperation(
      () => codec.serialize(targetDoc),
    ),
  });
  finalMarkdown = changeEmitter.getMarkdown(doc);

  const emitStateEvents = createStateEventEmitter({
    getEditor: () => editor,
    getView: () => view,
    isActive: () => lifecycle === "active",
    dispatcher: eventDispatcher,
    snapshotSelection,
  });

  const canRunInteractiveCommand = () => (
    runtimeOptions.editable
    && !view.composing
    && !CodeBlockView.isComposing()
  );

  const runCommand = (command: EditorCommand) => {
    assertActive("run an editor command");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const handled = command(
      view.state,
      (transaction) => {
        setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
        view.dispatch(transaction);
      },
      view,
    );

    if (handled && lifecycle === "active" && !view.isDestroyed) {
      view.focus();
    }

    return handled;
  };

  const toggleMarkCommands: Record<MarkdownEditorMark, EditorCommand> = {
    strong: commands.toggleBold,
    em: commands.toggleItalic,
    code: commands.toggleCode,
    strike: commands.toggleStrike,
  };

  const replaceMarkdownState = (
    nextMarkdown: string,
    setOptions: MarkdownEditorMarkdownUpdateOptions | undefined,
    operation: "reset Markdown" | "set Markdown",
  ) => {
    assertActive(operation);
    const action = operation === "set Markdown" ? "setting" : "resetting";
    const failureMessage = `Multiple Markora callbacks failed while ${action} Markdown.`;
    const emitChange = setOptions?.emitChange ?? false;
    // Host option getters may reenter and destroy the editor.
    assertActive(operation);
    const nextDoc = runReportedExtensionOperation(() => codec.parse(nextMarkdown));

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    changeEmitter.cancel();
    assetController.cancelAll();
    assertActive(operation);

    const previousState = view.state;
    const nextState = EditorState.create({
      doc: nextDoc,
      plugins,
    });
    const callbackErrors: unknown[] = [];

    runWithViewErrorCollector(callbackErrors, () => view.updateState(nextState));

    if (lifecycle !== "active" || view.isDestroyed) {
      throwCollectedErrors(failureMessage, callbackErrors);
      return;
    }

    syncReadonlyControls(view);
    changeEmitter.cache(nextDoc);

    if (emitChange) {
      try {
        changeEmitter.schedule(nextState.doc, createChangeContext("reset"));
      } catch (error) {
        callbackErrors.push(error);
      }
    }

    emitStateEvents(previousState, nextState, !previousState.doc.eq(nextState.doc), "reset");
    throwCollectedErrors(failureMessage, callbackErrors);
  };

  const resetMarkdownValue = (
    nextMarkdown: string,
    setOptions?: MarkdownEditorMarkdownUpdateOptions,
  ) => replaceMarkdownState(nextMarkdown, setOptions, "reset Markdown");

  const reconcileMarkdownValue = (
    nextMarkdown: string,
    updateOptions?: MarkdownEditorMarkdownUpdateOptions,
  ) => {
    assertActive("reconcile Markdown");
    const emitChange = updateOptions?.emitChange ?? false;
    // Host option getters may reenter and destroy the editor.
    assertActive("reconcile Markdown");
    const nextDoc = runReportedExtensionOperation(() => codec.parse(nextMarkdown));

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    const currentState = view.state;

    if (currentState.doc.eq(nextDoc)) {
      return false;
    }

    const transaction = closeHistory(buildReconciledDocumentTransaction(currentState, nextDoc));
    transaction.setMeta("addToHistory", false);
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "external");
    setMarkdownEditorExternalUpdatePermission(transaction);
    setMarkdownEditorTransactionEmitChange(transaction, emitChange);
    changeEmitter.cancel();
    view.dispatch(transaction);
    return true;
  };

  const runToggleMark = (mark: MarkdownEditorMark) => runCommand(toggleMarkCommands[mark]);

  const setLinkValue = (href: string) => {
    assertActive("set a link");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const handled = setLink(view, href, (transaction) => {
      setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
      view.dispatch(transaction);
    });

    if (handled && lifecycle === "active" && !view.isDestroyed) {
      uiControllers.clearSelectionAnchor();

      if (lifecycle === "active" && !view.isDestroyed) {
        view.focus();
      }
    }

    return handled;
  };

  const insertImageValue = (attrs: { src: string; alt?: string | null; title?: string | null }) => {
    assertActive("insert an image");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const src = attrs.src;
    assertActive("insert an image");
    const alt = attrs.alt;
    assertActive("insert an image");
    const title = attrs.title;
    assertActive("insert an image");
    const handled = insertImage(view, { src, alt, title }, (transaction) => {
      setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
      view.dispatch(transaction);
    });

    if (handled && lifecycle === "active" && !view.isDestroyed) {
      uiControllers.clearSelectionAnchor();

      if (lifecycle === "active" && !view.isDestroyed) {
        view.focus();
      }
    }

    return handled;
  };

  const editLinkValue = () => {
    assertActive("edit a link");

    if (!runtimeOptions.editable || !uiEnabled) {
      return false;
    }

    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo || isEscapedOutsideBoundary(view.state, "link", markInfo)) {
      return false;
    }

    const currentHref = typeof markInfo.attrs?.href === "string" ? markInfo.attrs.href : "";
    const selectionAnchor = uiControllers.createSelectionAnchor(view);

    if (!selectionAnchor || lifecycle !== "active" || view.isDestroyed) {
      return false;
    }

    linkEditor.open(view, selectionAnchor, currentHref);
    return true;
  };

  const editImageValue = () => {
    assertActive("edit an image");

    if (!runtimeOptions.editable || !uiEnabled) {
      return false;
    }

    const imageInfo = getActiveImageInfo(view.state);

    if (!imageInfo) {
      return false;
    }

    const marker = view.nodeDOM(imageInfo.pos);
    const HTMLElementCtor = (view.dom.ownerDocument.defaultView as BrowserWindow | null)?.HTMLElement;

    if (!HTMLElementCtor || !(marker instanceof HTMLElementCtor)) {
      return false;
    }

    uiControllers.clearSelectionAnchor();

    if (lifecycle !== "active" || view.isDestroyed) {
      return false;
    }

    imageEditor.open(view, marker, imageInfo);
    return true;
  };

  const editCodeBlockLanguageValue = () => {
    assertActive("edit a code block language");

    if (!codeBlockLanguageEditor || !uiEnabled || !canRunUiMutation(view)) {
      return false;
    }

    const { selection } = view.state;
    let node: ProseMirrorNode | null = null;
    let pos = -1;

    if (
      selection instanceof NodeSelection
      && selection.node.type === schema.nodes.code_block
    ) {
      node = selection.node;
      pos = selection.from;
    } else {
      for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
        const candidate = selection.$from.node(depth);

        if (candidate.type !== schema.nodes.code_block) continue;
        const candidatePos = selection.$from.before(depth);

        if (selection.to <= candidatePos + candidate.nodeSize - 1) {
          node = candidate;
          pos = candidatePos;
        }
        break;
      }
    }

    if (!node || pos < 0) {
      return false;
    }

    const nodeDom = view.nodeDOM(pos) as (Node & ParentNode) | null;
    const marker = nodeDom && typeof nodeDom.querySelector === "function"
      ? nodeDom.querySelector<HTMLElement>("button.mdw-code-block-language")
      : null;

    if (!marker) {
      return false;
    }

    return openCodeBlockLanguageEditor({
      getPos: () => pos,
      marker,
      node,
      view,
    });
  };

  const createTableValue = () => {
    assertActive("create a table");

    if (
      !runtimeOptions.editable
      || !uiEnabled
      || typeof tableToolbar.create !== "function"
      || view.composing
      || CodeBlockView.isComposing()
      || !structuralCommandSet.commands.insertTable()(view.state)
    ) {
      return false;
    }

    const selectionAnchor = uiControllers.createSelectionAnchor(view);

    if (!selectionAnchor || lifecycle !== "active" || view.isDestroyed) {
      return false;
    }

    const opened = tableToolbar.create(
      view,
      selectionAnchor,
      () => uiControllers.clearSelectionAnchor(),
    );

    if (!opened) {
      uiControllers.clearSelectionAnchor();
    }

    return opened;
  };

  const editTableValue = () => {
    assertActive("edit a table");
    return Boolean(
      runtimeOptions.editable
      && uiEnabled
      && canRunUiMutation(view)
      && tableToolbar.focus?.(view),
    );
  };

  const getBuiltinMarkState = (name: MarkdownEditorMark) => {
    const markType = schema.marks[name];

    if (!markType) {
      return false;
    }

    return isMarkdownMarkActive(
      view.state,
      name,
      markType,
      isEscapedOutsideBoundary,
    );
  };

  const isMarkActive = (mark: MarkdownEditorActiveMark) => {
    switch (mark) {
      case "strong":
        return getBuiltinMarkState("strong");
      case "em":
        return getBuiltinMarkState("em");
      case "code":
        return getBuiltinMarkState("code");
      case "strike":
        return getBuiltinMarkState("strike");
      case "link":
        return isLinkActive({ state: view.state, isEscapedOutsideBoundary });
    }
  };

  const isNodeActive = (node: MarkdownEditorActiveNode) => {
    return node === "image"
      ? !!getActiveImageInfo(view.state)
      : structuralCommandSet.isActive.node(view.state, node);
  };

  const runStateQuery = (operation: string, query: () => boolean) => {
    assertActive(operation);
    const result = query();
    assertActive(operation);
    return result;
  };

  const canRunCommand = (operation: string, command: EditorCommand) => (
    runStateQuery(operation, () => canRunInteractiveCommand() && command(view.state))
  );

  const runStructuralCommand = (command: EditorCommand) => runCommand(command);

  const focusAfterViewCommand = (handled: boolean) => {
    if (handled && lifecycle === "active" && !view.isDestroyed) {
      view.focus();
    }

    return handled;
  };

  const editorStateApi: MarkdownEditorState = {
    tableIssues() {
      assertActive("inspect table fidelity issues");
      return getTableFidelityIssues(view.state.doc);
    },
    can: {
      pasteMarkdown() {
        return runStateQuery(
          "query whether Markdown can be pasted",
          canRunInteractiveCommand,
        );
      },
      pastePlainText() {
        return runStateQuery(
          "query whether plain text can be pasted",
          canRunInteractiveCommand,
        );
      },
      toggleMark(mark) {
        assertActive("query whether a mark can be toggled");
        return canRunInteractiveCommand() && toggleMarkCommands[mark](view.state);
      },
      setLink() {
        assertActive("query whether a link can be set");
        return canRunInteractiveCommand() && canSetLink(view.state);
      },
      removeLink() {
        return runStateQuery(
          "query whether a link can be removed",
          () => canRunInteractiveCommand() && Boolean(getMarkInfo(view.state, "link")),
        );
      },
      insertImage() {
        assertActive("query whether an image can be inserted");
        return canRunInteractiveCommand() && canInsertImage(view.state);
      },
      removeImage() {
        return runStateQuery(
          "query whether an image can be removed",
          () => canRunInteractiveCommand() && Boolean(getActiveImageInfo(view.state)),
        );
      },
      setParagraph() {
        return canRunCommand(
          "query whether a paragraph can be set",
          structuralCommandSet.commands.setParagraph,
        );
      },
      setHeading(level) {
        assertActive("query whether a heading can be set");
        return canRunCommand(
          "query whether a heading can be set",
          structuralCommandSet.commands.setHeading(level),
        );
      },
      toggleBlockquote() {
        return canRunCommand(
          "query whether a blockquote can be toggled",
          structuralCommandSet.commands.toggleBlockquote,
        );
      },
      toggleBulletList() {
        return canRunCommand(
          "query whether a bullet list can be toggled",
          structuralCommandSet.commands.toggleBulletList,
        );
      },
      toggleOrderedList() {
        return canRunCommand(
          "query whether an ordered list can be toggled",
          structuralCommandSet.commands.toggleOrderedList,
        );
      },
      sinkListItem() {
        return canRunCommand(
          "query whether a list item can be nested",
          structuralCommandSet.commands.sinkListItem,
        );
      },
      liftListItem() {
        return canRunCommand(
          "query whether a list item can be lifted",
          structuralCommandSet.commands.liftListItem,
        );
      },
      toggleTaskList() {
        return canRunCommand(
          "query whether a task list can be toggled",
          structuralCommandSet.commands.toggleTaskList,
        );
      },
      setTaskChecked(checked) {
        assertActive("query whether task state can be set");
        return canRunCommand(
          "query whether task state can be set",
          structuralCommandSet.commands.setTaskChecked(checked),
        );
      },
      insertHardBreak() {
        return canRunCommand(
          "query whether a hard break can be inserted",
          structuralCommandSet.commands.insertHardBreak,
        );
      },
      insertHorizontalRule() {
        return canRunCommand(
          "query whether a horizontal rule can be inserted",
          structuralCommandSet.commands.insertHorizontalRule,
        );
      },
      setCodeBlock(options) {
        assertActive("query whether a code block can be set");
        return canRunCommand(
          "query whether a code block can be set",
          structuralCommandSet.commands.setCodeBlock(options),
        );
      },
      insertTable(options) {
        assertActive("query whether a table can be inserted");
        return canRunCommand(
          "query whether a table can be inserted",
          structuralCommandSet.commands.insertTable(options),
        );
      },
      addTableRow(side) {
        return canRunCommand(
          "query whether a table row can be added",
          structuralCommandSet.commands.addTableRow(side),
        );
      },
      addTableColumn(side) {
        return canRunCommand(
          "query whether a table column can be added",
          structuralCommandSet.commands.addTableColumn(side),
        );
      },
      resizeTable(options) {
        assertActive("query whether a table can be resized");
        return canRunCommand(
          "query whether a table can be resized",
          structuralCommandSet.commands.resizeTable(options),
        );
      },
      moveTableRow(direction) {
        assertActive("query whether a table row can be moved");
        return canRunCommand(
          "query whether a table row can be moved",
          structuralCommandSet.commands.moveTableRow(direction),
        );
      },
      moveTableColumn(direction) {
        assertActive("query whether a table column can be moved");
        return canRunCommand(
          "query whether a table column can be moved",
          structuralCommandSet.commands.moveTableColumn(direction),
        );
      },
      deleteTableRow() {
        return canRunCommand(
          "query whether a table row can be deleted",
          structuralCommandSet.commands.deleteTableRow,
        );
      },
      deleteTableColumn() {
        return canRunCommand(
          "query whether a table column can be deleted",
          structuralCommandSet.commands.deleteTableColumn,
        );
      },
      setTableColumnAlignment(alignment) {
        assertActive("query whether table column alignment can be set");
        return canRunCommand(
          "query whether table column alignment can be set",
          structuralCommandSet.commands.setTableColumnAlignment(alignment),
        );
      },
      deleteTable() {
        return canRunCommand(
          "query whether a table can be deleted",
          structuralCommandSet.commands.deleteTable,
        );
      },
      undo() {
        assertActive("query whether undo is available");
        return canRunInteractiveCommand() && commands.undo(view.state);
      },
      redo() {
        assertActive("query whether redo is available");
        return canRunInteractiveCommand() && commands.redo(view.state);
      },
    },
    isActive: {
      mark(mark) {
        assertActive("query an active mark");
        return isMarkActive(mark);
      },
      node(node) {
        assertActive("query an active node");
        return isNodeActive(node);
      },
      paragraph() {
        return runStateQuery(
          "query an active paragraph",
          () => structuralCommandSet.isActive.paragraph(view.state),
        );
      },
      heading(level) {
        return runStateQuery(
          "query an active heading",
          () => structuralCommandSet.isActive.heading(view.state, level),
        );
      },
      blockquote() {
        return runStateQuery(
          "query an active blockquote",
          () => structuralCommandSet.isActive.blockquote(view.state),
        );
      },
      bulletList() {
        return runStateQuery(
          "query an active bullet list",
          () => structuralCommandSet.isActive.bulletList(view.state),
        );
      },
      orderedList() {
        return runStateQuery(
          "query an active ordered list",
          () => structuralCommandSet.isActive.orderedList(view.state),
        );
      },
      taskList() {
        return runStateQuery(
          "query an active task list",
          () => structuralCommandSet.isActive.taskList(view.state),
        );
      },
      taskChecked(checked) {
        return runStateQuery(
          "query active task state",
          () => structuralCommandSet.isActive.taskChecked(view.state, checked),
        );
      },
      hardBreak() {
        return runStateQuery(
          "query an active hard break",
          () => structuralCommandSet.isActive.hardBreak(view.state),
        );
      },
      horizontalRule() {
        return runStateQuery(
          "query an active horizontal rule",
          () => structuralCommandSet.isActive.horizontalRule(view.state),
        );
      },
      codeBlock(options) {
        return runStateQuery(
          "query an active code block",
          () => structuralCommandSet.isActive.codeBlock(view.state, options),
        );
      },
      table() {
        return runStateQuery(
          "query an active table",
          () => structuralCommandSet.isActive.table(view.state),
        );
      },
      tableCellSelection() {
        return runStateQuery(
          "query an active table cell selection",
          () => structuralCommandSet.isActive.tableCellSelection(view.state),
        );
      },
      tableColumnAlignment(alignment) {
        return runStateQuery(
          "query active table column alignment",
          () => structuralCommandSet.isActive.tableColumnAlignment(view.state, alignment),
        );
      },
    },
  };

  const editorCommandApi: MarkdownEditorCommands = {
    reconcileMarkdown: reconcileMarkdownValue,
    resetMarkdown: resetMarkdownValue,
    pasteMarkdown(markdown) {
      return runReportedExtensionOperation(
        () => runCommand(clipboard.pasteMarkdown(markdown)),
      );
    },
    pastePlainText(text) {
      return runReportedExtensionOperation(
        () => runCommand(clipboard.pastePlainText(text)),
      );
    },
    toggleMark(mark) {
      return runToggleMark(mark);
    },
    setLink: setLinkValue,
    removeLink() {
      assertActive("remove a link");
      const handled = canRunInteractiveCommand() && removeActiveLink(view, (transaction) => {
        setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
        view.dispatch(transaction);
      });
      return focusAfterViewCommand(handled);
    },
    insertImage: insertImageValue,
    removeImage() {
      assertActive("remove an image");
      const handled = canRunInteractiveCommand() && removeActiveImage(view, (transaction) => {
        setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
        view.dispatch(transaction);
      });
      return focusAfterViewCommand(handled);
    },
    setParagraph() {
      return runStructuralCommand(structuralCommandSet.commands.setParagraph);
    },
    setHeading(level) {
      assertActive("set a heading");
      return runStructuralCommand(structuralCommandSet.commands.setHeading(level));
    },
    toggleBlockquote() {
      return runStructuralCommand(structuralCommandSet.commands.toggleBlockquote);
    },
    toggleBulletList() {
      return runStructuralCommand(structuralCommandSet.commands.toggleBulletList);
    },
    toggleOrderedList() {
      return runStructuralCommand(structuralCommandSet.commands.toggleOrderedList);
    },
    sinkListItem() {
      return runStructuralCommand(structuralCommandSet.commands.sinkListItem);
    },
    liftListItem() {
      return runStructuralCommand(structuralCommandSet.commands.liftListItem);
    },
    toggleTaskList() {
      return runStructuralCommand(structuralCommandSet.commands.toggleTaskList);
    },
    setTaskChecked(checked) {
      assertActive("set task state");
      return runStructuralCommand(structuralCommandSet.commands.setTaskChecked(checked));
    },
    insertHardBreak() {
      return runStructuralCommand(structuralCommandSet.commands.insertHardBreak);
    },
    insertHorizontalRule() {
      return runStructuralCommand(structuralCommandSet.commands.insertHorizontalRule);
    },
    setCodeBlock(options) {
      assertActive("set a code block");
      return runStructuralCommand(structuralCommandSet.commands.setCodeBlock(options));
    },
    insertTable(options) {
      assertActive("insert a table");
      return runStructuralCommand(structuralCommandSet.commands.insertTable(options));
    },
    addTableRow(side) {
      return runStructuralCommand(structuralCommandSet.commands.addTableRow(side));
    },
    addTableColumn(side) {
      return runStructuralCommand(structuralCommandSet.commands.addTableColumn(side));
    },
    resizeTable(options) {
      assertActive("resize a table");
      return runStructuralCommand(structuralCommandSet.commands.resizeTable(options));
    },
    moveTableRow(direction) {
      assertActive("move a table row");
      return runStructuralCommand(structuralCommandSet.commands.moveTableRow(direction));
    },
    moveTableColumn(direction) {
      assertActive("move a table column");
      return runStructuralCommand(structuralCommandSet.commands.moveTableColumn(direction));
    },
    deleteTableRow() {
      return runStructuralCommand(structuralCommandSet.commands.deleteTableRow);
    },
    deleteTableColumn() {
      return runStructuralCommand(structuralCommandSet.commands.deleteTableColumn);
    },
    setTableColumnAlignment(alignment) {
      assertActive("set table column alignment");
      return runStructuralCommand(
        structuralCommandSet.commands.setTableColumnAlignment(alignment),
      );
    },
    deleteTable() {
      return runStructuralCommand(structuralCommandSet.commands.deleteTable);
    },
    undo() {
      return runCommand(commands.undo);
    },
    redo() {
      return runCommand(commands.redo);
    },
  };

  const hostChildrenBeforeView = new Set(element.childNodes);

  const cleanupConstructionFailure = (primaryError: unknown): never => {
    disposeEditorRuntime({
      message: "Markora creation failed and one or more cleanup operations also failed.",
      errors: [primaryError],
      begin: () => {
        lifecycle = "destroying";
        pendingExtensionErrors.length = 0;
      },
      assembly: extensionAssembly,
      beforeView: [() => changeEmitter.cancel()],
      destroyView: errors => {
        if (view && !view.isDestroyed) {
          runWithViewErrorCollector(errors, () => destroyProseMirrorView(view));
        }
      },
      afterView: [
        () => codeBlockLanguageEditor?.destroy(),
        () => linkEditor.destroy(),
        () => imageEditor.destroy(),
        () => tableToolbar.destroy(),
      ],
      finalize: [
        errors => { errors.push(
          ...pendingLanguageLoadErrors.splice(0).map(({ error }) => error),
          ...pluginInitializationErrors.splice(0),
          ...deferredViewErrors.splice(0),
        ); },
        () => eventDispatcher.clear(),
        () => {
          for (const child of [...element.childNodes]) {
            if (!hostChildrenBeforeView.has(child)) child.remove();
          }
        },
        () => releaseHostOwnership(),
        () => { lifecycle = "destroyed"; },
      ],
    });
    throw primaryError;
  };

  try {
    const initialState = EditorState.create({
      doc,
      plugins,
      selection: resolvedInitialSelection,
    });

    view = runWithViewErrorCollector(pluginInitializationErrors, () => new EditorView(element, {
      attributes: () => buildEditorDomAttributes(runtimeOptions),
      editable: () => runtimeOptions.editable,
      state: initialState,
      nodeViews: {
        list_item(node: ProseMirrorNode, targetView: EditorView) {
          return new TaskListItemView(node, targetView);
        },
        code_block(node: ProseMirrorNode, targetView: EditorView, getPos: () => number | undefined) {
          return new CodeBlockView(node, targetView, getPos as () => number);
        },
        image(node, editorView) {
          return new ImageView(node, editorView.dom.ownerDocument);
        },
        raw_block(node: ProseMirrorNode, editorView: EditorView, getPos: (() => number | undefined) | boolean) {
          return new RawBlockView(node, editorView, getPos as () => number | undefined);
        },
        raw_inline(node: ProseMirrorNode, editorView: EditorView, getPos: (() => number | undefined) | boolean) {
          return new RawInlineView(node, editorView, getPos as () => number | undefined);
        },
        ...extensionAssembly.contributions.nodeViews,
      },
      dispatchTransaction: createTransactionDispatcher({
        isActive: () => lifecycle === "active",
        isPasting: () => clipboard.isPasting(),
        onTransaction: (transaction, activeView, context) => runtimeOptions.onTransaction?.(transaction, activeView, context),
        scheduleChange: (doc, context) => changeEmitter.schedule(doc, context),
        emitStateEvents,
        updateView(activeView, nextState, transaction, errors) {
          const action = transaction.getMeta(MARKDOWN_EDITOR_HISTORY_ACTION_META);
          const previousAction = codeBlockHistoryAction;
          codeBlockHistoryAction = action === "redo" || action === "undo" ? action : null;
          try {
            runWithViewErrorCollector(errors, () => activeView.updateState(nextState));
          } finally {
            codeBlockHistoryAction = previousAction;
          }
        },
      }),
    }));

    throwCollectedErrors(
      "Multiple callbacks failed during Markora creation.",
      [
        ...pendingLanguageLoadErrors.splice(0).map(({ error }) => error),
        ...pluginInitializationErrors.splice(0),
      ],
    );
  } catch (error) {
    cleanupConstructionFailure(error);
  }

  CodeBlockView.setEditable(runtimeOptions.editable);
  syncReadonlyControls(view);

  const stopObservingFocus = observeEditorFocus({
    view,
    getEditor: () => editor,
    isActive: () => lifecycle === "active",
    dispatcher: eventDispatcher,
  });

  const updateOptions = (nextOptions: UpdateEditorOptions) => {
    assertActive("update editor options");
    const nextAriaLabel = nextOptions.ariaLabel;
    assertActive("update editor options");
    const nextAriaLabelledBy = nextOptions.ariaLabelledBy;
    assertActive("update editor options");
    const nextAttributes = nextOptions.attributes;
    assertActive("update editor options");
    const nextEditable = nextOptions.editable;
    assertActive("update editor options");
    const nextOnChange = nextOptions.onChange;
    assertActive("update editor options");
    const nextOnEditOpaqueMarkdown = nextOptions.onEditOpaqueMarkdown;
    assertActive("update editor options");
    const nextOnTransaction = nextOptions.onTransaction;
    assertActive("update editor options");
    const nextPlaceholder = nextOptions.placeholder;
    assertActive("update editor options");
    const runtimePatch: Partial<EditorRuntimeOptions> = {};

    if (nextAriaLabel !== undefined) {
      runtimePatch.ariaLabel = normalizeAccessibleName(nextAriaLabel, "ariaLabel");
    }

    if (nextAriaLabelledBy !== undefined) {
      runtimePatch.ariaLabelledBy = normalizeAccessibleName(nextAriaLabelledBy, "ariaLabelledBy");
    }

    if (nextAttributes !== undefined) {
      runtimePatch.attributes = copyEditorAttributes(nextAttributes, element.ownerDocument);
    }

    if (nextEditable != null) {
      runtimePatch.editable = nextEditable;
    }

    if (nextOnChange !== undefined) {
      runtimePatch.onChange = nextOnChange ?? undefined;
    }

    if (nextOnEditOpaqueMarkdown !== undefined) {
      runtimePatch.onEditOpaqueMarkdown = nextOnEditOpaqueMarkdown ?? undefined;
    }

    if (nextOnTransaction !== undefined) {
      runtimePatch.onTransaction = nextOnTransaction ?? undefined;
    }

    if (nextPlaceholder !== undefined) {
      runtimePatch.placeholder = normalizePlaceholder(nextPlaceholder);
    }

    assertActive("update editor options");

    const shouldFlushOldChange = (
      "onChange" in runtimePatch && runtimePatch.onChange !== runtimeOptions.onChange
    );

    if (shouldFlushOldChange) {
      changeEmitter.flush();
      assertActive("update editor options");
    }

    const nextRuntimeOptions: EditorRuntimeOptions = {
      ...runtimeOptions,
      ...runtimePatch,
    };

    if (editorAttributesEqual(nextRuntimeOptions.attributes, runtimeOptions.attributes)) {
      nextRuntimeOptions.attributes = runtimeOptions.attributes;
    }

    const changesAriaLabel = nextRuntimeOptions.ariaLabel !== runtimeOptions.ariaLabel;
    const changesAriaLabelledBy = nextRuntimeOptions.ariaLabelledBy !== runtimeOptions.ariaLabelledBy;
    const changesAttributes = nextRuntimeOptions.attributes !== runtimeOptions.attributes;
    const changesEditable = nextRuntimeOptions.editable !== runtimeOptions.editable;
    const changesOnChange = nextRuntimeOptions.onChange !== runtimeOptions.onChange;
    const changesOnEditOpaqueMarkdown = nextRuntimeOptions.onEditOpaqueMarkdown !== runtimeOptions.onEditOpaqueMarkdown;
    const changesPlaceholder = nextRuntimeOptions.placeholder !== runtimeOptions.placeholder;
    const refreshEditorView = changesAriaLabel
      || changesAriaLabelledBy
      || changesAttributes
      || changesEditable
      || changesPlaceholder;
    const nextDomAttributes = refreshEditorView
      ? buildEditorDomAttributes(nextRuntimeOptions)
      : null;

    Object.assign(runtimeOptions, nextRuntimeOptions);

    if (changesOnChange) {
      changeEmitter.update({
        onChange: nextRuntimeOptions.onChange ?? null,
      });
    }

    const optionErrors: unknown[] = [];

    if (changesEditable) {
      try {
        CodeBlockView.setEditable(runtimeOptions.editable);
      } catch (error) {
        optionErrors.push(error);
      }

      if (lifecycle !== "active" || view.isDestroyed) {
        throwCollectedErrors("One or more Markora UI callbacks failed while updating options.", optionErrors);
        return;
      }
    }

    if (refreshEditorView) {
      try {
        runWithViewErrorCollector(optionErrors, () => {
          view.setProps({
            attributes: () => nextDomAttributes!,
            editable: () => runtimeOptions.editable,
          });
        });
      } catch (error) {
        optionErrors.push(error);
      }

      if (lifecycle === "active" && !view.isDestroyed) {
        syncReadonlyControls(view);
      }

      if (lifecycle !== "active" || view.isDestroyed) {
        throwCollectedErrors("One or more Markora UI callbacks failed while updating options.", optionErrors);
        return;
      }
    }

    if (changesEditable || changesOnEditOpaqueMarkdown) {
      RawBlockView.refresh();
      RawInlineView.refresh();
    }

    if (changesEditable && !runtimeOptions.editable) {
      codeBlockLanguageEditVersion += 1;

      try {
        uiControllers.clearSelectionAnchor();
      } catch (error) {
        optionErrors.push(error);
      }

      try {
        codeBlockLanguageEditor?.close(false);
      } catch (error) {
        optionErrors.push(error);
      }
    }

    throwCollectedErrors("One or more Markora UI callbacks failed while updating options.", optionErrors);
  };

  editor = {
    get isDestroyed() {
      return lifecycle !== "active" || view.isDestroyed;
    },
    view,
    extensions: extensionAssembly.registry,
    assets: assetController.api,
    clipboard: Object.freeze({
      captureSelection() { assertActive("capture clipboard selection"); return clipboard.captureSelection(view); },
      paste(content) { assertActive("paste clipboard content"); return clipboard.pasteContent(view, content); },
    }),
    commands: editorCommandApi,
    state: editorStateApi,
    ui: uiEnabled ? {
      createTable: createTableValue,
      editCodeBlockLanguage: editCodeBlockLanguageValue,
      editLink: editLinkValue,
      editImage: editImageValue,
      editTable: editTableValue,
    } : null,
    blur() {
      assertActive("blur the editor");
      const activeElement = getEditorRootActiveElement(view);

      if (isActiveElementInsideEditor(view, activeElement)) {
        blurElement(activeElement);
      }
    },
    focus(selection) {
      assertActive("focus the editor");

      if (selection) {
        let selectionSnapshot = selection;

        if (typeof selection === "object") {
          const anchor = selection.anchor;
          assertActive("focus the editor");
          const head = selection.head;
          assertActive("focus the editor");
          selectionSnapshot = { anchor, head };
        }

        const nextSelection = resolveSelectionTarget(view.state.doc, selectionSnapshot);
        assertActive("focus the editor");

        if (!view.state.selection.eq(nextSelection)) {
          const transaction = view.state.tr.setSelection(nextSelection).scrollIntoView();
          setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
          view.dispatch(transaction);
        }
      }

      if (lifecycle === "active" && !view.isDestroyed) {
        view.focus();
        // ProseMirror restores the selection but skips DOM focus for read-only views.
        if (!view.editable) view.dom.focus({ preventScroll: true });
      }
    },
    getMarkdown() {
      if (lifecycle !== "active" || view.isDestroyed) {
        return finalMarkdown;
      }

      return changeEmitter.getMarkdown(view.state.doc);
    },
    refreshResources() {
      assertActive("refresh resources");
      ImageView.refresh();
    },
    flushChange() {
      if (lifecycle !== "active" || view.isDestroyed) {
        return;
      }

      changeEmitter.flush();
    },
    subscribe(type, listener) {
      assertActive("subscribe to editor events");
      return eventDispatcher.subscribe(type, listener);
    },
    updateOptions,
    destroy() {
      if (lifecycle !== "active") return;
      disposeEditorRuntime({
        message: "One or more Markora cleanup operations failed.",
        begin: () => {
          lifecycle = "destroying";
          creationComplete = false;
          pendingExtensionErrors.length = 0;
        },
        assembly: extensionAssembly,
        beforeView: [
          () => { finalMarkdown = changeEmitter.getMarkdown(view.state.doc); },
          () => { pendingExtensionErrors.length = 0; stopObservingFocus(); },
          () => changeEmitter.flushFinal(),
          () => assetController.cancelAll({ dispatch: false, emit: false }),
          () => { const cleanup = unmountUi; unmountUi = undefined; cleanup?.(); },
          () => uiControllers.clearSelectionAnchor(),
        ],
        destroyView: errors => runWithViewErrorCollector(errors, () => destroyProseMirrorView(view)),
        afterView: [
          () => codeBlockLanguageEditor?.destroy(),
          () => linkEditor.destroy(),
          () => imageEditor.destroy(),
          () => tableToolbar.destroy(),
        ],
        finalize: [
          errors => { errors.push(...deferredViewErrors.splice(0)); },
          () => eventDispatcher.clear(),
          () => releaseHostOwnership(),
          () => { lifecycle = "destroyed"; },
        ],
      });
    },
  };

  lifecycle = "active";

  try {
    extensionAssembly.attachView({ view, editor });
    if (!editor.isDestroyed) {
      unmountUi = uiControllers.mount?.(editor) ?? undefined;
      if (editor.isDestroyed) { const cleanup = unmountUi; unmountUi = undefined; cleanup?.(); }
    }
    creationComplete = true;

    for (const pending of pendingExtensionErrors.splice(0)) {
      ownerWindow.queueMicrotask(() => {
        if (creationComplete && lifecycle === "active" && !view.isDestroyed) {
          reportExtensionError(pending.error, pending.useGlobalFallback);
        }
      });
    }
  } catch (setupError) {
    try {
      editor.destroy();
    } catch (cleanupError) {
      throw createCleanupError(
        "Markora extension setup failed and cleanup also failed.",
        [setupError, cleanupError],
      );
    }

    throw setupError;
  }

  if (autofocus) {
    try {
      editor.focus();
    } catch (focusError) {
      try {
        editor.destroy();
      } catch (cleanupError) {
        throw createCleanupError("Markora autofocus failed and cleanup also failed.", [focusError, cleanupError]);
      }

      throw focusError;
    }
  }

  return editor;
}
