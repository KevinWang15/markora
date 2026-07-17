# Markora Extension System RFC

- Status: Accepted design for `EE-009`
- Extension API version: `1.2.0`
- Accepted: 2026-07-15
- Implemented: `EE-010`; host resource boundary integrated by `EE-012`; additive source, tokenizer-anchor, and serializer literal-escape contracts integrated for `EE-021`

## Decision summary

Markora will compile an immutable extension set into a per-editor assembly containing the schema, Markdown codec, ProseMirror behavior, namespaced host APIs, and lifecycle resources. Extension definitions are reusable and side-effect-free; mutable storage and setup belong to one editor instance.

The first extension API is creation-time only. It supports additive schema nodes and marks, Markdown-it rules, parser and serializer handlers, commands, state queries, storage, plugins, keymaps, input rules, NodeViews, synchronous paste/drop hooks, and headless UI actions. It does not support installing, removing, or reordering extensions on a live editor.

`createEditor()` without extension options must retain today's behavior through a default compatibility preset. A minimal preset omits optional and expensive behavior, and a separate `markora/minimal` entry keeps the default graph out of minimal bundles. Optional syntax and renderers live in separately imported, tree-shakable packages; there is no global registry or auto-discovery.

This document approved the contract before implementation. The private prototype that originally lived under `packages/extension-rfc-prototype` was executable design evidence, not a supported Markora extension package; EE-010 replaced and removed it after the real public kernel gained equivalent package-consumer coverage.

## Goals

- Let a host add block and inline Markdown syntax without importing private Markora modules.
- Compose schema, codec, editing behavior, and host-facing APIs deterministically.
- Detect ambiguous or incompatible contributions before editor DOM is created.
- Keep commands, state, storage, setup, and cleanup scoped to their owning extension.
- Preserve Markdown fidelity, read-only policy, lifecycle guarantees, accessibility, and error attribution.
- Keep the base editor small and allow optional features and renderers to remain out of the bundle.
- Preserve the current embedded-editor API through compatibility adapters.

## Non-goals for extension API v1

- Dynamic extension installation, removal, or schema changes.
- Replacing the complete Markdown parser, serializer, schema, or top node.
- Removing or silently overriding another extension's contribution.
- Asynchronous parsing or serialization.
- Extension-defined file upload, progress, retry, and cancellation contributions. Hosts use the separate `CreateEditorOptions.resources` boundary delivered by `EE-012`.
- Collaboration, comments, presence, or persistence of plugin/storage state.
- Loading untrusted extension code in a sandbox.
- Framework component renderers, theme tokens, localization catalogs, or an icon system.
- Automatic extension discovery or npm package installation.

## Why a compiler is required

The current schema, Markdown-it tokenizer, `MarkdownParser`, and `MarkdownSerializer` are module singletons in `packages/core/src/markdownCodec.ts`. Schema-bound helpers, commands, plugin ordering, NodeViews, managed-block handling, and toolbar state are assembled statically in `createEditor.ts`. The only narrow customization points are code-language loaders, the fixed default-UI factory, and raw ProseMirror access.

An adapter cannot safely add a schema node after `EditorState` exists, and a ProseMirror plugin cannot add a Markdown parser or serializer handler. `EE-010` must therefore introduce this boundary:

```text
extension definitions + preset
              |
              v
   compileExtensions(...)
              |
              v
 EditorAssembly { schema, codec, runtime contributions, manifest }
              |
              v
      createEditorRuntime(...)
```

Parsing during creation, reconciliation, and reset must use the same immutable assembly. A hard reset recreates ProseMirror plugin state, but it does not rebuild the extension assembly, recreate extension storage, or rerun extension setup.

## Terminology

- **Definition**: an immutable, reusable extension description returned by `defineMarkdownEditorExtension()`.
- **Preset**: an immutable ordered set of configured definitions. The default preset preserves today's behavior; the minimal preset contains only the editor foundation.
- **Assembly**: the validated per-editor schema, codec, contribution registries, ordering, and manifest compiled before the host element is claimed.
- **Instance**: one extension's per-editor storage, commands, queries, setup, and cleanup.
- **Contribution**: a named schema, codec, runtime, clipboard, or UI entry owned by one definition.
- **Contribution ID**: `${extensionName}/${localId}`. Diagnostics and ordering use the fully qualified form.

## Public API shape

The following is the approved public boundary. Supporting contribution interfaces may be split across files, but the branded carrier, definition identity, typed lookup, and behavioral rules are normative. `EE-010` must add declaration tests before refining any mechanical generic shape.

```ts
export const MARKORA_EXTENSION_API_VERSION = "1.2.0" as const;

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

declare const markdownEditorExtensionBrand: unique symbol;
declare const markdownEditorExtensionTypes: unique symbol;

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

export type MarkdownEditorExtensionDefinition<
  TCreateStorage extends (
    context: MarkdownEditorExtensionStorageContext,
  ) => unknown,
  TRuntime extends MarkdownEditorExtensionRuntime<
    ReturnType<TCreateStorage>
  >,
> = Readonly<{
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

  createStorage: TCreateStorage;
  createRuntime(
    context: MarkdownEditorExtensionAssemblyContext<
      ReturnType<TCreateStorage>
    >,
  ): TRuntime;
}>;

export function defineMarkdownEditorExtension<
  const TCreateStorage extends (
    context: MarkdownEditorExtensionStorageContext,
  ) => unknown,
  const TRuntime extends MarkdownEditorExtensionRuntime<
    ReturnType<TCreateStorage>
  >,
>(
  definition: MarkdownEditorExtensionDefinition<
    TCreateStorage,
    TRuntime
  >,
): MarkdownEditorExtension<
  MarkdownEditorRuntimeCommands<TRuntime>,
  MarkdownEditorRuntimeState<TRuntime>,
  ReturnType<TCreateStorage>
>;
```

