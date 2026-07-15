import { baseKeymap, chainCommands, liftEmptyBlock, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { type Node as ProseMirrorNode, type NodeType } from "prosemirror-model";
import { sinkListItem, splitListItem, liftListItem } from "prosemirror-schema-list";
import { AllSelection, EditorState, NodeSelection, Plugin, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "./managedBlockCursor";
export { ManagedBlockCursor } from "./managedBlockCursor";
import { createManagedBlockBoundaryPlugin } from "./managedBlockCursorPlugin";
import { createManagedBlockBoundaryHelpers } from "./managedBlockBoundary";
import { createCodeBlockViewClass } from "./codeBlockView";
import { createChangeEmitter } from "./changeEmitter";
import { createFileTransferGuardPlugin } from "./fileTransferGuard";
import { createImportedContentSanitizerPlugin, createTableCellContentFromMarkdown, markdownSerializer, normalizeTableAlignment, parseMarkdown, schema } from "./markdownCodec";
import { createImageViewClass } from "./imageView";
import { convertFenceToCodeBlock, createTypingShortcuts, getImageToolbarState, getLinkToolbarState, getMarkInfo, getToolbarMarkState, insertHardBreak, type EditorCommand } from "./editorCommands";
import { createCodeBlockOuterSelectionPlugin, createHeadingEditingPlugin, createHorizontalRulePlugin, createImagePlugin, createMarkdownRevealPlugin, createMarkBoundaryPlugin, type RevealMarkConfig } from "./editorPlugins";
import { createCodeBlockSelectionHelpers } from "./codeBlockSelection";
import type { CodeBlockLanguageRegistry } from "./codeBlockLanguages";
import { createPipeTableHelpers } from "./pipeTable";
import { createTableNavigation, type TableAlignment } from "./tableNavigation";
import type { TableCellInfo } from "./tableTypes";
import type { ActiveImageInfo, EditorUiControllers, EditorUiFactory, ImageEditorOverlay, LinkEditorOverlay, TableToolbarOverlay } from "./uiTypes";
import { createNoopUiControllers } from "./uiTypes";
import { createTaskListHelpers } from "./taskListUtils";
import { createMediaActionHelpers } from "./mediaActionUtils";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";
import { createOpaqueNodeViewClass } from "./opaqueNodeView";
import type { OpaqueMarkdownEditRequest } from "./opaqueMarkdown";
import { createPlaceholderPlugin } from "./placeholderPlugin";
import {
  createEditorEventDispatcher,
  MarkdownEditorDestroyedError,
  type MarkdownEditorEventListener,
  type MarkdownEditorEventName,
  type MarkdownEditorSelectionKind,
  type MarkdownEditorSelectionSnapshot,
  type MarkdownEditorUnsubscribe,
} from "./editorEvents";

export type MarkdownEditorDomAttributes = Readonly<Record<string, string>>;

export type MarkdownEditorSelectionTarget =
  | "all"
  | "end"
  | "start"
  | {
    anchor: number;
    head?: number;
  };

export type CreateEditorOptions = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: MarkdownEditorDomAttributes;
  autofocus?: boolean;
  codeBlockLanguages?: CodeBlockLanguageRegistry;
  editable?: boolean;
  element: HTMLElement;
  initialSelection?: MarkdownEditorSelectionTarget;
  markdown?: string;
  onTransaction?: (transaction: Parameters<EditorView["dispatch"]>[0], view: EditorView) => void;
  onChange?: (markdown: string) => void;
  onChangeMode?: "immediate" | "animationFrame";
  onEditOpaqueMarkdown?: (request: OpaqueMarkdownEditRequest) => void;
  placeholder?: string;
  ui?: EditorUiFactory;
};

export type UpdateEditorOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: MarkdownEditorDomAttributes | null;
  editable?: boolean;
  onChange?: ((markdown: string) => void) | null;
  onChangeMode?: "immediate" | "animationFrame";
  onEditOpaqueMarkdown?: ((request: OpaqueMarkdownEditRequest) => void) | null;
  onTransaction?: CreateEditorOptions["onTransaction"] | null;
  placeholder?: string | null;
};

