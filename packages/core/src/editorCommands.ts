import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { EditorView } from "prosemirror-view";
import { TextSelection, type EditorState } from "prosemirror-state";
import type { Mark, MarkType, Node as ProseMirrorNode, NodeType, Schema } from "prosemirror-model";
import { DEFAULT_IMAGE_PROTOCOLS, DEFAULT_LINK_PROTOCOLS, sanitizeStoredUrl } from "./urlUtils";

export type EditorCommand = (
  state: EditorState,
  dispatch?: EditorView["dispatch"],
  view?: EditorView,
) => boolean;

export type MarkName = "strong" | "em" | "code" | "link" | "strike";

export type MarkInfo = {
  start: number;
  end: number;
  attrs?: Record<string, unknown>;
};

function createMarkInputRule(regexp: RegExp, markType: MarkType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const text = match[1];

    if (typeof text !== "string") {
      return null;
    }

    const textStart = start + match[0].indexOf(text);
    const textEnd = textStart + text.length;
    const tr = state.tr;

    if (textEnd < end) {
      tr.delete(textEnd, end);
    }

    if (textStart > start) {
      tr.delete(start, textStart);
    }

    tr.addMark(start, start + text.length, markType.create());
    tr.removeStoredMark(markType);

    return tr;
  });
}

function createImageInputRule(schema: Schema) {
  return new InputRule(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
    const alt = typeof match[1] === "string" ? match[1] : "";
    const rawSrc = match[2];
    const title = typeof match[3] === "string" ? match[3] : null;

    if (typeof rawSrc !== "string") {
      return null;
    }

    const src = sanitizeStoredUrl(rawSrc, DEFAULT_IMAGE_PROTOCOLS);

    if (!src) {
      return null;
    }

    const image = schema.nodes.image.create({ src, alt: alt || null, title });
    return state.tr.replaceWith(start, end, image);
  });
}

function createLinkInputRule(schema: Schema) {
  return new InputRule(/\[([^\]]+)\]\(([^\s)]+)\)$/, (state, match, start, end) => {
    const text = match[1];
    const rawHref = match[2];

    if (typeof text !== "string" || typeof rawHref !== "string") {
      return null;
    }

    const href = sanitizeStoredUrl(rawHref, DEFAULT_LINK_PROTOCOLS);

    if (!href) {
      return null;
    }

    const textStart = start + 1;
    const textEnd = textStart + text.length;
    const tr = state.tr;

    tr.delete(textEnd, end);
    tr.delete(start, textStart);
    tr.addMark(start, start + text.length, schema.marks.link.create({ href, title: null }));
    tr.removeStoredMark(schema.marks.link);

    return tr;
  });
}

function getFenceMatch(text: string) {
  return text.match(/^```([A-Za-z0-9_-]+)?$/);
}

export function convertFenceToCodeBlock(schema: Schema, view: EditorView) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  const parent = $from.parent;

  if (!parent.isTextblock || parent.type !== schema.nodes.paragraph) {
    return false;
  }

  const fenceMatch = getFenceMatch(parent.textContent);

  if (!fenceMatch || $from.parentOffset !== parent.content.size) {
    return false;
  }

  const language = typeof fenceMatch[1] === "string" ? fenceMatch[1] : "";
  const start = $from.start();
  const end = $from.end();
  const tr = state.tr.delete(start, end);
  tr.setBlockType(start, start, schema.nodes.code_block, { params: language });
  tr.setSelection(TextSelection.create(tr.doc, start));
  view.dispatch(tr);
  return true;
}

function createCodeBlockInputRule(schema: Schema) {
  return new InputRule(/^```([A-Za-z0-9_-]+)?\s$/, (state, match, start, end) => {
    const language = typeof match[1] === "string" ? match[1] : "";
    const tr = state.tr.delete(start, end);
    tr.setBlockType(start, start, schema.nodes.code_block, { params: language });
    return tr;
  });
}

function createHeadingInputRule(level: number, nodeType: NodeType) {
  return textblockTypeInputRule(new RegExp(`^#{${level}}\\s$`), nodeType, { level });
}

