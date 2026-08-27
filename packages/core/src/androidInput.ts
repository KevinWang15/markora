import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  Plugin,
  Selection as ProseMirrorSelection,
  TextSelection,
  type EditorState,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type TextSegment = {
  index: number;
  isWordLike?: boolean;
  segment?: string;
};

type TextSegments = Iterable<TextSegment> & {
  containing?(codeUnitIndex: number): TextSegment | undefined;
};

type TextSegmenter = {
  segment(input: string): TextSegments;
};

type TextSegmenterConstructor = new (
  locales?: string | readonly string[],
  options?: { granularity: "grapheme" | "word" },
) => TextSegmenter;

type SegmentingIntl = typeof Intl & {
  Segmenter?: TextSegmenterConstructor;
};

type BrowserWindow = Window & typeof globalThis;

type FallbackState = Pick<EditorState, "doc" | "selection">;

type DeletionDirection = "backward" | "forward";

type DeletionRange = {
  from: number;
  to: number;
};

const consumeDeletion = Symbol("consume-deletion");
const consumePointerWordSelection = Symbol("consume-pointer-word-selection");
const nativeVisualNavigationKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
const visualMotionMarkerSelector = [
  ".mdw-marker-strong",
  ".mdw-marker-em",
  ".mdw-marker-code",
  ".mdw-marker-strike",
  ".mdw-marker-link",
].join(", ");

type InlineBoundaryDeletionContext = {
  immediateText: string;
  parent: ProseMirrorNode;
  parentOffset: number;
  selection: TextSelection;
};

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

type SelectionWithTextMotion = Selection & {
  modify?: (
    alter: "extend" | "move",
    direction: DeletionDirection | "left" | "right",
    granularity: "character" | "word",
  ) => void;
};

type NativeTextMotionProbe = {
  anchorOffset: number | null;
  focusHandedOff: boolean;
  focusOffset: number | null;
};

type NativeWordDeletionProbe = {
  deletionLength: number | null;
  focusHandedOff: boolean;
};

type NativeWordRangeProbe = {
  focusHandedOff: boolean;
  fromOffset: number | null;
  toOffset: number | null;
};

type PointerTextIntent = {
  doc: ProseMirrorNode;
  position: number;
  timeStamp: number;
  x: number;
  y: number;
};

type PointerCaretIntent = PointerTextIntent & {
  selection: ProseMirrorSelection;
};

type PointerCaretDrag = PointerTextIntent & {
  anchor: number;
  lastPosition: number | null;
  owned: boolean;
};

type ModelWordRange = {
  from: number;
  to: number;
};

type PointerWordDrag = ModelWordRange & {
  doc: ProseMirrorNode;
  lastPosition: number | null;
};

type PointerBlockDrag = ModelWordRange & {
  doc: ProseMirrorNode;
  lastPosition: number | null;
};

type OwnedPointerWordSelection = {
  anchor: number;
  doc: ProseMirrorNode;
  head: number;
};

function clampPointerCoordinate(value: number, start: number, end: number) {
  if (end <= start) {
    return start;
  }

  const inset = Math.min(1, (end - start) / 2);
  return Math.max(start + inset, Math.min(end - inset, value));
}

function resolveOwnedPointerDragPosition(
  view: EditorView,
  event: Pick<MouseEvent, "clientX" | "clientY">,
) {
  const bounds = view.dom.getBoundingClientRect();

  // Preventing the initiating double/triple click also prevents the browser
  // from extending the range after the pointer leaves this surface. Resolve
  // vertical exits to the document edge and keep horizontal exits on their
  // current row by probing just inside the editor instead.
  if (event.clientY < bounds.top) {
    return ProseMirrorSelection.atStart(view.state.doc).head;
  }

  if (event.clientY > bounds.bottom) {
    return ProseMirrorSelection.atEnd(view.state.doc).head;
  }

  return view.posAtCoords({
    left: clampPointerCoordinate(event.clientX, bounds.left, bounds.right),
    top: clampPointerCoordinate(event.clientY, bounds.top, bounds.bottom),
  })?.pos ?? null;
}

function readPointerEmptyTextBlockPosition(view: EditorView, event: MouseEvent) {
  let target = event.target as Node | null;

  while (target && target !== view.dom) {
    try {
      const position = view.posAtDOM(target, 0);
      const $position = view.state.doc.resolve(position);

      if ($position.parent.isTextblock && $position.parent.content.size === 0) {
        return position;
      }

      if ($position.nodeAfter?.isTextblock && $position.nodeAfter.content.size === 0) {
        const insidePosition = position + 1;

        if (isEmptyTextBlockPosition(view.state, insidePosition)) {
          return insidePosition;
        }
      }
    } catch {
      // Decorative DOM may not have a document position. Its parent still can.
    }

    target = target.parentNode;
  }

  return null;
}

function isEmptyTextBlockPosition(state: EditorState, position: number) {
  if (!Number.isInteger(position) || position < 0 || position > state.doc.content.size) {
    return false;
  }

  const parent = state.doc.resolve(position).parent;
  return parent.isTextblock && parent.content.size === 0;
}

function captureFallbackState(state: EditorState): FallbackState {
  return {
    doc: state.doc,
    selection: state.selection,
  };
}

function readContiguousTextBefore(parent: ProseMirrorNode, parentOffset: number) {
  const childBefore = parent.childBefore(parentOffset);
  const nodeBefore = childBefore.node;

  if (!nodeBefore?.isText || !nodeBefore.text) {
    return "";
  }

  const chunks = [nodeBefore.text.slice(0, parentOffset - childBefore.offset)];

  for (let index = childBefore.index - 1; index >= 0; index -= 1) {
    const child = parent.child(index);

    if (!child.isText || !child.text) {
      break;
    }

    chunks.push(child.text);
  }

  return chunks.reverse().join("");
}

function readContiguousTextAfter(parent: ProseMirrorNode, parentOffset: number) {
  const childAfter = parent.childAfter(parentOffset);
  const nodeAfter = childAfter.node;

  if (!nodeAfter?.isText || !nodeAfter.text) {
    return "";
  }

  const chunks = [nodeAfter.text.slice(parentOffset - childAfter.offset)];

  for (let index = childAfter.index + 1; index < parent.childCount; index += 1) {
    const child = parent.child(index);

    if (!child.isText || !child.text) {
      break;
    }

    chunks.push(child.text);
  }

  return chunks.join("");
}

function isAndroidChrome(ownerWindow: BrowserWindow) {
  const userAgent = ownerWindow.navigator.userAgent;
  return /\bAndroid\b/i.test(userAgent) && /\bChrome\//i.test(userAgent);
}

export function findPreviousGraphemeStart(
  text: string,
  intl: SegmentingIntl = Intl as SegmentingIntl,
) {
  if (!text) {
    return 0;
  }

  if (intl.Segmenter) {
    const segments = new intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    const containingSegment = segments.containing?.(text.length - 1);

    if (containingSegment) {
      return containingSegment.index;
    }

    let previousStart = 0;

    for (const segment of segments) {
      previousStart = segment.index;
    }

    return previousStart;
  }

  const lastCodeUnit = text.charCodeAt(text.length - 1);

  if (lastCodeUnit >= 0xdc00 && lastCodeUnit <= 0xdfff && text.length > 1) {
    const previousCodeUnit = text.charCodeAt(text.length - 2);

    if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) {
      return text.length - 2;
    }
  }

  return text.length - 1;
}

