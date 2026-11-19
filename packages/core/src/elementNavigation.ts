import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema, type BoundarySide } from "./managedBlockCursor";

export type ElementTarget = { node: ProseMirrorNode; pos: number };

/** Optional NodeSpec.elementNavigation contract for embedded text editors. */
export type ElementNavigationSpec = {
  /** Custom owners handle horizontal arrows within their text and use
   * moveToElementBoundary when exiting. Outer and vertical traversal stay in core. */
  textArrows?: "native" | "custom";
};

function isBlock(node: ProseMirrorNode | null | undefined, managedBlocks?: ReadonlySet<string>): boolean {
  return !!node && isManagedBlockNodeFromSchema(node.type.schema, node, managedBlocks);
}

function isElement(node: ProseMirrorNode | null | undefined, managedBlocks?: ReadonlySet<string>): boolean {
  return !!node && NodeSelection.isSelectable(node) && (isBlock(node, managedBlocks) || node.isInline && node.isAtom);
}

function isEditableBlock(node: ProseMirrorNode | null | undefined, managedBlocks?: ReadonlySet<string>): boolean {
  return isBlock(node, managedBlocks) && !node!.isAtom;
}

function textEdge(node: ProseMirrorNode | null, pos: number, direction: -1 | 1, managedBlocks?: ReadonlySet<string>): number | null {
  if (!node || isBlock(node, managedBlocks)) return null;
  if (node.isTextblock) return pos + 1 + (direction < 0 ? node.content.size : 0);
  const child = direction < 0 ? node.lastChild : node.firstChild;
  return child ? textEdge(child, direction < 0 ? pos + node.nodeSize - 1 - child.nodeSize : pos + 1, direction, managedBlocks) : null;
}

function resolveElementBoundary(doc: ProseMirrorNode, pos: number, managedBlocks?: ReadonlySet<string>): Selection {
  const $pos = doc.resolve(pos);
  if ($pos.parent.inlineContent) return TextSelection.create(doc, pos);
  // A neighboring text caret is already this boundary. Avoid adding an
  // invisible extra stop between a paragraph/image and a structured block.
  const before = $pos.nodeBefore;
  const previous = textEdge(before, pos - (before?.nodeSize ?? 0), -1, managedBlocks);
  const next = textEdge($pos.nodeAfter, pos, 1, managedBlocks);
  if (previous !== null || next !== null) return TextSelection.create(doc, previous ?? next!);
  return ManagedBlockCursor.at(doc, pos, (node): node is ProseMirrorNode => isBlock(node, managedBlocks)) ?? Selection.near($pos);
}

/** Enter a node from the given direction: atoms select as whole elements;
 * editable blocks and prose containers enter their nearest editable edge. */
function enterNode(
  doc: ProseMirrorNode,
  pos: number,
  node: ProseMirrorNode,
  direction: -1 | 1,
  managedBlocks?: ReadonlySet<string>,
): Selection | null {
  if (node.isAtom) {
    return NodeSelection.isSelectable(node) ? NodeSelection.create(doc, pos) : null;
  }
  if (node.isTextblock) {
    return TextSelection.create(doc, direction > 0 ? pos + 1 : pos + node.nodeSize - 1);
  }
  const child = direction > 0 ? node.firstChild : node.lastChild;
  if (!child) {
    return NodeSelection.isSelectable(node) ? NodeSelection.create(doc, pos) : null;
  }
  if (isBlock(node, managedBlocks) && isBlock(child, managedBlocks)) {
    const innerEdge = direction > 0 ? pos + 1 : pos + node.nodeSize - 1;
    const cursor = ManagedBlockCursor.at(doc, innerEdge, (candidate): candidate is ProseMirrorNode => isBlock(candidate, managedBlocks));
    if (cursor) return cursor;
  }
  const childPos = direction > 0 ? pos + 1 : pos + node.nodeSize - 1 - child.nodeSize;
  return enterNode(doc, childPos, child, direction, managedBlocks);
}

/** One document-order model for inline objects and structured blocks across
 * both horizontal and vertical arrow traversal. Adjacent components always
 * share a single boundary stop (Component A ↔ Gap Space ↔ Component B);
 * editable blocks are entered directly while atoms select as whole elements. */
