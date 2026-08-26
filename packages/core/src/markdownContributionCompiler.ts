import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { MarkdownSerializerState, ParseSpec } from "prosemirror-markdown";
import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import {
  MarkdownEditorExtensionError,
  isValidMarkdownEditorLocalId,
  type MarkdownEditorContributionOrderTarget,
  type MarkdownEditorExtensionErrorPhase,
  type MarkdownEditorTokenizerRule,
} from "./extensionApi";
import type { ResolvedMarkdownEditorExtension } from "./extensionResolver";

export type MarkdownEditorTokenizerFoundationAnchor = Readonly<{
  id: string;
  phase: MarkdownEditorTokenizerRule["phase"];
  markdownItName: string;
}>;

type OwnedTokenizerRule = Readonly<{
  kind: "rule";
  extensionName: string;
  extensionResolvedIndex: number;
  declarationIndex: number;
  rule: MarkdownEditorTokenizerRule;
  id: string;
  phase: MarkdownEditorTokenizerRule["phase"];
}>;

type TokenizerAnchorNode = MarkdownEditorTokenizerFoundationAnchor & Readonly<{
  kind: "anchor";
  anchorIndex: number;
}>;

type TokenizerGraphNode = OwnedTokenizerRule | TokenizerAnchorNode;

const tokenizerPhases = ["block", "inline", "inline-post", "core"] as const;
const MARKDOWN_SUPPORTED_TOKEN_NESTING = 256;
const MARKDOWN_TOKENIZER_MAX_NESTING = 512;
const canonicalListMarkers = Symbol("markora-canonical-list-markers");

type MarkdownListSerializerState = MarkdownSerializerState & {
  closed: { type: ProseMirrorNode["type"] } | null;
  flushClose: (size: number) => void;
  inTightList: boolean;
  [canonicalListMarkers]?: Record<string, string>;
};

function markdownListIsTight(tokens: readonly Token[], index: number) {
  while (++index < tokens.length) {
    if (tokens[index]?.type !== "list_item_open") {
      return Boolean(tokens[index]?.hidden);
    }
  }

  return false;
}

/** @internal Preserve zero while retaining ProseMirror's tight-list metadata. */
export function orderedMarkdownListTokenAttrs(
  token: Token,
  tokens: readonly Token[],
  index: number,
) {
  const authoredStart = token.attrGet("start");
  const order = authoredStart == null ? 1 : Number(authoredStart);

  return {
    order: Number.isSafeInteger(order) ? order : 1,
    tight: markdownListIsTight(tokens, index),
  };
}

/** @internal Alternate only when equal list nodes are actual adjacent blocks. */
export function selectCanonicalMarkdownListMarker(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  primary: string,
  alternate: string,
) {
  const listState = state as MarkdownListSerializerState;
  const markers = listState[canonicalListMarkers] ??= {};
  const adjacent = listState.closed?.type === node.type;
  const marker = adjacent && markers[node.type.name] === primary
    ? alternate
    : primary;
  markers[node.type.name] = marker;
  return marker;
}

/** @internal Render distinct adjacent lists without loosening their parent. */
export function renderCanonicalMarkdownList(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  continuation: string,
  firstDelimiter: (index: number) => string,
) {
  const listState = state as MarkdownListSerializerState;

  if (listState.closed?.type === node.type || listState.inTightList) {
    listState.flushClose(1);
  }

  const isTight = typeof node.attrs.tight !== "undefined"
    ? node.attrs.tight
    : state.options.tightLists;
  const previousTight = listState.inTightList;
  listState.inTightList = isTight;

  node.forEach((child, _offset, index) => {
    if (index && isTight) {
      listState.flushClose(1);
    }

    state.wrapBlock(
      continuation,
      firstDelimiter(index),
      node,
      () => state.render(child, node, index),
    );
  });
  listState.inTightList = previousTight;
}

/** @internal Avoid blank separators between blocks in a tight list item. */
export function renderCanonicalMarkdownListItem(
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
) {
  const listState = state as MarkdownListSerializerState;

  node.forEach((child, _offset, index) => {
    if (index > 0 && listState.inTightList) {
      const closed = listState.closed;
      listState.flushClose(1);
      if (closed?.type === child.type) {
        listState.closed = closed;
      }
    }

    state.render(child, node, index);
  });
}

