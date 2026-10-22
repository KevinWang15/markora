import type {
  MarkdownEditorCodeBlockOptions,
  MarkdownEditorEventName,
  MarkdownEditorHeadingLevel,
  MarkdownEditorMark,
  MarkdownEditorMessageOverrides,
  MarkdownEditorSelectionSnapshot,
  MarkdownEditorSelectionTarget,
  MarkdownEditorShortcutMap,
  MarkdownEditorTableAlignment,
  MarkdownEditorTableColumnMoveDirection,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorTableInsertSide,
  MarkdownEditorTableIssue,
  MarkdownEditorTableResizeOptions,
  MarkdownEditorTableRowMoveDirection,
  MarkdownEditorTypingOptions,
  OpaqueMarkdownEditRequest,
  UpdateEditorOptions,
} from "markora";
import type {
  AlertKind,
  AlertsMessages,
  AlertSnapshot,
} from "markora-extension-alerts";
import type {
  DiagramEditRequest,
  DiagramKind,
  DiagramMessages,
  DiagramNodeTarget,
  DiagramsSnapshot,
} from "markora-extension-diagrams";
import type {
  FootnoteDefinitionTarget,
  FootnotesMessageOverrides,
  FootnotesSnapshot,
} from "markora-extension-footnotes";
import type {
  FrontmatterEditRequest,
  FrontmatterMessageOverrides,
  FrontmatterSnapshot,
} from "markora-extension-frontmatter";
import type {
  HtmlEditRequest,
  HtmlMessages,
  HtmlNodeTarget,
  HtmlRenderRequest,
  HtmlSnapshot,
} from "markora-extension-html";
import type {
  MathEditRequest,
  MathKind,
  MathMessages,
  MathNodeTarget,
  MathSnapshot,
} from "markora-extension-math";
import type { TocMessages, TocSnapshot } from "markora-extension-toc";
import type { ContextMenuConfig, DefaultUiMessageOverrides } from "markora-ui";
import type * as themeApi from "markora/themes";
import type { ListenerSnapshot } from "./listenerLedger";

export type BrowserLabRoot = "document" | "shadow";
export type BrowserLabPortal =
  | "body"
  | "default"
  | "local"
  | "positioned"
  | "transformed";
export type BrowserLabFootnotesMessages = Partial<
  Record<keyof FootnotesMessageOverrides, string>
>;
export type BrowserLabAlertsMessages = Partial<
  Record<keyof AlertsMessages, string>
>;
export type BrowserLabDiagramMessages = Partial<
  Record<keyof DiagramMessages, string>
>;
export type BrowserLabHtmlMessages = Partial<
  Record<keyof HtmlMessages, string>
>;
export type BrowserLabMathMessages = Partial<
  Record<keyof MathMessages, string>
>;
export type BrowserLabTocMessages = Partial<Record<keyof TocMessages, string>>;
export type BrowserLabHtmlRendererMode =
  | "connected"
  | "deferred"
  | "missing"
  | "reject"
  | "string"
  | "sync"
  | "throw"
  | "unsafe"
  | "wrong-document";
export type BrowserLabDiagramRendererMode =
  | BrowserLabHtmlRendererMode
  | "unsafe-css-var";
export type BrowserLabMathRendererMode =
  | "connected"
  | "deferred"
  | "missing"
  | "reject"
  | "sync"
  | "throw"
  | "unsafe"
  | "wrong-document";

export type BrowserLabAlertsCommandRequest =
  | { kind?: AlertKind; type: "toggle" | "wrap" }
  | { kind: AlertKind; type: "setKind" }
  | { type: "unwrap" };

export type BrowserLabAlertsStateRequest =
  | { kind?: AlertKind; type: "canToggle" | "canWrap" }
  | { kind: AlertKind; type: "canSetKind" }
  | { type: "canUnwrap" | "isActive" };

export type BrowserLabAlertsSnapshot = Readonly<{
  active: AlertSnapshot | null;
  alerts: readonly AlertSnapshot[];
}>;

export type BrowserLabTocCommandRequest = Readonly<{
  type: "insert" | "remove";
}>;

export type BrowserLabTocStateRequest = Readonly<{
  type: "canInsert" | "canRemove" | "isActive";
}>;

