import type {
  Fragment,
  Node as ProseMirrorNode,
  NodeType,
  Transaction,
} from "markora/extension-api";
import type { FootnotesMessages } from "./messages";
import { normalizeFootnoteLabel } from "./tokenizer";

export const footnoteDiagnosticCodes = Object.freeze([
  "duplicate-definition",
  "unresolved-reference",
] as const);

export type FootnoteDiagnosticCode = (typeof footnoteDiagnosticCodes)[number];

export type FootnoteDiagnostic = Readonly<{
  code: FootnoteDiagnosticCode;
  label: string;
  message: string;
  occurrence: number;
  position: number;
}>;

export type FootnoteReferenceSnapshot = Readonly<{
  definitionPosition: number | null;
  label: string;
  number: number;
  occurrence: number;
  position: number;
}>;

export type FootnoteDefinitionSnapshot = Readonly<{
  duplicate: boolean;
  label: string;
  number: number;
  occurrence: number;
  position: number;
  referencePositions: readonly number[];
}>;

export type FootnotesSnapshot = Readonly<{
  definitions: readonly FootnoteDefinitionSnapshot[];
  diagnostics: readonly FootnoteDiagnostic[];
  references: readonly FootnoteReferenceSnapshot[];
}>;

type RawFootnoteEntry = Readonly<{
  label: string;
  position: number;
}>;

export type FootnoteNodeTypes = Readonly<{
  definition: NodeType;
  reference: NodeType;
}>;

export type FootnoteIndex = Readonly<{
  definitionByPosition: ReadonlyMap<number, FootnoteDefinitionSnapshot>;
  definitionOrderByPosition: ReadonlyMap<number, number>;
  definitionsByLabel: ReadonlyMap<string, readonly FootnoteDefinitionSnapshot[]>;
  renderIdentity: object;
  referenceByPosition: ReadonlyMap<number, FootnoteReferenceSnapshot>;
  referenceOrderByPosition: ReadonlyMap<number, number>;
  referencesByLabel: ReadonlyMap<string, readonly FootnoteReferenceSnapshot[]>;
  snapshot: FootnotesSnapshot;
}>;

function readLabel(node: ProseMirrorNode) {
  return typeof node.attrs.label === "string" ? node.attrs.label : "";
}

function appendByLabel<T extends { label: string }>(
  map: Map<string, T[]>,
  value: T,
) {
  const values = map.get(value.label);

  if (values) {
    values.push(value);
  } else {
    map.set(value.label, [value]);
  }
}

function freezeGrouped<T>(map: Map<string, T[]>) {
  return new Map(
    [...map].map(([label, values]) => [label, Object.freeze(values)] as const),
  ) as ReadonlyMap<string, readonly T[]>;
}

function createFootnoteIndexFromSnapshots(
  references: FootnoteReferenceSnapshot[],
  definitions: FootnoteDefinitionSnapshot[],
  diagnostics: FootnoteDiagnostic[],
  renderIdentity: object,
): FootnoteIndex {
  const frozenReferences = Object.freeze(references);
  const frozenDefinitions = Object.freeze(definitions);
  const frozenDiagnostics = Object.freeze(diagnostics);
  const referencesByLabel = new Map<string, FootnoteReferenceSnapshot[]>();
  const definitionsByLabel = new Map<string, FootnoteDefinitionSnapshot[]>();

  for (const reference of frozenReferences) appendByLabel(referencesByLabel, reference);
  for (const definition of frozenDefinitions) appendByLabel(definitionsByLabel, definition);

  return Object.freeze({
    definitionByPosition: new Map(
      frozenDefinitions.map((definition) => [definition.position, definition]),
    ),
    definitionOrderByPosition: new Map(
      frozenDefinitions.map((definition, index) => [definition.position, index + 1]),
    ),
    definitionsByLabel: freezeGrouped(definitionsByLabel),
    renderIdentity,
    referenceByPosition: new Map(
      frozenReferences.map((reference) => [reference.position, reference]),
    ),
    referenceOrderByPosition: new Map(
      frozenReferences.map((reference, index) => [reference.position, index + 1]),
    ),
    referencesByLabel: freezeGrouped(referencesByLabel),
    snapshot: Object.freeze({
      definitions: frozenDefinitions,
      diagnostics: frozenDiagnostics,
      references: frozenReferences,
    }),
  });
}

