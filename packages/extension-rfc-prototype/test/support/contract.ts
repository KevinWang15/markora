import MarkdownIt from "markdown-it";
import { inputRules, type InputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as commonMarkSchema,
  type ParseSpec,
} from "prosemirror-markdown";
import {
  Schema,
  type MarkSpec,
  type Node as ProseMirrorNode,
  type NodeSpec,
} from "prosemirror-model";
import {
  type Command,
  type EditorState,
  type Plugin,
  type Transaction,
} from "prosemirror-state";

type NodeSerializer = MarkdownSerializer["nodes"][string];
type MarkSerializer = MarkdownSerializer["marks"][string];
type MarkdownItBlockRule = Parameters<MarkdownIt["block"]["ruler"]["push"]>[1];
type MarkdownItInlineRule = Parameters<MarkdownIt["inline"]["ruler"]["push"]>[1];

export interface PrototypeSchemaContribution<Spec> {
  readonly name: string;
  readonly spec: Spec;
  readonly before?: string;
  readonly after?: string;
}

interface PrototypeTokenizerRuleBase {
  readonly id: string;
  readonly before?: readonly PrototypeTokenizerOrderTarget[];
  readonly after?: readonly PrototypeTokenizerOrderTarget[];
}

export type PrototypeTokenizerOrderTarget =
  | string
  | Readonly<{ id: string; optional: true }>;

export interface PrototypeTokenizerRuleContext {
  token(localId: string): string;
}

export interface PrototypeBlockTokenizerRule extends PrototypeTokenizerRuleBase {
  readonly phase: "block";
  createRule(context: PrototypeTokenizerRuleContext): MarkdownItBlockRule;
  readonly options?: { readonly alt: readonly string[] };
}

export interface PrototypeInlineTokenizerRule extends PrototypeTokenizerRuleBase {
  readonly phase: "inline";
  createRule(context: PrototypeTokenizerRuleContext): MarkdownItInlineRule;
}

export type PrototypeTokenizerRule =
  | PrototypeBlockTokenizerRule
  | PrototypeInlineTokenizerRule;

export interface PrototypeAssemblyContext {
  readonly schema: Schema;
  getState(): EditorState;
  dispatch(transaction: Transaction): boolean;
  runCommand(command: Command): boolean;
}

export type PrototypeHostCommand = (...args: never[]) => boolean;

export interface PrototypeRuntimeContext<Storage>
  extends PrototypeAssemblyContext {
  readonly storage: Storage;
}

export interface PrototypeInputRuleContribution<Storage> {
  readonly id: string;
  create(context: PrototypeRuntimeContext<Storage>): InputRule;
}

export interface PrototypePluginContribution<Storage> {
  readonly id: string;
  create(context: PrototypeRuntimeContext<Storage>): Plugin;
}

export interface PrototypeKeymapContribution<Storage> {
  readonly id: string;
  readonly key: string;
  create(context: PrototypeRuntimeContext<Storage>): Command;
}

export interface PrototypeExtensionRuntime<Storage = unknown> {
  readonly commands: Readonly<Record<string, PrototypeHostCommand>>;
  readonly state: Readonly<
    Record<string, (...args: never[]) => unknown>
  >;
  readonly inputRules?: readonly PrototypeInputRuleContribution<Storage>[];
  readonly plugins?: readonly PrototypePluginContribution<Storage>[];
  readonly keymaps?: readonly PrototypeKeymapContribution<Storage>[];
}

interface PrototypeStaticExtensionDefinition {
  readonly name: string;
  readonly version: string;
  readonly compatibility: {
    readonly markora: string;
    readonly extensionApi: string;
  };
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly schema?: {
    readonly nodes?: readonly PrototypeSchemaContribution<NodeSpec>[];
    readonly marks?: readonly PrototypeSchemaContribution<MarkSpec>[];
  };
  readonly markdown?: {
    readonly tokenizerRules?: readonly PrototypeTokenizerRule[];
    readonly parserTokens?: Readonly<Record<string, ParseSpec>>;
    readonly serializer?: {
      readonly nodes?: Readonly<Record<string, NodeSerializer>>;
      readonly marks?: Readonly<Record<string, MarkSerializer>>;
    };
  };
}

type PrototypeCreateStorage = (
  context: PrototypeAssemblyContext,
) => unknown;

