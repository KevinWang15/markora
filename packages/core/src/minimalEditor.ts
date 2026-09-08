import { createElementInteractionPlugins, createManagedBlockBoundaryHelpers } from "./elementInteraction";
import {
baseKeymap,
chainCommands,
liftEmptyBlock,
toggleMark,
} from "prosemirror-commands";
import { closeHistory,history,redo,undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type {
Mark,
MarkType,
NodeType,
Node as ProseMirrorNode,
} from "prosemirror-model";
import {
EditorState,
NodeSelection,
Plugin,
TextSelection,
type Command
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createInputRobustnessPlugin } from "./androidInput";
import { createAssetUploadController } from "./assetUploads";
import { createChangeEmitter } from "./changeEmitter";
import { createClipboardSemantics } from "./clipboardSemantics";
import { buildReconciledDocumentTransaction } from "./documentUpdate";
import type {
CreateEditorOptions,
MarkdownEditor,
MarkdownEditorActiveMark,
MarkdownEditorActiveNode,
MarkdownEditorCommands,
MarkdownEditorMark,
MarkdownEditorMarkdownUpdateOptions,
MarkdownEditorState,
UpdateEditorOptions
} from "./editorApi";
import { createTypingShortcuts,getMarkInfo,type MarkName } from "./editorCommands";
import { blurElement,buildEditorDomAttributes,copyEditorAttributes,editorAttributesEqual,getEditorRootActiveElement,isActiveElementInsideEditor,normalizeAccessibleName,normalizePlaceholder } from "./editorDom";
import {
createEditorEventDispatcher,
MarkdownEditorDestroyedError
} from "./editorEvents";
import { observeEditorFocus } from "./editorFocus";
import { normalizeMarkdownEditorMessages } from "./editorMessages";
import {
createCodeBlockRecoveryPlugin,
createCodeFenceEditingPlugin,
createHeadingEditingPlugin,
createHorizontalRulePlugin,
createImagePlugin,
createInputRuleRecoveryPlugin,
} from "./editorPlugins";
import { resolveSelectionTarget,snapshotSelection as snapshotBaseSelection } from "./editorSelection";
import { createStateEventEmitter } from "./editorStateEvents";
import { createChangeContext,createTransactionDispatcher } from "./editorTransactionRuntime";
import { MarkdownEditorExtensionError } from "./extensionApi";
import { createMarkdownEditorExtensionAssembly } from "./extensionAssembly";
import { runInitialMarkdownParse } from "./extensionErrorBoundary";
import { resolveMarkdownEditorExtensions } from "./extensionResolver";
import { MARKORA_VERSION } from "./extensionVersion";
import { assertEditorHostAvailable,claimEditorHost } from "./hostOwnership";
import { createHostIdleScheduler } from "./idleScheduler";
import { createImageViewClass } from "./imageView";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "./managedBlockCursor";
import { createMarkBoundaryHelpers } from "./markBoundaryUtils";
import { createMinimalMarkdownEditorPreset } from "./minimalExtensionPreset";
import { createMinimalMarkdownCodec } from "./minimalMarkdownCodec";
import { createNativeHistoryPlugin } from "./nativeHistory";
import { createPlaceholderPlugin } from "./placeholderPlugin";
import { destroyProseMirrorView } from "./proseMirrorCompatibility";
import type { MarkdownEditorResourceErrorPhase } from "./resourceApi";
import { createResourceOpenPlugin } from "./resourceInteractions";
import {
normalizeMarkdownEditorResources,
sanitizeResourceUrl,
} from "./resourcePolicy";
import { createCleanupError,throwCollectedErrors } from "./runtimeErrors";
import {
createMarkdownEditorShortcutKeymap,
normalizeMarkdownEditorShortcuts,
} from "./shortcutConfig";
import {
createListItemBackspaceCommand,
createListItemDeleteCommand,
createListItemSplitCommand,
createStructuralCommandSet,
} from "./structuralCommands";
import {
hasMarkdownEditorExternalUpdatePermission,
setBuiltinMarkdownEditorTransactionOrigin,
setMarkdownEditorExternalUpdatePermission,
setMarkdownEditorTransactionEmitChange,
type MarkdownEditorChangeContext
} from "./transactionOrigin";
import {
createAutoPairPlugin,
createTrackedHistoryCommand,
normalizeMarkdownEditorTypingOptions,
} from "./typingErgonomics";

const snapshotSelection = snapshotBaseSelection;

type BrowserWindow = Window & typeof globalThis;

type EditorRuntimeOptions = {
  ariaLabel: string | null | undefined;
  ariaLabelledBy: string | null | undefined;
  attributes: Record<string, string>;
  editable: boolean;
  onChange: CreateEditorOptions["onChange"];
  onTransaction: CreateEditorOptions["onTransaction"];
  placeholder: string | null;
};

type MarkRange = Readonly<{
  from: number;
  mark: Mark;
  to: number;
}>;

function markIsActive(state: EditorState, markType: MarkType | undefined) {
  if (!markType) {
    return false;
  }

  const { empty, from, to, $from } = state.selection;

  if (empty) {
    return Boolean(markType.isInSet(state.storedMarks ?? $from.marks()));
  }

  let active = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && markType.isInSet(node.marks)) {
      active = true;
      return false;
    }

    return !active;
  });
  return active;
}

function getMarkRange(state: EditorState, markType: MarkType | undefined): MarkRange | null {
  if (!markType) {
    return null;
  }

  const { selection } = state;

  if (!selection.empty) {
    let found: Mark | undefined;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      found ??= markType.isInSet(node.marks);
      return !found;
    });

    return found ? { from: selection.from, mark: found, to: selection.to } : null;
  }

  const $cursor = selection.$from;
  const children: Array<{ from: number; node: ProseMirrorNode; to: number }> = [];
  $cursor.parent.forEach((node, offset) => {
    children.push({
      from: $cursor.start() + offset,
      node,
      to: $cursor.start() + offset + node.nodeSize,
    });
  });
  const cursor = $cursor.pos;
  let index = children.findIndex(({ from, node, to }) => (
    from <= cursor && cursor <= to && Boolean(markType.isInSet(node.marks))
  ));

  if (index < 0) {
    return null;
  }

  const mark = markType.isInSet(children[index].node.marks);

  if (!mark) {
    return null;
  }

  const sameMark = (candidate: ProseMirrorNode) => (
    Boolean(markType.isInSet(candidate.marks)?.eq(mark))
  );
  let startIndex = index;
  let endIndex = index;

  while (startIndex > 0 && sameMark(children[startIndex - 1].node)) {
    startIndex -= 1;
  }

  while (endIndex + 1 < children.length && sameMark(children[endIndex + 1].node)) {
    endIndex += 1;
  }

  return {
    from: children[startIndex].from,
    mark,
    to: children[endIndex].to,
  };
}

