import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { Selection, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor, type BoundarySide, type ManagedBlockBoundary } from "./managedBlockCursor";

export type ManagedBlockTableInfo = {
  table: ProseMirrorNode;
  tablePos: number;
};

export type CreateManagedBlockBoundaryHelpersOptions = {
  schema: Schema;
  isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode;
  findTextSelectionInsideNode: (
    doc: ProseMirrorNode,
    nodePos: number,
    node: ProseMirrorNode,
    direction: -1 | 1,
  ) => Selection | null;
  findTextSelectionInImmediatePreviousNode: (doc: ProseMirrorNode, boundaryPos: number) => Selection | null;
  getTableCellInfo: (state: EditorState) => ManagedBlockTableInfo | null;
};

export function createManagedBlockBoundaryHelpers(options: CreateManagedBlockBoundaryHelpersOptions) {
  const {
    schema,
    isManagedBlockNode,
    findTextSelectionInsideNode,
    findTextSelectionInImmediatePreviousNode,
    getTableCellInfo,
  } = options;

  function setManagedBlockBoundarySelection(view: EditorView, blockPos: number, side: BoundarySide) {
    const selection = ManagedBlockCursor.create(view.state.doc, blockPos, side, isManagedBlockNode);

    if (!selection) {
      return false;
    }

    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  }

  function moveBeforeManagedBlock(view: EditorView, blockPos: number) {
    const { doc } = view.state;
    const $boundary = doc.resolve(blockPos);
    const previousNode = $boundary.nodeBefore;

    if (!previousNode) {
      return setManagedBlockBoundarySelection(view, blockPos, "before");
    }

    if (isManagedBlockNode(previousNode)) {
      return setManagedBlockBoundarySelection(view, blockPos - previousNode.nodeSize, "after");
    }

    const previousSelection = findTextSelectionInImmediatePreviousNode(doc, blockPos);

    if (previousSelection) {
      view.dispatch(view.state.tr.setSelection(previousSelection).scrollIntoView());
      return true;
    }

    return setManagedBlockBoundarySelection(view, blockPos, "before");
  }

  function moveInsideManagedBlock(view: EditorView, boundary: ManagedBlockBoundary) {
    const selection = findTextSelectionInsideNode(
      view.state.doc,
      boundary.blockPos,
      boundary.node,
      boundary.side === "before" ? 1 : -1,
    );

    if (!selection) {
      return false;
    }

    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    return true;
  }

  function insertParagraphAtManagedBlockBoundary(view: EditorView, boundary: ManagedBlockBoundary, text = "") {
    const insertPos = boundary.side === "before" ? boundary.blockPos : boundary.blockPos + boundary.node.nodeSize;
    const paragraph = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const tr = view.state.tr.insert(insertPos, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1 + text.length));
    view.dispatch(tr.scrollIntoView());

    requestAnimationFrame(() => {
      view.focus();
    });

    return true;
  }

  function focusViewAfterManagedBlockMutation(view: EditorView) {
    requestAnimationFrame(() => {
      if (view.isDestroyed) {
        return;
      }

      if (view.state.selection instanceof ManagedBlockCursor) {
        view.dom.focus();
      } else {
        view.focus();
      }
    });
  }

  function removeManagedBlockAtBoundary(view: EditorView, boundary: ManagedBlockBoundary) {
    if (boundary.side !== "after") {
      return false;
    }

    const { state } = view;
    const $block = state.doc.resolve(boundary.blockPos);
    const blockIndex = $block.index();
    const parent = $block.parent;
    let tr = state.tr;

    if (parent.childCount === 1 && parent.canReplaceWith(blockIndex, blockIndex + 1, schema.nodes.paragraph)) {
      tr = tr.replaceWith(boundary.blockPos, boundary.blockPos + boundary.node.nodeSize, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, boundary.blockPos + 1));
      view.dispatch(tr.scrollIntoView());
      focusViewAfterManagedBlockMutation(view);
      return true;
    }

    tr = tr.delete(boundary.blockPos, boundary.blockPos + boundary.node.nodeSize);

    const nextPos = Math.min(boundary.blockPos, tr.doc.content.size);
    const $nextPos = tr.doc.resolve(nextPos);
    const nextNode = $nextPos.nodeAfter;
    const previousNode = $nextPos.nodeBefore;
    const previousSelection = findTextSelectionInImmediatePreviousNode(tr.doc, nextPos);

    if (previousSelection) {
      tr.setSelection(previousSelection);
    } else if (isManagedBlockNode(nextNode)) {
      tr.setSelection(ManagedBlockCursor.create(tr.doc, nextPos, "before", isManagedBlockNode)!);
    } else if (isManagedBlockNode(previousNode)) {
      tr.setSelection(ManagedBlockCursor.create(tr.doc, nextPos - previousNode.nodeSize, "after", isManagedBlockNode)!);
    } else {
      const nextSelection = Selection.findFrom($nextPos, 1, true);
      tr.setSelection(nextSelection ?? Selection.near($nextPos, -1));
    }

    view.dispatch(tr.scrollIntoView());
    focusViewAfterManagedBlockMutation(view);
    return true;
  }

  function getManagedBlockBoundary(state: EditorState): ManagedBlockBoundary | null {
    if (!(state.selection instanceof ManagedBlockCursor)) {
      return null;
    }

    const node = state.doc.nodeAt(state.selection.blockPos);

    if (!node || !isManagedBlockNode(node)) {
      return null;
    }

    return {
      blockPos: state.selection.blockPos,
      pos: state.selection.head,
      side: state.selection.side,
      node,
    };
  }

  function getTableBoundaryEscapeInfo(state: EditorState, side: BoundarySide) {
    const info = getTableCellInfo(state);

    if (!info) {
      return null;
    }

    const boundarySelection = findTextSelectionInsideNode(
      state.doc,
      info.tablePos,
      info.table,
      side === "before" ? 1 : -1,
    );

    if (!boundarySelection || boundarySelection.from !== state.selection.from) {
      return null;
    }

    return info;
  }

  return {
    setManagedBlockBoundarySelection,
    moveBeforeManagedBlock,
    moveInsideManagedBlock,
    insertParagraphAtManagedBlockBoundary,
    removeManagedBlockAtBoundary,
    getManagedBlockBoundary,
    getTableBoundaryEscapeInfo,
  };
}
