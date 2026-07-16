import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { Fragment, Schema, Slice, type Mark, type MarkSpec, type Node as ProseMirrorNode, type NodeSpec } from "prosemirror-model";
import {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as baseSchema,
  type ParseSpec,
} from "prosemirror-markdown";
import { Plugin } from "prosemirror-state";
import {
  MarkdownEditorExtensionError,
  isValidMarkdownEditorLocalId,
} from "./extensionApi";
import type { ResolvedMarkdownEditorExtension } from "./extensionResolver";
import {
  compileMarkdownEditorParserTokens,
  registerMarkdownEditorTokenizerRules,
  wrapMarkdownEditorExtensionRuntimeCallback,
} from "./markdownContributionCompiler";
import { createReadonlySet } from "./readonlySet";
import {
  compileMarkdownEditorSchemaEntries,
  type MarkdownEditorOrderedSchemaMap,
} from "./schemaContributionOrder";
import {
  configureOpaqueMarkdown,
  createOpaqueMarkdownEnvironment,
  getOpaqueTokenAttrs,
  normalizeOpaqueMarkdownKind,
  type OpaqueMarkdownKind,
} from "./opaqueMarkdown";
import {
  normalizeMarkdownEditorResources,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";
import type { TableAlignment } from "./tableNavigation";

type MarkdownSerializerStateWithInternals = MarkdownSerializerState & {
  closed: { type: ProseMirrorNode["type"] } | null;
  flushClose: (size: number) => void;
  inTightList: boolean;
};

const listItemSpec = baseSchema.spec.nodes.get("list_item");
const codeBlockSpec = baseSchema.spec.nodes.get("code_block");
const headingSpec = baseSchema.spec.nodes.get("heading");
let nextTaskControlId = 0;

function createTaskControlIds() {
  nextTaskControlId += 1;
  return {
    content: `mdw-task-content-${nextTaskControlId}`,
    label: `mdw-task-label-${nextTaskControlId}`,
  };
}

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
          tag: '[data-mdw-task-control="true"]',
          ignore: true,
          priority: 100,
        },
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
          const ids = createTaskControlIds();

          return [
            "li",
            {
              "data-task": "true",
              "data-checked": checked ? "true" : "false",
            },
            [
              "button",
              {
                "aria-checked": checked ? "true" : "false",
                "aria-disabled": "false",
                "aria-labelledby": `${ids.label} ${ids.content}`,
                "class": "mdw-task-checkbox",
                "contenteditable": "false",
                "data-mdw-task-control": "true",
                "role": "checkbox",
                "tabindex": "0",
                "type": "button",
              },
              [
                "span",
                {
                  "class": "mdw-task-checkbox-state",
                  "hidden": "",
                  "id": ids.label,
                },
                "Task:",
              ],
            ],
            [
              "div",
              {
                "class": "mdw-task-content",
                "id": ids.content,
              },
              0,
            ],
          ] as const;
        }

        return ["li", 0] as const;
      },
    }
  : undefined;

function isHTMLElementNode(dom: Node | string): dom is HTMLElement {
  // ProseMirror parses external clipboard HTML in a detached HTML document,
  // whose defaultView is null. Tag-specific parse rules still receive real
  // HTML elements there, so use their stable DOM shape rather than a realm
  // constructor that is unavailable for that document.
  return typeof dom !== "string"
    && dom.nodeType === 1
    && typeof (dom as HTMLElement).getAttribute === "function";
}

function getOpaqueDOMAttrs(dom: Node | string, fallback: OpaqueMarkdownKind) {
  if (!isHTMLElementNode(dom)) {
    return false;
  }

  return {
    kind: normalizeOpaqueMarkdownKind(dom.getAttribute("data-markora-opaque-kind"), fallback),
    source: dom.textContent ?? "",
  };
}

function getOpaqueDOMAttributes(kind: OpaqueMarkdownKind, display: "block" | "inline") {
  return {
    "aria-label": `Opaque ${kind} Markdown source`,
    "class": `mdw-opaque-source mdw-opaque-source-${display}`,
    "contenteditable": "false",
    "data-markora-opaque": display,
    "data-markora-opaque-kind": kind,
  };
}