export type MarkdownEditorMark = "strong" | "em" | "code" | "strike";
export type MarkdownEditorActiveMark = MarkdownEditorMark | "link";
export type MarkdownEditorActiveNode = "image" | "table" | "code_block";

export type MarkdownEditorCommands = {
  setMarkdown: (markdown: string, options?: { emitChange?: boolean }) => void;
  toggleMark: (mark: MarkdownEditorMark) => boolean;
  setLink: (href: string) => boolean;
  removeLink: () => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  removeImage: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
};

export type MarkdownEditorState = {
  can: {
    toggleMark: (mark: MarkdownEditorMark) => boolean;
    setLink: () => boolean;
    insertImage: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
  };
  isActive: {
    mark: (mark: MarkdownEditorActiveMark) => boolean;
    node: (node: MarkdownEditorActiveNode) => boolean;
  };
};

export type MarkdownEditorUi = {
  editLink: () => boolean;
  editImage: () => boolean;
};

export type MarkdownEditor = {
  readonly isDestroyed: boolean;
  readonly view: EditorView;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  blur: () => void;
  focus: (selection?: MarkdownEditorSelectionTarget) => void;
  getMarkdown: () => string;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
  subscribe: <TType extends MarkdownEditorEventName>(
    type: TType,
    listener: MarkdownEditorEventListener<TType>,
  ) => MarkdownEditorUnsubscribe;
  updateOptions: (options: UpdateEditorOptions) => void;
  destroy: () => void;
};

export type ToolbarButtonState = {
  active: boolean;
  enabled: boolean;
};

export type ToolbarState = {
  bold: ToolbarButtonState;
  italic: ToolbarButtonState;
  code: ToolbarButtonState;
  strike: ToolbarButtonState;
  link: ToolbarButtonState;
  image: ToolbarButtonState;
  undo: { enabled: boolean };
  redo: { enabled: boolean };
};


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
  onChange: ((markdown: string) => void) | undefined;
  onChangeMode: "immediate" | "animationFrame";
  onEditOpaqueMarkdown: ((request: OpaqueMarkdownEditRequest) => void) | undefined;
  onTransaction: CreateEditorOptions["onTransaction"];
  placeholder: string | null;
};

const activeEditorHosts = new WeakSet<HTMLElement>();

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
    return root.activeElement;
  }

  return view.dom.ownerDocument.activeElement;
}

