import type { EditorView } from "prosemirror-view";

export type PhysicalHorizontalDirection = "left" | "right";
export type LogicalHorizontalSide = "after" | "before";
export type VisualRangeMotion = LogicalHorizontalSide | "inside";

type DomSelectionRange = {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
};

type EditorViewWithDomSelection = EditorView & {
  domSelection(): Selection | null;
  domSelectionRange(): DomSelectionRange;
};

type SelectionWithVisualMotion = Selection & {
  caretBidiLevel?: number | null;
  modify?: (
    alter: "extend" | "move",
    direction: "backward" | "forward" | "left" | "right",
    granularity: "character" | "documentboundary" | "line" | "lineboundary" | "paragraph" | "paragraphboundary" | "sentence" | "sentenceboundary" | "word",
  ) => void;
};

function snapshotDomSelectionRange(range: DomSelectionRange): DomSelectionRange {
  return {
    anchorNode: range.anchorNode,
    anchorOffset: range.anchorOffset,
    focusNode: range.focusNode,
    focusOffset: range.focusOffset,
  };
}

function getDirectionElement(view: EditorView, target?: Node | null) {
  const ElementCtor = view.dom.ownerDocument.defaultView?.Element;

  if (!ElementCtor) {
    return view.dom;
  }

  let element = target?.nodeType === 1
    ? target as Element
    : target?.parentElement ?? null;

  if (!(element instanceof ElementCtor) || !view.dom.contains(element)) {
    const domAtSelection = view.domAtPos(view.state.selection.head, 0).node;
    element = domAtSelection.nodeType === 1
      ? domAtSelection as Element
      : domAtSelection.parentElement;
  }

  return element && element instanceof ElementCtor ? element : view.dom;
}

/**
 * Resolve a physical horizontal arrow to document order for environments that
 * cannot expose visual caret motion. Browser-backed bidi paths should prefer
 * `probeVisualRangeMotion` below.
 */
export function horizontalArrowLogicalSide(
  view: EditorView,
  direction: PhysicalHorizontalDirection,
  target?: Node | null,
): LogicalHorizontalSide {
  const win = view.dom.ownerDocument.defaultView;
  const element = getDirectionElement(view, target);
  const rtl = win?.getComputedStyle(element).direction === "rtl";
  return direction === (rtl ? "right" : "left") ? "before" : "after";
}

function restoreDomSelection(
  selection: SelectionWithVisualMotion,
  original: DomSelectionRange,
  bidiLevel: number | null | undefined,
) {
  if (!original.anchorNode || !original.focusNode) {
    return;
  }

  try {
    selection.collapse(original.anchorNode, original.anchorOffset);

    if (
      (original.focusNode !== original.anchorNode || original.focusOffset !== original.anchorOffset)
      && typeof selection.extend === "function"
    ) {
      selection.extend(original.focusNode, original.focusOffset);
    }

    if (bidiLevel !== undefined) {
      selection.caretBidiLevel = bidiLevel;
    }
  } catch {
    // A re-entrant host may have detached the original DOM while the key was
    // being inspected. The caller will fall back to computed direction.
  }
}

function comparePointToModelRange(
  view: EditorView,
  node: Node,
  offset: number,
  from: number,
  to: number,
): VisualRangeMotion | null {
  try {
    const start = view.domAtPos(from, 1);
    const end = view.domAtPos(to, -1);
    const range = view.dom.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    // `comparePoint` treats the range's boundary points as inside. For
    // block nodes, however, native caret motion lands exactly on the parent
    // DOM point before/after the node when it crosses the visual edge.
    if (node === range.startContainer && offset === range.startOffset) {
      range.detach?.();
      return "before";
    }

    if (node === range.endContainer && offset === range.endOffset) {
      range.detach?.();
      return "after";
    }

    const relation = range.comparePoint(node, offset);
    range.detach?.();

    if (relation < 0) return "before";
    if (relation > 0) return "after";
    return "inside";
  } catch {
    try {
      const beforeBias = view.posAtDOM(node, offset, -1);
      const afterBias = view.posAtDOM(node, offset, 1);

      if (beforeBias < from && afterBias <= from) return "before";
      if (beforeBias >= to && afterBias > to) return "after";
      return "inside";
    } catch {
      return null;
    }
  }
}

/**
 * Ask the browser where a physical arrow would move the current caret, then
 * restore the DOM selection before returning. This follows the browser's bidi
 * caret level and mixed-direction visual order instead of guessing from the
 * block's base direction. `null` means the platform cannot be probed safely.
 */
export function probeVisualRangeMotion(
  view: EditorView,
  direction: PhysicalHorizontalDirection,
  from: number,
  to: number,
): VisualRangeMotion | null {
  if (!view.state.selection.empty || from > to) {
    return null;
  }

  const internalView = view as EditorViewWithDomSelection;
  const selection = internalView.domSelection?.() as SelectionWithVisualMotion | null;

  if (!selection || typeof selection.modify !== "function") {
    return null;
  }

  const current = internalView.domSelectionRange?.();

  if (!current?.anchorNode || !current.focusNode) {
    return null;
  }

  // EditorView.domSelectionRange() generally returns the live DOM Selection.
  // Snapshot its points before probing because Selection.modify mutates that
  // object in place.
  const original = snapshotDomSelectionRange(current);

  const originalBidiLevel = selection.caretBidiLevel;
  let next: DomSelectionRange | null = null;
  let nextBidiLevel = originalBidiLevel;

  try {
    selection.modify("move", direction, "character");
    next = snapshotDomSelectionRange(internalView.domSelectionRange());
    nextBidiLevel = selection.caretBidiLevel;
  } catch {
    return null;
  } finally {
    restoreDomSelection(selection, original, originalBidiLevel);
  }

  if (!next?.focusNode) {
    return null;
  }

  const moved = (
    next.focusNode !== original.focusNode
    || next.focusOffset !== original.focusOffset
    || nextBidiLevel !== originalBidiLevel
  );

  if (!moved) {
    const position = view.state.selection.head;
    if (position <= from) return "before";
    if (position >= to) return "after";

    // Gecko reports a no-op rather than a DOM point outside some RTL
    // structures (notably a table reached from its first logical cell).
    // A no-op still means the caret is at a visual edge, so resolve that
    // edge through the containing block's computed base direction.
    return horizontalArrowLogicalSide(view, direction, original.focusNode);
  }

  const modelNodeDom = view.nodeDOM(from);
  const modelNode = view.state.doc.nodeAt(from);
  const contentDom = modelNode?.isBlock && !modelNode.isLeaf
    ? view.domAtPos(from + 1).node
    : null;

  if (
    modelNodeDom?.nodeType === 1
    && (next.focusNode === modelNodeDom
      || contentDom && next.focusNode !== contentDom
        && modelNodeDom.contains(next.focusNode) && next.focusNode.contains(contentDom))
  ) {
    // Firefox can represent motion beyond a table's trailing visual edge as
    // a caret on the table element itself instead of on its parent boundary.
    return horizontalArrowLogicalSide(view, direction, next.focusNode);
  }

  return comparePointToModelRange(view, next.focusNode, next.focusOffset, from, to);
}
