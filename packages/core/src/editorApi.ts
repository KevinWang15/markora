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
import type {
  MarkdownEditorAssets,
  MarkdownEditorResourceOptions,
} from "./resourceApi";
import type { MarkdownEditorShortcutMap } from "./shortcutConfig";
import type { MarkdownEditorTypingOptions } from "./typingErgonomics";
import type { MarkdownEditorMessageOverrides } from "./editorMessages";

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
  /** Creation-time text and accessible-label overrides for core-owned UI. */
  messages?: MarkdownEditorMessageOverrides;
  onTransaction?: (
    transaction: Parameters<EditorView["dispatch"]>[0],
    view: EditorView,
    context: MarkdownEditorChangeContext,
  ) => void;
  onChange?: (markdown: string, context: MarkdownEditorChangeContext) => void;
  onEditOpaqueMarkdown?: (request: OpaqueMarkdownEditRequest) => void;
  placeholder?: string;
  resources?: MarkdownEditorResourceOptions;
  /** Creation-time overrides for built-in and qualified extension keymaps. */
  shortcuts?: MarkdownEditorShortcutMap;
  /** Creation-time, opt-in typing assistance. */
  typing?: MarkdownEditorTypingOptions;
  ui?: EditorUiFactory;
};

export type UpdateEditorOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: MarkdownEditorDomAttributes | null;
  editable?: boolean;
  onChange?: CreateEditorOptions["onChange"] | null;
  onEditOpaqueMarkdown?: ((request: OpaqueMarkdownEditRequest) => void) | null;
  onTransaction?: CreateEditorOptions["onTransaction"] | null;
  placeholder?: string | null;
};

export type MarkdownEditorMark = "strong" | "em" | "code" | "strike";
export type MarkdownEditorActiveMark = MarkdownEditorMark | "link";
export type MarkdownEditorActiveNode =
  | "blockquote"
  | "bullet_list"
  | "code_block"
  | "hard_break"
  | "heading"
  | "horizontal_rule"
  | "image"
  | "list_item"
  | "ordered_list"
  | "paragraph"
  | "table";
export type MarkdownEditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type MarkdownEditorCodeBlockOptions = {
  language?: string | null;
};
export type MarkdownEditorTableAlignment = "left" | "center" | "right" | null;
export type MarkdownEditorTableInsertSide = "before" | "after";
export type MarkdownEditorTableRowMoveDirection = "up" | "down";
export type MarkdownEditorTableColumnMoveDirection = "left" | "right";
export type MarkdownEditorTableInsertOptions = {
  columns?: number;
  rows?: number;
};
export type MarkdownEditorTableResizeOptions = {
  columns?: number;
  /** Required to shrink through non-empty cells or rows. */
  discardContent?: boolean;
  rows?: number;
};
export type MarkdownEditorTableIssueCode =
  | "merged-cell"
  | "missing-column-header"
  | "multi-block-cell"
  | "ragged-row"
  | "row-header-scope";
export type MarkdownEditorTableIssue = Readonly<{
  code: MarkdownEditorTableIssueCode;
  column: number | null;
  message: string;
  row: number;
  tablePos: number;
}>;

