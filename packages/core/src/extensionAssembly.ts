import { InputRule, inputRules } from "prosemirror-inputrules";
import { Slice } from "prosemirror-model";
import { Plugin, Transaction, type Command, type EditorState } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import {
  MarkdownEditorExtensionError,
  isValidMarkdownEditorLocalId,
  readMarkdownEditorExtensionDefinition,
  type AnyMarkdownEditorExtension,
  type MarkdownEditorClipboardHandlerContribution,
  type MarkdownEditorClipboardTransformContribution,
  type MarkdownEditorExtensionAssemblyContext,
  type MarkdownEditorExtensionHandle,
  type MarkdownEditorExtensionRegistry,
  type MarkdownEditorExtensionRuntime,
  type MarkdownEditorInputRuleContribution,
  type MarkdownEditorKeymapContribution,
  type MarkdownEditorNodeViewContribution,
  type MarkdownEditorOrderedContribution,
  type MarkdownEditorPluginContributionFactory,
  type MarkdownEditorUiActionContribution,
  type MarkdownEditorUiAction,
  type UntypedMarkdownEditorExtensionHandle,
} from "./extensionApi";
import {
  orderMarkdownEditorContributions,
  type MarkdownEditorOwnedOrderedContribution,
} from "./extensionContributionOrder";
import { createMarkdownEditorLifecycleScope } from "./extensionLifecycle";
import type {
  MarkdownEditorExtensionResolution,
  ResolvedMarkdownEditorExtension,
} from "./extensionResolver";
import type { MarkdownEditorCodec } from "./markdownCodec";
import { setMarkdownEditorTransactionOrigin } from "./transactionOrigin";
import type { MarkdownEditor } from "./editorApi";
import {
  createCompositionSafeMarkdownEditorKeymap,
  resolveMarkdownEditorShortcutKeys,
  type NormalizedMarkdownEditorShortcutMap,
} from "./shortcutConfig";
import { MARKDOWN_EDITOR_APPLIED_INPUT_RULE_META } from "./typingErgonomics";

type RuntimeInstance = {
  resolved: ResolvedMarkdownEditorExtension;
  storage: unknown;
  runtime: MarkdownEditorExtensionRuntime<unknown>;
  context: MarkdownEditorExtensionAssemblyContext<unknown>;
  assemblyScope: ReturnType<typeof createMarkdownEditorLifecycleScope>;
  setupScope?: ReturnType<typeof createMarkdownEditorLifecycleScope>;
  handle: UntypedMarkdownEditorExtensionHandle;
};

export type MarkdownEditorCompiledUiAction = MarkdownEditorUiAction;

/** @internal Nested editors consume plain text, not ProseMirror slices. */
export type MarkdownEditorNestedClipboardPipeline = Readonly<{
  transformText: ((value: string) => string) | null;
  transformHtml: ((value: string) => string) | null;
  handlePaste(event: ClipboardEvent, view: EditorView): boolean;
  handleDrop(event: DragEvent, view: EditorView): boolean;
}>;

export type MarkdownEditorRuntimeContributions = Readonly<{
  inputRules: Plugin | null;
  plugins: readonly Plugin[];
  keymap: Plugin | null;
  nodeViews: Readonly<Record<string, NodeViewConstructor>>;
  clipboard: Plugin | null;
  nestedClipboard: MarkdownEditorNestedClipboardPipeline | null;
  takeClipboardFailure: () => MarkdownEditorExtensionError | null;
  uiActions: readonly MarkdownEditorCompiledUiAction[];
}>;

export type MarkdownEditorExtensionAssembly = Readonly<{
  registry: MarkdownEditorExtensionRegistry;
  contributions: MarkdownEditorRuntimeContributions;
  attachView(options: {
    view: EditorView;
    editor: MarkdownEditor;
  }): void;
  beginDestroy(): void;
  cleanupSetup(): readonly unknown[];
  cleanupAssembly(): readonly unknown[];
}>;

type CreateMarkdownEditorExtensionAssemblyOptions = Readonly<{
  resolution: MarkdownEditorExtensionResolution;
  codec: MarkdownEditorCodec;
  ownerDocument: Document;
  shortcuts: NormalizedMarkdownEditorShortcutMap;
  reservedNodeViews?: readonly string[];
  reportError(
    error: MarkdownEditorExtensionError,
    useGlobalFallback?: boolean,
  ): void;
}>;

function assemblyError(options: {
  code: string;
  phase: ConstructorParameters<typeof MarkdownEditorExtensionError>[0]["phase"];
  message: string;
  extension?: string;
  contribution?: string;
  participants?: readonly string[];
  cause?: unknown;
}) {
  return new MarkdownEditorExtensionError(options);
}

function normalizeExtensionFailure(
  cause: unknown,
  options: {
    code: string;
    phase: ConstructorParameters<typeof MarkdownEditorExtensionError>[0]["phase"];
    message: string;
    extension?: string;
    contribution?: string;
  },
) {
  return cause instanceof MarkdownEditorExtensionError
    ? cause
    : assemblyError({ ...options, cause });
}

function aggregateFailure(primary: unknown, cleanupErrors: readonly unknown[]) {
  if (cleanupErrors.length === 0) {
    return primary;
  }

  const error = new Error(
    "Extension creation failed and one or more extension cleanups also failed.",
  ) as Error & { cause: unknown; errors: readonly unknown[] };
  error.name = "AggregateError";
  error.cause = primary;
  error.errors = Object.freeze([primary, ...cleanupErrors]);
  return error;
}

function cleanupLifecycleScope(
  scope: ReturnType<typeof createMarkdownEditorLifecycleScope>,
  owner: string,
  contribution: "assembly" | "setup",
) {
  return scope.cleanup().map((cause) => (
    cause instanceof MarkdownEditorExtensionError
      ? cause
      : assemblyError({
          code: "EXTENSION_CLEANUP_FAILED",
          phase: "destroy",
          message: `Extension ${contribution} cleanup for "${owner}" failed.`,
          extension: owner,
          contribution,
          cause,
        })
  ));
}

function snapshotOrderedContribution<T extends { before?: readonly unknown[]; after?: readonly unknown[] }>(
  contribution: T,
): T {
  return Object.freeze({
    ...contribution,
    ...(contribution.before ? { before: Object.freeze([...contribution.before]) } : {}),
    ...(contribution.after ? { after: Object.freeze([...contribution.after]) } : {}),
  }) as T;
}

function isRuntimeRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotRuntime(runtime: MarkdownEditorExtensionRuntime<unknown>) {
  if (!isRuntimeRecord(runtime)) {
    throw new TypeError("An extension runtime factory must return a plain record.");
  }

  for (const [field, value] of [
    ["commands", runtime.commands],
    ["state", runtime.state],
  ] as const) {
    if (value !== undefined && !isRuntimeRecord(value)) {
      throw new TypeError(`Extension runtime ${field} must be a plain record.`);
    }
  }

  for (const [field, value] of [
    ["plugins", runtime.plugins],
    ["keymaps", runtime.keymaps],
    ["inputRules", runtime.inputRules],
    ["nodeViews", runtime.nodeViews],
    ["ui", runtime.ui],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(`Extension runtime ${field} must be an array.`);
    }
  }

  if (runtime.clipboard !== undefined && !isRuntimeRecord(runtime.clipboard)) {
    throw new TypeError("Extension runtime clipboard must be a plain record.");
  }

  const snapshot = {
    ...runtime,
    commands: Object.freeze({ ...(runtime.commands ?? {}) }),
    state: Object.freeze({ ...(runtime.state ?? {}) }),
    plugins: Object.freeze((runtime.plugins ?? []).map(snapshotOrderedContribution)),
    keymaps: Object.freeze((runtime.keymaps ?? []).map(snapshotOrderedContribution)),
    inputRules: Object.freeze((runtime.inputRules ?? []).map(snapshotOrderedContribution)),
    nodeViews: Object.freeze((runtime.nodeViews ?? []).map(snapshotOrderedContribution)),
    clipboard: runtime.clipboard
      ? Object.freeze({
          transforms: Object.freeze(
            (runtime.clipboard.transforms ?? []).map(snapshotOrderedContribution),
          ),
          handlers: Object.freeze(
            (runtime.clipboard.handlers ?? []).map(snapshotOrderedContribution),
          ),
        })
      : undefined,
    ui: Object.freeze((runtime.ui ?? []).map((action) => Object.freeze({ ...action }))),
  } satisfies MarkdownEditorExtensionRuntime<unknown>;

  return Object.freeze(snapshot);
}

function collectOrdered<T extends MarkdownEditorOrderedContribution>(
  instances: readonly RuntimeInstance[],
  read: (runtime: MarkdownEditorExtensionRuntime<unknown>) => readonly T[] | undefined,
  lane: (contribution: T) => string,
) {
  const collected: MarkdownEditorOwnedOrderedContribution<T, string>[] = [];

  instances.forEach((instance, extensionResolvedIndex) => {
    (read(instance.runtime) ?? []).forEach((contribution, declarationIndex) => {
      collected.push({
        owner: instance.resolved.definition.name,
        extensionResolvedIndex,
        declarationIndex,
        lane: lane(contribution),
        contribution,
      });
    });
  });

  return collected;
}

