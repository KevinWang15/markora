type BrowserLabSelectionTarget =
  | "all"
  | "end"
  | "start"
  | { anchor: number; head?: number };

type BrowserLabEventName = "asset" | "blur" | "error" | "focus" | "selection" | "state" | "update";

type BrowserLabSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: "all" | "managed-block" | "node" | "other" | "table-cell" | "text";
  to: number;
};

type BrowserLabEventRecord = {
  code?: string;
  contribution?: string;
  docChanged?: boolean;
  extension?: string;
  fileName?: string;
  language?: string;
  message?: string;
  phase?: string;
  progress?: number | null;
  reason?: string;
  previousSelection?: BrowserLabSelectionSnapshot;
  selection?: BrowserLabSelectionSnapshot;
  selectionChanged?: boolean;
  status?: string;
  type: BrowserLabEventName;
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

type BrowserLabCommandRequest =
  | { type: BrowserLabNoArgumentCommand }
  | { type: "addTableColumn" | "addTableRow"; side?: "after" | "before" }
  | { type: "insertImage"; attrs: { alt?: string | null; src: string; title?: string | null } }
  | { type: "insertTable"; options?: { columns?: number; rows?: number } }
  | { type: "moveTableColumn"; direction: "left" | "right" }
  | { type: "moveTableRow"; direction: "down" | "up" }
  | { type: "pasteMarkdown" | "pastePlainText"; text: string }
  | { type: "resizeTable"; options: { columns?: number; discardContent?: boolean; rows?: number } }
  | { type: "setCodeBlock"; options?: { language?: string | null } }
  | { type: "setHeading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "setLink"; href: string }
  | { type: "setTableColumnAlignment"; alignment: "center" | "left" | "right" | null }
  | { type: "setTaskChecked"; checked: boolean }
  | { type: "toggleMark"; mark: "code" | "em" | "strike" | "strong" };

type BrowserLabActiveRequest =
  | { type: "blockquote" | "bulletList" | "hardBreak" | "horizontalRule" | "orderedList" | "paragraph" | "table" | "tableCellSelection" | "taskList" }
  | { type: "codeBlock"; options?: { language?: string | null } }
  | { type: "heading"; level?: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "tableColumnAlignment"; alignment: "center" | "left" | "right" | null }
  | { type: "taskChecked"; checked?: boolean };

type BrowserLabAlertKind = "caution" | "important" | "note" | "tip" | "warning";

type BrowserLabAlertsCommandRequest =
  | { kind?: BrowserLabAlertKind; type: "toggle" | "wrap" }
  | { kind: BrowserLabAlertKind; type: "setKind" }
  | { type: "unwrap" };

type BrowserLabAlertsStateRequest =
  | { kind?: BrowserLabAlertKind; type: "canToggle" | "canWrap" }
  | { kind: BrowserLabAlertKind; type: "canSetKind" }
  | { type: "canUnwrap" | "isActive" };

type BrowserLabAlertSnapshot = {
  kind: BrowserLabAlertKind;
  position: number;
};

type BrowserLabAlertsSnapshot = {
  active: BrowserLabAlertSnapshot | null;
  alerts: ReadonlyArray<BrowserLabAlertSnapshot>;
};

type BrowserLabTocCommandRequest = {
  type: "insert" | "remove";
};

type BrowserLabTocStateRequest = {
  type: "canInsert" | "canRemove" | "isActive";
};

type BrowserLabTocHeadingSnapshot = {
  label: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  position: number;
};

type BrowserLabTocSnapshot = {
  headings: ReadonlyArray<BrowserLabTocHeadingSnapshot>;
  tocs: ReadonlyArray<{ position: number }>;
};

type BrowserLabUpdateOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: Record<string, string> | null;
  editable?: boolean;
  placeholder?: string | null;
};

type BrowserLabTestSpec = {
  alertsMessages?: Partial<{
    alertLabel: string;
    cautionKindLabel: string;
    importantKindLabel: string;
    invalidDocumentDiagnostic: string;
    noteKindLabel: string;
    tipKindLabel: string;
    toggleAlert: string;
    warningKindLabel: string;
  }>;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  editable?: boolean;
  entry?: "minimal" | "root";
  extensionMode?: "alerts" | "footnotes" | "frontmatter" | "html" | "math" | "public-example" | "toc";
  footnotesMessages?: Partial<Record<
    | "backReferenceLabel"
    | "backReferenceText"
    | "definitionLabel"
    | "definitionSourceLabel"
    | "definitionText"
    | "duplicateDefinitionDiagnostic"
    | "duplicateDefinitionLabel"
    | "invalidDocumentDiagnostic"
    | "invalidReferenceContextDiagnostic"
    | "nestedDefinitionDiagnostic"
    | "referenceLabel"
    | "referenceSourceLabel"
    | "referenceText"
    | "referencesLabel"
    | "unresolvedReferenceDiagnostic"
    | "unresolvedReferenceLabel",
    string
  >>;
  frontmatterMessages?: Partial<{
    aliasLimitDiagnostic: string;
    customTagDiagnostic: string;
    documentInvariantDiagnostic: string;
    editSource: string;
    insertFrontmatter: string;
    invalidStructureDiagnostic: string;
    kindLabel: string;
    nestingLimitDiagnostic: string;
    sourceLabel: string;
    sourceTooLargeDiagnostic: string;
    tabIndentationDiagnostic: string;
    unbalancedFlowDiagnostic: string;
  }>;
  htmlMessages?: Partial<Record<
    | "blockKindLabel"
    | "commentKindLabel"
    | "editSource"
    | "inlineKindLabel"
    | "invalidDocumentDiagnostic"
    | "invalidRendererOutputDiagnostic"
    | "invalidSourceDiagnostic"
    | "previewFailed"
    | "previewLabel"
    | "previewLoading"
    | "rendererFailedDiagnostic"
    | "rendererUnavailable"
    | "renderOutputLimitDiagnostic"
    | "retryPreview"
    | "showPreview"
    | "showSource"
    | "sourceLabel"
    | "sourceTooLargeDiagnostic"
    | "unsafeRendererOutputDiagnostic",
    string
  >>;
  htmlRendererMode?:
    | "connected"
    | "deferred"
    | "missing"
    | "reject"
    | "string"
    | "sync"
    | "throw"
    | "unsafe"
    | "wrong-document";
  id: string;
  initialSelection?: BrowserLabSelectionTarget;
  language?: string;
  markdown?: string;
  mathMessages?: Partial<Record<
    | "blockKindLabel"
    | "blockSourceLabel"
    | "editSource"
    | "inlineKindLabel"
    | "inlineSourceLabel"
    | "invalidBlockSourceDiagnostic"
    | "invalidDocumentDiagnostic"
    | "invalidInlineSourceDiagnostic"
    | "invalidRendererOutputDiagnostic"
    | "previewFailed"
    | "previewLabel"
    | "previewLoading"
    | "rendererFailedDiagnostic"
    | "rendererUnavailable"
    | "renderOutputLimitDiagnostic"
    | "retryPreview"
    | "showPreview"
    | "showSource"
    | "sourceTooLargeDiagnostic"
    | "unsafeRendererOutputDiagnostic",
    string
  >>;
  mathRendererMode?:
    | "connected"
    | "deferred"
    | "missing"
    | "reject"
    | "sync"
    | "throw"
    | "unsafe"
    | "wrong-document";
  messages?: {
    codeBlockEditorLabel?: string;
    codeBlockPlainTextLabel?: string;
    imageBlockedByPolicy?: string;
    imageFailedToLoad?: string;
    imageLoading?: string;
    imageMissingUrl?: string;
    opaqueEditSource?: string;
    opaqueKindLabels?: Partial<Record<
      | "display-math"
      | "directive-container"
      | "directive-leaf"
      | "frontmatter"
      | "html-block"
      | "html-comment"
      | "inline-directive"
      | "inline-html"
      | "unknown-fence",
      string
    >>;
    taskFallbackLabel?: string;
    uploadedFileLabel?: string;
  };
  motion?: "reduce";
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: "body" | "default" | "local" | "positioned" | "transformed";
  root?: "document" | "shadow";
  resourceMode?: "custom-protocol" | "deny-images" | "immediate-upload" | "proxy-images";
  shortcuts?: Record<string, false | string | readonly string[]>;
  typing?: {
    autoPairs?: readonly ("braces" | "double-quotes" | "emphasis-asterisks" | "emphasis-underscores" | "inline-code" | "parentheses" | "single-quotes" | "square-brackets" | "strikethrough" | "strong-asterisks" | "strong-underscores")[];
    wrapSelection?: boolean;
  };
  theme?: "auto" | "contrast" | "dark" | "light";
  tocMessages?: Partial<Record<
    | "emptyState"
    | "goToHeadingLabel"
    | "insertToc"
    | "invalidPlacementDiagnostic"
    | "navigationLabel"
    | "removeToc"
    | "untitledHeadingLabel",
    string
  >>;
  uiMessages?: {
    cancelButtonLabel?: string;
    codeBlockLanguageDialogLabel?: string;
    codeBlockLanguageInputLabel?: string;
    codeBlockLanguageInputPlaceholder?: string;
    codeBlockLanguageStaleError?: string;
    imageAltInputLabel?: string;
    imageAltInputPlaceholder?: string;
    imageDialogLabel?: string;
    imageTitleInputLabel?: string;
    imageTitleInputPlaceholder?: string;
    imageUrlInputLabel?: string;
    imageUrlInputPlaceholder?: string;
    imageUrlInvalidError?: string;
    linkDialogLabel?: string;
    linkUrlInputLabel?: string;
    linkUrlInputPlaceholder?: string;
    linkUrlInvalidError?: string;
    removeButtonLabel?: string;
    saveButtonLabel?: string;
    tableColumnsInputLabel?: string;
    tableRowsInputLabel?: string;
    tableToolbarLabel?: string;
    unlinkButtonLabel?: string;
  };
};

type BrowserLabResourceLog = {
  loads: Array<{ storedUrl: string; url: string }>;
  opens: Array<{ kind: "image" | "link"; storedUrl: string; url: string }>;
  resolutions: Array<{ kind: "image" | "link"; purpose: "load" | "open"; url: string }>;
  uploads: Array<{ fileName: string; source: "drop" | "paste" }>;
};

type BrowserLabTestSnapshot = {
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
  selection: { anchor: number; from: number; head: number; to: number };
  transactionCount: number;
};

type BrowserLabExtensionSnapshot = {
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

type BrowserLabFrontmatterCommandRequest =
  | { type: "insert"; source?: string }
  | { type: "remove" }
  | { type: "update"; source: string };

type BrowserLabFrontmatterSnapshot = {
  diagnostics: ReadonlyArray<{
    code:
      | "alias-limit"
      | "custom-tag"
      | "invalid-structure"
      | "nesting-limit"
      | "source-too-large"
      | "tab-indentation"
      | "unbalanced-flow";
    message: string;
    severity: "error" | "warning";
  }>;
  source: string;
};

type BrowserLabFootnoteDefinitionTarget = {
  label: string;
  occurrence?: number;
};

type BrowserLabFootnotesCommandRequest =
  | { type: "insertDefinition" | "insertReference"; label: string }
  | { type: "navigateToDefinition" | "navigateToReference"; label: string; occurrence?: number }
  | {
      type: "removeDefinition";
      target: BrowserLabFootnoteDefinitionTarget;
      references: "preserve" | "remove";
    }
  | {
      type: "renameDefinition";
      target: BrowserLabFootnoteDefinitionTarget;
      nextLabel: string;
      references: "preserve" | "rename";
    };

type BrowserLabFootnoteSelectionRequest = {
  content?: { from?: number; to?: number };
  kind: "definition" | "reference";
  label: string;
  occurrence?: number;
};

type BrowserLabFootnotesSnapshot = {
  definitions: ReadonlyArray<{
    duplicate: boolean;
    label: string;
    number: number;
    occurrence: number;
    position: number;
    referencePositions: readonly number[];
  }>;
  diagnostics: ReadonlyArray<{
    code: "duplicate-definition" | "unresolved-reference";
    label: string;
    message: string;
    occurrence: number;
    position: number;
  }>;
  references: ReadonlyArray<{
    definitionPosition: number | null;
    label: string;
    number: number;
    occurrence: number;
    position: number;
  }>;
};

type BrowserLabHtmlDisplay = "block" | "inline";
type BrowserLabHtmlKind = "html-block" | "html-comment" | "inline-html";

type BrowserLabHtmlNodeTarget = {
  display: BrowserLabHtmlDisplay;
  identity: number;
  kind: BrowserLabHtmlKind;
  position: number;
  source: string;
};

type BrowserLabHtmlRenderErrorCode =
  | "connected-output"
  | "invalid-output"
  | "node-limit"
  | "output-byte-limit"
  | "renderer-failed"
  | "renderer-missing"
  | "unsafe-output"
  | "wrong-document";

type BrowserLabHtmlRenderSnapshot = {
  enabled: boolean;
  errorCode: BrowserLabHtmlRenderErrorCode | null;
  status:
    | "error"
    | "offscreen"
    | "queued"
    | "rendered"
    | "rendering"
    | "source"
    | "source-too-large";
};

type BrowserLabHtmlSnapshot = {
  diagnostics: ReadonlyArray<{
    code: "source-too-large";
    display: BrowserLabHtmlDisplay;
    kind: BrowserLabHtmlKind;
    message: string;
    position: number;
  }>;
  nodes: ReadonlyArray<BrowserLabHtmlNodeTarget & {
    render: BrowserLabHtmlRenderSnapshot;
  }>;
};

type BrowserLabHtmlCommandRequest =
  | { source: string; target: BrowserLabHtmlNodeTarget; type: "update" }
  | {
      target: BrowserLabHtmlNodeTarget;
      type: "remove" | "retryPreview" | "togglePreview";
    };

type BrowserLabHtmlRendererCall = {
  aborted: boolean;
  id: number;
  kind: "html-block";
  settled: "pending" | "rejected" | "resolved" | "threw";
  source: string;
};

type BrowserLabMathKind = "block" | "inline";

type BrowserLabMathNodeTarget = {
  identity: number;
  kind: BrowserLabMathKind;
  position: number;
  source: string;
};

type BrowserLabMathRenderErrorCode =
  | "connected-output"
  | "invalid-output"
  | "node-limit"
  | "output-byte-limit"
  | "renderer-failed"
  | "renderer-missing"
  | "unsafe-output"
  | "wrong-document";

type BrowserLabMathRenderSnapshot = {
  enabled: boolean;
  errorCode: BrowserLabMathRenderErrorCode | null;
  status:
    | "error"
    | "offscreen"
    | "queued"
    | "rendered"
    | "rendering"
    | "source"
    | "source-too-large";
};

type BrowserLabMathSnapshot = {
  diagnostics: ReadonlyArray<{
    code: "source-too-large";
    kind: BrowserLabMathKind;
    message: string;
    position: number;
  }>;
  nodes: ReadonlyArray<BrowserLabMathNodeTarget & {
    render: BrowserLabMathRenderSnapshot;
  }>;
};

type BrowserLabMathCommandRequest =
  | { kind: BrowserLabMathKind; target: BrowserLabMathNodeTarget; type: "convert" }
  | { source: string; type: "insertBlock" | "insertInline" }
  | { source: string; target: BrowserLabMathNodeTarget; type: "update" }
  | {
      target: BrowserLabMathNodeTarget;
      type: "remove" | "retryPreview" | "togglePreview";
    };

type BrowserLabMathRendererCall = {
  aborted: boolean;
  id: number;
  kind: BrowserLabMathKind;
  settled: "pending" | "rejected" | "resolved" | "threw";
  source: string;
};

interface Window {
  __MARKORA_BROWSER_LAB__?: {
    active(id: string, request: BrowserLabActiveRequest): boolean;
    alertsCommand(id: string, request: BrowserLabAlertsCommandRequest): boolean;
    alertsSnapshot(id: string): BrowserLabAlertsSnapshot;
    alertsState(id: string, request: BrowserLabAlertsStateRequest): boolean;
    blur(id: string): void;
    can(id: string, request: BrowserLabCommandRequest): boolean;
    clearEvents(id: string): void;
    command(id: string, request: BrowserLabCommandRequest): boolean;
    copySelection(id: string): {
      defaultPrevented: boolean;
      html: string;
      markdown: string;
      plain: string;
      types: string[];
    };
    destroy(id: string): boolean;
    destroyEditor(id: string): boolean;
    destroyAll(): void;
    dispatchTransfer(id: string, spec: {
      event: "dragover" | "drop" | "paste";
      files?: Array<{ contents: string; name: string; type: string }>;
      html?: string;
      markdown?: string;
      plain?: string;
      target?: "code-mirror" | "prosemirror" | "static-code";
    }): { defaultPrevented: boolean; fileCount: number; types: string[] };
    dispatchViewportEvent(type: "resize" | "scroll"): void;
    events(id: string): {
      counts: Record<BrowserLabEventName, number>;
      log: BrowserLabEventRecord[];
    };
    extensionSnapshot(id: string): BrowserLabExtensionSnapshot;
    frontmatterCommand(id: string, request: BrowserLabFrontmatterCommandRequest): boolean;
    frontmatterEditRemove(id: string): boolean;
    frontmatterEditUpdate(id: string, source: string): boolean;
    frontmatterSnapshot(id: string): BrowserLabFrontmatterSnapshot | null;
    footnotesCommand(id: string, request: BrowserLabFootnotesCommandRequest): boolean;
    footnotesSnapshot(id: string): BrowserLabFootnotesSnapshot;
    focus(id: string, selection?: BrowserLabSelectionTarget): void;
    getMarkdown(id: string): string;
    htmlCommand(id: string, request: BrowserLabHtmlCommandRequest): boolean;
    htmlEditRemove(id: string): boolean;
    htmlEditUpdate(id: string, source: string): boolean;
    htmlRendererCalls(id: string): ReadonlyArray<BrowserLabHtmlRendererCall>;
    htmlRendererSettle(
      id: string,
      settlement?: { callId?: number; outcome?: "reject" | "resolve" },
    ): boolean;
    htmlSnapshot(id: string): BrowserLabHtmlSnapshot;
    isDestroyed(id: string): boolean;
    listenerSnapshot(id?: string): { total: number; byTargetAndType: Record<string, number> };
    mathCommand(id: string, request: BrowserLabMathCommandRequest): boolean;
    mathEditConvert(id: string, kind: BrowserLabMathKind): boolean;
    mathEditRemove(id: string): boolean;
    mathEditUpdate(id: string, source: string): boolean;
    mathRendererCalls(id: string): ReadonlyArray<BrowserLabMathRendererCall>;
    mathRendererSettle(
      id: string,
      settlement?: { callId?: number; outcome?: "reject" | "resolve" },
    ): boolean;
    mathSnapshot(id: string): BrowserLabMathSnapshot;
    mount(spec: BrowserLabTestSpec): BrowserLabTestSnapshot;
    mountedIds(): string[];
    openUi(id: string, kind: "code-language" | "image" | "link" | "table" | "table-create"): boolean;
    pendingOpaqueEdit(id: string): { kind: string; source: string } | null;
    pendingFrontmatterEdit(id: string): Pick<BrowserLabFrontmatterSnapshot, "diagnostics" | "source"> | null;
    pendingHtmlEdit(id: string): (BrowserLabHtmlNodeTarget & {
      render: BrowserLabHtmlRenderSnapshot;
    }) | null;
    pendingMathEdit(id: string): ({
      kind: BrowserLabMathKind;
      position: number;
      render: BrowserLabMathRenderSnapshot;
      source: string;
    }) | null;
    ready: true;
    reconcile(
      id: string,
      markdown: string,
      options?: { emitChange?: boolean },
    ): { changed: boolean; snapshot: BrowserLabTestSnapshot };
    remount(
      id: string,
      options?: Omit<BrowserLabTestSpec, "direction" | "id" | "placement" | "portal" | "root">,
    ): BrowserLabTestSnapshot;
    resourceLog(id: string): BrowserLabResourceLog;
    reset(id: string, markdown: string): string;
    selectFootnote(id: string, request: BrowserLabFootnoteSelectionRequest): boolean;
    selectHtml(id: string, target: BrowserLabHtmlNodeTarget): boolean;
    selectMath(id: string, target: BrowserLabMathNodeTarget): boolean;
    selectToc(id: string, occurrence?: number): boolean;
    selectText(id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number): boolean;
    settle(id?: string): Promise<void>;
    snapshot(id: string): BrowserLabTestSnapshot;
    tableIssues(id: string): ReadonlyArray<{
      code: "merged-cell" | "missing-column-header" | "multi-block-cell" | "ragged-row" | "row-header-scope";
      column: number | null;
      message: string;
      row: number;
      tablePos: number;
    }>;
    tocCommand(id: string, request: BrowserLabTocCommandRequest): boolean;
    tocSnapshot(id: string): BrowserLabTocSnapshot;
    tocState(id: string, request: BrowserLabTocStateRequest): boolean;
    unsubscribe(id: string, type: BrowserLabEventName): boolean;
    updateOpaque(id: string, source: string): boolean;
    updateOptions(id: string, options: BrowserLabUpdateOptions): {
      snapshot: BrowserLabTestSnapshot;
      statePreserved: boolean;
    };
  };
}
