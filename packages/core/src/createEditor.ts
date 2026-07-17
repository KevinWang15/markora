import { baseKeymap, chainCommands, liftEmptyBlock, toggleMark } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { type Node as ProseMirrorNode, type NodeType } from "prosemirror-model";
import { sinkListItem, splitListItem, liftListItem } from "prosemirror-schema-list";
import { AllSelection, EditorState, NodeSelection, Plugin, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ManagedBlockCursor } from "./managedBlockCursor";
export { ManagedBlockCursor } from "./managedBlockCursor";
import { createManagedBlockBoundaryPlugin } from "./managedBlockCursorPlugin";
import { createManagedBlockBoundaryHelpers } from "./managedBlockBoundary";
import { createCodeBlockViewClass } from "./codeBlockView";
import { createChangeEmitter } from "./changeEmitter";
import { createClipboardSemantics } from "./clipboardSemantics";
import { normalizeMarkdownEditorChangeMode } from "./changeMode";
import { createHostIdleScheduler } from "./idleScheduler";
import { createAssetUploadController } from "./assetUploads";
import { assertEditorHostAvailable, claimEditorHost } from "./hostOwnership";
import {
  createCompatibilityMarkdownCodec,
  normalizeTableAlignment,
  type MarkdownEditorCodec,
} from "./markdownCodec";
import {
  assertMarkdownEditorCompatibilityAdaptersActive,
  resolveMarkdownEditorExtensions,
} from "./extensionResolver";
import {
  MARKORA_VERSION,
  createDefaultMarkdownEditorPreset,
} from "./extensionPresets";
import { createMarkdownEditorExtensionAssembly } from "./extensionAssembly";
import { MarkdownEditorExtensionError } from "./extensionApi";
import { runInitialMarkdownParse } from "./extensionErrorBoundary";
import { createMinimalMarkdownCodec } from "./minimalMarkdownCodec";
import type {
  CreateEditorOptions,
  MarkdownEditor,
  MarkdownEditorActiveMark,
  MarkdownEditorActiveNode,
  MarkdownEditorCodeBlockOptions,
  MarkdownEditorChangeMode,
  MarkdownEditorCommands,
  MarkdownEditorDomAttributes,
  MarkdownEditorHeadingLevel,
  MarkdownEditorMark,
  MarkdownEditorMarkdownUpdateOptions,
  MarkdownEditorSelectionTarget,
  MarkdownEditorState,
  MarkdownEditorTableAlignment,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorUi,
  ToolbarButtonState,
  ToolbarState,
  UpdateEditorOptions,
} from "./editorApi";
export type {
  CreateEditorOptions,
  MarkdownEditor,
  MarkdownEditorActiveMark,
  MarkdownEditorActiveNode,
  MarkdownEditorCodeBlockOptions,
  MarkdownEditorChangeMode,
  MarkdownEditorCommands,
  MarkdownEditorDomAttributes,
  MarkdownEditorHeadingLevel,
  MarkdownEditorMark,
  MarkdownEditorMarkdownUpdateOptions,
  MarkdownEditorSelectionTarget,
  MarkdownEditorState,
  MarkdownEditorTableAlignment,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorUi,
  ToolbarButtonState,
  ToolbarState,
  UpdateEditorOptions,
} from "./editorApi";
import { createImageViewClass } from "./imageView";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import {
  normalizeMarkdownEditorResources,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";
import { convertFenceToCodeBlock, createTypingShortcuts, getImageToolbarState, getLinkToolbarState, getMarkInfo, getToolbarMarkState, insertHardBreak, type EditorCommand } from "./editorCommands";
import { createCodeBlockOuterSelectionPlugin, createHeadingEditingPlugin, createHorizontalRulePlugin, createImagePlugin, createMarkdownRevealPlugin, createMarkBoundaryPlugin, type RevealMarkConfig } from "./editorPlugins";
import { createCodeBlockSelectionHelpers } from "./codeBlockSelection";
import { createPipeTableHelpers } from "./pipeTable";
import { createTableNavigation, type TableAlignment } from "./tableNavigation";
import type { TableCellInfo } from "./tableTypes";
import type { ActiveImageInfo, EditorUiControllers, ImageEditorOverlay, LinkEditorOverlay, TableToolbarOverlay } from "./uiTypes";
import { createNoopUiControllers } from "./uiTypes";
import { createTaskListHelpers } from "./taskListUtils";
import { createTaskListItemViewClass } from "./taskListItemView";
import { createStructuralCommandSet } from "./structuralCommands";
import { createMediaActionHelpers } from "./mediaActionUtils";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";
import { createOpaqueNodeViewClass } from "./opaqueNodeView";
import type { OpaqueMarkdownEditRequest } from "./opaqueMarkdown";
import { createPlaceholderPlugin } from "./placeholderPlugin";
import { buildReconciledDocumentTransaction } from "./documentUpdate";
import {
  getMarkdownEditorTransactionEmitChange,
  getMarkdownEditorTransactionOrigin,
  hasMarkdownEditorExternalUpdatePermission,
  setBuiltinMarkdownEditorTransactionOrigin,
  setMarkdownEditorExternalUpdatePermission,
  setMarkdownEditorTransactionEmitChange,
  type MarkdownEditorChangeContext,
  type MarkdownEditorChangeOrigin,
} from "./transactionOrigin";
import {
  createEditorEventDispatcher,
  MarkdownEditorDestroyedError,
  type MarkdownEditorSelectionKind,
  type MarkdownEditorSelectionSnapshot,
} from "./editorEvents";

function destroyProseMirrorView(view: EditorView) {
  const input = (view as EditorView & {
    input?: { hideSelectionGuard: (() => void) | null };
  }).input;
  const selectionGuard = input?.hideSelectionGuard;

  // prosemirror-view 1.41 removes its main DOM observer on destroy, but not
  // the one-shot guard installed for an invisible selection. That document
  // listener retains the destroyed view until another selectionchange. An
  // embedded editor must release it synchronously because the host may keep
  // the document alive indefinitely.
  if (selectionGuard) {
    view.dom.ownerDocument.removeEventListener("selectionchange", selectionGuard);
    input.hideSelectionGuard = null;
  }

  view.destroy();
}

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


type BrowserWindow = Window & typeof globalThis;

type EditorRuntimeOptions = {
  ariaLabel: string | null | undefined;
  ariaLabelledBy: string | null | undefined;
  attributes: Record<string, string>;
  editable: boolean;
  onChange: ((markdown: string, context: MarkdownEditorChangeContext) => void) | undefined;
  onChangeMode: MarkdownEditorChangeMode;
  onEditOpaqueMarkdown: ((request: OpaqueMarkdownEditRequest) => void) | undefined;
  onTransaction: CreateEditorOptions["onTransaction"];
  placeholder: string | null;
};

function copyEditorAttributes(
  attributes: MarkdownEditorDomAttributes | null | undefined,
  ownerDocument: Document,
) {
  const copied: Record<string, string> = Object.create(null) as Record<string, string>;
  const probe = ownerDocument.createElement("div");

  for (const [name, value] of Object.entries(attributes ?? {})) {
    const normalizedName = name.toLowerCase();

    if (typeof value !== "string") {
      throw new TypeError(`Editor DOM attribute \"${name}\" must be a string.`);
    }

    if (normalizedName === "nodename" || /^on[a-z]/.test(normalizedName)) {
      throw new RangeError(`Editor DOM attribute \"${name}\" is not supported.`);
    }

    try {
      probe.setAttribute(normalizedName, value);
    } catch {
      throw new RangeError(`Editor DOM attribute name \"${name}\" is invalid.`);
    }

    copied[normalizedName] = value;
  }

  return copied;
}

function normalizeAccessibleName(value: string | null | undefined, optionName: string) {
  if (value == null) {
    return value;
  }

  if (!value.trim()) {
    throw new RangeError(`${optionName} must not be empty.`);
  }

  return value;
}

function normalizePlaceholder(value: string | null | undefined) {
  return value ? value : null;
}

function buildEditorDomAttributes(runtimeOptions: EditorRuntimeOptions) {
  const attributes = { ...runtimeOptions.attributes };

  for (const name of Object.keys(attributes)) {
    if (["aria-placeholder", "aria-readonly", "contenteditable"].includes(name.toLowerCase())) {
      delete attributes[name];
    }
  }

  attributes.role ??= "textbox";
  attributes["aria-multiline"] ??= "true";
  attributes.tabindex ??= "0";
  attributes["aria-readonly"] = runtimeOptions.editable ? "false" : "true";

  if (runtimeOptions.placeholder) {
    attributes["aria-placeholder"] = runtimeOptions.placeholder;
  }

  if (runtimeOptions.ariaLabel === null) {
    delete attributes["aria-label"];
  } else if (runtimeOptions.ariaLabel !== undefined) {
    attributes["aria-label"] = runtimeOptions.ariaLabel;
  }

  if (runtimeOptions.ariaLabelledBy === null) {
    delete attributes["aria-labelledby"];
  } else if (runtimeOptions.ariaLabelledBy !== undefined) {
    attributes["aria-labelledby"] = runtimeOptions.ariaLabelledBy;
  }

  return attributes;
}

function editorAttributesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftNames = Object.keys(left);
  const rightNames = Object.keys(right);

  return leftNames.length === rightNames.length
    && leftNames.every((name) => left[name] === right[name]);
}

