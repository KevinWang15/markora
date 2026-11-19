import type {
  Fragment,
  Node as ProseMirrorNode,
  NodeType,
  Transaction,
} from "markora/extension-api";
import type { TocMessages } from "./messages.js";

export type TocHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type TocHeadingSnapshot = Readonly<{
  label: string;
  level: TocHeadingLevel;
  position: number;
}>;

export type TocNodeSnapshot = Readonly<{
  position: number;
}>;

export type TocSnapshot = Readonly<{
  headings: readonly TocHeadingSnapshot[];
  tocs: readonly TocNodeSnapshot[];
}>;

export type TocIndex = Readonly<{
  renderIdentity: object;
  snapshot: TocSnapshot;
}>;

export type TocNodeTypes = Readonly<{
  heading: NodeType;
  toc: NodeType;
}>;

export type TocDocumentIssue = Readonly<{
  parentType: string;
  position: number;
  /** The zero-based step whose resulting document is invalid. */
  stepIndex: number;
}>;

function freezeSnapshot(
  headings: readonly TocHeadingSnapshot[],
  tocs: readonly TocNodeSnapshot[],
): TocSnapshot {
  return Object.freeze({
    headings: Object.freeze([...headings]),
    tocs: Object.freeze([...tocs]),
  });
}

function createIndex(
  headings: readonly TocHeadingSnapshot[],
  tocs: readonly TocNodeSnapshot[],
  renderIdentity: object = Object.freeze({}),
): TocIndex {
  return Object.freeze({
    renderIdentity,
    snapshot: freezeSnapshot(headings, tocs),
  });
}

