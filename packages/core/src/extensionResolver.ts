import {
  MARKORA_EXTENSION_API_VERSION,
  MarkdownEditorExtensionError,
  readMarkdownEditorExtensionDefinition,
  readMarkdownEditorExtensionPreset,
  type AnyMarkdownEditorExtension,
  type InternalMarkdownEditorExtensionDefinition,
  type MarkdownEditorExtensionManifest,
  type MarkdownEditorExtensionOrderTarget,
  type MarkdownEditorExtensionPreset,
} from "./extensionApi";
import {
  markdownEditorSemVerSatisfies,
  parseMarkdownEditorSemVer,
} from "./extensionSemver";

export type ResolveMarkdownEditorExtensionsOptions = Readonly<{
  markoraVersion: string;
  preset?: MarkdownEditorExtensionPreset;
  extensions?: readonly AnyMarkdownEditorExtension[];
}>;

export type ResolvedMarkdownEditorExtension = Readonly<{
  extension: AnyMarkdownEditorExtension;
  definition: InternalMarkdownEditorExtensionDefinition;
  registrationIndex: number;
}>;

export type MarkdownEditorExtensionResolution = Readonly<{
  extensions: readonly ResolvedMarkdownEditorExtension[];
  manifest: MarkdownEditorExtensionManifest;
}>;

function resolutionError(options: {
  code: string;
  message: string;
  extension?: string;
  participants?: readonly string[];
  cause?: unknown;
}): never {
  throw new MarkdownEditorExtensionError({
    ...options,
    phase: "resolve",
  });
}

function isCompatibilityAdapterConfiguration(value: unknown) {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (value as Readonly<Record<string, unknown>>).adapter
      === "compatibility-foundation"
  );
}

/** @internal Reject definitions whose declared runtime is not being compiled. */
export function assertMarkdownEditorCompatibilityRuntimeActive(
  resolution: MarkdownEditorExtensionResolution,
  rootDefaultRuntimeActive: boolean,
) {
  if (rootDefaultRuntimeActive) {
    return;
  }

  const inactive = resolution.extensions
    .filter(({ definition }) => {
      return (
        definition.compatibility.runtime === "root-default"
        || (
          definition.name.startsWith("@markora/")
          && isCompatibilityAdapterConfiguration(definition.configuration)
        )
      );
    })
    .map(({ definition }) => definition.name);

  if (inactive.length > 0) {
    resolutionError({
      code: "EXTENSION_INCOMPATIBLE",
      message: `Extensions requiring the compatibility runtime must use the root entry's exact default preset: ${inactive.join(", ")}.`,
      ...(inactive.length === 1
        ? { extension: inactive[0] }
        : { participants: inactive }),
    });
  }
}

function targetName(target: MarkdownEditorExtensionOrderTarget) {
  return typeof target === "string" ? target : target.name;
}

function targetIsOptional(target: MarkdownEditorExtensionOrderTarget) {
  return typeof target !== "string" && target.optional;
}

function freezeManifest(
  resolved: readonly ResolvedMarkdownEditorExtension[],
  preset: ReturnType<typeof readMarkdownEditorExtensionPreset> | undefined,
): MarkdownEditorExtensionManifest {
  const extensions = resolved.map(({ definition }) => Object.freeze({
    name: definition.name,
    version: definition.version,
    ...(definition.configuration !== undefined
      ? { configuration: definition.configuration }
      : {}),
  }));
  Object.freeze(extensions);

  const manifest: MarkdownEditorExtensionManifest = {
    extensionApi: MARKORA_EXTENSION_API_VERSION,
    ...(preset?.name !== undefined && preset.version !== undefined
      ? {
          preset: Object.freeze({
            name: preset.name,
            version: preset.version,
          }),
        }
      : {}),
    extensions,
  };
  return Object.freeze(manifest);
}

