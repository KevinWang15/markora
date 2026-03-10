import { Fragment as PMFragment } from "prosemirror-model";
import { Fragment, Schema, Slice, type Mark, type Node as ProseMirrorNode } from "prosemirror-model";
import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as baseSchema,
} from "prosemirror-markdown";
import { Plugin } from "prosemirror-state";
import type { TableAlignment } from "./tableNavigation";
import { DEFAULT_IMAGE_PROTOCOLS, DEFAULT_LINK_PROTOCOLS, sanitizeStoredUrl } from "./urlUtils";

type BrowserWindow = Window & typeof globalThis;

type MarkdownSerializerStateWithInternals = MarkdownSerializerState & {
  closed: { type: ProseMirrorNode["type"] } | null;
  flushClose: (size: number) => void;
  inTightList: boolean;
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
            if (!isHTMLElementNode(dom)) {
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

function isHTMLElementNode(dom: Node | string): dom is HTMLElement {
  if (typeof dom === "string") {
    return false;
  }

  const ownerWindow = dom.ownerDocument?.defaultView as BrowserWindow | null;
  return !!ownerWindow && dom instanceof ownerWindow.HTMLElement;
}

export function normalizeTableAlignment(value: unknown): TableAlignment | null {
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
  if (!isHTMLElementNode(dom)) {
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

export const schema: Schema = new Schema({
  nodes: schemaNodes,
  marks: baseSchema.spec.marks.addToEnd("strike", strikeMarkSpec),
});

const markdownTokenizer = defaultMarkdownParser.tokenizer.enable("strikethrough").enable("table");
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

export function createTableCellContentFromMarkdown(text: string) {
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

export const markdownSerializer = new MarkdownSerializer(
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

function sanitizeImportedMarks(marks: readonly Mark[]) {
  let changed = false;
  const nextMarks: Mark[] = [];

  for (const mark of marks) {
    if (mark.type !== schema.marks.link) {
      nextMarks.push(mark);
      continue;
    }

    const safeHref = sanitizeStoredUrl(
      typeof mark.attrs.href === "string" ? mark.attrs.href : null,
      DEFAULT_LINK_PROTOCOLS,
    );

    if (!safeHref) {
      changed = true;
      continue;
    }

    if (safeHref !== mark.attrs.href) {
      changed = true;
      nextMarks.push(mark.type.create({ ...mark.attrs, href: safeHref }));
      continue;
    }

    nextMarks.push(mark);
  }

  return changed ? nextMarks : marks;
}

function sanitizeImportedFragment(fragment: Fragment) {
  const children: ProseMirrorNode[] = [];
  let changed = false;

  fragment.forEach((child) => {
    const nextChild = sanitizeImportedNode(child);

    if (!nextChild) {
      changed = true;
      return;
    }

    if (nextChild !== child) {
      changed = true;
    }

    children.push(nextChild);
  });

  return changed ? Fragment.fromArray(children) : fragment;
}

function sanitizeImportedNode(node: ProseMirrorNode): ProseMirrorNode | null {
  const nextMarks = sanitizeImportedMarks(node.marks);

  if (node.type === schema.nodes.image) {
    const safeSrc = sanitizeStoredUrl(
      typeof node.attrs.src === "string" ? node.attrs.src : null,
      DEFAULT_IMAGE_PROTOCOLS,
    );

    if (!safeSrc) {
      return null;
    }

    if (safeSrc !== node.attrs.src || nextMarks !== node.marks) {
      return node.type.create({ ...node.attrs, src: safeSrc }, null, nextMarks);
    }

    return node;
  }

  if (node.isText) {
    return nextMarks !== node.marks ? node.mark(nextMarks) : node;
  }

  const nextContent = sanitizeImportedFragment(node.content);

  if (nextContent === node.content && nextMarks === node.marks) {
    return node;
  }

  let nextNode = node.copy(nextContent);

  if (nextMarks !== node.marks) {
    nextNode = nextNode.mark(nextMarks);
  }

  return nextNode;
}

function sanitizeImportedDoc(doc: ProseMirrorNode) {
  const nextDoc = sanitizeImportedNode(doc);

  if (nextDoc && nextDoc.childCount > 0) {
    return nextDoc;
  }

  return schema.topNodeType.createAndFill() ?? doc;
}

export function parseMarkdown(markdown: string) {
  if (markdown.trim().length === 0) {
    return schema.topNodeType.createAndFill();
  }

  return sanitizeImportedDoc(normalizeTaskListNode(markdownParser.parse(markdown)));
}

export function createImportedContentSanitizerPlugin() {
  return new Plugin({
    props: {
      transformPasted(slice) {
        const nextContent = sanitizeImportedFragment(slice.content);

        if (nextContent === slice.content) {
          return slice;
        }

        return new Slice(nextContent, slice.openStart, slice.openEnd);
      },
    },
  });
}