function resolveSelectionTarget(
  doc: ProseMirrorNode,
  target: MarkdownEditorSelectionTarget,
) {
  if (target === "all") {
    return new AllSelection(doc);
  }

  if (target === "start") {
    return Selection.atStart(doc);
  }

  if (target === "end") {
    return Selection.atEnd(doc);
  }

  const { anchor } = target;
  const head = target.head ?? anchor;

  if (!Number.isInteger(anchor) || !Number.isInteger(head)) {
    throw new RangeError("Editor selection positions must be integers.");
  }

  if (anchor < 0 || anchor > doc.content.size || head < 0 || head > doc.content.size) {
    throw new RangeError(`Editor selection positions must be between 0 and ${doc.content.size}.`);
  }

  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);

  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) {
    throw new RangeError("Editor selection positions must resolve inside text blocks.");
  }

  return TextSelection.create(doc, anchor, head);
}

function getSelectionKind(selection: Selection): MarkdownEditorSelectionKind {
  if (selection instanceof ManagedBlockCursor) {
    return "managed-block";
  }

  if (selection instanceof AllSelection) {
    return "all";
  }

  if (selection instanceof NodeSelection) {
    return "node";
  }

  if (selection instanceof TextSelection) {
    return "text";
  }

  return "other";
}

function snapshotSelection(selection: Selection): MarkdownEditorSelectionSnapshot {
  return {
    anchor: selection.anchor,
    empty: selection.empty,
    from: selection.from,
    head: selection.head,
    kind: getSelectionKind(selection),
    to: selection.to,
  };
}

