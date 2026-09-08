import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema, type BoundarySide } from "./managedBlockCursor";

export type ElementTarget = { node: ProseMirrorNode; pos: number };

/** Optional NodeSpec.elementNavigation contract for embedded text editors. */
export type ElementNavigationSpec = {
  /** Custom owners handle arrows within their text and use
   * moveToElementBoundary when exiting. Outer traversal stays in core. */
  textArrows?: "native" | "custom";
};

function isBlock(node: ProseMirrorNode | null | undefined, managedBlocks?: ReadonlySet<string>): boolean {
  return !!node && isManagedBlockNodeFromSchema(node.type.schema, node, managedBlocks);
}

function isElement(node: ProseMirrorNode | null | undefined, managedBlocks?: ReadonlySet<string>): boolean {
  return !!node && NodeSelection.isSelectable(node) && (isBlock(node, managedBlocks) || node.isInline && node.isAtom);
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

/** One document-order model for both inline objects and structured blocks.
 * Text positions remain native; block gaps are canonical position selections.
 * Editable contents are entered explicitly, never as a side effect of traversal. */
export function createElementNavigation(managedBlocks?: ReadonlySet<string>) {
  const boundary = (doc: ProseMirrorNode, pos: number) => resolveElementBoundary(doc, pos, managedBlocks);

  function containing($pos: ResolvedPos): ElementTarget | null {
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (isElement(node, managedBlocks)) return { node, pos: $pos.before(depth) };
    }
    return null;
  }

  function step(selection: Selection, direction: -1 | 1): Selection | null {
    const doc = selection.$from.doc;
    if (selection instanceof NodeSelection && isElement(selection.node, managedBlocks)) {
      return boundary(doc, direction < 0 ? selection.from : selection.to);
    }
    if (!selection.empty) return null;
    const $head = selection.$head;
    const immediate = direction < 0 ? $head.nodeBefore : $head.nodeAfter;
    if (immediate && isElement(immediate, managedBlocks)) {
      return NodeSelection.create(doc, direction < 0 ? $head.pos - immediate.nodeSize : $head.pos);
    }
    if (selection instanceof ManagedBlockCursor && immediate) {
      const edge = textEdge(immediate, direction < 0 ? $head.pos - immediate.nodeSize : $head.pos, direction, managedBlocks);
      return edge === null ? null : TextSelection.create(doc, edge);
    }
    if (direction < 0 ? $head.parentOffset !== 0 : $head.parentOffset !== $head.parent.content.size) return null;

    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      const pos = direction < 0 ? $head.before(depth) : $head.after(depth);
      // Leaving an editing surface is an explicit boundary stop.
      if (isElement(node, managedBlocks)) return boundary(doc, pos);
      const $edge = doc.resolve(pos);
      const sibling = direction < 0 ? $edge.nodeBefore : $edge.nodeAfter;
      if (sibling && isElement(sibling, managedBlocks)) return NodeSelection.create(doc, direction < 0 ? pos - sibling.nodeSize : pos);
      if (sibling) return null;
      if (depth > 1 && (direction < 0 ? $head.index(depth - 1) !== 0 : $head.indexAfter(depth - 1) !== $head.node(depth - 1).childCount)) return null;
    }
    return selection instanceof ManagedBlockCursor ? selection : null;
  }

  return {
    isBlock: (node: ProseMirrorNode | null | undefined) => isBlock(node, managedBlocks),
    isElement: (node: ProseMirrorNode | null | undefined) => isElement(node, managedBlocks),
    boundary, containing, step,
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
