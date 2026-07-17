import { sanitizeCodeBlockDomInfo } from "./codeBlockMarkdown";
import type { MarkdownEditorSchemaEntry } from "./extensionApi";

export type MarkdownEditorOrderedSchemaMap<TSpec> = Readonly<{
  get(name: string): TSpec | undefined;
  addBefore(
    place: string,
    key: string,
    value: TSpec,
  ): MarkdownEditorOrderedSchemaMap<TSpec>;
  addToEnd(key: string, value: TSpec): MarkdownEditorOrderedSchemaMap<TSpec>;
  update(key: string, value: TSpec): MarkdownEditorOrderedSchemaMap<TSpec>;
  forEach(callback: (name: string, value: TSpec) => void): void;
}>;

export type MarkdownEditorOwnedSchemaEntry<TSpec> = Readonly<{
  owner: string;
  entry: MarkdownEditorSchemaEntry<TSpec>;
}>;

export function codeBlockDomAttrs(dom: Node | string) {
  if (typeof dom === "string" || dom.nodeType !== 1) return { params: "" };
  const element = dom as Element;
  const internal = sanitizeCodeBlockDomInfo(element.getAttribute("data-params"));
  if (internal != null) return { params: internal };
  const language = element.querySelector("code")?.getAttribute("class")?.match(
    /(?:^|\s)(?:lang|language)-([A-Za-z0-9_+-]{1,64})(?:\s|$)/,
  );
  return { params: language?.[1] ?? "" };
}

export type MarkdownEditorSchemaOrderFailure = Readonly<{
  code: string;
  message: string;
  extension?: string;
  contribution?: string;
  participants?: readonly string[];
}>;

type SchemaEntryRecord<TSpec> = MarkdownEditorOwnedSchemaEntry<TSpec> & Readonly<{
  fallbackIndex: number;
}>;

type SchemaTarget<TSpec> =
  | Readonly<{ kind: "foundation"; index: number }>
  | Readonly<{ kind: "contribution"; record: SchemaEntryRecord<TSpec> }>
  | Readonly<{ kind: "missing-optional" }>
  | null;

function targetName<TSpec>(entry: MarkdownEditorSchemaEntry<TSpec>) {
  const target = entry.before ?? entry.after;
  return typeof target === "string" ? target : target?.name;
}

function targetIsOptional<TSpec>(entry: MarkdownEditorSchemaEntry<TSpec>) {
  const target = entry.before ?? entry.after;
  return typeof target === "object" && target?.optional === true;
}

function compareRecords<TSpec>(
  left: SchemaEntryRecord<TSpec>,
  right: SchemaEntryRecord<TSpec>,
) {
  return left.fallbackIndex - right.fallbackIndex;
}