export function findNextGraphemeEnd(
  text: string,
  intl: SegmentingIntl = Intl as SegmentingIntl,
) {
  if (!text) {
    return 0;
  }

  if (intl.Segmenter) {
    for (const segment of new intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
      if (segment.index > 0) {
        return segment.index;
      }
    }

    return text.length;
  }

  const firstCodeUnit = text.charCodeAt(0);

  if (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff && text.length > 1) {
    const nextCodeUnit = text.charCodeAt(1);

    if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
      return 2;
    }
  }

  return 1;
}

export function findWordDeletionLength(
  text: string,
  direction: DeletionDirection,
  intl: SegmentingIntl = Intl as SegmentingIntl,
) {
  if (!text || !intl.Segmenter) {
    return 0;
  }

  const segments = new intl.Segmenter(undefined, { granularity: "word" }).segment(text);

  if (direction === "backward") {
    let word = segments.containing?.(text.length - 1);

    if (!word) {
      for (const segment of segments) {
        word = segment;
      }
    }

    return word?.isWordLike
      ? text.length - word.index
      : 0;
  }

  let word: TextSegment | undefined;

  for (const segment of segments) {
    word = segment;
    break;
  }

  if (!word?.isWordLike || typeof word.segment !== "string") {
    return 0;
  }

  return word.segment.length;
}

function findSegmentedWordRange(
  text: string,
  offset: number,
  intl: SegmentingIntl,
) {
  if (!text || !intl.Segmenter || offset < 0 || offset > text.length) {
    return null;
  }

  const segments = new intl.Segmenter(undefined, { granularity: "word" }).segment(text);
  const candidateOffsets = offset === text.length
    ? [Math.max(0, offset - 1)]
    : offset > 0
      ? [offset, offset - 1]
      : [offset];

  for (const candidateOffset of candidateOffsets) {
    let candidate = segments.containing?.(candidateOffset);

    if (!candidate) {
      for (const segment of segments) {
        if (
          typeof segment.segment === "string"
          && candidateOffset >= segment.index
          && candidateOffset < segment.index + segment.segment.length
        ) {
          candidate = segment;
          break;
        }
      }
    }

    if (candidate?.isWordLike && typeof candidate.segment === "string") {
      return {
        fromOffset: candidate.index,
        toOffset: candidate.index + candidate.segment.length,
      };
    }
  }

  return null;
}

function restoreDomSelection(
  selection: SelectionWithTextMotion,
  original: DomSelectionRange,
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
  } catch {
    // A synchronous host callback may have detached the original editor DOM.
  }
}

function getActiveElement(view: EditorView) {
  const root = view.root as Node & { activeElement?: Element | null };
  return root.activeElement ?? view.dom.ownerDocument.activeElement;
}

function focusElement(element: Element | null) {
  const focus = (element as (Element & { focus?: unknown }) | null)?.focus;

  if (typeof focus === "function") {
    focus.call(element, { preventScroll: true });
  }
}

