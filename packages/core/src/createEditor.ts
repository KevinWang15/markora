import { baseKeymap, chainCommands, liftEmptyBlock, toggleMark } from "prosemirror-commands";
import { Fragment as PMFragment } from "prosemirror-model";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Fragment, Schema, type Mark, type MarkType, type Node as ProseMirrorNode, type NodeType } from "prosemirror-model";
import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as baseSchema,
} from "prosemirror-markdown";
import { sinkListItem, splitListItem, liftListItem } from "prosemirror-schema-list";
import { EditorState, NodeSelection, Plugin, Selection, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";


export type CreateEditorOptions = {
  element: HTMLElement;
  markdown?: string;
  onTransaction?: (transaction: Parameters<EditorView["dispatch"]>[0], view: EditorView) => void;
  onChange?: (markdown: string) => void;
  onChangeMode?: "immediate" | "animationFrame";
};

import { BoundarySide, ManagedBlockCursor, type ManagedBlockBoundary, isManagedBlockNodeFromSchema } from "./managedBlockCursor";
export { ManagedBlockCursor } from "./managedBlockCursor";
import { createManagedBlockBoundaryPlugin } from "./managedBlockCursorPlugin";
import { createManagedBlockBoundaryHelpers } from "./managedBlockBoundary";
import { createCodeBlockViewClass } from "./codeBlockView";
import { createTableNavigation, type TableAlignment } from "./tableNavigation";
import type { TableCellInfo } from "./tableTypes";
import { createImageEditorOverlay, createLinkEditorOverlay, createTableToolbarOverlay, type ImageEditorOverlay, type LinkEditorOverlay, type TableToolbarOverlay } from "./overlays";
import type { ActiveImageInfo } from "./overlayTypes";
import { DEFAULT_IMAGE_PROTOCOLS, DEFAULT_LINK_PROTOCOLS, getSafeOpenUrl, sanitizeStoredUrl } from "./urlUtils";
import { createTaskListHelpers } from "./taskListUtils";
import { createMediaActionHelpers } from "./mediaActionUtils";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";

export type MarkdownEditor = {
  view: EditorView;
  getMarkdown: () => string;
  setMarkdown: (markdown: string, options?: { emitChange?: boolean }) => void;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
  toggleBold: () => boolean;
  toggleItalic: () => boolean;
  toggleCode: () => boolean;
  toggleStrike: () => boolean;
  setLink: (href: string) => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  editLink: () => boolean;
  removeLink: () => boolean;
  editImage: () => boolean;
  removeImage: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
  destroy: () => void;
};

export type ToolbarButtonState = {
  active: boolean;
  enabled: boolean;
};

export type ToolbarState = {
  bold: ToolbarButtonState;
  italic: ToolbarButtonState;
  code: ToolbarButtonState;
  strike: ToolbarButtonState;
  link: ToolbarButtonState;
  image: ToolbarButtonState;
  undo: { enabled: boolean };
  redo: { enabled: boolean };
};

type EditorCommand = (
  state: EditorState,
  dispatch?: EditorView["dispatch"],
  view?: EditorView,
) => boolean;

type MarkName = "strong" | "em" | "code" | "link" | "strike";
type MarkRange = {
  start: number;
  end: number;
};

type MarkInfo = MarkRange & {
  attrs?: Record<string, unknown>;
};

type ActiveLineMarker = {
  pos: number;
  marker: string;
  className: string;
};

type AncestorInfo = {
  depth: number;
  node: ProseMirrorNode;
  pos: number;
};

type ActiveListItemInfo = {
  from: number;
  to: number;
};

type RevealMarkConfig = {
  markName: MarkName;
  getMarkers: (markInfo: MarkInfo) => { start: string; end: string };
};


const listItemSpec = baseSchema.spec.nodes.get("list_item");
const codeBlockSpec = baseSchema.spec.nodes.get("code_block");
const nonSelectableCodeBlockSpec = codeBlockSpec
  ? {
      ...codeBlockSpec,
      selectable: false,
      createGapCursor: true,
    }
  : undefined;
const taskListItemSpec = listItemSpec
  ? {
      ...listItemSpec,
      attrs: {
        ...(listItemSpec.attrs ?? {}),
        checked: { default: null },
      },
      parseDOM: [
        {
          tag: "li",
          getAttrs(dom: Node | string) {
            if (!(dom instanceof HTMLElement)) {
              return { checked: null };
            }

            const task = dom.getAttribute("data-task");
            const checked = dom.getAttribute("data-checked");

            if (task !== "true") {
              return { checked: null };
            }

            return { checked: checked === "true" };
          },
        },
      ],
      toDOM(node: ProseMirrorNode) {
        const checked = node.attrs.checked;

        if (typeof checked === "boolean") {
          return [
            "li",
            {
              "data-task": "true",
              "data-checked": checked ? "true" : "false",
              role: "checkbox",
              "aria-checked": checked ? "true" : "false",
              "aria-label": checked ? "Completed task" : "Incomplete task",
            },
            0,
          ] as const;
        }

        return ["li", 0] as const;
      },
    }
  : undefined;

function normalizeTableAlignment(value: unknown): TableAlignment | null {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function readTableAlignmentFromString(value: string | null | undefined): TableAlignment | null {
  if (!value) {
    return null;
  }

  if (/\bcenter\b/i.test(value)) {
    return "center";
  }

  if (/\bright\b/i.test(value)) {
    return "right";
  }

  if (/\bleft\b/i.test(value)) {
    return "left";
  }

  return null;
}

function getTableCellDOMAttrs(node: ProseMirrorNode) {
  const align = normalizeTableAlignment(node.attrs.align);

  if (!align) {
    return {};
  }

  return {
    align,
    style: `text-align: ${align};`,
  };
}

function getTableCellParseDOMAttrs(dom: Node | string) {
  if (!(dom instanceof HTMLElement)) {
    return { align: null };
  }

  const styleAlign = readTableAlignmentFromString(dom.style.textAlign || dom.getAttribute("style") || undefined);
  const attrAlign = readTableAlignmentFromString(dom.getAttribute("align"));

  return {
    align: attrAlign ?? styleAlign ?? null,
  };
}

function getTableCellTokenAttrs(token: { attrGet?: (name: string) => string | null }) {
  const align = readTableAlignmentFromString(token.attrGet?.("align") ?? token.attrGet?.("style") ?? undefined);
  return { align };
}

function createTableDividerCell(align: TableAlignment | null) {
  switch (align) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

const tableNodeSpecs = {
  table: {
    content: "table_row+",
    group: "block",
    isolating: true,
    parseDOM: [{ tag: "table" }],
    toDOM() {
      return ["table", ["tbody", 0]] as const;
    },
  },
  table_row: {
    content: "(table_cell | table_header)+",
    parseDOM: [{ tag: "tr" }],
    toDOM() {
      return ["tr", 0] as const;
    },
  },
  table_cell: {
    attrs: {
      align: { default: null },
    },
    content: "block+",
    isolating: true,
    parseDOM: [{ tag: "td", getAttrs: getTableCellParseDOMAttrs }],
    toDOM(node: ProseMirrorNode) {
      return ["td", getTableCellDOMAttrs(node), 0] as const;
    },
  },
  table_header: {
    attrs: {
      align: { default: null },
    },
    content: "block+",
    isolating: true,
    parseDOM: [{ tag: "th", getAttrs: getTableCellParseDOMAttrs }],
    toDOM(node: ProseMirrorNode) {
      return ["th", getTableCellDOMAttrs(node), 0] as const;
    },
  },
};

const strikeMarkSpec = {
  parseDOM: [
    { tag: "del" },
    { tag: "s" },
    { tag: "strike" },
  ],
  toDOM() {
    return ["del", 0] as const;
  },
};

const schemaNodes = (
  nonSelectableCodeBlockSpec ? baseSchema.spec.nodes.update("code_block", nonSelectableCodeBlockSpec) : baseSchema.spec.nodes
)
  .update("list_item", taskListItemSpec ?? listItemSpec!)
  .addToEnd("table", tableNodeSpecs.table)
  .addToEnd("table_row", tableNodeSpecs.table_row)
  .addToEnd("table_cell", tableNodeSpecs.table_cell)
  .addToEnd("table_header", tableNodeSpecs.table_header);

const schema = new Schema({
  nodes: schemaNodes,
  marks: baseSchema.spec.marks.addToEnd("strike", strikeMarkSpec),
});

const markdownTokenizer = defaultMarkdownParser.tokenizer.enable("strikethrough").enable("table");
type MarkdownSerializerStateWithInternals = MarkdownSerializerState & {
  closed: { type: ProseMirrorNode["type"] } | null;
  flushClose: (size: number) => void;
  inTightList: boolean;
};

const defaultMarkdownTokens = {
  ...defaultMarkdownParser.tokens,
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: getTableCellTokenAttrs },
  td: { block: "table_cell", getAttrs: getTableCellTokenAttrs },
  s: { mark: "strike" },
};

const markdownParser = new MarkdownParser(schema, markdownTokenizer, defaultMarkdownTokens);

const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
const {
  canSetLink,
  setLink,
  canInsertImage,
  insertImage,
  getActiveImageInfo,
  updateLinkHref,
  updateActiveImage,
  removeActiveImage,
  removeActiveLink,
  maybeEditActiveImage,
  maybeOpenImage,
  maybeOpenLink,
  maybeEditActiveLink,
} = createMediaActionHelpers({ schema, getMarkInfo });
const { isEscapedOutsideBoundary, escapeBoundaryMark, createEscapedBoundaryPlugin } = createMarkBoundaryHelpers({ getMarkInfo });

function serializeTableCell(node: ProseMirrorNode) {
  const cellDoc = schema.nodes.doc.create(null, node.content);
  const serialized = markdownSerializer.serialize(cellDoc).trim();

  if (!serialized) {
    return "";
  }

  return markdownSerializer
    .serialize(cellDoc)
    .trim()
    .replace(/\n{3,}/g, "<br><br>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function createTableCellContentFromMarkdown(text: string) {
  const parsedDoc = parseMarkdown(text);

  if (!parsedDoc || parsedDoc.childCount === 0) {
    return Fragment.from(schema.nodes.paragraph.create());
  }

  return parsedDoc.content;
}

function createTableDividerRow(node: ProseMirrorNode) {
  const parts: string[] = [];

  node.forEach((cell) => {
    parts.push(createTableDividerCell(normalizeTableAlignment(cell.attrs.align)));
  });

  return `| ${parts.join(" | ")} |`;
}

const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    table(state: MarkdownSerializerState, node: ProseMirrorNode) {
      const lines: string[] = [];

      node.forEach((row: ProseMirrorNode, _offset: number, index: number) => {
        const cells: string[] = [];
        row.forEach((cell: ProseMirrorNode) => {
          cells.push(serializeTableCell(cell));
        });

        lines.push(`| ${cells.join(" | ")} |`);

        if (index === 0 && row.firstChild?.type === schema.nodes.table_header) {
          lines.push(createTableDividerRow(row));
        }
      });

      state.write(lines.join("\n"));
      state.closeBlock(node);
    },
    bullet_list(state: MarkdownSerializerState, node: ProseMirrorNode) {
      const listState = state as MarkdownSerializerStateWithInternals;
      const wasClosed = listState.closed && listState.closed.type === node.type;

      if (wasClosed) {
        listState.flushClose(3);
      } else if (listState.inTightList) {
        listState.flushClose(1);
      }

      const isTight = typeof node.attrs.tight !== "undefined" ? node.attrs.tight : state.options.tightLists;
      const previousTight = listState.inTightList;
      listState.inTightList = isTight;

      node.forEach((child: ProseMirrorNode, _offset: number, index: number) => {
        if (index && isTight) {
          listState.flushClose(1);
        }

        const checked = child.attrs.checked;
        const firstDelim =
          typeof checked === "boolean"
            ? `${node.attrs.bullet || "*"} [${checked ? "x" : " "}] `
            : `${node.attrs.bullet || "*"} `;
        const delim = " ".repeat(firstDelim.length);
        state.wrapBlock(delim, firstDelim, node, () => state.render(child, node, index));
      });

      listState.inTightList = previousTight;
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  },
);


const revealMarkConfigs: RevealMarkConfig[] = [
  {
    markName: "strong",
    getMarkers: () => ({ start: "**", end: "**" }),
  },
  {
    markName: "em",
    getMarkers: () => ({ start: "*", end: "*" }),
  },
  {
    markName: "code",
    getMarkers: () => ({ start: "`", end: "`" }),
  },
  {
    markName: "strike",
    getMarkers: () => ({ start: "~~", end: "~~" }),
  },
  {
    markName: "link",
    getMarkers: (markInfo) => {
      const href = typeof markInfo.attrs?.href === "string" ? markInfo.attrs.href : "";
      return { start: "[", end: `](${href})` };
    },
  },
];

function stripTaskPrefixFromInline(fragment: PMFragment, count: number) {
  let remaining = count;
  const children: ProseMirrorNode[] = [];

  fragment.forEach((child) => {
    if (remaining <= 0) {
      children.push(child);
      return;
    }

    if (child.isText) {
      const textValue = child.text ?? "";

      if (textValue.length <= remaining) {
        remaining -= textValue.length;
        return;
      }

      children.push(schema.text(textValue.slice(remaining), child.marks));
      remaining = 0;
      return;
    }

    children.push(child);
  });

  return PMFragment.fromArray(children);
}

function normalizeTaskListNode(node: ProseMirrorNode, parentTypeName?: string): ProseMirrorNode {
  if (node.isText) {
    return node;
  }

  const children: ProseMirrorNode[] = [];
  node.content.forEach((child) => {
    children.push(normalizeTaskListNode(child, node.type.name));
  });

  let nextNode = node.type.create(node.attrs, children, node.marks);

  if (parentTypeName === "bullet_list" && nextNode.type === schema.nodes.list_item && nextNode.childCount > 0) {
    const firstChild = nextNode.firstChild;

    if (firstChild?.type === schema.nodes.paragraph) {
      const match = firstChild.textContent.match(/^\[( |x|X)\]\s+/);

      if (match) {
        const checked = match[1].toLowerCase() === "x";
        const prefixLength = match[0].length;
        const nextParagraph = firstChild.copy(stripTaskPrefixFromInline(firstChild.content, prefixLength));
        const taskChildren = [nextParagraph];

        for (let index = 1; index < nextNode.childCount; index += 1) {
          taskChildren.push(nextNode.child(index));
        }

        nextNode = schema.nodes.list_item.create({ ...nextNode.attrs, checked }, taskChildren, nextNode.marks);
      }
    }
  }

  return nextNode;
}

function parseMarkdown(markdown: string) {
  if (markdown.trim().length === 0) {
    return schema.topNodeType.createAndFill();
  }

  return normalizeTaskListNode(markdownParser.parse(markdown));
}

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

function createImageInputRule() {
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

function createLinkInputRule() {
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

function convertFenceToCodeBlock(view: EditorView) {
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

function createCodeBlockInputRule() {
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

function createTaskListInputRule() {
  return new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
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
}

function getHorizontalRuleMarkup(text: string) {
  const trimmed = text.trim();

  if (/^-{3,}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\*{3,}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^_{3,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function createHorizontalRulePlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { selection } = state;

        if (event.key === "Enter" && selection.empty) {
          const { $from } = selection;
          const parent = $from.parent;

          if (parent.type === schema.nodes.paragraph) {
            const markup = getHorizontalRuleMarkup(parent.textContent);

            if (markup) {
              event.preventDefault();
              const blockStart = $from.before();
              const blockEnd = $from.after();
              const horizontalRule = schema.nodes.horizontal_rule.create({ markup });
              const paragraph = schema.nodes.paragraph.create();
              const tr = state.tr.replaceWith(blockStart, blockEnd, [horizontalRule, paragraph]);
              tr.setSelection(TextSelection.create(tr.doc, blockStart + horizontalRule.nodeSize + 1));
              view.dispatch(tr);
              return true;
            }
          }
        }

        if (event.key === "Backspace" && selection.empty) {
          const { $from } = selection;

          if ($from.parent.type === schema.nodes.paragraph && $from.parentOffset === 0) {
            const parent = $from.parent;
            const blockStart = $from.before();
            const blockEnd = $from.after();
            const beforePos = $from.before();
            const beforeResolved = state.doc.resolve(beforePos);
            const previousNode = beforeResolved.nodeBefore;

            if (previousNode?.type === schema.nodes.horizontal_rule) {
              event.preventDefault();
              view.dispatch(state.tr.delete(beforePos - previousNode.nodeSize, beforePos));
              return true;
            }

            const nextResolved = state.doc.resolve(blockEnd);
            const nextNode = nextResolved.nodeAfter;

            if (!previousNode && parent.content.size === 0 && nextNode && isManagedBlockNode(nextNode)) {
              const tr = state.tr.delete(blockStart, blockEnd);
              const boundarySelection = ManagedBlockCursor.create(tr.doc, blockStart, "before", isManagedBlockNode);

              if (!boundarySelection) {
                return false;
              }

              event.preventDefault();
              view.dispatch(tr.setSelection(boundarySelection).scrollIntoView());
              return true;
            }
          }
        }

        if (event.key === "ArrowUp" && selection.empty) {
          const { $from } = selection;

          if ($from.parent.type === schema.nodes.paragraph && $from.parentOffset === 0) {
            const beforePos = $from.before();
            const beforeResolved = state.doc.resolve(beforePos);
            const previousNode = beforeResolved.nodeBefore;

            if (previousNode?.type === schema.nodes.horizontal_rule) {
              event.preventDefault();
              view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, beforePos - previousNode.nodeSize)));
              return true;
            }
          }
        }

        if ((event.key === "ArrowDown" || event.key === "Enter") && selection instanceof NodeSelection) {
          const selectedNode = selection.node;

          if (selectedNode.type === schema.nodes.horizontal_rule) {
            event.preventDefault();
            const afterPos = selection.from + selectedNode.nodeSize;
            const nextSelection = Selection.near(state.doc.resolve(afterPos), 1);
            view.dispatch(state.tr.setSelection(nextSelection));
            return true;
          }
        }

        return false;
      },
    },
  });
}

function insertHardBreak(state: EditorState, dispatch?: (tr: import("prosemirror-state").Transaction) => void) {
  const hardBreak = schema.nodes.hard_break;

  if (!hardBreak) {
    return false;
  }

  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  }

  return true;
}