function findOrderCycle<TSpec>(
  unresolved: ReadonlySet<string>,
  byName: ReadonlyMap<string, SchemaEntryRecord<TSpec>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const states = new Map<string, "active" | "complete">();
  const stack: string[] = [];
  const compareNames = (left: string, right: string) => compareRecords(
    byName.get(left)!,
    byName.get(right)!,
  );

  const visit = (name: string): string[] | null => {
    const state = states.get(name);

    if (state === "active") {
      return [...stack.slice(stack.indexOf(name)), name];
    }

    if (state === "complete") {
      return null;
    }

    states.set(name, "active");
    stack.push(name);

    for (const target of [...(outgoing.get(name) ?? [])]
      .filter((candidate) => unresolved.has(candidate))
      .sort(compareNames)) {
      const cycle = visit(target);

      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    states.set(name, "complete");
    return null;
  };

  for (const name of [...unresolved].sort(compareNames)) {
    const cycle = visit(name);

    if (cycle) {
      return cycle;
    }
  }

  return [...unresolved].sort(compareNames);
}

/**
 * Compile additive schema entries into the gaps around the immutable
 * foundation order. Entries that target another contribution inherit that
 * contribution's foundation gap, then a stable topological sort applies the
 * local before/after edges. This keeps otherwise-unconstrained entries in
 * resolved/declaration order while supporting forward installed targets.
 */
export function compileMarkdownEditorSchemaEntries<TSpec>(options: Readonly<{
  foundation: MarkdownEditorOrderedSchemaMap<TSpec>;
  entries: readonly MarkdownEditorOwnedSchemaEntry<TSpec>[];
  kind: "mark" | "node";
  missingTargetCode: string;
  fail(failure: MarkdownEditorSchemaOrderFailure): never;
}>): MarkdownEditorOrderedSchemaMap<TSpec> {
  const foundationNames: string[] = [];
  options.foundation.forEach((name) => foundationNames.push(name));
  const foundationIndexes = new Map(
    foundationNames.map((name, index) => [name, index] as const),
  );
  const records = options.entries.map((owned, fallbackIndex) => ({
    ...owned,
    fallbackIndex,
  }));
  const byName = new Map<string, SchemaEntryRecord<TSpec>>();

  for (const record of records) {
    const name = record.entry.name;

    if (foundationIndexes.has(name) || byName.has(name)) {
      options.fail({
        code: "EXTENSION_CONTRIBUTION_CONFLICT",
        message: `Schema ${options.kind} "${name}" is already owned by the foundation or another extension.`,
        extension: record.owner,
        contribution: name,
        participants: [name],
      });
    }

    byName.set(name, record);
  }

  const targets = new Map<string, SchemaTarget<TSpec>>();

  for (const record of records) {
    const name = targetName(record.entry);

    if (!name) {
      targets.set(record.entry.name, null);
      continue;
    }

    const foundationIndex = foundationIndexes.get(name);

    if (foundationIndex !== undefined) {
      targets.set(record.entry.name, {
        kind: "foundation",
        index: foundationIndex,
      });
      continue;
    }

    const contribution = byName.get(name);

    if (contribution) {
      targets.set(record.entry.name, {
        kind: "contribution",
        record: contribution,
      });
      continue;
    }

    if (targetIsOptional(record.entry)) {
      targets.set(record.entry.name, { kind: "missing-optional" });
      continue;
    }

    options.fail({
      code: options.missingTargetCode,
      message: `Schema ${options.kind} "${record.entry.name}" targets missing ${options.kind} "${name}".`,
      extension: record.owner,
      contribution: record.entry.name,
      participants: [record.entry.name, name],
    });
  }

  const finalGap = foundationNames.length;
  const gapByName = new Map<string, number>();
  const resolvingGaps = new Set<string>();

  const resolveGap = (record: SchemaEntryRecord<TSpec>): number => {
    const name = record.entry.name;
    const cached = gapByName.get(name);

    if (cached !== undefined) {
      return cached;
    }

    // A target-reference cycle has no foundation anchor. Its actual ordering
    // validity is decided by the directed before/after graph below.
    if (resolvingGaps.has(name)) {
      return finalGap;
    }

    resolvingGaps.add(name);
    const target = targets.get(name) ?? null;
    let gap = finalGap;

    if (target?.kind === "foundation") {
      gap = record.entry.before ? target.index : target.index + 1;
    } else if (target?.kind === "contribution") {
      gap = resolveGap(target.record);
    }

    resolvingGaps.delete(name);
    gapByName.set(name, gap);
    return gap;
  };

  const recordsByGap = Array.from(
    { length: foundationNames.length + 1 },
    () => [] as SchemaEntryRecord<TSpec>[],
  );

  for (const record of records) {
    recordsByGap[resolveGap(record)]!.push(record);
  }

  let result = options.foundation;

  for (let gap = 0; gap < recordsByGap.length; gap += 1) {
    const gapRecords = recordsByGap[gap]!;
    const gapNames = new Set(gapRecords.map(({ entry }) => entry.name));
    const outgoing = new Map(
      gapRecords.map(({ entry }) => [entry.name, new Set<string>()] as const),
    );
    const indegree = new Map<string, number>(
      gapRecords.map(({ entry }) => [entry.name, 0] as const),
    );

    const addEdge = (from: string, to: string) => {
      const destinations = outgoing.get(from)!;

      if (!destinations.has(to)) {
        destinations.add(to);
        indegree.set(to, indegree.get(to)! + 1);
      }
    };

    for (const record of gapRecords) {
      const target = targets.get(record.entry.name);

      if (target?.kind !== "contribution") {
        continue;
      }

      if (record.entry.before) {
        addEdge(record.entry.name, target.record.entry.name);
      } else {
        addEdge(target.record.entry.name, record.entry.name);
      }
    }

    const ready = gapRecords
      .filter(({ entry }) => indegree.get(entry.name) === 0)
      .sort(compareRecords);
    const ordered: SchemaEntryRecord<TSpec>[] = [];

    while (ready.length > 0) {
      const record = ready.shift()!;
      ordered.push(record);

      const destinations = [...outgoing.get(record.entry.name)!]
        .map((name) => byName.get(name)!)
        .sort(compareRecords);

      for (const destination of destinations) {
        const nextIndegree = indegree.get(destination.entry.name)! - 1;
        indegree.set(destination.entry.name, nextIndegree);

        if (nextIndegree === 0) {
          ready.push(destination);
          ready.sort(compareRecords);
        }
      }
    }

    if (ordered.length !== gapRecords.length) {
      const orderedNames = new Set(ordered.map(({ entry }) => entry.name));
      const unresolved = new Set(
        [...gapNames].filter((name) => !orderedNames.has(name)),
      );
      const cycle = findOrderCycle(unresolved, byName, outgoing);
      const participants = cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]
        ? cycle.slice(0, -1)
        : cycle;

      options.fail({
        code: "EXTENSION_ORDER_CYCLE",
        message: `Schema ${options.kind} ordering contains a cycle: ${cycle.join(" -> ")}.`,
        contribution: participants[0],
        participants,
      });
    }

    const boundary = foundationNames[gap];

    for (const record of ordered) {
      result = boundary
        ? result.addBefore(boundary, record.entry.name, record.entry.spec)
        : result.addToEnd(record.entry.name, record.entry.spec);
    }
  }

  return result;
}
