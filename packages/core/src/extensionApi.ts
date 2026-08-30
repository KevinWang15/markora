import type MarkdownIt from "markdown-it";
import type { InputRule } from "prosemirror-inputrules";
import type {
  MarkdownSerializer,
  ParseSpec,
} from "prosemirror-markdown";
import type {
  MarkSpec,
  Node as ProseMirrorNode,
  NodeSpec,
  Schema,
  Slice,
} from "prosemirror-model";
import type {
  Command,
  EditorState,
  Plugin,
  Transaction,
} from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";
import type { MarkdownEditor } from "./editorApi";
import {
  readRegisteredMarkdownEditorExtensionDefinition,
  readRegisteredMarkdownEditorExtensionPreset,
  registerMarkdownEditorExtensionDefinition,
  registerMarkdownEditorExtensionPreset,
} from "./extensionDefinitionStore";
import {
  isValidMarkdownEditorSemVerRange,
  parseMarkdownEditorSemVer,
} from "./extensionSemver";

export const MARKORA_EXTENSION_API_VERSION = "1.3.0" as const;

/**
 * Read exact source attached by the Markdown codec's opaque-source
 * hydration pass without exposing private Markdown-it token metadata. Only
 * own data properties are inspected, so hostile accessors are never invoked.
 */
export function readMarkdownEditorOpaqueTokenSource(token: unknown): string | null {
  try {
    if (typeof token !== "object" || token === null) {
      return null;
    }

    const metaDescriptor = Object.getOwnPropertyDescriptor(token, "meta");
    const meta = metaDescriptor && "value" in metaDescriptor
      ? metaDescriptor.value
      : null;

    if (typeof meta !== "object" || meta === null) {
      return null;
    }

    const sourceDescriptor = Object.getOwnPropertyDescriptor(
      meta,
      "markoraOpaqueSource",
    );
    const source = sourceDescriptor && "value" in sourceDescriptor
      ? sourceDescriptor.value
      : null;
    return typeof source === "string" ? source : null;
  } catch {
    return null;
  }
}

export type MarkdownEditorExtensionName = string;

export type MarkdownEditorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MarkdownEditorJsonValue[]
  | Readonly<{ [key: string]: MarkdownEditorJsonValue }>;

export type MarkdownEditorExtensionOrderTarget =
  | MarkdownEditorExtensionName
  | Readonly<{
      name: MarkdownEditorExtensionName;
      optional: true;
    }>;

export type MarkdownEditorExtensionDependency = Readonly<{
  name: MarkdownEditorExtensionName;
  version: string;
  optional?: boolean;
}>;

export type MarkdownEditorExtensionCompatibility = Readonly<{
  extensionApi: string;
  markora: string;
}>;

export type MarkdownEditorContributionOrderTarget =
  | string
  | Readonly<{ id: string; optional: true }>;

export type MarkdownEditorOrderedContribution = Readonly<{
  id: string;
  before?: readonly MarkdownEditorContributionOrderTarget[];
  after?: readonly MarkdownEditorContributionOrderTarget[];
}>;

export type MarkdownEditorLifecycleScope = Readonly<{
  signal: AbortSignal;
  addCleanup(cleanup: () => void): void;
}>;

export type MarkdownEditorCodec = Readonly<{
  schema: Schema;
  parse(markdown: string): ProseMirrorNode | null;
  serialize(doc: ProseMirrorNode): string;
}>;

export type MarkdownEditorNamespacedIdFactory = Readonly<{
  qualify(localId: string): string;
  token(localId: string): string;
}>;

declare const markdownEditorExtensionBrand: unique symbol;
declare const markdownEditorExtensionTypes: unique symbol;
declare const markdownEditorExtensionPresetBrand: unique symbol;

export type AnyMarkdownEditorExtension = Readonly<{
  name: MarkdownEditorExtensionName;
  version: string;
  compatibility: MarkdownEditorExtensionCompatibility;
  [markdownEditorExtensionBrand]: true;
}>;

export type MarkdownEditorExtension<
  TCommands extends object = Record<never, never>,
  TState extends object = Record<never, never>,
  TStorage = undefined,
> = AnyMarkdownEditorExtension & Readonly<{
  [markdownEditorExtensionTypes]: {
    commands: TCommands;
    state: TState;
    storage: TStorage;
  };
}>;

type MarkdownEditorReadonlyStorage<TStorage> = TStorage extends object
  ? Readonly<TStorage>
  : TStorage;

export type MarkdownEditorExtensionHandle<
  TCommands extends object,
  TState extends object,
  TStorage,
> = Readonly<{
  commands: Readonly<TCommands>;
  state: Readonly<TState>;
  storage: MarkdownEditorReadonlyStorage<TStorage>;
}>;

export type UntypedMarkdownEditorExtensionHandle = MarkdownEditorExtensionHandle<
  Record<string, (...args: never[]) => boolean>,
  Record<string, (...args: never[]) => unknown>,
  unknown
>;

export interface MarkdownEditorExtensionRegistry {
  get<TCommands extends object, TState extends object, TStorage>(
    definition: MarkdownEditorExtension<TCommands, TState, TStorage>,
  ): MarkdownEditorExtensionHandle<TCommands, TState, TStorage>;
  get(name: string): UntypedMarkdownEditorExtensionHandle;
  has(definitionOrName: AnyMarkdownEditorExtension | string): boolean;
  readonly manifest: MarkdownEditorExtensionManifest;
  readonly uiActions: readonly MarkdownEditorUiAction[];
}

export type MarkdownEditorDependencyHandles = Pick<
  MarkdownEditorExtensionRegistry,
  "get" | "has"
>;

export type MarkdownEditorExtensionStorageContext = Readonly<{
  schema: Schema;
  codec: MarkdownEditorCodec;
  dependencies: MarkdownEditorDependencyHandles;
  lifecycle: MarkdownEditorLifecycleScope;
  ids: MarkdownEditorNamespacedIdFactory;
  ownerDocument: Document;
  reportError(error: unknown, contribution?: string): void;
}>;

