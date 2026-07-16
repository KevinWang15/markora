import {
  MarkdownEditorExtensionError,
  isValidMarkdownEditorExtensionName,
  isValidMarkdownEditorLocalId,
  isValidMarkdownEditorQualifiedContributionId,
  type MarkdownEditorContributionOrderTarget,
  type MarkdownEditorExtensionErrorPhase,
  type MarkdownEditorOrderedContribution,
} from "./extensionApi";

export type MarkdownEditorOwnedOrderedContribution<
  TContribution extends MarkdownEditorOrderedContribution = MarkdownEditorOrderedContribution,
  TLane extends string = string,
> = Readonly<{
  owner: string;
  extensionResolvedIndex: number;
  declarationIndex: number;
  lane: TLane;
  contribution: TContribution;
}>;

export type MarkdownEditorResolvedOrderedContribution<
  TContribution extends MarkdownEditorOrderedContribution = MarkdownEditorOrderedContribution,
  TLane extends string = string,
> = MarkdownEditorOwnedOrderedContribution<TContribution, TLane> & Readonly<{
  qualifiedId: string;
}>;

export type OrderMarkdownEditorContributionsOptions = Readonly<{
  errorPhase: MarkdownEditorExtensionErrorPhase;
  contributionKind?: string;
}>;

type AnyResolvedContribution = MarkdownEditorResolvedOrderedContribution<
  MarkdownEditorOrderedContribution,
  string
>;

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareContributions(
  left: AnyResolvedContribution,
  right: AnyResolvedContribution,
) {
  return (
    left.extensionResolvedIndex - right.extensionResolvedIndex
    || left.declarationIndex - right.declarationIndex
    || compareStrings(left.qualifiedId, right.qualifiedId)
  );
}

function contributionError(options: {
  code: string;
  errorPhase: MarkdownEditorExtensionErrorPhase;
  message: string;
  extension?: string;
  participants?: readonly string[];
  contribution?: string;
}): never {
  throw new MarkdownEditorExtensionError({
    code: options.code,
    phase: options.errorPhase,
    message: options.message,
    extension: options.extension,
    participants: options.participants,
    contribution: options.contribution,
  });
}

