import {
  MarkdownIt,
  type Mark,
  type MarkdownEditorCodec,
  type Node as ProseMirrorNode,
  type NodeType,
  type Transaction,
} from "markora/extension-api";

export const HTML_MAX_SOURCE_BYTES = 262_144;

export type HtmlDisplay = "block" | "inline";
export type HtmlSourceKind = "html-block" | "html-comment" | "inline-html";

export type HtmlNodeTypes = Readonly<{
  block: NodeType;
  code: Mark["type"];
  inline: NodeType;
}>;

export type HtmlNodeTarget = Readonly<{
  display: HtmlDisplay;
  identity: number;
  kind: HtmlSourceKind;
  position: number;
  source: string;
}>;

export type HtmlSourceSnapshot = HtmlNodeTarget;
type HtmlIdentityEntry = Readonly<{ node: ProseMirrorNode; snapshot: HtmlSourceSnapshot }>;
export type HtmlNodeIdentityIndex = Readonly<{
  byPosition: ReadonlyMap<number, HtmlIdentityEntry>;
  /** Changes when HTML occurrences change, not when text merely moves them. */
  nodeViewRevision: object;
}>;

const utf8Encoder = new TextEncoder();
const validator = new MarkdownIt("commonmark", { html: true });
let nextIdentity = 0;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function htmlSourceUtf8Bytes(source: string) {
  return utf8Encoder.encode(source).byteLength;
}

function inferredKind(source: string, display: HtmlDisplay): HtmlSourceKind {
  return source.trimStart().startsWith("<!--")
    ? "html-comment"
    : display === "block" ? "html-block" : "inline-html";
}

/** Classify only a single CommonMark HTML token in the requested placement. */
export function classifyHtmlSource(
  value: unknown,
  display: HtmlDisplay,
): HtmlSourceKind | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const tokens = display === "block"
    ? validator.parse(value, {})
    : validator.parseInline(value, {});
  const claimed = display === "block"
    ? tokens
    : tokens[0]?.children ?? [];
  const expected = display === "block" ? "html_block" : "html_inline";

  if (claimed.length !== 1 || claimed[0]?.type !== expected) {
    return null;
  }

  if (display === "block") {
    const lineCount = 1 + (value.match(/\r\n|\r|\n/g)?.length ?? 0);
    const map = claimed[0]!.map;

    if (!map || map[0] !== 0 || map[1] !== lineCount) {
      return null;
    }
  }

  return inferredKind(value, display);
}

export function readHtmlNodeSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : null;
}

export function readHtmlNodeKind(node: ProseMirrorNode) {
  const kind = node.attrs.kind;
  return kind === "html-block" || kind === "inline-html" || kind === "html-comment"
    ? kind
    : null;
}

function displayForNode(node: ProseMirrorNode, types: HtmlNodeTypes): HtmlDisplay | null {
  return node.type === types.block
    ? "block"
    : node.type === types.inline ? "inline" : null;
}

export function isHtmlNodeValid(node: ProseMirrorNode, types: HtmlNodeTypes) {
  const display = displayForNode(node, types);
  const source = readHtmlNodeSource(node);
  const kind = readHtmlNodeKind(node);
  const classified = display && source !== null
    ? classifyHtmlSource(source, display)
    : null;

  return (
    classified !== null
    && kind === classified
    && (
      display !== "inline"
      || !node.marks.some((mark) => mark.type === types.code)
    )
  );
}

export function isHtmlDocumentValid(doc: ProseMirrorNode, types: HtmlNodeTypes) {
  let valid = true;

  doc.descendants((node) => {
    if (node.type !== types.block && node.type !== types.inline) {
      return valid;
    }

    valid = valid && isHtmlNodeValid(node, types);
    return false;
  });
  return valid;
}

function allocateIdentity() {
  if (nextIdentity >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("HTML node identity space is exhausted.");
  }

  nextIdentity += 1;
  return nextIdentity;
}