export type MarkdownEditorExtensionAssemblyContext<TStorage> =
  MarkdownEditorExtensionStorageContext & Readonly<{
    storage: TStorage;
    getState(): EditorState;
    dispatch(transaction: Transaction): boolean;
    runCommand(command: Command): boolean;
  }>;

export type MarkdownEditorPluginContributionFactory<TStorage> =
  MarkdownEditorOrderedContribution & Readonly<{
    create(
      context: MarkdownEditorExtensionAssemblyContext<TStorage>,
    ): Plugin;
  }>;

export type MarkdownEditorKeymapContribution<TStorage> =
  MarkdownEditorOrderedContribution & Readonly<{
    key: string;
    create(
      context: MarkdownEditorExtensionAssemblyContext<TStorage>,
    ): Command;
  }>;

export type MarkdownEditorInputRuleContribution<TStorage> =
  MarkdownEditorOrderedContribution & Readonly<{
    create(
      context: MarkdownEditorExtensionAssemblyContext<TStorage>,
    ): InputRule;
  }>;

export type MarkdownEditorNodeViewContribution<TStorage> =
  MarkdownEditorOrderedContribution & Readonly<{
    node: string;
    create(
      context: MarkdownEditorExtensionAssemblyContext<TStorage>,
    ): NodeViewConstructor;
  }>;

export type MarkdownEditorClipboardSurface =
  | "both"
  | "nested-code"
  | "outer";

type MarkdownEditorClipboardTransformBase =
  MarkdownEditorOrderedContribution & Readonly<{
    surface: MarkdownEditorClipboardSurface;
  }>;

export type MarkdownEditorClipboardTransformContribution<TStorage> =
  | (MarkdownEditorClipboardTransformBase & Readonly<{
      kind: "text" | "html";
      create(
        context: MarkdownEditorExtensionAssemblyContext<TStorage>,
      ): (value: string) => string;
    }>)
  | (MarkdownEditorClipboardTransformBase & Readonly<{
      kind: "slice";
      create(
        context: MarkdownEditorExtensionAssemblyContext<TStorage>,
      ): (value: Slice) => Slice;
    }>);

export type MarkdownEditorClipboardHandlerContribution<TStorage> =
  MarkdownEditorOrderedContribution & Readonly<{
    kind: "drop" | "paste";
    surface: MarkdownEditorClipboardSurface;
    create(
      context: MarkdownEditorExtensionAssemblyContext<TStorage>,
    ): (event: ClipboardEvent | DragEvent, view: EditorView) => boolean;
  }>;

export type MarkdownEditorClipboardContribution<TStorage> = Readonly<{
  transforms?: readonly MarkdownEditorClipboardTransformContribution<TStorage>[];
  handlers?: readonly MarkdownEditorClipboardHandlerContribution<TStorage>[];
}>;

export type MarkdownEditorExtensionCommandMap = Readonly<Record<
  string,
  (...args: never[]) => boolean
>>;

export type MarkdownEditorExtensionStateMap = Readonly<Record<
  string,
  (...args: never[]) => unknown
>>;

export type ZeroArgumentBooleanKey<T extends object> = Extract<{
  [K in keyof T]: T[K] extends () => boolean ? K : never;
}[keyof T], string>;

export type MarkdownEditorUiActionContribution<
  TCommands extends object,
  TState extends object,
> = Readonly<{
  id: string;
  group: string;
  order?: number;
  defaultLabel: string;
  command: ZeroArgumentBooleanKey<TCommands>;
  enabled?: ZeroArgumentBooleanKey<TState>;
  active?: ZeroArgumentBooleanKey<TState>;
}>;

export type MarkdownEditorUiAction = Readonly<{
  id: string;
  group: string;
  order: number;
  defaultLabel: string;
  run(): boolean;
  isEnabled(): boolean;
  isActive(): boolean;
}>;

export type MarkdownEditorExtensionSetupContext<
  TCommands extends object,
  TState extends object,
  TStorage,
> = MarkdownEditorExtensionAssemblyContext<TStorage> & Readonly<{
  editor: MarkdownEditor;
  view: EditorView;
  handle: MarkdownEditorExtensionHandle<TCommands, TState, TStorage>;
  lifecycle: MarkdownEditorLifecycleScope;
}>;

export type MarkdownEditorExtensionRuntime<
  TStorage,
  TCommands extends MarkdownEditorExtensionCommandMap = MarkdownEditorExtensionCommandMap,
  TState extends MarkdownEditorExtensionStateMap = MarkdownEditorExtensionStateMap,
> = Readonly<{
  commands?: TCommands;
  state?: TState;
  plugins?: readonly MarkdownEditorPluginContributionFactory<TStorage>[];
  keymaps?: readonly MarkdownEditorKeymapContribution<TStorage>[];
  inputRules?: readonly MarkdownEditorInputRuleContribution<TStorage>[];
  nodeViews?: readonly MarkdownEditorNodeViewContribution<TStorage>[];
  clipboard?: MarkdownEditorClipboardContribution<TStorage>;
  ui?: readonly MarkdownEditorUiActionContribution<TCommands, TState>[];
  setup?: (
    context: MarkdownEditorExtensionSetupContext<TCommands, TState, TStorage>,
  ) => void | (() => void);
}>;

export type MarkdownEditorRuntimeCommands<TRuntime> =
  TRuntime extends { readonly commands: infer TCommands extends object }
    ? TCommands
    : Record<never, never>;

export type MarkdownEditorRuntimeState<TRuntime> =
  TRuntime extends { readonly state: infer TState extends object }
    ? TState
    : Record<never, never>;

type MarkdownEditorValidatedRuntime<TStorage, TRuntime extends object> =
  MarkdownEditorRuntimeCommands<TRuntime> extends MarkdownEditorExtensionCommandMap
    ? MarkdownEditorRuntimeState<TRuntime> extends MarkdownEditorExtensionStateMap
      ? TRuntime extends MarkdownEditorExtensionRuntime<
          TStorage,
          MarkdownEditorRuntimeCommands<TRuntime>,
          MarkdownEditorRuntimeState<TRuntime>
        >
        ? TRuntime
        : never
      : never
    : never;