function getImageMatch(text: string) {
  return text.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
}

function createImagePlugin() {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const { selection } = newState;

      if (!selection.empty) {
        return null;
      }

      const { $from } = selection;
      const parent = $from.parent;

      if (parent.type !== schema.nodes.paragraph) {
        return null;
      }

      const match = getImageMatch(parent.textContent);

      if (!match) {
        return null;
      }

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
      const paragraphPos = $from.before();
      const tr = newState.tr.replaceWith(paragraphPos + 1, paragraphPos + 1 + parent.content.size, image);
      tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 1), 1));
      return tr;
    },
  });
}

function createTypingShortcuts() {
  return inputRules({
    rules: [
      createCodeBlockInputRule(),
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
      createImageInputRule(),
      createLinkInputRule(),
      createMarkInputRule(/(?<!`)`([^`]+)`$/, schema.marks.code),
      createMarkInputRule(/(?<!~)~~([^~]+)~~$/, schema.marks.strike),
      createMarkInputRule(/(?<!\*)\*\*([^*]+)\*\*$/, schema.marks.strong),
      createMarkInputRule(/(?<!_)__([^_]+)__$/, schema.marks.strong),
      createMarkInputRule(/(?<!\*)\*([^*]+)\*(?!\*)$/, schema.marks.em),
      createMarkInputRule(/(?<!_)_([^_]+)_(?!_)$/, schema.marks.em),
    ],
  });
}

function findMark(nodeMarks: readonly Mark[], markName: MarkName) {
  return nodeMarks.find((mark) => mark.type.name === markName) ?? null;
}

function isSameMark(mark: Mark | null, other: Mark | null) {
  return !!mark && !!other && mark.eq(other);
}

function getMarkInfo(state: EditorState, markName: MarkName): MarkInfo | null {
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

function getToolbarMarkState(
  state: EditorState,
  markName: MarkName,
  markType: MarkType,
  command: EditorCommand,
): ToolbarButtonState {
  return {
    active: isMarkActiveForToolbar(state, markName, markType),
    enabled: command(state),
  };
}

function getLinkToolbarState(state: EditorState): ToolbarButtonState {
  const markInfo = getMarkInfo(state, "link");
  const active = !!markInfo && !isEscapedOutsideBoundary(state, "link", markInfo);

  return {
    active,
    enabled: active || canSetLink(state),
  };
}

function getImageToolbarState(state: EditorState): ToolbarButtonState {
  const active = !!getActiveImageInfo(state);

  return {
    active,
    enabled: active || canInsertImage(state),
  };
}

class ImageView {
  dom: HTMLSpanElement;
  private sourceRow: HTMLSpanElement;
  private sourceText: HTMLSpanElement;
  private frame: HTMLSpanElement;
  private img: HTMLImageElement;
  private status: HTMLSpanElement;
  private spinner: HTMLSpanElement;
  private errorIcon: HTMLSpanElement;
  private statusText: HTMLSpanElement;
  private requestVersion = 0;

  constructor(private node: ProseMirrorNode) {
    this.dom = document.createElement("span");
    this.dom.className = "mdw-image";
    this.dom.contentEditable = "false";
    this.dom.style.display = "inline-flex";
    this.dom.style.flexDirection = "column";
    this.dom.style.gap = "8px";
    this.dom.style.maxWidth = "100%";
    this.dom.style.verticalAlign = "top";

    this.sourceRow = document.createElement("span");
    this.sourceRow.className = "mdw-image-source";
    this.sourceRow.hidden = true;
    this.sourceRow.style.display = "inline-flex";
    this.sourceRow.style.alignItems = "center";
    this.sourceRow.style.gap = "8px";
    this.sourceRow.style.opacity = "0.72";
    this.sourceRow.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    this.sourceRow.style.fontSize = "0.95em";

    const sourceIcon = document.createElement("span");
    sourceIcon.textContent = "🖼️";
    sourceIcon.setAttribute("aria-hidden", "true");

    this.sourceText = document.createElement("span");
    this.sourceRow.append(sourceIcon, this.sourceText);

    this.frame = document.createElement("span");
    this.frame.style.position = "relative";
    this.frame.style.display = "inline-flex";
    this.frame.style.alignSelf = "flex-start";
    this.frame.style.maxWidth = "100%";
    this.frame.style.minWidth = "48px";
    this.frame.style.minHeight = "48px";

    this.img = document.createElement("img");
    this.img.draggable = false;
    this.img.style.display = "block";
    this.img.style.maxWidth = "100%";
    this.img.style.height = "auto";

    this.status = document.createElement("span");
    this.status.style.position = "absolute";
    this.status.style.inset = "0";
    this.status.style.display = "grid";
    this.status.style.placeItems = "center";
    this.status.style.background = "rgba(148, 163, 184, 0.12)";
    this.status.style.border = "1px dashed rgba(148, 163, 184, 0.35)";
    this.status.style.borderRadius = "12px";
    this.status.style.padding = "12px";

    const statusInner = document.createElement("span");
    statusInner.style.display = "inline-flex";
    statusInner.style.flexDirection = "column";
    statusInner.style.alignItems = "center";
    statusInner.style.gap = "8px";

    this.spinner = document.createElement("span");
    this.spinner.style.width = "20px";
    this.spinner.style.height = "20px";
    this.spinner.style.border = "2px solid rgba(148, 163, 184, 0.35)";
    this.spinner.style.borderTopColor = "rgba(59, 130, 246, 0.95)";
    this.spinner.style.borderRadius = "999px";
    this.spinner.style.display = "inline-block";
    this.spinner.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(360deg)" },
      ],
      { duration: 900, iterations: Infinity },
    );

    this.errorIcon = document.createElement("span");
    this.errorIcon.textContent = "⚠️";
    this.errorIcon.hidden = true;

    this.statusText = document.createElement("span");
    this.statusText.style.fontSize = "12px";
    this.statusText.style.opacity = "0.8";

    statusInner.append(this.spinner, this.errorIcon, this.statusText);
    this.status.append(statusInner);
    this.frame.append(this.img, this.status);
    this.dom.append(this.sourceRow, this.frame);

    this.syncMeta();
    this.load();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== schema.nodes.image) {
      return false;
    }

    const previousSrc = typeof this.node.attrs.src === "string" ? this.node.attrs.src : "";
    this.node = node;
    this.syncMeta();

    if (previousSrc !== (typeof node.attrs.src === "string" ? node.attrs.src : "")) {
      this.load();
    }

    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
    this.sourceRow.hidden = false;
    this.sourceRow.style.display = "inline-flex";
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.sourceRow.hidden = true;
    this.sourceRow.style.display = "none";
  }

  stopEvent() {
    return false;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.requestVersion += 1;
    this.img.removeAttribute("src");
  }

  private syncMeta() {
    const src = typeof this.node.attrs.src === "string" ? this.node.attrs.src : "";
    const alt = typeof this.node.attrs.alt === "string" ? this.node.attrs.alt : "";
    const title = typeof this.node.attrs.title === "string" ? this.node.attrs.title : "";
    const titleSuffix = title ? ` \"${title}\"` : "";

    this.dom.dataset.src = src;
    this.img.alt = alt;
    this.sourceText.textContent = `![${alt}](${src}${titleSuffix})`;

    if (title) {
      this.img.title = title;
    } else {
      this.img.removeAttribute("title");
    }
  }

  private setState(state: "loading" | "loaded" | "error", message = "") {
    if (state === "loaded") {
      this.status.hidden = true;
      this.status.style.display = "none";
      this.spinner.hidden = true;
      this.errorIcon.hidden = true;
      this.statusText.textContent = "";
      this.img.style.opacity = "1";
      return;
    }

    this.status.hidden = false;
    this.status.style.display = "grid";
    this.img.style.opacity = state === "loading" ? "0.35" : "0";
    this.spinner.hidden = state !== "loading";
    this.errorIcon.hidden = state !== "error";
    this.statusText.textContent = message;
  }

  private load() {
    const src = typeof this.node.attrs.src === "string" ? this.node.attrs.src.trim() : "";
    const fallbackMessage = typeof this.node.attrs.alt === "string" && this.node.attrs.alt ? this.node.attrs.alt : "Image failed to load";
    const requestVersion = ++this.requestVersion;

    if (!src) {
      this.img.removeAttribute("src");
      this.setState("error", "Missing image URL");
      return;
    }

    this.setState("loading", "Loading image");

    const startImageLoad = () => {
      if (requestVersion !== this.requestVersion) {
        return;
      }

      this.img.onload = () => {
        if (requestVersion !== this.requestVersion) {
          return;
        }

        if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
          this.setState("loaded");
          return;
        }

        this.setState("error", fallbackMessage);
      };

      this.img.onerror = () => {
        if (requestVersion !== this.requestVersion) {
          return;
        }

        this.setState("error", fallbackMessage);
      };

      this.img.src = src;

      if (this.img.complete && this.img.naturalWidth > 0) {
        this.setState("loaded");
      }
    };

    startImageLoad();
  }
}

