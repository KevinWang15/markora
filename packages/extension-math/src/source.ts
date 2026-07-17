import type {
  Fragment,
  Mark,
  Node as ProseMirrorNode,
  NodeType,
  Transaction,
} from "markora/extension-api";

export const MATH_MAX_SOURCE_BYTES = 65_536;

export type MathKind = "block" | "inline";

export type MathNodeTypes = Readonly<{
  block: NodeType;
  code: Mark["type"];
  inline: NodeType;
}>;

export type MathNodeSnapshot = Readonly<{
  identity: number;
  kind: MathKind;
  position: number;
  source: string;
}>;

export type MathNodeTarget = MathNodeSnapshot;

export type MathNodeIdentityIndex = ReadonlyMap<number, MathNodeSnapshot>;

export type InlineMathMatch = Readonly<{
  end: number;
  source: string;
  start: number;
}>;

const utf8Encoder = new TextEncoder();
let nextMathNodeIdentity = 0;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAsciiAlphaNumeric(value: string | undefined) {
  return !!value && /[A-Za-z0-9]/.test(value);
}

function isWhitespace(value: string | undefined) {
  return !!value && /\s/u.test(value);
}

export function normalizeMathSource(source: string) {
  return source
    .replace(/\r\n?|\u0000/g, (match) => match === "\u0000" ? "\uFFFD" : "\n");
}

export function mathSourceUtf8Bytes(source: string) {
  return utf8Encoder.encode(source).byteLength;
}

export function isMarkdownCharacterEscaped(source: string, index: number) {
  let backslashes = 0;

  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

export function isSingleDollarAt(source: string, index: number) {
  return (
    source[index] === "$"
    && source[index - 1] !== "$"
    && source[index + 1] !== "$"
  );
}

export function isInlineMathOpenerAt(source: string, index: number) {
  return (
    isSingleDollarAt(source, index)
    && !isMarkdownCharacterEscaped(source, index)
    && source[index + 1] !== undefined
    && source[index + 1] !== "\n"
    && source[index + 1] !== "\r"
    && !isWhitespace(source[index + 1])
    && !isAsciiAlphaNumeric(source[index - 1])
  );
}

export function isInlineMathCloserAt(source: string, index: number) {
  return (
    isSingleDollarAt(source, index)
    && !isMarkdownCharacterEscaped(source, index)
    && source[index - 1] !== undefined
    && source[index - 1] !== "\n"
    && source[index - 1] !== "\r"
    && !isWhitespace(source[index - 1])
    && !isAsciiAlphaNumeric(source[index + 1])
  );
}

/** Match one canonical single-dollar expression without crossing a source line. */
export function matchInlineMathAt(
  source: string,
  start: number,
  maximum = source.length,
): InlineMathMatch | null {
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(maximum)
    || start < 0
    || maximum <= start
    || maximum > source.length
    || !isInlineMathOpenerAt(source, start)
  ) {
    return null;
  }

  for (let cursor = start + 1; cursor < maximum; cursor += 1) {
    if (source[cursor] === "\n" || source[cursor] === "\r") {
      return null;
    }

    if (isInlineMathCloserAt(source, cursor)) {
      return Object.freeze({
        end: cursor + 1,
        source: source.slice(start + 1, cursor),
        start,
      });
    }
  }

  return null;
}

export function isValidInlineMathSource(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== normalizeMathSource(value)
    || /[\r\n]/.test(value)
  ) {
    return false;
  }

  const shell = `$${value}$`;
  const match = matchInlineMathAt(shell, 0);
  return match?.end === shell.length && match.source === value;
}

export function isValidBlockMathSource(value: unknown): value is string {
  return (
    typeof value === "string"
    && value === normalizeMathSource(value)
    && !value.split("\n").some((line) => line.trim() === "$$")
  );
}

export function canonicalInlineMath(source: string) {
  if (!isValidInlineMathSource(source)) {
    throw new TypeError("Inline math source cannot be represented by a canonical single-dollar shell.");
  }

  return `$${source}$`;
}

export function canonicalBlockMath(source: string) {
  if (!isValidBlockMathSource(source)) {
    throw new TypeError("Block math source cannot contain a standalone double-dollar delimiter line.");
  }

  return `$$\n${source}\n$$`;
}

export function readMathNodeSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : null;
}

function allocateMathNodeIdentity() {
  if (nextMathNodeIdentity >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Math node identity space is exhausted.");
  }

  nextMathNodeIdentity += 1;
  return nextMathNodeIdentity;
}

function mathNodeKind(node: ProseMirrorNode, types: MathNodeTypes): MathKind | null {
  return node.type === types.inline
    ? "inline"
    : node.type === types.block
      ? "block"
      : null;
}

function mathNodeSnapshot(
  node: ProseMirrorNode,
  position: number,
  types: MathNodeTypes,
  identity: number,
) {
  const kind = mathNodeKind(node, types);
  const source = readMathNodeSource(node);

  return kind && source !== null
    ? Object.freeze({ identity, kind, position, source })
    : null;
}