export type MarkdownEditorSchemaOrderTarget =
  | string
  | Readonly<{ name: string; optional: true }>;

export type MarkdownEditorSchemaEntry<TSpec> = Readonly<{
  name: string;
  spec: TSpec;
  before?: MarkdownEditorSchemaOrderTarget;
  after?: MarkdownEditorSchemaOrderTarget;
}>;

export type MarkdownEditorSchemaContribution = Readonly<{
  nodes?: readonly MarkdownEditorSchemaEntry<NodeSpec>[];
  marks?: readonly MarkdownEditorSchemaEntry<MarkSpec>[];
  managedBlocks?: readonly string[];
}>;

export type MarkdownEditorTokenizerNamespace = Readonly<{
  token(localId: string): string;
}>;

type MarkdownItBlockRule = Parameters<MarkdownIt["block"]["ruler"]["push"]>[1];
type MarkdownItBlockRuleOptions = Parameters<MarkdownIt["block"]["ruler"]["push"]>[2];
type MarkdownItInlineRule = Parameters<MarkdownIt["inline"]["ruler"]["push"]>[1];
type MarkdownItInlinePostRule = Parameters<MarkdownIt["inline"]["ruler2"]["push"]>[1];
type MarkdownItCoreRule = Parameters<MarkdownIt["core"]["ruler"]["push"]>[1];

type MarkdownEditorTokenizerRuleBase<TPhase extends string, TRule> =
  MarkdownEditorOrderedContribution & Readonly<{
    phase: TPhase;
    createRule(namespace: MarkdownEditorTokenizerNamespace): TRule;
  }>;

export type MarkdownEditorTokenizerRule =
  | (MarkdownEditorTokenizerRuleBase<"block", MarkdownItBlockRule> & Readonly<{
      options?: MarkdownItBlockRuleOptions;
    }>)
  | MarkdownEditorTokenizerRuleBase<"inline", MarkdownItInlineRule>
  | MarkdownEditorTokenizerRuleBase<"inline-post", MarkdownItInlinePostRule>
  | MarkdownEditorTokenizerRuleBase<"core", MarkdownItCoreRule>;

export type MarkdownNodeSerializer = MarkdownSerializer["nodes"][string];
export type MarkdownMarkSerializer = MarkdownSerializer["marks"][string];

export type MarkdownEditorMarkdownContribution = Readonly<{
  tokenizerRules?: readonly MarkdownEditorTokenizerRule[];
  parserTokens?: Readonly<Record<string, ParseSpec>>;
  serializer?: Readonly<{
    /**
     * A unique set of supported ASCII delimiter characters that literal text
     * must backslash-escape so an extension tokenizer cannot claim them after
     * a serialize/reparse cycle. Foundation-escaped punctuation is excluded.
     */
    escapeExtraCharacters?: string;
    nodes?: Readonly<Record<string, MarkdownNodeSerializer>>;
    marks?: Readonly<Record<string, MarkdownMarkSerializer>>;
  }>;
}>;

export type MarkdownEditorExtensionStaticDefinition = Readonly<{
  name: MarkdownEditorExtensionName;
  version: string;
  compatibility: MarkdownEditorExtensionCompatibility;
  dependencies?: readonly MarkdownEditorExtensionDependency[];
  before?: readonly MarkdownEditorExtensionOrderTarget[];
  after?: readonly MarkdownEditorExtensionOrderTarget[];
  conflicts?: readonly MarkdownEditorExtensionName[];
  configuration?: MarkdownEditorJsonValue;
  schema?: MarkdownEditorSchemaContribution;
  markdown?: MarkdownEditorMarkdownContribution;
}>;

type MarkdownEditorCreateStorage = (
  context: MarkdownEditorExtensionStorageContext,
) => unknown;

export type MarkdownEditorExtensionDefinition<
  TCreateStorage extends MarkdownEditorCreateStorage,
  TRuntime extends object,
> = MarkdownEditorExtensionStaticDefinition & Readonly<{
  createStorage: TCreateStorage;
  createRuntime(
    context: MarkdownEditorExtensionAssemblyContext<ReturnType<TCreateStorage>>,
  ): TRuntime & MarkdownEditorValidatedRuntime<ReturnType<TCreateStorage>, TRuntime>;
}>;

type ContextualMarkdownEditorExtensionDefinition<
  TStorage,
  TRuntime extends object,
> = MarkdownEditorExtensionStaticDefinition & Readonly<{
  createStorage(context: MarkdownEditorExtensionStorageContext): TStorage;
  createRuntime(
    context: MarkdownEditorExtensionAssemblyContext<TStorage>,
  ): TRuntime & MarkdownEditorValidatedRuntime<TStorage, TRuntime>;
}>;

export type MarkdownEditorExtensionWithoutStorageDefinition<
  TRuntime extends object,
> = MarkdownEditorExtensionStaticDefinition & Readonly<{
  createStorage?: undefined;
  createRuntime(
    context: MarkdownEditorExtensionAssemblyContext<undefined>,
  ): TRuntime & MarkdownEditorValidatedRuntime<undefined, TRuntime>;
}>;

export type MarkdownEditorStaticExtensionDefinition =
  MarkdownEditorExtensionStaticDefinition & Readonly<{
    createStorage?: undefined;
    createRuntime?: undefined;
  }>;

/** @internal */
export type InternalMarkdownEditorExtensionDefinition =
  MarkdownEditorExtensionStaticDefinition & Readonly<{
    createStorage?: MarkdownEditorCreateStorage;
    createRuntime?: (
      context: MarkdownEditorExtensionAssemblyContext<unknown>,
    ) => MarkdownEditorExtensionRuntime<unknown>;
  }>;

export type MarkdownEditorExtensionPreset = Readonly<{
  name?: string;
  version?: string;
  extensions: readonly AnyMarkdownEditorExtension[];
  [markdownEditorExtensionPresetBrand]: true;
}>;