type PrototypeStorageFor<
  CreateStorage extends PrototypeCreateStorage | undefined,
> = CreateStorage extends PrototypeCreateStorage
  ? ReturnType<CreateStorage>
  : undefined;

export type PrototypeMarkdownEditorExtensionDefinition<
  CreateStorage extends PrototypeCreateStorage | undefined = undefined,
  Runtime extends PrototypeExtensionRuntime<
    PrototypeStorageFor<CreateStorage>
  > = PrototypeExtensionRuntime<PrototypeStorageFor<CreateStorage>>,
> = PrototypeStaticExtensionDefinition & Readonly<{
  createStorage?: CreateStorage;
  createRuntime(
    context: PrototypeAssemblyContext & Readonly<{
      storage: PrototypeStorageFor<CreateStorage>;
    }>,
  ): Runtime;
}>;

export type PrototypeMarkdownEditorExtension =
  PrototypeStaticExtensionDefinition & Readonly<{
    createStorage?: PrototypeCreateStorage;
    createRuntime(
      context: PrototypeAssemblyContext & Readonly<{ storage: unknown }>,
    ): PrototypeExtensionRuntime<unknown>;
  }>;

export interface ComposedPrototype {
  readonly schema: Schema;
  readonly tokenizer: MarkdownIt;
  readonly parser: MarkdownParser;
  readonly serializer: MarkdownSerializer;
  readonly commands: Readonly<
    Record<string, Readonly<Record<string, PrototypeHostCommand>>>
  >;
  readonly state: Readonly<
    Record<string, Readonly<Record<string, (...args: never[]) => unknown>>>
  >;
  readonly storage: Readonly<Record<string, unknown>>;
  readonly currentState: EditorState | undefined;
  readonly plugins: readonly Plugin[];
  readonly pluginOrder: readonly string[];
  attachState(state: EditorState): void;
  parse(markdown: string): ProseMirrorNode;
  serialize(doc: ProseMirrorNode): string;
}

const BASE_OWNER = "prosemirror-markdown";
const FOUNDATION_TOKENIZER_ANCHORS = {
  "@markora/foundation/block/fence": {
    phase: "block",
    markdownItName: "fence",
  },
  "@markora/foundation/inline/emphasis": {
    phase: "inline",
    markdownItName: "emphasis",
  },
} as const;
const LOCAL_MARKDOWN_TOKEN_ID = /^[a-z][a-z0-9._-]*$/;

function qualifyMarkdownToken(
  extensionName: string,
  localId: string,
  allowBoundarySuffix = false,
) {
  if (
    !LOCAL_MARKDOWN_TOKEN_ID.test(localId)
    || (!allowBoundarySuffix && /_(?:open|close)$/.test(localId))
  ) {
    throw new Error(
      `Markdown parser token local ID "${localId}" from "${extensionName}" must use lowercase local characters and cannot reserve _open/_close suffixes.`,
    );
  }

  return `${extensionName}/${localId}`;
}

export function defineMarkdownEditorExtension<
  const CreateStorage extends PrototypeCreateStorage | undefined = undefined,
  const Runtime extends PrototypeExtensionRuntime<
    PrototypeStorageFor<CreateStorage>
  > = PrototypeExtensionRuntime<PrototypeStorageFor<CreateStorage>>,
>(
  extension: PrototypeMarkdownEditorExtensionDefinition<CreateStorage, Runtime>,
): Readonly<
  PrototypeMarkdownEditorExtensionDefinition<CreateStorage, Runtime>
> {
  const seen = new WeakSet<object>();

  const freeze = (value: unknown): void => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return;
    }

    const object = value as object;

    if (seen.has(object)) {
      return;
    }

    seen.add(object);
    Object.values(object).forEach(freeze);
    Object.freeze(object);
  };

  freeze(extension);
  return extension;
}