function getAncestorInfo(state: EditorState, nodeType: NodeType): AncestorInfo | null {
  const { selection } = state;

  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === nodeType) {
      return {
        depth,
        node: $from.node(depth),
        pos: $from.before(depth),
      };
    }
  }

  return null;
}

function isOnPrimaryListLine(state: EditorState) {
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === schema.nodes.list_item) {
      return $from.index(depth) === 0;
    }
  }

  return false;
}

function getActiveListItemInfo(state: EditorState): ActiveListItemInfo | null {
  const { selection } = state;

  if (!selection.empty || !isOnPrimaryListLine(state)) {
    return null;
  }

  const { $from } = selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === schema.nodes.list_item) {
      return {
        from: $from.before(depth),
        to: $from.after(depth),
      };
    }
  }

  return null;
}

function getOrderedListMarker(listNode: ProseMirrorNode, listDepth: number, state: EditorState) {
  const { $from } = state.selection;
  const listItemDepth = listDepth + 1;

  if (listItemDepth > $from.depth || $from.node(listItemDepth).type !== schema.nodes.list_item) {
    return null;
  }

  const itemIndex = $from.index(listDepth);
  const order = typeof listNode.attrs.order === "number" ? listNode.attrs.order : 1;
  return `${order + itemIndex}. `;
}