export type BrowserLabDiagramCommandRequest =
  | { options: Readonly<{ info: string; source: string }>; type: "insert" }
  | { kind: DiagramKind; target: DiagramNodeTarget; type: "convert" }
  | { kind: DiagramKind; type: "convertCodeBlock" }
  | {
      patch: Readonly<{ info?: string; source?: string }>;
      target: DiagramNodeTarget;
      type: "update";
    }
  | {
      target: DiagramNodeTarget;
      type: "remove" | "restoreCodeBlock" | "retryPreview" | "togglePreview";
    };

export type BrowserLabEditorSpec = {
  localRenderers?: boolean;
  contextMenu?: false | ContextMenuConfig;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  diagramMessages?: BrowserLabDiagramMessages;
  diagramRendererModes?: Partial<
    Record<DiagramKind, BrowserLabDiagramRendererMode>
  >;
  editable?: boolean;
  entry?: "minimal" | "root";
  extensionMode?:
    | "alerts"
    | "all-advanced"
    | "diagrams"
    | "footnotes"
    | "frontmatter"
    | "html"
    | "math"
    | "public-example"
    | "toc";
  alertsMessages?: BrowserLabAlertsMessages;
  footnotesMessages?: BrowserLabFootnotesMessages;
  frontmatterMessages?: FrontmatterMessageOverrides;
  htmlMessages?: BrowserLabHtmlMessages;
  htmlRendererMode?: BrowserLabHtmlRendererMode;
  id: string;
  initialSelection?: MarkdownEditorSelectionTarget;
  language?: string;
  markdown?: string;
  mathMessages?: BrowserLabMathMessages;
  mathRendererMode?: BrowserLabMathRendererMode;
  mathEditMode?: "in-place";
  messages?: MarkdownEditorMessageOverrides;
  motion?: "reduce";
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: BrowserLabPortal;
  root?: BrowserLabRoot;
  resourceMode?:
    | "custom-protocol"
    | "deny-images"
    | "immediate-upload"
    | "proxy-images";
  shortcuts?: MarkdownEditorShortcutMap;
  typing?: MarkdownEditorTypingOptions;
  theme?: themeApi.BuiltInThemeId;
  tocMessages?: BrowserLabTocMessages;
  uiMessages?: DefaultUiMessageOverrides;
};

export type BrowserLabUpdateOptions = Pick<
  UpdateEditorOptions,
  "ariaLabel" | "ariaLabelledBy" | "attributes" | "editable" | "placeholder"
>;

export type BrowserLabEventRecord = {
  code?: string;
  contribution?: string;
  docChanged?: boolean;
  extension?: string;
  language?: string;
  message?: string;
  fileName?: string;
  phase?: string;
  progress?: number | null;
  reason?: string;
  previousSelection?: MarkdownEditorSelectionSnapshot;
  selection?: MarkdownEditorSelectionSnapshot;
  selectionChanged?: boolean;
  status?: string;
  type: MarkdownEditorEventName;
};

type BrowserLabNoArgumentCommand =
  | "deleteTable"
  | "deleteTableColumn"
  | "deleteTableRow"
  | "insertHardBreak"
  | "insertHorizontalRule"
  | "liftListItem"
  | "redo"
  | "removeImage"
  | "removeLink"
  | "setParagraph"
  | "sinkListItem"
  | "toggleBlockquote"
  | "toggleBulletList"
  | "toggleOrderedList"
  | "toggleTaskList"
  | "undo";

export type BrowserLabCommandRequest =
  | { type: BrowserLabNoArgumentCommand }
  | {
      type: "addTableColumn" | "addTableRow";
      side?: MarkdownEditorTableInsertSide;
    }
  | {
      type: "insertImage";
      attrs: { alt?: string | null; src: string; title?: string | null };
    }
  | { type: "insertTable"; options?: MarkdownEditorTableInsertOptions }
  | {
      type: "moveTableColumn";
      direction: MarkdownEditorTableColumnMoveDirection;
    }
  | { type: "moveTableRow"; direction: MarkdownEditorTableRowMoveDirection }
  | { type: "pasteMarkdown" | "pastePlainText"; text: string }
  | { type: "resizeTable"; options: MarkdownEditorTableResizeOptions }
  | { type: "setCodeBlock"; options?: MarkdownEditorCodeBlockOptions }
  | { type: "setHeading"; level: MarkdownEditorHeadingLevel }
  | { type: "setLink"; href: string }
  | { type: "setTableColumnAlignment"; alignment: MarkdownEditorTableAlignment }
  | { type: "setTaskChecked"; checked: boolean }
  | { type: "toggleMark"; mark: MarkdownEditorMark };

