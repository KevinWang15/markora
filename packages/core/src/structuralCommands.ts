import { lift, setBlockType, wrapIn } from "prosemirror-commands";
import {
  liftListItem as createLiftListItemCommand,
  sinkListItem as createSinkListItemCommand,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import type {
  Node as ProseMirrorNode,
  NodeType,
  ResolvedPos,
  Schema,
} from "prosemirror-model";
import {
  NodeSelection,
  Selection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { normalizeCodeBlockInfo } from "./codeBlockMarkdown";
import type {
  MarkdownEditorCodeBlockOptions,
  MarkdownEditorHeadingLevel,
  MarkdownEditorTableAlignment,
  MarkdownEditorTableColumnMoveDirection,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorTableInsertSide,
  MarkdownEditorTableResizeOptions,
  MarkdownEditorTableRowMoveDirection,
} from "./editorApi";
import {
  createTableCommandSet,
  normalizeTableAlignment,
  tableCellSelectionIsActive,
  tableColumnAlignmentIsActive,
  tableIsActive,
} from "./tableCommands";

type AncestorInfo = Readonly<{
  depth: number;
  node: ProseMirrorNode;
  pos: number;
}>;

type ListItemInfo = Readonly<{
  node: ProseMirrorNode;
  pos: number;
}>;

type NormalizedCodeBlockOptions = Readonly<{
  language: string;
}>;

export function createListItemSplitCommand(itemType: NodeType): Command {
  const splitOrdinaryItem = splitListItem(itemType);

  return (state, dispatch, view) => {
    const { $from } = state.selection;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const item = $from.node(depth);

      if (item.type !== itemType) {
        continue;
      }

      if (typeof item.attrs.checked !== "boolean") {
        return splitOrdinaryItem(state, dispatch, view);
      }

      const uncheckedAttrs = {
        ...item.attrs,
        checked: false,
      };
      const isAtItemStart = $from.index(depth) === 0 && $from.parentOffset === 0;

      if (!isAtItemStart || !dispatch) {
        return splitListItem(itemType, isAtItemStart ? item.attrs : uncheckedAttrs)(
          state,
          dispatch,
          view,
        );
      }

      const itemPos = $from.before(depth);
      return splitListItem(itemType, item.attrs)(state, (transaction) => {
        const leadingItem = transaction.doc.nodeAt(itemPos);

        if (leadingItem?.type === itemType) {
          transaction.setNodeMarkup(itemPos, itemType, {
            ...leadingItem.attrs,
            checked: false,
          });
        }

        dispatch(transaction);
      }, view);
    }

    return splitOrdinaryItem(state, dispatch, view);
  };
}

function normalizeHeadingLevel(level: MarkdownEditorHeadingLevel) {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new RangeError("Heading level must be an integer between 1 and 6.");
  }

  return level;
}

function normalizeCodeBlockOptions(
  options: MarkdownEditorCodeBlockOptions | undefined,
): NormalizedCodeBlockOptions {
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    throw new TypeError("Code block options must be an object.");
  }

  const language = options?.language ?? "";

  if (typeof language !== "string") {
    throw new TypeError("Code block language must be a string or null.");
  }

  return Object.freeze({ language: normalizeCodeBlockInfo(language) });
}

function findAncestor($pos: ResolvedPos, nodeType: NodeType | undefined): AncestorInfo | null {
  if (!nodeType) {
    return null;
  }

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === nodeType) {
      return {
        depth,
        node: $pos.node(depth),
        pos: $pos.before(depth),
      };
    }
  }

  return null;
}

function commonAncestorOfType(state: EditorState, nodeType: NodeType | undefined) {
  const from = findAncestor(state.selection.$from, nodeType);
  const to = findAncestor(state.selection.$to, nodeType);

  return from && to && from.pos === to.pos ? from : null;
}

function findNearestListAncestor(
  $pos: ResolvedPos,
  bulletType: NodeType | undefined,
  orderedType: NodeType | undefined,
) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (node.type === bulletType || node.type === orderedType) {
      return {
        depth,
        node,
        pos: $pos.before(depth),
      };
    }
  }

  return null;
}

