import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  horizontalArrowLogicalSide,
  probeVisualRangeMotion,
  type LogicalHorizontalSide,
  type PhysicalHorizontalDirection,
} from "./physicalArrow";

export type BoundaryMarkName = "strong" | "em" | "code" | "link" | "strike";

export type BoundaryMarkInfo = {
  start: number;
  end: number;
  attrs?: Record<string, unknown>;
};

export type EscapedBoundary = {
  markNames: readonly BoundaryMarkName[];
  pos: number;
  side: "before" | "after";
};

const escapedBoundaryKey = new PluginKey<EscapedBoundary | null>("escaped-boundary");

export function createMarkBoundaryHelpers(options: {
  getMarkInfo: (state: EditorState, markName: BoundaryMarkName) => BoundaryMarkInfo | null;
}) {
  const { getMarkInfo } = options;

  function getBoundaryMarks(state: EditorState, side: LogicalHorizontalSide) {
    const markNames: BoundaryMarkName[] = ["code", "link", "strong", "em", "strike"];
    const boundaries: Array<{
      markInfo: BoundaryMarkInfo;
      markName: BoundaryMarkName;
    }> = [];

    for (const markName of markNames) {
      const markInfo = getMarkInfo(state, markName);

      if (markInfo && state.selection.from === (side === "before" ? markInfo.start : markInfo.end)) {
        boundaries.push({ markInfo, markName });
      }
    }

    return boundaries;
  }

  function getEscapedBoundary(state: EditorState) {
    return escapedBoundaryKey.getState(state) ?? null;
  }

  function isEscapedOutsideBoundary(state: EditorState, markName: BoundaryMarkName, markInfo: BoundaryMarkInfo) {
    const escaped = getEscapedBoundary(state);

    if (
      !escaped
      || !escaped.markNames.includes(markName)
      || escaped.pos !== state.selection.from
    ) {
      return false;
    }

    return (
      (escaped.side === "before" && escaped.pos === markInfo.start) ||
      (escaped.side === "after" && escaped.pos === markInfo.end)
    );
  }

  function escapeBoundaryMark(view: EditorView, direction: PhysicalHorizontalDirection) {
    const fallbackSide = horizontalArrowLogicalSide(view, direction);
    let boundary: EscapedBoundary | null = null;

    for (const side of ["before", "after"] as const) {
      const markNames = getBoundaryMarks(view.state, side)
        .filter(({ markInfo }) => (
          (probeVisualRangeMotion(view, direction, markInfo.start, markInfo.end) ?? fallbackSide)
          === side
        ))
        .map(({ markName }) => markName);

      if (markNames.length > 0) {
        boundary = {
          markNames,
          pos: view.state.selection.from,
          side,
        };
        break;
      }
    }

    if (!boundary) {
      return false;
    }

    const escaped = getEscapedBoundary(view.state);

    if (
      escaped &&
      escaped.pos === boundary.pos &&
      escaped.side === boundary.side &&
      boundary.markNames.every((markName) => escaped.markNames.includes(markName))
    ) {
      return false;
    }

    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, boundary.pos));
    const escapedMarkNames = boundary.markNames;
    const storedMarks = view.state.selection.$from.marks().filter((mark) => (
      !escapedMarkNames.includes(mark.type.name as BoundaryMarkName)
    ));
    tr.setStoredMarks(storedMarks);
    tr.setMeta(escapedBoundaryKey, boundary);
    view.dispatch(tr);
    return true;
  }

  function handleBoundaryKeyDown(view: EditorView, event: KeyboardEvent) {
    if (
      !view.editable
      || view.composing
      || event.isComposing
      || event.keyCode === 229
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return false;
    }

    if (event.key === "ArrowLeft") {
      return escapeBoundaryMark(view, "left");
    }

    if (event.key === "ArrowRight") {
      return escapeBoundaryMark(view, "right");
    }

    return false;
  }

  function createEscapedBoundaryPlugin() {
    return new Plugin<EscapedBoundary | null>({
      key: escapedBoundaryKey,
      props: { handleKeyDown: handleBoundaryKeyDown },
      state: {
        init() {
          return null;
        },
        apply(tr, value, _oldState, newState) {
          const meta = tr.getMeta(escapedBoundaryKey);

          if (meta !== undefined) {
            return meta;
          }

          if (!newState.selection.empty) {
            return null;
          }

          if (!value || newState.selection.from !== value.pos || tr.docChanged) {
            return null;
          }

          return value;
        },
      },
    });
  }

  return {
    isEscapedOutsideBoundary,
    createEscapedBoundaryPlugin,
  };
}