function getActiveLineMarker(state: EditorState): ActiveLineMarker | null {
  const { selection } = state;

  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  const parent = $from.parent;
  const pos = $from.start();

  if (parent.type === schema.nodes.heading) {
    const level = parent.attrs.level;

    if (typeof level === "number" && level >= 1 && level <= 6) {
      return {
        pos,
        marker: `${"#".repeat(level)} `,
        className: "mdw-marker-heading",
      };
    }
  }

  const blockquote = getAncestorInfo(state, schema.nodes.blockquote);

  if (blockquote) {
    return {
      pos,
      marker: "> ",
      className: "mdw-marker-blockquote",
    };
  }

  return null;
}

function updateHeadingLevel(view: EditorView, nextLevel: number | null) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  const parent = $from.parent;

  if (parent.type !== schema.nodes.heading || $from.parentOffset !== 0) {
    return false;
  }

  const pos = $from.before();
  const tr = state.tr;

  if (nextLevel === null) {
    tr.setNodeMarkup(pos, schema.nodes.paragraph);
  } else {
    tr.setNodeMarkup(pos, schema.nodes.heading, { level: nextLevel });
  }

  tr.setSelection(TextSelection.create(tr.doc, tr.selection.from));
  view.dispatch(tr);
  return true;
}

function getTableCellContext(state: EditorState): TableCellInfo | null {
  const { selection } = state;
  const { $from } = selection;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);

    if (cellDepth < 0 && (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header)) {
      cellDepth = depth;
      continue;
    }

    if (rowDepth < 0 && node.type === schema.nodes.table_row) {
      rowDepth = depth;
      continue;
    }

    if (tableDepth < 0 && node.type === schema.nodes.table) {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
    return null;
  }

  return {
    table: $from.node(tableDepth),
    row: $from.node(rowDepth),
    cell: $from.node(cellDepth),
    tablePos: $from.before(tableDepth),
    rowPos: $from.before(rowDepth),
    cellPos: $from.before(cellDepth),
    rowIndex: $from.index(tableDepth),
    cellIndex: $from.index(rowDepth),
  };
}