export function createElementNavigation(managedBlocks?: ReadonlySet<string>) {
  const boundary = (doc: ProseMirrorNode, pos: number) => resolveElementBoundary(doc, pos, managedBlocks);
  const enter = (doc: ProseMirrorNode, pos: number, node: ProseMirrorNode, direction: -1 | 1) => (
    enterNode(doc, pos, node, direction, managedBlocks)
  );

  function containing($pos: ResolvedPos): ElementTarget | null {
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (isElement(node, managedBlocks)) return { node, pos: $pos.before(depth) };
    }
    return null;
  }

  function stepFromManagedCursor(selection: ManagedBlockCursor, direction: -1 | 1): Selection {
    const doc = selection.$from.doc;
    const $head = selection.$head;
    const immediate = direction < 0 ? $head.nodeBefore : $head.nodeAfter;
    if (immediate) {
      const targetPos = direction < 0 ? $head.pos - immediate.nodeSize : $head.pos;
      return enter(doc, targetPos, immediate, direction) ?? selection;
    }
    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      const pos = direction < 0 ? $head.before(depth) : $head.after(depth);
      if (isElement(node, managedBlocks)) return boundary(doc, pos);
      const $edge = doc.resolve(pos);
      const sibling = direction < 0 ? $edge.nodeBefore : $edge.nodeAfter;
      if (sibling) {
        const siblingPos = direction < 0 ? pos - sibling.nodeSize : pos;
        return enter(doc, siblingPos, sibling, direction) ?? selection;
      }
      if (depth > 1 && (direction < 0 ? $head.index(depth - 1) !== 0 : $head.indexAfter(depth - 1) !== $head.node(depth - 1).childCount)) {
        return selection;
      }
    }
    return selection;
  }

  function step(selection: Selection, direction: -1 | 1): Selection | null {
    const doc = selection.$from.doc;
    if (selection instanceof NodeSelection && isElement(selection.node, managedBlocks)) {
      return boundary(doc, direction < 0 ? selection.from : selection.to);
    }
    if (!selection.empty) return null;
    if (selection instanceof ManagedBlockCursor) {
      return stepFromManagedCursor(selection, direction);
    }
    const $head = selection.$head;
    const immediate = direction < 0 ? $head.nodeBefore : $head.nodeAfter;
    if (immediate && isElement(immediate, managedBlocks)) {
      const targetPos = direction < 0 ? $head.pos - immediate.nodeSize : $head.pos;
      return enter(doc, targetPos, immediate, direction);
    }
    if (direction < 0 ? $head.parentOffset !== 0 : $head.parentOffset !== $head.parent.content.size) return null;

    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      const pos = direction < 0 ? $head.before(depth) : $head.after(depth);
      // Leaving an editing surface stops at the shared boundary (prose edge or gap cursor).
      if (isElement(node, managedBlocks)) return boundary(doc, pos);
      const $edge = doc.resolve(pos);
      const sibling = direction < 0 ? $edge.nodeBefore : $edge.nodeAfter;
      if (sibling && isElement(sibling, managedBlocks)) {
        const siblingPos = direction < 0 ? pos - sibling.nodeSize : pos;
        return enter(doc, siblingPos, sibling, direction);
      }
      if (sibling) return null;
      if (depth > 1 && (direction < 0 ? $head.index(depth - 1) !== 0 : $head.indexAfter(depth - 1) !== $head.node(depth - 1).childCount)) return null;
    }
    return null;
  }

  function stepVertical(
    selection: Selection,
    direction: -1 | 1,
    atVerticalEdge: () => boolean,
  ): Selection | null {
    const doc = selection.$from.doc;
    if (selection instanceof NodeSelection && isBlock(selection.node, managedBlocks)) {
      return boundary(doc, direction < 0 ? selection.from : selection.to);
    }
    if (!selection.empty) return null;
    if (selection instanceof ManagedBlockCursor) {
      return stepFromManagedCursor(selection, direction);
    }
    if (!(selection instanceof TextSelection)) return null;
    const $head = selection.$head;
    // Tables own 2D column-preserving vertical motion between rows and exit
    // through moveToElementBoundary at their top and bottom edges.
    if (containing($head)?.node.type.spec.tableRole === "table") return null;

    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      const pos = direction < 0 ? $head.before(depth) : $head.after(depth);
      if (isBlock(node, managedBlocks)) {
        return atVerticalEdge() ? boundary(doc, pos) : null;
      }
      const $edge = doc.resolve(pos);
      const sibling = direction < 0 ? $edge.nodeBefore : $edge.nodeAfter;
      if (sibling && isBlock(sibling, managedBlocks)) {
        if (!atVerticalEdge()) return null;
        const siblingPos = direction < 0 ? pos - sibling.nodeSize : pos;
        return enter(doc, siblingPos, sibling, direction);
      }
      if (sibling) return null;
      if (depth > 1 && (direction < 0 ? $head.index(depth - 1) !== 0 : $head.indexAfter(depth - 1) !== $head.node(depth - 1).childCount)) return null;
    }
    return null;
  }

  return {
    isBlock: (node: ProseMirrorNode | null | undefined) => isBlock(node, managedBlocks),
    isElement: (node: ProseMirrorNode | null | undefined) => isElement(node, managedBlocks),
    isEditableBlock: (node: ProseMirrorNode | null | undefined) => isEditableBlock(node, managedBlocks),
    boundary, enter, containing, step, stepVertical,
  };
}

export type ElementNavigation = ReturnType<typeof createElementNavigation>;

/** An embedded editor supplies its visual exit side, then shares the outer
 * boundary resolver with every other editing surface. */
export function moveToElementBoundary(view: EditorView, pos: number, side: BoundarySide, managedBlocks?: ReadonlySet<string>) {
  const { doc } = view.state;
  if (view.composing || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return false;
  const node = doc.nodeAt(pos);
  if (!node || !isElement(node, managedBlocks)) return false;
  const selection = resolveElementBoundary(doc, side === "before" ? pos : pos + node.nodeSize, managedBlocks);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  return true;
}