export type BrowserLabActiveRequest =
  | {
      type:
        | "blockquote"
        | "bulletList"
        | "hardBreak"
        | "horizontalRule"
        | "orderedList"
        | "paragraph"
        | "table"
        | "tableCellSelection"
        | "taskList";
    }
  | { type: "codeBlock"; options?: MarkdownEditorCodeBlockOptions }
  | { type: "heading"; level?: MarkdownEditorHeadingLevel }
  | { type: "tableColumnAlignment"; alignment: MarkdownEditorTableAlignment }
  | { type: "taskChecked"; checked?: boolean };

export type BrowserLabEventSnapshot = {
  counts: Record<MarkdownEditorEventName, number>;
  log: BrowserLabEventRecord[];
};

export type BrowserLabExtensionSnapshot = {
  calloutLifecycle: {
    cleanupRuns: number;
    commandRuns: number;
    nodeViewDestroys: number;
    setupActive: boolean;
    setupRuns: number;
  } | null;
  manifest: Array<{ name: string; version: string }>;
  uiActions: Array<{ defaultLabel: string; group: string; id: string }>;
};

export type BrowserLabCopyResult = {
  defaultPrevented: boolean;
  html: string;
  markdown: string;
  plain: string;
  types: string[];
};

export type BrowserLabUpdateResult = {
  snapshot: BrowserLabSnapshot;
  statePreserved: boolean;
};

export type BrowserLabFrontmatterCommandRequest =
  | { type: "insert"; source?: string }
  | { type: "remove" }
  | { type: "update"; source: string };

export type BrowserLabFootnotesCommandRequest =
  | { type: "insertDefinition" | "insertReference"; label: string }
  | {
      type: "navigateToDefinition" | "navigateToReference";
      label: string;
      occurrence?: number;
    }
  | {
      type: "removeDefinition";
      target: FootnoteDefinitionTarget;
      references: "preserve" | "remove";
    }
  | {
      type: "renameDefinition";
      target: FootnoteDefinitionTarget;
      nextLabel: string;
      references: "preserve" | "rename";
    };

export type BrowserLabFootnoteSelectionRequest = Readonly<{
  content?: Readonly<{
    from?: number;
    to?: number;
  }>;
  kind: "definition" | "reference";
  label: string;
  occurrence?: number;
}>;

export type BrowserLabMathCommandRequest =
  | { kind: MathKind; target: MathNodeTarget; type: "convert" }
  | { source: string; type: "insertBlock" | "insertInline" }
  | { source: string; target: MathNodeTarget; type: "update" }
  | {
      target: MathNodeTarget;
      type: "remove" | "retryPreview" | "togglePreview";
    };

export type BrowserLabHtmlCommandRequest =
  | { source: string; target: HtmlNodeTarget; type: "update" }
  | {
      target: HtmlNodeTarget;
      type: "remove" | "retryPreview" | "togglePreview";
    };

export type BrowserLabHtmlEditSnapshot = Pick<
  HtmlEditRequest,
  "display" | "identity" | "kind" | "position" | "render" | "source"
>;

export type BrowserLabHtmlRendererCall = Readonly<{
  aborted: boolean;
  id: number;
  kind: HtmlRenderRequest["kind"];
  settled: "pending" | "rejected" | "resolved" | "threw";
  source: string;
}>;

export type BrowserLabHtmlRendererSettlement = Readonly<{
  callId?: number;
  outcome?: "reject" | "resolve";
}>;

export type BrowserLabMathEditSnapshot = Pick<
  MathEditRequest,
  "kind" | "position" | "render" | "source"
>;

export type BrowserLabMathRendererCall = Readonly<{
  aborted: boolean;
  id: number;
  kind: MathKind;
  settled: "pending" | "rejected" | "resolved" | "threw";
  source: string;
}>;

export type BrowserLabMathRendererSettlement = Readonly<{
  callId?: number;
  outcome?: "reject" | "resolve";
}>;

export type BrowserLabDiagramEditSnapshot = Pick<
  DiagramEditRequest,
  "identity" | "info" | "kind" | "position" | "render" | "source"