function getTableCellInfo(state: EditorState): TableCellInfo | null {
  if (!state.selection.empty) {
    return null;
  }

  return getTableCellContext(state);
}

type CodeBlockInfo = {
  node: ProseMirrorNode;
  pos: number;
  textStart: number;
  textEnd: number;
};

function createCodeBlockInfo(node: ProseMirrorNode, pos: number): CodeBlockInfo {
  return {
    node,
    pos,
    textStart: pos + 1,
    textEnd: pos + node.nodeSize - 1,
  };
}

function getCodeBlockInfoAtPos(state: EditorState, pos: number): CodeBlockInfo | null {
  const $pos = state.doc.resolve(pos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (node.type === schema.nodes.code_block) {
      return createCodeBlockInfo(node, $pos.before(depth));
    }
  }

  const nodeBefore = $pos.nodeBefore;

  if (nodeBefore?.type === schema.nodes.code_block) {
    return createCodeBlockInfo(nodeBefore, pos - nodeBefore.nodeSize);
  }

  const nodeAfter = $pos.nodeAfter;

  if (nodeAfter?.type === schema.nodes.code_block) {
    return createCodeBlockInfo(nodeAfter, pos);
  }

  return null;
}

function getAdjacentCodeBlockForVerticalSelection(view: EditorView, direction: -1 | 1): CodeBlockInfo | null {
  const { selection, doc } = view.state;

  if (!(selection instanceof TextSelection)) {
    return null;
  }

  const { $head } = selection;

  if (!$head.parent.isTextblock) {
    return null;
  }

  const endOfTextblock = view.endOfTextblock(direction < 0 ? "up" : "down");

  if (!endOfTextblock) {
    return null;
  }

  const boundaryPos = direction < 0 ? $head.before() : $head.after();
  const $boundary = doc.resolve(boundaryPos);
  const adjacentNode = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;

  if (adjacentNode?.type !== schema.nodes.code_block) {
    return null;
  }

  const adjacentPos = direction < 0 ? boundaryPos - adjacentNode.nodeSize : boundaryPos;
  return createCodeBlockInfo(adjacentNode, adjacentPos);
}

function getCodeBlockLineInfo(codeBlock: CodeBlockInfo, pos: number) {
  const offset = Math.max(0, Math.min(codeBlock.node.textContent.length, pos - codeBlock.textStart));
  const lines = codeBlock.node.textContent.split("\n");
  let consumed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineLength = lines[index].length;
    const lineStart = consumed;
    const lineEnd = consumed + lineLength;

    if (offset <= lineEnd || index === lines.length - 1) {
      return {
        lineNumber: index + 1,
        lineCount: lines.length,
        isFirstLine: index === 0,
        isLastLine: index === lines.length - 1,
      };
    }

    consumed = lineEnd + 1;
  }

  return {
    lineNumber: lines.length,
    lineCount: lines.length,
    isFirstLine: true,
    isLastLine: true,
  };
}

function maybeExtendSelectionAcrossCodeBlock(view: EditorView, direction: -1 | 1) {
  const { selection, doc } = view.state;

  if (!(selection instanceof TextSelection)) {
    return false;
  }

  const directCodeBlock = getCodeBlockInfoAtPos(view.state, selection.head);
  const headInsideCodeBlock = !!directCodeBlock && selection.head >= directCodeBlock.textStart && selection.head <= directCodeBlock.textEnd;
  const adjacentCodeBlock = headInsideCodeBlock ? null : getAdjacentCodeBlockForVerticalSelection(view, direction);
  const codeBlock = headInsideCodeBlock ? directCodeBlock : adjacentCodeBlock;

  if (!codeBlock) {
    return false;
  }

  const lineInfo = headInsideCodeBlock ? getCodeBlockLineInfo(codeBlock, selection.head) : null;

  if (headInsideCodeBlock && direction < 0 && !lineInfo!.isFirstLine) {
    return false;
  }

  if (headInsideCodeBlock && direction > 0 && !lineInfo!.isLastLine) {
    return false;
  }

  const boundaryPos = direction < 0 ? codeBlock.pos : codeBlock.pos + codeBlock.node.nodeSize;
  const outerSelection = Selection.findFrom(doc.resolve(boundaryPos), direction, true);
  const fallbackOuterHead = direction < 0 ? codeBlock.textStart : codeBlock.textEnd;

  if (!outerSelection) {
    if ((direction < 0 && boundaryPos === codeBlock.pos) || (direction > 0 && boundaryPos === codeBlock.pos + codeBlock.node.nodeSize)) {
      const tr = view.state.tr.setSelection(TextSelection.create(doc, selection.anchor, fallbackOuterHead));
      view.dispatch(tr.scrollIntoView());
      view.focus();
      return true;
    }

    return false;
  }

  const tr = view.state.tr.setSelection(TextSelection.create(doc, selection.anchor, outerSelection.head));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function isManagedBlockNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return isManagedBlockNodeFromSchema(schema, node);
}

