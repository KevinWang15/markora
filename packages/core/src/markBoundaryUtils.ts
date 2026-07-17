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
  markName: BoundaryMarkName;
  pos: number;
  side: "before" | "after";
};

const escapedBoundaryKey = new PluginKey<EscapedBoundary | null>("escaped-boundary");

export function createMarkBoundaryHelpers(options: {
  getMarkInfo: (state: EditorState, markName: BoundaryMarkName) => BoundaryMarkInfo | null;
}) {
  const { getMarkInfo } = options;

  function getBoundaryMark(state: EditorState, side: LogicalHorizontalSide) {
    const markNames: BoundaryMarkName[] = ["code", "link", "strong", "em", "strike"];

    for (const markName of markNames) {
      const markInfo = getMarkInfo(state, markName);

      if (!markInfo) {
        continue;
      }

      if (side === "before" && state.selection.from === markInfo.start) {
        return { markName, pos: markInfo.start, side: "before" as const };
      }

      if (side === "after" && state.selection.from === markInfo.end) {
        return { markName, pos: markInfo.end, side: "after" as const };
      }
    }

    return null;
  }

  function getEscapedBoundary(state: EditorState) {
    return escapedBoundaryKey.getState(state) ?? null;
  }

  function isEscapedOutsideBoundary(state: EditorState, markName: BoundaryMarkName, markInfo: BoundaryMarkInfo) {
    const escaped = getEscapedBoundary(state);

    if (!escaped || escaped.markName !== markName || escaped.pos !== state.selection.from) {
      return false;
    }

    return (
      (escaped.side === "before" && escaped.pos === markInfo.start) ||
      (escaped.side === "after" && escaped.pos === markInfo.end)
    );
  }

  function escapeBoundaryMark(view: EditorView, direction: PhysicalHorizontalDirection) {
    const fallbackSide = horizontalArrowLogicalSide(view, direction);
    let boundary: ReturnType<typeof getBoundaryMark> = null;

    for (const side of ["before", "after"] as const) {
      const candidate = getBoundaryMark(view.state, side);

      if (!candidate) {
        continue;
      }

      const markInfo = getMarkInfo(view.state, candidate.markName);
      const visualMotion = markInfo
        ? probeVisualRangeMotion(view, direction, markInfo.start, markInfo.end)
        : null;

      if ((visualMotion ?? fallbackSide) === side) {
        boundary = candidate;
        break;
      }
    }

    if (!boundary) {
      return false;
    }

    const escaped = getEscapedBoundary(view.state);

    if (
      escaped &&
      escaped.markName === boundary.markName &&
      escaped.pos === boundary.pos &&
      escaped.side === boundary.side
    ) {
      return false;
    }

    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, boundary.pos));
    const storedMarks = view.state.selection.$from.marks().filter((mark) => mark.type.name !== boundary.markName);
    tr.setStoredMarks(storedMarks);
    tr.setMeta(escapedBoundaryKey, boundary);
    view.dispatch(tr);
    return true;
  }

  function createEscapedBoundaryPlugin() {
    return new Plugin<EscapedBoundary | null>({
      key: escapedBoundaryKey,
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
    getBoundaryMark,
    getEscapedBoundary,
    isEscapedOutsideBoundary,
    escapeBoundaryMark,
    createEscapedBoundaryPlugin,
  };
}