const rawBlockSpec: NodeSpec = {
  attrs: {
    kind: { default: "unknown-fence" },
    source: { default: "" },
  },
  atom: true,
  createGapCursor: true,
  defining: true,
  draggable: true,
  group: "block",
  isolating: true,
  leafText(node) {
    return typeof node.attrs.source === "string" ? node.attrs.source : "";
  },
  parseDOM: [{
    tag: '[data-markora-opaque="block"]',
    priority: 60,
    preserveWhitespace: "full",
    getAttrs(dom) {
      return getOpaqueDOMAttrs(dom, "unknown-fence");
    },
  }],
  selectable: true,
  toDOM(node) {
    const kind = normalizeOpaqueMarkdownKind(node.attrs.kind, "unknown-fence");
    const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
    return ["pre", getOpaqueDOMAttributes(kind, "block"), ["code", source]] as const;
  },
};

const rawInlineSpec: NodeSpec = {
  attrs: {
    kind: { default: "inline-html" },
    source: { default: "" },
  },
  atom: true,
  draggable: true,
  group: "inline",
  inline: true,
  leafText(node) {
    return typeof node.attrs.source === "string" ? node.attrs.source : "";
  },
  parseDOM: [{
    tag: '[data-markora-opaque="inline"]',
    preserveWhitespace: "full",
    getAttrs(dom) {
      return getOpaqueDOMAttrs(dom, "inline-html");
    },
  }],
  selectable: true,
  toDOM(node) {
    const kind = normalizeOpaqueMarkdownKind(node.attrs.kind, "inline-html");
    const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
    return ["span", getOpaqueDOMAttributes(kind, "inline"), ["code", source]] as const;
  },
};

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

