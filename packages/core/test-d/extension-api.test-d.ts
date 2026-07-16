import {
  defineMarkdownEditorExtension,
  defineMarkdownEditorPreset,
  type AnyMarkdownEditorExtension,
  type MarkdownEditorExtension,
  type MarkdownEditorExtensionRegistry,
  type MarkdownEditorExtensionPreset,
} from "../src/extension-api";
// @ts-expect-error Compiler-only definition records are not part of the author API.
import type { InternalMarkdownEditorExtensionDefinition } from "../src/extension-api";

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
  createStorage: ({ ownerDocument }) => {
    const document: Document = ownerDocument;
    void document;
    return { insertions: 0 };
  },
  createRuntime: ({ ownerDocument, storage }) => ({
    commands: {
      insert: (options: Readonly<{ kind: "note" | "warning" }>) => {
        storage.insertions += options.kind === "warning" ? 1 : 0;
        return true;
      },
    },
    state: {
      isActive: () => ownerDocument.nodeType === Node.DOCUMENT_NODE && storage.insertions > 0,
    },
  }),
});

// The configured zero-argument wrapper used by UI metadata is independently
// inferred, while parameterized commands remain available to hosts.
const configuredCalloutExtension = defineMarkdownEditorExtension({
  name: "@example/configured-callout",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createRuntime: () => ({
    commands: {
      insertConfigured: () => true,
      insert: (_kind: "note" | "warning") => true,
    },
    state: { enabled: () => true },
    ui: [{
      id: "insert",
      group: "blocks",
      defaultLabel: "Insert callout",
      command: "insertConfigured",
      enabled: "enabled",
    }],
  }),
});

const typedCallout: MarkdownEditorExtension<
  CalloutCommands,
  CalloutState,
  CalloutStorage
> = calloutExtension;

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

const staticOnlyExtension = defineMarkdownEditorExtension({
  name: "@example/static-only",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  schema: {
    marks: [{ name: "example_highlight", spec: {} }],
  },
});

const heterogeneous: readonly AnyMarkdownEditorExtension[] = [
  calloutExtension,
  configuredCalloutExtension,
  counterExtension,
  statelessExtension,
  staticOnlyExtension,
];

const preset = defineMarkdownEditorPreset({
  name: "example-preset",
  version: "1.0.0",
  extensions: heterogeneous,
});
const typedPreset: MarkdownEditorExtensionPreset = preset;

declare const registry: MarkdownEditorExtensionRegistry;
const callout = registry.get(calloutExtension);
const configuredCallout = registry.get(configuredCalloutExtension);
const counter = registry.get(counterExtension);
const stateless = registry.get(statelessExtension);
const staticOnly = registry.get(staticOnlyExtension);

const insertResult: boolean = callout.commands.insert({ kind: "warning" });
const activeResult: boolean = callout.state.isActive();
const insertionCount: number = callout.storage.insertions;
const configuredResult: boolean = configuredCallout.commands.insertConfigured();
const incrementResult: boolean = counter.commands.increment(2);
const counterValue: number = counter.state.value();
const counterLabel: string = counter.storage.label;
const statelessStorage: undefined = stateless.storage;
const staticStorage: undefined = staticOnly.storage;

registry.has(calloutExtension);
registry.has("@example/callout");

// @ts-expect-error The inferred command parameter rejects unknown callout kinds.
callout.commands.insert({ kind: "tip" });

// @ts-expect-error An exact callout handle cannot expose counter commands.
callout.commands.increment();

// @ts-expect-error An exact counter handle cannot expose callout state.
counter.state.isActive();

// @ts-expect-error Host storage is read-only at the handle boundary.
counter.storage.value = 2;

const structuralImpostor = {
  name: "@example/impostor",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
};

// @ts-expect-error Plain structural metadata lacks the hidden definition brand.
const rejectedCarrier: AnyMarkdownEditorExtension = structuralImpostor;

// @ts-expect-error Plain preset data lacks the hidden preset brand.
const rejectedPreset: MarkdownEditorExtensionPreset = {
  extensions: heterogeneous,
};

// @ts-expect-error Extension commands must return boolean.
defineMarkdownEditorExtension({
  name: "@example/bad-command",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createRuntime: () => ({ commands: { invalid: () => 1 } }),
});

// @ts-expect-error Extension state entries must be functions.
defineMarkdownEditorExtension({
  name: "@example/bad-state",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createRuntime: () => ({ state: { invalid: true } }),
});

// @ts-expect-error Storage-bearing definitions require a runtime factory.
defineMarkdownEditorExtension({
  name: "@example/storage-without-runtime",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createStorage: () => ({ value: 0 }),
});

// @ts-expect-error UI actions may reference only zero-argument boolean commands.
defineMarkdownEditorExtension({
  name: "@example/parameterized-ui-action",
  version: "1.0.0",
  compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
  createRuntime: () => ({
    commands: { insert: (_kind: "note" | "warning") => true },
    ui: [{
      id: "insert",
      group: "blocks",
      defaultLabel: "Insert",
      command: "insert",
    }],
  }),
});

void typedCallout;
void typedPreset;
void insertResult;
void activeResult;
void insertionCount;
void configuredResult;
void incrementResult;
void counterValue;
void counterLabel;
void statelessStorage;
void staticStorage;
void rejectedCarrier;
void rejectedPreset;
void (null as unknown as InternalMarkdownEditorExtensionDefinition);