function findTextSelectionInsideNode(
  doc: ProseMirrorNode,
  nodePos: number,
  node: ProseMirrorNode,
  direction: -1 | 1,
) {
  const searchPos = direction < 0 ? nodePos + node.nodeSize - 1 : nodePos + 1;
  const selection = Selection.findFrom(doc.resolve(searchPos), direction, true);

  if (!selection) {
    return null;
  }

  const from = nodePos;
  const to = nodePos + node.nodeSize;
  return selection.from >= from && selection.to <= to ? selection : null;
}

function findTextSelectionInImmediatePreviousNode(doc: ProseMirrorNode, boundaryPos: number) {
  const $boundary = doc.resolve(boundaryPos);
  const previousNode = $boundary.nodeBefore;

  if (!previousNode) {
    return null;
  }

  const previousNodePos = boundaryPos - previousNode.nodeSize;

  if (previousNode.isTextblock) {
    return TextSelection.create(doc, previousNodePos + previousNode.nodeSize - 1);
  }

  const selection = Selection.findFrom(doc.resolve(boundaryPos), -1, true);

  if (!selection) {
    return null;
  }

  return selection.from >= previousNodePos && selection.to <= boundaryPos ? selection : null;
}

const {
  setManagedBlockBoundarySelection,
  moveBeforeManagedBlock,
  moveInsideManagedBlock,
  insertParagraphAtManagedBlockBoundary,
  removeManagedBlockAtBoundary,
  getManagedBlockBoundary,
  getTableBoundaryEscapeInfo,
} = createManagedBlockBoundaryHelpers({
  schema,
  isManagedBlockNode,
  findTextSelectionInsideNode,
  findTextSelectionInImmediatePreviousNode,
  getTableCellInfo,
});

const CodeBlockView = createCodeBlockViewClass({
  schema,
  moveBeforeManagedBlock,
  setManagedBlockBoundarySelection,
});

const {
  createEmptyTableRow,
  appendTableRow,
  appendTableColumn,
  removeTableRow,
  removeTableColumn,
  setTableColumnAlignment,
  removeActiveTable,
  moveTableCellVertical,
  moveTableCell,
} = createTableNavigation({
  schema,
  getTableCellContext,
  normalizeTableAlignment,
  moveBeforeManagedBlock,
  moveAfterManagedBlock: (view, blockPos) => setManagedBlockBoundarySelection(view, blockPos, "after"),
});

function parsePipeTableRow(text: string) {
  const trimmed = text.trim();

  if (!trimmed.includes("|")) {
    return null;
  }

  const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escapeNext = false;
  let backtickFenceLength = 0;
  let index = 0;

  while (index < normalized.length) {
    const char = normalized[index];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      index += 1;
      continue;
    }

    if (char === "\\") {
      current += char;
      escapeNext = true;
      index += 1;
      continue;
    }

    if (char === "`") {
      let fenceLength = 1;

      while (normalized[index + fenceLength] === "`") {
        fenceLength += 1;
      }

      current += "`".repeat(fenceLength);

      if (backtickFenceLength === 0) {
        backtickFenceLength = fenceLength;
      } else if (backtickFenceLength === fenceLength) {
        backtickFenceLength = 0;
      }

      index += fenceLength;
      continue;
    }

    if (char === "|" && backtickFenceLength === 0) {
      cells.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  cells.push(current.trim());

  return cells.length >= 2 ? cells : null;
}

function isPipeTableDividerCell(text: string) {
  return /^:?-{3,}:?$/.test(text.trim());
}

function parsePipeTableDivider(text: string) {
  const cells = parsePipeTableRow(text);

  if (!cells || cells.some((cell) => !isPipeTableDividerCell(cell))) {
    return null;
  }

  return cells.map((cell) => {
    const trimmed = cell.trim();

    if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
      return "center" as TableAlignment;
    }

    if (trimmed.startsWith(":")) {
      return "left" as TableAlignment;
    }

    if (trimmed.endsWith(":")) {
      return "right" as TableAlignment;
    }

    return null;
  });
}

function createTableNodeFromMarkdownRows(headerCells: string[], alignments: (TableAlignment | null)[]) {
  const columnCount = alignments.length;
  const normalizedHeaderCells =
    headerCells.length === columnCount ? headerCells : Array.from({ length: columnCount }, () => "");

  const headerRow = schema.nodes.table_row.create(
    null,
    normalizedHeaderCells.map((cellText, index) =>
      schema.nodes.table_header.create(
        { align: alignments[index] ?? null },
        createTableCellContentFromMarkdown(cellText),
      ),
    ),
  );

  const bodyRow = createEmptyTableRow(columnCount, alignments);

  return { table: schema.nodes.table.create(null, [headerRow, bodyRow]), headerRow };
}

function convertPipeTable(view: EditorView) {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;

  if ($from.parent.type !== schema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size || $from.depth < 1) {
    return false;
  }

  const alignments = parsePipeTableDivider($from.parent.textContent);

  if (!alignments) {
    return false;
  }

  const columnCount = alignments.length;

  const containerDepth = $from.depth - 1;
  const container = $from.node(containerDepth);
  const index = $from.index(containerDepth);

  let from = $from.before();
  let headerCells = Array.from({ length: columnCount }, () => "");

  if (index > 0) {
    const previousNode = container.child(index - 1);

    if (previousNode.type === schema.nodes.paragraph) {
      const parsedHeaderCells = parsePipeTableRow(previousNode.textContent);

      if (parsedHeaderCells && parsedHeaderCells.length === columnCount) {
        headerCells = parsedHeaderCells;
        from -= previousNode.nodeSize;
      }
    }
  }

  const to = $from.after();
  const { table, headerRow } = createTableNodeFromMarkdownRows(headerCells, alignments);
  const tr = state.tr.replaceWith(from, to, [table]);
  const bodyCellTextPos = from + 1 + headerRow.nodeSize + 3;
  tr.setSelection(TextSelection.create(tr.doc, bodyCellTextPos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function createHeadingEditingPlugin() {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "#") {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        const { $from } = selection;
        const parent = $from.parent;

        if (
          !selection.empty ||
          from !== to ||
          parent.type !== schema.nodes.heading ||
          $from.parentOffset !== 0
        ) {
          return false;
        }

        const currentLevel = parent.attrs.level;

        if (typeof currentLevel !== "number") {
          return false;
        }

        if (currentLevel >= 6) {
          return false;
        }

        return updateHeadingLevel(view, currentLevel + 1);
      },
      handleKeyDown(view, event) {
        if (event.key === "Enter" && convertPipeTable(view)) {
          return true;
        }

        if (event.key !== "Backspace") {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        const { $from } = selection;
        const parent = $from.parent;

        if (!selection.empty || parent.type !== schema.nodes.heading || $from.parentOffset !== 0) {
          return false;
        }

        event.preventDefault();

        const currentLevel = parent.attrs.level;

        if (typeof currentLevel !== "number") {
          return true;
        }

        if (currentLevel <= 1) {
          return updateHeadingLevel(view, null);
        }

        return updateHeadingLevel(view, currentLevel - 1);
      },
    },
  });
}