/** Collapse authored whitespace into the label users see in the outline. */
export function normalizeTocHeadingLabel(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function headingLeafText(node: ProseMirrorNode) {
  if (node.type.name === "image") {
    return typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  }

  return node.type.spec.leafText?.(node) ?? "";
}

function headingLevel(node: ProseMirrorNode): TocHeadingLevel | null {
  const level = node.attrs.level;
  return Number.isInteger(level) && level >= 1 && level <= 6
    ? level as TocHeadingLevel
    : null;
}

/**
 * Read a heading's model text without consulting rendered DOM. Images use
 * their alternative text and extension-owned leaf nodes use their leafText
 * contract. Empty results receive the localized, one-based fallback label.
 */
export function readTocHeadingLabel(
  node: ProseMirrorNode,
  level: TocHeadingLevel,
  headingIndex: number,
  messages: TocMessages,
) {
  const authored = normalizeTocHeadingLabel(node.textBetween(
    0,
    node.content.size,
    "",
    headingLeafText,
  ));

  if (authored) {
    return authored;
  }

  const fallback = normalizeTocHeadingLabel(
    messages.untitledHeadingLabel(level, headingIndex),
  );

  if (!fallback) {
    throw new TypeError("The TOC untitled-heading label must not be empty.");
  }

  return fallback;
}

function collectTocIndexEntries(
  doc: ProseMirrorNode,
  nodeTypes: TocNodeTypes,
  messages: TocMessages,
) {
  const headings: TocHeadingSnapshot[] = [];
  const tocs: TocNodeSnapshot[] = [];
  let headingIndex = 0;

  doc.descendants((node, position) => {
    if (node.type === nodeTypes.heading) {
      const level = headingLevel(node);

      if (level !== null) {
        headingIndex += 1;
        headings.push(Object.freeze({
          label: readTocHeadingLabel(node, level, headingIndex, messages),
          level,
          position,
        }));
      }
    } else if (node.type === nodeTypes.toc) {
      tocs.push(Object.freeze({ position }));
    }

    return true;
  });

  return { headings, tocs };
}

export function buildTocIndex(
  doc: ProseMirrorNode,
  nodeTypes: TocNodeTypes,
  messages: TocMessages,
): TocIndex {
  const { headings, tocs } = collectTocIndexEntries(doc, nodeTypes, messages);
  return createIndex(headings, tocs);
}

function fragmentContainsType(fragment: Fragment, nodeType: NodeType) {
  let found = false;

  fragment.descendants((node) => {
    found ||= node.type === nodeType;
    return !found;
  });

  return found;
}

function positionIsInsideType(
  doc: ProseMirrorNode,
  position: number,
  nodeType: NodeType,
) {
  const bounded = Math.max(0, Math.min(position, doc.content.size));
  const $position = doc.resolve(bounded);

  for (let depth = $position.depth; depth >= 0; depth -= 1) {
    if ($position.node(depth).type === nodeType) {
      return true;
    }
  }

  return false;
}

function sliceContainsType(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  nodeType: NodeType,
) {
  const boundedFrom = Math.max(0, Math.min(from, doc.content.size));
  const boundedTo = Math.max(boundedFrom, Math.min(to, doc.content.size));
  return boundedTo > boundedFrom
    && fragmentContainsType(doc.slice(boundedFrom, boundedTo).content, nodeType);
}

function changedRangeTouchesType(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  nodeType: NodeType,
) {
  if (sliceContainsType(doc, from, to, nodeType)) {
    return true;
  }

  const boundedFrom = Math.max(0, Math.min(from, doc.content.size));

  if (positionIsInsideType(doc, boundedFrom, nodeType)) {
    return true;
  }

  const boundedTo = Math.max(boundedFrom, Math.min(to, doc.content.size));
  return boundedTo > boundedFrom
    && positionIsInsideType(doc, boundedTo - 1, nodeType);
}

function stepTouchesType(
  transaction: Transaction,
  stepIndex: number,
  nodeType: NodeType,
) {
  const step = transaction.steps[stepIndex]!;
  const before = transaction.docs[stepIndex] ?? transaction.before;
  const after = transaction.docs[stepIndex + 1] ?? transaction.doc;
  let hasMappedRange = false;
  let touched = false;

  step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
    hasMappedRange = true;
    touched ||= changedRangeTouchesType(before, oldStart, oldEnd, nodeType)
      || changedRangeTouchesType(after, newStart, newEnd, nodeType);
  });

  const positionedStep = step as unknown as {
    from?: unknown;
    gapFrom?: unknown;
    gapTo?: unknown;
    pos?: unknown;
    to?: unknown;
  };

  // ReplaceAroundStep maps only its new wrapper boundaries. Its preserved gap
  // can contain a heading or TOC without either changed range containing that
  // node (for example, wrapping a root TOC in a blockquote).
  const hasDirectGap = typeof positionedStep.gapFrom === "number" && typeof positionedStep.gapTo === "number";
  if (
    hasDirectGap
    && sliceContainsType(before, positionedStep.gapFrom as number, positionedStep.gapTo as number, nodeType)
  ) {
    return true;
  }

  if (touched || hasMappedRange) {
    return touched;
  }

  const json = step.toJSON() as {
    from?: unknown;
    gapFrom?: unknown;
    gapTo?: unknown;
    pos?: unknown;
    to?: unknown;
  };

  if (
    !hasDirectGap
    && typeof json.gapFrom === "number"
    && typeof json.gapTo === "number"
    && sliceContainsType(before, json.gapFrom, json.gapTo, nodeType)
  ) {
    return true;
  }

  // Attribute-only steps carry an empty StepMap. Inspect their explicit
  // positions without treating an ordinary insertion at a node boundary as a
  // semantic edit of the adjacent heading/TOC.

  for (const value of [json.pos, json.from, json.to]) {
    if (typeof value !== "number") {
      continue;
    }

    const beforeNode = value >= 0 && value < before.content.size
      ? before.nodeAt(value)
      : null;
    const afterNode = value >= 0 && value < after.content.size
      ? after.nodeAt(value)
      : null;

    if (
      beforeNode?.type === nodeType
      || afterNode?.type === nodeType
      || positionIsInsideType(before, value, nodeType)
      || positionIsInsideType(after, value, nodeType)
    ) {
      return true;
    }
  }

  return false;
}