function buildFootnoteIndexFromEntries(
  rawReferences: readonly RawFootnoteEntry[],
  rawDefinitions: readonly RawFootnoteEntry[],
  messages: FootnotesMessages,
): FootnoteIndex {
  const orderedReferences = [...rawReferences].sort((left, right) => (
    left.position - right.position
  ));
  const orderedDefinitions = [...rawDefinitions].sort((left, right) => (
    left.position - right.position
  ));
  const numberByLabel = new Map<string, number>();
  let nextNumber = 1;

  for (const entry of [...orderedReferences, ...orderedDefinitions]) {
    if (!numberByLabel.has(entry.label)) {
      numberByLabel.set(entry.label, nextNumber);
      nextNumber += 1;
    }
  }

  const rawDefinitionsByLabel = new Map<string, RawFootnoteEntry[]>();
  const rawReferencesByLabel = new Map<string, RawFootnoteEntry[]>();

  for (const entry of orderedDefinitions) appendByLabel(rawDefinitionsByLabel, entry);
  for (const entry of orderedReferences) appendByLabel(rawReferencesByLabel, entry);

  const references: FootnoteReferenceSnapshot[] = [];
  const definitions: FootnoteDefinitionSnapshot[] = [];
  const diagnostics: FootnoteDiagnostic[] = [];
  const referenceOccurrence = new Map<string, number>();
  const definitionOccurrence = new Map<string, number>();

  for (const entry of orderedReferences) {
    const occurrence = (referenceOccurrence.get(entry.label) ?? 0) + 1;
    referenceOccurrence.set(entry.label, occurrence);
    const definitionPosition = rawDefinitionsByLabel.get(entry.label)?.[0]?.position ?? null;
    const reference = Object.freeze({
      definitionPosition,
      label: entry.label,
      number: numberByLabel.get(entry.label)!,
      occurrence,
      position: entry.position,
    });
    references.push(reference);

    if (definitionPosition === null) {
      diagnostics.push(Object.freeze({
        code: "unresolved-reference" as const,
        label: entry.label,
        message: messages.unresolvedReferenceDiagnostic(entry.label, occurrence),
        occurrence,
        position: entry.position,
      }));
    }
  }

  for (const entry of orderedDefinitions) {
    const occurrence = (definitionOccurrence.get(entry.label) ?? 0) + 1;
    definitionOccurrence.set(entry.label, occurrence);
    const definition = Object.freeze({
      duplicate: occurrence > 1,
      label: entry.label,
      number: numberByLabel.get(entry.label)!,
      occurrence,
      position: entry.position,
      // Only the first definition resolves a label. Duplicates remain fully
      // represented and diagnosed, but must not claim another definition's
      // back-reference relationships.
      referencePositions: Object.freeze(occurrence === 1
        ? (rawReferencesByLabel.get(entry.label) ?? []).map(({ position }) => position)
        : []),
    });
    definitions.push(definition);

    if (definition.duplicate) {
      diagnostics.push(Object.freeze({
        code: "duplicate-definition" as const,
        label: entry.label,
        message: messages.duplicateDefinitionDiagnostic(entry.label, occurrence),
        occurrence,
        position: entry.position,
      }));
    }
  }

  diagnostics.sort((left, right) => (
    left.position - right.position || left.code.localeCompare(right.code)
  ));
  return createFootnoteIndexFromSnapshots(
    references,
    definitions,
    diagnostics,
    Object.freeze({}),
  );
}

export function buildFootnoteIndex(
  doc: ProseMirrorNode,
  nodeTypes: FootnoteNodeTypes,
  messages: FootnotesMessages,
) {
  const references: RawFootnoteEntry[] = [];
  const definitions: RawFootnoteEntry[] = [];

  doc.descendants((node, position) => {
    if (node.type === nodeTypes.reference) {
      references.push({ label: readLabel(node), position });
    } else if (node.type === nodeTypes.definition) {
      definitions.push({ label: readLabel(node), position });
    }
    return true;
  });

  return buildFootnoteIndexFromEntries(references, definitions, messages);
}

function fragmentHasFootnoteNode(
  fragment: Fragment,
  nodeTypes: FootnoteNodeTypes,
) {
  let found = false;

  fragment.descendants((node) => {
    found ||= node.type === nodeTypes.reference || node.type === nodeTypes.definition;
    return !found;
  });
  return found;
}

function nodeAtIsFootnote(
  doc: ProseMirrorNode,
  position: number,
  nodeTypes: FootnoteNodeTypes,
) {
  const node = doc.nodeAt(position);
  return node?.type === nodeTypes.reference || node?.type === nodeTypes.definition;
}