function normalizeTableHeaderScope(value: unknown): "col" | "row" | null {
  return value === "col" || value === "row" ? value : null;
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

function getTableHeaderParseDOMAttrs(dom: Node | string) {
  return {
    ...getTableCellParseDOMAttrs(dom),
    scope: isHTMLElementNode(dom) ? normalizeTableHeaderScope(dom.getAttribute("scope")) : null,
  };
}

function getTableCellTokenAttrs(token: { attrGet?: (name: string) => string | null }) {
  const align = readTableAlignmentFromString(token.attrGet?.("align") ?? token.attrGet?.("style") ?? undefined);
  return { align };
}

function getTableHeaderTokenAttrs(token: { attrGet?: (name: string) => string | null }) {
  return { ...getTableCellTokenAttrs(token), scope: "col" };
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
      scope: { default: null },
    },
    content: "block+",
    isolating: true,
    parseDOM: [{ tag: "th", getAttrs: getTableHeaderParseDOMAttrs }],
    toDOM(node: ProseMirrorNode) {
      const scope = normalizeTableHeaderScope(node.attrs.scope);
      return ["th", { ...getTableCellDOMAttrs(node), ...(scope ? { scope } : {}) }, 0] as const;
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
  .update("heading", headingSpec ? { ...headingSpec, content: "(text | image | raw_inline)*" } : headingSpec!)
  .addBefore("image", "raw_inline", rawInlineSpec)
  .addToEnd("raw_block", rawBlockSpec)
  .addToEnd("table", tableNodeSpecs.table)
  .addToEnd("table_row", tableNodeSpecs.table_row)
  .addToEnd("table_cell", tableNodeSpecs.table_cell)
  .addToEnd("table_header", tableNodeSpecs.table_header);

function extensionCodecError(options: {
  code?: string;
  phase: "schema" | "tokenizer" | "codec" | "parse" | "serialize";
  message: string;
  extension?: string;
  contribution?: string;
  participants?: readonly string[];
  cause?: unknown;
}): never {
  throw new MarkdownEditorExtensionError({
    code: options.code ?? "EXTENSION_CONTRIBUTION_CONFLICT",
    ...options,
  });
}

const compatibilityTokenizerFoundationAnchors = [
  { id: "@markora/table/table", phase: "block", markdownItName: "table" },
  {
    id: "@markora/opaque/directive",
    phase: "block",
    markdownItName: "markora_directive_container",
  },
  { id: "@markora/foundation/block/fence", phase: "block", markdownItName: "fence" },
  {
    id: "@markora/foundation/block/paragraph",
    phase: "block",
    markdownItName: "paragraph",
  },
  { id: "@markora/foundation/inline/text", phase: "inline", markdownItName: "text" },
  {
    id: "@markora/foundation/inline/emphasis",
    phase: "inline",
    markdownItName: "emphasis",
  },
  { id: "@markora/foundation/core/inline", phase: "core", markdownItName: "inline" },
] as const;

function qualifyMarkdownToken(extensionName: string, localId: string) {
  const suffix = localId.match(/_(open|close)$/)?.[0] ?? "";
  const root = suffix ? localId.slice(0, -suffix.length) : localId;

  if (!isValidMarkdownEditorLocalId(root)) {
    extensionCodecError({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "tokenizer",
      message: `Markdown token local ID "${localId}" is invalid.`,
      extension: extensionName,
      contribution: localId,
    });
  }

  return `${extensionName}/${root}${suffix}`;
}

export type MarkdownEditorCodec = Readonly<{
  schema: Schema;
  tokenizer: MarkdownIt;
  parser: MarkdownParser;
  serializer: MarkdownSerializer;
  parse(markdown: string): ProseMirrorNode | null;
  serialize(doc: ProseMirrorNode): string;
  createImportedContentSanitizerPlugin(): Plugin;
  createTableCellContentFromMarkdown(text: string): Fragment;
  managedBlocks: ReadonlySet<string>;
}>;

/** Build the current Markora Markdown dialect as one isolated codec graph. */
export function createCompatibilityMarkdownCodec(
  resolvedExtensions: readonly ResolvedMarkdownEditorExtension[] = [],
  resources: NormalizedMarkdownEditorResources = normalizeMarkdownEditorResources(undefined),
): MarkdownEditorCodec {
  const foundationNodes = schemaNodes as MarkdownEditorOrderedSchemaMap<NodeSpec>;
  const foundationMarks = baseSchema.spec.marks.addToEnd(
    "strike",
    strikeMarkSpec,
  ) as MarkdownEditorOrderedSchemaMap<MarkSpec>;
  const nodeEntries = resolvedExtensions.flatMap(({ definition }) => (
    (definition.schema?.nodes ?? []).map((entry) => ({
      owner: definition.name,
      entry,
    }))
  ));
  const markEntries = resolvedExtensions.flatMap(({ definition }) => (
    (definition.schema?.marks ?? []).map((entry) => ({
      owner: definition.name,
      entry,
    }))
  ));
  const nodes = compileMarkdownEditorSchemaEntries({
    foundation: foundationNodes,
    entries: nodeEntries,
    kind: "node",
    missingTargetCode: "EXTENSION_MISSING_DEPENDENCY",
    fail: (failure) => extensionCodecError({ phase: "schema", ...failure }),
  });
  const marks = compileMarkdownEditorSchemaEntries({
    foundation: foundationMarks,
    entries: markEntries,
    kind: "mark",
    missingTargetCode: "EXTENSION_MISSING_DEPENDENCY",
    fail: (failure) => extensionCodecError({ phase: "schema", ...failure }),
  });
  const nodeOwners = new Map<string, string>();
  const markOwners = new Map<string, string>();
  foundationNodes.forEach((name) => nodeOwners.set(name, "@markora/foundation"));
  foundationMarks.forEach((name) => markOwners.set(name, "@markora/foundation"));

  for (const { definition } of resolvedExtensions) {
    for (const entry of definition.schema?.nodes ?? []) {
      nodeOwners.set(entry.name, definition.name);
    }

    for (const entry of definition.schema?.marks ?? []) {
      markOwners.set(entry.name, definition.name);
    }
  }

  const schemaContributors = resolvedExtensions
    .filter(({ definition }) => (
      (definition.schema?.nodes?.length ?? 0) > 0
      || (definition.schema?.marks?.length ?? 0) > 0
    ))
    .map(({ definition }) => definition.name);
  let schema: Schema;

  try {
    schema = new Schema({ nodes, marks });
  } catch (cause) {
    extensionCodecError({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "schema",
      message: "The compiled Markdown editor schema is invalid.",
      ...(schemaContributors.length === 1
        ? { extension: schemaContributors[0] }
        : schemaContributors.length > 1
          ? { participants: schemaContributors }
          : {}),
      cause,
    });
  }
  const managedBlocks = new Set(["code_block", "table", "raw_block"]);

  for (const { definition } of resolvedExtensions) {
    for (const name of definition.schema?.managedBlocks ?? []) {
      const nodeType = schema.nodes[name];

      if (!nodeType || nodeOwners.get(name) !== definition.name || !nodeType.isBlock) {
        extensionCodecError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "schema",
          message: `Managed block "${name}" must be a block node contributed by extension "${definition.name}".`,
          extension: definition.name,
          contribution: name,
        });
      }

      managedBlocks.add(name);
    }
  }

const markdownTokenizer = new MarkdownIt("commonmark", { html: true }).enable("strikethrough").enable("table");
// Markdown-it's built-in allowlist would discard host-approved custom schemes
// before the editor policy can inspect them. Preserve candidate destinations
// here, then enforce the per-editor policy on the parsed ProseMirror document.
markdownTokenizer.validateLink = () => true;
configureOpaqueMarkdown(markdownTokenizer);

// markdown-it emits cell contents as inline tokens, while table cells accept block content.
markdownTokenizer.core.ruler.after("inline", "markora_table_cell_paragraphs", (state) => {
  const tokens = state.tokens;
  const nextTokens: typeof tokens = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const inlineToken = tokens[index];
    const openType = tokens[index - 1]?.type;
    const closeType = tokens[index + 1]?.type;
    const isTableCell =
      (openType === "th_open" && closeType === "th_close") ||
      (openType === "td_open" && closeType === "td_close");

    if (inlineToken?.type !== "inline" || !isTableCell) {
      nextTokens.push(inlineToken);
      continue;
    }

    const paragraphOpen = new state.Token("paragraph_open", "p", 1);
    const paragraphClose = new state.Token("paragraph_close", "p", -1);
    paragraphOpen.level = inlineToken.level;
    paragraphOpen.map = inlineToken.map;
    paragraphClose.level = inlineToken.level;
    inlineToken.level += 1;

    nextTokens.push(paragraphOpen, inlineToken, paragraphClose);
  }

  state.tokens = nextTokens;
});