function resolveExtensions(
  extensions: readonly PrototypeMarkdownEditorExtension[],
) {
  const indexes = new Map<string, number>();
  const byName = new Map<string, PrototypeMarkdownEditorExtension>();

  extensions.forEach((extension, index) => {
    const previousIndex = indexes.get(extension.name);

    if (typeof previousIndex === "number") {
      throw new Error(
        `Extension "${extension.name}" is declared by both definition #${previousIndex + 1} and definition #${index + 1}.`,
      );
    }

    indexes.set(extension.name, index);
    byName.set(extension.name, extension);
  });

  const outgoing = new Map(
    extensions.map((extension) => [extension.name, new Set<string>()] as const),
  );
  const indegree = new Map<string, number>(
    extensions.map((extension) => [extension.name, 0] as const),
  );

  const addEdge = (from: string, to: string, owner: string) => {
    if (!byName.has(to)) {
      throw new Error(
        `Extension "${owner}" targets missing order dependency "${to}".`,
      );
    }

    const targets = outgoing.get(from)!;

    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  };

  for (const extension of extensions) {
    for (const target of extension.before ?? []) {
      addEdge(extension.name, target, extension.name);
    }

    for (const target of extension.after ?? []) {
      if (!byName.has(target)) {
        throw new Error(
          `Extension "${extension.name}" targets missing order dependency "${target}".`,
        );
      }

      addEdge(target, extension.name, extension.name);
    }
  }

  const ready = extensions
    .filter((extension) => indegree.get(extension.name) === 0)
    .sort((left, right) => indexes.get(left.name)! - indexes.get(right.name)!);
  const resolved: PrototypeMarkdownEditorExtension[] = [];

  while (ready.length > 0) {
    const extension = ready.shift()!;
    resolved.push(extension);

    for (const target of outgoing.get(extension.name)!) {
      const nextIndegree = indegree.get(target)! - 1;
      indegree.set(target, nextIndegree);

      if (nextIndegree === 0) {
        ready.push(byName.get(target)!);
        ready.sort((left, right) => indexes.get(left.name)! - indexes.get(right.name)!);
      }
    }
  }

  if (resolved.length !== extensions.length) {
    const cycleNames = extensions
      .filter((extension) => !resolved.includes(extension))
      .map((extension) => extension.name);
    throw new Error(`Extension ordering contains a cycle: ${cycleNames.join(", ")}.`);
  }

  return resolved;
}

function claim(
  owners: Map<string, string>,
  key: string,
  owner: string,
  contribution: string,
) {
  const previousOwner = owners.get(key);

  if (previousOwner) {
    throw new Error(
      `${contribution} "${key}" is owned by both "${previousOwner}" and "${owner}".`,
    );
  }

  owners.set(key, owner);
}

function createBaseOwners(values: { forEach: (callback: (name: string) => void) => void }) {
  const owners = new Map<string, string>();
  values.forEach((name) => owners.set(name, BASE_OWNER));
  return owners;
}

function orderedMapKeys(values: {
  forEach: (callback: (name: string, value: unknown) => void) => void;
}) {
  const keys: string[] = [];
  values.forEach((name) => keys.push(name));
  return keys;
}

function addOrderedContribution<Spec>(
  values: {
    addBefore(place: string, key: string, value: Spec): unknown;
    addToEnd(key: string, value: Spec): unknown;
    forEach(callback: (name: string, value: Spec) => void): void;
    get(key: string): Spec | undefined;
  },
  name: string,
  contribution: PrototypeSchemaContribution<Spec>,
) {
  if (contribution.before && contribution.after) {
    throw new Error(
      `Schema contribution "${name}" cannot declare both "before" and "after".`,
    );
  }

  if (contribution.before) {
    if (!values.get(contribution.before)) {
      throw new Error(
        `Schema contribution "${name}" targets missing entry "${contribution.before}".`,
      );
    }

    return values.addBefore(contribution.before, name, contribution.spec);
  }

  if (contribution.after) {
    const keys = orderedMapKeys(values);
    const targetIndex = keys.indexOf(contribution.after);

    if (targetIndex < 0) {
      throw new Error(
        `Schema contribution "${name}" targets missing entry "${contribution.after}".`,
      );
    }

    const nextName = keys[targetIndex + 1];
    return nextName
      ? values.addBefore(nextName, name, contribution.spec)
      : values.addToEnd(name, contribution.spec);
  }

  return values.addToEnd(name, contribution.spec);
}

interface OwnedTokenizerRule {
  readonly extensionName: string;
  readonly contribution: PrototypeTokenizerRule;
  readonly qualifiedName: string;
  readonly declarationIndex: number;
}