`AnyMarkdownEditorExtension` is the type-erased carrier for heterogeneous arrays. Its hidden brand prevents a plain structurally similar object from entering the compiler, while `MarkdownEditorExtension<TCommands, TState, TStorage>` retains the types needed for exact-object lookup. `createRuntime()` is one per-editor factory so TypeScript can first infer storage and then contextually type every runtime contribution; the returned command/state maps determine the handle types. A no-storage overload omits `createStorage`, supplies `undefined`, and permits a static-only definition to omit `createRuntime`.

The helper validates, snapshots, and deeply freezes definition-owned arrays and plain records in every build. Functions are retained by identity; mutating objects captured inside a callback remains unsupported. A definition must not capture a live editor, DOM node, or shared mutable per-editor state. An extension factory may intentionally capture trusted host-service callbacks or loaders as immutable runtime-only configuration; they are excluded from the persistence manifest and make that configured definition specific to the host service lifetime. `createRuntime()` may close over those values and receives editor-instance values from its context.

```ts
const counterExtension = defineMarkdownEditorExtension({
  name: "@acme/counter",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.1.0" },
  createStorage: () => ({ value: 0 }),
  createRuntime: ({ storage }) => ({
    commands: {
      increment: (step: number = 1) => {
        storage.value += step;
        return true;
      },
    },
    state: {
      value: () => storage.value,
    },
  }),
});
```

`CreateEditorOptions` gains a preset and additive extension list:

```ts
type CreateEditorOptions = {
  // Existing fields remain.
  extensionPreset?: MarkdownEditorExtensionPreset;
  extensions?: readonly AnyMarkdownEditorExtension[];
};

createEditor({
  element,
  extensionPreset: createMinimalMarkdownEditorPreset(),
  extensions: [calloutExtension, highlightExtension],
});
```

If `extensionPreset` is omitted, `createDefaultMarkdownEditorPreset()` is used. Passing `extensions` adds to that preset; it does not replace or override entries. `defineMarkdownEditorPreset()` provides an explicit route for an advanced host to build a complete set from the minimal preset.

Extensions are exposed without merging arbitrary keys into the stable core command object:

```ts
const callout = editor.extensions.get(calloutExtension);

callout.commands.insert({ kind: "warning" });
callout.state.isActive();
callout.storage;
```

Lookup by the definition object preserves generic command, state, and storage types. Lookup by string returns the untyped base handle. `editor.commands`, `editor.state`, and `getToolbarState()` remain compatibility façades for built-in behavior.

Object lookup is nominal and uses the exact definition identity installed in that editor; a clone is not equivalent. Looking up a definition that was not installed throws `MarkdownEditorExtensionError` with code `EXTENSION_NOT_INSTALLED`. The registry also exposes `has(definitionOrName)` for guarded lookup and a read-only compiled `manifest` described below.

### Runtime and contribution minimums

The exact interfaces may gain additive optional context fields during `EE-010`, but the following minimum shapes and ownership rules are approved:

```ts
type MarkdownEditorContributionOrderTarget =
  | string
  | Readonly<{ id: string; optional: true }>;

type MarkdownEditorOrderedContribution = Readonly<{
  id: string; // local ID; the compiler qualifies it with the owner name
  before?: readonly MarkdownEditorContributionOrderTarget[];
  after?: readonly MarkdownEditorContributionOrderTarget[];
}>;

type MarkdownEditorLifecycleScope = Readonly<{
  signal: AbortSignal;
  addCleanup(cleanup: () => void): void;
}>;

type MarkdownEditorExtensionAssemblyContext<TStorage> = Readonly<{
  schema: Schema;
  codec: MarkdownEditorCodec;
  storage: TStorage;
  dependencies: MarkdownEditorDependencyHandles;
  lifecycle: MarkdownEditorLifecycleScope;
  ids: MarkdownEditorNamespacedIdFactory;
  getState(): EditorState;
  dispatch(transaction: Transaction): boolean;
  runCommand(command: Command): boolean;
  reportError(error: unknown, contribution?: string): void;
}>;

type MarkdownEditorPluginContributionFactory<Storage> =
  MarkdownEditorOrderedContribution & Readonly<{
    create(context: MarkdownEditorExtensionAssemblyContext<Storage>): Plugin;
  }>;

type MarkdownEditorKeymapContribution<Storage> =
  MarkdownEditorOrderedContribution & Readonly<{
    key: string;
    create(context: MarkdownEditorExtensionAssemblyContext<Storage>): Command;
  }>;

type MarkdownEditorInputRuleContribution<Storage> =
  MarkdownEditorOrderedContribution & Readonly<{
    create(context: MarkdownEditorExtensionAssemblyContext<Storage>): InputRule;
  }>;

type MarkdownEditorNodeViewContribution<Storage> =
  MarkdownEditorOrderedContribution & Readonly<{
    node: string;
    create(
      context: MarkdownEditorExtensionAssemblyContext<Storage>,
    ): NodeViewConstructor;
  }>;

type MarkdownEditorExtensionCommandMap = Readonly<Record<
  string,
  (...args: never[]) => boolean
>>;

type MarkdownEditorExtensionStateMap = Readonly<Record<
  string,
  (...args: never[]) => unknown
>>;

type MarkdownEditorExtensionRuntime<
  Storage,
  Commands extends MarkdownEditorExtensionCommandMap =
    MarkdownEditorExtensionCommandMap,
  State extends MarkdownEditorExtensionStateMap =
    MarkdownEditorExtensionStateMap,
> = Readonly<{
  commands?: Commands;
  state?: State;
  plugins?: readonly MarkdownEditorPluginContributionFactory<Storage>[];
  keymaps?: readonly MarkdownEditorKeymapContribution<Storage>[];
  inputRules?: readonly MarkdownEditorInputRuleContribution<Storage>[];
  nodeViews?: readonly MarkdownEditorNodeViewContribution<Storage>[];
  clipboard?: MarkdownEditorClipboardContribution<Storage>;
  ui?: readonly MarkdownEditorUiActionContribution<Commands, State>[];
  setup?: (
    context: MarkdownEditorExtensionSetupContext<Commands, State, Storage>,
  ) => void | (() => void);
}>;

type MarkdownEditorRuntimeCommands<Runtime> =
  Runtime extends { readonly commands: infer Commands extends object }
    ? Commands
    : Record<never, never>;

type MarkdownEditorRuntimeState<Runtime> =
  Runtime extends { readonly state: infer State extends object }
    ? State
    : Record<never, never>;
```

