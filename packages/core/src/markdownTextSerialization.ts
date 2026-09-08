import type Token from "markdown-it/lib/token.mjs";
import { bufferMarkdownSerializerOutput } from "./markdownSerializerBuffer";
import {
  MarkdownSerializer,
  MarkdownSerializerState,
} from "prosemirror-markdown";
import {
  Fragment,
  Mark,
  type Node as ProseMirrorNode,
} from "prosemirror-model";

type MarkdownEntityDecoder = (source: string) => string;

type MarkdownSerializerStateRuntime = MarkdownSerializerState & {
  escapeTrailingHeadingHashes?: boolean;
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
  bufferMarkdownSerializerOutput(state);
  const baseEscape = state.esc.bind(state);

  state.esc = (source: string, startOfLine = false) => {
    let escaped = encodeMarkdownAttributeText(
      baseEscape(source, startOfLine),
      unescapeAll,
    );

    if (state.escapeTrailingHeadingHashes) {
      escaped = escaped.replace(/(#+)([ \t]*)$/u, "\\$1$2");
    }

    return escaped;
  };
  return state;
}

export function serializeEntitySafeMarkdownText(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  unescapeAll: MarkdownEntityDecoder,
  escape = !(state as MarkdownSerializerStateRuntime).inAutolink,
  source = node.text ?? "",
  escapeTrailingHeadingHashes = false,
) {
  const runtime = state as MarkdownSerializerStateRuntime;
  const previousEscapeTrailingHeadingHashes = runtime.escapeTrailingHeadingHashes;
  runtime.escapeTrailingHeadingHashes = escapeTrailingHeadingHashes;
  let cursor = 0;

  try {
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
  } finally {
    runtime.escapeTrailingHeadingHashes = previousEscapeTrailingHeadingHashes;
  }
}

function withoutExpellableMarks(
  marks: readonly Mark[],
  expellableMarkNames: ReadonlySet<string>,
) {
  return marks.filter(mark => !expellableMarkNames.has(mark.type.name));
}

function hasCrossingExpellableMarkRuns(
  children: readonly ProseMirrorNode[],
  expellableMarkNames: ReadonlySet<string>,
) {
  const marks: Mark[] = [];

  for (const child of children) {
    for (const mark of child.marks) {
      if (
        expellableMarkNames.has(mark.type.name)
        && !marks.some(candidate => candidate.eq(mark))
      ) {
        marks.push(mark);
      }
    }
  }

  const runs = marks.flatMap((mark) => {
    const result: Array<{ start: number; end: number }> = [];
    let start = -1;

    children.forEach((child, index) => {
      const present = mark.isInSet(child.marks);
      if (present && start < 0) {
        start = index;
      } else if (!present && start >= 0) {
        result.push({ start, end: index - 1 });
        start = -1;
      }
    });

    if (start >= 0) {
      result.push({ start, end: children.length - 1 });
    }

    return result;
  });

  return runs.some((left, leftIndex) => runs.slice(leftIndex + 1).some(right => (
    (left.start < right.start && right.start <= left.end && left.end < right.end)
    || (right.start < left.start && left.start <= right.end && right.end < left.end)
  )));
}

function hasLeadingWhitespaceAfterExpellableMarkReduction(
  children: readonly ProseMirrorNode[],
  expellableMarkNames: ReadonlySet<string>,
) {
  return children.some((child, index) => {
    const previous = children[index - 1];
    if (!previous || !child.isText || !/^\s/u.test(child.text ?? "")) {
      return false;
    }

    const runStart = (mark: Mark) => {
      let start = index - 1;
      while (start > 0 && mark.isInSet(children[start - 1]!.marks)) {
        start -= 1;
      }
      return start;
    };
    const removed = previous.marks.filter(mark => (
      expellableMarkNames.has(mark.type.name) && !mark.isInSet(child.marks)
    ));
    const retained = child.marks.filter(mark => expellableMarkNames.has(mark.type.name));

    return removed.some(removedMark => retained.some(retainedMark => (
      runStart(removedMark) === runStart(retainedMark)
    )));
  });
}

/**
 * Align parsed inline whitespace with ProseMirror Markdown's serializer policy.
 * Marked whitespace at a changing delimiter boundary cannot always be represented
 * without crossing Markdown delimiters, so retain it as unformatted whitespace.
 */
export function normalizeExpelledMarkdownWhitespace(
  node: ProseMirrorNode,
  expellableMarkNames: ReadonlySet<string>,
): ProseMirrorNode {
  if (node.isLeaf || node.isText) {
    return node;
  }

  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(normalizeExpelledMarkdownWhitespace(child, expellableMarkNames));
  });

  if (
    node.inlineContent
    && expellableMarkNames.size > 0
    && (
      hasCrossingExpellableMarkRuns(children, expellableMarkNames)
      || hasLeadingWhitespaceAfterExpellableMarkReduction(children, expellableMarkNames)
    )
  ) {
    const normalized: ProseMirrorNode[] = [];

    children.forEach((child, index) => {
      if (!child.isText || !child.marks.some(mark => expellableMarkNames.has(mark.type.name))) {
        normalized.push(child);
        return;
      }

      const source = child.text ?? "";
      const previous = children[index - 1];
      const next = children[index + 1];
      const stripLeading = !previous || !Mark.sameSet(previous.marks, child.marks);
      const stripTrailing = !next || !Mark.sameSet(next.marks, child.marks);
      const leadingLength = stripLeading ? source.match(/^\s+/u)?.[0].length ?? 0 : 0;
      const trailingLength = stripTrailing ? source.match(/\s+$/u)?.[0].length ?? 0 : 0;
      const trailingStart = Math.max(leadingLength, source.length - trailingLength);
      const plainMarks = withoutExpellableMarks(child.marks, expellableMarkNames);

      if (leadingLength === 0 && trailingLength === 0) {
        normalized.push(child);
        return;
      }

      if (leadingLength > 0) {
        normalized.push(child.type.schema.text(source.slice(0, leadingLength), plainMarks));
      }
      if (trailingStart > leadingLength) {
        normalized.push(child.type.schema.text(source.slice(leadingLength, trailingStart), child.marks));
      }
      if (trailingStart < source.length) {
        normalized.push(child.type.schema.text(source.slice(trailingStart), plainMarks));
      }
    });

    return node.type.create(node.attrs, Fragment.fromArray(normalized), node.marks);
  }

  const content = Fragment.fromArray(children);
  return content.eq(node.content) ? node : node.copy(content);
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
