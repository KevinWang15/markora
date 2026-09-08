import type {
  Fragment,
  MarkdownSerializerState,
  Node as ProseMirrorNode,
  NodeType,
  Transaction,
} from "markora/extension-api";

export const DIAGRAM_MAX_SOURCE_BYTES = 262_144;
export const diagramKinds = Object.freeze([
  "mermaid",
  "plantuml",
  "geojson",
  "topojson",
  "stl",
] as const);

export type DiagramKind = (typeof diagramKinds)[number];

export type DiagramNodeTypes = Readonly<{
  codeBlock: NodeType;
  diagram: NodeType;
}>;

export type DiagramNodeTarget = Readonly<{
  identity: number;
  info: string;
  kind: DiagramKind;
  position: number;
  source: string;
}>;

export type DiagramSourceSnapshot = DiagramNodeTarget;
export type DiagramNodeIdentityIndex = ReadonlyMap<number, DiagramSourceSnapshot>;

const kindSet = new Set<string>(diagramKinds);
const utf8Encoder = new TextEncoder();
let nextIdentity = 0;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertDiagramKind(value: unknown): DiagramKind {
  if (typeof value !== "string" || !kindSet.has(value)) {
    throw new TypeError('Diagram kind must be "mermaid", "plantuml", "geojson", "topojson", or "stl".');
  }
  return value as DiagramKind;
}

export function normalizeDiagramSource(value: unknown) {
  if (typeof value !== "string") {
    throw new TypeError("Diagram source must be a string.");
  }
  return value.replace(/\r\n?|\u0000/g, (match) => match === "\u0000" ? "\uFFFD" : "\n");
}

export function diagramSourceUtf8Bytes(info: string, source: string) {
  return utf8Encoder.encode(`${info}\n${source}`).byteLength;
}

export function classifyDiagramInfo(value: unknown): DiagramKind | null {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000\r\n]/u.test(value)
  ) {
    return null;
  }
  const first = /^\S+/u.exec(value)?.[0];
  return first && kindSet.has(first) ? first as DiagramKind : null;
}

/** Normalize command-authored info using the base editor's 128-character UI bound. */
export function normalizeDiagramInfo(value: unknown) {
  if (typeof value !== "string") {
    throw new TypeError("Diagram info must be a one-line string.");
  }
  if (/[\u0000\r\n]/u.test(value)) {
    throw new RangeError("Diagram info must be a one-line string.");
  }
  const info = value.trim();
  if (info.length > 128) {
    throw new RangeError("Diagram info must be at most 128 characters.");
  }
  if (!classifyDiagramInfo(info)) {
    throw new RangeError("Diagram info must start with a supported case-sensitive kind token.");
  }
  return info;
}

export function replaceDiagramInfoKind(info: string, kind: DiagramKind) {
  const trimmed = info.trim();
  const first = /^\S+/u.exec(trimmed)?.[0];
  return first ? `${kind}${trimmed.slice(first.length)}` : kind;
}

export function readDiagramNodeInfo(node: ProseMirrorNode) {
  return typeof node.attrs.info === "string" ? node.attrs.info : null;
}

export function readDiagramNodeKind(node: ProseMirrorNode) {
  const kind = node.attrs.kind;
  return typeof kind === "string" && kindSet.has(kind) ? kind as DiagramKind : null;
}

export function readDiagramNodeSource(node: ProseMirrorNode) {
  return node.textContent;
}

export function isDiagramNodeValid(node: ProseMirrorNode, type: NodeType) {
  if (node.type !== type || node.childCount > 1) {
    return false;
  }
  const info = readDiagramNodeInfo(node);
  const kind = readDiagramNodeKind(node);
  const source = readDiagramNodeSource(node);
  return (
    info !== null
    && kind !== null
    && classifyDiagramInfo(info) === kind
    && normalizeDiagramSource(source) === source
    && (!node.firstChild || (node.firstChild.isText && node.firstChild.marks.length === 0))
  );
}