function transactionTouchesType(
  transaction: Transaction,
  nodeType: NodeType,
) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    if (stepTouchesType(transaction, index, nodeType)) {
      return true;
    }
  }

  return false;
}

export function transactionChangesTocSemantics(
  transaction: Transaction,
  nodeTypes: TocNodeTypes,
) {
  return transaction.docChanged && (
    transactionTouchesType(transaction, nodeTypes.heading)
    || transactionTouchesType(transaction, nodeTypes.toc)
  );
}

export function transactionChangesTocStructure(
  transaction: Transaction,
  nodeTypes: TocNodeTypes,
) {
  return transaction.docChanged
    && transactionTouchesType(transaction, nodeTypes.toc);
}

function headingSemanticsEqual(
  left: readonly TocHeadingSnapshot[],
  right: readonly TocHeadingSnapshot[],
) {
  return left.length === right.length && left.every((heading, index) => (
    heading.level === right[index]!.level
    && heading.label === right[index]!.label
  ));
}

function mapSnapshotPositions(
  previous: TocIndex,
  transaction: Transaction,
): TocIndex | null {
  if (previous.snapshot.headings.length === 0 && previous.snapshot.tocs.length === 0) {
    return previous;
  }

  const docSize = transaction.doc.content.size;
  const seenPositions = new Set<number>();
  const headings: TocHeadingSnapshot[] = [];
  const tocs: TocNodeSnapshot[] = [];
  let anyMoved = false;

  for (const heading of previous.snapshot.headings) {
    const position = transaction.mapping.map(heading.position, 1);

    if (position < 0 || position >= docSize || seenPositions.has(position)) {
      return null;
    }
    seenPositions.add(position);

    if (position === heading.position) {
      headings.push(heading);
    } else {
      anyMoved = true;
      headings.push(Object.freeze({ ...heading, position }));
    }
  }

  for (const toc of previous.snapshot.tocs) {
    const position = transaction.mapping.map(toc.position, 1);

    if (position < 0 || position >= docSize || seenPositions.has(position)) {
      return null;
    }
    seenPositions.add(position);

    if (position === toc.position) {
      tocs.push(toc);
    } else {
      anyMoved = true;
      tocs.push(Object.freeze({ position }));
    }
  }

  return anyMoved ? createIndex(headings, tocs, previous.renderIdentity) : previous;
}

function tryUpdateSingleHeadingInPlace(
  previous: TocIndex,
  transaction: Transaction,
  nodeTypes: TocNodeTypes,
  messages: TocMessages,
): TocIndex | null {
  if (transaction.steps.length !== 1 || previous.snapshot.headings.length === 0) {
    return null;
  }

  const step = transaction.steps[0]!;
  let rangeCount = 0;
  let oldStart = 0;
  let oldEnd = 0;
  let newStart = 0;
  let newEnd = 0;
  step.getMap().forEach((oStart, oEnd, nStart, nEnd) => {
    rangeCount += 1;
    oldStart = oStart;
    oldEnd = oEnd;
    newStart = nStart;
    newEnd = nEnd;
  });

  if (rangeCount !== 1) {
    return null;
  }

  const before = transaction.before;
  const after = transaction.doc;
  const $oldStart = before.resolve(oldStart);
  const $oldEnd = before.resolve(oldEnd);
  const $newStart = after.resolve(newStart);
  const $newEnd = after.resolve(newEnd);

  if (
    $oldStart.parent.type !== nodeTypes.heading
    || !$oldStart.sameParent($oldEnd)
    || $newStart.parent.type !== nodeTypes.heading
    || !$newStart.sameParent($newEnd)
  ) {
    return null;
  }

  const oldHeadingPos = $oldStart.before();
  const newHeadingPos = $newStart.before();
  const oldLevel = headingLevel($oldStart.parent);
  const newLevel = headingLevel($newStart.parent);

  if (oldLevel === null || newLevel !== oldLevel || oldHeadingPos !== newHeadingPos) {
    return null;
  }

  const headingIdx = previous.snapshot.headings.findIndex(
    (entry) => entry.position === oldHeadingPos,
  );
  if (headingIdx < 0) {
    return null;
  }

  const nextLabel = readTocHeadingLabel(
    $newStart.parent,
    newLevel,
    headingIdx + 1,
    messages,
  );
  const labelChanged = nextLabel !== previous.snapshot.headings[headingIdx]!.label;

  const headings = previous.snapshot.headings.map((entry, idx) => {
    if (idx === headingIdx) {
      return labelChanged
        ? Object.freeze({ ...entry, label: nextLabel })
        : entry;
    }
    const position = idx < headingIdx
      ? entry.position
      : transaction.mapping.map(entry.position, 1);
    return position === entry.position
      ? entry
      : Object.freeze({ ...entry, position });
  });

  const tocs = previous.snapshot.tocs.map((entry) => {
    const position = entry.position < oldHeadingPos
      ? entry.position
      : transaction.mapping.map(entry.position, 1);
    return position === entry.position
      ? entry
      : Object.freeze({ position });
  });

  return createIndex(
    headings,
    tocs,
    labelChanged ? Object.freeze({}) : previous.renderIdentity,
  );
}

