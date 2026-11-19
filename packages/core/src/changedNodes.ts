import type { Node as ProseMirrorNode } from "prosemirror-model";

/**
 * Walk every node in `newNode` whose subtree differs by identity from `oldNode`,
 * invoking `callback(node, pos)` with document-relative positions matching
 * `ProseMirrorNode.prototype.descendants`. Returning `false` skips descending
 * into that node's children.
 *
 * Unchanged subtrees are skipped in O(1) via persistent-tree reference equality,
 * turning O(N) per-transaction scans into O(depth + changed nodes).
 */
export function forEachChangedNode(
  oldNode: ProseMirrorNode,
  newNode: ProseMirrorNode,
  callback: (node: ProseMirrorNode, pos: number) => boolean | void,
  offset = 0,
): void {
  if (oldNode === newNode || newNode.isLeaf) {
    return;
  }

  const oldCount = oldNode.childCount;
  const newCount = newNode.childCount;
  let start = 0;
  let pos = offset;

  while (start < oldCount && start < newCount) {
    const oldChild = oldNode.child(start);
    const newChild = newNode.child(start);
    if (oldChild !== newChild) {
      break;
    }
    pos += newChild.nodeSize;
    start += 1;
  }

  let oldEnd = oldCount;
  let newEnd = newCount;

  while (oldEnd > start && newEnd > start) {
    if (oldNode.child(oldEnd - 1) !== newNode.child(newEnd - 1)) {
      break;
    }
    oldEnd -= 1;
    newEnd -= 1;
  }

  const sameChildCount = oldEnd - start === newEnd - start;

  for (let index = start; index < newEnd; index += 1) {
    const newChild = newNode.child(index);
    const oldChild = sameChildCount ? oldNode.child(index) : null;

    if (oldChild === newChild) {
      pos += newChild.nodeSize;
      continue;
    }

    if (callback(newChild, pos) !== false && !newChild.isLeaf) {
      if (oldChild && oldChild.type === newChild.type && !oldChild.isLeaf) {
        forEachChangedNode(oldChild, newChild, callback, pos + 1);
      } else {
        newChild.descendants((descendant, relPos) => callback(descendant, pos + 1 + relPos));
      }
    }

    pos += newChild.nodeSize;
  }
}
