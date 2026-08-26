import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
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

  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          return handleNativeHorizontalNavigation(
            view,
            event as KeyboardEvent,
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
    view() {
      return {
        destroy() {
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