function resolveFoundationTokenizerAnchor(
  anchor: string,
  phase: PrototypeTokenizerRule["phase"],
  ruleName: string,
) {
  const foundationAnchor = FOUNDATION_TOKENIZER_ANCHORS[
    anchor as keyof typeof FOUNDATION_TOKENIZER_ANCHORS
  ];

  if (foundationAnchor && foundationAnchor.phase !== phase) {
    throw new Error(
      `Tokenizer rule "${ruleName}" cannot target ${foundationAnchor.phase} anchor "${anchor}" from the ${phase} phase.`,
    );
  }

  return foundationAnchor?.markdownItName;
}

function tokenizerTargetId(target: PrototypeTokenizerOrderTarget) {
  return typeof target === "string" ? target : target.id;
}

function tokenizerTargetIsOptional(target: PrototypeTokenizerOrderTarget) {
  return typeof target !== "string" && target.optional;
}

function orderTokenizerRules(rules: readonly OwnedTokenizerRule[]) {
  const byName = new Map(rules.map((rule) => [rule.qualifiedName, rule] as const));
  const outgoing = new Map(
    rules.map((rule) => [rule.qualifiedName, new Set<string>()] as const),
  );
  const indegree = new Map<string, number>(
    rules.map((rule) => [rule.qualifiedName, 0] as const),
  );

  for (const rule of rules) {
    const contribution = rule.contribution;

    const before = contribution.before ?? [];
    const after = contribution.after ?? [];

    if (before.length > 0 && after.length > 0) {
      throw new Error(
        `Tokenizer rule "${rule.qualifiedName}" cannot declare both "before" and "after".`,
      );
    }

    for (const targetReference of [...before, ...after]) {
      const targetName = tokenizerTargetId(targetReference);

      if (resolveFoundationTokenizerAnchor(
        targetName,
        contribution.phase,
        rule.qualifiedName,
      )) {
        continue;
      }

      const target = byName.get(targetName);

      if (!target) {
        if (tokenizerTargetIsOptional(targetReference)) {
          continue;
        }

        throw new Error(
          `Tokenizer rule "${rule.qualifiedName}" targets missing contribution "${targetName}".`,
        );
      }

      if (target.contribution.phase !== contribution.phase) {
        throw new Error(
          `Tokenizer rule "${rule.qualifiedName}" cannot target ${target.contribution.phase} contribution "${targetName}" from the ${contribution.phase} phase.`,
        );
      }

      // The target must exist in Markdown-it before this contribution can call
      // ruler.before()/after(), regardless of their eventual execution order.
      const targets = outgoing.get(targetName)!;

      if (!targets.has(rule.qualifiedName)) {
        targets.add(rule.qualifiedName);
        indegree.set(rule.qualifiedName, indegree.get(rule.qualifiedName)! + 1);
      }
    }
  }

  const ready = rules
    .filter((rule) => indegree.get(rule.qualifiedName) === 0)
    .sort((left, right) => left.declarationIndex - right.declarationIndex);
  const ordered: OwnedTokenizerRule[] = [];

  while (ready.length > 0) {
    const rule = ready.shift()!;
    ordered.push(rule);

    for (const targetName of outgoing.get(rule.qualifiedName)!) {
      const nextIndegree = indegree.get(targetName)! - 1;
      indegree.set(targetName, nextIndegree);

      if (nextIndegree === 0) {
        ready.push(byName.get(targetName)!);
        ready.sort((left, right) => left.declarationIndex - right.declarationIndex);
      }
    }
  }

  if (ordered.length !== rules.length) {
    const cycleNames = rules
      .filter((rule) => !ordered.includes(rule))
      .map((rule) => rule.qualifiedName);
    throw new Error(`Tokenizer rule ordering contains a cycle: ${cycleNames.join(", ")}.`);
  }

  return ordered;
}