>;

export type BrowserLabDiagramRendererCall = Readonly<{
  aborted: boolean;
  id: number;
  info: string;
  kind: DiagramKind;
  settled: "pending" | "rejected" | "resolved" | "threw";
  source: string;
}>;

export type BrowserLabDiagramRendererSettlement = Readonly<{
  callId?: number;
  outcome?: "reject" | "resolve";
}>;

export type BrowserLabReconcileResult = {
  changed: boolean;
  snapshot: BrowserLabSnapshot;
};

export type BrowserLabTransferSpec = {
  event: "dragover" | "drop" | "paste";
  files?: Array<{
    contents: string;
    name: string;
    type: string;
  }>;
  html?: string;
  markdown?: string;
  plain?: string;
  target?: "code-mirror" | "prosemirror" | "static-code";
};

export type BrowserLabTransferResult = {
  defaultPrevented: boolean;
  fileCount: number;
  types: string[];
};

export type BrowserLabSnapshot = {
  activeElement: string | null;
  changeCount: number;
  codeBlocks: {
    active: number;
    codeMirrorEditors: number;
    error: number;
    inactive: number;
    loading: number;
    staticViews: number;
    total: number;
  };
  codeMirrorFocused: boolean;
  id: string;
  markdown: string;
  prosemirrorFocused: boolean;
  selection: {
    anchor: number;
    from: number;
    head: number;
    to: number;
  };
  transactionCount: number;
};

export type BrowserLabResourceLog = {
  loads: Array<{ storedUrl: string; url: string }>;
  opens: Array<{ kind: "image" | "link"; storedUrl: string; url: string }>;
  resolutions: Array<{
    kind: "image" | "link";
    purpose: "load" | "open";
    url: string;
  }>;
  uploads: Array<{ fileName: string; source: "drop" | "paste" }>;
};