function createMarkBoundaryPlugin(
  linkEditor: LinkEditorOverlay,
  imageEditor: ImageEditorOverlay,
  tableToolbar: TableToolbarOverlay,
) {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Enter" && convertFenceToCodeBlock(view)) {
          return true;
        }

        if (event.shiftKey && event.key === "ArrowUp" && maybeExtendSelectionAcrossCodeBlock(view, -1)) {
          return true;
        }

        if (event.shiftKey && event.key === "ArrowDown" && maybeExtendSelectionAcrossCodeBlock(view, 1)) {
          return true;
        }

        if (event.key === "ArrowLeft") {
          return escapeBoundaryMark(view, "left");
        }

        if (event.key === "ArrowRight") {
          return escapeBoundaryMark(view, "right");
        }

        return false;
      },
      handleClick(view, pos, event) {
        return (
          maybeToggleTaskListItem(view, pos, event) ||
          maybeOpenImage(event) ||
          maybeOpenLink(view, event) ||
          maybeEditActiveImage(view, event, imageEditor) ||
          maybeEditActiveLink(view, event, linkEditor)
        );
      },
    },
    view(editorView) {
      tableToolbar.update(editorView);

      return {
        update(updatedView) {
          if (!getMarkInfo(updatedView.state, "link")) {
            linkEditor.close(false);
          }

          if (!getActiveImageInfo(updatedView.state)) {
            imageEditor.close(false);
          }

          tableToolbar.update(updatedView);
        },
        destroy() {
          linkEditor.close(false);
          imageEditor.close(false);
          tableToolbar.destroy();
        },
      };
    },
  });
}

function createMarker(className: string, text: string) {
  const marker = document.createElement("span");
  marker.className = `mdw-marker ${className}`;
  marker.textContent = text;
  return marker;
}

function createCodeBlockOuterSelectionPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const { selection, doc } = state;

        if (selection.empty) {
          return null;
        }

        const decorations: Decoration[] = [];

        doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.code_block) {
            return true;
          }

          const codeStart = pos + 1;
          const codeEnd = pos + node.nodeSize - 1;
          const selectionInside = selection.from >= codeStart && selection.to <= codeEnd;
          const selectionOverlaps = selection.from <= codeEnd && selection.to >= codeStart;

          if (selectionOverlaps && !selectionInside) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: "mdw-code-block-outer-selection",
              }),
            );
          }

          return true;
        });

        return decorations.length > 0 ? DecorationSet.create(doc, decorations) : null;
      },
    },
  });
}

function createMarkdownRevealPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations = [];

        for (const config of revealMarkConfigs) {
          const markInfo = getMarkInfo(state, config.markName);

          if (!markInfo || isEscapedOutsideBoundary(state, config.markName, markInfo)) {
            continue;
          }

          const markers = config.getMarkers(markInfo);

          decorations.push(
            Decoration.widget(
              markInfo.start,
              () => createMarker(`mdw-marker-${config.markName} mdw-marker-${config.markName}-start`, markers.start),
              { side: -1 },
            ),
          );
          decorations.push(
            Decoration.widget(
              markInfo.end,
              () => createMarker(`mdw-marker-${config.markName} mdw-marker-${config.markName}-end`, markers.end),
              { side: 1 },
            ),
          );
        }

        const activeListItem = getActiveListItemInfo(state);

        if (activeListItem) {
          decorations.push(
            Decoration.node(activeListItem.from, activeListItem.to, {
              class: "mdw-active-list-item",
            }),
          );
        }

        const activeLineMarker = getActiveLineMarker(state);

        if (activeLineMarker) {
          decorations.push(
            Decoration.widget(
              activeLineMarker.pos,
              () => createMarker(activeLineMarker.className, activeLineMarker.marker),
              { side: -1 },
            ),
          );
        }

        return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
      },
    },
  });
}