export type MarkdownEditorExtensionPresetDefinition = Readonly<{
  name?: string;
  version?: string;
  extensions: readonly AnyMarkdownEditorExtension[];
}>;

/** @internal */
export type InternalMarkdownEditorExtensionPreset = Readonly<{
  name?: string;
  version?: string;
  extensions: readonly AnyMarkdownEditorExtension[];
}>;

export type MarkdownEditorExtensionManifest = Readonly<{
  extensionApi: typeof MARKORA_EXTENSION_API_VERSION;
  preset?: Readonly<{ name: string; version: string }>;
  extensions: readonly Readonly<{
    name: string;
    version: string;
    configuration?: MarkdownEditorJsonValue;
  }>[];
}>;

export type MarkdownEditorExtensionErrorPhase =
  | "resolve"
  | "schema"
  | "tokenizer"
  | "codec"
  | "initial-parse"
  | "storage"
  | "assemble"
  | "view"
  | "setup"
  | "parse"
  | "serialize"
  | "command"
  | "state"
  | "input"
  | "clipboard"
  | "node-view"
  | "plugin"
  | "ui"
  | "destroy";

export type MarkdownEditorExtensionErrorOptions = Readonly<{
  code: string;
  phase: MarkdownEditorExtensionErrorPhase;
  message?: string;
  extension?: string;
  participants?: readonly string[];
  contribution?: string;
  cause?: unknown;
}>;

export class MarkdownEditorExtensionError extends Error {
  readonly code: string;
  readonly phase: MarkdownEditorExtensionErrorPhase;
  readonly extension?: string;
  readonly participants?: readonly string[];
  readonly contribution?: string;
  readonly cause: unknown;

  constructor(options: MarkdownEditorExtensionErrorOptions) {
    super(options.message ?? options.code);
    this.name = "MarkdownEditorExtensionError";
    this.code = options.code;
    this.phase = options.phase;
    this.extension = options.extension;
    this.participants = options.participants
      ? Object.freeze([...options.participants])
      : undefined;
    this.contribution = options.contribution;
    this.cause = options.cause;
  }
}

const runtimeExtensionBrand = Symbol("markora.extension.definition");
const runtimePresetBrand = Symbol("markora.extension.preset");
const extensionNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|markora\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const localContributionIdPattern = /^[a-z][a-z0-9._-]*$/;
const schemaNamePattern = /^[a-z][a-z0-9_]*$/;
const qualifiedContributionIdPattern = /^(?:(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|markora\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)\/[a-z][a-z0-9._-]*|@markora\/foundation\/(?:block|core|inline|inline-post)\/[a-z][a-z0-9._-]*)$/;
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

function invalidDefinition(
  message: string,
  options: {
    extension?: string;
    phase?: MarkdownEditorExtensionErrorPhase;
    contribution?: string;
    cause?: unknown;
  } = {},
): never {
  throw new MarkdownEditorExtensionError({
    code: "EXTENSION_INVALID_DEFINITION",
    phase: options.phase ?? "resolve",
    message,
    extension: options.extension,
    contribution: options.contribution,
    cause: options.cause,
  });
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @internal */
export function isValidMarkdownEditorExtensionName(value: string) {
  return value.length <= 214 && extensionNamePattern.test(value);
}

function isReservedMarkdownEditorExtensionName(value: string) {
  return value.startsWith("markora/") || value.startsWith("@markora/");
}

/** @internal */
export function isValidMarkdownEditorLocalId(value: string) {
  return localContributionIdPattern.test(value);
}

/** @internal */
export function isValidMarkdownEditorQualifiedContributionId(value: string) {
  return qualifiedContributionIdPattern.test(value);
}

function validateExtensionName(value: unknown, field: string, owner?: string) {
  if (typeof value !== "string" || !isValidMarkdownEditorExtensionName(value)) {
    invalidDefinition(
      `${field} must be a lowercase npm-style extension name.`,
      { extension: owner },
    );
  }
}

function validatePublicExtensionName(value: unknown, field: string) {
  validateExtensionName(value, field);

  if (isReservedMarkdownEditorExtensionName(value as string)) {
    invalidDefinition(
      `${field} cannot use the reserved markora/* or @markora/* namespace.`,
      { extension: value as string },
    );
  }
}

function validateVersion(value: unknown, field: string, owner?: string) {
  if (typeof value !== "string" || !parseMarkdownEditorSemVer(value)) {
    invalidDefinition(`${field} must be a valid SemVer version.`, {
      extension: owner,
    });
  }
}

function validateRange(value: unknown, field: string, owner?: string) {
  if (typeof value !== "string" || !isValidMarkdownEditorSemVerRange(value)) {
    invalidDefinition(`${field} must be a supported SemVer range.`, {
      extension: owner,
    });
  }
}

function validateLocalId(
  value: unknown,
  field: string,
  owner: string,
  phase: MarkdownEditorExtensionErrorPhase,
) {
  if (typeof value !== "string" || !isValidMarkdownEditorLocalId(value)) {
    invalidDefinition(
      `${field} must start with a lowercase letter and contain only lowercase letters, digits, dots, dashes, or underscores.`,
      { extension: owner, phase },
    );
  }
}

function validateJsonValue(
  value: unknown,
  owner: string,
  path: string,
  ancestors: Set<object>,
) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalidDefinition(`${path} must contain only finite JSON numbers.`, {
        extension: owner,
      });
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    invalidDefinition(`${path} must be JSON-compatible.`, { extension: owner });
  }

  if (ancestors.has(value)) {
    invalidDefinition(`${path} cannot contain a circular reference.`, {
      extension: owner,
    });
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(
      entry,
      owner,
      `${path}[${index}]`,
      ancestors,
    ));
  } else {
    if (!isPlainRecord(value)) {
      invalidDefinition(`${path} must contain only plain JSON objects.`, {
        extension: owner,
      });
    }

    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, owner, `${path}.${key}`, ancestors);
    }
  }

  ancestors.delete(value);
}