export type BrowserLabApi = {
  themes: typeof themeApi;
  alertsCommand: (
    id: string,
    request: BrowserLabAlertsCommandRequest,
  ) => boolean;
  alertsSnapshot: (id: string) => BrowserLabAlertsSnapshot;
  alertsState: (id: string, request: BrowserLabAlertsStateRequest) => boolean;
  blur: (id: string) => void;
  clearEvents: (id: string) => void;
  active: (id: string, request: BrowserLabActiveRequest) => boolean;
  can: (id: string, request: BrowserLabCommandRequest) => boolean;
  command: (id: string, request: BrowserLabCommandRequest) => boolean;
  copySelection: (id: string) => BrowserLabCopyResult;
  diagramCommand: (
    id: string,
    request: BrowserLabDiagramCommandRequest,
  ) => boolean;
  diagramEditConvert: (id: string, kind: DiagramKind) => boolean;
  diagramEditRemove: (id: string) => boolean;
  diagramEditRestoreCodeBlock: (id: string) => boolean;
  diagramEditUpdate: (
    id: string,
    patch: Readonly<{ info?: string; source?: string }>,
  ) => boolean;
  diagramRendererCalls: (
    id: string,
  ) => readonly BrowserLabDiagramRendererCall[];
  diagramRendererSettle: (
    id: string,
    settlement?: BrowserLabDiagramRendererSettlement,
  ) => boolean;
  diagramSnapshot: (id: string) => DiagramsSnapshot;
  destroy: (id: string) => boolean;
  destroyEditor: (id: string) => boolean;
  destroyAll: () => void;
  dispatchTransfer: (
    id: string,
    spec: BrowserLabTransferSpec,
  ) => BrowserLabTransferResult;
  dispatchViewportEvent: (type: "resize" | "scroll") => void;
  events: (id: string) => BrowserLabEventSnapshot;
  extensionSnapshot: (id: string) => BrowserLabExtensionSnapshot;
  frontmatterCommand: (
    id: string,
    request: BrowserLabFrontmatterCommandRequest,
  ) => boolean;
  frontmatterEditRemove: (id: string) => boolean;
  frontmatterEditUpdate: (id: string, source: string) => boolean;
  frontmatterSnapshot: (id: string) => FrontmatterSnapshot | null;
  htmlCommand: (id: string, request: BrowserLabHtmlCommandRequest) => boolean;
  htmlEditRemove: (id: string) => boolean;
  htmlEditUpdate: (id: string, source: string) => boolean;
  htmlRendererCalls: (id: string) => readonly BrowserLabHtmlRendererCall[];
  htmlRendererSettle: (
    id: string,
    settlement?: BrowserLabHtmlRendererSettlement,
  ) => boolean;
  htmlSnapshot: (id: string) => HtmlSnapshot;
  footnotesCommand: (
    id: string,
    request: BrowserLabFootnotesCommandRequest,
  ) => boolean;
  footnotesSnapshot: (id: string) => FootnotesSnapshot;
  focus: (id: string, selection?: MarkdownEditorSelectionTarget) => void;
  getMarkdown: (id: string) => string;
  isDestroyed: (id: string) => boolean;
  listenerSnapshot: (id?: string) => ListenerSnapshot;
  mathCommand: (id: string, request: BrowserLabMathCommandRequest) => boolean;
  mathEditConvert: (id: string, kind: MathKind) => boolean;
  mathEditRemove: (id: string) => boolean;
  mathEditUpdate: (id: string, source: string) => boolean;
  mathRendererCalls: (id: string) => readonly BrowserLabMathRendererCall[];
  mathRendererSettle: (
    id: string,
    settlement?: BrowserLabMathRendererSettlement,
  ) => boolean;
  mathSnapshot: (id: string) => MathSnapshot;
  mount: (spec: BrowserLabEditorSpec) => BrowserLabSnapshot;
  mountedIds: () => string[];
  openUi: (
    id: string,
    kind: "code-language" | "image" | "link" | "table" | "table-create",
  ) => boolean;
  pendingOpaqueEdit: (
    id: string,
  ) => Pick<OpaqueMarkdownEditRequest, "kind" | "source"> | null;
  pendingFrontmatterEdit: (
    id: string,
  ) => Pick<FrontmatterEditRequest, "diagnostics" | "source"> | null;
  pendingDiagramEdit: (id: string) => BrowserLabDiagramEditSnapshot | null;
  pendingHtmlEdit: (id: string) => BrowserLabHtmlEditSnapshot | null;
  pendingMathEdit: (id: string) => BrowserLabMathEditSnapshot | null;
  ready: true;
  reconcile: (
    id: string,
    markdown: string,
    options?: { emitChange?: boolean },
  ) => BrowserLabReconcileResult;
  remount: (
    id: string,
    options?: Omit<
      BrowserLabEditorSpec,
      "direction" | "entry" | "id" | "placement" | "portal" | "root"
    >,
  ) => BrowserLabSnapshot;
  resourceLog: (id: string) => BrowserLabResourceLog;
  reset: (id: string, markdown: string) => string;
  selectFootnote: (
    id: string,
    request: BrowserLabFootnoteSelectionRequest,
  ) => boolean;
  selectDiagram: (id: string, target: DiagramNodeTarget) => boolean;
  selectHtml: (id: string, target: HtmlNodeTarget) => boolean;
  selectMath: (id: string, target: MathNodeTarget) => boolean;
  selectToc: (id: string, occurrence?: number) => boolean;
  selectText: (
    id: string,
    text: string,
    mode?: "all" | "end" | "start",
    occurrence?: number,
  ) => boolean;
  settle: (id?: string) => Promise<void>;
  snapshot: (id: string) => BrowserLabSnapshot;
  tableIssues: (id: string) => readonly MarkdownEditorTableIssue[];
  tocCommand: (id: string, request: BrowserLabTocCommandRequest) => boolean;
  tocSnapshot: (id: string) => TocSnapshot;
  tocState: (id: string, request: BrowserLabTocStateRequest) => boolean;
  unsubscribe: (id: string, type: MarkdownEditorEventName) => boolean;
  updateOpaque: (id: string, source: string) => boolean;
  updateOptions: (
    id: string,
    options: BrowserLabUpdateOptions,
  ) => BrowserLabUpdateResult;
};

export type BrowserLabComponentsApi = {
  mount(root: "iframe" | "shadow", entry: "root" | "minimal"): void;
  markdown(): string;
  undo(): boolean;
  reset(): void;
  readonly(): void;
  destroy(): void;
};

declare global {
  interface Window {
    __MARKORA_COMPONENTS_LAB__?: BrowserLabComponentsApi;
    __MARKORA_BROWSER_LAB__?: BrowserLabApi;
  }
}