// Markdown-it counts both list and list-item containers, so this admits 127
// recursively nested list items. Keep a separate parser ceiling above the
// product limit: if hostile input reaches Markdown-it's recursion guard, the
// retained high-level tokens still trip our deterministic error instead of
// letting either editor codec return a silently truncated document.
export function configureMarkdownTokenizerNesting(tokenizer: MarkdownIt) {
  // markdown-it supports this runtime option even though its public Definitely
  // Typed Options declaration omits it.
  (tokenizer.options as typeof tokenizer.options & { maxNesting: number }).maxNesting =
    MARKDOWN_TOKENIZER_MAX_NESTING;
  tokenizer.core.ruler.push("markora_nesting_limit", (state) => {
    if (state.tokens.some(token => token.level >= MARKDOWN_SUPPORTED_TOKEN_NESTING)) {
      throw new RangeError(
        "Markdown nesting exceeds Markora's supported structural depth.",
      );
    }
  });
}

/** @internal Merge foundation patterns and validated extension delimiter sets. */
export function combineMarkdownSerializerEscapePatterns(
  foundationPatterns: readonly RegExp[],
  extraCharacterSets: readonly (string | undefined)[],
) {
  const characters = [...new Set(extraCharacterSets.flatMap((characters) => (
    characters ? [...characters] : []
  )))].sort();
  const characterPattern = characters.length === 0
    ? null
    : `[${characters.map((character) => (
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`
    )).join("")}]`;
  const sources = [
    ...foundationPatterns.map((pattern) => `(?:${pattern.source})`),
    ...(characterPattern ? [characterPattern] : []),
  ];

  return sources.length === 0
    ? undefined
    : new RegExp(sources.join("|"), "g");
}

function contributionError(options: {
  code: string;
  phase: MarkdownEditorExtensionErrorPhase;
  message: string;
  extension?: string;
  contribution?: string;
  participants?: readonly string[];
  cause?: unknown;
}): never {
  throw new MarkdownEditorExtensionError(options);
}

type RuntimeCallbackOptions = Readonly<{
  phase: "parse" | "serialize";
  extension: string;
  contribution: string;
}>;

/** @internal Preserve callback signatures while attributing extension-owned failures. */
export function wrapMarkdownEditorExtensionRuntimeCallback<
  TThis,
  TArgs extends unknown[],
  TResult,
>(
  callback: (this: TThis, ...args: TArgs) => TResult,
  options: RuntimeCallbackOptions,
): (this: TThis, ...args: TArgs) => TResult {
  return function wrappedMarkdownEditorExtensionRuntimeCallback(
    this: TThis,
    ...args: TArgs
  ) {
    try {
      return callback.apply(this, args);
    } catch (cause) {
      if (cause instanceof MarkdownEditorExtensionError) {
        throw cause;
      }

      contributionError({
        code: "EXTENSION_RUNTIME_FAILED",
        phase: options.phase,
        message: `Extension contribution "${options.contribution}" failed during ${options.phase}.`,
        extension: options.extension,
        contribution: options.contribution,
        cause,
      });
    }
  };
}

function targetId(target: MarkdownEditorContributionOrderTarget) {
  return typeof target === "string" ? target : target.id;
}

function targetIsOptional(target: MarkdownEditorContributionOrderTarget) {
  return typeof target !== "string" && target.optional;
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTokenizerNodes(left: TokenizerGraphNode, right: TokenizerGraphNode) {
  if (left.kind === "anchor" && right.kind === "anchor") {
    return left.anchorIndex - right.anchorIndex;
  }

  // An unconstrained public rule has push semantics. Foundation anchors are
  // therefore the stable tie-breaker until an explicit edge places the rule
  // before one of them.
  if (left.kind === "anchor") return -1;
  if (right.kind === "anchor") return 1;

  return (
    left.extensionResolvedIndex - right.extensionResolvedIndex
    || left.declarationIndex - right.declarationIndex
    || compareStrings(left.id, right.id)
  );
}

function findTokenizerCycle(
  unresolvedIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, TokenizerGraphNode>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const states = new Map<string, "active" | "complete">();
  const stack: string[] = [];
  const compareIds = (left: string, right: string) => compareTokenizerNodes(
    byId.get(left)!,
    byId.get(right)!,
  );

  const visit = (id: string): string[] | null => {
    const state = states.get(id);

    if (state === "active") {
      return [...stack.slice(stack.indexOf(id)), id];
    }

    if (state === "complete") {
      return null;
    }

    states.set(id, "active");
    stack.push(id);

    for (const next of [...(outgoing.get(id) ?? [])]
      .filter((candidate) => unresolvedIds.has(candidate))
      .sort(compareIds)) {
      const cycle = visit(next);

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

function orderTokenizerPhase(
  phase: MarkdownEditorTokenizerRule["phase"],
  anchors: readonly TokenizerAnchorNode[],
  rules: readonly OwnedTokenizerRule[],
  allNodesById: ReadonlyMap<string, TokenizerGraphNode>,
) {
  const nodes: TokenizerGraphNode[] = [...anchors, ...rules];
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()] as const));
  const indegree = new Map<string, number>(
    nodes.map((node) => [node.id, 0] as const),
  );

  const addEdge = (from: string, to: string) => {
    const targets = outgoing.get(from)!;

    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  };

  for (let index = 1; index < anchors.length; index += 1) {
    addEdge(anchors[index - 1].id, anchors[index].id);
  }

  for (const owned of rules) {
    for (const field of ["before", "after"] as const) {
      for (const target of owned.rule[field] ?? []) {
        const id = targetId(target);
        const targetNode = allNodesById.get(id);

        if (!targetNode) {
          if (targetIsOptional(target)) {
            continue;
          }

          contributionError({
            code: "EXTENSION_MISSING_DEPENDENCY",
            phase: "tokenizer",
            message: `Tokenizer rule "${owned.id}" has a required ${field} target "${id}" that is not installed.`,
            extension: owned.extensionName,
            contribution: owned.id,
            participants: [owned.id, id],
          });
        }

        if (targetNode.phase !== phase) {
          contributionError({
            code: "EXTENSION_INVALID_DEFINITION",
            phase: "tokenizer",
            message: `Tokenizer rule "${owned.id}" in phase "${phase}" cannot target "${id}" in phase "${targetNode.phase}".`,
            extension: owned.extensionName,
            contribution: owned.id,
            participants: [owned.id, id],
          });
        }

        if (field === "before") {
          addEdge(owned.id, id);
        } else {
          addEdge(id, owned.id);
        }
      }
    }
  }

  const ready = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .sort(compareTokenizerNodes);
  const ordered: TokenizerGraphNode[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    ordered.push(node);

    for (const targetId of [...outgoing.get(node.id)!]
      .map((id) => byId.get(id)!)
      .sort(compareTokenizerNodes)
      .map((target) => target.id)) {
      const nextIndegree = indegree.get(targetId)! - 1;
      indegree.set(targetId, nextIndegree);

      if (nextIndegree === 0) {
        ready.push(byId.get(targetId)!);
        ready.sort(compareTokenizerNodes);
      }
    }
  }

  if (ordered.length !== nodes.length) {
    const unresolved = new Set(
      nodes
        .filter((node) => indegree.get(node.id)! > 0)
        .map((node) => node.id),
    );
    const cycle = findTokenizerCycle(unresolved, byId, outgoing);
    const participants = cycle[cycle.length - 1] === cycle[0]
      ? cycle.slice(0, -1)
      : cycle;
    const owner = participants
      .map((id) => byId.get(id))
      .find((node): node is OwnedTokenizerRule => node?.kind === "rule");

    contributionError({
      code: "EXTENSION_ORDER_CYCLE",
      phase: "tokenizer",
      message: `Tokenizer rule ordering contains a cycle: ${cycle.join(" -> ")}.`,
      extension: owner?.extensionName,
      contribution: owner?.id,
      participants,
    });
  }

  return ordered;
}

type CreatedTokenizerRule = Readonly<{
  owned: OwnedTokenizerRule;
  callback: unknown;
}>;

function createTokenizerRule(owned: OwnedTokenizerRule): CreatedTokenizerRule {
  const namespace = Object.freeze({
    token(localId: string) {
      const suffix = localId.match(/_(?:open|close)$/)?.[0] ?? "";
      const root = suffix ? localId.slice(0, -suffix.length) : localId;

      if (!isValidMarkdownEditorLocalId(root)) {
        contributionError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "tokenizer",
          message: `Markdown token local ID "${localId}" is invalid.`,
          extension: owned.extensionName,
          contribution: owned.id,
          participants: [owned.id, localId],
        });
      }

      return `${owned.extensionName}/${root}${suffix}`;
    },
  });

  try {
    return {
      owned,
      callback: owned.rule.createRule(namespace),
    };
  } catch (cause) {
    contributionError({
      code: "EXTENSION_FACTORY_FAILED",
      phase: "tokenizer",
      message: `Tokenizer rule factory "${owned.id}" failed.`,
      extension: owned.extensionName,
      contribution: owned.id,
      cause,
    });
  }
}

function registerTokenizerRule(
  tokenizer: MarkdownIt,
  created: CreatedTokenizerRule,
  placement: Readonly<{
    kind: "after" | "before" | "push";
    target?: string;
  }>,
) {
  const { owned, callback } = created;
  const runtimeOptions = {
    phase: "parse" as const,
    extension: owned.extensionName,
    contribution: owned.id,
  };
  const register = <TRule>(ruler: {
    after(afterName: string, ruleName: string, rule: TRule, options?: unknown): void;
    before(beforeName: string, ruleName: string, rule: TRule, options?: unknown): void;
    push(ruleName: string, rule: TRule, options?: unknown): void;
  }, rule: TRule, options?: unknown) => {
    if (placement.kind === "before") {
      ruler.before(placement.target!, owned.id, rule, options);
    } else if (placement.kind === "after") {
      ruler.after(placement.target!, owned.id, rule, options);
    } else {
      ruler.push(owned.id, rule, options);
    }
  };

  try {
    if (owned.rule.phase === "block") {
      const rule = wrapMarkdownEditorExtensionRuntimeCallback(
        callback as Parameters<MarkdownIt["block"]["ruler"]["push"]>[1],
        runtimeOptions,
      );
      register(
        tokenizer.block.ruler,
        rule,
        owned.rule.options,
      );
    } else if (owned.rule.phase === "inline") {
      const rule = wrapMarkdownEditorExtensionRuntimeCallback(
        callback as Parameters<MarkdownIt["inline"]["ruler"]["push"]>[1],
        runtimeOptions,
      );
      register(
        tokenizer.inline.ruler,
        rule,
      );
    } else if (owned.rule.phase === "inline-post") {
      const rule = wrapMarkdownEditorExtensionRuntimeCallback(
        callback as Parameters<MarkdownIt["inline"]["ruler2"]["push"]>[1],
        runtimeOptions,
      );
      register(
        tokenizer.inline.ruler2,
        rule,
      );
    } else {
      const rule = wrapMarkdownEditorExtensionRuntimeCallback(
        callback as Parameters<MarkdownIt["core"]["ruler"]["push"]>[1],
        runtimeOptions,
      );
      register(
        tokenizer.core.ruler,
        rule,
      );
    }
  } catch (cause) {
    contributionError({
      code: "EXTENSION_FACTORY_FAILED",
      phase: "tokenizer",
      message: `Tokenizer rule "${owned.id}" could not be registered.`,
      extension: owned.extensionName,
      contribution: owned.id,
      cause,
    });
  }
}

/** @internal Compile the complete tokenizer graph before mutating Markdown-it. */
export function registerMarkdownEditorTokenizerRules(
  tokenizer: MarkdownIt,
  extensions: readonly ResolvedMarkdownEditorExtension[],
  foundationAnchors: readonly MarkdownEditorTokenizerFoundationAnchor[],
) {
  const anchors = foundationAnchors.map((anchor, anchorIndex): TokenizerAnchorNode => ({
    ...anchor,
    kind: "anchor",
    anchorIndex,
  }));
  const rules: OwnedTokenizerRule[] = [];

  extensions.forEach(({ definition }, extensionResolvedIndex) => {
    (definition.markdown?.tokenizerRules ?? []).forEach((rule, declarationIndex) => {
      rules.push({
        kind: "rule",
        extensionName: definition.name,
        extensionResolvedIndex,
        declarationIndex,
        rule,
        id: `${definition.name}/${rule.id}`,
        phase: rule.phase,
      });
    });
  });

  const allNodesById = new Map<string, TokenizerGraphNode>();

  for (const node of [...anchors, ...rules]) {
    if (allNodesById.has(node.id)) {
      const owner = node.kind === "rule" ? node : undefined;
      contributionError({
        code: "EXTENSION_CONTRIBUTION_CONFLICT",
        phase: "tokenizer",
        message: `Tokenizer contribution ID "${node.id}" is declared more than once.`,
        extension: owner?.extensionName,
        contribution: node.id,
        participants: [node.id],
      });
    }

    allNodesById.set(node.id, node);
  }

  const orderedByPhase = new Map<
    MarkdownEditorTokenizerRule["phase"],
    readonly TokenizerGraphNode[]
  >();

  for (const phase of tokenizerPhases) {
    orderedByPhase.set(phase, orderTokenizerPhase(
      phase,
      anchors.filter((anchor) => anchor.phase === phase),
      rules.filter((rule) => rule.phase === phase),
      allNodesById,
    ));
  }

  // Factories all run after graph validation and before the first ruler write.
  const created = new Map(
    rules.map((rule) => {
      const value = createTokenizerRule(rule);
      return [rule.id, value] as const;
    }),
  );

  for (const phase of tokenizerPhases) {
    const ordered = orderedByPhase.get(phase)!;
    let previousMarkdownItName: string | undefined;

    for (let index = 0; index < ordered.length; index += 1) {
      const node = ordered[index];

      if (node.kind === "anchor") {
        previousMarkdownItName = node.markdownItName;
        continue;
      }

      const nextAnchor = ordered
        .slice(index + 1)
        .find((candidate): candidate is TokenizerAnchorNode => candidate.kind === "anchor");
      const placement = previousMarkdownItName
        ? { kind: "after" as const, target: previousMarkdownItName }
        : nextAnchor
          ? { kind: "before" as const, target: nextAnchor.markdownItName }
          : { kind: "push" as const };

      registerTokenizerRule(tokenizer, created.get(node.id)!, placement);
      previousMarkdownItName = node.id;
    }
  }
}

/** @internal Merge and validate contributed parser handlers before construction. */
export function compileMarkdownEditorParserTokens(options: Readonly<{
  foundationTokens: Readonly<Record<string, ParseSpec>>;
  schema: Schema;
  extensions: readonly ResolvedMarkdownEditorExtension[];
  qualifyToken(extensionName: string, localId: string): string;
}>): Record<string, ParseSpec> {
  const tokens: Record<string, ParseSpec> = { ...options.foundationTokens };

  for (const { definition } of options.extensions) {
    for (const [localId, spec] of Object.entries(
      definition.markdown?.parserTokens ?? {},
    )) {
      const tokenId = options.qualifyToken(definition.name, localId);

      if (Object.prototype.hasOwnProperty.call(tokens, tokenId)) {
        contributionError({
          code: "EXTENSION_CONTRIBUTION_CONFLICT",
          phase: "codec",
          message: `Markdown parser token "${tokenId}" is already owned.`,
          extension: definition.name,
          contribution: tokenId,
          participants: [tokenId],
        });
      }

      const targetKind = "block" in spec
        ? "block"
        : "node" in spec
          ? "node"
          : "mark" in spec
            ? "mark"
            : undefined;
      const target = targetKind ? spec[targetKind] : undefined;

      if (targetKind && typeof target === "string") {
        const expectsNode = targetKind === "block" || targetKind === "node";
        const expectedTypes = expectsNode ? options.schema.nodes : options.schema.marks;
        const wrongTypes = expectsNode ? options.schema.marks : options.schema.nodes;
        const expectedKind = expectsNode ? "node" : "mark";
        const wrongKind = expectsNode ? "mark" : "node";

        if (!expectedTypes[target]) {
          contributionError({
            code: "EXTENSION_INVALID_DEFINITION",
            phase: "codec",
            message: wrongTypes[target]
              ? `Markdown parser token "${tokenId}" targets schema ${expectedKind} "${target}", but "${target}" is a ${wrongKind}.`
              : `Markdown parser token "${tokenId}" targets missing schema ${expectedKind} "${target}".`,
            extension: definition.name,
            contribution: tokenId,
            participants: [tokenId, target],
          });
        }
      }

      tokens[tokenId] = spec.getAttrs
        ? {
            ...spec,
            getAttrs: wrapMarkdownEditorExtensionRuntimeCallback(
              spec.getAttrs,
              {
                phase: "parse",
                extension: definition.name,
                contribution: tokenId,
              },
            ),
          }
        : spec;
    }
  }

  return tokens;
}