function readProbeOffset(
  probe: HTMLElement,
  node: Node | null,
  offset: number,
) {
  if (!node || (node !== probe && !probe.contains(node))) {
    return null;
  }

  try {
    const range = probe.ownerDocument.createRange();
    range.setStart(probe, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function probeNativeTextMotion(
  view: EditorView,
  text: string,
  anchorOffset: number,
  focusOffset: number,
  alter: "extend" | "move",
  direction: DeletionDirection | "left" | "right",
  granularity: "character" | "word",
): NativeTextMotionProbe | null {
  // Mark elements split the editable DOM into text nodes, so native grapheme
  // and word motion can stop at a mark boundary. Measure the engine's own text
  // motion against equivalent unmarked text to preserve platform behavior.
  const internalView = view as EditorViewWithDomSelection;
  const selection = internalView.domSelection?.() as SelectionWithTextMotion | null;
  const original = internalView.domSelectionRange?.();
  const originalActiveElement = getActiveElement(view);
  const parent = view.dom.parentNode;

  if (
    !text
    || !selection
    || typeof selection.modify !== "function"
    || !original?.anchorNode
    || !original.focusNode
    || !parent
    || !Number.isInteger(anchorOffset)
    || !Number.isInteger(focusOffset)
    || anchorOffset < 0
    || anchorOffset > text.length
    || focusOffset < 0
    || focusOffset > text.length
    || (anchorOffset !== focusOffset && typeof selection.extend !== "function")
  ) {
    return null;
  }

  const probe = view.dom.ownerDocument.createElement("span");
  probe.contentEditable = "true";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;left:-10000px;white-space:pre;opacity:0;pointer-events:none";
  const language = view.dom.getAttribute("lang")
    ?? view.dom.closest<HTMLElement>("[lang]")?.getAttribute("lang");

  if (language) {
    probe.lang = language;
  }

  probe.dir = view.dom.ownerDocument.defaultView?.getComputedStyle(view.dom).direction === "rtl"
    ? "rtl"
    : "ltr";
  probe.textContent = text;
  parent.appendChild(probe);
  const textNode = probe.firstChild;

  if (!textNode) {
    probe.remove();
    return null;
  }

  let nextAnchorOffset: number | null = null;
  let nextFocusOffset: number | null = null;
  let focusHandedOff = false;

  try {
    selection.collapse(textNode, anchorOffset);

    if (focusOffset !== anchorOffset) {
      selection.extend(textNode, focusOffset);
    }

    selection.modify(alter, direction, granularity);
    nextAnchorOffset = readProbeOffset(probe, selection.anchorNode, selection.anchorOffset);
    nextFocusOffset = readProbeOffset(probe, selection.focusNode, selection.focusOffset);

    if (alter === "extend" && nextAnchorOffset !== anchorOffset) {
      // Chromium can wrap an outward extension at an isolated probe's edge to
      // its first character, changing both ends of the selection. Extension
      // must preserve its anchor; reject that synthetic-probe artifact so the
      // original event can operate on the editor's real multi-block DOM.
      nextAnchorOffset = null;
      nextFocusOffset = null;
    }
  } catch {
    nextAnchorOffset = null;
    nextFocusOffset = null;
  } finally {
    const activeAfterProbe = getActiveElement(view);
    probe.remove();

    if (activeAfterProbe === probe) {
      focusElement(originalActiveElement);
    } else if (activeAfterProbe !== originalActiveElement) {
      focusHandedOff = true;
    }

    if (!focusHandedOff) {
      restoreDomSelection(selection, original);
    }
  }

  return {
    anchorOffset: nextAnchorOffset,
    focusHandedOff,
    focusOffset: nextFocusOffset,
  };
}

function probeNativeWordDeletionLength(
  view: EditorView,
  text: string,
  direction: DeletionDirection,
): NativeWordDeletionProbe | null {
  const initialOffset = direction === "backward" ? text.length : 0;
  const motion = probeNativeTextMotion(
    view,
    text,
    initialOffset,
    initialOffset,
    "extend",
    direction,
    "word",
  );

  if (!motion) {
    return null;
  }

  const deletionLength = motion.anchorOffset !== null && motion.focusOffset !== null
    ? Math.abs(motion.anchorOffset - motion.focusOffset)
    : null;

  return {
    deletionLength,
    focusHandedOff: motion.focusHandedOff,
  };
}

function probeNativeWordRange(
  view: EditorView,
  text: string,
  offset: number,
): NativeWordRangeProbe | null {
  const backward = probeNativeTextMotion(
    view,
    text,
    offset,
    offset,
    "extend",
    "backward",
    "word",
  );

  if (!backward || backward.focusHandedOff) {
    return backward
      ? { focusHandedOff: true, fromOffset: null, toOffset: null }
      : null;
  }

  const forward = probeNativeTextMotion(
    view,
    text,
    offset,
    offset,
    "extend",
    "forward",
    "word",
  );

  if (!forward || forward.focusHandedOff) {
    return forward
      ? { focusHandedOff: true, fromOffset: null, toOffset: null }
      : null;
  }

  return {
    focusHandedOff: false,
    fromOffset: backward.focusOffset === null
      ? null
      : Math.min(offset, backward.focusOffset),
    toOffset: forward.focusOffset === null
      ? null
      : Math.max(offset, forward.focusOffset),
  };
}

function readInlineBoundaryDeletionContext(
  state: EditorState,
  direction: DeletionDirection,
): InlineBoundaryDeletionContext | null {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { parent, parentOffset } = selection.$from;
  const adjacentChild = direction === "backward"
    ? parent.childBefore(parentOffset)
    : parent.childAfter(parentOffset);
  const adjacentNode = adjacentChild.node;

  if (!adjacentNode?.isText || !adjacentNode.text) {
    return null;
  }

  const offsetInChild = parentOffset - adjacentChild.offset;
  const immediateText = direction === "backward"
    ? adjacentNode.text.slice(0, offsetInChild)
    : adjacentNode.text.slice(offsetInChild);
  const siblingIndex = direction === "backward"
    ? adjacentChild.index - 1
    : adjacentChild.index + 1;
  const sibling = siblingIndex >= 0 && siblingIndex < parent.childCount
    ? parent.child(siblingIndex)
    : null;

  if (!immediateText || !sibling?.isText) {
    return null;
  }

  return {
    immediateText,
    parent,
    parentOffset,
    selection,
  };
}

function createDeletionRange(
  state: EditorState,
  selection: TextSelection,
  direction: DeletionDirection,
  deletionLength: number,
): DeletionRange | null {
  const from = direction === "backward"
    ? selection.from - deletionLength
    : selection.from;
  const to = direction === "backward"
    ? selection.from
    : selection.from + deletionLength;

  return deletionLength > 0 && from >= 0 && to <= state.doc.content.size
    ? { from, to }
    : null;
}

function findCrossInlineBoundaryGraphemeDeletionRange(
  state: EditorState,
  direction: DeletionDirection,
): DeletionRange | null {
  const context = readInlineBoundaryDeletionContext(state, direction);

  if (!context) {
    return null;
  }

  const {
    immediateText,
    parent,
    parentOffset,
    selection,
  } = context;

  const clusterFitsImmediateText = direction === "backward"
    ? findPreviousGraphemeStart(immediateText) > 0
    : findNextGraphemeEnd(immediateText) < immediateText.length;

  if (clusterFitsImmediateText) {
    return null;
  }

  const adjacentText = direction === "backward"
    ? readContiguousTextBefore(parent, parentOffset)
    : readContiguousTextAfter(parent, parentOffset);
  const graphemeLength = direction === "backward"
    ? adjacentText.length - findPreviousGraphemeStart(adjacentText)
    : findNextGraphemeEnd(adjacentText);

  // Native engines already delete a complete grapheme within one DOM text
  // node. Intervene only when a mark boundary splits the cluster across
  // multiple model/DOM text nodes, where engines otherwise delete one piece.
  if (graphemeLength <= immediateText.length) {
    return null;
  }

  return createDeletionRange(state, selection, direction, graphemeLength);
}

function findCrossInlineBoundaryWordDeletionRange(
  view: EditorView,
  direction: DeletionDirection,
): DeletionRange | typeof consumeDeletion | null {
  const { state } = view;
  const context = readInlineBoundaryDeletionContext(state, direction);

  if (!context) {
    return null;
  }

  const {
    immediateText,
    parent,
    parentOffset,
    selection,
  } = context;
  const adjacentText = direction === "backward"
    ? readContiguousTextBefore(parent, parentOffset)
    : readContiguousTextAfter(parent, parentOffset);
  const segmentedWordLength = findWordDeletionLength(adjacentText, direction);

  if (segmentedWordLength <= immediateText.length) {
    return null;
  }

  const nativeProbe = probeNativeWordDeletionLength(view, adjacentText, direction);

  if (
    nativeProbe
    && (
      nativeProbe.focusHandedOff
      || view.isDestroyed
      || view.state !== state
    )
  ) {
    return consumeDeletion;
  }

  // Once the selection has moved through the probe, handle the deletion here;
  // delegating the event back to the browser can otherwise turn it into a no-op.
  const wordLength = nativeProbe?.deletionLength ?? segmentedWordLength;

  return createDeletionRange(state, selection, direction, wordLength);
}

function isMacPlatform(ownerWindow: BrowserWindow) {
  return /Mac|iP(?:hone|ad|od)/u.test(ownerWindow.navigator.platform);
}

function isTextOnlyInlineContent(parent: ProseMirrorNode) {
  if (!parent.inlineContent || parent.childCount === 0) {
    return false;
  }

  for (let index = 0; index < parent.childCount; index += 1) {
    if (!parent.child(index).isText) {
      return false;
    }
  }

  return true;
}

function isOwnedUnmodifiedPrimaryPointerEvent(
  view: EditorView,
  event: MouseEvent,
  allowMarkerTarget = false,
) {
  const ownerWindow = view.dom.ownerDocument.defaultView;
  const target = event.target;
  const targetElement = ownerWindow && target instanceof ownerWindow.Element
    ? target
    : ownerWindow && target instanceof ownerWindow.Node
      ? target.parentElement
      : null;
  const excludedTarget = targetElement?.closest(
    ".mdw-marker, .cm-editor, button, input, select, textarea, [contenteditable=false]",
  );

  return Boolean(
    ownerWindow
    && view.editable
    && !view.composing
    && !event.defaultPrevented
    && event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && target instanceof ownerWindow.Node
    && view.dom.contains(target)
    && (
      !excludedTarget
      || (allowMarkerTarget && excludedTarget.classList.contains("mdw-marker"))
    )
  );
}

function readTextBlockAtPosition(
  state: EditorState,
  position: number,
  requireSplit: boolean,
) {
  if (!Number.isInteger(position) || position < 0 || position > state.doc.content.size) {
    return null;
  }

  const $position = state.doc.resolve(position);
  const parent = $position.parent;
  const parentStart = $position.start();
  const offset = position - parentStart;

  return (
    parent.childCount >= (requireSplit ? 2 : 1)
    && isTextOnlyInlineContent(parent)
    && offset >= 0
    && offset <= parent.content.size
  )
    ? { offset, parent, parentStart }
    : null;
}

function isPointerGraphemeBoundary(
  text: string,
  offset: number,
  intl: SegmentingIntl,
) {
  if (offset <= 0 || offset >= text.length) {
    return true;
  }

  if (intl.Segmenter) {
    const segments = new intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    const containingSegment = segments.containing?.(offset);

    if (containingSegment) {
      return containingSegment.index === offset;
    }

    for (const segment of segments) {
      if (segment.index >= offset) {
        return segment.index === offset;
      }
    }

    return false;
  }

  const previousCodeUnit = text.charCodeAt(offset - 1);
  const nextCodeUnit = text.charCodeAt(offset);
  return !(
    previousCodeUnit >= 0xd800
    && previousCodeUnit <= 0xdbff
    && nextCodeUnit >= 0xdc00
    && nextCodeUnit <= 0xdfff
  );
}

function readAdjacentPointerGraphemeBoundaries(
  text: string,
  offset: number,
  intl: SegmentingIntl,
) {
  const boundaries = new Set<number>();
  const clampedOffset = Math.max(0, Math.min(text.length, offset));

  if (!intl.Segmenter || text.length === 0) {
    boundaries.add(findPreviousGraphemeStart(text.slice(0, clampedOffset), intl));
    boundaries.add(clampedOffset + findNextGraphemeEnd(text.slice(clampedOffset), intl));
    return boundaries;
  }

  const segments = new intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);

  if (segments.containing) {
    for (const probeOffset of new Set([
      Math.max(0, clampedOffset - 1),
      Math.min(text.length - 1, clampedOffset),
    ])) {
      const segment = segments.containing(probeOffset);

      if (!segment) {
        continue;
      }

      boundaries.add(segment.index);
      if (typeof segment.segment === "string") {
        boundaries.add(segment.index + segment.segment.length);
      }
    }

    return boundaries;
  }

  let previousStart = 0;

  for (const segment of segments) {
    if (segment.index > clampedOffset) {
      boundaries.add(previousStart);
      boundaries.add(segment.index);
      return boundaries;
    }

    previousStart = segment.index;
  }

  boundaries.add(previousStart);
  boundaries.add(text.length);
  return boundaries;
}

function pointerDistanceToRect(
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  x: number,
  y: number,
) {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  const horizontal = x < left ? left - x : x > right ? x - right : 0;
  const vertical = y < top ? top - y : y > bottom ? y - bottom : 0;
  return horizontal * horizontal + vertical * vertical;
}

function refinePointerCaretPosition(
  view: EditorView,
  position: number,
  x: number,
  y: number,
) {
  const block = readTextBlockAtPosition(view.state, position, false);

  if (!block) {
    return position;
  }

  const { parent, parentStart } = block;
  const intl = (view.dom.ownerDocument.defaultView?.Intl ?? Intl) as SegmentingIntl;
  const candidates = new Set([position]);

  for (let distance = 1; distance <= 2; distance += 1) {
    candidates.add(position - distance);
    candidates.add(position + distance);
  }

  for (const boundary of readAdjacentPointerGraphemeBoundaries(
    parent.textContent,
    position - parentStart,
    intl,
  )) {
    candidates.add(parentStart + boundary);
  }

  let bestPosition = position;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const offset = candidate - parentStart;

    if (
      offset < 0
      || offset > parent.content.size
      || !isPointerGraphemeBoundary(parent.textContent, offset, intl)
    ) {
      continue;
    }

    for (const side of [-1, 1]) {
      let rect: ReturnType<EditorView["coordsAtPos"]>;

      try {
        rect = view.coordsAtPos(candidate, side);
      } catch {
        continue;
      }

      const distance = pointerDistanceToRect(rect, x, y);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = candidate;
      }
    }
  }

  return bestPosition;
}