`createRuntime()` returns direct host-shaped command/state functions that close over its immutable assembly context; public callers never supply ProseMirror state or dispatch. The late-bound `getState()`, `dispatch()`, and `runCommand()` bridge always resolves the editor's current view state. `dispatch()` accepts only a transaction created from that current state, tags the extension origin, and applies lifecycle/read-only policy; `runCommand()` invokes an ordinary ProseMirror `Command` through the same path. Calling the bridge during `createRuntime()` itself fails with `EXTENSION_RUNTIME_NOT_READY`; returned closures use it only after the view exists. Reset changes the bridge's current state without recreating the closures.

The runtime also returns the named contributions above. Clipboard contributions use the same ordered base. Transforms declare `text`, `html`, or `slice` plus `outer`, `nested-code`, or `both`, and return the transformed value. Paste/drop handlers declare a surface and return `true` only when they consumed the event. Nested code editors are plain-text surfaces: they run `html` transforms before converting changed HTML to text, then run `text` transforms, and have no ProseMirror `Slice` stage. A `slice` transform targeting only `nested-code` is invalid; a `slice` transform targeting `both` runs only on the outer ProseMirror surface. UI actions use the typed zero-argument references defined below. Every nested contribution factory receives the finalized assembly context; none receives a partially constructed schema or codec.

The definition helper's declaration contract rejects command-map members that are not functions returning `boolean` and state-map members that are not functions. This validation is applied after inferring the `createRuntime()` return, avoiding a broad contextual index signature that would erase command parameter types. Authors must annotate command parameters because TypeScript can infer returns but cannot infer the intended host argument types.

The storage context contains the finalized schema/codec, declared dependency storage, namespaced IDs, and an assembly lifecycle scope, but not the extension's own not-yet-created storage. The setup context adds the public editor, `EditorView`, typed extension handle, and a setup lifecycle scope. These phase-specific contexts prevent callbacks from observing half-initialized peer extensions.

The public registry has an exact-definition overload returning `MarkdownEditorExtensionHandle<TCommands, TState, TStorage>`, plus an untyped string overload. A handle exposes read-only command/state maps and a read-only storage projection. Dependency handles are available only for declared dependencies and are created in dependency order. Presets are branded, immutable `{ name?, version?, extensions }` values; definitions inside them are already configured.

## Identity and version compatibility

### Names

Extension names use lowercase npm-style package IDs such as `@acme/callout` or `acme-callout`. `markora/*` and `@markora/*` are reserved for the project. Names are stable persistence and diagnostic identifiers; renaming an extension is a breaking change.

Local contribution IDs use lowercase letters, digits, dots, dashes, or underscores. Schema node and mark names must satisfy ProseMirror's lowercase snake-case conventions, such as `acme_callout`. Schema identifiers are global. Third-party extensions should prefix them because Markora never rewrites names stored in ProseMirror documents.

### Versions

- `version` is the extension definition's SemVer.
- `compatibility.extensionApi` is a SemVer range for `MARKORA_EXTENSION_API_VERSION`.
- `compatibility.markora` is a SemVer range for the tested `markora` package.
- Required dependencies must be installed and satisfy their declared ranges.
- Optional dependencies add a dependency and ordering edge only when present; an installed but incompatible optional dependency is still an error.
- Markora validates metadata and ranges; it never installs a dependency.

Published extension packages must peer-depend on a compatible `markora` version. Package peer dependency validation and runtime metadata validation are both required: the former helps package managers, while the latter covers bundled or manually assembled definitions.

## Dependency, conflict, and ordering rules

Composition is deterministic for the same preset and extension array:

1. Validate names, versions, declared conflicts, and compatibility ranges.
2. Reject duplicate extension names, including two copies of the same definition.
3. Add required dependency edges from dependency to dependent.
4. Add optional dependency edges when that dependency is installed.
5. Add explicit `before` and `after` edges. A string target is required; `{ name, optional: true }` contributes an edge only when the target is installed.
6. Reject missing non-optional order targets and all dependency/order cycles.
7. Perform a stable topological sort. Unconstrained definitions retain host registration order, with extension name as the final deterministic tie-breaker.
8. Retain declaration order for contributions owned by one extension unless contribution-level edges say otherwise.
9. Destroy and roll back in the exact reverse resolved order.

A missing required `before` or `after` target is an error rather than an ignored typo. An explicitly optional order target is distinct from an optional dependency: it can express “run before this peer when present” without incorrectly making that peer a prerequisite or reversing the desired edge.

Contribution-level `before` and `after` references use fully qualified contribution IDs, support the same explicit `{ id, optional: true }` form, and cannot cross contribution phases. This is required for cases such as a specific callout tokenizer rule that must run before Markora's generic opaque-directive fallback without moving every contribution from either extension.

## Collision policy

Markora never uses implicit last-writer-wins composition.

| Contribution | Collision behavior |
| --- | --- |
| Extension name or declared extension conflict | Fatal during resolve |
| Schema node or mark name | Fatal during schema assembly |
| Patch/replacement/removal of an existing schema type | Rejected in v1 |
| Markdown parser token ID | Fatal within its extension; foundation handlers cannot be replaced |
| Node or mark serializer owner | Fatal during codec assembly |
| Markdown-it contribution/rule ID | Fatal during tokenizer assembly |
| NodeView for one node type | Fatal during runtime assembly |
| Command or state key inside one extension | Fatal during definition validation |
| ProseMirror plugin contribution ID or `PluginKey` | Fatal when detectable during assembly |
| UI action ID | Fatal after qualification |
| Key binding | Ordered first-`true` handler chain |
| Input rules whose regular expressions overlap | First matching rule in resolved order |
| Paste/drop handler | First handler returning `true` |
| Clipboard transform | Every transform, feeding its result to the next |