export type MarkdownEditorCommands = {
  reconcileMarkdown: (markdown: string, options?: MarkdownEditorMarkdownUpdateOptions) => boolean;
  resetMarkdown: (markdown: string, options?: MarkdownEditorMarkdownUpdateOptions) => void;
  pasteMarkdown: (markdown: string) => boolean;
  pastePlainText: (text: string) => boolean;
  toggleMark: (mark: MarkdownEditorMark) => boolean;
  setLink: (href: string) => boolean;
  removeLink: () => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  removeImage: () => boolean;
  setParagraph: () => boolean;
  setHeading: (level: MarkdownEditorHeadingLevel) => boolean;
  toggleBlockquote: () => boolean;
  toggleBulletList: () => boolean;
  toggleOrderedList: () => boolean;
  sinkListItem: () => boolean;
  liftListItem: () => boolean;
  toggleTaskList: () => boolean;
  setTaskChecked: (checked: boolean) => boolean;
  insertHardBreak: () => boolean;
  insertHorizontalRule: () => boolean;
  setCodeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
  insertTable: (options?: MarkdownEditorTableInsertOptions) => boolean;
  addTableRow: (side?: MarkdownEditorTableInsertSide) => boolean;
  addTableColumn: (side?: MarkdownEditorTableInsertSide) => boolean;
  resizeTable: (options: MarkdownEditorTableResizeOptions) => boolean;
  moveTableRow: (direction: MarkdownEditorTableRowMoveDirection) => boolean;
  moveTableColumn: (direction: MarkdownEditorTableColumnMoveDirection) => boolean;
  deleteTableRow: () => boolean;
  deleteTableColumn: () => boolean;
  setTableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
  deleteTable: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
};

export type MarkdownEditorState = {
  tableIssues: () => readonly MarkdownEditorTableIssue[];
  can: {
    pasteMarkdown: () => boolean;
    pastePlainText: () => boolean;
    toggleMark: (mark: MarkdownEditorMark) => boolean;
    setLink: () => boolean;
    removeLink: () => boolean;
    insertImage: () => boolean;
    removeImage: () => boolean;
    setParagraph: () => boolean;
    setHeading: (level: MarkdownEditorHeadingLevel) => boolean;
    toggleBlockquote: () => boolean;
    toggleBulletList: () => boolean;
    toggleOrderedList: () => boolean;
    sinkListItem: () => boolean;
    liftListItem: () => boolean;
    toggleTaskList: () => boolean;
    setTaskChecked: (checked: boolean) => boolean;
    insertHardBreak: () => boolean;
    insertHorizontalRule: () => boolean;
    setCodeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
    insertTable: (options?: MarkdownEditorTableInsertOptions) => boolean;
    addTableRow: (side?: MarkdownEditorTableInsertSide) => boolean;
    addTableColumn: (side?: MarkdownEditorTableInsertSide) => boolean;
    resizeTable: (options: MarkdownEditorTableResizeOptions) => boolean;
    moveTableRow: (direction: MarkdownEditorTableRowMoveDirection) => boolean;
    moveTableColumn: (direction: MarkdownEditorTableColumnMoveDirection) => boolean;
    deleteTableRow: () => boolean;
    deleteTableColumn: () => boolean;
    setTableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
    deleteTable: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
  };
  isActive: {
    mark: (mark: MarkdownEditorActiveMark) => boolean;
    node: (node: MarkdownEditorActiveNode) => boolean;
    paragraph: () => boolean;
    heading: (level?: MarkdownEditorHeadingLevel) => boolean;
    blockquote: () => boolean;
    bulletList: () => boolean;
    orderedList: () => boolean;
    taskList: () => boolean;
    taskChecked: (checked?: boolean) => boolean;
    hardBreak: () => boolean;
    horizontalRule: () => boolean;
    codeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
    table: () => boolean;
    tableCellSelection: () => boolean;
    tableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
  };
};

export type MarkdownEditorUi = {
  createTable: () => boolean;
  editCodeBlockLanguage: () => boolean;
  editLink: () => boolean;
  editImage: () => boolean;
  editTable: () => boolean;
};

export type MarkdownEditor = {
  readonly isDestroyed: boolean;
  readonly view: EditorView;
  readonly extensions: MarkdownEditorExtensionRegistry;
  readonly assets: MarkdownEditorAssets;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  blur: () => void;
  focus: (selection?: MarkdownEditorSelectionTarget) => void;
  getMarkdown: () => string;
  flushChange: () => void;
  /** Reload images after host resource context changes; preserves document and history. */
  refreshResources: () => void;
  subscribe: <TType extends MarkdownEditorEventName>(
    type: TType,
    listener: MarkdownEditorEventListener<TType>,
  ) => MarkdownEditorUnsubscribe;
  updateOptions: (options: UpdateEditorOptions) => void;
  destroy: () => void;
};
