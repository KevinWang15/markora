import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";

type GraphemeSegment = {
  index: number;
};

type GraphemeSegmenter = {
  segment(input: string): Iterable<GraphemeSegment>;
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
    let previousStart = 0;

    for (const segment of new intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
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

export function createAndroidInputPlugin(ownerWindow: BrowserWindow) {
  const androidChrome = isAndroidChrome(ownerWindow);
  const pendingFallbacks = new Set<number>();
  let lastFallbackState: FallbackState | null = null;

  return new Plugin({
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          if (
            !androidChrome
            || !view.editable
            || view.composing
            || !("inputType" in event)
          ) {
            return false;
          }

          const inputEvent = event as InputEvent;

          if (
            inputEvent.defaultPrevented
            || inputEvent.isComposing
            || inputEvent.inputType !== "deleteContentBackward"
          ) {
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

            const backspaceEvent = ownerDocument.createEvent("Event") as KeyboardEvent;
            backspaceEvent.initEvent("keydown", true, true);
            Object.assign(backspaceEvent, {
              code: "Backspace",
              key: "Backspace",
              keyCode: 8,
            });
            const stateBeforeKeyDown = view.state;
            const handled = view.someProp("handleKeyDown", (handler) => (
              handler(view, backspaceEvent) || undefined
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

            const nodeBefore = selection.$from.nodeBefore;

            if (nodeBefore && !nodeBefore.isText && nodeBefore.isInline && nodeBefore.isAtom) {
              view.dispatch(
                view.state.tr
                  .delete(selection.from - nodeBefore.nodeSize, selection.from)
                  .scrollIntoView(),
              );
              lastFallbackState = captureFallbackState(view.state);
              return;
            }

            const textBefore = readContiguousTextBefore(
              selection.$from.parent,
              selection.$from.parentOffset,
            );

            if (!textBefore) {
              return;
            }

            const graphemeStart = findPreviousGraphemeStart(textBefore);
            const graphemeLength = textBefore.length - graphemeStart;

            if (graphemeLength <= 0 || graphemeLength > selection.from) {
              return;
            }

            view.dispatch(
              view.state.tr
                .delete(selection.from - graphemeLength, selection.from)
                .scrollIntoView(),
            );
            lastFallbackState = captureFallbackState(view.state);
          }, 60);

          pendingFallbacks.add(timeoutId);
          // Returning true suppresses ProseMirror's code-unit fallback. The
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