function validateOrderTarget(
  target: unknown,
  field: string,
  owner: string,
) {
  if (typeof target === "string") {
    validateExtensionName(target, field, owner);
    return;
  }

  if (!isPlainRecord(target) || target.optional !== true) {
    invalidDefinition(
      `${field} must be an extension name or { name, optional: true }.`,
      { extension: owner },
    );
  }

  validateExtensionName(target.name, `${field}.name`, owner);
}

function validateSchemaOrderTarget(
  target: unknown,
  field: string,
  owner: string,
) {
  if (typeof target === "string") {
    if (!schemaNamePattern.test(target)) {
      invalidDefinition(`${field} must name a lowercase snake-case schema entry.`, {
        extension: owner,
        phase: "schema",
      });
    }

    return;
  }

  if (
    !isPlainRecord(target)
    || target.optional !== true
    || typeof target.name !== "string"
    || !schemaNamePattern.test(target.name)
  ) {
    invalidDefinition(
      `${field} must be a schema name or { name, optional: true }.`,
      { extension: owner, phase: "schema" },
    );
  }
}

function validateSchemaEntries(
  entries: unknown,
  kind: "mark" | "node",
  owner: string,
) {
  if (entries === undefined) {
    return;
  }

  if (!Array.isArray(entries)) {
    invalidDefinition(`schema.${kind}s must be an array.`, {
      extension: owner,
      phase: "schema",
    });
  }

  const names = new Set<string>();

  entries.forEach((entry, index) => {
    if (!isPlainRecord(entry)) {
      invalidDefinition(`schema.${kind}s[${index}] must be a plain record.`, {
        extension: owner,
        phase: "schema",
      });
    }

    const name = entry.name;

    if (typeof name !== "string" || !schemaNamePattern.test(name)) {
      invalidDefinition(
        `schema.${kind}s[${index}].name must be lowercase snake-case.`,
        { extension: owner, phase: "schema" },
      );
    }

    if (names.has(name)) {
      invalidDefinition(`schema.${kind} "${name}" is declared more than once.`, {
        extension: owner,
        phase: "schema",
        contribution: name,
      });
    }

    names.add(name);

    if (typeof entry.spec !== "object" || entry.spec === null) {
      invalidDefinition(`schema.${kind} "${name}" must provide a spec.`, {
        extension: owner,
        phase: "schema",
        contribution: name,
      });
    }

    if (entry.before !== undefined && entry.after !== undefined) {
      invalidDefinition(
        `schema.${kind} "${name}" cannot declare both before and after.`,
        { extension: owner, phase: "schema", contribution: name },
      );
    }

    if (entry.before !== undefined) {
      validateSchemaOrderTarget(entry.before, `schema.${kind} "${name}".before`, owner);
    }

    if (entry.after !== undefined) {
      validateSchemaOrderTarget(entry.after, `schema.${kind} "${name}".after`, owner);
    }
  });
}

function validateSchema(definition: Record<PropertyKey, unknown>, owner: string) {
  const schema = definition.schema;

  if (schema === undefined) {
    return;
  }

  if (!isPlainRecord(schema)) {
    invalidDefinition("schema must be a plain record.", {
      extension: owner,
      phase: "schema",
    });
  }

  validateSchemaEntries(schema.nodes, "node", owner);
  validateSchemaEntries(schema.marks, "mark", owner);

  if (schema.managedBlocks !== undefined) {
    if (!Array.isArray(schema.managedBlocks)) {
      invalidDefinition("schema.managedBlocks must be an array.", {
        extension: owner,
        phase: "schema",
      });
    }

    const names = new Set<string>();
    schema.managedBlocks.forEach((name, index) => {
      if (typeof name !== "string" || !schemaNamePattern.test(name)) {
        invalidDefinition(
          `schema.managedBlocks[${index}] must be a lowercase snake-case schema name.`,
          { extension: owner, phase: "schema" },
        );
      }

      if (names.has(name)) {
        invalidDefinition(`Managed block "${name}" is declared more than once.`, {
          extension: owner,
          phase: "schema",
          contribution: name,
        });
      }

      names.add(name);
    });
  }
}

function validateContributionOrderTarget(
  target: unknown,
  field: string,
  owner: string,
) {
  const id = typeof target === "string"
    ? target
    : isPlainRecord(target) && target.optional === true
      ? target.id
      : undefined;

  if (
    typeof id !== "string"
    || !isValidMarkdownEditorQualifiedContributionId(id)
  ) {
    invalidDefinition(
      `${field} must be a qualified contribution ID or { id, optional: true }.`,
      { extension: owner, phase: "tokenizer" },
    );
  }
}

function validateParserTokenSpec(
  value: unknown,
  tokenId: string,
  owner: string,
) {
  if (!isPlainRecord(value)) {
    invalidDefinition(
      `markdown.parserTokens.${tokenId} must be a plain record.`,
      { extension: owner, phase: "codec", contribution: tokenId },
    );
  }

  const targetFields = (["node", "block", "mark"] as const).filter(
    (field) => value[field] !== undefined,
  );

  for (const field of targetFields) {
    const target = value[field];

    if (typeof target !== "string" || !schemaNamePattern.test(target)) {
      invalidDefinition(
        `markdown.parserTokens.${tokenId}.${field} must be a lowercase snake-case schema name.`,
        { extension: owner, phase: "codec", contribution: tokenId },
      );
    }
  }

  if (
    targetFields.length !== 1
    && !(targetFields.length === 0 && value.ignore === true)
  ) {
    invalidDefinition(
      `markdown.parserTokens.${tokenId} must set exactly one of node, block, or mark, or set ignore: true.`,
      { extension: owner, phase: "codec", contribution: tokenId },
    );
  }

  if (value.ignore === true && targetFields.length !== 0) {
    invalidDefinition(
      `markdown.parserTokens.${tokenId} cannot combine ignore: true with a node, block, or mark target.`,
      { extension: owner, phase: "codec", contribution: tokenId },
    );
  }

  if (
    value.attrs !== undefined
    && value.attrs !== null
    && !isPlainRecord(value.attrs)
  ) {
    invalidDefinition(
      `markdown.parserTokens.${tokenId}.attrs must be a plain record or null.`,
      { extension: owner, phase: "codec", contribution: tokenId },
    );
  }

  if (value.getAttrs !== undefined && typeof value.getAttrs !== "function") {
    invalidDefinition(
      `markdown.parserTokens.${tokenId}.getAttrs must be a function.`,
      { extension: owner, phase: "codec", contribution: tokenId },
    );
  }

  for (const field of ["noCloseToken", "ignore"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      invalidDefinition(
        `markdown.parserTokens.${tokenId}.${field} must be boolean.`,
        { extension: owner, phase: "codec", contribution: tokenId },
      );
    }
  }
}