function measurePointerTextBlockRange(
  state: EditorState,
  position: number,
): ModelWordRange | null {
  if (!Number.isInteger(position) || position < 0 || position > state.doc.content.size) {
    return null;
  }

  const $position = state.doc.resolve(position);

  return $position.parent.inlineContent
    ? {
        from: $position.start(),
        to: $position.start() + $position.parent.content.size,
      }
    : null;
}

function measurePointerWordRange(
  view: EditorView,
  state: EditorState,
  position: number,
  requireSplit: boolean,
): ModelWordRange | typeof consumePointerWordSelection | null {
  const block = readTextBlockAtPosition(state, position, requireSplit);

  if (!block) {
    return null;
  }

  const { offset, parent, parentStart } = block;
  const parentText = parent.textContent;
  const nativeRange = probeNativeWordRange(view, parentText, offset);

  if (
    nativeRange?.focusHandedOff
    || view.isDestroyed
    || view.state !== state
  ) {
    return consumePointerWordSelection;
  }

  const range = nativeRange
    && nativeRange.fromOffset !== null
    && nativeRange.toOffset !== null
    && nativeRange.fromOffset !== nativeRange.toOffset
    ? nativeRange
    : findSegmentedWordRange(
      parentText,
      offset,
      (view.dom.ownerDocument.defaultView?.Intl ?? Intl) as SegmentingIntl,
    );

  if (
    !range
    || range.fromOffset === null
    || range.toOffset === null
    || range.fromOffset === range.toOffset
    || range.fromOffset < 0
    || range.toOffset > parentText.length
  ) {
    return null;
  }

  return {
    from: parentStart + range.fromOffset,
    to: parentStart + range.toOffset,
  };
}

function handleNativeDoubleClickWordSelection(
  view: EditorView,
  event: MouseEvent,
  pointerPosition: number | null,
  ownBeforeNativeSelection = false,
  onOwnedRange?: (range: ModelWordRange) => void,
  requireSplit = true,
) {
  if (!isOwnedUnmodifiedPrimaryPointerEvent(view, event, pointerPosition !== null)) {
    return false;
  }

  const state = view.state;
  const { selection } = state;
  const position = pointerPosition ?? (
    selection instanceof TextSelection && selection.empty
      ? selection.from
      : null
  );

  // Native engines normally select the whole visible word. WebKit can leave
  // a collapsed caret when the first click reveals Markdown marker widgets
  // and moves the marked DOM before the second click lands. Inline elements
  // can also change punctuation-sensitive word expansion in other engines.
  // Re-run the engine's word motion against equivalent unmarked text, using
  // the first click's pre-reveal model position when it is available.
  if (position === null || (!(selection instanceof TextSelection) && pointerPosition === null)) {
    return false;
  }

  const range = measurePointerWordRange(view, state, position, requireSplit);

  if (range === consumePointerWordSelection) {
    event.preventDefault();
    return true;
  }

  if (!range) {
    return false;
  }

  const { from, to } = range;

  if (selection.from === from && selection.to === to) {
    if (!ownBeforeNativeSelection) {
      return false;
    }

    event.preventDefault();
    onOwnedRange?.(range);
    return true;
  }

  event.preventDefault();
  view.dispatch(
    state.tr
      .setSelection(TextSelection.create(
        state.doc,
        from,
        to,
      ))
      .scrollIntoView(),
  );
  onOwnedRange?.(range);
  return true;
}