function getCommonListAncestor(state: EditorState, schema: Schema) {
  const from = findNearestListAncestor(
    state.selection.$from,
    schema.nodes.bullet_list,
    schema.nodes.ordered_list,
  );
  const to = findNearestListAncestor(
    state.selection.$to,
    schema.nodes.bullet_list,
    schema.nodes.ordered_list,
  );

  return from && to && from.pos === to.pos ? from : null;
}

function getSelectedListItems(
  state: Pick<EditorState, "doc" | "selection">,
  itemType: NodeType | undefined,
): ListItemInfo[] {
  if (!itemType) {
    return [];
  }

  if (state.selection.empty) {
    const item = findAncestor(state.selection.$from, itemType);
    return item ? [{ node: item.node, pos: item.pos }] : [];
  }

  const items: ListItemInfo[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type === itemType) {
      items.push({ node, pos });
    }
    return true;
  });

  if (items.length === 0) {
    const from = findAncestor(state.selection.$from, itemType);
    const to = findAncestor(state.selection.$to, itemType);

    if (from) {
      items.push({ node: from.node, pos: from.pos });
    }

    if (to && to.pos !== from?.pos) {
      items.push({ node: to.node, pos: to.pos });
    }
  }

  return items;
}

function selectedItemsHaveTaskState(items: readonly ListItemInfo[]) {
  return items.length > 0 && items.every(({ node }) => typeof node.attrs.checked === "boolean");
}

function listItemSupportsTasks(itemType: NodeType | undefined) {
  return Boolean(
    itemType?.spec.attrs
    && Object.prototype.hasOwnProperty.call(itemType.spec.attrs, "checked"),
  );
}

function setSelectedTaskState(
  transaction: Transaction,
  itemType: NodeType,
  checked: boolean | null,
) {
  const items = getSelectedListItems(transaction, itemType);

  for (const { node, pos } of items) {
    transaction.setNodeMarkup(pos, itemType, { ...node.attrs, checked }, node.marks);
  }

  return items.length > 0;
}

function clearTaskStateInList(
  transaction: Transaction,
  itemType: NodeType,
  listPos: number,
) {
  const list = transaction.doc.nodeAt(listPos);

  if (!list) {
    return false;
  }

  const items: ListItemInfo[] = [];
  transaction.doc.nodesBetween(
    listPos + 1,
    listPos + list.nodeSize - 1,
    (node, pos) => {
      if (node.type === itemType) {
        items.push({ node, pos });
      }
      return true;
    },
  );

  for (const { node, pos } of items) {
    transaction.setNodeMarkup(pos, itemType, { ...node.attrs, checked: null }, node.marks);
  }

  return items.length > 0;
}

function changeListType(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  list: AncestorInfo,
  targetType: NodeType,
  itemType: NodeType,
  checked: boolean | null,
) {
  const $list = state.doc.resolve(list.pos);
  const index = $list.index();

  if (!$list.parent.canReplaceWith(index, index + 1, targetType)) {
    return false;
  }

  if (dispatch) {
    const transaction = state.tr.setNodeMarkup(list.pos, targetType);
    if (checked === null) {
      clearTaskStateInList(transaction, itemType, list.pos);
    } else {
      setSelectedTaskState(transaction, itemType, checked);
    }
    dispatch(transaction.scrollIntoView());
  }

  return true;
}

function createToggleListCommand(
  schema: Schema,
  target: "bullet_list" | "ordered_list",
): Command {
  const targetType = schema.nodes[target];
  const itemType = schema.nodes.list_item;

  if (!targetType || !itemType) {
    return () => false;
  }

  return (state, dispatch, view) => {
    const list = getCommonListAncestor(state, schema);
    const selectedItems = getSelectedListItems(state, itemType);
    const hasTaskState = selectedItemsHaveTaskState(selectedItems);

    if (list?.node.type === targetType) {
      if (hasTaskState) {
        if (dispatch) {
          const transaction = state.tr;
          setSelectedTaskState(transaction, itemType, null);
          dispatch(transaction.scrollIntoView());
        }
        return true;
      }

      return createLiftListItemCommand(itemType)(state, dispatch, view);
    }

    if (list) {
      return changeListType(state, dispatch, list, targetType, itemType, null);
    }

    return wrapInList(targetType)(state, dispatch, view);
  };
}

