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
  kind: "all" | "managed-block" | "node" | "other" | "text";
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
  | "addTableColumn"
  | "addTableRow"
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
  | { type: "insertImage"; attrs: { alt?: string | null; src: string; title?: string | null } }
  | { type: "insertTable"; options?: { columns?: number; rows?: number } }
  | { type: "setCodeBlock"; options?: { language?: string | null } }
  | { type: "setHeading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "setLink"; href: string }
  | { type: "setTableColumnAlignment"; alignment: "center" | "left" | "right" | null }
  | { type: "setTaskChecked"; checked: boolean }
  | { type: "toggleMark"; mark: "code" | "em" | "strike" | "strong" };

type BrowserLabActiveRequest =
  | { type: "blockquote" | "bulletList" | "hardBreak" | "horizontalRule" | "orderedList" | "paragraph" | "table" | "taskList" }
  | { type: "codeBlock"; options?: { language?: string | null } }
  | { type: "heading"; level?: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "tableColumnAlignment"; alignment: "center" | "left" | "right" | null }
  | { type: "taskChecked"; checked?: boolean };

type BrowserLabUpdateOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: Record<string, string> | null;
  editable?: boolean;
  placeholder?: string | null;
};

type BrowserLabTestSpec = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  editable?: boolean;
  extensionMode?: "public-example";
  id: string;
  initialSelection?: BrowserLabSelectionTarget;
  markdown?: string;
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: "body" | "default" | "local" | "positioned" | "transformed";
  root?: "document" | "shadow";
  resourceMode?: "custom-protocol" | "deny-images" | "immediate-upload" | "proxy-images";
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

interface Window {
  __MARKORA_BROWSER_LAB__?: {
    active(id: string, request: BrowserLabActiveRequest): boolean;
    blur(id: string): void;
    can(id: string, request: BrowserLabCommandRequest): boolean;
    clearEvents(id: string): void;
    command(id: string, request: BrowserLabCommandRequest): boolean;
    copySelection(id: string): { defaultPrevented: boolean; html: string; plain: string };
    destroy(id: string): boolean;
    destroyEditor(id: string): boolean;
    destroyAll(): void;
    dispatchTransfer(id: string, spec: {
      event: "dragover" | "drop" | "paste";
      files?: Array<{ contents: string; name: string; type: string }>;
      html?: string;
      markdown?: string;
      plain?: string;
      target?: "code-mirror" | "prosemirror";
    }): { defaultPrevented: boolean; fileCount: number; types: string[] };
    dispatchViewportEvent(type: "resize" | "scroll"): void;
    events(id: string): {
      counts: Record<BrowserLabEventName, number>;
      log: BrowserLabEventRecord[];
    };
    extensionSnapshot(id: string): BrowserLabExtensionSnapshot;
    focus(id: string, selection?: BrowserLabSelectionTarget): void;
    getMarkdown(id: string): string;
    isDestroyed(id: string): boolean;
    listenerSnapshot(id?: string): { total: number; byTargetAndType: Record<string, number> };
    mount(spec: BrowserLabTestSpec): BrowserLabTestSnapshot;
    mountedIds(): string[];
    openUi(id: string, kind: "image" | "link"): boolean;
    pendingOpaqueEdit(id: string): { kind: string; source: string } | null;
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
    selectText(id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number): boolean;
    settle(id?: string): Promise<void>;
    snapshot(id: string): BrowserLabTestSnapshot;
    unsubscribe(id: string, type: BrowserLabEventName): boolean;
    updateOpaque(id: string, source: string): boolean;
    updateOptions(id: string, options: BrowserLabUpdateOptions): {
      snapshot: BrowserLabTestSnapshot;
      statePreserved: boolean;
    };
  };
}