function findOrderCycle(
  unresolved: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  compareNames: (left: string, right: string) => number,
) {
  const state = new Map<string, "active" | "complete">();
  const stack: string[] = [];

  const visit = (name: string): string[] | null => {
    const currentState = state.get(name);

    if (currentState === "active") {
      const cycleStart = stack.indexOf(name);
      return [...stack.slice(cycleStart), name];
    }

    if (currentState === "complete") {
      return null;
    }

    state.set(name, "active");
    stack.push(name);
    const targets = [...(outgoing.get(name) ?? [])]
      .filter((target) => unresolved.has(target))
      .sort(compareNames);

    for (const target of targets) {
      const cycle = visit(target);

      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    state.set(name, "complete");
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
 * Resolve authentic extension definitions without touching an editor, DOM,
 * schema, or tokenizer. The returned order and manifest are deeply immutable.
 *
 * @internal The public extension entry exports definition helpers and types;
 * the editor compiler consumes this resolver from its private module graph.
 */
export function resolveMarkdownEditorExtensions(
  options: ResolveMarkdownEditorExtensionsOptions,
): MarkdownEditorExtensionResolution {
  if (typeof options !== "object" || options === null) {
    resolutionError({
      code: "EXTENSION_INVALID_DEFINITION",
      message: "Extension resolution options must be an object.",
    });
  }

  let markoraVersion: unknown;
  let requestedPreset: unknown;
  let additionalExtensions: unknown;

  try {
    markoraVersion = options.markoraVersion;
    requestedPreset = options.preset;
    additionalExtensions = options.extensions;
  } catch (cause) {
    resolutionError({
      code: "EXTENSION_INVALID_DEFINITION",
      message: "Extension resolution options could not be read.",
      cause,
    });
  }

  if (
    additionalExtensions !== undefined
    && !Array.isArray(additionalExtensions)
  ) {
    resolutionError({
      code: "EXTENSION_INVALID_DEFINITION",
      message: "Additional extensions must be an array.",
    });
  }

  if (
    typeof markoraVersion !== "string"
    || !parseMarkdownEditorSemVer(markoraVersion)
  ) {
    resolutionError({
      code: "EXTENSION_INCOMPATIBLE",
      message: "The Markora compiler version must be a valid SemVer version.",
    });
  }

  const preset = requestedPreset !== undefined
    ? readMarkdownEditorExtensionPreset(
        requestedPreset as MarkdownEditorExtensionPreset,
      )
    : undefined;
  const registered = [
    ...(preset?.extensions ?? []),
    ...(additionalExtensions ?? []),
  ];
  const byName = new Map<string, ResolvedMarkdownEditorExtension>();
  const unresolved: ResolvedMarkdownEditorExtension[] = [];

  registered.forEach((extension, registrationIndex) => {
    const definition = readMarkdownEditorExtensionDefinition(extension);
    const previous = byName.get(definition.name);

    if (previous) {
      resolutionError({
        code: "EXTENSION_CONFLICT",
        message: `Extension "${definition.name}" is declared by both definition #${previous.registrationIndex + 1} and definition #${registrationIndex + 1}.`,
        participants: [definition.name],
      });
    }

    const item = Object.freeze({
      extension,
      definition,
      registrationIndex,
    });
    byName.set(definition.name, item);
    unresolved.push(item);
  });

  for (const item of unresolved) {
    const { compatibility, name } = item.definition;

    if (!markdownEditorSemVerSatisfies(
      MARKORA_EXTENSION_API_VERSION,
      compatibility.extensionApi,
    )) {
      resolutionError({
        code: "EXTENSION_INCOMPATIBLE",
        message: `Extension "${name}" requires extension API "${compatibility.extensionApi}", but Markora provides "${MARKORA_EXTENSION_API_VERSION}".`,
        extension: name,
      });
    }

    if (!markdownEditorSemVerSatisfies(
      markoraVersion,
      compatibility.markora,
    )) {
      resolutionError({
        code: "EXTENSION_INCOMPATIBLE",
        message: `Extension "${name}" requires Markora "${compatibility.markora}", but the compiler is "${options.markoraVersion}".`,
        extension: name,
      });
    }
  }

  for (const item of unresolved) {
    const { conflicts = [], name } = item.definition;

    for (const conflict of conflicts) {
      if (byName.has(conflict)) {
        resolutionError({
          code: "EXTENSION_CONFLICT",
          message: `Extension "${name}" conflicts with installed extension "${conflict}".`,
          participants: [name, conflict],
        });
      }
    }
  }

  const outgoing = new Map<string, Set<string>>(
    unresolved.map(({ definition }) => [definition.name, new Set()]),
  );
  const indegree = new Map<string, number>(
    unresolved.map(({ definition }) => [definition.name, 0]),
  );

  const addEdge = (from: string, to: string) => {
    const targets = outgoing.get(from)!;

    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  };

  for (const item of unresolved) {
    const definition = item.definition;

    for (const dependency of definition.dependencies ?? []) {
      const installed = byName.get(dependency.name);

      if (!installed) {
        if (dependency.optional) {
          continue;
        }

        resolutionError({
          code: "EXTENSION_MISSING_DEPENDENCY",
          message: `Extension "${definition.name}" requires missing dependency "${dependency.name}" (${dependency.version}).`,
          extension: definition.name,
          participants: [definition.name, dependency.name],
        });
      }

      if (!markdownEditorSemVerSatisfies(
        installed.definition.version,
        dependency.version,
      )) {
        resolutionError({
          code: "EXTENSION_INCOMPATIBLE",
          message: `Extension "${definition.name}" requires dependency "${dependency.name}" at "${dependency.version}", but "${installed.definition.version}" is installed.`,
          extension: definition.name,
          participants: [definition.name, dependency.name],
        });
      }

      addEdge(dependency.name, definition.name);
    }

    for (const target of definition.before ?? []) {
      const name = targetName(target);

      if (!byName.has(name)) {
        if (targetIsOptional(target)) {
          continue;
        }

        resolutionError({
          code: "EXTENSION_MISSING_DEPENDENCY",
          message: `Extension "${definition.name}" has a required before target "${name}" that is not installed.`,
          extension: definition.name,
          participants: [definition.name, name],
        });
      }

      addEdge(definition.name, name);
    }

    for (const target of definition.after ?? []) {
      const name = targetName(target);

      if (!byName.has(name)) {
        if (targetIsOptional(target)) {
          continue;
        }

        resolutionError({
          code: "EXTENSION_MISSING_DEPENDENCY",
          message: `Extension "${definition.name}" has a required after target "${name}" that is not installed.`,
          extension: definition.name,
          participants: [definition.name, name],
        });
      }

      addEdge(name, definition.name);
    }
  }

  const compareItems = (
    left: ResolvedMarkdownEditorExtension,
    right: ResolvedMarkdownEditorExtension,
  ) => (
    left.registrationIndex - right.registrationIndex
    || left.definition.name.localeCompare(right.definition.name)
  );
  const compareNames = (left: string, right: string) => compareItems(
    byName.get(left)!,
    byName.get(right)!,
  );
  const ready = unresolved
    .filter(({ definition }) => indegree.get(definition.name) === 0)
    .sort(compareItems);
  const resolved: ResolvedMarkdownEditorExtension[] = [];

  while (ready.length > 0) {
    const item = ready.shift()!;
    resolved.push(item);

    for (const target of [...outgoing.get(item.definition.name)!].sort(compareNames)) {
      const nextIndegree = indegree.get(target)! - 1;
      indegree.set(target, nextIndegree);

      if (nextIndegree === 0) {
        ready.push(byName.get(target)!);
        ready.sort(compareItems);
      }
    }
  }

  if (resolved.length !== unresolved.length) {
    const unresolvedNames = new Set(
      unresolved
        .filter(({ definition }) => !resolved.includes(byName.get(definition.name)!))
        .map(({ definition }) => definition.name),
    );
    const cycle = findOrderCycle(unresolvedNames, outgoing, compareNames);
    resolutionError({
      code: "EXTENSION_ORDER_CYCLE",
      message: `Extension dependency/order graph contains a cycle: ${cycle.join(" -> ")}.`,
      participants: cycle.slice(0, -1),
    });
  }

  Object.freeze(resolved);
  return Object.freeze({
    extensions: resolved,
    manifest: freezeManifest(resolved, preset),
  });
}