export function transactionChangesFootnoteStructure(
  transaction: Transaction,
  nodeTypes: FootnoteNodeTypes,
) {
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index]!;
    const before = transaction.docs[index] ?? transaction.before;
    const after = transaction.docs[index + 1] ?? transaction.doc;
    let hasMappedRange = false;
    let changed = false;

    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      hasMappedRange = true;

      if (
        oldEnd > oldStart
        && fragmentHasFootnoteNode(before.slice(oldStart, oldEnd).content, nodeTypes)
      ) {
        changed = true;
      }

      if (
        !changed
        && newEnd > newStart
        && fragmentHasFootnoteNode(after.slice(newStart, newEnd).content, nodeTypes)
      ) {
        changed = true;
      }
    });

    if (changed) {
      return true;
    }

    if (!hasMappedRange) {
      const json = step.toJSON() as {
        from?: unknown;
        pos?: unknown;
        to?: unknown;
      };

      if (
        typeof json.from === "number"
        && typeof json.to === "number"
        && json.to > json.from
        && (
          fragmentHasFootnoteNode(
            before.slice(json.from, json.to).content,
            nodeTypes,
          )
          || fragmentHasFootnoteNode(
            after.slice(json.from, json.to).content,
            nodeTypes,
          )
        )
      ) {
        return true;
      }

      if (
        typeof json.pos === "number"
        && (
          nodeAtIsFootnote(before, json.pos, nodeTypes)
          || nodeAtIsFootnote(after, json.pos, nodeTypes)
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export type FootnoteDocumentIssue = Readonly<
  | { kind: "invalid-label"; label: string }
  | { kind: "invalid-reference-context"; label: string }
  | { kind: "nested-definition"; label: string }
>;

export function findFootnoteDocumentIssue(
  doc: ProseMirrorNode,
  nodeTypes: FootnoteNodeTypes,
): FootnoteDocumentIssue | null {
  const visit = (
    node: ProseMirrorNode,
    insideDefinition: boolean,
  ): FootnoteDocumentIssue | null => {
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      const isDefinition = child.type === nodeTypes.definition;

      if (isDefinition || child.type === nodeTypes.reference) {
        const label = readLabel(child);

        if (normalizeFootnoteLabel(label) !== label) {
          return Object.freeze({ kind: "invalid-label", label });
        }

        if (
          child.type === nodeTypes.reference
          && child.marks.some((mark) => mark.type.spec.code)
        ) {
          return Object.freeze({
            kind: "invalid-reference-context",
            label,
          });
        }

        if (isDefinition && insideDefinition) {
          return Object.freeze({ kind: "nested-definition", label });
        }
      }

      const issue = visit(child, insideDefinition || isDefinition);
      if (issue) return issue;
    }

    return null;
  };

  return visit(doc, false);
}

function mapFootnoteIndexPositions(
  previous: FootnoteIndex,
  transaction: Transaction,
) {
  const mapPosition = (position: number) => transaction.mapping.map(position, 1);
  const references = previous.snapshot.references.map((reference) => Object.freeze({
    ...reference,
    definitionPosition: reference.definitionPosition === null
      ? null
      : mapPosition(reference.definitionPosition),
    position: mapPosition(reference.position),
  }));
  const definitions = previous.snapshot.definitions.map((definition) => Object.freeze({
    ...definition,
    position: mapPosition(definition.position),
    referencePositions: Object.freeze(
      definition.referencePositions.map(mapPosition),
    ),
  }));
  const diagnostics = previous.snapshot.diagnostics.map((diagnostic) => Object.freeze({
    ...diagnostic,
    position: mapPosition(diagnostic.position),
  }));

  // A transaction proven not to add, remove, relabel, or remark a footnote
  // preserves document order, numbering, diagnostics, and rendered controls.
  // Only public/model positions need to follow its mapping. Keeping the render
  // identity lets the view avoid repainting every retained NodeView while a
  // user types ordinary text elsewhere in the document.
  return createFootnoteIndexFromSnapshots(
    references,
    definitions,
    diagnostics,
    previous.renderIdentity,
  );
}

export function applyFootnoteIndexTransaction(
  previous: FootnoteIndex,
  transaction: Transaction,
  nodeTypes: FootnoteNodeTypes,
  messages: FootnotesMessages,
) {
  if (!transaction.docChanged) {
    return previous;
  }

  if (transactionChangesFootnoteStructure(transaction, nodeTypes)) {
    return buildFootnoteIndex(transaction.doc, nodeTypes, messages);
  }

  if (
    previous.snapshot.references.length === 0
    && previous.snapshot.definitions.length === 0
  ) {
    return previous;
  }

  return mapFootnoteIndexPositions(previous, transaction);
}