Two extensions that bind the same key are allowed because fallback chains are useful. Their handlers run in resolved extension and declaration order, including the stable host-registration fallback for otherwise unconstrained peers. Regex overlap cannot be determined reliably; input-rule authors must document intentional precedence and declare an explicit edge when relying on precedence across extensions.

CSS class names, DOM attributes, and arbitrary behavior inside a raw ProseMirror plugin cannot be fully inspected. Authors must namespace them. Raw plugins remain an expert escape hatch with weaker diagnostics than structured contributions.

## Schema composition

V1 schema contributions are additive:

```ts
type MarkdownEditorSchemaEntry<TSpec> = Readonly<{
  name: string;
  spec: TSpec;
  before?: string | Readonly<{ name: string; optional: true }>;
  after?: string | Readonly<{ name: string; optional: true }>;
}>;

type MarkdownEditorSchemaContribution = Readonly<{
  nodes?: readonly MarkdownEditorSchemaEntry<NodeSpec>[];
  marks?: readonly MarkdownEditorSchemaEntry<MarkSpec>[];
  managedBlocks?: readonly string[];
}>;
```

Entries are inserted in resolved extension order unless locally positioned relative to another schema name. A required target must exist; an explicitly optional target contributes no edge when absent. Node/mark replacement, removal, and arbitrary mutation of existing specs are rejected.

The Markora foundation schema must expose ordinary groups (`block`, `inline`) and stable attrs needed by compatibility features. During `EE-010`, current one-off mutations—heading inline content, code-block selection behavior, and task-item attrs—must move into that foundation or an explicitly internal compatibility adapter. Internal privileges are not a public override precedent.

`managedBlocks` opts block node types into Markora's outer cursor and boundary-navigation contract. The compiler verifies that each entry is a contributed block node with compatible selection behavior.

Every non-transient contributed node or mark must have a serializer. V1 does not allow transient document schema types; use decorations or plugin state for ephemeral UI.

## Markdown tokenizer, parser, and serializer

```ts
type MarkdownEditorMarkdownContribution = Readonly<{
  tokenizerRules?: readonly MarkdownEditorTokenizerRule[];
  // Keys are local IDs and are qualified by the compiler.
  parserTokens?: Readonly<Record<string, ParseSpec>>;
  serializer?: Readonly<{
    // Additional characters that ordinary literal text must escape so it
    // cannot become extension syntax after serialization and reparsing.
    escapeExtraCharacters?: string;
    nodes?: Readonly<Record<string, MarkdownNodeSerializer>>;
    marks?: Readonly<Record<string, MarkdownMarkSerializer>>;
  }>;
}>;

type MarkdownEditorTokenizerNamespace = Readonly<{
  token(localId: string): string;
}>;

function sliceMarkdownEditorOriginalSourceLines(
  environment: unknown,
  startLine: number,
  endLine: number,
): string | null;

type MarkdownEditorTokenizerRule = MarkdownEditorOrderedContribution &
  Readonly<{
    phase: "block" | "inline" | "inline-post" | "core";
    createRule(namespace: MarkdownEditorTokenizerNamespace): MarkdownItRule;
  }>;
```

Tokenizer rules declare:

- a local ID;
- `block`, `inline`, `inline-post`, or `core` phase;
- optional fully qualified contribution-level `before`/`after` edges, each of which may be explicitly optional;
- a synchronous pure `createRule({ token })` factory.

Markora publishes virtual IDs for the foundation anchors extensions need: `@markora/foundation/block/fence`, `@markora/foundation/block/blockquote`, `@markora/foundation/block/hr`, `@markora/foundation/block/reference`, `@markora/foundation/block/paragraph`, `@markora/foundation/inline/text`, `@markora/foundation/inline/emphasis`, `@markora/foundation/core/block`, and `@markora/foundation/core/inline`. The compatibility codec also publishes optional `@markora/table/table`, `@markora/opaque/frontmatter`, `@markora/opaque/display-math`, `@markora/opaque/directive`, `@markora/opaque/inline-directive`, `@markora/opaque/html-source`, and `@markora/opaque/inline-source` anchors. These IDs follow their underlying Markdown-it order and are stable even if the internal rule names change. Optional built-in anchors must be targeted with `{ id, optional: true }` by extensions that also support the minimal codec. Adding an anchor is additive, but removing or changing an anchor's ordering semantics is an extension API major change.

`sliceMarkdownEditorOriginalSourceLines(environment, startLine, endLine)` exposes an exact, half-open, zero-based line slice to tokenizer callbacks without exposing mutable source bookkeeping. It retains authored BOMs and CRLF/CR/LF line endings between the selected lines, returns `null` for a foreign environment or invalid/out-of-bounds range, and is available in both compatibility and minimal codec parses. Markora keeps the original source metadata private rather than adding writable fields to the Markdown-it environment; extensions may continue to use their own namespaced environment entries.

`markora/extension-api` also re-exports ProseMirror history's `closeHistory()` helper. Extension commands use it when successive host-driven source replacements must remain distinct undo steps; this preserves constructor identity without requiring a second `prosemirror-history` installation.

The compiler first collects the complete tokenizer graph, validates phase-local targets and cycles, computes final order, calls each rule factory with its namespace, and only then registers rules. Registration therefore cannot depend on host extension order or on a target callback having run first. The supported registrar maps virtual foundation IDs to Markdown-it and exposes only ordered rule installation; raw Markdown-it rule names are not valid public targets.

Markora namespaces contributed rule IDs. Direct whole-ruler replacement through `ruler.at()` and whole-parser replacement are outside v1. A returned rule may use supported Markdown-it state and tokens, but every emitted custom token type must come from `token(localId)` rather than a hand-written global name. The helper preserves `_open`/`_close` suffix semantics and returns a stable fully qualified token name. Registration failures are attributed to the owning contribution.

`parserTokens` keys are local root IDs. The compiler qualifies them with the identical token namespace before constructing `MarkdownParser`, so a local `container` handler matches `token("container_open")`/`token("container_close")` output without definition-time access to runtime helpers. Parser keys containing a scope separator, a reserved foundation prefix, or an `_open`/`_close` suffix are rejected, and foundation token handlers cannot be claimed or replaced. Node/mark serializer keys refer to global schema names and are collision-checked. The compiler verifies that:

- each parser target exists in the final schema;
- each persisted schema contribution has a serializer;
- each contributed serializer has an owning schema type;
- tokenizer placement targets exist in the same phase;
- tokenizer output types and parser token handlers resolve through the same extension namespace;
- the generic opaque recognizer runs after installed specific syntax where declared.

`serializer.escapeExtraCharacters` is an additive fixed-point safeguard for an
extension's delimiter characters in ordinary literal text. It must be a
non-empty string containing unique characters from the supported set
`! " $ % & ' ( ) , / : ; < = ? @ ^ { }`. Whitespace, controls, letters,
digits, non-ASCII characters, duplicates, and punctuation already handled by
foundation or contextual escaping are rejected. In particular, an extension
must not contribute `` ` * \\ ~ [ ] _ + - > # . | ``; applying the extra pass
after the foundation or table pass would otherwise double-escape those
characters in some contexts. Both the root compatibility codec and the minimal
codec combine the character sets from every installed extension into a fresh
global expression; the compatibility codec also retains its foundation
literal-text escapes. This deliberately narrow grammar cannot express
zero-width matches, captures, backreferences, or multi-character replacements,
and one extension cannot replace or weaken another extension's requirement.

The combined expression is used by the standard Markdown serializer text path:
if parsing leaves an extension delimiter as literal model text, serialization
backslash-escapes it so a subsequent parse cannot claim it as semantic syntax.
This is not a Markdown postprocessor. A contributed semantic serializer that
deliberately emits its own delimiter shell must bypass ordinary text escaping
for that output (for example, with `state.text(canonicalSource, false)`) after
validating the node source. Math uses this distinction so literal dollar signs
serialize escaped while the canonical `$...$` and `$$` shells of semantic math
nodes remain active syntax.

Parsing and serialization remain synchronous. Extensions may read/write a namespaced object inside the Markdown-it environment, but cannot mutate another extension's environment entry.

Markdown fidelity policy still applies. An extension must document its accepted source, canonical output, unsupported shapes, and behavior when its package is absent. Generic opaque preservation may protect directive-like source, but Markora does not promise that arbitrary missing-extension syntax will survive. Hosts that persist such syntax must persist an extension manifest beside Markdown and load a compatible set before editing.

## Commands, state, and storage

- `createRuntime()` receives the finalized schema, per-editor storage, dependency handles, and the late-bound runtime bridge, then returns extension-local host-shaped command and state maps.
- Commands return `boolean` and are automatically guarded by editor lifecycle and read-only policy.
- Transactions dispatched by a structured extension command receive origin `extension:<extension-name>`.
- State contributions call `getState()` when invoked so they always query the current `EditorState`; they cannot dispatch directly or through `runCommand()`, and should not mutate captured storage.
- Per-editor mutable data is created synchronously by `createStorage()` in resolved dependency order.
- Persistent transactional state belongs in a ProseMirror plugin state field, not ordinary storage.
- Storage is not serialized, migrated, cleared by `resetMarkdown()`, or shared between editors.
- Host access to storage is typed but read-only at the API boundary; the owning extension controls mutation.

Commands and state remain extension-local to avoid name collisions and impossible global TypeScript augmentation. Dependencies access each other only through declared dependency handles. The single runtime factory is also the TypeScript inference boundary: storage is known before command/state closures are contextually checked. The kernel enforces the editor-state boundary for queries, including nested calls, and attributes attempted dispatch to the innermost query. Storage purity remains an extension-author rule because neither TypeScript nor the runtime can reliably detect mutation through an arbitrary captured object graph.

## Plugins, keymaps, input rules, and NodeViews

Runtime factories receive an immutable context containing the final schema, codec, storage, dependency handles, DOM owner document, lifecycle signal, error reporter, and namespaced ID helpers.

The compiler uses fixed lanes so extensions cannot precede kernel policy:

1. Kernel read-only, configured asset-transfer, and initial import-sanitization policy.
2. Ordered clipboard transforms and structured input rules.
3. Ordered extension behavior plugins.
4. Kernel MIME selection plus the final imported-content sanitizer.
5. History.
6. Ordered extension and built-in keymaps.
7. Base ProseMirror keymap.

The stable tokenizer anchors and optional tokenizer rule IDs are published above. `EE-010` keeps the default table/task/CodeMirror/opaque runtime behavior in named compatibility adapters rather than pretending their legacy plugin fragments are additive public contributions. They therefore expose no false runtime contribution IDs: their kernel lanes remain fixed, while public extension contributions order against one another inside the documented lanes. A later adapter migration must publish stable IDs before allowing third-party edges to target it. Structured key bindings form a first-`true` chain. A contribution that needs internal fallback, such as table `Tab` before list indentation, should declare one command that performs that chain rather than relying on accidental plugin order.

One NodeView owner is allowed per node type. The kernel validates each returned NodeView and its callback surface, wraps constructor and callback failures with extension/contribution attribution, and isolates `destroy()` failures so one broken view cannot prevent sibling cleanup. NodeView constructors receive the lifecycle/error context, must clean DOM and async work in `destroy()`, and must not create global listeners without returning owned cleanup. Lazy resources must use versioned cancellation like the existing CodeMirror language loader.

## Paste and drop

Clipboard contributions distinguish transformations from handlers:

- plain-text, HTML, and `Slice` transforms run as pipelines in resolved order;
- paste and drop handlers short-circuit on the first `true` result;
- every hook declares whether it applies to the outer ProseMirror surface, a nested code surface, or both;
- hooks are synchronous in v1.

For an outer browser paste without HTML, the kernel recognizes `text/markdown` only after file policy and raw DOM handlers have had their fixed precedence. It then runs the ordered text transforms, parses with the finalized per-editor codec, runs slice transforms including raw-plugin props and the final sanitizer, and invokes the ordinary paste-handler chain exactly once before one default transaction. Rich HTML remains on ProseMirror's detached schema-parser path and outranks Markdown because it may carry internal slice context or semantics Markdown cannot encode. Plain input is never auto-detected as Markdown. The typed `pasteMarkdown()` and `pastePlainText()` host commands run the corresponding transform/parse/sanitize path without inventing a browser event.

Outbound copy is a separate contract. The kernel first honors ProseMirror `transformCopied`, then derives semantic HTML, canonical Markdown, and human-readable plain text from that returned slice. Inbound extension text/HTML/slice transforms and paste handlers do not run on copy. A raw plugin that contributes `transformCopied` is trusted application code and remains responsible for the validity of any attrs it introduces.

Kernel file rejection/configured upload, URL sanitization, and read-only checks run outside extension precedence. A structured clipboard contribution cannot intercept a file before the configured asset hook or upload a file inside nested CodeMirror, and an extension slice transform runs before the final built-in link/image sanitizer. A trusted handler or raw plugin that dispatches its own arbitrary transaction is not rewritten by that import clamp and remains responsible for validated attrs. The host's asynchronous upload callback is outside the extension contribution graph: it is supplied once through `CreateEditorOptions.resources.assets`, and its successful URL is sanitized before one mapped, undoable insertion transaction.

The host asset workflow intentionally does not make asynchronous clipboard contributions part of extension API v1. Extensions that define their own media node type may expose an extension-local command/UI action and a trusted host service, but they do not inherit the core asset state machine or policy automatically.

## UI contributions

Core remains headless. V1 UI contributions are framework-neutral action metadata:

```ts
type ZeroArgumentBooleanKey<T extends object> = Extract<{
  [K in keyof T]: T[K] extends () => boolean ? K : never;
}[keyof T], string>;