function registerTokenizerRule(
  tokenizer: MarkdownIt,
  ownedRule: OwnedTokenizerRule,
  availableRuleNames: ReadonlySet<string>,
) {
  const { contribution, qualifiedName: registeredName } = ownedRule;
  const resolveAnchor = (anchor: string) => {
    return resolveFoundationTokenizerAnchor(
      anchor,
      contribution.phase,
      registeredName,
    ) ?? anchor;
  };

  const before = contribution.before ?? [];
  const after = contribution.after ?? [];
  const placement = before.length > 0 ? "before" : after.length > 0 ? "after" : null;
  const targets = placement === "before" ? before : placement === "after" ? after : [];
  const activeCustomTarget = targets
    .map(tokenizerTargetId)
    .find((target) => availableRuleNames.has(target));
  const foundationTarget = targets
    .map(tokenizerTargetId)
    .map((target) => resolveFoundationTokenizerAnchor(
      target,
      contribution.phase,
      registeredName,
    ))
    .find((target) => typeof target === "string");
  const registrationTarget = activeCustomTarget ?? foundationTarget;
  const ruleContext: PrototypeTokenizerRuleContext = {
    token: (localId) => qualifyMarkdownToken(
      ownedRule.extensionName,
      localId,
      true,
    ),
  };

  if (contribution.phase === "block") {
    const rule = contribution.createRule(ruleContext);
    const options = contribution.options
      ? { alt: [...contribution.options.alt] }
      : undefined;

    if (placement === "before" && registrationTarget) {
      tokenizer.block.ruler.before(
        resolveAnchor(registrationTarget),
        registeredName,
        rule,
        options,
      );
    } else if (placement === "after" && registrationTarget) {
      tokenizer.block.ruler.after(
        resolveAnchor(registrationTarget),
        registeredName,
        rule,
        options,
      );
    } else {
      tokenizer.block.ruler.push(registeredName, rule, options);
    }

    return;
  }

  const rule = contribution.createRule(ruleContext);

  if (placement === "before" && registrationTarget) {
    tokenizer.inline.ruler.before(
      resolveAnchor(registrationTarget),
      registeredName,
      rule,
    );
  } else if (placement === "after" && registrationTarget) {
    tokenizer.inline.ruler.after(
      resolveAnchor(registrationTarget),
      registeredName,
      rule,
    );
  } else {
    tokenizer.inline.ruler.push(registeredName, rule);
  }
}