function syncReadonlyControls(view: EditorView) {
  const editable = view.editable;

  for (const control of view.dom.querySelectorAll<HTMLElement>('[data-mdw-task-control="true"]')) {
    control.setAttribute("aria-disabled", editable ? "false" : "true");
    control.tabIndex = editable ? 0 : -1;
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

const {
  maybeToggleTaskListItem,
  scheduleTaskControlFocusAfterHistoryShortcut,
  shouldUseNativeTaskControlTab,
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
} = createMediaActionHelpers({ schema, getMarkInfo });
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

const ImageView = createImageViewClass({ imageNodeType: schema.nodes.image });

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
  return isManagedBlockNodeFromSchema(schema, node);
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

export function createEditor(options: CreateEditorOptions): MarkdownEditor {
  const {
    autofocus = false,
    codeBlockLanguages,
    element,
    initialSelection,
    markdown = "",
    ui,
  } = options;
  const ownerWindow = element.ownerDocument.defaultView as BrowserWindow | null;

  if (!ownerWindow) {
    throw new Error("Markora requires a window-backed document.");
  }

  const requestFrame = typeof ownerWindow.requestAnimationFrame === "function"
    ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
    : ((callback: FrameRequestCallback) => ownerWindow.setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = typeof ownerWindow.cancelAnimationFrame === "function"
    ? ownerWindow.cancelAnimationFrame.bind(ownerWindow)
    : ((frameId: number) => ownerWindow.clearTimeout(frameId));
  const doc = parseMarkdown(markdown);

  if (!doc) {
    throw new Error("Failed to create an empty ProseMirror document.");
  }

  if (activeEditorHosts.has(element)) {
    throw new Error("Markora already has a live editor mounted on this element.");
  }

  const runtimeOptions: EditorRuntimeOptions = {
    ariaLabel: normalizeAccessibleName(options.ariaLabel, "ariaLabel"),
    ariaLabelledBy: normalizeAccessibleName(options.ariaLabelledBy, "ariaLabelledBy"),
    attributes: copyEditorAttributes(options.attributes, element.ownerDocument),
    editable: options.editable ?? true,
    onChange: options.onChange,
    onChangeMode: options.onChangeMode ?? "immediate",
    onEditOpaqueMarkdown: options.onEditOpaqueMarkdown,
    onTransaction: options.onTransaction,
    placeholder: normalizePlaceholder(options.placeholder),
  };
  const resolvedInitialSelection = initialSelection
    ? resolveSelectionTarget(doc, initialSelection)
    : undefined;
  const hostHadClass = element.classList.contains("mdw-host");
  let lifecycle: "active" | "destroyed" | "destroying" = "active";
  let editor: MarkdownEditor;

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

  const releaseHostOwnership = () => {
    activeEditorHosts.delete(element);

    if (!hostHadClass) {
      element.classList.remove("mdw-host");
    }
  };

  const listItemType = schema.nodes.list_item;
  const commands = {
    toggleBold: toggleMark(schema.marks.strong),
    toggleItalic: toggleMark(schema.marks.em),
    toggleCode: toggleMark(schema.marks.code),
    toggleStrike: toggleMark(schema.marks.strike),
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

  if (activeEditorHosts.has(element)) {
    throw new Error("Markora already has a live editor mounted on this element.");
  }

  activeEditorHosts.add(element);
  element.classList.add("mdw-host");

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

    lifecycle = "destroyed";
    releaseHostOwnership();

    if (cleanupErrors.length > 1) {
      throw createCleanupError("Markora UI initialization failed and cleanup also failed.", cleanupErrors);
    }

    throw error;
  }

  const plugins = [
    new Plugin({
      filterTransaction(transaction) {
        return runtimeOptions.editable || !transaction.docChanged;
      },
    }),
    createPlaceholderPlugin(() => runtimeOptions.placeholder),
    createFileTransferGuardPlugin(),
    createImportedContentSanitizerPlugin(),
    createTypingShortcuts({ schema, getAncestorInfo }),
    createHeadingEditingPlugin({ schema, convertPipeTable, updateHeadingLevel }),
    createHorizontalRulePlugin({
      schema,
      createManagedBlockCursor: (doc, blockPos, side) => ManagedBlockCursor.create(doc, blockPos, side, isManagedBlockNode),
      isManagedBlockNode,
    }),
    createImagePlugin({ schema }),
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
      maybeExtendSelectionAcrossCodeBlock,
      escapeBoundaryMark,
      maybeToggleTaskListItem,
      scheduleTaskControlFocusAfterHistoryShortcut,
      shouldUseNativeTaskControlTab,
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
    history(),
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

  let view!: EditorView;
  let finalMarkdown = "";
  let compositeFocused = false;
  let pendingBlurVersion = 0;
  const changeEmitter = createChangeEmitter<ProseMirrorNode>({
    cancelFrame,
    initialDoc: doc,
    mode: runtimeOptions.onChangeMode,
    onChange: runtimeOptions.onChange,
    requestFrame,
    serialize: (targetDoc) => markdownSerializer.serialize(targetDoc),
  });
  finalMarkdown = changeEmitter.getMarkdown(doc);

  const assertActive = (operation: string) => {
    if (lifecycle !== "active" || view.isDestroyed) {
      throw new MarkdownEditorDestroyedError(operation);
    }
  };

  const emitSelectionChange = (
    previousSelection: Selection,
    selection: Selection,
    expectedState: EditorState,
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

  const emitUpdate = () => {
    if (lifecycle !== "active" || !eventDispatcher.has("update")) {
      return;
    }

    const expectedState = view.state;

    eventDispatcher.emit(
      "update",
      {
        editor,
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

  const emitStateEvents = (
    previousState: EditorState,
    nextState: EditorState,
    documentChanged: boolean,
  ) => {
    if (lifecycle !== "active" || view.isDestroyed) {
      return;
    }

    if (view.state === nextState) {
      emitSelectionChange(previousState.selection, nextState.selection, nextState);
    }

    if (
      documentChanged
      && lifecycle === "active"
      && !view.isDestroyed
      && view.state.doc.eq(nextState.doc)
    ) {
      emitUpdate();
    }
  };

  const runCommand = (command: EditorCommand) => {
    assertActive("run an editor command");

    if (!runtimeOptions.editable) {
      return false;
    }

    const handled = command(view.state, view.dispatch, view);

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

  const setMarkdownValue = (nextMarkdown: string, setOptions?: { emitChange?: boolean }) => {
    assertActive("set Markdown");
    const emitChange = setOptions?.emitChange ?? false;
    assertActive("set Markdown");
    const nextDoc = parseMarkdown(nextMarkdown);

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    changeEmitter.cancel();

    const previousState = view.state;
    const nextState = EditorState.create({
      doc: nextDoc,
      plugins,
    });
    const callbackErrors: unknown[] = [];

    runWithViewErrorCollector(callbackErrors, () => view.updateState(nextState));

    if (lifecycle !== "active" || view.isDestroyed) {
      throwCollectedErrors("Multiple Markora callbacks failed while setting Markdown.", callbackErrors);
      return;
    }

    syncReadonlyControls(view);
    changeEmitter.cache(nextDoc);

    if (emitChange) {
      try {
        changeEmitter.schedule(nextState.doc);
      } catch (error) {
        callbackErrors.push(error);
      }
    }

    emitStateEvents(previousState, nextState, !previousState.doc.eq(nextState.doc));
    throwCollectedErrors("Multiple Markora callbacks failed while setting Markdown.", callbackErrors);
  };

  const runToggleMark = (mark: MarkdownEditorMark) => runCommand(toggleMarkCommands[mark]);

  const setLinkValue = (href: string) => {
    assertActive("set a link");

    if (!runtimeOptions.editable) {
      return false;
    }

    const handled = setLink(view, href);

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

    if (!runtimeOptions.editable) {
      return false;
    }

    const src = attrs.src;
    assertActive("insert an image");
    const alt = attrs.alt;
    assertActive("insert an image");
    const title = attrs.title;
    assertActive("insert an image");
    const handled = insertImage(view, { src, alt, title });

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

  const isMarkActive = (mark: MarkdownEditorActiveMark) => {
    switch (mark) {
      case "strong":
        return getToolbarMarkState(view.state, "strong", schema.marks.strong, commands.toggleBold, isEscapedOutsideBoundary).active;
      case "em":
        return getToolbarMarkState(view.state, "em", schema.marks.em, commands.toggleItalic, isEscapedOutsideBoundary).active;
      case "code":
        return getToolbarMarkState(view.state, "code", schema.marks.code, commands.toggleCode, isEscapedOutsideBoundary).active;
      case "strike":
        return getToolbarMarkState(view.state, "strike", schema.marks.strike, commands.toggleStrike, isEscapedOutsideBoundary).active;
      case "link":
        return getLinkToolbarState({ state: view.state, canSetLink, isEscapedOutsideBoundary }).active;
    }
  };

  const isNodeActive = (node: MarkdownEditorActiveNode) => {
    switch (node) {
      case "image":
        return !!getActiveImageInfo(view.state);
      case "table":
        return selectionTouchesNodeType(view.state, schema.nodes.table);
      case "code_block":
        return selectionTouchesNodeType(view.state, schema.nodes.code_block);
    }
  };

  const editorStateApi: MarkdownEditorState = {
    can: {
      toggleMark(mark) {
        assertActive("query whether a mark can be toggled");
        return runtimeOptions.editable && toggleMarkCommands[mark](view.state);
      },
      setLink() {
        assertActive("query whether a link can be set");
        return runtimeOptions.editable && canSetLink(view.state);
      },
      insertImage() {
        assertActive("query whether an image can be inserted");
        return runtimeOptions.editable && canInsertImage(view.state);
      },
      undo() {
        assertActive("query whether undo is available");
        return runtimeOptions.editable && commands.undo(view.state);
      },
      redo() {
        assertActive("query whether redo is available");
        return runtimeOptions.editable && commands.redo(view.state);
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
    },
  };

  const editorCommandApi: MarkdownEditorCommands = {
    setMarkdown: setMarkdownValue,
    toggleMark(mark) {
      return runToggleMark(mark);
    },
    setLink: setLinkValue,
    removeLink() {
      assertActive("remove a link");
      return runtimeOptions.editable && removeActiveLink(view);
    },
    insertImage: insertImageValue,
    removeImage() {
      assertActive("remove an image");
      return runtimeOptions.editable && removeActiveImage(view);
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
      bold: getToolbarMarkState(view.state, "strong", schema.marks.strong, commands.toggleBold, isEscapedOutsideBoundary),
      italic: getToolbarMarkState(view.state, "em", schema.marks.em, commands.toggleItalic, isEscapedOutsideBoundary),
      code: getToolbarMarkState(view.state, "code", schema.marks.code, commands.toggleCode, isEscapedOutsideBoundary),
      strike: getToolbarMarkState(view.state, "strike", schema.marks.strike, commands.toggleStrike, isEscapedOutsideBoundary),
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

    for (const cleanup of [
      () => {
        if (view && !view.isDestroyed) {
          runWithViewErrorCollector(errors, () => view.destroy());
        }
      },
      () => linkEditor.destroy(),
      () => imageEditor.destroy(),
      () => tableToolbar.destroy(),
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
        code_block(node, view, getPos) {
          return new CodeBlockView(node, view, getPos as () => number);
        },
        image(node, editorView) {
          return new ImageView(node, editorView.dom.ownerDocument);
        },
        raw_block(node, editorView, getPos) {
          return new RawBlockView(node, editorView, getPos);
        },
        raw_inline(node, editorView, getPos) {
          return new RawInlineView(node, editorView, getPos);
        },
      },
      dispatchTransaction(this: EditorView, transaction) {
        const activeView = this;
        const previousState = activeView.state;
        const nextState = previousState.apply(transaction);
        const callbackErrors: unknown[] = [];
        runWithViewErrorCollector(callbackErrors, () => activeView.updateState(nextState));

        if (lifecycle === "active" && !activeView.isDestroyed) {
          try {
            runtimeOptions.onTransaction?.(transaction, activeView);
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
          if (documentChanged) {
            try {
              changeEmitter.schedule(nextState.doc);
            } catch (error) {
              callbackErrors.push(error);
            }
          }

          if (editor) {
            emitStateEvents(previousState, nextState, documentChanged);
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

  CodeBlockView.setEditable(runtimeOptions.editable);
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

      if (activeElement instanceof ownerWindow.Node && view.dom.contains(activeElement)) {
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

    if (nextOnChangeMode != null) {
      runtimePatch.onChangeMode = nextOnChangeMode;
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
    commands: editorCommandApi,
    state: editorStateApi,
    ui: uiEnabled ? {
      editLink: editLinkValue,
      editImage: editImageValue,
    } : null,
    blur() {
      assertActive("blur the editor");
      const activeElement = getEditorRootActiveElement(view);

      if (activeElement instanceof ownerWindow.HTMLElement && view.dom.contains(activeElement)) {
        activeElement.blur();
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
          view.dispatch(view.state.tr.setSelection(nextSelection).scrollIntoView());
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

      try {
        finalMarkdown = changeEmitter.getMarkdown(view.state.doc);
      } catch (error) {
        cleanupErrors.push(error);
      }

      lifecycle = "destroying";
      pendingBlurVersion += 1;
      view.dom.removeEventListener("focusin", handleFocusIn);
      view.dom.removeEventListener("focusout", handleFocusOut);

      for (const cleanup of [
        () => changeEmitter.flush(),
        () => uiControllers.clearSelectionAnchor(),
        () => runWithViewErrorCollector(cleanupErrors, () => view.destroy()),
        () => linkEditor.destroy(),
        () => imageEditor.destroy(),
        () => tableToolbar.destroy(),
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
