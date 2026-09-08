export { moveToElementBoundary, type ElementNavigationSpec } from "./elementNavigation";
export {
  MARKORA_EXTENSION_API_VERSION,
  MarkdownEditorExtensionError,
  defineMarkdownEditorExtension,
  defineMarkdownEditorPreset,
  readMarkdownEditorOpaqueTokenSource,
} from "./extensionApi";
export { sliceMarkdownEditorOriginalSourceLines } from "./markdownSource";
export type {
  AnyMarkdownEditorExtension,
  MarkdownEditorClipboardContribution,
  MarkdownEditorClipboardHandlerContribution,
  MarkdownEditorClipboardSurface,
  MarkdownEditorClipboardTransformContribution,
  MarkdownEditorCodec,
  MarkdownEditorContributionOrderTarget,
  MarkdownEditorDependencyHandles,
  MarkdownEditorExtension,
  MarkdownEditorExtensionAssemblyContext,
  MarkdownEditorExtensionCommandMap,
  MarkdownEditorExtensionCompatibility,
  MarkdownEditorExtensionDefinition,
  MarkdownEditorExtensionDependency,
  MarkdownEditorExtensionErrorOptions,
  MarkdownEditorExtensionErrorPhase,
  MarkdownEditorExtensionHandle,
  MarkdownEditorExtensionManifest,
  MarkdownEditorExtensionName,
  MarkdownEditorExtensionOrderTarget,
  MarkdownEditorExtensionPreset,
  MarkdownEditorExtensionPresetDefinition,
  MarkdownEditorExtensionRegistry,
  MarkdownEditorExtensionRuntime,
  MarkdownEditorExtensionSetupContext,
  MarkdownEditorExtensionStateMap,
  MarkdownEditorExtensionStaticDefinition,
  MarkdownEditorExtensionStorageContext,
  MarkdownEditorExtensionWithoutStorageDefinition,
  MarkdownEditorInputRuleContribution,
  MarkdownEditorJsonValue,
  MarkdownEditorKeymapContribution,
  MarkdownEditorLifecycleScope,
  MarkdownEditorMarkdownContribution,
  MarkdownEditorNamespacedIdFactory,
  MarkdownEditorNodeViewContribution,
  MarkdownEditorOrderedContribution,
  MarkdownEditorPluginContributionFactory,
  MarkdownEditorRuntimeCommands,
  MarkdownEditorRuntimeState,
  MarkdownEditorSchemaContribution,
  MarkdownEditorSchemaEntry,
  MarkdownEditorSchemaOrderTarget,
  MarkdownEditorStaticExtensionDefinition,
  MarkdownEditorTokenizerNamespace,
  MarkdownEditorTokenizerRule,
  MarkdownEditorUiActionContribution,
  MarkdownEditorUiAction,
  MarkdownMarkSerializer,
  MarkdownNodeSerializer,
  UntypedMarkdownEditorExtensionHandle,
  ZeroArgumentBooleanKey,
} from "./extensionApi";

// These constructors are the supported upstream identity boundary for v1
// extension packages. Importing them here avoids duplicate ProseMirror copies.
export { default as MarkdownIt } from "markdown-it";
export { InputRule } from "prosemirror-inputrules";
export {
  MarkdownParser,
  MarkdownSerializer,
  MarkdownSerializerState,
} from "prosemirror-markdown";
export { Fragment, Schema, Slice } from "prosemirror-model";
export {
  AllSelection,
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "prosemirror-state";
export { Decoration, DecorationSet } from "prosemirror-view";
export { setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
export { closeHistory } from "prosemirror-history";
export type { ParseSpec } from "prosemirror-markdown";
export type {
  Attrs,
  DOMOutputSpec,
  Mark,
  MarkSpec,
  Node,
  NodeSpec,
  NodeType,
  ResolvedPos,
} from "prosemirror-model";
export type { Command, Transaction } from "prosemirror-state";
export type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from "prosemirror-view";
