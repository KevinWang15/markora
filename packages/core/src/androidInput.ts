import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";

type GraphemeSegment = {
  index: number;
};

type GraphemeSegments = Iterable<GraphemeSegment> & {
  containing?(codeUnitIndex: number): GraphemeSegment | undefined;
};

type GraphemeSegmenter = {
  segment(input: string): GraphemeSegments;
};

type GraphemeSegmenterConstructor = new (
  locales?: string | readonly string[],
  options?: { granularity: "grapheme" },
) => GraphemeSegmenter;

type SegmentingIntl = typeof Intl & {
  Segmenter?: GraphemeSegmenterConstructor;
};

type BrowserWindow = Window & typeof globalThis;

type FallbackState = Pick<EditorState, "doc" | "selection">;

type DeletionDirection = "backward" | "forward";

type DeletionRange = {
  from: number;
  to: number;
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

function findCrossInlineBoundaryDeletionRange(
  state: EditorState,
  direction: DeletionDirection,
): DeletionRange | null {
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

  const from = direction === "backward"
    ? selection.from - graphemeLength
    : selection.from;
  const to = direction === "backward"
    ? selection.from
    : selection.from + graphemeLength;

  return from >= 0 && to <= state.doc.content.size
    ? { from, to }
    : null;
}

export function createInputRobustnessPlugin(ownerWindow: BrowserWindow) {
  const androidChrome = isAndroidChrome(ownerWindow);
  const pendingFallbacks = new Set<number>();
  let lastFallbackState: FallbackState | null = null;

  return new Plugin({
    props: {
      handleDOMEvents: {
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

          const direction = inputEvent.inputType === "deleteContentBackward"
            ? "backward"
            : inputEvent.inputType === "deleteContentForward"
              ? "forward"
              : null;

          if (!direction) {
            return false;
          }

          const crossBoundaryRange = inputEvent.cancelable
            ? findCrossInlineBoundaryDeletionRange(view.state, direction)
            : null;

          if (crossBoundaryRange) {
            inputEvent.preventDefault();
            view.dispatch(
              view.state.tr
                .delete(crossBoundaryRange.from, crossBoundaryRange.to)
                .scrollIntoView(),
            );
            return true;
          }

          if (!androidChrome) {
            return false;
          }

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