registerMarkdownEditorTokenizerRules(
  markdownTokenizer,
  resolvedExtensions,
  compatibilityTokenizerFoundationAnchors,
);

const foundationMarkdownTokens: Record<string, ParseSpec> = {
  ...defaultMarkdownParser.tokens,
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: getTableHeaderTokenAttrs },
  td: { block: "table_cell", getAttrs: getTableCellTokenAttrs },
  s: { mark: "strike" },
  html_block: { node: "raw_block", getAttrs: (token: Token) => getOpaqueTokenAttrs(token, "html-block") },
  html_inline: { node: "raw_inline", getAttrs: (token: Token) => getOpaqueTokenAttrs(token, "inline-html") },
  markora_opaque_block: { node: "raw_block", getAttrs: (token: Token) => getOpaqueTokenAttrs(token, "unknown-fence") },
  markora_opaque_inline: { node: "raw_inline", getAttrs: (token: Token) => getOpaqueTokenAttrs(token, "inline-directive") },
};
const markdownTokens = compileMarkdownEditorParserTokens({
  foundationTokens: foundationMarkdownTokens,
  schema,
  extensions: resolvedExtensions,
  qualifyToken: qualifyMarkdownToken,
});
const markdownParser = new MarkdownParser(schema, markdownTokenizer, markdownTokens);