export function createMarkdownEditorExtensionAssembly(
  options: CreateMarkdownEditorExtensionAssemblyOptions,
): MarkdownEditorExtensionAssembly {
  let view: EditorView | undefined;
  let publicEditor: MarkdownEditor | undefined;
  let destroying = false;
  const publicCodec = Object.freeze({
    schema: options.codec.schema,
    parse: (markdown: string) => options.codec.parse(markdown),
    serialize: (doc: Parameters<typeof options.codec.serialize>[0]) => (
      options.codec.serialize(doc)
    ),
  });
  const instances: RuntimeInstance[] = [];
  const handlesByDefinition = new Map<AnyMarkdownEditorExtension, UntypedMarkdownEditorExtensionHandle>();
  const handlesByName = new Map<string, UntypedMarkdownEditorExtensionHandle>();
  let publishedUiActions: readonly MarkdownEditorUiAction[] = Object.freeze([]);
  const activeStateQueries: Array<{
    owner: string;
    contribution: string;
    violation?: MarkdownEditorExtensionError;
  }> = [];
  const reportedHostCallFailures = new Set<MarkdownEditorExtensionError>();
  const nodeViewCleanupErrors: MarkdownEditorExtensionError[] = [];
  let hostCallDepth = 0;

  const finishHostCall = () => {
    hostCallDepth -= 1;

    if (hostCallDepth === 0) {
      reportedHostCallFailures.clear();
    }
  };

  const reportHostCallFailure = (failure: MarkdownEditorExtensionError) => {
    if (reportedHostCallFailures.has(failure)) {
      return;
    }

    reportedHostCallFailures.add(failure);
    options.reportError(failure, false);
  };

  const assertStateQueryIsReadOnly = () => {
    const activeQuery = activeStateQueries[activeStateQueries.length - 1];

    if (!activeQuery) {
      return;
    }

    activeQuery.violation ??= assemblyError({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "state",
      message: `Extension state query "${activeQuery.owner}/${activeQuery.contribution}" attempted to mutate editor state.`,
      extension: activeQuery.owner,
      contribution: activeQuery.contribution,
    });
    throw activeQuery.violation;
  };

  const notInstalled = (target: string) => assemblyError({
    code: "EXTENSION_NOT_INSTALLED",
    phase: "resolve",
    message: `Extension "${target}" is not installed in this editor.`,
    extension: target,
  });

  const registry: MarkdownEditorExtensionRegistry = Object.freeze({
    get(target: AnyMarkdownEditorExtension | string) {
      if (typeof target === "string") {
        const handle = handlesByName.get(target);

        if (!handle) {
          throw notInstalled(target);
        }

        return handle;
      }

      const handle = handlesByDefinition.get(target);

      if (!handle) {
        let name = "unknown";

        try {
          name = readMarkdownEditorExtensionDefinition(target).name;
        } catch {
          // The authentic-definition error is less useful than lookup failure.
        }

        throw notInstalled(name);
      }

      return handle;
    },
    has(target: AnyMarkdownEditorExtension | string) {
      return typeof target === "string"
        ? handlesByName.has(target)
        : handlesByDefinition.has(target);
    },
    manifest: options.resolution.manifest,
    get uiActions() {
      return publishedUiActions;
    },
  }) as MarkdownEditorExtensionRegistry;

  const requireView = (owner: string, phase: "command" | "state" | "assemble") => {
    if (!view || destroying || view.isDestroyed) {
      throw assemblyError({
        code: "EXTENSION_RUNTIME_NOT_READY",
        phase,
        message: `Extension "${owner}" cannot access editor state before the view is ready or after teardown begins.`,
        extension: owner,
      });
    }

    return view;
  };

  const createDependencyRegistry = (resolved: ResolvedMarkdownEditorExtension) => {
    const allowed = new Set(
      (resolved.definition.dependencies ?? [])
        .filter((dependency) => options.resolution.extensions.some(
          (candidate) => candidate.definition.name === dependency.name,
        ))
        .map((dependency) => dependency.name),
    );

    return Object.freeze({
      get(target: AnyMarkdownEditorExtension | string) {
        const name = typeof target === "string"
          ? target
          : readMarkdownEditorExtensionDefinition(target).name;

        if (!allowed.has(name)) {
          throw assemblyError({
            code: "EXTENSION_MISSING_DEPENDENCY",
            phase: "assemble",
            message: `Extension "${resolved.definition.name}" did not declare "${name}" as a dependency.`,
            extension: resolved.definition.name,
            participants: [resolved.definition.name, name],
          });
        }

        return registry.get(target as AnyMarkdownEditorExtension & string);
      },
      has(target: AnyMarkdownEditorExtension | string) {
        const name = typeof target === "string"
          ? target
          : readMarkdownEditorExtensionDefinition(target).name;
        return allowed.has(name) && registry.has(target);
      },
    });
  };

  let pendingAssemblyScope: Readonly<{
    owner: string;
    scope: ReturnType<typeof createMarkdownEditorLifecycleScope>;
  }> | undefined;

  try {
    for (const resolved of options.resolution.extensions) {
      const owner = resolved.definition.name;
      const assemblyScope = createMarkdownEditorLifecycleScope();
      pendingAssemblyScope = { owner, scope: assemblyScope };
      const dependencies = createDependencyRegistry(resolved);
      const ids = Object.freeze({
        qualify(localId: string) {
          if (!isValidMarkdownEditorLocalId(localId)) {
            throw assemblyError({
              code: "EXTENSION_INVALID_DEFINITION",
              phase: "assemble",
              message: `Extension-local ID "${localId}" is invalid.`,
              extension: owner,
              contribution: localId,
            });
          }

          return `${owner}/${localId}`;
        },
        token(localId: string) {
          const suffix = localId.match(/_(?:open|close)$/)?.[0] ?? "";
          const root = suffix ? localId.slice(0, -suffix.length) : localId;

          if (!isValidMarkdownEditorLocalId(root)) {
            throw assemblyError({
              code: "EXTENSION_INVALID_DEFINITION",
              phase: "assemble",
              message: `Extension-local token ID "${localId}" is invalid.`,
              extension: owner,
              contribution: localId,
            });
          }

          return `${owner}/${root}${suffix}`;
        },
      });
      const baseContext = {
        schema: options.codec.schema,
        codec: publicCodec,
        dependencies,
        lifecycle: assemblyScope.publicScope,
        ids,
        ownerDocument: options.ownerDocument,
        reportError(error: unknown, contribution?: string) {
          if (assemblyScope.publicScope.signal.aborted) {
            return;
          }

          options.reportError(normalizeExtensionFailure(error, {
            code: "EXTENSION_RUNTIME_FAILED",
            phase: "assemble",
            message: `Extension "${owner}" reported a runtime failure.`,
            extension: owner,
            contribution,
          }));
        },
      };
      let storage: unknown;

      try {
        storage = resolved.definition.createStorage?.(Object.freeze(baseContext));
      } catch (cause) {
        const failure = normalizeExtensionFailure(cause, {
          code: "EXTENSION_FACTORY_FAILED",
          phase: "storage",
          message: `Storage factory for extension "${owner}" failed.`,
          extension: owner,
        });
        throw aggregateFailure(failure, cleanupLifecycleScope(
          assemblyScope,
          owner,
          "assembly",
        ));
      }

      const context: MarkdownEditorExtensionAssemblyContext<unknown> = Object.freeze({
        ...baseContext,
        storage,
        getState(): EditorState {
          return requireView(owner, "state").state;
        },
        dispatch(transaction: Transaction) {
          assertStateQueryIsReadOnly();
          const activeView = requireView(owner, "command");

          if (!activeView.editable) {
            return false;
          }

          if (transaction.before !== activeView.state.doc) {
            throw assemblyError({
              code: "EXTENSION_RUNTIME_FAILED",
              phase: "command",
              message: `Extension "${owner}" attempted to dispatch a stale transaction.`,
              extension: owner,
            });
          }

          setMarkdownEditorTransactionOrigin(transaction, `extension:${owner}`);
          activeView.dispatch(transaction);
          return true;
        },
        runCommand(command: Command) {
          assertStateQueryIsReadOnly();
          const activeView = requireView(owner, "command");

          if (!activeView.editable) {
            return false;
          }

          return command(
            activeView.state,
            (transaction) => context.dispatch(transaction),
            activeView,
          );
        },
      });
      let runtime: MarkdownEditorExtensionRuntime<unknown> = {};

      try {
        runtime = snapshotRuntime(resolved.definition.createRuntime?.(context) ?? {});
      } catch (cause) {
        const failure = normalizeExtensionFailure(cause, {
          code: "EXTENSION_FACTORY_FAILED",
          phase: "assemble",
          message: `Runtime factory for extension "${owner}" failed.`,
          extension: owner,
        });
        throw aggregateFailure(failure, cleanupLifecycleScope(
          assemblyScope,
          owner,
          "assembly",
        ));
      }

      const rawCommands = runtime.commands ?? {};
      const commands: Record<string, (...args: never[]) => boolean> = {};

      for (const [name, command] of Object.entries(rawCommands)) {
        if (typeof command !== "function") {
          throw assemblyError({
            code: "EXTENSION_INVALID_DEFINITION",
            phase: "assemble",
            message: `Extension command "${owner}/${name}" must be a function.`,
            extension: owner,
            contribution: name,
          });
        }

        commands[name] = (...args: never[]) => {
          const activeView = requireView(owner, "command");

          if (!activeView.editable) {
            return false;
          }

          hostCallDepth += 1;

          try {
            const result = command(...args);

            if (typeof result !== "boolean") {
              throw new TypeError(`Extension command "${owner}/${name}" must return boolean.`);
            }

            return result;
          } catch (cause) {
            const failure = normalizeExtensionFailure(cause, {
              code: "EXTENSION_RUNTIME_FAILED",
              phase: "command",
              message: `Extension command "${owner}/${name}" failed.`,
              extension: owner,
              contribution: name,
            });
            reportHostCallFailure(failure);
            throw failure;
          } finally {
            finishHostCall();
          }
        };
      }

      const rawState = runtime.state ?? {};
      const state: Record<string, (...args: never[]) => unknown> = {};

      for (const [name, query] of Object.entries(rawState)) {
        if (typeof query !== "function") {
          throw assemblyError({
            code: "EXTENSION_INVALID_DEFINITION",
            phase: "assemble",
            message: `Extension state query "${owner}/${name}" must be a function.`,
            extension: owner,
            contribution: name,
          });
        }

        state[name] = (...args: never[]) => {
          requireView(owner, "state");
          const activeQuery: (typeof activeStateQueries)[number] = {
            owner,
            contribution: name,
          };
          activeStateQueries.push(activeQuery);
          hostCallDepth += 1;

          try {
            const result = query(...args);

            if (activeQuery.violation) {
              throw activeQuery.violation;
            }

            return result;
          } catch (cause) {
            const failure = normalizeExtensionFailure(cause, {
              code: "EXTENSION_RUNTIME_FAILED",
              phase: "state",
              message: `Extension state query "${owner}/${name}" failed.`,
              extension: owner,
              contribution: name,
            });
            reportHostCallFailure(failure);
            throw failure;
          } finally {
            activeStateQueries.pop();
            finishHostCall();
          }
        };
      }

      const handle = Object.freeze({
        commands: Object.freeze(commands),
        state: Object.freeze(state),
        storage,
      });
      const instance: RuntimeInstance = {
        resolved,
        storage,
        runtime,
        context,
        assemblyScope,
        handle,
      };
      instances.push(instance);
      handlesByDefinition.set(resolved.extension, handle);
      handlesByName.set(owner, handle);
      pendingAssemblyScope = undefined;
    }
  } catch (primary) {
    const cleanupErrors = [
      ...(pendingAssemblyScope
        ? cleanupLifecycleScope(
            pendingAssemblyScope.scope,
            pendingAssemblyScope.owner,
            "assembly",
          )
        : []),
      ...instances
      .slice()
      .reverse()
      .flatMap((instance) => cleanupLifecycleScope(
        instance.assemblyScope,
        instance.resolved.definition.name,
        "assembly",
      )),
    ];
    throw aggregateFailure(primary, cleanupErrors);
  }

  const byOwner = new Map(
    instances.map((instance) => [instance.resolved.definition.name, instance]),
  );
  const invokeFactory = <T>(
    owner: string,
    contribution: string,
    phase: "input" | "plugin" | "node-view" | "clipboard",
    factory: (context: MarkdownEditorExtensionAssemblyContext<unknown>) => T,
  ) => {
    try {
      return factory(byOwner.get(owner)!.context);
    } catch (cause) {
      throw normalizeExtensionFailure(cause, {
        code: "EXTENSION_FACTORY_FAILED",
        phase,
        message: `Extension contribution "${contribution}" failed during assembly.`,
        extension: owner,
        contribution,
      });
    }
  };
  const reportBrowserFailure = (
    cause: unknown,
    optionsForFailure: {
      phase: "input" | "clipboard";
      owner: string;
      contribution: string;
      message: string;
    },
    report = true,
  ) => {
    const failure = normalizeExtensionFailure(cause, {
      code: "EXTENSION_RUNTIME_FAILED",
      phase: optionsForFailure.phase,
      message: optionsForFailure.message,
      extension: optionsForFailure.owner,
      contribution: optionsForFailure.contribution,
    });
    if (report) options.reportError(failure);
    return failure;
  };
  const normalizeNodeViewFailure = (
    cause: unknown,
    failureOptions: {
      code: "EXTENSION_CLEANUP_FAILED" | "EXTENSION_INVALID_DEFINITION" | "EXTENSION_RUNTIME_FAILED";
      phase: "destroy" | "node-view";
      message: string;
      owner: string;
      contribution: string;
    },
  ) => (
    cause instanceof MarkdownEditorExtensionError
    && cause.code === failureOptions.code
    && cause.phase === failureOptions.phase
    && cause.extension === failureOptions.owner
    && cause.contribution === failureOptions.contribution
      ? cause
      : assemblyError({
          code: failureOptions.code,
          phase: failureOptions.phase,
          message: failureOptions.message,
          extension: failureOptions.owner,
          contribution: failureOptions.contribution,
          cause,
        })
  );
  const createGuardedNodeViewConstructor = (
    owner: string,
    contribution: string,
    constructor: NodeViewConstructor,
  ): NodeViewConstructor => (
    node,
    activeView,
    getPos,
    decorations,
    innerDecorations,
  ) => {
    const reportAndThrow = (
      cause: unknown,
      code: "EXTENSION_INVALID_DEFINITION" | "EXTENSION_RUNTIME_FAILED",
      message: string,
    ): never => {
      const failure = normalizeNodeViewFailure(cause, {
        code,
        phase: "node-view",
        message,
        owner,
        contribution,
      });
      options.reportError(failure, false);
      throw failure;
    };
    let rawNodeView: unknown;

    try {
      rawNodeView = constructor(
        node,
        activeView,
        getPos,
        decorations,
        innerDecorations,
      );
    } catch (cause) {
      reportAndThrow(
        cause,
        "EXTENSION_RUNTIME_FAILED",
        `NodeView constructor "${contribution}" failed.`,
      );
    }

    if (typeof rawNodeView !== "object" || rawNodeView === null) {
      reportAndThrow(
        new TypeError("A NodeView constructor must return an object."),
        "EXTENSION_INVALID_DEFINITION",
        `NodeView constructor "${contribution}" returned an invalid result.`,
      );
    }

    const rawNodeViewObject = rawNodeView as object;

    const readProperty = (name: keyof NodeView): unknown => {
      try {
        return Reflect.get(rawNodeViewObject, name);
      } catch (cause) {
        return reportAndThrow(
          cause,
          "EXTENSION_RUNTIME_FAILED",
          `NodeView "${contribution}" failed while reading "${name}".`,
        );
      }
    };
    const dom = readProperty("dom");
    const contentDOM = readProperty("contentDOM");
    const multiType = readProperty("multiType");
    const methods = {
      update: readProperty("update"),
      selectNode: readProperty("selectNode"),
      deselectNode: readProperty("deselectNode"),
      setSelection: readProperty("setSelection"),
      stopEvent: readProperty("stopEvent"),
      ignoreMutation: readProperty("ignoreMutation"),
      destroy: readProperty("destroy"),
    } as const;
    const ownerWindow = options.ownerDocument.defaultView ?? reportAndThrow(
      new TypeError("The editor document must have a window."),
      "EXTENSION_RUNTIME_FAILED",
      `NodeView "${contribution}" cannot validate its DOM without a window.`,
    );

    if (!(dom instanceof ownerWindow.Node) || dom.ownerDocument !== options.ownerDocument) {
      reportAndThrow(
        new TypeError("NodeView.dom must be a DOM Node owned by the editor document."),
        "EXTENSION_INVALID_DEFINITION",
        `NodeView "${contribution}" returned an invalid dom node.`,
      );
    }

    if (
      contentDOM !== undefined
      && contentDOM !== null
      && (
        !(contentDOM instanceof ownerWindow.HTMLElement)
        || contentDOM.ownerDocument !== options.ownerDocument
      )
    ) {
      reportAndThrow(
        new TypeError("NodeView.contentDOM must be an HTMLElement owned by the editor document."),
        "EXTENSION_INVALID_DEFINITION",
        `NodeView "${contribution}" returned an invalid contentDOM node.`,
      );
    }

    if (multiType !== undefined && typeof multiType !== "boolean") {
      reportAndThrow(
        new TypeError("NodeView.multiType must be a boolean when provided."),
        "EXTENSION_INVALID_DEFINITION",
        `NodeView "${contribution}" returned invalid multiType metadata.`,
      );
    }

    for (const [name, method] of Object.entries(methods)) {
      if (method !== undefined && typeof method !== "function") {
        reportAndThrow(
          new TypeError(`NodeView.${name} must be a function when provided.`),
          "EXTENSION_INVALID_DEFINITION",
          `NodeView "${contribution}" returned an invalid "${name}" callback.`,
        );
      }
    }

    const invokeMethod = (
      name: keyof typeof methods,
      args: readonly unknown[],
      returnsBoolean = false,
    ) => {
      const method = methods[name] as ((...callbackArgs: never[]) => unknown) | undefined;
      let result: unknown;

      try {
        result = Reflect.apply(method!, rawNodeViewObject, args);
      } catch (cause) {
        return reportAndThrow(
          cause,
          "EXTENSION_RUNTIME_FAILED",
          `NodeView "${contribution}" callback "${name}" failed.`,
        );
      }

      if (returnsBoolean && typeof result !== "boolean") {
        return reportAndThrow(
          new TypeError(`NodeView.${name} must return a boolean.`),
          "EXTENSION_INVALID_DEFINITION",
          `NodeView "${contribution}" callback "${name}" must return a boolean.`,
        );
      }

      return result;
    };
    let destroyed = false;
    const guarded: NodeView = { dom: dom as Node };

    if (contentDOM !== undefined) {
      guarded.contentDOM = contentDOM as HTMLElement | null;
    }

    if (multiType !== undefined) {
      guarded.multiType = multiType as boolean;
    }

    if (methods.update) {
      guarded.update = (...args) => invokeMethod("update", args, true) as boolean;
    }

    if (methods.selectNode) {
      guarded.selectNode = () => { invokeMethod("selectNode", []); };
    }

    if (methods.deselectNode) {
      guarded.deselectNode = () => { invokeMethod("deselectNode", []); };
    }

    if (methods.setSelection) {
      guarded.setSelection = (...args) => { invokeMethod("setSelection", args); };
    }

    if (methods.stopEvent) {
      guarded.stopEvent = (...args) => invokeMethod("stopEvent", args, true) as boolean;
    }

    if (methods.ignoreMutation) {
      guarded.ignoreMutation = (...args) => invokeMethod("ignoreMutation", args, true) as boolean;
    }

    if (methods.destroy) {
      guarded.destroy = () => {
        if (destroyed) {
          return;
        }

        destroyed = true;

        try {
          Reflect.apply(methods.destroy as (...args: never[]) => unknown, rawNodeViewObject, []);
        } catch (cause) {
          const failure = normalizeNodeViewFailure(cause, {
            code: "EXTENSION_CLEANUP_FAILED",
            phase: "destroy",
            message: `NodeView "${contribution}" destroy callback failed.`,
            owner,
            contribution,
          });

          if (destroying) {
            nodeViewCleanupErrors.push(failure);
          } else {
            options.reportError(failure);
          }
        }
      };
    }

    return guarded;
  };

  let contributions: MarkdownEditorRuntimeContributions;

  try {
    const orderedInputRules = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorInputRuleContribution<unknown>>(
        instances,
        (runtime) => runtime.inputRules,
        () => "input-rule",
      ),
      { errorPhase: "input", contributionKind: "Input rule" },
    );
    const inputRuleValues = orderedInputRules.map((item) => {
      const rule = invokeFactory(
        item.owner,
        item.qualifiedId,
        "input",
        item.contribution.create,
      );
      const runtimeRule = rule as InputRule & {
        match: RegExp;
        handler(
          state: EditorState,
          match: RegExpMatchArray,
          start: number,
          end: number,
        ): Transaction | null;
        undoable: boolean;
      };

      if (!(rule instanceof InputRule) || !(runtimeRule.match instanceof RegExp)) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "input",
          message: `Input rule "${item.qualifiedId}" must create an InputRule from markora/extension-api.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      const guardedRule = new InputRule(
        runtimeRule.match,
        (state, match, start, end) => {
          try {
            const transaction = runtimeRule.handler(state, match, start, end);

            if (transaction !== null && !(transaction instanceof Transaction)) {
              throw new TypeError("An extension input rule must return a Transaction or null.");
            }

            if (transaction) {
              transaction.setMeta(MARKDOWN_EDITOR_APPLIED_INPUT_RULE_META, {
                from: end,
                text: match[0].slice(-1),
              });
            }

            return transaction;
          } catch (cause) {
            reportBrowserFailure(cause, {
              phase: "input",
              owner: item.owner,
              contribution: item.qualifiedId,
              message: `Input rule "${item.qualifiedId}" failed.`,
            });
            return null;
          }
        },
        {
          undoable: runtimeRule.undoable,
          inCode: runtimeRule.inCode,
          inCodeMark: runtimeRule.inCodeMark !== false,
        },
      );
      guardedRule.inCodeMark = runtimeRule.inCodeMark;
      return guardedRule;
    });
    const orderedPlugins = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorPluginContributionFactory<unknown>>(
        instances,
        (runtime) => runtime.plugins,
        () => "behavior-plugin",
      ),
      { errorPhase: "plugin", contributionKind: "Plugin" },
    );
    const pluginValues = orderedPlugins.map((item) => invokeFactory(
      item.owner,
      item.qualifiedId,
      "plugin",
      item.contribution.create,
    ));
    const pluginKeys = new Map<string, string>();

    orderedPlugins.forEach((item, index) => {
      if (!(pluginValues[index] instanceof Plugin)) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "plugin",
          message: `Plugin contribution "${item.qualifiedId}" must create a Plugin from markora/extension-api.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      const pluginKey = (pluginValues[index] as Plugin & { key: string }).key;
      const previous = pluginKeys.get(pluginKey);

      if (previous) {
        throw assemblyError({
          code: "EXTENSION_CONTRIBUTION_CONFLICT",
          phase: "plugin",
          message: `ProseMirror plugin key "${pluginKey}" is shared by "${previous}" and "${item.qualifiedId}".`,
          participants: [previous, item.qualifiedId],
        });
      }

      pluginKeys.set(pluginKey, item.qualifiedId);
    });

    const orderedKeymaps = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorKeymapContribution<unknown>>(
        instances,
        (runtime) => runtime.keymaps,
        () => "keymap",
      ),
      { errorPhase: "input", contributionKind: "Keymap" },
    );
    const keyCommands = orderedKeymaps.map((item) => {
      if (typeof item.contribution.key !== "string" || !item.contribution.key.trim()) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "input",
          message: "Extension keymap bindings must use a non-empty key name.",
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      const command = invokeFactory(
        item.owner,
        item.qualifiedId,
        "input",
        item.contribution.create,
      );

      if (typeof command !== "function") {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "input",
          message: `Keymap contribution "${item.qualifiedId}" must create a command function.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      return {
        contribution: item.qualifiedId,
        owner: item.owner,
        keys: resolveMarkdownEditorShortcutKeys(
          options.shortcuts,
          item.qualifiedId,
          [item.contribution.key],
        ),
        command,
      };
    });
    const bindings: Record<string, Command> = {};

    for (const { contribution, keys, owner } of keyCommands) {
      if (keys.some((key) => typeof key !== "string" || !key.trim())) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "input",
          message: "Extension keymap bindings must use a non-empty key name.",
          extension: owner,
          contribution,
        });
      }

      for (const key of keys) {
        if (bindings[key]) continue;

        bindings[key] = (state, dispatch, activeView) => {
          if (activeView?.composing) return false;

          for (const candidate of keyCommands) {
            if (!candidate.keys.includes(key)) continue;

            try {
              const handled = candidate.command(state, dispatch, activeView);

              if (typeof handled !== "boolean") {
                throw new TypeError("An extension keymap command must return a boolean.");
              }

              if (handled) {
                return true;
              }
            } catch (cause) {
              reportBrowserFailure(cause, {
                phase: "input",
                owner: candidate.owner,
                contribution: candidate.contribution,
                message: `Keymap contribution "${candidate.contribution}" failed.`,
              });
              return true;
            }
          }

          return false;
        };
      }
    }

    const orderedNodeViews = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorNodeViewContribution<unknown>>(
        instances,
        (runtime) => runtime.nodeViews,
        () => "node-view",
      ),
      { errorPhase: "node-view", contributionKind: "NodeView" },
    );
    const nodeViews: Record<string, NodeViewConstructor> = {};
    const nodeViewOwners = new Map(
      (options.reservedNodeViews ?? []).map((node) => [node, "@markora/core"]),
    );

    for (const item of orderedNodeViews) {
      const node = item.contribution.node;
      const previous = nodeViewOwners.get(node);

      if (!options.codec.schema.nodes[node]) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "node-view",
          message: `NodeView "${item.qualifiedId}" targets missing schema node "${node}".`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      if (previous) {
        throw assemblyError({
          code: "EXTENSION_CONTRIBUTION_CONFLICT",
          phase: "node-view",
          message: `Schema node "${node}" has NodeViews from both "${previous}" and "${item.qualifiedId}".`,
          participants: [previous, item.qualifiedId],
          contribution: item.qualifiedId,
        });
      }

      nodeViewOwners.set(node, item.qualifiedId);
      const nodeView = invokeFactory(
        item.owner,
        item.qualifiedId,
        "node-view",
        item.contribution.create,
      );

      if (typeof nodeView !== "function") {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "node-view",
          message: `NodeView contribution "${item.qualifiedId}" must create a constructor.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      nodeViews[node] = createGuardedNodeViewConstructor(
        item.owner,
        item.qualifiedId,
        nodeView,
      );
    }

    const orderedTransforms = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorClipboardTransformContribution<unknown>>(
        instances,
        (runtime) => runtime.clipboard?.transforms,
        (contribution) => `clipboard-transform:${contribution.kind}`,
      ),
      { errorPhase: "clipboard", contributionKind: "Clipboard transform" },
    ).map((item) => {
      if (
        !["text", "html", "slice"].includes(item.contribution.kind)
        || !["outer", "nested-code", "both"].includes(item.contribution.surface)
      ) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "clipboard",
          message: `Clipboard transform "${item.qualifiedId}" has an invalid kind or surface.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      if (
        item.contribution.kind === "slice"
        && item.contribution.surface === "nested-code"
      ) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "clipboard",
          message: `Clipboard slice transform "${item.qualifiedId}" cannot target the plain-text nested-code surface.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      const transform = invokeFactory<unknown>(
        item.owner,
        item.qualifiedId,
        "clipboard",
        item.contribution.create as (
          context: MarkdownEditorExtensionAssemblyContext<unknown>,
        ) => unknown,
      );

      if (typeof transform !== "function") {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "clipboard",
          message: `Clipboard transform "${item.qualifiedId}" must create a function.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      return { ...item, transform };
    });
    const orderedHandlers = orderMarkdownEditorContributions(
      collectOrdered<MarkdownEditorClipboardHandlerContribution<unknown>>(
        instances,
        (runtime) => runtime.clipboard?.handlers,
        (contribution) => `clipboard-handler:${contribution.kind}`,
      ),
      { errorPhase: "clipboard", contributionKind: "Clipboard handler" },
    ).map((item) => {
      if (
        !["paste", "drop"].includes(item.contribution.kind)
        || !["outer", "nested-code", "both"].includes(item.contribution.surface)
      ) {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "clipboard",
          message: `Clipboard handler "${item.qualifiedId}" has an invalid kind or surface.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      const handler = invokeFactory<unknown>(
        item.owner,
        item.qualifiedId,
        "clipboard",
        item.contribution.create,
      );

      if (typeof handler !== "function") {
        throw assemblyError({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "clipboard",
          message: `Clipboard handler "${item.qualifiedId}" must create a function.`,
          extension: item.owner,
          contribution: item.qualifiedId,
        });
      }

      return { ...item, handler };
    });
    const outerTransforms = orderedTransforms.filter(
      (item) => item.contribution.surface !== "nested-code",
    );
    const outerHandlers = orderedHandlers.filter(
      (item) => item.contribution.surface !== "nested-code",
    );
    const nestedTransforms = orderedTransforms.filter(
      (item) => (
        item.contribution.surface !== "outer"
        && item.contribution.kind !== "slice"
      ),
    );
    const nestedHandlers = orderedHandlers.filter(
      (item) => item.contribution.surface !== "outer",
    );
    let outerClipboardFailure: MarkdownEditorExtensionError | null = null;
    const beginClipboard = () => {
      outerClipboardFailure = null;
    };
    const takeClipboardFailure = () => {
      const failure = outerClipboardFailure;
      outerClipboardFailure = null;
      return failure;
    };
    const applyStringTransforms = (
      items: typeof orderedTransforms,
      kind: "html" | "text",
      initialValue: string,
      captureFailure = false,
    ) => {
      let value = initialValue;

      for (const item of items) {
        if (item.contribution.kind !== kind) {
          continue;
        }

        try {
          const nextValue = (item.transform as (input: string) => unknown)(value);

          if (typeof nextValue !== "string") {
            throw new TypeError(`A ${kind} clipboard transform must return a string.`);
          }

          value = nextValue;
        } catch (cause) {
          const failure = reportBrowserFailure(cause, {
            phase: "clipboard",
            owner: item.owner,
            contribution: item.qualifiedId,
            message: `Clipboard transform "${item.qualifiedId}" failed.`,
          }, !captureFailure);
          if (captureFailure) outerClipboardFailure ??= failure;
          break;
        }
      }

      return value;
    };
    const runClipboardHandlers = (
      items: typeof orderedHandlers,
      kind: "drop" | "paste",
      event: ClipboardEvent | DragEvent,
      activeView: EditorView,
    ) => {
      for (const item of items) {
        if (item.contribution.kind !== kind) {
          continue;
        }

        try {
          const handled = (item.handler as (
            targetEvent: ClipboardEvent | DragEvent,
            targetView: EditorView,
          ) => unknown)(event, activeView);

          if (typeof handled !== "boolean") {
            throw new TypeError("A clipboard handler must return a boolean.");
          }

          if (handled) {
            return true;
          }
        } catch (cause) {
          reportBrowserFailure(cause, {
            phase: "clipboard",
            owner: item.owner,
            contribution: item.qualifiedId,
            message: `Clipboard handler "${item.qualifiedId}" failed.`,
          });
          return true;
        }
      }

      return false;
    };
    const clipboard = outerTransforms.length > 0 || outerHandlers.length > 0
      ? new Plugin({
          props: {
            transformPastedText(text) {
              beginClipboard();
              return applyStringTransforms(outerTransforms, "text", text, true);
            },
            transformPastedHTML(html) {
              beginClipboard();
              return applyStringTransforms(outerTransforms, "html", html, true);
            },
            transformPasted(slice) {
              if (outerClipboardFailure) return slice;
              let value = slice;

              for (const item of outerTransforms) {
                if (item.contribution.kind !== "slice") {
                  continue;
                }

                try {
                  const nextValue = (item.transform as (input: typeof slice) => unknown)(value);

                  if (!(nextValue instanceof Slice)) {
                    throw new TypeError("A slice clipboard transform must return a Slice.");
                  }

                  value = nextValue;
                } catch (cause) {
                  outerClipboardFailure ??= reportBrowserFailure(cause, {
                    phase: "clipboard",
                    owner: item.owner,
                    contribution: item.qualifiedId,
                    message: `Clipboard transform "${item.qualifiedId}" failed.`,
                  }, false);
                  break;
                }
              }

              return value;
            },
            handlePaste(activeView, event) {
              const failure = takeClipboardFailure();
              if (failure) {
                options.reportError(failure);
                return true;
              }
              return runClipboardHandlers(
                outerHandlers,
                "paste",
                event,
                activeView,
              );
            },
            handleDrop(activeView, event) {
              const failure = takeClipboardFailure();
              if (failure) {
                options.reportError(failure);
                return true;
              }
              return runClipboardHandlers(
                outerHandlers,
                "drop",
                event,
                activeView,
              );
            },
          },
        })
      : null;
    const hasNestedTextTransforms = nestedTransforms.some(
      (item) => item.contribution.kind === "text",
    );
    const hasNestedHtmlTransforms = nestedTransforms.some(
      (item) => item.contribution.kind === "html",
    );
    const nestedClipboard = (
      nestedTransforms.length > 0
      || nestedHandlers.length > 0
    ) ? Object.freeze({
      transformText: hasNestedTextTransforms
        ? (value: string) => applyStringTransforms(nestedTransforms, "text", value)
        : null,
      transformHtml: hasNestedHtmlTransforms
        ? (value: string) => applyStringTransforms(nestedTransforms, "html", value)
        : null,
      handlePaste: (event: ClipboardEvent, activeView: EditorView) => (
        runClipboardHandlers(nestedHandlers, "paste", event, activeView)
      ),
      handleDrop: (event: DragEvent, activeView: EditorView) => (
        runClipboardHandlers(nestedHandlers, "drop", event, activeView)
      ),
    }) satisfies MarkdownEditorNestedClipboardPipeline
      : null;
    const uiActions: MarkdownEditorCompiledUiAction[] = [];
    const uiActionIds = new Set<string>();

    instances.forEach((instance, extensionIndex) => {
      (instance.runtime.ui ?? []).forEach((action, declarationIndex) => {
        const typedAction = action as MarkdownEditorUiActionContribution<
          Record<string, (...args: never[]) => boolean>,
          Record<string, (...args: never[]) => unknown>
        >;
        const command = instance.handle.commands[typedAction.command];
        const enabled = typedAction.enabled
          ? instance.handle.state[typedAction.enabled]
          : undefined;
        const active = typedAction.active
          ? instance.handle.state[typedAction.active]
          : undefined;
        const qualifiedId = `${instance.resolved.definition.name}/${typedAction.id}`;

        if (
          !isValidMarkdownEditorLocalId(typedAction.id)
          || typeof typedAction.group !== "string"
          || !typedAction.group.trim()
          || typeof typedAction.defaultLabel !== "string"
          || !typedAction.defaultLabel.trim()
          || typeof command !== "function"
          || (typedAction.enabled !== undefined && typeof enabled !== "function")
          || (typedAction.active !== undefined && typeof active !== "function")
          || (typedAction.order !== undefined && !Number.isFinite(typedAction.order))
        ) {
          throw assemblyError({
            code: "EXTENSION_INVALID_DEFINITION",
            phase: "ui",
            message: `UI action "${qualifiedId}" has invalid metadata or references.`,
            extension: instance.resolved.definition.name,
            contribution: typedAction.id,
          });
        }

        if (uiActionIds.has(qualifiedId)) {
          throw assemblyError({
            code: "EXTENSION_CONTRIBUTION_CONFLICT",
            phase: "ui",
            message: `UI action ID "${qualifiedId}" is declared more than once.`,
            extension: instance.resolved.definition.name,
            contribution: typedAction.id,
            participants: [qualifiedId],
          });
        }

        uiActionIds.add(qualifiedId);

        const owner = instance.resolved.definition.name;

        uiActions.push(Object.freeze({
          id: qualifiedId,
          group: typedAction.group,
          order: typedAction.order ?? extensionIndex * 1_000 + declarationIndex,
          defaultLabel: typedAction.defaultLabel,
          run: () => command(),
          isEnabled: () => (
            requireView(owner, "state").editable
            && (enabled ? Boolean(enabled()) : true)
          ),
          isActive: () => active ? Boolean(active()) : false,
        }));
      });
    });
    uiActions.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

    contributions = Object.freeze({
      inputRules: inputRuleValues.length > 0 ? inputRules({ rules: inputRuleValues }) : null,
      plugins: Object.freeze(pluginValues),
      keymap: createCompositionSafeMarkdownEditorKeymap(bindings),
      nodeViews: Object.freeze(nodeViews),
      clipboard,
      nestedClipboard,
      takeClipboardFailure,
      uiActions: Object.freeze(uiActions),
    });
    publishedUiActions = contributions.uiActions;
  } catch (primary) {
    const cleanupErrors = instances
      .slice()
      .reverse()
      .flatMap((instance) => cleanupLifecycleScope(
        instance.assemblyScope,
        instance.resolved.definition.name,
        "assembly",
      ));
    throw aggregateFailure(primary, cleanupErrors);
  }

  return Object.freeze({
    registry,
    contributions,
    attachView({ view: nextView, editor }) {
      if (view || destroying) {
        throw assemblyError({
          code: "EXTENSION_RUNTIME_FAILED",
          phase: "view",
          message: "Extension assembly can attach to exactly one live editor view.",
        });
      }

      view = nextView;
      publicEditor = editor;
      const initialized: RuntimeInstance[] = [];

      try {
        for (const instance of instances) {
          if (!instance.runtime.setup) {
            continue;
          }

          const setupScope = createMarkdownEditorLifecycleScope();
          instance.setupScope = setupScope;
          const cleanup = instance.runtime.setup(Object.freeze({
            ...instance.context,
            editor: publicEditor,
            view: nextView,
            handle: instance.handle,
            lifecycle: setupScope.publicScope,
          }));

          if (cleanup !== undefined) {
            if (typeof cleanup !== "function") {
              throw new TypeError("Extension setup must return a cleanup function or undefined.");
            }

            if (setupScope.isCleaned) {
              try {
                cleanup();
              } catch (cause) {
                throw assemblyError({
                  code: "EXTENSION_CLEANUP_FAILED",
                  phase: "destroy",
                  message: `Extension setup cleanup for "${instance.resolved.definition.name}" failed after reentrant teardown.`,
                  extension: instance.resolved.definition.name,
                  contribution: "setup",
                  cause,
                });
              }
            } else {
              setupScope.publicScope.addCleanup(cleanup);
            }
          }

          if (destroying || setupScope.isCleaned || nextView.isDestroyed) {
            throw assemblyError({
              code: "EXTENSION_RUNTIME_FAILED",
              phase: "setup",
              message: `Extension setup for "${instance.resolved.definition.name}" destroyed the editor before creation completed.`,
              extension: instance.resolved.definition.name,
              contribution: "setup",
            });
          }

          initialized.push(instance);
        }
      } catch (cause) {
        const owner = instances.find((instance) => instance.setupScope && !initialized.includes(instance));
        const primary = normalizeExtensionFailure(cause, {
          code: "EXTENSION_FACTORY_FAILED",
          phase: "setup",
          message: `Extension setup${owner ? ` for "${owner.resolved.definition.name}"` : ""} failed.`,
          extension: owner?.resolved.definition.name,
        });
        const cleanupErrors = instances
          .slice()
          .reverse()
          .flatMap((instance) => instance.setupScope
            ? cleanupLifecycleScope(
                instance.setupScope,
                instance.resolved.definition.name,
                "setup",
              )
            : []);
        throw aggregateFailure(primary, cleanupErrors);
      }
    },
    beginDestroy() {
      if (destroying) {
        return;
      }

      destroying = true;

      for (const instance of instances.slice().reverse()) {
        instance.setupScope?.abort();
        instance.assemblyScope.abort();
      }
    },
    cleanupSetup() {
      return instances
        .slice()
        .reverse()
        .flatMap((instance) => instance.setupScope
          ? cleanupLifecycleScope(
              instance.setupScope,
              instance.resolved.definition.name,
              "setup",
            )
          : []);
    },
    cleanupAssembly() {
      view = undefined;
      publicEditor = undefined;
      const cleanupErrors = instances
        .slice()
        .reverse()
        .flatMap((instance) => cleanupLifecycleScope(
          instance.assemblyScope,
          instance.resolved.definition.name,
          "assembly",
        ));
      return [
        ...nodeViewCleanupErrors.splice(0),
        ...cleanupErrors,
      ];
    },
  });
}
