import type { EditorView } from "prosemirror-view";
import type { CodeBlockLanguageRegistry } from "./codeBlockLanguages";
import type {
  AnyMarkdownEditorExtension,
  MarkdownEditorExtensionPreset,
  MarkdownEditorExtensionRegistry,
} from "./extensionApi";
import type {
  MarkdownEditorEventListener,
  MarkdownEditorEventName,
  MarkdownEditorUnsubscribe,
} from "./editorEvents";
import type { OpaqueMarkdownEditRequest } from "./opaqueMarkdown";
import type { MarkdownEditorChangeContext } from "./transactionOrigin";
import type { EditorUiFactory } from "./uiTypes";

export type MarkdownEditorDomAttributes = Readonly<Record<string, string>>;

export type MarkdownEditorSelectionTarget =
  | "all"
  | "end"
  | "start"
  | {
    anchor: number;
    head?: number;
  };

export type MarkdownEditorMarkdownUpdateOptions = {
  emitChange?: boolean;
};

export type CreateEditorOptions = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: MarkdownEditorDomAttributes;
  autofocus?: boolean;
  codeBlockLanguages?: CodeBlockLanguageRegistry;
  editable?: boolean;
  element: HTMLElement;
  extensionPreset?: MarkdownEditorExtensionPreset;
  extensions?: readonly AnyMarkdownEditorExtension[];
  initialSelection?: MarkdownEditorSelectionTarget;
  markdown?: string;
  onTransaction?: (
    transaction: Parameters<EditorView["dispatch"]>[0],
    view: EditorView,
    context: MarkdownEditorChangeContext,
  ) => void;
  onChange?: (markdown: string, context: MarkdownEditorChangeContext) => void;
  onChangeMode?: "immediate" | "animationFrame";
  onEditOpaqueMarkdown?: (request: OpaqueMarkdownEditRequest) => void;
  placeholder?: string;
  ui?: EditorUiFactory;
};

export type UpdateEditorOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: MarkdownEditorDomAttributes | null;
  editable?: boolean;
  onChange?: CreateEditorOptions["onChange"] | null;
  onChangeMode?: "immediate" | "animationFrame";
  onEditOpaqueMarkdown?: ((request: OpaqueMarkdownEditRequest) => void) | null;
  onTransaction?: CreateEditorOptions["onTransaction"] | null;
  placeholder?: string | null;
};

export type MarkdownEditorMark = "strong" | "em" | "code" | "strike";
export type MarkdownEditorActiveMark = MarkdownEditorMark | "link";
export type MarkdownEditorActiveNode = "image" | "table" | "code_block";

export type MarkdownEditorCommands = {
  reconcileMarkdown: (markdown: string, options?: MarkdownEditorMarkdownUpdateOptions) => boolean;
  resetMarkdown: (markdown: string, options?: MarkdownEditorMarkdownUpdateOptions) => void;
  /** @deprecated Use resetMarkdown() for an explicit hard reset, or reconcileMarkdown() for ordinary host updates. */
  setMarkdown: (markdown: string, options?: MarkdownEditorMarkdownUpdateOptions) => void;
  toggleMark: (mark: MarkdownEditorMark) => boolean;
  setLink: (href: string) => boolean;
  removeLink: () => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  removeImage: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
};

export type MarkdownEditorState = {
  can: {
    toggleMark: (mark: MarkdownEditorMark) => boolean;
    setLink: () => boolean;
    insertImage: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
  };
  isActive: {
    mark: (mark: MarkdownEditorActiveMark) => boolean;
    node: (node: MarkdownEditorActiveNode) => boolean;
  };
};

export type MarkdownEditorUi = {
  editLink: () => boolean;
  editImage: () => boolean;
};

export type ToolbarButtonState = {
  active: boolean;
  enabled: boolean;
};

export type ToolbarState = {
  bold: ToolbarButtonState;
  italic: ToolbarButtonState;
  code: ToolbarButtonState;
  strike: ToolbarButtonState;
  link: ToolbarButtonState;
  image: ToolbarButtonState;
  undo: { enabled: boolean };
  redo: { enabled: boolean };
};

export type MarkdownEditor = {
  readonly isDestroyed: boolean;
  readonly view: EditorView;
  readonly extensions: MarkdownEditorExtensionRegistry;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  blur: () => void;
  focus: (selection?: MarkdownEditorSelectionTarget) => void;
  getMarkdown: () => string;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
  subscribe: <TType extends MarkdownEditorEventName>(
    type: TType,
    listener: MarkdownEditorEventListener<TType>,
  ) => MarkdownEditorUnsubscribe;
  updateOptions: (options: UpdateEditorOptions) => void;
  destroy: () => void;
};