function getEditorRootActiveElement(view: EditorView) {
  const root = view.dom.getRootNode();
  const ownerWindow = view.dom.ownerDocument.defaultView;

  if (ownerWindow?.ShadowRoot && root instanceof ownerWindow.ShadowRoot) {
    return root.activeElement ?? view.dom.ownerDocument.activeElement;
  }

  return view.dom.ownerDocument.activeElement;
}

function isActiveElementInsideEditor(view: EditorView, activeElement: Element | null) {
  return activeElement !== null && view.dom.contains(activeElement);
}

function blurElement(element: Element | null) {
  if (!element) {
    return;
  }

  const blur = (element as Element & { blur?: unknown }).blur;

  if (typeof blur === "function") {
    blur.call(element);
  }
}

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

function createCleanupError(message: string, errors: unknown[]) {
  const error = new Error(message) as Error & { errors: unknown[] };
  error.name = "AggregateError";
  error.errors = errors;
  return error;
}

function throwCollectedErrors(message: string, errors: unknown[]) {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw createCleanupError(message, errors);
  }
}

function createChangeContext(origin: MarkdownEditorChangeOrigin): MarkdownEditorChangeContext {
  return Object.freeze({ origin });
}

function createSchemaRuntimeHelpers(
  codec: MarkdownEditorCodec,
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
const { isEscapedOutsideBoundary, escapeBoundaryMark, createEscapedBoundaryPlugin } = createMarkBoundaryHelpers({ getMarkInfo });

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

function getOrderedListMarker(listNode: ProseMirrorNode, listDepth: number, state: EditorState) {
  const { $from } = state.selection;
  const listItemDepth = listDepth + 1;

  if (listItemDepth > $from.depth || $from.node(listItemDepth).type !== schema.nodes.list_item) {
    return null;
  }

  const itemIndex = $from.index(listDepth);
  const order = typeof listNode.attrs.order === "number" ? listNode.attrs.order : 1;
  return `${order + itemIndex}. `;
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

function updateHeadingLevel(view: EditorView, nextLevel: number | null) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  const parent = $from.parent;

  if (parent.type !== schema.nodes.heading || $from.parentOffset !== 0) {
    return false;
  }

  const pos = $from.before();
  const tr = state.tr;

  if (nextLevel === null) {
    tr.setNodeMarkup(pos, schema.nodes.paragraph);
  } else {
    tr.setNodeMarkup(pos, schema.nodes.heading, { level: nextLevel });
  }

  tr.setSelection(TextSelection.create(tr.doc, tr.selection.from));
  view.dispatch(tr);
  return true;
}

function getTableCellContext(state: EditorState): TableCellInfo | null {
  const { selection } = state;
  const { $from } = selection;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);

    if (cellDepth < 0 && (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header)) {
      cellDepth = depth;
      continue;
    }

    if (rowDepth < 0 && node.type === schema.nodes.table_row) {
      rowDepth = depth;
      continue;
    }

    if (tableDepth < 0 && node.type === schema.nodes.table) {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
    return null;
  }

  return {
    table: $from.node(tableDepth),
    row: $from.node(rowDepth),
    cell: $from.node(cellDepth),
    tablePos: $from.before(tableDepth),
    rowPos: $from.before(rowDepth),
    cellPos: $from.before(cellDepth),
    rowIndex: $from.index(tableDepth),
    cellIndex: $from.index(rowDepth),
  };
}

function getTableCellInfo(state: EditorState): TableCellInfo | null {
  if (!state.selection.empty) {
    return null;
  }

  return getTableCellContext(state);
}

function selectionTouchesNodeType(state: EditorState, nodeType: NodeType) {
  const { selection } = state;
  const matchesResolvedPos = (resolvedPos: typeof selection.$from) => {
    for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
      if (resolvedPos.node(depth).type === nodeType) {
        return true;
      }
    }

    return false;
  };

  return matchesResolvedPos(selection.$from) || matchesResolvedPos(selection.$to);
}

const { maybeExtendSelectionAcrossCodeBlock } = createCodeBlockSelectionHelpers({ schema });

function isManagedBlockNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return Boolean(node && codec.managedBlocks.has(node.type.name));
}

function findTextSelectionInsideNode(
  doc: ProseMirrorNode,
  nodePos: number,
  node: ProseMirrorNode,
  direction: -1 | 1,
) {
  if (node.type === schema.nodes.raw_block) {
    return NodeSelection.create(doc, nodePos);
  }

  const searchPos = direction < 0 ? nodePos + node.nodeSize - 1 : nodePos + 1;
  const selection = Selection.findFrom(doc.resolve(searchPos), direction, true);

  if (!selection) {
    return null;
  }

  const from = nodePos;
  const to = nodePos + node.nodeSize;
  return selection.from >= from && selection.to <= to ? selection : null;
}

