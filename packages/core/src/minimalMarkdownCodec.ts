import MarkdownIt from "markdown-it";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as commonMarkSchema,
  type ParseSpec,
} from "prosemirror-markdown";
import {
  Fragment,
  Schema,
  Slice,
  type Mark,
  type MarkSpec,
  type Node as ProseMirrorNode,
  type NodeSpec,
} from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { codeBlockFenceTokenAttrs, serializeCodeBlock } from "./codeBlockMarkdown";
import {
  MarkdownEditorExtensionError,
  isValidMarkdownEditorLocalId,
} from "./extensionApi";
import type { ResolvedMarkdownEditorExtension } from "./extensionResolver";
import type { MarkdownEditorCodec } from "./markdownCodec";
import {
  compileMarkdownEditorParserTokens,
  registerMarkdownEditorTokenizerRules,
  wrapMarkdownEditorExtensionRuntimeCallback,
} from "./markdownContributionCompiler";
import {
  normalizeMarkdownEditorResources,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";
import { createReadonlySet } from "./readonlySet";
import {
  codeBlockDomAttrs,
  compileMarkdownEditorSchemaEntries,
  type MarkdownEditorOrderedSchemaMap,
} from "./schemaContributionOrder";
import { createMarkdownEditorSourceEnvironment } from "./markdownSource";

const minimalTokenizerFoundationAnchors = [
  { id: "@markora/foundation/block/fence", phase: "block", markdownItName: "fence" },
  {
    id: "@markora/foundation/block/blockquote",
    phase: "block",
    markdownItName: "blockquote",
  },
  { id: "@markora/foundation/block/hr", phase: "block", markdownItName: "hr" },
  {
    id: "@markora/foundation/block/reference",
    phase: "block",
    markdownItName: "reference",
  },
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
  { id: "@markora/foundation/core/block", phase: "core", markdownItName: "block" },
  { id: "@markora/foundation/core/inline", phase: "core", markdownItName: "inline" },
] as const;

function codecError(options: {
  code?: string;
  phase: "schema" | "tokenizer" | "codec";
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

function qualifyToken(owner: string, localId: string) {
  const suffix = localId.match(/_(?:open|close)$/)?.[0] ?? "";
  const root = suffix ? localId.slice(0, -suffix.length) : localId;

  if (!isValidMarkdownEditorLocalId(root)) {
    codecError({
      code: "EXTENSION_INVALID_DEFINITION",
      phase: "tokenizer",
      message: `Markdown token local ID "${localId}" is invalid.`,
      extension: owner,
      contribution: localId,
    });
  }

  return `${owner}/${root}${suffix}`;
}

function sanitizeFragment(
  schema: Schema,
  resources: NormalizedMarkdownEditorResources,
  fragment: Fragment,
): Fragment {
  let changed = false;
  const children: ProseMirrorNode[] = [];

  fragment.forEach((node) => {
    const next = sanitizeNode(schema, resources, node);

    if (!next) {
      changed = true;
      return;
    }

    changed ||= next !== node;
    children.push(next);
  });

  return changed ? Fragment.fromArray(children) : fragment;
}

function sanitizeMarks(
  schema: Schema,
  resources: NormalizedMarkdownEditorResources,
  marks: readonly Mark[],
) {
  const linkType = schema.marks.link;
  let changed = false;
  const next: Mark[] = [];

  for (const mark of marks) {
    if (mark.type !== linkType) {
      next.push(mark);
      continue;
    }

    const href = sanitizeResourceUrl(
      resources,
      "link",
      typeof mark.attrs.href === "string" ? mark.attrs.href : null,
    );

    if (!href) {
      changed = true;
    } else if (href !== mark.attrs.href) {
      changed = true;
      next.push(mark.type.create({ ...mark.attrs, href }));
    } else {
      next.push(mark);
    }
  }

  return changed ? next : marks;
}

function sanitizeNode(
  schema: Schema,
  resources: NormalizedMarkdownEditorResources,
  node: ProseMirrorNode,
): ProseMirrorNode | null {
  const marks = sanitizeMarks(schema, resources, node.marks);

  if (node.type === schema.nodes.image) {
    const src = sanitizeResourceUrl(
      resources,
      "image",
      typeof node.attrs.src === "string" ? node.attrs.src : null,
    );
    return src
      ? src === node.attrs.src && marks === node.marks
        ? node
        : node.type.create({ ...node.attrs, src }, null, marks)
      : null;
  }

  if (node.isText) {
    return marks === node.marks ? node : node.mark(marks);
  }

  const content = sanitizeFragment(schema, resources, node.content);
  let next = content === node.content ? node : node.copy(content);
  if (marks !== node.marks) next = next.mark(marks);
  return next;
}

export function createMinimalMarkdownCodec(
  extensions: readonly ResolvedMarkdownEditorExtension[] = [],
  resources: NormalizedMarkdownEditorResources = normalizeMarkdownEditorResources(undefined),
): MarkdownEditorCodec {
  const baseNodes = commonMarkSchema.spec.nodes as MarkdownEditorOrderedSchemaMap<NodeSpec>;
  const codeBlock = baseNodes.get("code_block")!;
  const foundationNodes = baseNodes.update("code_block", {
    ...codeBlock,
    parseDOM: [{
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: codeBlockDomAttrs,
    }],
  });
  const foundationMarks = commonMarkSchema.spec.marks as MarkdownEditorOrderedSchemaMap<MarkSpec>;
  const nodeEntries = extensions.flatMap(({ definition }) => (
    (definition.schema?.nodes ?? []).map((entry) => ({
      owner: definition.name,
      entry,
    }))
  ));
  const markEntries = extensions.flatMap(({ definition }) => (
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
    fail: (failure) => codecError({ phase: "schema", ...failure }),
  });
  const marks = compileMarkdownEditorSchemaEntries({
    foundation: foundationMarks,
    entries: markEntries,
    kind: "mark",
    missingTargetCode: "EXTENSION_MISSING_DEPENDENCY",
    fail: (failure) => codecError({ phase: "schema", ...failure }),
  });
  const nodeOwners = new Map<string, string>();
  const markOwners = new Map<string, string>();
  foundationNodes.forEach((name) => nodeOwners.set(name, "@markora/foundation"));
  foundationMarks.forEach((name) => markOwners.set(name, "@markora/foundation"));

  for (const { definition } of extensions) {
    for (const entry of definition.schema?.nodes ?? []) {
      nodeOwners.set(entry.name, definition.name);
    }

    for (const entry of definition.schema?.marks ?? []) {
      markOwners.set(entry.name, definition.name);
    }
  }

  const schemaContributors = extensions
    .filter(({ definition }) => (
      (definition.schema?.nodes?.length ?? 0) > 0
      || (definition.schema?.marks?.length ?? 0) > 0
    ))
    .map(({ definition }) => definition.name);
  let schema: Schema;

  try {
    schema = new Schema({ nodes, marks });
  } catch (cause) {
    codecError({
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
  const managedBlocks = new Set(["code_block"]);

  for (const { definition } of extensions) {
    for (const name of definition.schema?.managedBlocks ?? []) {
      if (nodeOwners.get(name) !== definition.name || !schema.nodes[name]?.isBlock) {
        codecError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "schema",
          message: `Managed block "${name}" must be contributed by "${definition.name}".`,
          extension: definition.name,
          contribution: name,
        });
      }
      managedBlocks.add(name);
    }
  }

  const tokenizer = new MarkdownIt("commonmark", { html: false });
  // Defer scheme enforcement until after parsing so host-approved custom
  // protocols are not discarded by markdown-it's fixed built-in allowlist.
  tokenizer.validateLink = () => true;
  registerMarkdownEditorTokenizerRules(
    tokenizer,
    extensions,
    minimalTokenizerFoundationAnchors,
  );
  const parserTokens = compileMarkdownEditorParserTokens({
    foundationTokens: {
      ...defaultMarkdownParser.tokens,
      fence: {
        ...defaultMarkdownParser.tokens.fence,
        getAttrs: codeBlockFenceTokenAttrs,
      },
    },
    schema,
    extensions,
    qualifyToken,
  });
  const serializerNodes: Record<string, (typeof defaultMarkdownSerializer.nodes)[string]> = {
    ...defaultMarkdownSerializer.nodes,
    code_block: serializeCodeBlock,
  };
  const serializerMarks: Record<string, (typeof defaultMarkdownSerializer.marks)[string]> = {
    ...defaultMarkdownSerializer.marks,
  };

  for (const { definition } of extensions) {
    for (const [name, serializer] of Object.entries(
      definition.markdown?.serializer?.nodes ?? {},
    )) {
      if (serializerNodes[name] || nodeOwners.get(name) !== definition.name) {
        codecError({
          phase: "codec",
          message: `Node serializer "${name}" does not exclusively own its schema node.`,
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

    for (const [name, serializer] of Object.entries(
      definition.markdown?.serializer?.marks ?? {},
    )) {
      if (serializerMarks[name] || markOwners.get(name) !== definition.name) {
        codecError({
          phase: "codec",
          message: `Mark serializer "${name}" does not exclusively own its schema mark.`,
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
        codecError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "codec",
          message: `Schema node "${entry.name}" requires a serializer.`,
          extension: definition.name,
          contribution: entry.name,
        });
      }
    }

    for (const entry of definition.schema?.marks ?? []) {
      if (!serializerMarks[entry.name]) {
        codecError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "codec",
          message: `Schema mark "${entry.name}" requires a serializer.`,
          extension: definition.name,
          contribution: entry.name,
        });
      }
    }
  }

  const parser = new MarkdownParser(schema, tokenizer, parserTokens);
  const serializer = new MarkdownSerializer(serializerNodes, serializerMarks);
  const parse = (markdown: string) => {
    if (!markdown.trim()) {
      return schema.topNodeType.createAndFill();
    }

    const parsed = parser.parse(
      markdown,
      createMarkdownEditorSourceEnvironment(markdown),
    );
    return sanitizeNode(schema, resources, parsed) ?? schema.topNodeType.createAndFill();
  };

  return Object.freeze({
    schema,
    tokenizer,
    parser,
    serializer,
    parse,
    serialize: (doc: ProseMirrorNode) => serializer.serialize(doc),
    createImportedContentSanitizerPlugin() {
      return new Plugin({
        props: {
          transformPasted(slice) {
            const content = sanitizeFragment(schema, resources, slice.content);
            return content === slice.content
              ? slice
              : new Slice(content, slice.openStart, slice.openEnd);
          },
        },
      });
    },
    createTableCellContentFromMarkdown(text: string) {
      return parse(text)?.content ?? Fragment.empty;
    },
    managedBlocks: createReadonlySet(managedBlocks),
  });
}