function canInsertNode(state: EditorState, nodeType: NodeType | undefined) {
  if (!nodeType) {
    return false;
  }

  const { $from } = state.selection;
  const index = $from.index();
  return $from.parent.canReplaceWith(index, index, nodeType);
}

/**
 * Creates the deliberately small embedded editor entry. Optional syntax and
 * behavior come only from the supplied extension preset and extensions.
 */
export function createEditor(options: CreateEditorOptions): MarkdownEditor {
  if (!options || typeof options !== "object") {
    throw new TypeError("Markora editor options must be an object.");
  }

  const element = options.element;

  if (!element || typeof element !== "object" || element.nodeType !== 1) {
    throw new TypeError("Markora requires an HTMLElement host.");
  }

  const ownerWindow = element.ownerDocument.defaultView as BrowserWindow | null;

  if (!ownerWindow) {
    throw new Error("Markora requires a window-backed document.");
  }

  assertEditorHostAvailable(element);
  const shortcuts = normalizeMarkdownEditorShortcuts(options.shortcuts);
  const typing = normalizeMarkdownEditorTypingOptions(options.typing);
  const messages = normalizeMarkdownEditorMessages(options.messages);
  const resources = normalizeMarkdownEditorResources(options.resources);

  const runtimeOptions: EditorRuntimeOptions = {
    ariaLabel: normalizeAccessibleName(options.ariaLabel, "ariaLabel"),
    ariaLabelledBy: normalizeAccessibleName(options.ariaLabelledBy, "ariaLabelledBy"),
    attributes: copyEditorAttributes(options.attributes, element.ownerDocument),
    editable: options.editable ?? true,
    onChange: options.onChange,
    onTransaction: options.onTransaction,
    placeholder: normalizePlaceholder(options.placeholder),
  };
  const extensionResolution = resolveMarkdownEditorExtensions({
    markoraVersion: MARKORA_VERSION,
    preset: options.extensionPreset ?? createMinimalMarkdownEditorPreset(),
    extensions: options.extensions,
  });
  const codec = createMinimalMarkdownCodec(extensionResolution.extensions, resources);
  const structuralCommandSet = createStructuralCommandSet(codec.schema);
  const {
    createEscapedBoundaryPlugin,
    isEscapedOutsideBoundary,
  } = createMarkBoundaryHelpers({ getMarkInfo });
  const isEscapedMarkAtSelection = (state: EditorState, markType: MarkType | undefined) => {
    if (!markType || !state.selection.empty) {
      return false;
    }

    const markName = markType.name as MarkName;
    const markInfo = getMarkInfo(state, markName);
    return Boolean(markInfo && isEscapedOutsideBoundary(state, markName, markInfo));
  };
  const getActiveMarkRange = (state: EditorState, markType: MarkType | undefined) => {
    const range = getMarkRange(state, markType);
    return range && !isEscapedMarkAtSelection(state, markType) ? range : null;
  };
  const isMarkActiveAtSelection = (state: EditorState, markType: MarkType | undefined) => (
    markIsActive(state, markType) && !isEscapedMarkAtSelection(state, markType)
  );
  const doc = runInitialMarkdownParse(
    () => codec.parse(options.markdown ?? ""),
  );

  if (!doc) {
    throw new Error("Failed to create an empty ProseMirror document.");
  }

  // Canonicalize before claiming the host so extension serializer failures
  // cannot strand construction-owned DOM or host ownership.
  const initialMarkdown = codec.serialize(doc);
  const isManagedBlockNode = (
    node: ProseMirrorNode | null | undefined,
  ): node is ProseMirrorNode => isManagedBlockNodeFromSchema(codec.schema, node, codec.managedBlocks);
  const managedBlockBoundaries = createManagedBlockBoundaryHelpers({
    schema: codec.schema,
    isManagedBlockNode,
  });

  const resolvedInitialSelection = options.initialSelection
    ? resolveSelectionTarget(doc, options.initialSelection)
    : undefined;
  const idleScheduler = createHostIdleScheduler(ownerWindow);
  let lifecycle: "constructing" | "active" | "destroyed" | "destroying" = "constructing";
  let view!: EditorView;
  let editor!: MarkdownEditor;
  let creationComplete = false;
  const pendingExtensionErrors: Array<{
    error: MarkdownEditorExtensionError;
    useGlobalFallback: boolean;
  }> = [];

  const reportUnhandled = (error: unknown) => {
    const reportError = (ownerWindow as BrowserWindow & {
      reportError?: (error: unknown) => void;
    }).reportError;

    if (typeof reportError === "function") {
      reportError.call(ownerWindow, error);
      return;
    }

    ownerWindow.setTimeout(() => {
      throw error instanceof Error ? error : new Error(String(error));
    }, 0);
  };
  const eventDispatcher = createEditorEventDispatcher(reportUnhandled);
  let resourceDestroyErrors: unknown[] | null = null;
  let handleResourceError: (
    error: unknown,
    phase: MarkdownEditorResourceErrorPhase,
  ) => void = (error) => reportUnhandled(error);
  handleResourceError = (error, phase) => {
    if (lifecycle === "destroying") {
      resourceDestroyErrors?.push(error);
      return;
    }
    if (lifecycle === "destroyed") {
      return;
    }
    const deliver = () => {
      if (!editor || lifecycle !== "active" || view.isDestroyed) {
        return;
      }
      const delivered = eventDispatcher.emit("error", {
        code: "resource-callback-failed",
        context: { phase },
        editor,
        error,
        recoverable: true,
        type: "error",
      });
      if (delivered === 0) {
        reportUnhandled(error);
      }
    };
    if (creationComplete) {
      deliver();
    } else {
      ownerWindow.queueMicrotask(deliver);
    }
  };
  const deliverExtensionError = (
    error: MarkdownEditorExtensionError,
    useGlobalFallback = true,
  ) => {
    if (!creationComplete || lifecycle !== "active" || view.isDestroyed) {
      return false;
    }

    const delivered = eventDispatcher.emit("error", {
      code: error.code as `EXTENSION_${string}`,
      context: {
        phase: error.phase,
        ...(error.extension ? { extension: error.extension } : {}),
        ...(error.contribution ? { contribution: error.contribution } : {}),
        ...(error.participants ? { participants: error.participants } : {}),
      },
      editor,
      error,
      recoverable: true,
      type: "error",
    });

    if (delivered === 0 && useGlobalFallback) {
      reportUnhandled(error);
    }
    return delivered > 0;
  };
  const reportExtensionError = (
    error: MarkdownEditorExtensionError,
    useGlobalFallback = true,
  ) => {
    if (lifecycle === "destroying" || lifecycle === "destroyed") {
      return false;
    }

    if (!creationComplete) {
      pendingExtensionErrors.push({ error, useGlobalFallback });
      return false;
    }

    if (eventDispatcher.has("error")) {
      return deliverExtensionError(error, useGlobalFallback);
    } else if (useGlobalFallback) {
      ownerWindow.queueMicrotask(() => deliverExtensionError(error, true));
    }
    return false;
  };
  const synchronouslyReportedExtensionErrors = new WeakSet<MarkdownEditorExtensionError>();
  const runReportedExtensionOperation = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof MarkdownEditorExtensionError) {
        if (reportExtensionError(error, false)) {
          synchronouslyReportedExtensionErrors.add(error);
          ownerWindow.queueMicrotask(() => synchronouslyReportedExtensionErrors.delete(error));
        }
      }

      throw error;
    }
  };
  const changeEmitter = createChangeEmitter<ProseMirrorNode, MarkdownEditorChangeContext>({
    initialDoc: doc,
    initialMarkdown,
    isDeliveryValid: (targetDoc) => (
      lifecycle === "active"
      && !view.isDestroyed
      && view.state.doc === targetDoc
    ),
    onChange: runtimeOptions.onChange,
    reportAsyncError(error) {
      if (
        error instanceof MarkdownEditorExtensionError
        && synchronouslyReportedExtensionErrors.delete(error)
      ) {
        return;
      }
      reportUnhandled(error);
    },
    scheduleIdle: idleScheduler.schedule,
    serialize: (targetDoc) => runReportedExtensionOperation(
      () => codec.serialize(targetDoc),
    ),
  });
  let finalMarkdown = changeEmitter.getMarkdown(doc);
  const extensionAssembly = createMarkdownEditorExtensionAssembly({
    resolution: extensionResolution,
    codec,
    ownerDocument: element.ownerDocument,
    shortcuts,
    reservedNodeViews: ["image"],
    reportError: reportExtensionError,
  });
  const markCommands: Record<MarkdownEditorMark, Command> = {
    strong: codec.schema.marks.strong
      ? toggleMark(codec.schema.marks.strong)
      : () => false,
    em: codec.schema.marks.em
      ? toggleMark(codec.schema.marks.em)
      : () => false,
    code: codec.schema.marks.code
      ? toggleMark(codec.schema.marks.code)
      : () => false,
    strike: codec.schema.marks.strike
      ? toggleMark(codec.schema.marks.strike)
      : () => false,
  };
  const trackedUndo = createTrackedHistoryCommand(undo, "undo");
  const trackedRedo = createTrackedHistoryCommand(redo, "redo");
  const builtinTypingShortcuts = createTypingShortcuts({
    codec,
    linkify: codec.tokenizer.linkify,
    resources,
  });
  const inputRulePlugins = [
    builtinTypingShortcuts,
    ...(extensionAssembly.contributions.inputRules
      ? [extensionAssembly.contributions.inputRules]
      : []),
  ];
  const autoPairPlugin = createAutoPairPlugin({
    inputRulePlugins,
    schema: codec.schema,
    typing,
  });
  const shortcutKeymap = createMarkdownEditorShortcutKeymap([
    {
      command: structuralCommandSet.commands.insertHardBreak,
      defaultKeys: ["Shift-Enter"],
      id: "@markora/core/hard-break",
    },
    { command: markCommands.strong, defaultKeys: ["Mod-b"], id: "@markora/core/bold" },
    { command: markCommands.em, defaultKeys: ["Mod-i"], id: "@markora/core/italic" },
    { command: markCommands.code, defaultKeys: ["Mod-e"], id: "@markora/core/inline-code" },
    { command: markCommands.strike, defaultKeys: [], id: "@markora/core/strikethrough" },
    { command: trackedUndo, defaultKeys: ["Mod-z"], id: "@markora/core/undo" },
    { command: trackedRedo, defaultKeys: ["Shift-Mod-z", "Mod-y"], id: "@markora/core/redo" },
  ], shortcuts);
  const listItemType = codec.schema.nodes.list_item;
  const listEditingKeymap = listItemType
    ? keymap({
        Backspace: createListItemBackspaceCommand(listItemType),
        Delete: createListItemDeleteCommand(listItemType),
        Enter: chainCommands(createListItemSplitCommand(listItemType), liftEmptyBlock),
        Tab: structuralCommandSet.commands.sinkListItem,
        "Shift-Tab": structuralCommandSet.commands.liftListItem,
      })
    : null;
  let plugins: readonly Plugin[];
  const assertActive = (operation: string) => {
    if (lifecycle !== "active" || view.isDestroyed) {
      throw new MarkdownEditorDestroyedError(operation);
    }
  };
  const assetController = createAssetUploadController({
    assertActive,
    emit(reason, upload) {
      if (lifecycle === "active" && editor && !view.isDestroyed) {
        eventDispatcher.emit("asset", { editor, reason, type: "asset", upload });
      }
    },
    getView: () => view || null,
    isActive: () => lifecycle === "active",
    messages,
    ownerWindow,
    reportUnhandled,
    resources,
    schema: codec.schema,
  });
  const clipboard = createClipboardSemantics({
    codec,
    reportBrowserError(error) {
      if (error instanceof MarkdownEditorExtensionError) {
        reportExtensionError(error);
      } else {
        reportUnhandled(error);
      }
    },
    takeExtensionFailure: extensionAssembly.contributions.takeClipboardFailure,
  });
  const ImageView = createImageViewClass({
    imageNodeType: codec.schema.nodes.image,
    messages,
    onError: handleResourceError,
    resources,
  });

  try {
    plugins = [
      new Plugin({
        filterTransaction(transaction) {
          return (
            runtimeOptions.editable
            || !transaction.docChanged
            || hasMarkdownEditorExternalUpdatePermission(transaction)
          );
        },
      }),
      assetController.plugin,
      codec.createImportedContentSanitizerPlugin(),
      createPlaceholderPlugin(() => runtimeOptions.placeholder),
      createResourceOpenPlugin({ onError: handleResourceError, resources }),
      createEscapedBoundaryPlugin(),
      ...createElementInteractionPlugins(codec.managedBlocks, {
        isManagedBlockNode,
        getManagedBlockBoundary: managedBlockBoundaries.getManagedBlockBoundary,
        insertParagraphAtManagedBlockBoundary:
          managedBlockBoundaries.insertParagraphAtManagedBlockBoundary,
        removeManagedBlockAtBoundary:
          managedBlockBoundaries.removeManagedBlockAtBoundary,
      }),
      ...(extensionAssembly.contributions.clipboard
        ? [extensionAssembly.contributions.clipboard]
        : []),
      builtinTypingShortcuts,
      ...(extensionAssembly.contributions.inputRules
        ? [extensionAssembly.contributions.inputRules]
        : []),
      createInputRuleRecoveryPlugin({ inputRulePlugins }),
      ...(autoPairPlugin ? [autoPairPlugin] : []),
      createHeadingEditingPlugin({ schema: codec.schema }),
      createCodeFenceEditingPlugin({ codec }),
      createCodeBlockRecoveryPlugin({ schema: codec.schema }),
      createHorizontalRulePlugin({
        schema: codec.schema,
        createManagedBlockCursor: (document, blockPos, side) => (
          ManagedBlockCursor.create(document, blockPos, side, isManagedBlockNode)
        ),
        isManagedBlockNode,
      }),
      createImagePlugin({ schema: codec.schema, resources }),
      ...extensionAssembly.contributions.plugins,
      createInputRobustnessPlugin(ownerWindow),
      clipboard.plugin,
      // Clamp the final slice after both structured transforms and raw extension
      // plugins so extension precedence cannot reintroduce unsafe URLs.
      codec.createImportedContentSanitizerPlugin(),
      history(),
      createNativeHistoryPlugin(),
      ...(extensionAssembly.contributions.keymap
        ? [extensionAssembly.contributions.keymap]
        : []),
      ...(shortcutKeymap ? [shortcutKeymap] : []),
      ...(listEditingKeymap ? [listEditingKeymap] : []),
      keymap(baseKeymap),
    ];
  } catch (error) {
    extensionAssembly.beginDestroy();
    const cleanupErrors = extensionAssembly.cleanupAssembly();

    if (cleanupErrors.length > 0) {
      throw createCleanupError(
        "Markora extension assembly failed and cleanup also failed.",
        [error, ...cleanupErrors],
      );
    }

    throw error;
  }

  let releaseHostOwnership: () => void;

  try {
    releaseHostOwnership = claimEditorHost(element);
  } catch (error) {
    extensionAssembly.beginDestroy();
    const cleanupErrors = extensionAssembly.cleanupAssembly();
    throwCollectedErrors(
      "Markora host ownership failed and extension cleanup also failed.",
      [error, ...cleanupErrors],
    );
    throw error;
  }

  const hostChildrenBeforeView = new Set(element.childNodes);
  const emitStateEvents = createStateEventEmitter({
    getEditor: () => editor,
    getView: () => view,
    isActive: () => lifecycle === "active",
    dispatcher: eventDispatcher,
    snapshotSelection,
  });

  const cleanupConstructionFailure = (primaryError: unknown): never => {
    const errors = [primaryError];
    lifecycle = "destroying";
    resourceDestroyErrors = errors;
    pendingExtensionErrors.length = 0;
    extensionAssembly.beginDestroy();
    changeEmitter.cancel();
    errors.push(...extensionAssembly.cleanupSetup());

    if (view && !view.isDestroyed) {
      try {
        destroyProseMirrorView(view);
      } catch (error) {
        errors.push(error);
      }
    }

    errors.push(...extensionAssembly.cleanupAssembly());
    eventDispatcher.clear();

    for (const child of [...element.childNodes]) {
      if (!hostChildrenBeforeView.has(child)) {
        child.remove();
      }
    }

    releaseHostOwnership();
    lifecycle = "destroyed";
    resourceDestroyErrors = null;

    if (errors.length === 1) {
      throw primaryError;
    }

    throw createCleanupError(
      "Markora creation failed and one or more cleanup operations also failed.",
      errors,
    );
  };

  try {
    const initialState = EditorState.create({
      doc,
      plugins,
      selection: resolvedInitialSelection,
    });

    view = new EditorView(element, {
      attributes: () => buildEditorDomAttributes(runtimeOptions),
      editable: () => runtimeOptions.editable,
      nodeViews: {
        image(node, editorView) {
          return new ImageView(node, editorView.dom.ownerDocument);
        },
        ...extensionAssembly.contributions.nodeViews,
      },
      state: initialState,
      dispatchTransaction: createTransactionDispatcher({
        isActive: () => lifecycle === "active",
        isPasting: () => clipboard.isPasting(),
        onTransaction: (transaction, activeView, context) => runtimeOptions.onTransaction?.(transaction, activeView, context),
        scheduleChange: (doc, context) => changeEmitter.schedule(doc, context),
        emitStateEvents,
      }),
    });
    changeEmitter.cache(view.state.doc);
  } catch (error) {
    cleanupConstructionFailure(error);
  }

  lifecycle = "active";

  const canRunInteractiveCommand = () => runtimeOptions.editable && !view.composing;

  const runCommand = (command: Command) => {
    assertActive("run an editor command");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const handled = command(
      view.state,
      (transaction) => {
        setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
        view.dispatch(transaction);
      },
      view,
    );

    if (handled && lifecycle === "active" && !view.isDestroyed) {
      view.focus();
    }

    return handled;
  };
  const reconcileMarkdown = (
    markdown: string,
    updateOptions?: MarkdownEditorMarkdownUpdateOptions,
  ) => {
    assertActive("reconcile Markdown");
    const emitChange = updateOptions?.emitChange ?? false;
    // Host option getters may reenter and destroy the editor.
    assertActive("reconcile Markdown");
    const nextDoc = runReportedExtensionOperation(() => codec.parse(markdown));

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    const currentState = view.state;

    if (currentState.doc.eq(nextDoc)) {
      return false;
    }

    const transaction = closeHistory(buildReconciledDocumentTransaction(currentState, nextDoc));
    transaction.setMeta("addToHistory", false);
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "external");
    setMarkdownEditorExternalUpdatePermission(transaction);
    setMarkdownEditorTransactionEmitChange(transaction, emitChange);
    changeEmitter.cancel();
    view.dispatch(transaction);
    return true;
  };
  const resetMarkdown = (
    markdown: string,
    updateOptions?: MarkdownEditorMarkdownUpdateOptions,
  ) => {
    assertActive("reset Markdown");
    const emitChange = updateOptions?.emitChange ?? false;
    // Host option getters may reenter and destroy the editor.
    assertActive("reset Markdown");
    const nextDoc = runReportedExtensionOperation(() => codec.parse(markdown));

    if (!nextDoc) {
      throw new Error("Failed to parse Markdown into a ProseMirror document.");
    }

    const previousState = view.state;
    const nextState = EditorState.create({ doc: nextDoc, plugins });
    changeEmitter.cancel();
    assetController.cancelAll();
    assertActive("reset Markdown");
    view.updateState(nextState);
    changeEmitter.cache(nextDoc);

    if (emitChange) {
      changeEmitter.schedule(nextDoc, createChangeContext("reset"));
    }

    emitStateEvents(
      previousState,
      nextState,
      !previousState.doc.eq(nextState.doc),
      "reset",
    );
  };
  const setLink = (href: string) => {
    assertActive("set a link");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const linkType = codec.schema.marks.link;
    const normalizedHref = sanitizeResourceUrl(resources, "link", href);

    if (!linkType || !normalizedHref) {
      return false;
    }

    const { selection } = view.state;
    const activeRange = getActiveMarkRange(view.state, linkType);

    if (!activeRange && (
      selection.empty
      || !selection.$from.parent.inlineContent
      || !selection.$to.parent.inlineContent
    )) {
      return false;
    }

    const from = activeRange?.from ?? selection.from;
    const to = activeRange?.to ?? selection.to;
    const transaction = view.state.tr.removeMark(from, to, linkType);
    transaction.addMark(from, to, linkType.create({
      ...(activeRange?.mark.attrs ?? {}),
      href: normalizedHref,
      title: activeRange?.mark.attrs.title ?? null,
    }));
    transaction.removeStoredMark(linkType);
    transaction.setSelection(TextSelection.create(transaction.doc, selection.to));
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
    view.dispatch(transaction);
    return true;
  };
  const removeLink = () => {
    assertActive("remove a link");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const linkType = codec.schema.marks.link;
    const range = getActiveMarkRange(view.state, linkType);

    if (!linkType || !range) {
      return false;
    }

    const transaction = view.state.tr.removeMark(range.from, range.to, linkType);
    transaction.setSelection(TextSelection.create(transaction.doc, view.state.selection.from));
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
    view.dispatch(transaction);
    return true;
  };
  const insertImage = (attrs: {
    src: string;
    alt?: string | null;
    title?: string | null;
  }) => {
    assertActive("insert an image");

    if (!canRunInteractiveCommand()) {
      return false;
    }

    const imageType = codec.schema.nodes.image;
    const normalizedSrc = sanitizeResourceUrl(resources, "image", attrs.src);

    if (!imageType || !normalizedSrc || !canInsertNode(view.state, imageType)) {
      return false;
    }

    const image = imageType.create({
      src: normalizedSrc,
      alt: attrs.alt?.trim() || null,
      title: attrs.title?.trim() || null,
    });
    const transaction = view.state.tr.replaceSelectionWith(image).scrollIntoView();
    const positions = [
      transaction.selection.from,
      Math.max(0, transaction.selection.from - 1),
      view.state.selection.from,
    ];
    const imagePosition = positions.find((position) => (
      transaction.doc.nodeAt(position)?.type === imageType
    ));

    if (imagePosition !== undefined) {
      transaction.setSelection(NodeSelection.create(transaction.doc, imagePosition));
    }

    setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
    view.dispatch(transaction);
    return true;
  };
  const removeImage = () => {
    assertActive("remove an image");

    if (
      !canRunInteractiveCommand()
      || !(view.state.selection instanceof NodeSelection)
      || view.state.selection.node.type !== codec.schema.nodes.image
    ) {
      return false;
    }

    const { from, node } = view.state.selection;
    const transaction = view.state.tr.delete(from, from + node.nodeSize);
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
    view.dispatch(transaction);
    return true;
  };
  const isNodeActive = (node: MarkdownEditorActiveNode) => {
    return structuralCommandSet.isActive.node(view.state, node);
  };
  const runStateQuery = (operation: string, query: () => boolean) => {
    assertActive(operation);
    const result = query();
    assertActive(operation);
    return result;
  };
  const canRunCommand = (operation: string, command: Command) => (
    runStateQuery(operation, () => canRunInteractiveCommand() && command(view.state))
  );
  const focusAfterViewCommand = (handled: boolean) => {
    if (handled && lifecycle === "active" && !view.isDestroyed) {
      view.focus();
    }

    return handled;
  };
  const commands: MarkdownEditorCommands = {
    reconcileMarkdown,
    resetMarkdown,
    pasteMarkdown(markdown) {
      return runReportedExtensionOperation(
        () => runCommand(clipboard.pasteMarkdown(markdown)),
      );
    },
    pastePlainText(text) {
      return runReportedExtensionOperation(
        () => runCommand(clipboard.pastePlainText(text)),
      );
    },
    toggleMark(mark) {
      return runCommand(markCommands[mark]);
    },
    setLink(href) {
      return focusAfterViewCommand(setLink(href));
    },
    removeLink() {
      return focusAfterViewCommand(removeLink());
    },
    insertImage(attrs) {
      return focusAfterViewCommand(insertImage(attrs));
    },
    removeImage() {
      return focusAfterViewCommand(removeImage());
    },
    setParagraph: () => runCommand(structuralCommandSet.commands.setParagraph),
    setHeading(level) {
      assertActive("set a heading");
      return runCommand(structuralCommandSet.commands.setHeading(level));
    },
    toggleBlockquote: () => runCommand(structuralCommandSet.commands.toggleBlockquote),
    toggleBulletList: () => runCommand(structuralCommandSet.commands.toggleBulletList),
    toggleOrderedList: () => runCommand(structuralCommandSet.commands.toggleOrderedList),
    sinkListItem: () => runCommand(structuralCommandSet.commands.sinkListItem),
    liftListItem: () => runCommand(structuralCommandSet.commands.liftListItem),
    toggleTaskList: () => runCommand(structuralCommandSet.commands.toggleTaskList),
    setTaskChecked(checked) {
      assertActive("set task state");
      return runCommand(structuralCommandSet.commands.setTaskChecked(checked));
    },
    insertHardBreak: () => runCommand(structuralCommandSet.commands.insertHardBreak),
    insertHorizontalRule: () => runCommand(structuralCommandSet.commands.insertHorizontalRule),
    setCodeBlock(options) {
      assertActive("set a code block");
      return runCommand(structuralCommandSet.commands.setCodeBlock(options));
    },
    insertTable(options) {
      assertActive("insert a table");
      return runCommand(structuralCommandSet.commands.insertTable(options));
    },
    addTableRow: (side) => runCommand(structuralCommandSet.commands.addTableRow(side)),
    addTableColumn: (side) => runCommand(structuralCommandSet.commands.addTableColumn(side)),
    resizeTable(options) {
      assertActive("resize a table");
      return runCommand(structuralCommandSet.commands.resizeTable(options));
    },
    moveTableRow(direction) {
      assertActive("move a table row");
      return runCommand(structuralCommandSet.commands.moveTableRow(direction));
    },
    moveTableColumn(direction) {
      assertActive("move a table column");
      return runCommand(structuralCommandSet.commands.moveTableColumn(direction));
    },
    deleteTableRow: () => runCommand(structuralCommandSet.commands.deleteTableRow),
    deleteTableColumn: () => runCommand(structuralCommandSet.commands.deleteTableColumn),
    setTableColumnAlignment(alignment) {
      assertActive("set table column alignment");
      return runCommand(structuralCommandSet.commands.setTableColumnAlignment(alignment));
    },
    deleteTable: () => runCommand(structuralCommandSet.commands.deleteTable),
    undo: () => runCommand(trackedUndo),
    redo: () => runCommand(trackedRedo),
  };
  const state: MarkdownEditorState = {
    tableIssues() {
      assertActive("inspect table fidelity issues");
      return Object.freeze([]);
    },
    can: {
      pasteMarkdown() {
        return runStateQuery(
          "query whether Markdown can be pasted",
          canRunInteractiveCommand,
        );
      },
      pastePlainText() {
        return runStateQuery(
          "query whether plain text can be pasted",
          canRunInteractiveCommand,
        );
      },
      toggleMark(mark) {
        assertActive("query whether a mark can be toggled");
        return canRunInteractiveCommand() && markCommands[mark](view.state);
      },
      setLink() {
        assertActive("query whether a link can be set");
        const { selection } = view.state;
        return Boolean(
          canRunInteractiveCommand()
          && codec.schema.marks.link
          && (getActiveMarkRange(view.state, codec.schema.marks.link) || (
            !selection.empty
            && selection.$from.parent.inlineContent
            && selection.$to.parent.inlineContent
          )),
        );
      },
      removeLink() {
        return runStateQuery(
          "query whether a link can be removed",
          () => canRunInteractiveCommand() && Boolean(
            getActiveMarkRange(view.state, codec.schema.marks.link),
          ),
        );
      },
      insertImage() {
        assertActive("query whether an image can be inserted");
        return canRunInteractiveCommand() && canInsertNode(view.state, codec.schema.nodes.image);
      },
      removeImage() {
        return runStateQuery(
          "query whether an image can be removed",
          () => canRunInteractiveCommand()
            && view.state.selection instanceof NodeSelection
            && view.state.selection.node.type === codec.schema.nodes.image,
        );
      },
      setParagraph() {
        return canRunCommand(
          "query whether a paragraph can be set",
          structuralCommandSet.commands.setParagraph,
        );
      },
      setHeading(level) {
        assertActive("query whether a heading can be set");
        return canRunCommand(
          "query whether a heading can be set",
          structuralCommandSet.commands.setHeading(level),
        );
      },
      toggleBlockquote() {
        return canRunCommand(
          "query whether a blockquote can be toggled",
          structuralCommandSet.commands.toggleBlockquote,
        );
      },
      toggleBulletList() {
        return canRunCommand(
          "query whether a bullet list can be toggled",
          structuralCommandSet.commands.toggleBulletList,
        );
      },
      toggleOrderedList() {
        return canRunCommand(
          "query whether an ordered list can be toggled",
          structuralCommandSet.commands.toggleOrderedList,
        );
      },
      sinkListItem() {
        return canRunCommand(
          "query whether a list item can be nested",
          structuralCommandSet.commands.sinkListItem,
        );
      },
      liftListItem() {
        return canRunCommand(
          "query whether a list item can be lifted",
          structuralCommandSet.commands.liftListItem,
        );
      },
      toggleTaskList() {
        return canRunCommand(
          "query whether a task list can be toggled",
          structuralCommandSet.commands.toggleTaskList,
        );
      },
      setTaskChecked(checked) {
        assertActive("query whether task state can be set");
        return canRunCommand(
          "query whether task state can be set",
          structuralCommandSet.commands.setTaskChecked(checked),
        );
      },
      insertHardBreak() {
        return canRunCommand(
          "query whether a hard break can be inserted",
          structuralCommandSet.commands.insertHardBreak,
        );
      },
      insertHorizontalRule() {
        return canRunCommand(
          "query whether a horizontal rule can be inserted",
          structuralCommandSet.commands.insertHorizontalRule,
        );
      },
      setCodeBlock(options) {
        assertActive("query whether a code block can be set");
        return canRunCommand(
          "query whether a code block can be set",
          structuralCommandSet.commands.setCodeBlock(options),
        );
      },
      insertTable(options) {
        assertActive("query whether a table can be inserted");
        return canRunCommand(
          "query whether a table can be inserted",
          structuralCommandSet.commands.insertTable(options),
        );
      },
      addTableRow(side) {
        return canRunCommand(
          "query whether a table row can be added",
          structuralCommandSet.commands.addTableRow(side),
        );
      },
      addTableColumn(side) {
        return canRunCommand(
          "query whether a table column can be added",
          structuralCommandSet.commands.addTableColumn(side),
        );
      },
      resizeTable(options) {
        assertActive("query whether a table can be resized");
        return canRunCommand(
          "query whether a table can be resized",
          structuralCommandSet.commands.resizeTable(options),
        );
      },
      moveTableRow(direction) {
        assertActive("query whether a table row can be moved");
        return canRunCommand(
          "query whether a table row can be moved",
          structuralCommandSet.commands.moveTableRow(direction),
        );
      },
      moveTableColumn(direction) {
        assertActive("query whether a table column can be moved");
        return canRunCommand(
          "query whether a table column can be moved",
          structuralCommandSet.commands.moveTableColumn(direction),
        );
      },
      deleteTableRow() {
        return canRunCommand(
          "query whether a table row can be deleted",
          structuralCommandSet.commands.deleteTableRow,
        );
      },
      deleteTableColumn() {
        return canRunCommand(
          "query whether a table column can be deleted",
          structuralCommandSet.commands.deleteTableColumn,
        );
      },
      setTableColumnAlignment(alignment) {
        assertActive("query whether table column alignment can be set");
        return canRunCommand(
          "query whether table column alignment can be set",
          structuralCommandSet.commands.setTableColumnAlignment(alignment),
        );
      },
      deleteTable() {
        return canRunCommand(
          "query whether a table can be deleted",
          structuralCommandSet.commands.deleteTable,
        );
      },
      undo() {
        assertActive("query whether undo is available");
        return canRunInteractiveCommand() && undo(view.state);
      },
      redo() {
        assertActive("query whether redo is available");
        return canRunInteractiveCommand() && redo(view.state);
      },
    },
    isActive: {
      mark(mark: MarkdownEditorActiveMark) {
        assertActive("query an active mark");
        if (mark === "link") {
          return Boolean(getActiveMarkRange(view.state, codec.schema.marks.link));
        }

        return isMarkActiveAtSelection(view.state, codec.schema.marks[mark]);
      },
      node(node) {
        assertActive("query an active node");
        return isNodeActive(node);
      },
      paragraph() {
        return runStateQuery(
          "query an active paragraph",
          () => structuralCommandSet.isActive.paragraph(view.state),
        );
      },
      heading(level) {
        return runStateQuery(
          "query an active heading",
          () => structuralCommandSet.isActive.heading(view.state, level),
        );
      },
      blockquote() {
        return runStateQuery(
          "query an active blockquote",
          () => structuralCommandSet.isActive.blockquote(view.state),
        );
      },
      bulletList() {
        return runStateQuery(
          "query an active bullet list",
          () => structuralCommandSet.isActive.bulletList(view.state),
        );
      },
      orderedList() {
        return runStateQuery(
          "query an active ordered list",
          () => structuralCommandSet.isActive.orderedList(view.state),
        );
      },
      taskList() {
        return runStateQuery(
          "query an active task list",
          () => structuralCommandSet.isActive.taskList(view.state),
        );
      },
      taskChecked(checked) {
        return runStateQuery(
          "query active task state",
          () => structuralCommandSet.isActive.taskChecked(view.state, checked),
        );
      },
      hardBreak() {
        return runStateQuery(
          "query an active hard break",
          () => structuralCommandSet.isActive.hardBreak(view.state),
        );
      },
      horizontalRule() {
        return runStateQuery(
          "query an active horizontal rule",
          () => structuralCommandSet.isActive.horizontalRule(view.state),
        );
      },
      codeBlock(options) {
        return runStateQuery(
          "query an active code block",
          () => structuralCommandSet.isActive.codeBlock(view.state, options),
        );
      },
      table() {
        return runStateQuery(
          "query an active table",
          () => structuralCommandSet.isActive.table(view.state),
        );
      },
      tableCellSelection() {
        return runStateQuery(
          "query an active table cell selection",
          () => structuralCommandSet.isActive.tableCellSelection(view.state),
        );
      },
      tableColumnAlignment(alignment) {
        return runStateQuery(
          "query active table column alignment",
          () => structuralCommandSet.isActive.tableColumnAlignment(view.state, alignment),
        );
      },
    },
  };
  const stopObservingFocus = observeEditorFocus({
    view,
    getEditor: () => editor,
    isActive: () => lifecycle === "active",
    dispatcher: eventDispatcher,
  });

  const updateOptions = (nextOptions: UpdateEditorOptions) => {
    assertActive("update editor options");
    const runtimePatch: Partial<EditorRuntimeOptions> = {};

    if (nextOptions.ariaLabel !== undefined) {
      runtimePatch.ariaLabel = normalizeAccessibleName(nextOptions.ariaLabel, "ariaLabel");
    }

    if (nextOptions.ariaLabelledBy !== undefined) {
      runtimePatch.ariaLabelledBy = normalizeAccessibleName(
        nextOptions.ariaLabelledBy,
        "ariaLabelledBy",
      );
    }

    if (nextOptions.attributes !== undefined) {
      runtimePatch.attributes = copyEditorAttributes(
        nextOptions.attributes,
        element.ownerDocument,
      );
    }

    if (nextOptions.editable != null) {
      runtimePatch.editable = nextOptions.editable;
    }

    if (nextOptions.onChange !== undefined) {
      runtimePatch.onChange = nextOptions.onChange ?? undefined;
    }

    if (nextOptions.onTransaction !== undefined) {
      runtimePatch.onTransaction = nextOptions.onTransaction ?? undefined;
    }

    if (nextOptions.placeholder !== undefined) {
      runtimePatch.placeholder = normalizePlaceholder(nextOptions.placeholder);
    }

    const shouldFlushOldChange = (
      "onChange" in runtimePatch && runtimePatch.onChange !== runtimeOptions.onChange
    );

    if (shouldFlushOldChange) {
      changeEmitter.flush();
      assertActive("update editor options");
    }

    const nextRuntimeOptions: EditorRuntimeOptions = {
      ...runtimeOptions,
      ...runtimePatch,
    };

    if (editorAttributesEqual(nextRuntimeOptions.attributes, runtimeOptions.attributes)) {
      nextRuntimeOptions.attributes = runtimeOptions.attributes;
    }

    const changesView = (
      nextRuntimeOptions.ariaLabel !== runtimeOptions.ariaLabel
      || nextRuntimeOptions.ariaLabelledBy !== runtimeOptions.ariaLabelledBy
      || nextRuntimeOptions.attributes !== runtimeOptions.attributes
      || nextRuntimeOptions.editable !== runtimeOptions.editable
      || nextRuntimeOptions.placeholder !== runtimeOptions.placeholder
    );
    const changesOnChange = nextRuntimeOptions.onChange !== runtimeOptions.onChange;
    const domAttributes = changesView
      ? buildEditorDomAttributes(nextRuntimeOptions)
      : null;

    Object.assign(runtimeOptions, nextRuntimeOptions);

    if (changesOnChange) {
      changeEmitter.update({
        onChange: runtimeOptions.onChange ?? null,
      });
    }

    if (changesView) {
      view.setProps({
        attributes: () => domAttributes!,
        editable: () => runtimeOptions.editable,
      });
    }
  };

  editor = {
    get isDestroyed() {
      return lifecycle !== "active" || view.isDestroyed;
    },
    view,
    extensions: extensionAssembly.registry,
    assets: assetController.api,
    clipboard: Object.freeze({
      captureSelection() { assertActive("capture clipboard selection"); return clipboard.captureSelection(view); },
      paste(content) { assertActive("paste clipboard content"); return clipboard.pasteContent(view, content); },
    }),
    commands,
    state,
    ui: null,
    blur() {
      assertActive("blur the editor");
      const activeElement = getEditorRootActiveElement(view);

      if (isActiveElementInsideEditor(view, activeElement)) {
        blurElement(activeElement);
      }
    },
    focus(selection) {
      assertActive("focus the editor");

      if (selection) {
        const selectionSnapshot = typeof selection === "object"
          ? { anchor: selection.anchor, head: selection.head }
          : selection;
        const nextSelection = resolveSelectionTarget(view.state.doc, selectionSnapshot);

        if (!view.state.selection.eq(nextSelection)) {
          const transaction = view.state.tr.setSelection(nextSelection).scrollIntoView();
          setBuiltinMarkdownEditorTransactionOrigin(transaction, "command");
          view.dispatch(transaction);
        }
      }

      if (lifecycle === "active" && !view.isDestroyed) {
        view.focus();
        // ProseMirror restores the selection but skips DOM focus for read-only views.
        if (!view.editable) view.dom.focus({ preventScroll: true });
      }
    },
    getMarkdown() {
      return lifecycle === "active" && !view.isDestroyed
        ? changeEmitter.getMarkdown(view.state.doc)
        : finalMarkdown;
    },
    refreshResources() {
      assertActive("refresh resources");
      ImageView.refresh();
    },
    flushChange() {
      if (lifecycle === "active" && !view.isDestroyed) {
        changeEmitter.flush();
      }
    },
    subscribe(type, listener) {
      assertActive("subscribe to editor events");
      return eventDispatcher.subscribe(type, listener);
    },
    updateOptions,
    destroy() {
      if (lifecycle !== "active") {
        return;
      }

      const cleanupErrors: unknown[] = [];

      lifecycle = "destroying";
      resourceDestroyErrors = cleanupErrors;
      creationComplete = false;
      pendingExtensionErrors.length = 0;
      extensionAssembly.beginDestroy();

      try {
        finalMarkdown = changeEmitter.getMarkdown(view.state.doc);
      } catch (error) {
        cleanupErrors.push(error);
      }

      pendingExtensionErrors.length = 0;
      stopObservingFocus();

      for (const cleanup of [
        () => changeEmitter.flushFinal(),
        () => assetController.cancelAll({ dispatch: false, emit: false }),
        () => { cleanupErrors.push(...extensionAssembly.cleanupSetup()); },
        () => destroyProseMirrorView(view),
        () => { cleanupErrors.push(...extensionAssembly.cleanupAssembly()); },
      ]) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      eventDispatcher.clear();
      releaseHostOwnership();
      lifecycle = "destroyed";
      resourceDestroyErrors = null;
      throwCollectedErrors(
        "One or more Markora cleanup operations failed.",
        cleanupErrors,
      );
    },
  };

  try {
    extensionAssembly.attachView({ view, editor });
    creationComplete = true;

    for (const pending of pendingExtensionErrors.splice(0)) {
      ownerWindow.queueMicrotask(() => deliverExtensionError(
        pending.error,
        pending.useGlobalFallback,
      ));
    }
  } catch (setupError) {
    try {
      editor.destroy();
    } catch (cleanupError) {
      throw createCleanupError(
        "Markora extension setup failed and cleanup also failed.",
        [setupError, cleanupError],
      );
    }

    throw setupError;
  }

  if (options.autofocus) {
    try {
      editor.focus();
    } catch (focusError) {
      try {
        editor.destroy();
      } catch (cleanupError) {
        throw createCleanupError(
          "Markora autofocus failed and cleanup also failed.",
          [focusError, cleanupError],
        );
      }

      throw focusError;
    }
  }

  return editor;
}