export function isDiagramDocumentValid(doc: ProseMirrorNode, type: NodeType) {
  let valid = true;
  doc.descendants((node) => {
    if (node.type === type) {
      valid = valid && isDiagramNodeValid(node, type);
      return false;
    }
    return valid;
  });
  return valid;
}

function allocateIdentity() {
  if (nextIdentity >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Diagram node identity space is exhausted.");
  }
  nextIdentity += 1;
  return nextIdentity;
}

function snapshotAt(node: ProseMirrorNode, position: number, type: NodeType, identity: number) {
  if (node.type !== type) {
    return null;
  }
  const info = readDiagramNodeInfo(node);
  const kind = readDiagramNodeKind(node);
  return info !== null && kind !== null
    ? Object.freeze({ identity, info, kind, position, source: node.textContent })
    : null;
}

export function createDiagramNodeIdentityIndex(
  doc: ProseMirrorNode,
  type: NodeType,
  preserved: ReadonlyMap<number, number> = new Map(),
) {
  const index = new Map<number, DiagramSourceSnapshot>();
  doc.descendants((node, position) => {
    if (node.type !== type) {
      return;
    }
    const snapshot = snapshotAt(
      node,
      position,
      type,
      preserved.get(position) ?? allocateIdentity(),
    );
    if (snapshot) {
      index.set(position, snapshot);
    }
    return false;
  });
  return index as DiagramNodeIdentityIndex;
}

function fragmentHasDiagram(fragment: Fragment, type: NodeType) {
  let found = false;
  fragment.descendants((node) => {
    found ||= node.type === type;
    return !found;
  });
  return found;
}

function positionTouchesDiagram(doc: ProseMirrorNode, position: number, type: NodeType) {
  const bounded = Math.max(0, Math.min(doc.content.size, position));
  const $position = doc.resolve(bounded);
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if ($position.node(depth).type === type) {
      return true;
    }
  }
  return doc.nodeAt(bounded)?.type === type
    || (bounded > 0 && doc.nodeAt(bounded - 1)?.type === type);
}

function serializedValueContainsDiagram(value: unknown, type: NodeType): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => serializedValueContainsDiagram(entry, type));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === type.name
    || Object.values(record).some((entry) => serializedValueContainsDiagram(entry, type));
}

function transactionTouchesDiagram(transaction: Transaction, type: NodeType) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]!;
    const before = transaction.docs[index] ?? transaction.before;
    const after = transaction.docs[index + 1] ?? transaction.doc;
    let mapped = false;
    let touches = false;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      mapped = true;
      touches ||= positionTouchesDiagram(before, oldStart, type)
        || positionTouchesDiagram(before, oldEnd, type)
        || positionTouchesDiagram(after, newStart, type)
        || positionTouchesDiagram(after, newEnd, type)
        || (oldEnd > oldStart && fragmentHasDiagram(before.slice(oldStart, oldEnd).content, type))
        || (newEnd > newStart && fragmentHasDiagram(after.slice(newStart, newEnd).content, type));
    });
    if (touches) {
      return true;
    }
    let json: unknown;
    try {
      json = step.toJSON();
    } catch {
      return true;
    }
    if (serializedValueContainsDiagram(json, type)) {
      return true;
    }
    if (!mapped) {
      return true;
    }
  }
  return false;
}

export function mapDiagramNodeIdentityIndex(
  transaction: Transaction,
  type: NodeType,
  previous: DiagramNodeIdentityIndex,
) {
  if (!transaction.docChanged) {
    return previous;
  }
  if (!transactionTouchesDiagram(transaction, type)) {
    const mapped = new Map<number, DiagramSourceSnapshot>();
    for (const snapshot of previous.values()) {
      const position = transaction.mapping.map(snapshot.position, 1);
      if (mapped.has(position)) {
        return createDiagramNodeIdentityIndex(transaction.doc, type);
      }
      mapped.set(position, position === snapshot.position
        ? snapshot
        : Object.freeze({ ...snapshot, position }));
    }
    return mapped as DiagramNodeIdentityIndex;
  }

  const preserved = new Map<number, number>();
  for (const snapshot of previous.values()) {
    const mapped = transaction.mapping.mapResult(snapshot.position, 1);
    if (mapped.deleted || mapped.deletedAcross || preserved.has(mapped.pos)) {
      continue;
    }
    const node = transaction.doc.nodeAt(mapped.pos);
    const current = node ? snapshotAt(node, mapped.pos, type, snapshot.identity) : null;
    if (
      current?.kind === snapshot.kind
      && current.info === snapshot.info
      && current.source === snapshot.source
    ) {
      preserved.set(mapped.pos, snapshot.identity);
    }
  }
  return createDiagramNodeIdentityIndex(transaction.doc, type, preserved);
}