export function createTypingShortcuts(options: {
  schema: Schema;
  getAncestorInfo: (state: EditorState, nodeType: NodeType) => { node: ProseMirrorNode; pos: number } | null;
}) {
  const { getAncestorInfo, schema } = options;

  const createTaskListInputRule = () => new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
    const checked = typeof match[1] === "string" && match[1].toLowerCase() === "x";
    const { selection } = state;

    if (!selection.empty) {
      return null;
    }

    const { $from } = selection;

    if ($from.parent.type !== schema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) {
      return null;
    }

    const listItem = getAncestorInfo(state, schema.nodes.list_item);
    const bulletList = getAncestorInfo(state, schema.nodes.bullet_list);

    if (!listItem || !bulletList) {
      return null;
    }

    const tr = state.tr.delete(start, end);
    tr.setNodeMarkup(listItem.pos, schema.nodes.list_item, {
      ...listItem.node.attrs,
      checked,
    });
    tr.setSelection(TextSelection.create(tr.doc, start));
    return tr;
  });

  return inputRules({
    rules: [
      createCodeBlockInputRule(schema),
      createHeadingInputRule(6, schema.nodes.heading),
      createHeadingInputRule(5, schema.nodes.heading),
      createHeadingInputRule(4, schema.nodes.heading),
      createHeadingInputRule(3, schema.nodes.heading),
      createHeadingInputRule(2, schema.nodes.heading),
      createHeadingInputRule(1, schema.nodes.heading),
      wrappingInputRule(/^>\s$/, schema.nodes.blockquote),
      createTaskListInputRule(),
      wrappingInputRule(/^[-*+]\s$/, schema.nodes.bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + node.attrs.order === Number(match[1]),
      ),
      createImageInputRule(schema),
      createLinkInputRule(schema),
      createMarkInputRule(/(?<!`)`([^`]+)`$/, schema.marks.code),
      createMarkInputRule(/(?<!~)~~([^~]+)~~$/, schema.marks.strike),
      createMarkInputRule(/(?<!\*)\*\*([^*]+)\*\*$/, schema.marks.strong),
      createMarkInputRule(/(?<!_)__([^_]+)__$/, schema.marks.strong),
      createMarkInputRule(/(?<!\*)\*([^*]+)\*(?!\*)$/, schema.marks.em),
      createMarkInputRule(/(?<!_)_([^_]+)_(?!_)$/, schema.marks.em),
    ],
  });
}

export function insertHardBreak(schema: Schema, state: EditorState, dispatch?: (tr: import("prosemirror-state").Transaction) => void) {
  const hardBreak = schema.nodes.hard_break;

  if (!hardBreak) {
    return false;
  }

  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  }

  return true;
}

function findMark(nodeMarks: readonly Mark[], markName: MarkName) {
  return nodeMarks.find((mark) => mark.type.name === markName) ?? null;
}

function isSameMark(mark: Mark | null, other: Mark | null) {
  return !!mark && !!other && mark.eq(other);
}

export function getMarkInfo(state: EditorState, markName: MarkName): MarkInfo | null {
  const { selection } = state;

  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  const parent = $from.parent;

  if (!parent.isTextblock) {
    return null;
  }

  const parentOffset = $from.parentOffset;
  const after = parent.childAfter(parentOffset);
  const before = parent.childBefore(parentOffset);

  let offset = after.offset;
  let node = after.node;

  if (!node || !node.isText || !findMark(node.marks, markName)) {
    offset = before.offset;
    node = before.node;
  }

  if (!node || !node.isText) {
    return null;
  }

  const activeMark = findMark(node.marks, markName);

  if (!activeMark) {
    return null;
  }

  let startOffset = offset;
  let endOffset = offset + node.nodeSize;

  let index = parent.childCount;
  let runningOffset = 0;

  for (let childIndex = 0; childIndex < parent.childCount; childIndex += 1) {
    const child = parent.child(childIndex);

    if (runningOffset === offset) {
      index = childIndex;
      break;
    }

    runningOffset += child.nodeSize;
  }

  for (let leftIndex = index - 1; leftIndex >= 0; leftIndex -= 1) {
    const leftNode = parent.child(leftIndex);

    if (!leftNode.isText || !isSameMark(findMark(leftNode.marks, markName), activeMark)) {
      break;
    }

    startOffset -= leftNode.nodeSize;
  }

  for (let rightIndex = index + 1; rightIndex < parent.childCount; rightIndex += 1) {
    const rightNode = parent.child(rightIndex);

    if (!rightNode.isText || !isSameMark(findMark(rightNode.marks, markName), activeMark)) {
      break;
    }

    endOffset += rightNode.nodeSize;
  }

  const start = $from.start() + startOffset;
  const end = $from.start() + endOffset;

  if (selection.from < start || selection.from > end) {
    return null;
  }

  return {
    start,
    end,
    attrs: activeMark.attrs,
  };
}

function isMarkActiveForToolbar(
  state: EditorState,
  markName: MarkName,
  markType: MarkType,
  isEscapedOutsideBoundary: (state: EditorState, markName: MarkName, markInfo: MarkInfo) => boolean,
) {
  const markInfo = getMarkInfo(state, markName);

  if (markInfo) {
    return !isEscapedOutsideBoundary(state, markName, markInfo);
  }

  if (!state.selection.empty) {
    return state.doc.rangeHasMark(state.selection.from, state.selection.to, markType);
  }

  const marks = state.storedMarks ?? state.selection.$from.marks();
  return !!markType.isInSet(marks);
}

export function getToolbarMarkState(
  state: EditorState,
  markName: MarkName,
  markType: MarkType,
  command: EditorCommand,
  isEscapedOutsideBoundary: (state: EditorState, markName: MarkName, markInfo: MarkInfo) => boolean,
) {
  return {
    active: isMarkActiveForToolbar(state, markName, markType, isEscapedOutsideBoundary),
    enabled: command(state),
  };
}

export function getLinkToolbarState(options: {
  state: EditorState;
  canSetLink: (state: EditorState) => boolean;
  isEscapedOutsideBoundary: (state: EditorState, markName: MarkName, markInfo: MarkInfo) => boolean;
}) {
  const { canSetLink, isEscapedOutsideBoundary, state } = options;
  const markInfo = getMarkInfo(state, "link");
  const active = !!markInfo && !isEscapedOutsideBoundary(state, "link", markInfo);

  return {
    active,
    enabled: active || canSetLink(state),
  };
}

export function getImageToolbarState(options: {
  state: EditorState;
  canInsertImage: (state: EditorState) => boolean;
  getActiveImageInfo: (state: EditorState) => unknown;
}) {
  const { canInsertImage, getActiveImageInfo, state } = options;
  const active = !!getActiveImageInfo(state);

  return {
    active,
    enabled: active || canInsertImage(state),
  };
}