export function createMathNodeIdentityIndex(
  doc: ProseMirrorNode,
  types: MathNodeTypes,
  preserved: ReadonlyMap<number, number> = new Map(),
) {
  const index = new Map<number, MathNodeSnapshot>();

  doc.descendants((node, position) => {
    if (!mathNodeKind(node, types) || readMathNodeSource(node) === null) {
      return;
    }

    const snapshot = mathNodeSnapshot(
      node,
      position,
      types,
      preserved.get(position) ?? allocateMathNodeIdentity(),
    );

    if (snapshot) {
      index.set(position, snapshot);
    }
  });

  return index as MathNodeIdentityIndex;
}

function fragmentHasMathNode(
  fragment: Fragment,
  types: MathNodeTypes,
) {
  let found = false;

  fragment.descendants((node) => {
    found ||= node.type === types.inline || node.type === types.block;
    return !found;
  });
  return found;
}

function nodeAtIsMath(
  doc: ProseMirrorNode,
  position: number,
  types: MathNodeTypes,
) {
  if (position < 0 || position > doc.content.size) {
    return false;
  }

  const node = doc.nodeAt(position);
  return !!node && mathNodeKind(node, types) !== null;
}

function transactionChangesMathStructure(
  transaction: Transaction,
  types: MathNodeTypes,
) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]!;
    const before = transaction.docs[index] ?? transaction.before;
    const after = transaction.docs[index + 1] ?? transaction.doc;
    let mappedRange = false;
    let changed = false;

    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      mappedRange = true;

      if (
        oldEnd > oldStart
        && fragmentHasMathNode(before.slice(oldStart, oldEnd).content, types)
      ) {
        changed = true;
      }

      if (
        !changed
        && newEnd > newStart
        && fragmentHasMathNode(after.slice(newStart, newEnd).content, types)
      ) {
        changed = true;
      }
    });

    if (changed) {
      return true;
    }

    let serialized: unknown;

    try {
      serialized = step.toJSON();
    } catch {
      return true;
    }

    if (serializedValueContainsMathNode(serialized, types)) {
      return true;
    }

    if (!mappedRange && isPlainObject(serialized)) {
      const positions = [
        serialized.pos,
        serialized.from,
        serialized.to,
      ].filter((value): value is number => Number.isSafeInteger(value));

      if (positions.some((position) => (
        nodeAtIsMath(before, position, types)
        || nodeAtIsMath(after, position, types)
      ))) {
        return true;
      }
    }
  }

  return false;
}

export function mapMathNodeIdentityIndex(
  transaction: Transaction,
  types: MathNodeTypes,
  previous: MathNodeIdentityIndex,
) {
  if (!transaction.docChanged) {
    return previous;
  }

  if (!transactionChangesMathStructure(transaction, types)) {
    const mapped = new Map<number, MathNodeSnapshot>();

    for (const snapshot of previous.values()) {
      const position = transaction.mapping.map(snapshot.position, 1);

      if (mapped.has(position)) {
        return createMathNodeIdentityIndex(transaction.doc, types);
      }

      mapped.set(position, position === snapshot.position
        ? snapshot
        : Object.freeze({ ...snapshot, position }));
    }

    return mapped as MathNodeIdentityIndex;
  }

  const preserved = new Map<number, number>();

  for (const snapshot of previous.values()) {
    const mapped = transaction.mapping.mapResult(snapshot.position, 1);

    if (mapped.deleted || mapped.deletedAcross || preserved.has(mapped.pos)) {
      continue;
    }

    const node = transaction.doc.nodeAt(mapped.pos);
    const current = node
      ? mathNodeSnapshot(node, mapped.pos, types, snapshot.identity)
      : null;

    if (
      current?.kind === snapshot.kind
      && current.source === snapshot.source
    ) {
      preserved.set(mapped.pos, snapshot.identity);
    }
  }

  return createMathNodeIdentityIndex(transaction.doc, types, preserved);
}

export function normalizeMathNodeTarget(value: unknown): MathNodeTarget {
  if (!isPlainObject(value)) {
    throw new TypeError("A math node target must be a plain object.");
  }

  for (const key of Object.keys(value)) {
    // Public node snapshots add a derived `render` field and are deliberately
    // reusable as stale-safe command targets.
    if (
      key !== "identity"
      && key !== "kind"
      && key !== "position"
      && key !== "source"
      && key !== "render"
    ) {
      throw new TypeError(`Unknown math node target key "${key}".`);
    }
  }

  const { identity, kind, position, source } = value;

  if (!Number.isSafeInteger(identity) || (identity as number) <= 0) {
    throw new TypeError("A math node target identity must be a positive safe integer.");
  }

  if (kind !== "block" && kind !== "inline") {
    throw new TypeError('A math node target kind must be "block" or "inline".');
  }

  if (!Number.isSafeInteger(position) || (position as number) < 0) {
    throw new TypeError("A math node target position must be a non-negative safe integer.");
  }

  if (typeof source !== "string") {
    throw new TypeError("A math node target source must be a string.");
  }

  return Object.freeze({
    identity: identity as number,
    kind,
    position: position as number,
    source,
  });
}