export function isWordNavigationShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
  macPlatform: boolean,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return false;
  }

  return macPlatform
    ? event.altKey && !event.ctrlKey && !event.metaKey
    : event.ctrlKey && !event.altKey && !event.metaKey;
}

function prepareNativeVisualNavigation(
  view: EditorView,
  event: KeyboardEvent,
  ownerWindow: BrowserWindow,
) {
  if (
    !nativeVisualNavigationKeys.has(event.key)
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || !view.editable
    || view.composing
    || event.defaultPrevented
    || event.isComposing
    || event.keyCode === 229
    || event.target !== view.dom
    || !(view.state.selection instanceof TextSelection)
    || !view.dom.querySelector(visualMotionMarkerSelector)
  ) {
    return;
  }

  // Revealed Markdown delimiters participate in inline layout even though
  // they are not document content. Let the browser preserve its native
  // visual motion against the rendered text, then restore the source
  // affordance after the default action has resolved the new DOM selection.
  view.dom.classList.add("mdw-native-visual-motion");
  ownerWindow.requestAnimationFrame(() => {
    view.dom.classList.remove("mdw-native-visual-motion");
  });
}

function isSingleVisualTextLine(
  view: EditorView,
  selection: TextSelection,
): boolean {
  const ownerDocument = view.dom.ownerDocument;
  const parentPos = selection.$head.before();
  const parentDOM = view.nodeDOM(parentPos);

  if (!parentDOM) {
    return false;
  }

  const contentRange = ownerDocument.createRange();

  try {
    contentRange.selectNodeContents(parentDOM);
  } catch {
    return false;
  }

  const contentRects = Array.from(contentRange.getClientRects()).filter((rect) => (
    rect.bottom > rect.top
  ));

  if (!contentRects.length) {
    return false;
  }

  const top = Math.min(...contentRects.map((rect) => rect.top));
  const bottom = Math.max(...contentRects.map((rect) => rect.bottom));
  const maxHeight = Math.max(...contentRects.map((rect) => rect.height));

  // A wrapped boundary has caret affinity that TextSelection cannot encode:
  // one model position can mean either the previous line's end or the next
  // line's start. Keep those events native; own only the unambiguous case.
  return bottom - top <= maxHeight + 2;
}

function handleNativeLineEdgeNavigation(
  view: EditorView,
  event: KeyboardEvent,
) {
  const lineEdge = event.key === "Home" || event.key === "End";

  if (
    !lineEdge
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || !view.editable
    || view.composing
    || event.defaultPrevented
    || event.isComposing
    || event.keyCode === 229
    || event.target !== view.dom
  ) {
    return false;
  }

  const state = view.state;
  const { selection } = state;

  if (
    !(selection instanceof TextSelection)
    || selection.$anchor.parent !== selection.$head.parent
    || !isTextOnlyInlineContent(selection.$head.parent)
  ) {
    return false;
  }

  const parentStart = selection.$head.start();
  const parentEnd = parentStart + selection.$head.parent.content.size;
  if (!isSingleVisualTextLine(view, selection)) {
    return false;
  }

  const head = event.key === "Home" ? parentStart : parentEnd;
  const anchor = event.shiftKey ? selection.anchor : head;

  event.preventDefault();

  if (anchor !== selection.anchor || head !== selection.head) {
    view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, anchor, head))
        .scrollIntoView(),
    );
  }

  return true;
}

function handleNativeHorizontalNavigation(
  view: EditorView,
  event: KeyboardEvent,
  macPlatform: boolean,
) {
  const horizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const wordNavigation = isWordNavigationShortcut(event, macPlatform);
  const characterSelection = (
    horizontalArrow
    && event.shiftKey
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
  );

  if (
    !view.editable
    || view.composing
    || event.defaultPrevented
    || event.isComposing
    || event.keyCode === 229
    || event.target !== view.dom
    || (!wordNavigation && !characterSelection)
  ) {
    return false;
  }

  const state = view.state;
  const { selection } = state;

  if (
    !(selection instanceof TextSelection)
    || selection.$anchor.parent !== selection.$head.parent
    || !isTextOnlyInlineContent(selection.$head.parent)
  ) {
    return false;
  }

  const parentStart = selection.$head.start();
  const parentText = selection.$head.parent.textContent;
  const currentFocusOffset = selection.head - parentStart;
  const directionNode = view.domAtPos(selection.head, 0).node;
  const directionElement = directionNode.nodeType === 1
    ? directionNode as Element
    : directionNode.parentElement;
  const rtl = view.dom.ownerDocument.defaultView?.getComputedStyle(
    directionElement ?? view.dom,
  ).direction === "rtl";
  const outwardHorizontalNavigation = (characterSelection || wordNavigation) && (
    (currentFocusOffset === 0 && event.key === (rtl ? "ArrowRight" : "ArrowLeft"))
    || (
      currentFocusOffset === parentText.length
      && event.key === (rtl ? "ArrowLeft" : "ArrowRight")
    )
  );

  if (outwardHorizontalNavigation) {
    return false;
  }

  const motion = probeNativeTextMotion(
    view,
    parentText,
    selection.anchor - parentStart,
    selection.head - parentStart,
    wordNavigation && !event.shiftKey ? "move" : "extend",
    event.key === "ArrowLeft" ? "left" : "right",
    wordNavigation ? "word" : "character",
  );

  if (!motion) {
    return false;
  }

  // The key originated in this editor, but a focus callback triggered by the
  // probe owns any synchronous handoff or lifecycle/state change.
  if (
    motion.focusHandedOff
    || view.isDestroyed
    || view.state !== state
  ) {
    event.preventDefault();
    return true;
  }

  const { anchorOffset, focusOffset } = motion;

  if (
    anchorOffset === null
    || focusOffset === null
    || anchorOffset < 0
    || focusOffset < 0
    || anchorOffset > parentText.length
    || focusOffset > parentText.length
  ) {
    return false;
  }

  if (
    anchorOffset === selection.anchor - parentStart
    && focusOffset === selection.head - parentStart
    && (focusOffset === 0 || focusOffset === parentText.length)
  ) {
    // The flattened text has reached a real text-block edge. Leave the event
    // native so browser motion can continue into the neighboring block.
    return false;
  }

  event.preventDefault();
  const anchor = parentStart + anchorOffset;
  const head = parentStart + focusOffset;

  if (anchor !== selection.anchor || head !== selection.head) {
    view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, anchor, head))
        .scrollIntoView(),
    );
  }

  return true;
}

