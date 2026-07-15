export {};

declare const markdownEditorExtensionBrand: unique symbol;
declare const markdownEditorExtensionTypes: unique symbol;

type ExtensionCompatibility = Readonly<{
  extensionApi: string;
  markora: string;
}>;

type AnyMarkdownEditorExtension = Readonly<{
  name: string;
  version: string;
  compatibility: ExtensionCompatibility;
  [markdownEditorExtensionBrand]: true;
}>;

type MarkdownEditorExtension<
  Commands extends object = Record<never, never>,
  State extends object = Record<never, never>,
  Storage = undefined,
> = AnyMarkdownEditorExtension & Readonly<{
  [markdownEditorExtensionTypes]: {
    commands: Commands;
    state: State;
    storage: Storage;
  };
}>;

type MarkdownEditorExtensionCommandMap = Readonly<Record<
  string,
  (...args: never[]) => boolean
>>;

type MarkdownEditorExtensionStateMap = Readonly<Record<
  string,
  (...args: never[]) => unknown
>>;

type MarkdownEditorExtensionRuntime = Readonly<{
  commands: MarkdownEditorExtensionCommandMap;
  state: MarkdownEditorExtensionStateMap;
}>;

type MarkdownEditorExtensionDefinition<
  CreateStorage extends () => unknown,
  Runtime extends MarkdownEditorExtensionRuntime,
> = Readonly<{
  name: string;
  version: string;
  compatibility: ExtensionCompatibility;
  createStorage: CreateStorage;
  createRuntime(
    context: Readonly<{ storage: ReturnType<CreateStorage> }>,
  ): Runtime;
}>;

type MarkdownEditorExtensionWithoutStorageDefinition<
  Runtime extends MarkdownEditorExtensionRuntime,
> = Readonly<{
  name: string;
  version: string;
  compatibility: ExtensionCompatibility;
  createStorage?: undefined;
  createRuntime(
    context: Readonly<{ storage: undefined }>,
  ): Runtime;
}>;

declare function defineMarkdownEditorExtension<
  const Runtime extends MarkdownEditorExtensionRuntime = {
    commands: Record<never, never>;
    state: Record<never, never>;
  },
>(
  definition: MarkdownEditorExtensionWithoutStorageDefinition<Runtime>,
): MarkdownEditorExtension<Runtime["commands"], Runtime["state"], undefined>;

declare function defineMarkdownEditorExtension<
  const CreateStorage extends () => unknown = () => undefined,
  const Runtime extends MarkdownEditorExtensionRuntime = {
    commands: Record<never, never>;
    state: Record<never, never>;
  },
>(
  definition: MarkdownEditorExtensionDefinition<
    CreateStorage,
    Runtime
  >,
): MarkdownEditorExtension<
  Runtime["commands"],
  Runtime["state"],
  ReturnType<CreateStorage>
>;

type MarkdownEditorExtensionHandle<
  Commands extends object,
  State extends object,
  Storage,
> = Readonly<{
  commands: Readonly<Commands>;
  state: Readonly<State>;
  storage: Readonly<Storage>;
}>;

type UntypedMarkdownEditorExtensionHandle = MarkdownEditorExtensionHandle<
  Record<string, (...args: never[]) => unknown>,
  Record<string, (...args: never[]) => unknown>,
  unknown
>;

interface MarkdownEditorExtensionRegistry {
  get<Commands extends object, State extends object, Storage>(
    definition: MarkdownEditorExtension<Commands, State, Storage>,
  ): MarkdownEditorExtensionHandle<Commands, State, Storage>;
  get(name: string): UntypedMarkdownEditorExtensionHandle;
}

interface CalloutCommands {
  insert(options: Readonly<{ kind: "note" | "warning" }>): boolean;
}

interface CalloutState {
  isActive(): boolean;
}

interface CalloutStorage {
  insertions: number;
}

const calloutExtension = defineMarkdownEditorExtension({
  name: "@example/callout",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createStorage: () => ({ insertions: 0 }),
  createRuntime: ({ storage }) => ({
    commands: {
      insert: (options: Readonly<{ kind: "note" | "warning" }>) => {
        storage.insertions += options.kind === "warning" ? 1 : 0;
        return true;
      },
    },
    state: {
      isActive: () => storage.insertions > 0,
    },
  }),
});

const typedCalloutExtension: MarkdownEditorExtension<
  CalloutCommands,
  CalloutState,
  CalloutStorage
> = calloutExtension;

interface CounterCommands {
  increment(step?: number): boolean;
}

interface CounterState {
  value(): number;
}

interface CounterStorage {
  label: string;
  value: number;
}

const counterExtension = defineMarkdownEditorExtension({
  name: "@example/counter",
  version: "2.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createStorage: () => ({ label: "counter", value: 0 }),
  createRuntime: ({ storage }) => ({
    commands: {
      increment: (step = 1) => {
        storage.value += step;
        return true;
      },
    },
    state: {
      value: () => storage.value,
    },
  }),
});

const typedCounterExtension: MarkdownEditorExtension<
  CounterCommands,
  CounterState,
  CounterStorage
> = counterExtension;

const inferredExtension = defineMarkdownEditorExtension({
  name: "@example/inferred",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createStorage: () => ({ total: 0 }),
  createRuntime: ({ storage }) => ({
    commands: {
      add: (amount: number) => {
        storage.total += amount;
        return true;
      },
    },
    state: {
      total: () => storage.total,
    },
  }),
});

const statelessExtension = defineMarkdownEditorExtension({
  name: "@example/stateless",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createRuntime: ({ storage }) => {
    const noStorage: undefined = storage;

    return {
      commands: { ping: () => true },
      state: { ready: () => noStorage === undefined },
    };
  },
});

const heterogeneousDefinitions: readonly AnyMarkdownEditorExtension[] = [
  calloutExtension,
  counterExtension,
  inferredExtension,
  statelessExtension,
];

declare const registry: MarkdownEditorExtensionRegistry;

const callout = registry.get(calloutExtension);
const counter = registry.get(counterExtension);
const inferred = registry.get(inferredExtension);
const stateless = registry.get(statelessExtension);

const insertResult: boolean = callout.commands.insert({ kind: "warning" });
const activeResult: boolean = callout.state.isActive();
const insertionCount: number = callout.storage.insertions;
const incrementResult: boolean = counter.commands.increment(2);
const counterValue: number = counter.state.value();
const counterLabel: string = counter.storage.label;
const inferredResult: boolean = inferred.commands.add(3);
const inferredTotal: number = inferred.state.total();
const statelessStorage: undefined = stateless.storage;
const pingResult: boolean = stateless.commands.ping();

// @ts-expect-error The inferred command parameter union rejects unknown kinds.
callout.commands.insert({ kind: "tip" });

// @ts-expect-error The exact callout handle cannot expose counter commands.
callout.commands.increment();

// @ts-expect-error The exact counter handle cannot expose callout state.
counter.state.isActive();

const structuralImpostor = {
  name: "@example/impostor",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
};

// @ts-expect-error Plain structural metadata lacks the hidden definition brand.
const rejectedCarrier: AnyMarkdownEditorExtension = structuralImpostor;

void heterogeneousDefinitions;
void typedCalloutExtension;
void typedCounterExtension;
void insertResult;
void activeResult;
void insertionCount;
void incrementResult;
void counterValue;
void counterLabel;
void inferredResult;
void inferredTotal;
void statelessStorage;
void pingResult;
void rejectedCarrier;