function serializeTableCell(node: ProseMirrorNode) {
  const cellDoc = schema.nodes.doc.create(null, node.content);
  const serialized = markdownSerializer.serialize(cellDoc).trim();

  if (!serialized) {
    return "";
  }

  return serialized
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

const serializerNodes: Record<
  string,
  (typeof defaultMarkdownSerializer.nodes)[string]
> = {
    ...defaultMarkdownSerializer.nodes,
    raw_block(state: MarkdownSerializerState, node: ProseMirrorNode) {
      const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
      state.text(source, false);
      state.closeBlock(node);
    },
    raw_inline(state: MarkdownSerializerState, node: ProseMirrorNode) {
      const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
      state.text(source, false);
    },
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
};
const serializerMarks: Record<
  string,
  (typeof defaultMarkdownSerializer.marks)[string]
> = {
  ...defaultMarkdownSerializer.marks,
  strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
};

for (const { definition } of resolvedExtensions) {
  const nodeSerializers = definition.markdown?.serializer?.nodes ?? {};
  const markSerializers = definition.markdown?.serializer?.marks ?? {};

  for (const [name, serializer] of Object.entries(nodeSerializers)) {
    if (serializerNodes[name] || nodeOwners.get(name) !== definition.name) {
      extensionCodecError({
        phase: "codec",
        message: `Markdown node serializer "${name}" must exclusively own a node contributed by "${definition.name}".`,
        extension: definition.name,
        contribution: name,
      });
    }

    serializerNodes[name] = wrapMarkdownEditorExtensionRuntimeCallback(
      serializer,
      {
        phase: "serialize",
        extension: definition.name,
        contribution: `${definition.name}/${name}`,
      },
    );
  }

  for (const [name, serializer] of Object.entries(markSerializers)) {
    if (serializerMarks[name] || markOwners.get(name) !== definition.name) {
      extensionCodecError({
        phase: "codec",
        message: `Markdown mark serializer "${name}" must exclusively own a mark contributed by "${definition.name}".`,
        extension: definition.name,
        contribution: name,
      });
    }

    serializerMarks[name] = {
      ...serializer,
      open: typeof serializer.open === "function"
        ? wrapMarkdownEditorExtensionRuntimeCallback(serializer.open, {
            phase: "serialize",
            extension: definition.name,
            contribution: `${definition.name}/${name}`,
          })
        : serializer.open,
      close: typeof serializer.close === "function"
        ? wrapMarkdownEditorExtensionRuntimeCallback(serializer.close, {
            phase: "serialize",
            extension: definition.name,
            contribution: `${definition.name}/${name}`,
          })
        : serializer.close,
    };
  }

  for (const entry of definition.schema?.nodes ?? []) {
    if (!serializerNodes[entry.name]) {
      extensionCodecError({
        code: "EXTENSION_INVALID_DEFINITION",
        phase: "codec",
        message: `Persisted schema node "${entry.name}" requires a Markdown serializer.`,
        extension: definition.name,
        contribution: entry.name,
      });
    }
  }

  for (const entry of definition.schema?.marks ?? []) {
    if (!serializerMarks[entry.name]) {
      extensionCodecError({
        code: "EXTENSION_INVALID_DEFINITION",
        phase: "codec",
        message: `Persisted schema mark "${entry.name}" requires a Markdown serializer.`,
        extension: definition.name,
        contribution: entry.name,
      });
    }
  }
}

const markdownSerializer = new MarkdownSerializer(serializerNodes, serializerMarks);

function stripTaskPrefixFromInline(fragment: Fragment, count: number) {
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

  return Fragment.fromArray(children);
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

    const safeHref = sanitizeResourceUrl(
      resources,
      "link",
      typeof mark.attrs.href === "string" ? mark.attrs.href : null,
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
    const safeSrc = sanitizeResourceUrl(
      resources,
      "image",
      typeof node.attrs.src === "string" ? node.attrs.src : null,
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

function parseMarkdown(markdown: string) {
  if (markdown.trim().length === 0) {
    return schema.topNodeType.createAndFill();
  }

  return sanitizeImportedDoc(normalizeTaskListNode(
    markdownParser.parse(markdown, createOpaqueMarkdownEnvironment(markdown)),
  ));
}

function createImportedContentSanitizerPlugin() {
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

  return Object.freeze({
    schema,
    tokenizer: markdownTokenizer,
    parser: markdownParser,
    serializer: markdownSerializer,
    parse: parseMarkdown,
    serialize(doc: ProseMirrorNode) {
      return markdownSerializer.serialize(doc);
    },
    createImportedContentSanitizerPlugin,
    createTableCellContentFromMarkdown,
    managedBlocks: createReadonlySet(managedBlocks),
  });
}

const compatibilityMarkdownCodec = createCompatibilityMarkdownCodec();

/** @deprecated Internal compatibility singleton. Editor runtimes use a codec assembly. */
export const schema = compatibilityMarkdownCodec.schema;
/** @deprecated Internal compatibility singleton. Editor runtimes use a codec assembly. */
export const markdownSerializer = compatibilityMarkdownCodec.serializer;
/** @deprecated Internal compatibility singleton. Editor runtimes use a codec assembly. */
export const parseMarkdown = compatibilityMarkdownCodec.parse;
/** @deprecated Internal compatibility singleton. Editor runtimes use a codec assembly. */
export const createImportedContentSanitizerPlugin =
  compatibilityMarkdownCodec.createImportedContentSanitizerPlugin;
/** @deprecated Internal compatibility singleton. Editor runtimes use a codec assembly. */
export const createTableCellContentFromMarkdown =
  compatibilityMarkdownCodec.createTableCellContentFromMarkdown;