export function createInputRobustnessPlugin(ownerWindow: BrowserWindow) {
  const androidChrome = isAndroidChrome(ownerWindow);
  const macPlatform = isMacPlatform(ownerWindow);
  const pendingFallbacks = new Set<number>();
  let lastFallbackState: FallbackState | null = null;
  let ownedPointerWordSelection: OwnedPointerWordSelection | null = null;
  let pointerBlockIntent: PointerTextIntent | null = null;
  let pointerCaretIntent: PointerCaretIntent | null = null;
  let pointerWordIntent: PointerTextIntent | null = null;
  const matchesPointerIntent = (
    intent: PointerTextIntent | null,
    view: EditorView,
    mouseEvent: MouseEvent,
  ) => Boolean(
    intent
    && intent.doc === view.state.doc
    && mouseEvent.timeStamp - intent.timeStamp >= 0
    && mouseEvent.timeStamp - intent.timeStamp <= 1_000
    && Math.abs(mouseEvent.clientX - intent.x) <= 4
    && Math.abs(mouseEvent.clientY - intent.y) <= 4
  );
  const matchesPointerWordIntent = (view: EditorView, mouseEvent: MouseEvent) => (
    matchesPointerIntent(pointerWordIntent, view, mouseEvent)
  );
  const rememberPointerBlockIntent = (view: EditorView, mouseEvent: MouseEvent) => {
    if (mouseEvent.detail !== 1) {
      return;
    }

    pointerBlockIntent = null;

    if (!isOwnedUnmodifiedPrimaryPointerEvent(view, mouseEvent)) {
      return;
    }

    const emptyTextBlockPosition = readPointerEmptyTextBlockPosition(view, mouseEvent);

    if (emptyTextBlockPosition !== null) {
      // posAtCoords can snap an empty row to nearby text. The DOM target still
      // maps to the exact empty textblock, so retain that position for click.
      pointerBlockIntent = {
        doc: view.state.doc,
        position: emptyTextBlockPosition,
        timeStamp: mouseEvent.timeStamp,
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      };
      return;
    }

    const coordinates = view.posAtCoords({
      left: mouseEvent.clientX,
      top: mouseEvent.clientY,
    });

    if (
      !coordinates
      || !measurePointerTextBlockRange(view.state, coordinates.pos)
    ) {
      return;
    }

    pointerBlockIntent = {
      doc: view.state.doc,
      position: coordinates.pos,
      timeStamp: mouseEvent.timeStamp,
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    };
  };
  const rememberPointerWordIntent = (view: EditorView, mouseEvent: MouseEvent) => {
    if (mouseEvent.detail !== 1) {
      return;
    }

    pointerWordIntent = null;

    if (!isOwnedUnmodifiedPrimaryPointerEvent(view, mouseEvent)) {
      return;
    }

    const coordinates = view.posAtCoords({
      left: mouseEvent.clientX,
      top: mouseEvent.clientY,
    });

    if (
      !coordinates
      || !readTextBlockAtPosition(view.state, coordinates.pos, false)
    ) {
      pointerWordIntent = null;
      return;
    }

    pointerWordIntent = {
      doc: view.state.doc,
      position: coordinates.pos,
      timeStamp: mouseEvent.timeStamp,
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    };
  };
  const rememberPointerCaretIntent = (view: EditorView, mouseEvent: MouseEvent) => {
    pointerCaretIntent = null;
    const intent = pointerBlockIntent;

    if (
      mouseEvent.detail !== 1
      || !intent
      || !matchesPointerIntent(intent, view, mouseEvent)
      || (
        !readTextBlockAtPosition(
          view.state,
          intent.position,
          false,
        )
        && !isEmptyTextBlockPosition(view.state, intent.position)
      )
    ) {
      return;
    }

    pointerCaretIntent = {
      ...intent,
      position: refinePointerCaretPosition(
        view,
        intent.position,
        mouseEvent.clientX,
        mouseEvent.clientY,
      ),
      selection: view.state.selection,
    };
  };

  return new Plugin({
    props: {
      handleDOMEvents: {
        dblclick(view, event) {
          const mouseEvent = event as MouseEvent;

          if (
            ownedPointerWordSelection
            && isOwnedUnmodifiedPrimaryPointerEvent(view, mouseEvent, true)
          ) {
            const ownedSelection = ownedPointerWordSelection;
            ownedPointerWordSelection = null;
            mouseEvent.preventDefault();

            if (
              !view.isDestroyed
              && view.state.doc === ownedSelection.doc
              && (
                !(view.state.selection instanceof TextSelection)
                || view.state.selection.anchor !== ownedSelection.anchor
                || view.state.selection.head !== ownedSelection.head
              )
            ) {
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(
                    view.state.doc,
                    ownedSelection.anchor,
                    ownedSelection.head,
                  ))
                  .scrollIntoView(),
              );
            }

            return true;
          }

          ownedPointerWordSelection = null;

          const matchesIntent = matchesPointerWordIntent(view, mouseEvent);
          const intent = pointerWordIntent;
          pointerWordIntent = null;
          return handleNativeDoubleClickWordSelection(
            view,
            mouseEvent,
            matchesIntent ? intent!.position : null,
          );
        },
        keydown(view, event) {
          const keyboardEvent = event as KeyboardEvent;
          prepareNativeVisualNavigation(view, keyboardEvent, ownerWindow);
          return handleNativeLineEdgeNavigation(view, keyboardEvent)
            || handleNativeHorizontalNavigation(
              view,
              keyboardEvent,
              macPlatform,
            );
        },
        beforeinput(view, event) {
          if (
            !view.editable
            || view.composing
            || !("inputType" in event)
          ) {
            return false;
          }

          const inputEvent = event as InputEvent;

          if (
            inputEvent.defaultPrevented
            || inputEvent.isComposing
          ) {
            return false;
          }

          const deletion = inputEvent.inputType === "deleteContentBackward"
            ? { direction: "backward", unit: "content" } as const
            : inputEvent.inputType === "deleteContentForward"
              ? { direction: "forward", unit: "content" } as const
              : inputEvent.inputType === "deleteWordBackward"
                ? { direction: "backward", unit: "word" } as const
                : inputEvent.inputType === "deleteWordForward"
                  ? { direction: "forward", unit: "word" } as const
                  : null;

          if (!deletion) {
            return false;
          }

          const crossBoundaryRange = inputEvent.cancelable
            ? deletion.unit === "content"
              ? findCrossInlineBoundaryGraphemeDeletionRange(
                  view.state,
                  deletion.direction,
                )
              : findCrossInlineBoundaryWordDeletionRange(
                  view,
                  deletion.direction,
                )
            : null;

          if (crossBoundaryRange === consumeDeletion) {
            inputEvent.preventDefault();
            return true;
          }

          if (crossBoundaryRange) {
            inputEvent.preventDefault();
            view.dispatch(
              view.state.tr
                .delete(crossBoundaryRange.from, crossBoundaryRange.to)
                .scrollIntoView(),
            );
            return true;
          }

          if (!androidChrome || deletion.unit !== "content") {
            return false;
          }

          const { direction } = deletion;

          const initialState = captureFallbackState(view.state);
          const timeoutId = ownerWindow.setTimeout(() => {
            pendingFallbacks.delete(timeoutId);

            const { state } = view;
            const matchesInitialState = (
              state.doc === initialState.doc
              && state.selection.eq(initialState.selection)
            );
            const matchesFallbackState = Boolean(
              lastFallbackState
              && state.doc === lastFallbackState.doc
              && state.selection.eq(lastFallbackState.selection),
            );

            if (
              view.isDestroyed
              || !view.editable
              || view.composing
              || (!matchesInitialState && !matchesFallbackState)
            ) {
              return;
            }

            const ownerDocument = view.dom.ownerDocument;
            const activeElement = view.root.activeElement ?? ownerDocument.activeElement;

            if (
              activeElement
              && activeElement !== view.dom
              && activeElement !== ownerDocument.body
            ) {
              return;
            }

            view.dom.blur();
            view.focus();

            const deleteKey = direction === "backward"
              ? { code: "Backspace", key: "Backspace", keyCode: 8 }
              : { code: "Delete", key: "Delete", keyCode: 46 };
            const deleteEvent = ownerDocument.createEvent("Event") as KeyboardEvent;
            deleteEvent.initEvent("keydown", true, true);
            Object.assign(deleteEvent, {
              code: deleteKey.code,
              key: deleteKey.key,
              keyCode: deleteKey.keyCode,
            });
            const stateBeforeKeyDown = view.state;
            const handled = view.someProp("handleKeyDown", (handler) => (
              handler(view, deleteEvent) || undefined
            ));

            if (view.state !== stateBeforeKeyDown) {
              // A queued burst may share one initial snapshot. Record changes
              // made by an earlier fallback so each event still gets exactly
              // one recovery attempt without mistaking native input for ours.
              lastFallbackState = captureFallbackState(view.state);
              return;
            }

            if (handled) {
              return;
            }

            const { selection } = view.state;

            if (!(selection instanceof TextSelection) || !selection.empty) {
              return;
            }

            const adjacentNode = direction === "backward"
              ? selection.$from.nodeBefore
              : selection.$from.nodeAfter;

            if (
              adjacentNode
              && !adjacentNode.isText
              && adjacentNode.isInline
              && adjacentNode.isAtom
            ) {
              const from = direction === "backward"
                ? selection.from - adjacentNode.nodeSize
                : selection.from;
              const to = direction === "backward"
                ? selection.from
                : selection.from + adjacentNode.nodeSize;
              view.dispatch(
                view.state.tr
                  .delete(from, to)
                  .scrollIntoView(),
              );
              lastFallbackState = captureFallbackState(view.state);
              return;
            }

            const adjacentText = direction === "backward"
              ? readContiguousTextBefore(
                  selection.$from.parent,
                  selection.$from.parentOffset,
                )
              : readContiguousTextAfter(
                  selection.$from.parent,
                  selection.$from.parentOffset,
                );

            if (!adjacentText) {
              return;
            }

            const graphemeLength = direction === "backward"
              ? adjacentText.length - findPreviousGraphemeStart(adjacentText)
              : findNextGraphemeEnd(adjacentText);

            const from = direction === "backward"
              ? selection.from - graphemeLength
              : selection.from;
            const to = direction === "backward"
              ? selection.from
              : selection.from + graphemeLength;

            if (
              graphemeLength <= 0
              || from < 0
              || to > view.state.doc.content.size
            ) {
              return;
            }

            view.dispatch(
              view.state.tr
                .delete(from, to)
                .scrollIntoView(),
            );
            lastFallbackState = captureFallbackState(view.state);
          }, 60);

          pendingFallbacks.add(timeoutId);
          // Returning true suppresses ProseMirror's backward code-unit fallback. The
          // native beforeinput default remains allowed because it is not
          // prevented; the timeout runs only when no document change follows.
          return true;
        },
      },
    },
    view(view) {
      const pointerDocument = view.dom.ownerDocument;
      const pointerWindow = pointerDocument.defaultView;
      let pointerBlockDrag: PointerBlockDrag | null = null;
      let pointerCaretDrag: PointerCaretDrag | null = null;
      let pointerWordDrag: PointerWordDrag | null = null;

      function stopPointerCaretDrag() {
        pointerCaretDrag = null;
        pointerDocument.removeEventListener("mousemove", handlePointerCaretDrag, true);
        pointerDocument.removeEventListener("mouseup", finishPointerCaretDrag, true);
        pointerWindow?.removeEventListener("blur", stopPointerCaretDrag);
      }

      function finishPointerCaretDrag(event: MouseEvent) {
        if (pointerCaretDrag?.owned) {
          event.preventDefault();
        }

        stopPointerCaretDrag();
      }

      function handlePointerCaretDrag(event: MouseEvent) {
        const drag = pointerCaretDrag;

        if (!drag) {
          return;
        }

        if (
          view.isDestroyed
          || view.state.doc !== drag.doc
          || !view.editable
          || view.composing
          || (event.buttons & 1) === 0
        ) {
          stopPointerCaretDrag();
          return;
        }

        const horizontal = event.clientX - drag.x;
        const vertical = event.clientY - drag.y;

        // Leave sub-threshold motion as a click. Once a drag is real, the
        // captured model position is more stable than a DOM anchor whose text
        // node can be replaced when Markdown delimiters change visibility.
        if (horizontal * horizontal + vertical * vertical <= 16) {
          return;
        }

        const rawPosition = resolveOwnedPointerDragPosition(view, event);

        if (rawPosition === null) {
          return;
        }

        const head = refinePointerCaretPosition(
          view,
          rawPosition,
          event.clientX,
          event.clientY,
        );
        event.preventDefault();
        drag.owned = true;

        if (head === drag.lastPosition) {
          return;
        }

        drag.lastPosition = head;
        const state = view.state;
        const selection = TextSelection.between(
          state.doc.resolve(drag.anchor),
          state.doc.resolve(head),
        );

        if (!state.selection.eq(selection)) {
          view.dispatch(state.tr.setSelection(selection));
        }
      }

      function startPointerCaretDrag(event: MouseEvent) {
        stopPointerCaretDrag();
        const intent = pointerCaretIntent;

        if (
          !intent
          || !event.isTrusted
          || !readTextBlockAtPosition(view.state, intent.position, true)
          || (
            !intent.selection.empty
            && intent.position >= intent.selection.from
            && intent.position <= intent.selection.to
          )
        ) {
          return;
        }

        // Do not reveal delimiters on mousedown: that can move the exact text
        // node the browser bound as its native range anchor. The click handler
        // commits an ordinary caret; genuine movement switches to the model
        // drag above. Pressing inside an existing selection remains native so
        // selected-text drag-and-drop keeps its own transfer semantics.
        event.preventDefault();
        view.focus();
        pointerCaretDrag = {
          ...intent,
          anchor: intent.position,
          lastPosition: null,
          owned: false,
        };
        pointerDocument.addEventListener("mousemove", handlePointerCaretDrag, true);
        pointerDocument.addEventListener("mouseup", finishPointerCaretDrag, true);
        pointerWindow?.addEventListener("blur", stopPointerCaretDrag);
      }

      function stopPointerBlockDrag() {
        pointerBlockDrag = null;
        pointerDocument.removeEventListener("mousemove", handlePointerBlockDrag, true);
        pointerDocument.removeEventListener("mouseup", finishPointerBlockDrag, true);
        pointerWindow?.removeEventListener("blur", stopPointerBlockDrag);
      }

      function finishPointerBlockDrag(event: MouseEvent) {
        if (pointerBlockDrag) {
          // The triple-click selection is model-owned from its initiating
          // press. WebKit can otherwise replace it during mouseup defaulting.
          event.preventDefault();
        }

        stopPointerBlockDrag();
      }

      function handlePointerBlockDrag(event: MouseEvent) {
        const drag = pointerBlockDrag;

        if (!drag) {
          return;
        }

        if (
          view.isDestroyed
          || view.state.doc !== drag.doc
          || !view.editable
          || view.composing
          || (event.buttons & 1) === 0
        ) {
          stopPointerBlockDrag();
          return;
        }

        event.preventDefault();
        const position = resolveOwnedPointerDragPosition(view, event);

        if (position === null || position === drag.lastPosition) {
          return;
        }

        const state = view.state;
        const range = measurePointerTextBlockRange(state, position);

        if (!range) {
          return;
        }

        drag.lastPosition = position;
        const anchor = range.to <= drag.from ? drag.to : drag.from;
        const head = range.to <= drag.from
          ? range.from
          : range.from >= drag.to
            ? range.to
            : drag.to;
        const selection = state.selection;

        if (
          !(selection instanceof TextSelection)
          || selection.anchor !== anchor
          || selection.head !== head
        ) {
          view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, anchor, head)),
          );
        }
      }

      function startPointerBlockDrag(event: MouseEvent, position: number) {
        if (!isOwnedUnmodifiedPrimaryPointerEvent(view, event, true)) {
          return false;
        }

        const state = view.state;
        const range = measurePointerTextBlockRange(state, position);

        if (!range) {
          return false;
        }

        event.preventDefault();
        cancelPointerWordDrag();
        stopPointerBlockDrag();
        pointerBlockDrag = {
          ...range,
          doc: state.doc,
          lastPosition: null,
        };
        view.dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, range.from, range.to))
            .scrollIntoView(),
        );
        pointerDocument.addEventListener("mousemove", handlePointerBlockDrag, true);
        pointerDocument.addEventListener("mouseup", finishPointerBlockDrag, true);
        pointerWindow?.addEventListener("blur", stopPointerBlockDrag);
        return true;
      }

      function stopPointerWordDrag() {
        pointerWordDrag = null;
        pointerDocument.removeEventListener("mousemove", handlePointerWordDrag, true);
        pointerDocument.removeEventListener("mouseup", stopPointerWordDrag, true);
        pointerWindow?.removeEventListener("blur", cancelPointerWordDrag);
      }

      function cancelPointerWordDrag() {
        ownedPointerWordSelection = null;
        stopPointerWordDrag();
      }

      function handlePointerWordDrag(event: MouseEvent) {
        const drag = pointerWordDrag;

        if (!drag) {
          return;
        }

        if (
          view.isDestroyed
          || view.state.doc !== drag.doc
          || !view.editable
          || view.composing
          || (event.buttons & 1) === 0
        ) {
          cancelPointerWordDrag();
          return;
        }

        event.preventDefault();
        const position = resolveOwnedPointerDragPosition(view, event);

        if (position === null || position === drag.lastPosition) {
          return;
        }

        const state = view.state;
        const range = measurePointerWordRange(
          view,
          state,
          position,
          false,
        );

        if (range === consumePointerWordSelection) {
          cancelPointerWordDrag();
          return;
        }

        if (!range) {
          return;
        }

        drag.lastPosition = position;
        const anchor = range.to <= drag.from ? drag.to : drag.from;
        const head = range.to <= drag.from
          ? range.from
          : range.from >= drag.to
            ? range.to
            : drag.to;
        const selection = state.selection;
        ownedPointerWordSelection = {
          anchor,
          doc: state.doc,
          head,
        };

        if (
          !(selection instanceof TextSelection)
          || selection.anchor !== anchor
          || selection.head !== head
        ) {
          view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, anchor, head)),
          );
        }
      }

      function startPointerWordDrag(range: ModelWordRange) {
        stopPointerWordDrag();
        ownedPointerWordSelection = {
          anchor: range.from,
          doc: view.state.doc,
          head: range.to,
        };
        pointerWordDrag = {
          ...range,
          doc: view.state.doc,
          lastPosition: null,
        };
        pointerDocument.addEventListener("mousemove", handlePointerWordDrag, true);
        pointerDocument.addEventListener("mouseup", stopPointerWordDrag, true);
        pointerWindow?.addEventListener("blur", cancelPointerWordDrag);
      }

      const handlePointerCaretClick = (event: MouseEvent) => {
        const intent = pointerCaretIntent;
        pointerCaretIntent = null;

        if (
          !intent
          || !event.isTrusted
          || event.detail !== 1
          || !matchesPointerIntent(intent, view, event)
          || !isOwnedUnmodifiedPrimaryPointerEvent(view, event, true)
          || (
            !readTextBlockAtPosition(view.state, intent.position, false)
            && !isEmptyTextBlockPosition(view.state, intent.position)
          )
        ) {
          return;
        }

        const state = view.state;
        const { selection } = state;

        // A new non-empty selection means the pointer produced a real drag.
        // Preserve it. If the old selection survived unchanged, however, the
        // marker reveal swallowed the click and the pre-reveal position wins.
        if (!selection.empty && !selection.eq(intent.selection)) {
          return;
        }

        if (
          selection instanceof TextSelection
          && selection.empty
          && selection.from === intent.position
        ) {
          return;
        }

        view.dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, intent.position))
            .scrollIntoView(),
        );
      };

      const handleMouseDown = (event: MouseEvent) => {
        if (event.detail === 1) {
          ownedPointerWordSelection = null;
        }

        if (event.detail === 3) {
          const intent = pointerBlockIntent;
          const matchesIntent = matchesPointerIntent(intent, view, event);
          pointerBlockIntent = null;
          pointerWordIntent = null;

          if (matchesIntent && startPointerBlockDrag(event, intent!.position)) {
            return;
          }
        }

        if (event.detail === 2 && matchesPointerWordIntent(view, event)) {
          const intent = pointerWordIntent!;
          pointerWordIntent = null;
          handleNativeDoubleClickWordSelection(
            view,
            event,
            intent.position,
            true,
            startPointerWordDrag,
            false,
          );
          return;
        }

        stopPointerBlockDrag();
        stopPointerCaretDrag();
        stopPointerWordDrag();
        rememberPointerBlockIntent(view, event);
        rememberPointerCaretIntent(view, event);
        rememberPointerWordIntent(view, event);
        startPointerCaretDrag(event);
      };
      view.dom.addEventListener("mousedown", handleMouseDown, true);
      view.dom.addEventListener("click", handlePointerCaretClick, true);

      return {
        destroy() {
          ownedPointerWordSelection = null;
          pointerBlockIntent = null;
          pointerCaretIntent = null;
          pointerWordIntent = null;
          stopPointerBlockDrag();
          stopPointerCaretDrag();
          stopPointerWordDrag();
          view.dom.removeEventListener("mousedown", handleMouseDown, true);
          view.dom.removeEventListener("click", handlePointerCaretClick, true);
          for (const timeoutId of pendingFallbacks) {
            ownerWindow.clearTimeout(timeoutId);
          }

          pendingFallbacks.clear();
          lastFallbackState = null;
        },
      };
    },
  });
}