function createToggleTaskListCommand(schema: Schema): Command {
  const bulletType = schema.nodes.bullet_list;
  const itemType = schema.nodes.list_item;

  if (!bulletType || !itemType || !listItemSupportsTasks(itemType)) {
    return () => false;
  }

  return (state, dispatch, view) => {
    const list = getCommonListAncestor(state, schema);
    const selectedItems = getSelectedListItems(state, itemType);

    if (list?.node.type === bulletType) {
      const nextChecked = selectedItemsHaveTaskState(selectedItems) ? null : false;

      if (selectedItems.length === 0) {
        return false;
      }

      if (dispatch) {
        const transaction = state.tr;
        setSelectedTaskState(transaction, itemType, nextChecked);
        dispatch(transaction.scrollIntoView());
      }
      return true;
    }

    if (list) {
      return changeListType(state, dispatch, list, bulletType, itemType, false);
    }

    const wrap = wrapInList(bulletType);
    return wrap(state, dispatch && ((transaction) => {
      if (!setSelectedTaskState(transaction, itemType, false)) {
        return;
      }
      dispatch(transaction);
    }), view);
  };
}

function createSetTaskCheckedCommand(schema: Schema, checked: boolean): Command {
  if (typeof checked !== "boolean") {
    throw new TypeError("Task checked state must be a boolean.");
  }

  const itemType = schema.nodes.list_item;

  if (!itemType || !listItemSupportsTasks(itemType)) {
    return () => false;
  }

  return (state, dispatch) => {
    const items = getSelectedListItems(state, itemType);

    if (
      !selectedItemsHaveTaskState(items)
      || items.every(({ node }) => node.attrs.checked === checked)
    ) {
      return false;
    }

    if (dispatch) {
      const transaction = state.tr;
      setSelectedTaskState(transaction, itemType, checked);
      dispatch(transaction.scrollIntoView());
    }
    return true;
  };
}

function getSelectedTextblocks(state: EditorState) {
  if (state.selection.empty) {
    return state.selection.$from.parent.isTextblock
      ? [state.selection.$from.parent]
      : [];
  }

  const blocks: ProseMirrorNode[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.isTextblock) {
      blocks.push(node);
      return false;
    }
    return true;
  });
  return blocks;
}

function textblocksHaveType(
  state: EditorState,
  nodeType: NodeType | undefined,
  attrs?: Readonly<Record<string, unknown>>,
) {
  if (!nodeType) {
    return false;
  }

  const blocks = getSelectedTextblocks(state);
  return blocks.length > 0 && blocks.every((node) => (
    node.type === nodeType
    && (!attrs || Object.entries(attrs).every(([name, value]) => node.attrs[name] === value))
  ));
}

function containerIsActive(state: EditorState, nodeType: NodeType | undefined) {
  if (!nodeType) {
    return false;
  }

  const blocks = getSelectedTextblocks(state);

  if (blocks.length === 0) {
    return false;
  }

  const from = findAncestor(state.selection.$from, nodeType);
  const to = findAncestor(state.selection.$to, nodeType);
  return Boolean(from && to);
}

function listIsActive(
  state: EditorState,
  schema: Schema,
  kind: "bullet" | "ordered" | "task",
) {
  const list = getCommonListAncestor(state, schema);
  const items = getSelectedListItems(state, schema.nodes.list_item);
  const task = selectedItemsHaveTaskState(items);

  switch (kind) {
    case "bullet":
      return list?.node.type === schema.nodes.bullet_list && !task;
    case "ordered":
      return list?.node.type === schema.nodes.ordered_list && !task;
    case "task":
      return list?.node.type === schema.nodes.bullet_list && task;
  }
}

function selectedTasksHaveCheckedState(
  state: EditorState,
  schema: Schema,
  checked: boolean,
) {
  const items = getSelectedListItems(state, schema.nodes.list_item);
  return selectedItemsHaveTaskState(items)
    && items.every(({ node }) => node.attrs.checked === checked);
}