export function composePrototypeExtensions(
  extensions: readonly PrototypeMarkdownEditorExtension[],
): ComposedPrototype {
  const resolvedExtensions = resolveExtensions(extensions);

  let nodes = commonMarkSchema.spec.nodes;
  let marks = commonMarkSchema.spec.marks;
  const nodeOwners = createBaseOwners(nodes);
  const markOwners = createBaseOwners(marks);

  for (const extension of resolvedExtensions) {
    for (const contribution of extension.schema?.nodes ?? []) {
      claim(nodeOwners, contribution.name, extension.name, "Schema node");
      nodes = addOrderedContribution(
        nodes,
        contribution.name,
        contribution,
      ) as typeof nodes;
    }

    for (const contribution of extension.schema?.marks ?? []) {
      claim(markOwners, contribution.name, extension.name, "Schema mark");
      marks = addOrderedContribution(
        marks,
        contribution.name,
        contribution,
      ) as typeof marks;
    }
  }

  const schema = new Schema({ nodes, marks });
  let currentState: EditorState | undefined;
  const requireState = () => {
    if (!currentState) {
      throw new Error(
        "Prototype editor state is unavailable until attachState(state) is called.",
      );
    }

    return currentState;
  };
  const context: PrototypeAssemblyContext = {
    schema,
    getState: requireState,
    dispatch(transaction) {
      currentState = requireState().apply(transaction);
      return true;
    },
    runCommand(command) {
      const state = requireState();
      return command(state, (transaction) => {
        currentState = requireState().apply(transaction);
      });
    },
  };
  const tokenizer = new MarkdownIt("commonmark", { html: false });
  const tokenizerRules: OwnedTokenizerRule[] = [];
  const tokenizerRuleOwners = new Map<string, string>();
  let tokenizerRuleIndex = 0;

  for (const extension of resolvedExtensions) {
    for (const contribution of extension.markdown?.tokenizerRules ?? []) {
      const qualifiedName = `${extension.name}/${contribution.id}`;
      claim(
        tokenizerRuleOwners,
        qualifiedName,
        extension.name,
        "Tokenizer rule",
      );
      tokenizerRules.push({
        extensionName: extension.name,
        contribution,
        qualifiedName,
        declarationIndex: tokenizerRuleIndex,
      });
      tokenizerRuleIndex += 1;
    }
  }

  const tokenizerRuleNames = new Set(tokenizerRules.map((rule) => rule.qualifiedName));

  for (const rule of orderTokenizerRules(tokenizerRules)) {
    registerTokenizerRule(tokenizer, rule, tokenizerRuleNames);
  }

  const parseTokens: Record<string, ParseSpec> = {
    ...defaultMarkdownParser.tokens,
  };
  const parserTokenOwners = new Map(
    Object.keys(parseTokens).map((name) => [name, BASE_OWNER] as const),
  );
  const serializerNodes: Record<string, NodeSerializer> = {
    ...defaultMarkdownSerializer.nodes,
  };
  const serializerNodeOwners = new Map(
    Object.keys(serializerNodes).map((name) => [name, BASE_OWNER] as const),
  );
  const serializerMarks: Record<string, MarkSerializer> = {
    ...defaultMarkdownSerializer.marks,
  };
  const serializerMarkOwners = new Map(
    Object.keys(serializerMarks).map((name) => [name, BASE_OWNER] as const),
  );

  for (const extension of resolvedExtensions) {
    for (const [localId, parseSpec] of Object.entries(
      extension.markdown?.parserTokens ?? {},
    )) {
      const qualifiedName = qualifyMarkdownToken(extension.name, localId);
      claim(
        parserTokenOwners,
        qualifiedName,
        extension.name,
        "Markdown parser token",
      );
      parseTokens[qualifiedName] = parseSpec;
    }

    for (const [name, serializer] of Object.entries(
      extension.markdown?.serializer?.nodes ?? {},
    )) {
      claim(serializerNodeOwners, name, extension.name, "Markdown node serializer");
      serializerNodes[name] = serializer;
    }

    for (const [name, serializer] of Object.entries(
      extension.markdown?.serializer?.marks ?? {},
    )) {
      claim(serializerMarkOwners, name, extension.name, "Markdown mark serializer");
      serializerMarks[name] = serializer;
    }
  }

  const parser = new MarkdownParser(schema, tokenizer, parseTokens);
  const serializer = new MarkdownSerializer(serializerNodes, serializerMarks);
  const instances = resolvedExtensions.map((extension) => {
    const storage = extension.createStorage?.(context);
    const runtime = extension.createRuntime({ ...context, storage });
    return { extension, runtime, storage };
  });
  const commands: Record<string, Record<string, PrototypeHostCommand>> = {};
  const extensionState: Record<
    string,
    Record<string, (...args: never[]) => unknown>
  > = {};
  const storage: Record<string, unknown> = {};

  for (const instance of instances) {
    if (Object.keys(instance.runtime.commands).length > 0) {
      commands[instance.extension.name] = { ...instance.runtime.commands };
    }

    if (Object.keys(instance.runtime.state).length > 0) {
      extensionState[instance.extension.name] = { ...instance.runtime.state };
    }

    storage[instance.extension.name] = instance.storage;
  }

  const plugins: Plugin[] = [];
  const pluginOrder: string[] = [];

  for (const instance of instances) {
    for (const contribution of instance.runtime.inputRules ?? []) {
      plugins.push(inputRules({
        rules: [contribution.create({ ...context, storage: instance.storage })],
      }));
      pluginOrder.push(
        `${instance.extension.name}/input-rule/${contribution.id}`,
      );
    }
  }

  for (const instance of instances) {
    for (const contribution of instance.runtime.plugins ?? []) {
      plugins.push(contribution.create({ ...context, storage: instance.storage }));
      pluginOrder.push(`${instance.extension.name}/plugin/${contribution.id}`);
    }
  }

  for (const instance of instances) {
    for (const contribution of instance.runtime.keymaps ?? []) {
      plugins.push(keymap({
        [contribution.key]: contribution.create({
          ...context,
          storage: instance.storage,
        }),
      }));
      pluginOrder.push(
        `${instance.extension.name}/keymap/${contribution.id}`,
      );
    }
  }

  return {
    schema,
    tokenizer,
    parser,
    serializer,
    commands,
    state: extensionState,
    storage,
    get currentState() {
      return currentState;
    },
    plugins,
    pluginOrder,
    attachState(state) {
      if (state.schema !== schema) {
        throw new Error("Attached state must use the composed prototype schema.");
      }

      currentState = state;
    },
    parse(markdown) {
      return parser.parse(markdown);
    },
    serialize(doc) {
      return serializer.serialize(doc);
    },
  };
}