export function collectDiagramNodeSnapshots(index: DiagramNodeIdentityIndex) {
  return Object.freeze([...index.values()]);
}

export function normalizeDiagramNodeTarget(value: unknown): DiagramNodeTarget {
  if (!isPlainObject(value)) {
    throw new TypeError("A diagram node target must be a plain object.");
  }
  const allowed = new Set([
    "convert", "identity", "info", "kind", "position", "remove", "render",
    "restoreCodeBlock", "source", "update",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unknown diagram node target key "${key}".`);
    }
  }
  const { identity, info, kind, position, source } = value;
  if (!Number.isSafeInteger(identity) || (identity as number) <= 0) {
    throw new TypeError("A diagram node target identity must be a positive safe integer.");
  }
  const normalizedKind = assertDiagramKind(kind);
  if (typeof info !== "string") {
    throw new TypeError("A diagram node target info must be a string.");
  }
  if (!Number.isSafeInteger(position) || (position as number) < 0) {
    throw new TypeError("A diagram node target position must be a non-negative safe integer.");
  }
  if (typeof source !== "string") {
    throw new TypeError("A diagram node target source must be a string.");
  }
  return Object.freeze({
    identity: identity as number,
    info,
    kind: normalizedKind,
    position: position as number,
    source,
  });
}

export function findDiagramNodeSnapshot(
  doc: ProseMirrorNode,
  type: NodeType,
  target: DiagramNodeTarget,
  identities: DiagramNodeIdentityIndex,
) {
  const normalized = normalizeDiagramNodeTarget(target);
  const current = identities.get(normalized.position);
  const node = doc.nodeAt(normalized.position);
  return node?.type === type
    && current?.identity === normalized.identity
    && current.kind === normalized.kind
    && current.info === normalized.info
    && current.source === normalized.source
    && readDiagramNodeKind(node) === normalized.kind
    && readDiagramNodeInfo(node) === normalized.info
    && node.textContent === normalized.source
    ? normalized
    : null;
}

export function isDiagramTransactionAllowed(transaction: Transaction, type: NodeType) {
  if (!transaction.docChanged || !transactionTouchesDiagram(transaction, type)) {
    return true;
  }
  return [...transaction.docs.slice(1), transaction.doc]
    .every((doc) => isDiagramDocumentValid(doc, type));
}

function longestDelimiterRun(text: string, delimiter: "`" | "~") {
  let longest = 0;
  let current = 0;
  for (const character of text) {
    if (character === delimiter) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** Behavioral twin of Markora's safe generic code-fence serializer. */
export function serializeDiagramFence(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
) {
  const info = readDiagramNodeInfo(node) ?? "";
  if (!classifyDiagramInfo(info)) {
    throw new RangeError("Diagram info must be normalized and begin with a supported kind.");
  }
  const source = node.textContent;
  if (/[\u0000\r]/u.test(source)) {
    throw new RangeError("Diagram source must contain no NUL or carriage-return characters.");
  }
  const delimiter = info.includes("`") ? "~" : "`";
  const length = Math.max(3, longestDelimiterRun(source, delimiter) + 1);
  const fence = delimiter.repeat(length);
  const separator = delimiter === "~" && info.startsWith("~") ? " " : "";
  state.write(`${fence}${separator}${info}\n`);
  state.text(source, false);
  state.write("\n");
  state.write(fence);
  state.closeBlock(node);
}
