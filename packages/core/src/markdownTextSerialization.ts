import type Token from "markdown-it/lib/token.mjs";
import {
  MarkdownSerializer,
  MarkdownSerializerState,
} from "prosemirror-markdown";
import type { Node as ProseMirrorNode } from "prosemirror-model";

type MarkdownEntityDecoder = (source: string) => string;

type MarkdownSerializerStateRuntime = MarkdownSerializerState & {
  inAutolink?: boolean;
  out: string;
};

type MarkdownSerializerStateConstructor = new (
  nodes: MarkdownSerializer["nodes"],
  marks: MarkdownSerializer["marks"],
  options: MarkdownSerializer["options"] & { tightLists?: boolean },
) => MarkdownSerializerStateRuntime;

const MarkdownSerializerStateRuntimeConstructor = MarkdownSerializerState as unknown as MarkdownSerializerStateConstructor;

const markdownEntityCandidatePattern = /&(?:#(?:x[a-f0-9]{1,6}|[0-9]{1,7})|[a-z][a-z0-9]{1,31});/gi;
const entitySensitiveWhitespacePattern = /[\t\n\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/gu;

export function isMarkdownEntityReference(
  source: string,
  unescapeAll: MarkdownEntityDecoder,
) {
  if (/^&#(?:x[a-f0-9]{1,6}|[0-9]{1,7});$/i.test(source)) {
    return true;
  }

  return unescapeAll(source) !== source;
}

export function escapeMarkdownEntityReferences(
  source: string,
  unescapeAll: MarkdownEntityDecoder,
) {
  if (!source.includes("&")) {
    return source;
  }

  return source.replace(markdownEntityCandidatePattern, (candidate) => (
    isMarkdownEntityReference(candidate, unescapeAll)
      ? `\\${candidate}`
      : candidate
  ));
}

export function containsMarkdownEntityReference(
  source: string,
  unescapeAll: MarkdownEntityDecoder,
) {
  return (source.match(markdownEntityCandidatePattern) ?? []).some((candidate) => (
    isMarkdownEntityReference(candidate, unescapeAll)
  ));
}

export function encodeEntitySensitiveWhitespace(source: string) {
  return source.replace(entitySensitiveWhitespacePattern, (character) => (
    `&#${character.codePointAt(0)!};`
  ));
}

export function encodeMarkdownAttributeText(
  source: string,
  unescapeAll: MarkdownEntityDecoder,
) {
  return encodeEntitySensitiveWhitespace(
    escapeMarkdownEntityReferences(source, unescapeAll),
  );
}

export function createEntitySafeMarkdownSerializerState(
  nodes: MarkdownSerializer["nodes"],
  marks: MarkdownSerializer["marks"],
  options: MarkdownSerializer["options"] & { tightLists?: boolean },
  unescapeAll: MarkdownEntityDecoder,
) {
  const state = new MarkdownSerializerStateRuntimeConstructor(nodes, marks, options);
  const baseEscape = state.esc.bind(state);

  state.esc = (source: string, startOfLine = false) => encodeMarkdownAttributeText(
    baseEscape(source, startOfLine),
    unescapeAll,
  );
  return state;
}

export function serializeEntitySafeMarkdownText(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  unescapeAll: MarkdownEntityDecoder,
  escape = !(state as MarkdownSerializerStateRuntime).inAutolink,
  source = node.text ?? "",
) {
  let cursor = 0;

  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", cursor)) {
    if (index > cursor) {
      const segment = source.slice(cursor, index);
      state.text(
        escape ? segment : escapeMarkdownEntityReferences(segment, unescapeAll),
        escape,
      );
    }

    state.text("&#10;", false);
    cursor = index + 1;
  }

  if (cursor < source.length) {
    const segment = source.slice(cursor);
    state.text(
      escape ? segment : escapeMarkdownEntityReferences(segment, unescapeAll),
      escape,
    );
  }
}

export function serializeEntitySafeMarkdownImage(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  unescapeAll: MarkdownEntityDecoder,
) {
  const alt = state.esc(typeof node.attrs.alt === "string" ? node.attrs.alt : "");
  const source = escapeMarkdownEntityReferences(
    typeof node.attrs.src === "string" ? node.attrs.src : "",
    unescapeAll,
  ).replace(/[()]/g, "\\$&");
  const title = typeof node.attrs.title === "string" && node.attrs.title
    ? ` "${encodeMarkdownAttributeText(node.attrs.title, unescapeAll).replace(/"/g, '\\"')}"`
    : "";

  state.write(`![${alt}](${source}${title})`);
}

export function flattenMarkdownImageDescription(tokens: readonly Token[] | null) {
  let result = "";

  for (const token of tokens ?? []) {
    if (token.type === "softbreak" || token.type === "hardbreak") {
      result += "\n";
    } else if (token.children) {
      result += flattenMarkdownImageDescription(token.children);
    } else if (
      token.type === "text"
      || token.type === "text_special"
      || token.type === "code_inline"
      || token.type === "html_inline"
    ) {
      result += token.content;
    }
  }

  return result;
}

export class EntitySafeMarkdownSerializer extends MarkdownSerializer {
  constructor(
    nodes: MarkdownSerializer["nodes"],
    marks: MarkdownSerializer["marks"],
    options: MarkdownSerializer["options"] & { tightLists?: boolean },
    private readonly unescapeAll: MarkdownEntityDecoder,
  ) {
    super(nodes, marks, options);
  }

  override serialize(content: ProseMirrorNode, options: { tightLists?: boolean } = {}) {
    const state = createEntitySafeMarkdownSerializerState(
      this.nodes,
      this.marks,
      { ...this.options, ...options },
      this.unescapeAll,
    );
    state.renderContent(content);
    return state.out;
  }
}