function validateMarkSerializer(
  value: unknown,
  name: string,
  owner: string,
) {
  if (!isPlainRecord(value)) {
    invalidDefinition(`markdown.serializer.marks.${name} must be a plain record.`, {
      extension: owner,
      phase: "codec",
      contribution: name,
    });
  }

  for (const field of ["open", "close"] as const) {
    if (typeof value[field] !== "string" && typeof value[field] !== "function") {
      invalidDefinition(
        `markdown.serializer.marks.${name}.${field} must be a string or function.`,
        { extension: owner, phase: "codec", contribution: name },
      );
    }
  }

  for (const field of [
    "mixable",
    "expelEnclosingWhitespace",
    "escape",
  ] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      invalidDefinition(
        `markdown.serializer.marks.${name}.${field} must be boolean.`,
        { extension: owner, phase: "codec", contribution: name },
      );
    }
  }
}

function validateMarkdown(definition: Record<PropertyKey, unknown>, owner: string) {
  const markdown = definition.markdown;

  if (markdown === undefined) {
    return;
  }

  if (!isPlainRecord(markdown)) {
    invalidDefinition("markdown must be a plain record.", {
      extension: owner,
      phase: "codec",
    });
  }

  if (markdown.tokenizerRules !== undefined) {
    if (!Array.isArray(markdown.tokenizerRules)) {
      invalidDefinition("markdown.tokenizerRules must be an array.", {
        extension: owner,
        phase: "tokenizer",
      });
    }

    const ruleIds = new Set<string>();

    markdown.tokenizerRules.forEach((rule, index) => {
      if (!isPlainRecord(rule)) {
        invalidDefinition(`markdown.tokenizerRules[${index}] must be a plain record.`, {
          extension: owner,
          phase: "tokenizer",
        });
      }

      validateLocalId(
        rule.id,
        `markdown.tokenizerRules[${index}].id`,
        owner,
        "tokenizer",
      );
      const id = rule.id as string;

      if (ruleIds.has(id)) {
        invalidDefinition(`Tokenizer rule "${id}" is declared more than once.`, {
          extension: owner,
          phase: "tokenizer",
          contribution: id,
        });
      }

      ruleIds.add(id);

      if (![
        "block",
        "core",
        "inline",
        "inline-post",
      ].includes(rule.phase as string)) {
        invalidDefinition(`Tokenizer rule "${id}" has an invalid phase.`, {
          extension: owner,
          phase: "tokenizer",
          contribution: id,
        });
      }

      if (typeof rule.createRule !== "function") {
        invalidDefinition(`Tokenizer rule "${id}" must provide createRule().`, {
          extension: owner,
          phase: "tokenizer",
          contribution: id,
        });
      }

      for (const field of ["before", "after"] as const) {
        const targets = rule[field];

        if (targets === undefined) {
          continue;
        }

        if (!Array.isArray(targets)) {
          invalidDefinition(`Tokenizer rule "${id}".${field} must be an array.`, {
            extension: owner,
            phase: "tokenizer",
            contribution: id,
          });
        }

        targets.forEach((target, targetIndex) => validateContributionOrderTarget(
          target,
          `Tokenizer rule "${id}".${field}[${targetIndex}]`,
          owner,
        ));
      }
    });
  }

  if (markdown.parserTokens !== undefined) {
    if (!isPlainRecord(markdown.parserTokens)) {
      invalidDefinition("markdown.parserTokens must be a plain record.", {
        extension: owner,
        phase: "codec",
      });
    }

    for (const tokenId of Object.keys(markdown.parserTokens)) {
      if (
        !isValidMarkdownEditorLocalId(tokenId)
        || /_(?:open|close)$/.test(tokenId)
      ) {
        invalidDefinition(
          `Markdown parser token local ID "${tokenId}" must use local lowercase characters and cannot reserve _open/_close suffixes.`,
          { extension: owner, phase: "codec", contribution: tokenId },
        );
      }

      validateParserTokenSpec(markdown.parserTokens[tokenId], tokenId, owner);
    }
  }

  const serializer = markdown.serializer;

  if (serializer !== undefined) {
    if (!isPlainRecord(serializer)) {
      invalidDefinition("markdown.serializer must be a plain record.", {
        extension: owner,
        phase: "codec",
      });
    }

    for (const key of Object.keys(serializer)) {
      if (key !== "escapeExtraCharacters" && key !== "nodes" && key !== "marks") {
        invalidDefinition(`Unknown markdown.serializer key "${key}".`, {
          extension: owner,
          phase: "codec",
          contribution: key,
        });
      }
    }

    const escapeExtraCharacters = serializer.escapeExtraCharacters;

    if (escapeExtraCharacters !== undefined) {
      const supportedExtraEscapeCharacters = "!\"$%&'(),/:;<=?@^{}";

      if (
        typeof escapeExtraCharacters !== "string"
        || escapeExtraCharacters.length === 0
        || [...escapeExtraCharacters].some((character) => (
          !supportedExtraEscapeCharacters.includes(character)
        ))
        || new Set(escapeExtraCharacters).size !== escapeExtraCharacters.length
      ) {
        invalidDefinition(
          "markdown.serializer.escapeExtraCharacters must be a non-empty set of unique supported ASCII delimiter characters.",
          {
            extension: owner,
            phase: "codec",
            contribution: "escapeExtraCharacters",
          },
        );
      }
    }

    for (const kind of ["nodes", "marks"] as const) {
      const handlers = serializer[kind];

      if (handlers === undefined) {
        continue;
      }

      if (!isPlainRecord(handlers)) {
        invalidDefinition(`markdown.serializer.${kind} must be a plain record.`, {
          extension: owner,
          phase: "codec",
        });
      }

      for (const [name, handler] of Object.entries(handlers)) {
        if (!schemaNamePattern.test(name)) {
          invalidDefinition(`markdown.serializer.${kind}.${name} is invalid.`, {
            extension: owner,
            phase: "codec",
            contribution: name,
          });
        }

        if (kind === "nodes" && typeof handler !== "function") {
          invalidDefinition(
            `markdown.serializer.nodes.${name} must be a function.`,
            { extension: owner, phase: "codec", contribution: name },
          );
        }

        if (kind === "marks") {
          validateMarkSerializer(handler, name, owner);
        }
      }
    }
  }
}