function findTextSelectionInImmediatePreviousNode(doc: ProseMirrorNode, boundaryPos: number) {
  const $boundary = doc.resolve(boundaryPos);
  const previousNode = $boundary.nodeBefore;

  if (!previousNode) {
    return null;
  }

  const previousNodePos = boundaryPos - previousNode.nodeSize;

  if (previousNode.isTextblock) {
    return TextSelection.create(doc, previousNodePos + previousNode.nodeSize - 1);
  }

  const selection = Selection.findFrom(doc.resolve(boundaryPos), -1, true);

  if (!selection) {
    return null;
  }

  return selection.from >= previousNodePos && selection.to <= boundaryPos ? selection : null;
}

const {
  setManagedBlockBoundarySelection,
  moveBeforeManagedBlock,
  moveInsideManagedBlock,
  insertParagraphAtManagedBlockBoundary,
  removeManagedBlockAtBoundary,
  getManagedBlockBoundary,
  getTableBoundaryEscapeInfo,
} = createManagedBlockBoundaryHelpers({
  schema,
  isManagedBlockNode,
  findTextSelectionInsideNode,
  findTextSelectionInImmediatePreviousNode,
  getTableCellInfo,
});

const {
  createEmptyTableRow,
  appendTableRow,
  appendTableColumn,
  removeTableRow,
  removeTableColumn,
  setTableColumnAlignment,
  removeActiveTable,
  moveTableCellVertical,
  moveTableCell,
} = createTableNavigation({
  schema,
  getTableCellContext,
  normalizeTableAlignment,
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
    escapeBoundaryMark,
    createEscapedBoundaryPlugin,
    revealMarkConfigs,
    ImageView,
    getAncestorInfo,
    getActiveListItemInfo,
    getActiveLineMarker,
    updateHeadingLevel,
    getTableCellContext,
    selectionTouchesNodeType,
    maybeExtendSelectionAcrossCodeBlock,
    isManagedBlockNode,
    setManagedBlockBoundarySelection,
    moveBeforeManagedBlock,
    moveInsideManagedBlock,
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
    getTableBoundaryEscapeInfo,
    createEmptyTableRow,
    appendTableRow,
    appendTableColumn,
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
    ui,
  } = options;
  const ownerWindow = element.ownerDocument.defaultView as BrowserWindow | null;

  if (!ownerWindow) {
    throw new Error("Markora requires a window-backed document.");
  }

  const resources = normalizeMarkdownEditorResources(options.resources);
  let handleResourceError: (
    error: unknown,
    phase: MarkdownEditorResourceErrorPhase,
  ) => void = () => undefined;

  const defaultExtensionPreset = createDefaultMarkdownEditorPreset();
  const selectedExtensionPreset = extensionPreset ?? defaultExtensionPreset;
  const usesCompatibilityPreset = selectedExtensionPreset === defaultExtensionPreset;
  const extensionResolution = resolveMarkdownEditorExtensions({
    markoraVersion: MARKORA_VERSION,
    preset: selectedExtensionPreset,
    extensions,
  });
  assertMarkdownEditorCompatibilityAdaptersActive(
    extensionResolution,
    usesCompatibilityPreset,
  );
  const codec = usesCompatibilityPreset
    ? createCompatibilityMarkdownCodec(extensionResolution.extensions, resources)
    : createMinimalMarkdownCodec(extensionResolution.extensions, resources);
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
    escapeBoundaryMark,
    createEscapedBoundaryPlugin,
    revealMarkConfigs,
    ImageView,
    getAncestorInfo,
    getActiveListItemInfo,
    getActiveLineMarker,
    updateHeadingLevel,
    getTableCellContext,
    selectionTouchesNodeType,
    maybeExtendSelectionAcrossCodeBlock,
    isManagedBlockNode,
    setManagedBlockBoundarySelection,
    moveBeforeManagedBlock,
    moveInsideManagedBlock,
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
    getTableBoundaryEscapeInfo,
    appendTableRow,
    appendTableColumn,
    removeTableRow,
    removeTableColumn,
    setTableColumnAlignment,
    removeActiveTable,
    moveTableCellVertical,
    moveTableCell,
    convertPipeTable,
  } = createSchemaRuntimeHelpers(
    codec,
    resources,
    (error, phase) => handleResourceError(error, phase),
  );
  const requestFrame = typeof ownerWindow.requestAnimationFrame === "function"
    ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
    : ((callback: FrameRequestCallback) => ownerWindow.setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = typeof ownerWindow.cancelAnimationFrame === "function"
    ? ownerWindow.cancelAnimationFrame.bind(ownerWindow)
    : ((frameId: number) => ownerWindow.clearTimeout(frameId));
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
    onChangeMode: normalizeMarkdownEditorChangeMode(options.onChangeMode),
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
    reservedNodeViews: usesCompatibilityPreset
      ? ["code_block", "image", "raw_block", "raw_inline"]
      : ["image"],
    reportError: reportExtensionError,
  });

  const listItemType = schema.nodes.list_item;
  const structuralCommandSet = createStructuralCommandSet(schema);
  const createToggleMarkCommand = (name: MarkdownEditorMark): EditorCommand => {
    const markType = schema.marks[name];
    return markType ? toggleMark(markType) : () => false;
  };
  const commands = {
    toggleBold: createToggleMarkCommand("strong"),
    toggleItalic: createToggleMarkCommand("em"),
    toggleCode: createToggleMarkCommand("code"),
    toggleStrike: createToggleMarkCommand("strike"),
    undo,
    redo,
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
  const CodeBlockView = createCodeBlockViewClass({
    languageRegistry: codeBlockLanguages,
    nestedClipboard: extensionAssembly.contributions.nestedClipboard,
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
    moveBeforeManagedBlock,
    setManagedBlockBoundarySelection,
  });
  const TaskListItemView = createTaskListItemViewClass(schema.nodes.list_item);
  const RawBlockView = createOpaqueNodeViewClass({
    display: "block",
    getOnEdit: () => runtimeOptions.onEditOpaqueMarkdown,
    nodeType: schema.nodes.raw_block,
  });
  const RawInlineView = createOpaqueNodeViewClass({
    display: "inline",
    getOnEdit: () => runtimeOptions.onEditOpaqueMarkdown,
    nodeType: schema.nodes.raw_inline,
  });
  let uiControllers!: EditorUiControllers;
  let imageEditor!: ImageEditorOverlay;
  let linkEditor!: LinkEditorOverlay;
  let tableToolbar!: TableToolbarOverlay;
  let uiEnabled = false;
  let uiFactoryReturned = false;

  let releaseHostOwnership: () => void;

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
    const canRunUiAction = (targetView: EditorView) => (
      lifecycle === "active"
      && !targetView.isDestroyed
      && targetView.editable
    );
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
      appendTableColumn: (view) => { if (canRunUiAction(view)) appendTableColumn(view); },
      appendTableRow: (view) => { if (canRunUiAction(view)) appendTableRow(view); },
      removeTableColumn: (view) => { if (canRunUiAction(view)) removeTableColumn(view); },
      removeTableRow: (view) => { if (canRunUiAction(view)) removeTableRow(view); },
      setTableColumnAlignment: (view, alignment) => { if (canRunUiAction(view)) setTableColumnAlignment(view, alignment); },
      removeActiveTable: (view) => { if (canRunUiAction(view)) removeActiveTable(view); },
      getTableContext: getTableCellContext,
      normalizeTableAlignment,
    }) ?? createNoopUiControllers();
    uiFactoryReturned = true;
    uiEnabled = Boolean(uiControllers.enabled);
    imageEditor = uiControllers.imageEditor;
    linkEditor = uiControllers.linkEditor;
    tableToolbar = uiControllers.tableToolbar;
  } catch (error) {
    const cleanupErrors = [error];

    if (uiFactoryReturned) {
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
    ownerWindow,
    reportUnhandled,
    resources,
    schema,
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
    takeExtensionFailure: extensionAssembly.contributions.takeClipboardFailure,
  });

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
    createTypingShortcuts({ schema, getAncestorInfo, resources }),
    ...(extensionAssembly.contributions.inputRules
      ? [extensionAssembly.contributions.inputRules]
      : []),
    createHeadingEditingPlugin({ schema, convertPipeTable, updateHeadingLevel }),
    createHorizontalRulePlugin({
      schema,
      createManagedBlockCursor: (doc, blockPos, side) => ManagedBlockCursor.create(doc, blockPos, side, isManagedBlockNode),
      isManagedBlockNode,
    }),
    createImagePlugin({ schema, resources }),
    createEscapedBoundaryPlugin(),
    createManagedBlockBoundaryPlugin({
      isManagedBlockNode,
      getTableBoundaryEscapeInfo,
      moveBeforeManagedBlock,
      setManagedBlockBoundarySelection,
      getManagedBlockBoundary,
      moveInsideManagedBlock,
      insertParagraphAtManagedBlockBoundary,
      removeManagedBlockAtBoundary,
    }),
    createMarkBoundaryPlugin({
      linkEditor,
      imageEditor,
      tableToolbar,
      enableDefaultUi: uiEnabled,
      convertFenceToCodeBlock: (view) => convertFenceToCodeBlock(schema, view),
      handleNativeTaskControlKeyDown,
      maybeExtendSelectionAcrossCodeBlock,
      escapeBoundaryMark,
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
    clipboard.plugin,
    // Clamp the final slice after both structured transforms and raw extension
    // plugins so extension precedence cannot reintroduce unsafe URLs.
    codec.createImportedContentSanitizerPlugin(),
    history(),
    ...(extensionAssembly.contributions.keymap
      ? [extensionAssembly.contributions.keymap]
      : []),
    keymap({
      Enter: chainCommands(splitListItem(listItemType), liftEmptyBlock),
      "Shift-Enter": (state, dispatch) => insertHardBreak(schema, state, dispatch),
      Tab: (state, dispatch, view) => moveTableCell(view!, 1) || sinkListItem(listItemType)(state, dispatch, view),
      "Shift-Tab": (state, dispatch, view) => moveTableCell(view!, -1) || liftListItem(listItemType)(state, dispatch, view),
      ArrowUp: (_state, _dispatch, view) => moveTableCellVertical(view!, -1),
      ArrowDown: (_state, _dispatch, view) => moveTableCellVertical(view!, 1),
      "Mod-b": commands.toggleBold,
      "Mod-i": commands.toggleItalic,
      "Mod-e": commands.toggleCode,
      "Mod-Shift-x": commands.toggleStrike,
      "Mod-z": commands.undo,
      "Shift-Mod-z": commands.redo,
      "Mod-y": commands.redo,
    }),
    keymap(baseKeymap),
  ];

  let finalMarkdown = "";
  let compositeFocused = false;
  let pendingBlurVersion = 0;
  const changeEmitter = createChangeEmitter<ProseMirrorNode, MarkdownEditorChangeContext>({
    cancelFrame,
    initialDoc: doc,
    initialMarkdown,
    isDeliveryValid: (targetDoc) => (
      lifecycle === "active"
      && !view.isDestroyed
      && view.state.doc === targetDoc
    ),
    mode: runtimeOptions.onChangeMode,
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
    requestFrame,
    scheduleIdle: idleScheduler.schedule,
    serialize: (targetDoc) => runReportedExtensionOperation(
      () => codec.serialize(targetDoc),
    ),
  });
  finalMarkdown = changeEmitter.getMarkdown(doc);

  const emitSelectionChange = (
    previousSelection: Selection,
    selection: Selection,
    expectedState: EditorState,
    origin: MarkdownEditorChangeOrigin,
  ) => {
    if (
      previousSelection.eq(selection)
      || lifecycle !== "active"
      || !eventDispatcher.has("selection")
    ) {
      return;
    }

    eventDispatcher.emit(
      "selection",
      {
        editor,
        origin,
        previousSelection: snapshotSelection(previousSelection),
        selection: snapshotSelection(selection),
        type: "selection",
      },
      () => (
        lifecycle === "active"
        && !view.isDestroyed
        && view.state.selection.eq(expectedState.selection)
      ),
    );
  };

  const emitUpdate = (origin: MarkdownEditorChangeOrigin) => {
    if (lifecycle !== "active" || !eventDispatcher.has("update")) {
      return;
    }

    const expectedState = view.state;

    eventDispatcher.emit(
      "update",
      {
        editor,
        origin,
        selection: snapshotSelection(expectedState.selection),
        type: "update",
      },
      () => (
        lifecycle === "active"
        && !view.isDestroyed
        && view.state.doc.eq(expectedState.doc)
      ),
    );
  };

  const emitStateChange = (
    previousState: EditorState,
    nextState: EditorState,
    documentChanged: boolean,
    origin: MarkdownEditorChangeOrigin,
  ) => {
    if (lifecycle !== "active" || !eventDispatcher.has("state")) {
      return;
    }

    eventDispatcher.emit(
      "state",
      {
        docChanged: documentChanged,
        editor,
        origin,
        selection: snapshotSelection(nextState.selection),
        selectionChanged: !previousState.selection.eq(nextState.selection),
        type: "state",
      },
      () => (
        lifecycle === "active"
        && !view.isDestroyed
        && view.state === nextState
      ),
    );
  };

  const emitStateEvents = (
    previousState: EditorState,
    nextState: EditorState,
    documentChanged: boolean,
    origin: MarkdownEditorChangeOrigin,
  ) => {
    if (lifecycle !== "active" || view.isDestroyed) {
      return;
    }

    if (view.state === nextState) {
      emitStateChange(previousState, nextState, documentChanged, origin);
    }

    if (lifecycle === "active" && !view.isDestroyed && view.state === nextState) {
      emitSelectionChange(previousState.selection, nextState.selection, nextState, origin);
    }

    if (
      documentChanged
      && lifecycle === "active"
      && !view.isDestroyed
      && view.state.doc.eq(nextState.doc)
    ) {
      emitUpdate(origin);
    }
  };

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

  const setMarkdownValue = (
    nextMarkdown: string,
    setOptions?: MarkdownEditorMarkdownUpdateOptions,
  ) => replaceMarkdownState(nextMarkdown, setOptions, "set Markdown");

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

  const getBuiltinMarkState = (
    name: MarkdownEditorMark,
    command: EditorCommand,
  ): ToolbarButtonState => {
    const markType = schema.marks[name];

    if (!markType) {
      return { active: false, enabled: false };
    }

    return getToolbarMarkState(
      view.state,
      name,
      markType,
      command,
      isEscapedOutsideBoundary,
    );
  };

  const isMarkActive = (mark: MarkdownEditorActiveMark) => {
    switch (mark) {
      case "strong":
        return getBuiltinMarkState("strong", commands.toggleBold).active;
      case "em":
        return getBuiltinMarkState("em", commands.toggleItalic).active;
      case "code":
        return getBuiltinMarkState("code", commands.toggleCode).active;
      case "strike":
        return getBuiltinMarkState("strike", commands.toggleStrike).active;
      case "link":
        return getLinkToolbarState({ state: view.state, canSetLink, isEscapedOutsideBoundary }).active;
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
      addTableRow() {
        return canRunCommand(
          "query whether a table row can be added",
          structuralCommandSet.commands.addTableRow,
        );
      },
      addTableColumn() {
        return canRunCommand(
          "query whether a table column can be added",
          structuralCommandSet.commands.addTableColumn,
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
    setMarkdown: setMarkdownValue,
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
    addTableRow() {
      return runStructuralCommand(structuralCommandSet.commands.addTableRow);
    },
    addTableColumn() {
      return runStructuralCommand(structuralCommandSet.commands.addTableColumn);
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

  const getToolbarState = (): ToolbarState => {
    assertActive("read toolbar state");
    const toolbarState: ToolbarState = {
      bold: getBuiltinMarkState("strong", commands.toggleBold),
      italic: getBuiltinMarkState("em", commands.toggleItalic),
      code: getBuiltinMarkState("code", commands.toggleCode),
      strike: getBuiltinMarkState("strike", commands.toggleStrike),
      link: getLinkToolbarState({ state: view.state, canSetLink, isEscapedOutsideBoundary }),
      image: getImageToolbarState({ state: view.state, canInsertImage, getActiveImageInfo }),
      undo: { enabled: runtimeOptions.editable && commands.undo(view.state) },
      redo: { enabled: runtimeOptions.editable && commands.redo(view.state) },
    };

    if (!runtimeOptions.editable) {
      toolbarState.bold.enabled = false;
      toolbarState.italic.enabled = false;
      toolbarState.code.enabled = false;
      toolbarState.strike.enabled = false;
      toolbarState.link.enabled = false;
      toolbarState.image.enabled = false;
    }

    return toolbarState;
  };

  const hostChildrenBeforeView = new Set(element.childNodes);

  const cleanupConstructionFailure = (primaryError: unknown) => {
    const errors = [primaryError];
    lifecycle = "destroying";
    pendingExtensionErrors.length = 0;
    extensionAssembly.beginDestroy();

    for (const cleanup of [
      () => changeEmitter.cancel(),
      () => { errors.push(...extensionAssembly.cleanupSetup()); },
      () => {
        if (view && !view.isDestroyed) {
          runWithViewErrorCollector(errors, () => destroyProseMirrorView(view));
        }
      },
      () => linkEditor.destroy(),
      () => imageEditor.destroy(),
      () => tableToolbar.destroy(),
      () => { errors.push(...extensionAssembly.cleanupAssembly()); },
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }

    errors.push(
      ...pendingLanguageLoadErrors.splice(0).map(({ error }) => error),
      ...pluginInitializationErrors.splice(0),
      ...deferredViewErrors.splice(0),
    );

    for (const child of [...element.childNodes]) {
      if (!hostChildrenBeforeView.has(child)) {
        child.remove();
      }
    }

    releaseHostOwnership();
    lifecycle = "destroyed";

    if (errors.length === 1) {
      throw primaryError;
    }

    throw createCleanupError("Markora creation failed and one or more cleanup operations also failed.", errors);
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
        ...(usesCompatibilityPreset ? {
          list_item(node: ProseMirrorNode, targetView: EditorView) {
            return new TaskListItemView(node, targetView);
          },
        } : {}),
        ...(usesCompatibilityPreset ? {
          code_block(node: ProseMirrorNode, targetView: EditorView, getPos: () => number | undefined) {
            return new CodeBlockView(node, targetView, getPos as () => number);
          },
        } : {}),
        image(node, editorView) {
          return new ImageView(node, editorView.dom.ownerDocument);
        },
        ...(usesCompatibilityPreset ? {
          raw_block(node: ProseMirrorNode, editorView: EditorView, getPos: (() => number | undefined) | boolean) {
            return new RawBlockView(node, editorView, getPos as () => number | undefined);
          },
          raw_inline(node: ProseMirrorNode, editorView: EditorView, getPos: (() => number | undefined) | boolean) {
            return new RawInlineView(node, editorView, getPos as () => number | undefined);
          },
        } : {}),
        ...extensionAssembly.contributions.nodeViews,
      },
      dispatchTransaction(this: EditorView, transaction) {
        const activeView = this;
        let origin = getMarkdownEditorTransactionOrigin(transaction);

        if (!origin) {
          origin = "user";
          setBuiltinMarkdownEditorTransactionOrigin(transaction, origin);
        }

        const changeContext = createChangeContext(origin);
        const shouldEmitChange = (
          getMarkdownEditorTransactionEmitChange(transaction) ?? (origin !== "external")
        );
        const previousState = activeView.state;
        const nextState = previousState.apply(transaction);
        const callbackErrors: unknown[] = [];
        runWithViewErrorCollector(callbackErrors, () => activeView.updateState(nextState));

        if (lifecycle === "active" && !activeView.isDestroyed) {
          try {
            runtimeOptions.onTransaction?.(transaction, activeView, changeContext);
          } catch (error) {
            callbackErrors.push(error);
          }
        }

        const documentChanged = !previousState.doc.eq(nextState.doc);

        if (
          lifecycle === "active"
          && !activeView.isDestroyed
          && activeView.state.doc.eq(nextState.doc)
        ) {
          if (documentChanged && shouldEmitChange) {
            try {
              changeEmitter.schedule(nextState.doc, changeContext);
            } catch (error) {
              callbackErrors.push(error);
            }
          }

          if (editor) {
            emitStateEvents(previousState, nextState, documentChanged, origin);
          }
        }

        throwCollectedErrors("Multiple Markora callbacks failed for one transaction.", callbackErrors);
      },
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

  if (usesCompatibilityPreset) {
    CodeBlockView.setEditable(runtimeOptions.editable);
  }
  syncReadonlyControls(view);

  const handleFocusIn = (nativeEvent: FocusEvent) => {
    pendingBlurVersion += 1;

    if (lifecycle !== "active" || compositeFocused || !editor) {
      return;
    }

    compositeFocused = true;

    if (!eventDispatcher.has("focus")) {
      return;
    }

    // ProseMirror and CodeMirror may temporarily pause observers while their
    // focus methods dispatch native events. Host callbacks must not destroy
    // either view inside that internal focus stack, or the library can resume
    // an observer after teardown. Deliver once the native focus operation has
    // fully returned instead.
    ownerWindow.queueMicrotask(() => {
      if (lifecycle !== "active" || !compositeFocused || view.isDestroyed) {
        return;
      }

      eventDispatcher.emit("focus", {
        editor,
        nativeEvent,
        type: "focus",
      }, () => lifecycle === "active" && !view.isDestroyed);
    });
  };

  const handleFocusOut = (nativeEvent: FocusEvent) => {
    const nextBlurVersion = ++pendingBlurVersion;

    ownerWindow.queueMicrotask(() => {
      if (
        lifecycle !== "active"
        || !compositeFocused
        || nextBlurVersion !== pendingBlurVersion
      ) {
        return;
      }

      const activeElement = getEditorRootActiveElement(view);

      if (isActiveElementInsideEditor(view, activeElement)) {
        return;
      }

      compositeFocused = false;

      if (!eventDispatcher.has("blur")) {
        return;
      }

      eventDispatcher.emit("blur", {
        editor,
        nativeEvent,
        type: "blur",
      });
    });
  };

  view.dom.addEventListener("focusin", handleFocusIn);
  view.dom.addEventListener("focusout", handleFocusOut);

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
    const nextOnChangeMode = nextOptions.onChangeMode;
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

    if (nextOnChangeMode !== undefined) {
      runtimePatch.onChangeMode = normalizeMarkdownEditorChangeMode(nextOnChangeMode);
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
      ("onChange" in runtimePatch && runtimePatch.onChange !== runtimeOptions.onChange)
      || ("onChangeMode" in runtimePatch && runtimePatch.onChangeMode !== runtimeOptions.onChangeMode)
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
    const changesOnChangeMode = nextRuntimeOptions.onChangeMode !== runtimeOptions.onChangeMode;
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

    if (changesOnChange || changesOnChangeMode) {
      changeEmitter.update({
        ...(changesOnChange ? { onChange: nextRuntimeOptions.onChange ?? null } : {}),
        ...(changesOnChangeMode ? { mode: runtimeOptions.onChangeMode } : {}),
      });
    }

    const optionErrors: unknown[] = [];

    if (changesEditable && usesCompatibilityPreset) {
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

    if (usesCompatibilityPreset && (changesEditable || changesOnEditOpaqueMarkdown)) {
      RawBlockView.refresh();
      RawInlineView.refresh();
    }

    if (changesEditable && !runtimeOptions.editable) {
      try {
        uiControllers.clearSelectionAnchor();
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
    commands: editorCommandApi,
    state: editorStateApi,
    ui: uiEnabled ? {
      editLink: editLinkValue,
      editImage: editImageValue,
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
      }
    },
    getMarkdown() {
      if (lifecycle !== "active" || view.isDestroyed) {
        return finalMarkdown;
      }

      return changeEmitter.getMarkdown(view.state.doc);
    },
    flushChange() {
      if (lifecycle !== "active" || view.isDestroyed) {
        return;
      }

      changeEmitter.flush();
    },
    getToolbarState,
    subscribe(type, listener) {
      assertActive("subscribe to editor events");
      return eventDispatcher.subscribe(type, listener);
    },
    updateOptions,
    destroy() {
      if (lifecycle !== "active") {
        return;
      }

      const cleanupErrors: unknown[] = [];

      lifecycle = "destroying";
      creationComplete = false;
      pendingExtensionErrors.length = 0;
      extensionAssembly.beginDestroy();

      try {
        finalMarkdown = changeEmitter.getMarkdown(view.state.doc);
      } catch (error) {
        cleanupErrors.push(error);
      }

      pendingExtensionErrors.length = 0;
      pendingBlurVersion += 1;
      view.dom.removeEventListener("focusin", handleFocusIn);
      view.dom.removeEventListener("focusout", handleFocusOut);

      for (const cleanup of [
        () => changeEmitter.flushFinal(),
        () => assetController.cancelAll({ dispatch: false, emit: false }),
        () => uiControllers.clearSelectionAnchor(),
        () => { cleanupErrors.push(...extensionAssembly.cleanupSetup()); },
        () => runWithViewErrorCollector(cleanupErrors, () => destroyProseMirrorView(view)),
        () => linkEditor.destroy(),
        () => imageEditor.destroy(),
        () => tableToolbar.destroy(),
        () => { cleanupErrors.push(...extensionAssembly.cleanupAssembly()); },
      ]) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      cleanupErrors.push(...deferredViewErrors.splice(0));

      eventDispatcher.clear();
      releaseHostOwnership();
      lifecycle = "destroyed";

      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }

      if (cleanupErrors.length > 1) {
        throw createCleanupError("One or more Markora cleanup operations failed.", cleanupErrors);
      }
    },
  };

  lifecycle = "active";

  try {
    extensionAssembly.attachView({ view, editor });
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