export function createEditor(options: CreateEditorOptions): MarkdownEditor {
  const { element, markdown = "", onChange, onChangeMode = "immediate", onTransaction } = options;

  const doc = parseMarkdown(markdown);

  if (!doc) {
    throw new Error("Failed to create an empty ProseMirror document.");
  }

  element.classList.add("mdw-host");

  const listItemType = schema.nodes.list_item;
  const commands = {
    toggleBold: toggleMark(schema.marks.strong),
    toggleItalic: toggleMark(schema.marks.em),
    toggleCode: toggleMark(schema.marks.code),
    toggleStrike: toggleMark(schema.marks.strike),
    undo,
    redo,
  } satisfies Record<string, EditorCommand>;
  const linkEditor = createLinkEditorOverlay({ updateLinkHref, removeActiveLink });
  const imageEditor = createImageEditorOverlay({ updateActiveImage, removeActiveImage });
  let ephemeralOverlayAnchor: HTMLElement | null = null;

  const clearEphemeralOverlayAnchor = () => {
    ephemeralOverlayAnchor?.remove();
    ephemeralOverlayAnchor = null;
  };

  const createSelectionOverlayAnchor = () => {
    clearEphemeralOverlayAnchor();
    const coords = view.coordsAtPos(view.state.selection.from);
    const anchor = document.createElement("span");
    anchor.setAttribute("aria-hidden", "true");
    anchor.style.position = "absolute";
    anchor.style.left = `${coords.left + window.scrollX}px`;
    anchor.style.top = `${coords.bottom + window.scrollY}px`;
    anchor.style.width = "0";
    anchor.style.height = "0";
    anchor.style.pointerEvents = "none";
    document.body.append(anchor);
    ephemeralOverlayAnchor = anchor;
    return anchor;
  };
  const tableToolbar = createTableToolbarOverlay({
    appendTableColumn,
    appendTableRow,
    removeTableColumn,
    removeTableRow,
    setTableColumnAlignment,
    removeActiveTable,
    getTableContext: getTableCellContext,
    normalizeTableAlignment,
  });

  const plugins = [
    createTypingShortcuts(),
    createHeadingEditingPlugin(),
    createHorizontalRulePlugin(),
    createImagePlugin(),
    createEscapedBoundaryPlugin(),
    createManagedBlockBoundaryPlugin({
      isManagedBlockNode,
      getTableBoundaryEscapeInfo,
      moveBeforeManagedBlock,
      setManagedBlockBoundarySelection,
      getManagedBlockBoundary,
      moveInsideManagedBlock,
      insertParagraphAtManagedBlockBoundary,
      removeManagedBlockAtBoundary,
    }),
    createMarkBoundaryPlugin(linkEditor, imageEditor, tableToolbar),
    createCodeBlockOuterSelectionPlugin(),
    createMarkdownRevealPlugin(),
    history(),
    keymap({
      Enter: chainCommands(splitListItem(listItemType), liftEmptyBlock),
      "Shift-Enter": insertHardBreak,
      Tab: (state, dispatch, view) => moveTableCell(view!, 1) || sinkListItem(listItemType)(state, dispatch, view),
      "Shift-Tab": (state, dispatch, view) => moveTableCell(view!, -1) || liftListItem(listItemType)(state, dispatch, view),
      ArrowUp: (_state, _dispatch, view) => moveTableCellVertical(view!, -1),
      ArrowDown: (_state, _dispatch, view) => moveTableCellVertical(view!, 1),
      "Mod-b": commands.toggleBold,
      "Mod-i": commands.toggleItalic,
      "Mod-e": commands.toggleCode,
      "Mod-Shift-x": commands.toggleStrike,
      "Mod-z": commands.undo,
      "Shift-Mod-z": commands.redo,
      "Mod-y": commands.redo,
    }),
    keymap(baseKeymap),
  ];

  let view: EditorView;
  let lastSerializedDoc = doc;
  let lastSerializedMarkdown = markdownSerializer.serialize(doc);
  let pendingChangeFrame: number | null = null;
  let pendingChangeDoc: ProseMirrorNode | null = null;

  const serializeDoc = (targetDoc: ProseMirrorNode) => {
    if (targetDoc === lastSerializedDoc) {
      return lastSerializedMarkdown;
    }

    lastSerializedMarkdown = markdownSerializer.serialize(targetDoc);
    lastSerializedDoc = targetDoc;
    return lastSerializedMarkdown;
  };

  const emitChange = (targetDoc: ProseMirrorNode) => {
    pendingChangeDoc = null;
    onChange?.(serializeDoc(targetDoc));
  };

  const flushPendingChange = () => {
    if (pendingChangeFrame !== null) {
      cancelAnimationFrame(pendingChangeFrame);
      pendingChangeFrame = null;
    }

    if (pendingChangeDoc) {
      emitChange(pendingChangeDoc);
    }
  };

  const scheduleChange = (targetDoc: ProseMirrorNode) => {
    if (!onChange) {
      return;
    }

    if (onChangeMode === "immediate") {
      emitChange(targetDoc);
      return;
    }

    pendingChangeDoc = targetDoc;

    if (pendingChangeFrame !== null) {
      return;
    }

    pendingChangeFrame = requestAnimationFrame(() => {
      pendingChangeFrame = null;

      if (pendingChangeDoc) {
        emitChange(pendingChangeDoc);
      }
    });
  };

  const runCommand = (command: EditorCommand) => {
    const handled = command(view.state, view.dispatch, view);

    if (handled) {
      view.focus();
    }

    return handled;
  };

  const getToolbarState = (): ToolbarState => ({
    bold: getToolbarMarkState(view.state, "strong", schema.marks.strong, commands.toggleBold),
    italic: getToolbarMarkState(view.state, "em", schema.marks.em, commands.toggleItalic),
    code: getToolbarMarkState(view.state, "code", schema.marks.code, commands.toggleCode),
    strike: getToolbarMarkState(view.state, "strike", schema.marks.strike, commands.toggleStrike),
    link: getLinkToolbarState(view.state),
    image: getImageToolbarState(view.state),
    undo: { enabled: commands.undo(view.state) },
    redo: { enabled: commands.redo(view.state) },
  });

  const state = EditorState.create({
    doc,
    plugins,
  });

  view = new EditorView(element, {
    state,
    nodeViews: {
      code_block(node, view, getPos) {
        return new CodeBlockView(node, view, getPos as () => number);
      },
      image(node) {
        return new ImageView(node);
      },
    },
    dispatchTransaction(transaction) {
      const nextState = view.state.apply(transaction);
      view.updateState(nextState);
      onTransaction?.(transaction, view);

      if (transaction.docChanged) {
        scheduleChange(nextState.doc);
      }
    },
  });

  return {
    view,
    getMarkdown() {
      return serializeDoc(view.state.doc);
    },
    setMarkdown(nextMarkdown: string, setOptions?: { emitChange?: boolean }) {
      const nextDoc = parseMarkdown(nextMarkdown);

      if (!nextDoc) {
        throw new Error("Failed to parse Markdown into a ProseMirror document.");
      }

      const nextState = EditorState.create({
        doc: nextDoc,
        plugins,
      });

      view.updateState(nextState);
      lastSerializedDoc = nextDoc;
      lastSerializedMarkdown = markdownSerializer.serialize(nextDoc);

      if (setOptions?.emitChange) {
        scheduleChange(nextState.doc);
      }
    },
    flushChange() {
      flushPendingChange();
    },
    getToolbarState,
    toggleBold() {
      return runCommand(commands.toggleBold);
    },
    toggleItalic() {
      return runCommand(commands.toggleItalic);
    },
    toggleCode() {
      return runCommand(commands.toggleCode);
    },
    toggleStrike() {
      return runCommand(commands.toggleStrike);
    },
    setLink(href: string) {
      const handled = setLink(view, href);

      if (handled) {
        clearEphemeralOverlayAnchor();
        view.focus();
      }

      return handled;
    },
    insertImage(attrs: { src: string; alt?: string | null; title?: string | null }) {
      const handled = insertImage(view, attrs);

      if (handled) {
        clearEphemeralOverlayAnchor();
        view.focus();
      }

      return handled;
    },
    editLink() {
      const markInfo = getMarkInfo(view.state, "link");

      if (!markInfo || isEscapedOutsideBoundary(view.state, "link", markInfo)) {
        return false;
      }

      const currentHref = typeof markInfo.attrs?.href === "string" ? markInfo.attrs.href : "";
      linkEditor.open(view, createSelectionOverlayAnchor(), currentHref);
      return true;
    },
    removeLink() {
      return removeActiveLink(view);
    },
    editImage() {
      const imageInfo = getActiveImageInfo(view.state);

      if (!imageInfo) {
        return false;
      }

      const marker = view.nodeDOM(imageInfo.pos);

      if (!(marker instanceof HTMLElement)) {
        return false;
      }

      clearEphemeralOverlayAnchor();
      imageEditor.open(view, marker, imageInfo);
      return true;
    },
    removeImage() {
      return removeActiveImage(view);
    },
    undo() {
      return runCommand(commands.undo);
    },
    redo() {
      return runCommand(commands.redo);
    },
    destroy() {
      flushPendingChange();
      clearEphemeralOverlayAnchor();
      linkEditor.destroy();
      imageEditor.destroy();
      view.destroy();
    },
  };
}