function snapshotAt(
  node: ProseMirrorNode,
  position: number,
  types: HtmlNodeTypes,
  identity: number,
): HtmlSourceSnapshot | null {
  const display = displayForNode(node, types);
  const kind = readHtmlNodeKind(node);
  const source = readHtmlNodeSource(node);

  return display && kind && source !== null
    ? Object.freeze({ display, identity, kind, position, source })
    : null;
}

export function createHtmlNodeIdentityIndex(
  doc: ProseMirrorNode,
  types: HtmlNodeTypes,
  preserved: ReadonlyMap<number, HtmlIdentityEntry> = new Map(),
  previous?: HtmlNodeIdentityIndex,
) {
  const byPosition = new Map<number, HtmlIdentityEntry>();
  let sameNodes = previous !== undefined;

  doc.descendants((node, position) => {
    if (node.type !== types.block && node.type !== types.inline) {
      return;
    }

    const prior = preserved.get(position);
    const keepIdentity = prior?.snapshot.display === displayForNode(node, types)
      && prior.snapshot.kind === readHtmlNodeKind(node)
      && prior.snapshot.source === readHtmlNodeSource(node);
    const snapshot = snapshotAt(
      node,
      position,
      types,
      keepIdentity ? prior!.snapshot.identity : allocateIdentity(),
    );

    if (snapshot) {
      byPosition.set(position, Object.freeze({ node, snapshot }));
      sameNodes &&= keepIdentity && prior?.node === node;
    }
  });
  const nodeViewRevision = previous && sameNodes && byPosition.size === previous.byPosition.size
    ? previous.nodeViewRevision : Object.freeze({});
  return Object.freeze({ byPosition, nodeViewRevision });
}

export function mapHtmlNodeIdentityIndex(
  transaction: Transaction,
  types: HtmlNodeTypes,
  previous: HtmlNodeIdentityIndex,
) {
  if (!transaction.docChanged) {
    return previous;
  }

  const preserved = new Map<number, HtmlIdentityEntry>();

  for (const entry of previous.byPosition.values()) {
    const { snapshot } = entry;
    const mapped = transaction.mapping.mapResult(snapshot.position, 1);

    if (mapped.deleted || mapped.deletedAcross || preserved.has(mapped.pos)) {
      continue;
    }

    preserved.set(mapped.pos, entry);
  }

  // Validate mapped identities during one document walk. Calling nodeAt for
  // every atom repeatedly searches the same siblings in a large document.
  return createHtmlNodeIdentityIndex(transaction.doc, types, preserved, previous);
}

export function collectHtmlNodeSnapshots(index: HtmlNodeIdentityIndex) {
  return Object.freeze([...index.byPosition.values()].map(entry => entry.snapshot));
}

export function normalizeHtmlNodeTarget(value: unknown): HtmlNodeTarget {
  if (!isPlainObject(value)) {
    throw new TypeError("An HTML node target must be a plain object.");
  }

  for (const key of Object.keys(value)) {
    // Public snapshots and edit requests are structurally reusable as targets;
    // their derived render state and bound methods do not affect identity.
    if (
      key !== "display"
      && key !== "identity"
      && key !== "kind"
      && key !== "position"
      && key !== "render"
      && key !== "remove"
      && key !== "source"
      && key !== "update"
    ) {
      throw new TypeError(`Unknown HTML node target key "${key}".`);
    }
  }

  const { display, identity, kind, position, source } = value;

  if (display !== "block" && display !== "inline") {
    throw new TypeError('An HTML node target display must be "block" or "inline".');
  }
  if (!Number.isSafeInteger(identity) || (identity as number) <= 0) {
    throw new TypeError("An HTML node target identity must be a positive safe integer.");
  }
  if (kind !== "html-block" && kind !== "inline-html" && kind !== "html-comment") {
    throw new TypeError("An HTML node target kind is invalid.");
  }
  if (!Number.isSafeInteger(position) || (position as number) < 0) {
    throw new TypeError("An HTML node target position must be a non-negative safe integer.");
  }
  if (typeof source !== "string") {
    throw new TypeError("An HTML node target source must be a string.");
  }

  return Object.freeze({
    display,
    identity: identity as number,
    kind,
    position: position as number,
    source,
  });
}