export function applyTocIndexTransaction(
  previous: TocIndex,
  transaction: Transaction,
  nodeTypes: TocNodeTypes,
  messages: TocMessages,
): TocIndex {
  if (!transaction.docChanged) {
    return previous;
  }

  const headingTouched = transactionTouchesType(
    transaction,
    nodeTypes.heading,
  );
  const tocTouched = transactionTouchesType(transaction, nodeTypes.toc);

  if (!headingTouched && !tocTouched) {
    const mapped = mapSnapshotPositions(previous, transaction);

    if (mapped) {
      return mapped;
    }
  }

  if (headingTouched && !tocTouched) {
    const updated = tryUpdateSingleHeadingInPlace(
      previous,
      transaction,
      nodeTypes,
      messages,
    );
    if (updated) {
      return updated;
    }
  }

  const { headings, tocs } = collectTocIndexEntries(
    transaction.doc,
    nodeTypes,
    messages,
  );
  const preserveRenderIdentity = !tocTouched && headingSemanticsEqual(
    previous.snapshot.headings,
    headings,
  );

  return createIndex(
    headings,
    tocs,
    preserveRenderIdentity ? previous.renderIdentity : Object.freeze({}),
  );
}

function findTocDocumentIssueAtStep(
  doc: ProseMirrorNode,
  nodeTypes: TocNodeTypes,
  stepIndex: number,
): TocDocumentIssue | null {
  let issue: TocDocumentIssue | null = null;

  doc.descendants((node, position, parent) => {
    if (issue) {
      return false;
    }

    if (node.type === nodeTypes.toc && parent !== doc) {
      issue = Object.freeze({
        parentType: parent?.type.name ?? doc.type.name,
        position,
        stepIndex,
      });
      return false;
    }

    return issue === null;
  });

  return issue;
}

export function findTocDocumentIssue(
  doc: ProseMirrorNode,
  nodeTypes: TocNodeTypes,
): TocDocumentIssue | null {
  return findTocDocumentIssueAtStep(doc, nodeTypes, -1);
}

/**
 * Find a nested TOC in every intermediate document, not only the final one.
 * The fast path avoids a document walk for transactions proven not to touch a
 * TOC node or one of its ancestors.
 */
export function findTocTransactionIssue(
  transaction: Transaction,
  nodeTypes: TocNodeTypes,
): TocDocumentIssue | null {
  if (!transactionChangesTocStructure(transaction, nodeTypes)) {
    return null;
  }

  const beforeIssue = findTocDocumentIssueAtStep(
    transaction.before,
    nodeTypes,
    -1,
  );

  if (beforeIssue) {
    return beforeIssue;
  }

  for (let index = 0; index < transaction.steps.length; index += 1) {
    const after = transaction.docs[index + 1] ?? transaction.doc;
    const issue = findTocDocumentIssueAtStep(after, nodeTypes, index);

    if (issue) {
      return issue;
    }
  }

  return null;
}