function validateDefinition(
  value: unknown,
  allowReservedName = false,
): asserts value is Record<PropertyKey, unknown> {
  if (!isPlainRecord(value)) {
    invalidDefinition("An extension definition must be a plain record.");
  }

  if (allowReservedName) {
    validateExtensionName(value.name, "name");
  } else {
    validatePublicExtensionName(value.name, "name");
  }
  const owner = value.name as string;
  validateVersion(value.version, "version", owner);

  if (!isPlainRecord(value.compatibility)) {
    invalidDefinition("compatibility must be a plain record.", {
      extension: owner,
    });
  }

  validateRange(
    value.compatibility.extensionApi,
    "compatibility.extensionApi",
    owner,
  );
  validateRange(value.compatibility.markora, "compatibility.markora", owner);

  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) {
      invalidDefinition("dependencies must be an array.", { extension: owner });
    }

    const dependencyNames = new Set<string>();
    value.dependencies.forEach((dependency, index) => {
      if (!isPlainRecord(dependency)) {
        invalidDefinition(`dependencies[${index}] must be a plain record.`, {
          extension: owner,
        });
      }

      validateExtensionName(dependency.name, `dependencies[${index}].name`, owner);
      validateRange(dependency.version, `dependencies[${index}].version`, owner);

      if (dependency.optional !== undefined && typeof dependency.optional !== "boolean") {
        invalidDefinition(`dependencies[${index}].optional must be boolean.`, {
          extension: owner,
        });
      }

      if (dependency.name === owner) {
        invalidDefinition("An extension cannot depend on itself.", {
          extension: owner,
        });
      }

      if (dependencyNames.has(dependency.name as string)) {
        invalidDefinition(
          `Dependency "${String(dependency.name)}" is declared more than once.`,
          { extension: owner },
        );
      }

      dependencyNames.add(dependency.name as string);
    });
  }

  for (const field of ["before", "after"] as const) {
    const targets = value[field];

    if (targets === undefined) {
      continue;
    }

    if (!Array.isArray(targets)) {
      invalidDefinition(`${field} must be an array.`, { extension: owner });
    }

    targets.forEach((target, index) => validateOrderTarget(
      target,
      `${field}[${index}]`,
      owner,
    ));
  }

  if (value.conflicts !== undefined) {
    if (!Array.isArray(value.conflicts)) {
      invalidDefinition("conflicts must be an array.", { extension: owner });
    }

    const conflicts = new Set<string>();
    value.conflicts.forEach((conflict, index) => {
      validateExtensionName(conflict, `conflicts[${index}]`, owner);

      if (conflict === owner) {
        invalidDefinition("An extension cannot conflict with itself.", {
          extension: owner,
        });
      }

      if (conflicts.has(conflict as string)) {
        invalidDefinition(`Conflict "${String(conflict)}" is declared more than once.`, {
          extension: owner,
        });
      }

      conflicts.add(conflict as string);
    });
  }

  if (own(value, "configuration")) {
    validateJsonValue(value.configuration, owner, "configuration", new Set());
  }

  validateSchema(value, owner);
  validateMarkdown(value, owner);

  if (value.createStorage !== undefined && typeof value.createStorage !== "function") {
    invalidDefinition("createStorage must be a function when provided.", {
      extension: owner,
    });
  }

  if (value.createRuntime !== undefined && typeof value.createRuntime !== "function") {
    invalidDefinition("createRuntime must be a function when provided.", {
      extension: owner,
    });
  }

  if (value.createStorage !== undefined && value.createRuntime === undefined) {
    invalidDefinition("An extension with createStorage must also provide createRuntime.", {
      extension: owner,
    });
  }
}

function snapshotDefinitionOwnedValue<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return value;
  }

  const existing = seen.get(value);

  if (existing) {
    return existing as T;
  }

  const clone: unknown[] | Record<PropertyKey, unknown> = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor?.enumerable) {
      continue;
    }

    const ownedValue = "value" in descriptor
      ? descriptor.value
      : descriptor.get?.call(value);

    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: snapshotDefinitionOwnedValue(ownedValue, seen),
      writable: true,
    });
  }

  return Object.freeze(clone) as T;
}

function createDefinitionCarrier(
  definition: Record<PropertyKey, unknown>,
) {
  const snapshot = snapshotDefinitionOwnedValue(definition) as Record<PropertyKey, unknown>;
  const carrier = Object.create(Object.getPrototypeOf(snapshot)) as Record<PropertyKey, unknown>;

  for (const key of Reflect.ownKeys(snapshot)) {
    Object.defineProperty(carrier, key, Object.getOwnPropertyDescriptor(snapshot, key)!);
  }

  Object.defineProperty(carrier, runtimeExtensionBrand, {
    enumerable: false,
    value: true,
  });
  Object.freeze(carrier);
  return carrier;
}