export function collectMathNodeSnapshots(
  identities: MathNodeIdentityIndex,
) {
  return Object.freeze([...identities.values()]);
}

export function findMathNodeSnapshot(
  doc: ProseMirrorNode,
  types: MathNodeTypes,
  target: MathNodeTarget,
  identities: MathNodeIdentityIndex,
) {
  const normalized = normalizeMathNodeTarget(target);
  const node = doc.nodeAt(normalized.position);
  const expectedType = normalized.kind === "inline" ? types.inline : types.block;
  const current = identities.get(normalized.position);

  return node?.type === expectedType
    && current?.identity === normalized.identity
    && current.kind === normalized.kind
    && current.source === normalized.source
    && readMathNodeSource(node) === normalized.source
    ? normalized
    : null;
}

function sameMarks(left: readonly Mark[], right: readonly Mark[]) {
  return (
    left.length === right.length
    && left.every((mark, index) => mark.eq(right[index]!))
  );
}

function adjacentTextBreaksInlineShell(
  node: ProseMirrorNode,
  sibling: ProseMirrorNode | null,
  side: "after" | "before",
) {
  if (!sibling || !sameMarks(node.marks, sibling.marks)) {
    return false;
  }

  if (sibling.type === node.type) {
    // Two unseparated canonical shells create a double-dollar run.
    return true;
  }

  if (!sibling.isText) {
    return false;
  }

  const text = sibling.text ?? "";
  const adjacent = side === "before" ? text[text.length - 1] : text[0];
  return isAsciiAlphaNumeric(adjacent);
}

export function isMathDocumentValid(
  doc: ProseMirrorNode,
  types: MathNodeTypes,
) {
  let valid = true;

  doc.descendants((node, _position, parent, index) => {
    if (!valid) {
      return false;
    }

    if (node.type === types.block) {
      valid = isValidBlockMathSource(readMathNodeSource(node));
      return false;
    }

    if (node.type !== types.inline) {
      return true;
    }

    const source = readMathNodeSource(node);
    const hasCodeMark = node.marks.some((mark) => mark.type === types.code);
    const previous = parent && index > 0 ? parent.child(index - 1) : null;
    const next = parent && index + 1 < parent.childCount
      ? parent.child(index + 1)
      : null;

    valid = (
      isValidInlineMathSource(source)
      && !hasCodeMark
      && !adjacentTextBreaksInlineShell(node, previous, "before")
      && !adjacentTextBreaksInlineShell(node, next, "after")
    );
    return false;
  });

  return valid;
}

function serializedValueContainsMathNode(
  value: unknown,
  types: MathNodeTypes,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => serializedValueContainsMathNode(entry, types));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    record.type === types.inline.name
    || record.type === types.block.name
    || Object.values(record).some((entry) => serializedValueContainsMathNode(entry, types))
  );
}

function rangeContainsMath(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  types: MathNodeTypes,
) {
  const start = Math.max(0, Math.min(doc.content.size, from - 2));
  const end = Math.max(start, Math.min(doc.content.size, to + 2));
  let found = false;

  doc.nodesBetween(start, end, (node) => {
    if (node.type === types.inline || node.type === types.block) {
      found = true;
      return false;
    }

    return !found;
  });

  return found;
}

function transactionNeedsMathValidation(
  transaction: Transaction,
  types: MathNodeTypes,
) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]!;
    const before = transaction.docs[index] ?? transaction.before;
    const after = transaction.docs[index + 1] ?? transaction.doc;
    let serialized: unknown;

    try {
      serialized = step.toJSON();
    } catch {
      return true;
    }

    if (serializedValueContainsMathNode(serialized, types)) {
      return true;
    }

    let touched = false;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      touched ||= (
        rangeContainsMath(before, oldStart, oldEnd, types)
        || rangeContainsMath(after, newStart, newEnd, types)
      );
    });

    if (touched) {
      return true;
    }

    if (isPlainObject(serialized)) {
      const positions = [
        serialized.pos,
        serialized.gapFrom,
        serialized.gapTo,
      ].filter((value): value is number => Number.isSafeInteger(value));

      const from = Number.isSafeInteger(serialized.from)
        ? serialized.from as number
        : null;
      const to = Number.isSafeInteger(serialized.to)
        ? serialized.to as number
        : from;

      if (
        from !== null
        && to !== null
        && (
          rangeContainsMath(before, from, to, types)
          || rangeContainsMath(after, from, to, types)
        )
      ) {
        return true;
      }

      if (positions.some((position) => (
        rangeContainsMath(before, position, position, types)
        || rangeContainsMath(after, position, position, types)
      ))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate math only when a transaction inserts, removes, marks, changes, or
 * joins content at a math boundary. Ordinary edits elsewhere avoid a full
 * document walk.
 */
export function isMathTransactionAllowed(
  transaction: Transaction,
  types: MathNodeTypes,
) {
  return (
    !transaction.docChanged
    || !transactionNeedsMathValidation(transaction, types)
    || isMathDocumentValid(transaction.doc, types)
  );
}