type MarkdownEditorUiActionContribution<
  Commands extends object,
  State extends object,
> = Readonly<{
  id: string;
  group: string;
  order?: number;
  defaultLabel: string;
  command: ZeroArgumentBooleanKey<Commands>;
  enabled?: ZeroArgumentBooleanKey<State>;
  active?: ZeroArgumentBooleanKey<State>;
}>;
```

The editor exposes ordered, fully qualified actions to a host or UI adapter. Core renders nothing. `markora-ui` may consume the built-in action set, and the existing `ui: createDefaultUi()` option remains a compatibility adapter.

Every action requires a non-empty default accessible label and may reference only a zero-argument boolean command/query. An extension that needs parameters must expose a configured zero-argument wrapper before advertising it as an action. Syntax and commands must work when every UI contribution is ignored. Custom framework render functions, icons, translations, toolbar layout, theming, RTL, and high-contrast behavior are deferred to the UI contract in `EE-020`. Custom document rendering belongs in a NodeView, not a UI action.

## Lifecycle and cleanup

Composition and schema/codec validation complete before Markora claims the host element or mutates its DOM.

Creation phases are:

1. `resolve`
2. `schema`
3. `tokenizer`
4. `codec`
5. `initial-parse`
6. `storage`
7. `assemble`
8. `view`
9. `setup`

`createStorage()`, `createRuntime()`, and all nested assembly factories are synchronous. `createRuntime()` runs exactly once per editor after storage and the final schema/codec exist; reset never reruns it. The kernel snapshots its returned command/state maps and contribution arrays before exposing handles. Their contexts expose a phase-owned lifecycle scope with an `AbortSignal` and `addCleanup(() => void)`. A factory that allocates a resource must register its cleanup immediately; factories that cannot do so must remain pure. Registered functions are idempotently invoked in reverse registration order, even when the factory later throws.

`setup()` runs only after `EditorView` and the public `MarkdownEditor` exist. Its context has a separate setup scope, and a returned cleanup function is automatically registered in that scope. Cleanup is synchronous in v1; aborting a signal must synchronously invalidate any outstanding asynchronous work.

If any phase fails, Markora cleans every initialized resource in reverse resolved order, continues after cleanup errors, releases host ownership, and throws the primary error or an aggregate. Normal destruction runs each extension cleanup exactly once in reverse order and retains the lifecycle guarantees established in `EE-007`.

The concrete teardown sequence is: transition to destroying and abort lifecycle signals; run setup-scope cleanup in reverse extension/registration order while the view is still available; destroy `EditorView` so plugin views and NodeViews release themselves; run assembly/storage-scope cleanup in reverse order; then clear editor event subscribers and release the host. Creation rollback follows the applicable suffix of the same sequence. An extension cleanup may inspect the view but cannot dispatch after the destroying transition.

Reset reconstructs `EditorState` and plugin state only. It does not rerun storage, assembly, setup, or teardown. Dynamic option updates cannot change the extension set.

## Error model

```ts
type MarkdownEditorExtensionErrorPhase =
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