function createValidatedDefinitionCarrier(
  definition: unknown,
  allowReservedName: boolean,
) {
  let carrier: Record<PropertyKey, unknown>;

  try {
    if (!isPlainRecord(definition)) {
      invalidDefinition("An extension definition must be a plain record.");
    }

    carrier = createDefinitionCarrier(definition);
  } catch (cause) {
    if (cause instanceof MarkdownEditorExtensionError) {
      throw cause;
    }

    invalidDefinition("The extension definition could not be snapshotted.", {
      cause,
    });
  }

  validateDefinition(carrier, allowReservedName);
  registerMarkdownEditorExtensionDefinition(carrier, carrier);
  return carrier;
}

export function defineMarkdownEditorExtension<
  const TRuntime extends object = Record<never, never>,
>(
  definition: MarkdownEditorExtensionWithoutStorageDefinition<TRuntime>,
): MarkdownEditorExtension<
  MarkdownEditorRuntimeCommands<TRuntime>,
  MarkdownEditorRuntimeState<TRuntime>,
  undefined
>;

export function defineMarkdownEditorExtension<
  TStorage,
  const TRuntime extends object = Record<never, never>,
>(
  definition: ContextualMarkdownEditorExtensionDefinition<TStorage, TRuntime>,
): MarkdownEditorExtension<
  MarkdownEditorRuntimeCommands<TRuntime>,
  MarkdownEditorRuntimeState<TRuntime>,
  TStorage
>;

export function defineMarkdownEditorExtension(
  definition: MarkdownEditorStaticExtensionDefinition,
): MarkdownEditorExtension;

export function defineMarkdownEditorExtension(
  definition: unknown,
): MarkdownEditorExtension {
  return createValidatedDefinitionCarrier(definition, false) as MarkdownEditorExtension;
}

/**
 * Defines a project-owned extension in the reserved Markora namespaces.
 * Third-party callers must use defineMarkdownEditorExtension instead.
 * @internal
 */
export function defineMarkoraMarkdownEditorExtension<
  const TRuntime extends object = Record<never, never>,
>(
  definition: MarkdownEditorExtensionWithoutStorageDefinition<TRuntime>,
): MarkdownEditorExtension<
  MarkdownEditorRuntimeCommands<TRuntime>,
  MarkdownEditorRuntimeState<TRuntime>,
  undefined
>;

/** @internal */
export function defineMarkoraMarkdownEditorExtension<
  TStorage,
  const TRuntime extends object = Record<never, never>,
>(
  definition: ContextualMarkdownEditorExtensionDefinition<TStorage, TRuntime>,
): MarkdownEditorExtension<
  MarkdownEditorRuntimeCommands<TRuntime>,
  MarkdownEditorRuntimeState<TRuntime>,
  TStorage
>;

/** @internal */
export function defineMarkoraMarkdownEditorExtension(
  definition: MarkdownEditorStaticExtensionDefinition,
): MarkdownEditorExtension;

/** @internal */
export function defineMarkoraMarkdownEditorExtension(
  definition: unknown,
): MarkdownEditorExtension {
  return createValidatedDefinitionCarrier(definition, true) as MarkdownEditorExtension;
}

/** @internal */
export function readMarkdownEditorExtensionDefinition(
  definition: AnyMarkdownEditorExtension,
): InternalMarkdownEditorExtensionDefinition {
  if (typeof definition !== "object" || definition === null) {
    invalidDefinition("Expected a definition returned by defineMarkdownEditorExtension().");
  }

  const registered = readRegisteredMarkdownEditorExtensionDefinition(definition);

  if (!registered || !(runtimeExtensionBrand in definition)) {
    invalidDefinition(
      "Expected a definition returned by defineMarkdownEditorExtension(); structural objects are not extensions.",
    );
  }

  return registered as InternalMarkdownEditorExtensionDefinition;
}

export function defineMarkdownEditorPreset(
  definition: MarkdownEditorExtensionPresetDefinition,
): MarkdownEditorExtensionPreset {
  if (!isPlainRecord(definition)) {
    invalidDefinition("An extension preset must be a plain record.");
  }

  let name: unknown;
  let version: unknown;
  let sourceExtensions: unknown;

  try {
    name = definition.name;
    version = definition.version;
    sourceExtensions = definition.extensions;
  } catch (cause) {
    invalidDefinition("The extension preset could not be snapshotted.", {
      cause,
    });
  }

  const hasName = name !== undefined;
  const hasVersion = version !== undefined;

  if (hasName !== hasVersion) {
    invalidDefinition("A named extension preset must provide both name and version.");
  }

  if (name !== undefined) {
    validateExtensionName(name, "preset.name");
    validateVersion(version, "preset.version");
  }

  if (!Array.isArray(sourceExtensions)) {
    invalidDefinition("preset.extensions must be an array.");
  }

  const extensions = Array.from(sourceExtensions, (extension) => {
    readMarkdownEditorExtensionDefinition(extension);
    return extension;
  });
  Object.freeze(extensions);

  const preset: Record<PropertyKey, unknown> = {
    ...(name !== undefined ? { name } : {}),
    ...(version !== undefined ? { version } : {}),
    extensions,
  };
  Object.defineProperty(preset, runtimePresetBrand, {
    enumerable: false,
    value: true,
  });
  Object.freeze(preset);
  registerMarkdownEditorExtensionPreset(preset, preset);
  return preset as MarkdownEditorExtensionPreset;
}

/** @internal */
export function readMarkdownEditorExtensionPreset(
  preset: MarkdownEditorExtensionPreset,
): InternalMarkdownEditorExtensionPreset {
  if (typeof preset !== "object" || preset === null) {
    invalidDefinition("Expected a preset returned by defineMarkdownEditorPreset().");
  }

  const registered = readRegisteredMarkdownEditorExtensionPreset(preset);

  if (!registered || !(runtimePresetBrand in preset)) {
    invalidDefinition(
      "Expected a preset returned by defineMarkdownEditorPreset(); structural objects are not presets.",
    );
  }

  return registered as InternalMarkdownEditorExtensionPreset;
}