function nodeIsActive(state: EditorState, nodeType: NodeType | undefined) {
  if (!nodeType) {
    return false;
  }

  if (state.selection instanceof NodeSelection && state.selection.node.type === nodeType) {
    return true;
  }

  if (nodeType.isInline && state.selection.empty) {
    return state.selection.$from.nodeBefore?.type === nodeType
      || state.selection.$from.nodeAfter?.type === nodeType;
  }

  if (state.selection.$from.parent.type === nodeType && state.selection.$to.parent.type === nodeType) {
    return true;
  }

  return Boolean(
    findAncestor(state.selection.$from, nodeType)
    && findAncestor(state.selection.$to, nodeType),
  );
}

function createInsertLeafCommand(schema: Schema, name: "hard_break" | "horizontal_rule"): Command {
  const nodeType = schema.nodes[name];

  if (!nodeType) {
    return () => false;
  }

  return (state, dispatch) => {
    if (name === "hard_break" && (
      !state.selection.$from.sameParent(state.selection.$to)
      || !state.selection.$from.parent.inlineContent
      || !state.selection.$from.parent.canReplaceWith(
        state.selection.$from.index(),
        state.selection.$to.indexAfter(),
        nodeType,
      )
    )) {
      return false;
    }

    let transaction: Transaction;

    try {
      transaction = state.tr.replaceSelectionWith(nodeType.create());
    } catch {
      return false;
    }

    if (!transaction.docChanged) {
      return false;
    }

    if (name === "horizontal_rule") {
      const rulePos = (() => {
        if (
          transaction.selection instanceof NodeSelection
          && transaction.selection.node.type === nodeType
        ) {
          return transaction.selection.from;
        }

        let nearest: { distance: number; pos: number } | null = null;
        transaction.doc.descendants((node, pos) => {
          if (node.type === nodeType) {
            const distance = Math.abs(pos - transaction.selection.from);
            if (!nearest || distance < nearest.distance) {
              nearest = { distance, pos };
            }
            return false;
          }
          return true;
        });
        return (nearest as { distance: number; pos: number } | null)?.pos ?? null;
      })();

      if (rulePos !== null) {
        const rule = transaction.doc.nodeAt(rulePos);
        const after = rule ? rulePos + rule.nodeSize : rulePos;
        const $after = transaction.doc.resolve(after);
        const paragraphType = schema.nodes.paragraph;

        if (!$after.nodeAfter && paragraphType) {
          const index = $after.index();
          if ($after.parent.canReplaceWith(index, index, paragraphType)) {
            transaction.insert(after, paragraphType.create());
          }
        }

        const selection = Selection.findFrom(transaction.doc.resolve(after), 1, true);
        if (selection) {
          transaction.setSelection(selection);
        }
      }
    }

    if (dispatch) {
      dispatch(transaction.scrollIntoView());
    }
    return true;
  };
}

