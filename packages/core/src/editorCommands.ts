import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { EditorView } from "prosemirror-view";
import type MarkdownIt from "markdown-it";
import { TextSelection, type EditorState } from "prosemirror-state";
import type { Mark, MarkType, NodeType, Schema } from "prosemirror-model";
import {
  normalizeMarkdownEditorResources,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";

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

function createImageInputRule(schema: Schema, resources: NormalizedMarkdownEditorResources) {
  return new InputRule(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
    const alt = typeof match[1] === "string" ? match[1] : "";
    const rawSrc = match[2];
    const title = typeof match[3] === "string" ? match[3] : null;

    if (typeof rawSrc !== "string") {
      return null;
    }

    const src = sanitizeResourceUrl(resources, "image", rawSrc);

    if (!src) {
      return null;
    }

    const image = schema.nodes.image.create({ src, alt: alt || null, title });
    return state.tr.replaceWith(start, end, image);
  });
}

function createLinkInputRule(schema: Schema, resources: NormalizedMarkdownEditorResources) {
  return new InputRule(/\[([^\]]+)\]\(([^\s)]+)\)$/, (state, match, start, end) => {
    const text = match[1];
    const rawHref = match[2];

    if (typeof text !== "string" || typeof rawHref !== "string") {
      return null;
    }

    const href = sanitizeResourceUrl(resources, "link", rawHref);

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

function createBareAutolinkInputRule(
  schema: Schema,
  resources: NormalizedMarkdownEditorResources,
  linkify: MarkdownIt["linkify"],
) {
  return new InputRule(/(?:^|\s)(\S+)\s$/, (state, match, start, end) => {
    const candidate = match[1];
    if (typeof candidate !== "string") return null;

    const linked = linkify.match(candidate)?.[0] ?? null;
    if (
      !linked
      || linked.lastIndex > candidate.length
      || (linked.index > 0 && !/[*_~(]/.test(candidate[linked.index - 1] ?? ""))
    ) {
      return null;
    }

    const href = sanitizeResourceUrl(resources, "link", linked.url);
    if (!href) return null;

    if (start < end && state.doc.rangeHasMark(start, end, schema.marks.link)) {
      return null;
    }

    const candidateOffset = start + match[0].indexOf(candidate);
    const candidateStart = candidateOffset + linked.index;
    const linkEnd = candidateOffset + linked.lastIndex;
    const tr = state.tr.insertText(match[0], start, end);
    tr.addMark(candidateStart, linkEnd, schema.marks.link.create({
      autolink: true,
      href,
      title: null,
    }));
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
  linkify: MarkdownIt["linkify"];
  resources?: NormalizedMarkdownEditorResources;
}) {
  const {
    linkify,
    resources = normalizeMarkdownEditorResources(undefined),
    schema,
  } = options;
  const getAncestorInfo = (state: EditorState, nodeType: NodeType) => {
    const { selection } = state;

    if (!selection.empty) {
      return null;
    }

    const { $from } = selection;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === nodeType) {
        return {
          node: $from.node(depth),
          pos: $from.before(depth),
        };
      }
    }

    return null;
  };

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

  const rules: InputRule[] = [];
  const { marks, nodes } = schema;

  if (nodes.code_block) {
    rules.push(createCodeBlockInputRule(schema));
  }
  if (nodes.heading) {
    for (let level = 6; level >= 1; level -= 1) {
      rules.push(createHeadingInputRule(level, nodes.heading));
    }
  }
  if (nodes.blockquote) {
    rules.push(wrappingInputRule(/^>\s$/, nodes.blockquote));
  }
  if (
    nodes.list_item
    && nodes.bullet_list
    && nodes.list_item.spec.attrs
    && Object.prototype.hasOwnProperty.call(nodes.list_item.spec.attrs, "checked")
  ) {
    rules.push(createTaskListInputRule());
  }
  if (nodes.bullet_list) {
    rules.push(wrappingInputRule(/^[-*+]\s$/, nodes.bullet_list));
  }
  if (nodes.ordered_list) {
    rules.push(wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ));
  }
  if (nodes.image) {
    rules.push(createImageInputRule(schema, resources));
  }
  if (marks.link) {
    rules.push(
      createLinkInputRule(schema, resources),
      createBareAutolinkInputRule(schema, resources, linkify),
    );
  }
  if (marks.code) {
    rules.push(createMarkInputRule(/(?<!`)`([^`]+)`$/, marks.code));
  }
  if (marks.strike) {
    rules.push(createMarkInputRule(/(?<!~)~~([^~]+)~~$/, marks.strike));
  }
  if (marks.strong) {
    rules.push(
      createMarkInputRule(/(?<!\*)\*\*([^*]+)\*\*$/, marks.strong),
      createMarkInputRule(/(?<!_)__([^_]+)__$/, marks.strong),
    );
  }
  if (marks.em) {
    rules.push(
      createMarkInputRule(/(?<!\*)\*([^*]+)\*(?!\*)$/, marks.em),
      createMarkInputRule(/(?<!_)_([^_]+)_(?!_)$/, marks.em),
    );
  }

  return inputRules({ rules });
}

export function insertHardBreak(schema: Schema, state: EditorState, dispatch?: (tr: import("prosemirror-state").Transaction) => void) {
  const hardBreak = schema.nodes.hard_break;

  if (
    !hardBreak
    || !state.selection.$from.parent.canReplaceWith(
      state.selection.$from.index(),
      state.selection.$from.index(),
      hardBreak,
    )
  ) {
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

export function isMarkActive(
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

export function isLinkActive(options: {
  state: EditorState;
  isEscapedOutsideBoundary: (state: EditorState, markName: MarkName, markInfo: MarkInfo) => boolean;
}) {
  const { isEscapedOutsideBoundary, state } = options;
  const markInfo = getMarkInfo(state, "link");
  return !!markInfo && !isEscapedOutsideBoundary(state, "link", markInfo);
}
