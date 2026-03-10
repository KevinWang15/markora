import { baseKeymap, chainCommands, liftEmptyBlock, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { type Node as ProseMirrorNode, type NodeType } from "prosemirror-model";
import { sinkListItem, splitListItem, liftListItem } from "prosemirror-schema-list";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";


export type CreateEditorOptions = {
  codeBlockLanguages?: CodeBlockLanguageRegistry;
  element: HTMLElement;
  markdown?: string;
  onTransaction?: (transaction: Parameters<EditorView["dispatch"]>[0], view: EditorView) => void;
  onChange?: (markdown: string) => void;
  onChangeMode?: "immediate" | "animationFrame";
  ui?: EditorUiFactory;
};

import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "./managedBlockCursor";
export { ManagedBlockCursor } from "./managedBlockCursor";
import { createManagedBlockBoundaryPlugin } from "./managedBlockCursorPlugin";
import { createManagedBlockBoundaryHelpers } from "./managedBlockBoundary";
import { createCodeBlockViewClass } from "./codeBlockView";
import { createChangeEmitter } from "./changeEmitter";
import { createImportedContentSanitizerPlugin, createTableCellContentFromMarkdown, markdownSerializer, normalizeTableAlignment, parseMarkdown, schema } from "./markdownCodec";
import { createImageViewClass } from "./imageView";
import { convertFenceToCodeBlock, createTypingShortcuts, getImageToolbarState, getLinkToolbarState, getMarkInfo, getToolbarMarkState, insertHardBreak, type EditorCommand } from "./editorCommands";
import { createCodeBlockOuterSelectionPlugin, createHeadingEditingPlugin, createHorizontalRulePlugin, createImagePlugin, createMarkdownRevealPlugin, createMarkBoundaryPlugin, type RevealMarkConfig } from "./editorPlugins";
import { createCodeBlockSelectionHelpers } from "./codeBlockSelection";
import type { CodeBlockLanguageRegistry } from "./codeBlockLanguages";
import { createPipeTableHelpers } from "./pipeTable";
import { createTableNavigation, type TableAlignment } from "./tableNavigation";
import type { TableCellInfo } from "./tableTypes";
import type { ActiveImageInfo, EditorUiFactory, ImageEditorOverlay, LinkEditorOverlay, TableToolbarOverlay } from "./uiTypes";
import { createNoopUiControllers } from "./uiTypes";
import { createTaskListHelpers } from "./taskListUtils";
import { createMediaActionHelpers } from "./mediaActionUtils";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";

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
  view: EditorView;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  getMarkdown: () => string;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
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

const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
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
  const { codeBlockLanguages, element, markdown = "", onChange, onChangeMode = "immediate", onTransaction, ui } = options;
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

  element.classList.add("mdw-host");

  const listItemType = schema.nodes.list_item;
  const commands = {
    toggleBold: toggleMark(schema.marks.strong),
    toggleItalic: toggleMark(schema.marks.em),
    toggleCode: toggleMark(schema.marks.code),
    toggleStrike: toggleMark(schema.marks.strike),
    undo,
    redo,
  } satisfies Record<string, EditorCommand>;
  const CodeBlockView = createCodeBlockViewClass({
    languageRegistry: codeBlockLanguages,
    schema,
    moveBeforeManagedBlock,
    setManagedBlockBoundarySelection,
  });
  const uiControllers = ui?.({
    updateLinkHref,
    removeActiveLink,
    updateActiveImage,
    removeActiveImage,
    hostElement: element,
    appendTableColumn,
    appendTableRow,
    removeTableColumn,
    removeTableRow,
    setTableColumnAlignment,
    removeActiveTable,
    getTableContext: getTableCellContext,
    normalizeTableAlignment,
  }) ?? createNoopUiControllers();
  const { imageEditor, linkEditor, tableToolbar } = uiControllers;

  const plugins = [
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
      enableDefaultUi: uiControllers.enabled,
      convertFenceToCodeBlock: (view) => convertFenceToCodeBlock(schema, view),
      maybeExtendSelectionAcrossCodeBlock,
      escapeBoundaryMark,
      maybeToggleTaskListItem,
      maybeOpenImage,
      maybeOpenLink,
      maybeEditActiveImage,
      maybeEditActiveLink,
      getMarkInfo,
      getActiveImageInfo,
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

  let view: EditorView;
  const changeEmitter = createChangeEmitter<ProseMirrorNode>({
    cancelFrame,
    initialDoc: doc,
    mode: onChangeMode,
    onChange,
    requestFrame,
    serialize: (targetDoc) => markdownSerializer.serialize(targetDoc),
  });

  const runCommand = (command: EditorCommand) => {
    const handled = command(view.state, view.dispatch, view);

    if (handled) {
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
    const nextDoc = parseMarkdown(nextMarkdown);

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    changeEmitter.cancel();

    const nextState = EditorState.create({
      doc: nextDoc,
      plugins,
    });

    view.updateState(nextState);
    changeEmitter.cache(nextDoc);

    if (setOptions?.emitChange) {
      changeEmitter.schedule(nextState.doc);
    }
  };

  const runToggleMark = (mark: MarkdownEditorMark) => runCommand(toggleMarkCommands[mark]);

  const setLinkValue = (href: string) => {
    const handled = setLink(view, href);

    if (handled) {
      uiControllers.clearSelectionAnchor();
      view.focus();
    }

    return handled;
  };

  const insertImageValue = (attrs: { src: string; alt?: string | null; title?: string | null }) => {
    const handled = insertImage(view, attrs);

    if (handled) {
      uiControllers.clearSelectionAnchor();
      view.focus();
    }

    return handled;
  };

  const editLinkValue = () => {
    if (!uiControllers.enabled) {
      return false;
    }

    const markInfo = getMarkInfo(view.state, "link");

    if (!markInfo || isEscapedOutsideBoundary(view.state, "link", markInfo)) {
      return false;
    }

    const currentHref = typeof markInfo.attrs?.href === "string" ? markInfo.attrs.href : "";
    const selectionAnchor = uiControllers.createSelectionAnchor(view);

    if (!selectionAnchor) {
      return false;
    }

    linkEditor.open(view, selectionAnchor, currentHref);
    return true;
  };

  const editImageValue = () => {
    if (!uiControllers.enabled) {
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
        return toggleMarkCommands[mark](view.state);
      },
      setLink() {
        return canSetLink(view.state);
      },
      insertImage() {
        return canInsertImage(view.state);
      },
      undo() {
        return commands.undo(view.state);
      },
      redo() {
        return commands.redo(view.state);
      },
    },
    isActive: {
      mark(mark) {
        return isMarkActive(mark);
      },
      node(node) {
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
      return removeActiveLink(view);
    },
    insertImage: insertImageValue,
    removeImage() {
      return removeActiveImage(view);
    },
    undo() {
      return runCommand(commands.undo);
    },
    redo() {
      return runCommand(commands.redo);
    },
  };

  const getToolbarState = (): ToolbarState => ({
    bold: getToolbarMarkState(view.state, "strong", schema.marks.strong, commands.toggleBold, isEscapedOutsideBoundary),
    italic: getToolbarMarkState(view.state, "em", schema.marks.em, commands.toggleItalic, isEscapedOutsideBoundary),
    code: getToolbarMarkState(view.state, "code", schema.marks.code, commands.toggleCode, isEscapedOutsideBoundary),
    strike: getToolbarMarkState(view.state, "strike", schema.marks.strike, commands.toggleStrike, isEscapedOutsideBoundary),
    link: getLinkToolbarState({ state: view.state, canSetLink, isEscapedOutsideBoundary }),
    image: getImageToolbarState({ state: view.state, canInsertImage, getActiveImageInfo }),
    undo: { enabled: editorStateApi.can.undo() },
    redo: { enabled: editorStateApi.can.redo() },
  });

  const initialState = EditorState.create({
    doc,
    plugins,
  });

  view = new EditorView(element, {
    state: initialState,
    nodeViews: {
      code_block(node, view, getPos) {
        return new CodeBlockView(node, view, getPos as () => number);
      },
      image(node, editorView) {
        return new ImageView(node, editorView.dom.ownerDocument);
      },
    },
    dispatchTransaction(transaction) {
      const nextState = view.state.apply(transaction);
      view.updateState(nextState);
      onTransaction?.(transaction, view);

      if (transaction.docChanged) {
        changeEmitter.schedule(nextState.doc);
      }
    },
  });

  return {
    view,
    commands: editorCommandApi,
    state: editorStateApi,
    ui: uiControllers.enabled ? {
      editLink: editLinkValue,
      editImage: editImageValue,
    } : null,
    getMarkdown() {
      return changeEmitter.getMarkdown(view.state.doc);
    },
    flushChange() {
      changeEmitter.flush();
    },
    getToolbarState,
    destroy() {
      changeEmitter.flush();
      uiControllers.clearSelectionAnchor();
      linkEditor.destroy();
      imageEditor.destroy();
      view.destroy();
    },
  };
}