function readTarget(
  target: MarkdownEditorContributionOrderTarget,
  item: AnyResolvedContribution,
  field: "after" | "before",
  options: OrderMarkdownEditorContributionsOptions,
) {
  const isOptionalTarget = (
    typeof target === "object"
    && target !== null
    && target.optional === true
  );
  const id = typeof target === "string"
    ? target
    : isOptionalTarget
      ? target.id
      : undefined;

  if (
    typeof id !== "string"
    || !isValidMarkdownEditorQualifiedContributionId(id)
  ) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${options.contributionKind ?? "Contribution"} "${item.qualifiedId}" has an invalid ${field} target. Targets must be qualified contribution IDs or { id, optional: true }.`,
      extension: item.owner,
      contribution: item.qualifiedId,
    });
  }

  return {
    id,
    optional: isOptionalTarget,
  };
}

function findOrderCycle(
  unresolvedIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, AnyResolvedContribution>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const states = new Map<string, "active" | "complete">();
  const stack: string[] = [];
  const compareIds = (left: string, right: string) => compareContributions(
    byId.get(left)!,
    byId.get(right)!,
  );

  const visit = (id: string): string[] | null => {
    const state = states.get(id);

    if (state === "active") {
      const cycleStart = stack.indexOf(id);
      return [...stack.slice(cycleStart), id];
    }

    if (state === "complete") {
      return null;
    }

    states.set(id, "active");
    stack.push(id);

    const targets = [...(outgoing.get(id) ?? [])]
      .filter((target) => unresolvedIds.has(target))
      .sort(compareIds);

    for (const target of targets) {
      const cycle = visit(target);

      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    states.set(id, "complete");
    return null;
  };

  for (const id of [...unresolvedIds].sort(compareIds)) {
    const cycle = visit(id);

    if (cycle) {
      return cycle;
    }
  }

  return [...unresolvedIds].sort(compareIds);
}

function resolveOwnedContribution<
  TContribution extends MarkdownEditorOrderedContribution,
  TLane extends string,
>(
  item: MarkdownEditorOwnedOrderedContribution<TContribution, TLane>,
  options: OrderMarkdownEditorContributionsOptions,
): MarkdownEditorResolvedOrderedContribution<TContribution, TLane> {
  const kind = options.contributionKind ?? "Contribution";

  if (!isValidMarkdownEditorExtensionName(item.owner)) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${kind} owner "${String(item.owner)}" is not a valid extension name.`,
    });
  }

  if (!Number.isInteger(item.extensionResolvedIndex) || item.extensionResolvedIndex < 0) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${kind} from "${item.owner}" must have a non-negative extension resolved index.`,
      extension: item.owner,
    });
  }

  if (!Number.isInteger(item.declarationIndex) || item.declarationIndex < 0) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${kind} from "${item.owner}" must have a non-negative declaration index.`,
      extension: item.owner,
    });
  }

  if (typeof item.lane !== "string" || item.lane.length === 0) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${kind} from "${item.owner}" must belong to a non-empty lane.`,
      extension: item.owner,
    });
  }

  if (
    typeof item.contribution !== "object"
    || item.contribution === null
    || !isValidMarkdownEditorLocalId(item.contribution.id)
  ) {
    contributionError({
      code: "EXTENSION_INVALID_DEFINITION",
      errorPhase: options.errorPhase,
      message: `${kind} from "${item.owner}" must have a local ID that starts with a lowercase letter and contains only lowercase letters, digits, dots, dashes, or underscores.`,
      extension: item.owner,
      contribution: typeof item.contribution?.id === "string"
        ? item.contribution.id
        : undefined,
    });
  }

  for (const field of ["before", "after"] as const) {
    const targets = item.contribution[field];

    if (targets !== undefined && !Array.isArray(targets)) {
      contributionError({
        code: "EXTENSION_INVALID_DEFINITION",
        errorPhase: options.errorPhase,
        message: `${kind} "${item.owner}/${item.contribution.id}" must provide ${field} as an array.`,
        extension: item.owner,
        contribution: `${item.owner}/${item.contribution.id}`,
      });
    }
  }

  return Object.freeze({
    ...item,
    qualifiedId: `${item.owner}/${item.contribution.id}`,
  });
}

/**
 * Qualifies, validates, and deterministically orders one collected contribution
 * kind. Ordering edges may use both `before` and `after`; missing optional
 * targets are ignored, while installed targets must belong to the same lane.
 *
 * @internal Public extension definitions expose the contribution shapes, but
 * only the editor compiler uses this graph utility.
 */
export function orderMarkdownEditorContributions<
  TContribution extends MarkdownEditorOrderedContribution,
  TLane extends string,
>(
  contributions: readonly MarkdownEditorOwnedOrderedContribution<
    TContribution,
    TLane
  >[],
  options: OrderMarkdownEditorContributionsOptions,
): readonly MarkdownEditorResolvedOrderedContribution<TContribution, TLane>[] {
  const resolved = contributions.map((item) => resolveOwnedContribution(
    item,
    options,
  ));
  const byId = new Map<
    string,
    MarkdownEditorResolvedOrderedContribution<TContribution, TLane>
  >();

  for (const item of resolved) {
    const previous = byId.get(item.qualifiedId);

    if (previous) {
      contributionError({
        code: "EXTENSION_CONTRIBUTION_CONFLICT",
        errorPhase: options.errorPhase,
        message: `${options.contributionKind ?? "Contribution"} ID "${item.qualifiedId}" is declared more than once.`,
        extension: item.owner,
        participants: [item.qualifiedId],
        contribution: item.qualifiedId,
      });
    }

    byId.set(item.qualifiedId, item);
  }

  const outgoing = new Map(
    resolved.map((item) => [item.qualifiedId, new Set<string>()] as const),
  );
  const indegree = new Map<string, number>(
    resolved.map((item) => [item.qualifiedId, 0] as const),
  );

  const addEdge = (from: string, to: string) => {
    const targets = outgoing.get(from)!;

    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  };

  for (const item of resolved) {
    for (const field of ["before", "after"] as const) {
      const targets = item.contribution[field] ?? [];

      for (const targetReference of targets) {
        const target = readTarget(targetReference, item, field, options);
        const targetItem = byId.get(target.id);

        if (!targetItem) {
          if (target.optional) {
            continue;
          }

          contributionError({
            code: "EXTENSION_MISSING_DEPENDENCY",
            errorPhase: options.errorPhase,
            message: `${options.contributionKind ?? "Contribution"} "${item.qualifiedId}" has a required ${field} target "${target.id}" that is not installed.`,
            extension: item.owner,
            participants: [item.qualifiedId, target.id],
            contribution: item.qualifiedId,
          });
        }

        if (targetItem.lane !== item.lane) {
          contributionError({
            code: "EXTENSION_INVALID_DEFINITION",
            errorPhase: options.errorPhase,
            message: `${options.contributionKind ?? "Contribution"} "${item.qualifiedId}" in lane "${item.lane}" cannot target "${target.id}" in lane "${targetItem.lane}".`,
            extension: item.owner,
            participants: [item.qualifiedId, target.id],
            contribution: item.qualifiedId,
          });
        }

        if (field === "before") {
          addEdge(item.qualifiedId, target.id);
        } else {
          addEdge(target.id, item.qualifiedId);
        }
      }
    }
  }

  const ready = resolved
    .filter((item) => indegree.get(item.qualifiedId) === 0)
    .sort(compareContributions);
  const ordered: MarkdownEditorResolvedOrderedContribution<
    TContribution,
    TLane
  >[] = [];

  while (ready.length > 0) {
    const item = ready.shift()!;
    ordered.push(item);

    const targets = [...outgoing.get(item.qualifiedId)!]
      .map((id) => byId.get(id)!)
      .sort(compareContributions);

    for (const target of targets) {
      const nextIndegree = indegree.get(target.qualifiedId)! - 1;
      indegree.set(target.qualifiedId, nextIndegree);

      if (nextIndegree === 0) {
        ready.push(target);
        ready.sort(compareContributions);
      }
    }
  }

  if (ordered.length !== resolved.length) {
    const orderedIds = new Set(ordered.map((item) => item.qualifiedId));
    const unresolvedIds = new Set(
      resolved
        .filter((item) => !orderedIds.has(item.qualifiedId))
        .map((item) => item.qualifiedId),
    );
    const cycle = findOrderCycle(unresolvedIds, byId, outgoing);
    const participants = cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]
      ? cycle.slice(0, -1)
      : cycle;

    contributionError({
      code: "EXTENSION_ORDER_CYCLE",
      errorPhase: options.errorPhase,
      message: `${options.contributionKind ?? "Contribution"} ordering contains a cycle: ${cycle.join(" -> ")}.`,
      participants,
      contribution: participants[0],
    });
  }

  Object.freeze(ordered);
  return ordered;
}