class MarkdownEditorExtensionError extends Error {
  readonly code: string;
  readonly phase: MarkdownEditorExtensionErrorPhase;
  readonly extension?: string;
  readonly participants?: readonly string[];
  readonly contribution?: string;
  readonly cause: unknown;
}
```

Stable code families are `EXTENSION_INVALID_DEFINITION`, `EXTENSION_INCOMPATIBLE`, `EXTENSION_MISSING_DEPENDENCY`, `EXTENSION_CONFLICT`, `EXTENSION_ORDER_CYCLE`, `EXTENSION_CONTRIBUTION_CONFLICT`, `EXTENSION_NOT_INSTALLED`, `EXTENSION_RUNTIME_NOT_READY`, `EXTENSION_FACTORY_FAILED`, `EXTENSION_RUNTIME_FAILED`, and `EXTENSION_CLEANUP_FAILED`. More specific additive codes may be introduced within those families. `extension` identifies a single owner when attribution is possible; graph/system errors instead use `participants` or leave both fields absent.

Resolution, schema, tokenizer, codec, initial-parse, storage, assembly, view, and setup failures are fatal to creation. Initial and later parse failures identify the responsible tokenizer/parser contribution when possible and otherwise remain system errors. Host-invoked command, state, parse, serialize, and NodeView callback failures notify typed error subscribers when present and are then rethrown after state consistency is restored; because the throw is already a reporting channel, the global fallback is suppressed. Browser-driven input/clipboard failures report an extension error, use the global fallback only when no subscriber handled it, and abort that pipeline. NodeView teardown failures are retained for the editor's cleanup aggregate so later views and extension scopes still clean up. Raw ProseMirror plugin exceptions retain ProseMirror's native propagation semantics when the kernel cannot safely isolate them.

The typed `error` subscription gains extension failure codes and context. Non-throwing browser pipelines use the existing global reporting fallback only when no listener exists; synchronously thrown creation/host-call errors do not also use that fallback. Teardown errors aggregate without preventing later cleanup.

## Presets and compatibility adapters

- Omitting `extensionPreset` uses the default compatibility preset and preserves current Markdown, commands, events, UI, and browser behavior.
- The definitions inside the default preset advertise root-only compatibility adapters. They are accepted only when the exact default preset drives the root compatibility runtime; copying them into an anonymous preset or passing them to `markora/minimal` fails with `EXTENSION_INCOMPATIBLE` rather than emitting a false persistence manifest.
- The minimal preset contains the stable document foundation, basic paragraphs/text, lifecycle policy, and base editing behavior, but omits tables, tasks, CodeMirror, optional UI, and optional syntax.
- Tables, tasks, strike, CodeMirror fences, opaque source, and default UI become named built-in definitions where practical.
- Current schema-spec adjustments that cannot use the additive public contract remain in the foundation or a documented internal compatibility adapter.
- Existing `codeBlockLanguages` configures the CodeMirror definition and keeps its lazy, cached, recoverable behavior.
- Existing `ui` configures the built-in UI adapter.
- Existing top-level commands/state, toolbar snapshot, Markdown update APIs, events, origins, and `editor.view` remain supported.

Extensions cannot be reconfigured through `updateOptions()`. A host must destroy and recreate the editor when changing its schema/extension set, and must decide how to preserve selection and pending output across that remount.

## Configuration and persistence manifest

An extension package configures behavior by returning a new immutable definition from its own factory, for example `createCalloutExtension(options)`. JSON dialect options and trusted runtime-only host callbacks/loaders use this same factory route; changing either requires recreating the editor. Markora does not maintain a separate mutable options or services bag. Two definitions with the same name cannot be installed together, even if their configuration differs.

If configuration changes the schema, accepted Markdown, or canonical output, the definition's JSON-only `configuration` field must contain every persistence-relevant option. UI callbacks, loaders, secrets, and other runtime-only values must not be placed there. Changing the meaning or shape of that field follows the extension package's SemVer rules.

Every editor exposes a frozen manifest with this logical shape:

```ts
type MarkdownEditorExtensionManifest = Readonly<{
  extensionApi: typeof MARKORA_EXTENSION_API_VERSION;
  preset?: Readonly<{ name: string; version: string }>;
  extensions: readonly Readonly<{
    name: string;
    version: string;
    configuration?: MarkdownEditorJsonValue;
  }>[];
}>;
```

Entries appear in resolved order. A named preset has a stable name and SemVer; an advanced anonymous host preset omits the preset field. Hosts that persist non-default syntax must store this manifest with the Markdown and compare it before editing or migration. The manifest contains no ProseMirror JSON, plugin state, storage, or executable configuration.

## Packaging and tree-shaking

- `markora` remains the compatibility entry. Its synchronous `createEditor()` imports and selects the default preset, so existing applications retain today's behavior.
- `markora/minimal` is a separate public entry exposing a same-shaped `createEditor()` that defaults to the minimal preset. It must share the kernel modules but must not import the root compatibility entry, default preset, CodeMirror renderer, UI, or optional syntax.
- `markora/extension-api` exposes branded definitions, supported contribution contracts, and the exact ProseMirror/Markdown-it constructors/types needed by extension authors. It must not import either preset.
- Optional extensions and renderers ship as independent side-effect-free ESM packages or explicit package subpaths. The minimal kernel never imports them; the compatibility wrapper may import documented built-ins required by the default preset.
- There is no global registry, package-name lookup, or side-effect registration.
- CSS is a separate explicit import and the only permitted declared side effect.
- Expensive renderers load through dynamic import from their optional package and remain governed by host security policy.
- Extension packages peer-depend on compatible `markora`.
- If an extension imports ProseMirror packages directly instead of `markora/extension-api`, it must use compatible peer dependencies so constructors and plugin keys are not duplicated in the runtime graph.

Passing `createMinimalMarkdownEditorPreset()` to the root entry produces minimal runtime behavior but does not promise that a bundler can remove the statically referenced default graph. The bundle-size guarantee belongs to `markora/minimal`. Packed-consumer tests must prove that the minimal entry has no static path to default-only dependencies, and both entry points are measured independently under the budgets introduced in `EE-013`.

## SemVer and migration policy

The extension API version is independent from the `markora` package version.

- Extension API patch: clarifications and corrections without observable contract changes.
- Extension API minor: additive optional fields, contexts, or contribution kinds.
- Extension API major: changed ordering, collision, lifecycle, callback, persistence, or failure semantics.
- Markora may support more than one extension API major temporarily, but never coerces an unsupported definition silently.

For an extension package:

- patch releases retain schema names, attrs, content expressions, accepted syntax, and canonical output;
- minor releases add behavior that does not capture previously valid prose/opaque input or invalidate stored Markdown;
- changing token precedence, capturing new existing input, node/mark identity, attrs, content expressions, canonical spelling, command signatures, public state, or storage shape requires an extension major.

Markdown plus the host's extension manifest is the stable persistence/interchange boundary in v1. ProseMirror JSON, plugin state, and extension storage are not portable across extension sets. Hosts migrate stored Markdown before it enters Markora. Automatic migration registries are deferred.

## Security and accessibility rules

- Extensions execute trusted application code with the same authority as the embedding host; the API is not a sandbox.
- Public contexts expose a frozen codec facade with the final schema and parse/serialize operations, not mutable tokenizer, parser, serializer, policy, or managed-block assembly internals.
- Kernel read-only, configured file handling, final imported built-in link/image URL sanitization, and lifecycle checks cannot be reordered behind extension clipboard hooks.
- NodeViews must create inert DOM by default and must not execute serialized HTML or scripts.
- Executable or remote renderers require explicit host policy and belong in optional packages.
- UI actions require accessible labels and keyboard-invokable commands.
- NodeViews, keymaps, nested editors, and clipboard behavior require real-browser and accessibility coverage proportional to their surface.
- An extension must document cleanup of observers, timers, global listeners, portals, and async resources.

`CreateEditorOptions.resources` governs core-owned link marks, image nodes, modifier-click opening, image loading, and asset-upload results. It does not sandbox trusted extension code. An extension NodeView can create arbitrary DOM or initiate network requests with the embedding application's authority, and a custom media node is not implicitly routed through the built-in image loader. Hosts must audit such extensions, pass only trusted service callbacks, and require the extension to document URL validation, credentials/referrer behavior, cancellation, cleanup, and accessible loading/failure UI. The frozen public codec facade deliberately exposes no mutable resource policy object.

Core-owned async image results follow their own lifecycle: stale loads receive an aborted signal, Blob display URLs are revoked, and host cleanup runs once. Core asset events remain headless; the embedding host, not an extension UI contribution, owns labelled progress, retry/cancel controls, failure announcements, and privacy/consent UI.

## Approved v1 surface

- Static creation-time definitions and presets.
- Identity, SemVer compatibility, dependencies, explicit conflicts, and deterministic ordering.
- Branded heterogeneous carriers, exact typed handles, and one inferred per-editor runtime factory.
- Additive schema nodes/marks and managed-block declarations.
- Markdown-it tokenizer rules, parser token handlers, and node/mark serializers.
- Typed extension-local commands, state queries, and per-editor storage.
- ProseMirror plugins, keymaps, input rules, and NodeViews.
- Synchronous outer/nested paste and drop transforms/handlers.
- Headless UI action metadata.
- Setup, reverse cleanup, structured errors, and creation rollback.
- Persistence manifests, a separate minimal entry, independent optional packages, and explicit CSS/dynamic renderer imports.

## Deferred surface

- Dynamic install/uninstall or schema reconfiguration.
- Public schema replacement, mutation, removal, or whole-codec replacement.
- Async codecs and extension-defined file/asset contribution workflows. The separate host `resources` workflow is supported.
- Collaboration, presence, comments, and persistence of runtime state.
- Automatic state or Markdown migrations.
- Untrusted-code sandboxing and auto-discovery.
- Framework render slots and the complete theme/localization/UI contract.

## Prototype evidence (historical)

The former private `@markora-internal/extension-rfc-prototype` workspace package exercised the contract without importing Markora or any core-private module:

- A multiline `:::warning Title` container contributes a block node, tokenizer rule, parser token, serializer, and wrapping command.
- `==highlight==` contributes an inline mark, tokenizer rule, parser token, serializer, toggle command, keymap, and input rule.
- Stable foundation anchors, compiler-generated token names, and a collected tokenizer graph keep the specific callout rule before an optional generic opaque colon-fence fallback in either host registration order.
- The per-editor `createRuntime()` boundary proves a host-shaped command through the late-bound state/command bridge, isolated inferred mutable storage, storage-free definitions, namespaced command/state handles, fixed input-rule/plugin/keymap lanes, and first-false/second-true key chains.
- Runtime tests cover combined nested syntax, canonical serialization, semantic round-trip, deterministic ordering, and fatal ownership conflicts.
- A declaration-only fixture proves fully inferred command/state/storage types, heterogeneous branded arrays, exact-definition lookup, the no-storage overload, and structural-impostor rejection without casts.

The prototype intentionally could not install these definitions into the pre-EE-010 `createEditor()`. EE-010 replaced it with public-package examples, packed-consumer compilation/runtime checks, and real-browser tests, then deleted the obsolete private package.

## EE-010 implementation checklist

1. Move public editor/event/extension contracts into a neutral API layer and add isolated `markora/extension-api` and `markora/minimal` entries.
2. Implement metadata validation, SemVer ranges, dependency/conflict graphs, stable topological sorting, and diagnostics.
3. Build an immutable per-editor `EditorAssembly` with schema, virtual tokenizer anchors, parser, serializer, persistence manifest, and contribution registries.
4. Refactor parsing, serialization, initial state, reconciliation, and reset to use the assembly.
5. Move schema-bound global helpers behind assembly/runtime contexts.
6. Compile policy lanes, clipboard pipelines, input rules, plugins, history, keymaps, NodeViews, managed-block roles, and UI actions deterministically.
7. Add the inferred `createRuntime()` boundary, branded type-erased carrier, exact typed handles, lifecycle-safe command dispatch, state queries, and per-editor storage.
8. Add setup rollback, reverse cleanup, async invalidation, and `MarkdownEditorExtensionError` reporting.
9. Build the default and minimal presets; migrate tables, tasks, strike, CodeMirror, opaque source, and default UI where practical; prove the minimal entry has no static default-feature path.
10. Replace the private prototype with public-package examples and consumer tests.
11. Preserve every existing default-preset test and add conflict, ordering, cleanup, minimal-bundle, and external block/inline tests.

## Acceptance mapping

| `EE-009` criterion | Approved decision/evidence |
| --- | --- |
| Composition, ordering, dependency, naming, conflict rules | Versioned definitions, dependency/order graph, stable topological sort, and fatal collision matrix |
| Schema nodes/marks and Markdown tokens/handlers | Additive schema entries, ordered tokenizer rules, `ParseSpec`, and strict node/mark serializers |
| Commands, keymaps, input rules, NodeViews, paste/drop, UI | Namespaced typed handles, structured ordered runtime contributions, clipboard pipelines, and headless actions |
| Storage/state and cleanup lifecycle | Per-editor storage, plugin state boundary, post-view setup, reverse idempotent cleanup, and reset semantics |
| Package/version compatibility and failure reporting | Independent extension API SemVer, peer/runtime ranges, `markora/extension-api`, and phase-attributed errors |
| One block and one inline syntax outside core | Private executable callout and highlight prototype using only public upstream packages |