export function createStructuralCommandSet(schema: Schema) {
  const paragraphType = schema.nodes.paragraph;
  const headingType = schema.nodes.heading;
  const blockquoteType = schema.nodes.blockquote;
  const codeBlockType = schema.nodes.code_block;
  const listItemType = schema.nodes.list_item;
  const tables = createTableCommandSet(schema);
  const setParagraph = paragraphType ? setBlockType(paragraphType) : (() => false);
  const toggleBlockquote: Command = blockquoteType
    ? (state, dispatch, view) => (
        containerIsActive(state, blockquoteType)
          ? lift(state, dispatch, view)
          : wrapIn(blockquoteType)(state, dispatch, view)
      )
    : () => false;
  const toggleBulletList = createToggleListCommand(schema, "bullet_list");
  const toggleOrderedList = createToggleListCommand(schema, "ordered_list");
  const toggleTaskList = createToggleTaskListCommand(schema);
  const sinkListItem = listItemType ? createSinkListItemCommand(listItemType) : (() => false);
  const liftListItem = listItemType ? createLiftListItemCommand(listItemType) : (() => false);
  const insertHardBreak = createInsertLeafCommand(schema, "hard_break");
  const insertHorizontalRule = createInsertLeafCommand(schema, "horizontal_rule");

  return Object.freeze({
    commands: Object.freeze({
      setParagraph,
      setHeading(level: MarkdownEditorHeadingLevel) {
        const normalized = normalizeHeadingLevel(level);
        return headingType ? setBlockType(headingType, { level: normalized }) : (() => false);
      },
      toggleBlockquote,
      toggleBulletList,
      toggleOrderedList,
      sinkListItem,
      liftListItem,
      toggleTaskList,
      setTaskChecked(checked: boolean) {
        return createSetTaskCheckedCommand(schema, checked);
      },
      insertHardBreak,
      insertHorizontalRule,
      setCodeBlock(options?: MarkdownEditorCodeBlockOptions) {
        const { language } = normalizeCodeBlockOptions(options);
        return codeBlockType
          ? setBlockType(codeBlockType, { params: language })
          : (() => false);
      },
      insertTable(options?: MarkdownEditorTableInsertOptions) {
        return tables.insertTable(options);
      },
      addTableRow(side?: MarkdownEditorTableInsertSide) {
        return tables.addTableRow(side);
      },
      addTableColumn(side?: MarkdownEditorTableInsertSide) {
        return tables.addTableColumn(side);
      },
      resizeTable(options: MarkdownEditorTableResizeOptions) {
        return tables.resizeTable(options);
      },
      moveTableRow(direction: MarkdownEditorTableRowMoveDirection) {
        return tables.moveTableRow(direction);
      },
      moveTableColumn(direction: MarkdownEditorTableColumnMoveDirection) {
        return tables.moveTableColumn(direction);
      },
      deleteTableRow: tables.deleteTableRow,
      deleteTableColumn: tables.deleteTableColumn,
      setTableColumnAlignment(alignment: MarkdownEditorTableAlignment) {
        return tables.setTableColumnAlignment(alignment);
      },
      deleteTable: tables.deleteTable,
    }),
    isActive: Object.freeze({
      node(state: EditorState, name: string) {
        return nodeIsActive(state, schema.nodes[name]);
      },
      paragraph(state: EditorState) {
        return textblocksHaveType(state, paragraphType);
      },
      heading(state: EditorState, level?: MarkdownEditorHeadingLevel) {
        return textblocksHaveType(
          state,
          headingType,
          level === undefined ? undefined : { level: normalizeHeadingLevel(level) },
        );
      },
      blockquote(state: EditorState) {
        return containerIsActive(state, blockquoteType);
      },
      bulletList(state: EditorState) {
        return listIsActive(state, schema, "bullet");
      },
      orderedList(state: EditorState) {
        return listIsActive(state, schema, "ordered");
      },
      taskList(state: EditorState) {
        return listIsActive(state, schema, "task");
      },
      taskChecked(state: EditorState, checked = true) {
        if (typeof checked !== "boolean") {
          throw new TypeError("Task checked state must be a boolean.");
        }
        return selectedTasksHaveCheckedState(state, schema, checked);
      },
      hardBreak(state: EditorState) {
        return nodeIsActive(state, schema.nodes.hard_break);
      },
      horizontalRule(state: EditorState) {
        return nodeIsActive(state, schema.nodes.horizontal_rule);
      },
      codeBlock(state: EditorState, options?: MarkdownEditorCodeBlockOptions) {
        const { language } = normalizeCodeBlockOptions(options);
        return options === undefined
          ? textblocksHaveType(state, codeBlockType)
          : textblocksHaveType(state, codeBlockType, { params: language });
      },
      table(state: EditorState) {
        return tableIsActive(state, schema);
      },
      tableCellSelection(state: EditorState) {
        return tableCellSelectionIsActive(state);
      },
      tableColumnAlignment(state: EditorState, alignment: MarkdownEditorTableAlignment) {
        return tableColumnAlignmentIsActive(
          state,
          schema,
          normalizeTableAlignment(alignment),
        );
      },
    }),
  });
}