export function findHtmlNodeSnapshot(
  doc: ProseMirrorNode,
  types: HtmlNodeTypes,
  target: HtmlNodeTarget,
  identities: HtmlNodeIdentityIndex,
) {
  const normalized = normalizeHtmlNodeTarget(target);
  const current = identities.byPosition.get(normalized.position)?.snapshot;
  const node = doc.nodeAt(normalized.position);
  const expectedType = normalized.display === "block" ? types.block : types.inline;

  return node?.type === expectedType
    && current?.identity === normalized.identity
    && current.display === normalized.display
    && current.kind === normalized.kind
    && current.source === normalized.source
    && readHtmlNodeKind(node) === normalized.kind
    && readHtmlNodeSource(node) === normalized.source
    ? normalized
    : null;
}

function serializedValueContainsHtmlNode(
  value: unknown,
  types: HtmlNodeTypes,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => serializedValueContainsHtmlNode(entry, types));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === types.block.name
    || record.type === types.inline.name
    || Object.values(record).some((entry) => serializedValueContainsHtmlNode(entry, types));
}

function rangeContainsHtml(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  types: HtmlNodeTypes,
) {
  const start = Math.max(0, Math.min(doc.content.size, from - 2));
  const end = Math.max(start, Math.min(doc.content.size, to + 2));
  let found = false;

  doc.nodesBetween(start, end, (node) => {
    found ||= node.type === types.block || node.type === types.inline;
    return !found;
  });
  return found;
}

function transactionNeedsValidation(transaction: Transaction, types: HtmlNodeTypes) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]!;
    let json: unknown;

    try {
      json = step.toJSON();
    } catch {
      return true;
    }

    if (serializedValueContainsHtmlNode(json, types)) {
      return true;
    }

    const before = transaction.docs[index] ?? transaction.before;
    const after = transaction.docs[index + 1] ?? transaction.doc;
    let hasMappedRange = false;
    let touches = false;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      hasMappedRange = true;
      touches ||= rangeContainsHtml(before, oldStart, oldEnd, types)
        || rangeContainsHtml(after, newStart, newEnd, types);
    });

    // AttrStep and mark steps mutate a document with an empty StepMap. Unknown
    // extension steps may do the same, so validate them conservatively instead
    // of letting a zero-map mutation bypass the HTML invariant.
    if (touches || !hasMappedRange) {
      return true;
    }
  }
  return false;
}

export function isHtmlTransactionAllowed(
  transaction: Transaction,
  types: HtmlNodeTypes,
) {
  if (!transaction.docChanged || !transactionNeedsValidation(transaction, types)) {
    return true;
  }

  return [...transaction.docs.slice(1), transaction.doc]
    .every((doc) => isHtmlDocumentValid(doc, types));
}

/** Reparse through the compiled codec for command-side same-atom validation. */
export function codecClassifiesSingleHtmlAtom(
  codec: MarkdownEditorCodec,
  source: string,
  display: HtmlDisplay,
  expectedType: NodeType,
) {
  if (classifyHtmlSource(source, display) === null) {
    return null;
  }

  const markdown = display === "block" ? source : `a${source}b`;
  const doc = codec.parse(markdown);

  if (!doc) {
    return null;
  }

  let node: ProseMirrorNode | null = null;

  if (display === "block") {
    if (doc.childCount === 1 && doc.firstChild?.type === expectedType) {
      node = doc.firstChild;
    }
  } else {
    const paragraph = doc.childCount === 1 ? doc.firstChild : null;

    if (
      paragraph?.isTextblock
      && paragraph.childCount === 3
      && paragraph.child(0).textContent === "a"
      && paragraph.child(1).type === expectedType
      && paragraph.child(2).textContent === "b"
    ) {
      node = paragraph.child(1);
    }
  }

  const parsedSource = node ? readHtmlNodeSource(node) : null;
  const kind = node ? readHtmlNodeKind(node) : null;
  return parsedSource === source && kind ? kind : null;
}
