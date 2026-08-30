import {
  createEditor,
  type MarkdownEditor,
  type MarkdownEditorCodeBlockOptions,
  type MarkdownEditorEventName,
  type MarkdownEditorHeadingLevel,
  type MarkdownEditorMark,
  type MarkdownEditorMessageOverrides,
  type MarkdownEditorSelectionSnapshot,
  type MarkdownEditorSelectionTarget,
  type MarkdownEditorShortcutMap,
  type MarkdownEditorTableAlignment,
  type MarkdownEditorTableColumnMoveDirection,
  type MarkdownEditorTableInsertOptions,
  type MarkdownEditorTableInsertSide,
  type MarkdownEditorTableIssue,
  type MarkdownEditorTableResizeOptions,
  type MarkdownEditorTableRowMoveDirection,
  type MarkdownEditorTypingOptions,
  type OpaqueMarkdownEditRequest,
  type UpdateEditorOptions,
} from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { NodeSelection, TextSelection, type Selection } from "markora/extension-api";
import {
  createDiagramsExtension,
  defaultDiagramMessages,
  type DiagramEditRequest,
  type DiagramKind,
  type DiagramMessageOverrides,
  type DiagramMessages,
  type DiagramNodeTarget,
  type DiagramRenderer,
  type DiagramRenderRequest,
  type DiagramsExtension,
  type DiagramsSnapshot,
} from "markora-extension-diagrams";
import "markora-extension-diagrams/styles.css";
import {
  createAlertsExtension,
  defaultAlertsMessages,
  type AlertKind,
  type AlertSnapshot,
  type AlertsExtension,
  type AlertsMessageOverrides,
  type AlertsMessages,
} from "markora-extension-alerts";
import "markora-extension-alerts/styles.css";
import {
  createFrontmatterExtension,
  type FrontmatterEditRequest,
  type FrontmatterExtension,
  type FrontmatterMessageOverrides,
  type FrontmatterSnapshot,
} from "markora-extension-frontmatter";
import "markora-extension-frontmatter/styles.css";
import {
  createHtmlExtension,
  defaultHtmlMessages,
  type HtmlEditRequest,
  type HtmlExtension,
  type HtmlMessageOverrides,
  type HtmlMessages,
  type HtmlNodeTarget,
  type HtmlRenderRequest,
  type HtmlSnapshot,
} from "markora-extension-html";
import "markora-extension-html/styles.css";
import {
  createFootnotesExtension,
  type FootnoteDefinitionTarget,
  type FootnotesExtension,
  type FootnotesMessageOverrides,
  type FootnotesSnapshot,
} from "markora-extension-footnotes";
import "markora-extension-footnotes/styles.css";
import {
  createMathExtension,
  defaultMathMessages,
  type MathEditRequest,
  type MathExtension,
  type MathKind,
  type MathMessageOverrides,
  type MathMessages,
  type MathNodeTarget,
  type MathRenderRequest,
  type MathSnapshot,
} from "markora-extension-math";
import "markora-extension-math/styles.css";
import {
  createTocExtension,
  defaultTocMessages,
  type TocExtension,
  type TocMessageOverrides,
  type TocMessages,
  type TocSnapshot,
} from "markora-extension-toc";
import "markora-extension-toc/styles.css";
import { createDefaultUi, type DefaultUiMessageOverrides } from "markora-ui";
import { useEffect, useRef } from "react";
import { createGlobalListenerLedger, type ListenerSnapshot } from "../browser-lab/listenerLedger";
import {
  publicCalloutExtension,
  publicExampleExtensions,
} from "../extensions/publicExampleExtensions";

export type BrowserLabRoot = "document" | "shadow";
export type BrowserLabPortal = "body" | "default" | "local" | "positioned" | "transformed";
export type BrowserLabFootnotesMessages = Partial<
  Record<keyof FootnotesMessageOverrides, string>
>;
export type BrowserLabAlertsMessages = Partial<Record<keyof AlertsMessages, string>>;
export type BrowserLabDiagramMessages = Partial<Record<keyof DiagramMessages, string>>;
export type BrowserLabHtmlMessages = Partial<Record<keyof HtmlMessages, string>>;
export type BrowserLabMathMessages = Partial<Record<keyof MathMessages, string>>;
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
export type BrowserLabDiagramRendererMode = BrowserLabHtmlRendererMode | "unsafe-css-var";
export type BrowserLabMathRendererMode =
  | "connected"
  | "deferred"
  | "missing"
  | "reject"
  | "sync"
  | "throw"
  | "unsafe"
  | "wrong-document";

const BROWSER_LAB_DIAGRAM_KINDS = ["mermaid", "geojson", "topojson", "stl"] as const;

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
  | { patch: Readonly<{ info?: string; source?: string }>; target: DiagramNodeTarget; type: "update" }
  | {
      target: DiagramNodeTarget;
      type: "remove" | "restoreCodeBlock" | "retryPreview" | "togglePreview";
    };

export type BrowserLabEditorSpec = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  diagramMessages?: BrowserLabDiagramMessages;
  diagramRendererModes?: Partial<Record<DiagramKind, BrowserLabDiagramRendererMode>>;
  editable?: boolean;
  entry?: "minimal" | "root";
  extensionMode?: "alerts" | "all-advanced" | "diagrams" | "footnotes" | "frontmatter" | "html" | "math" | "public-example" | "toc";
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
  messages?: MarkdownEditorMessageOverrides;
  motion?: "reduce";
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: BrowserLabPortal;
  root?: BrowserLabRoot;
  resourceMode?: "custom-protocol" | "deny-images" | "immediate-upload" | "proxy-images";
  shortcuts?: MarkdownEditorShortcutMap;
  typing?: MarkdownEditorTypingOptions;
  theme?: "auto" | "contrast" | "dark" | "light";
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
  | { type: "addTableColumn" | "addTableRow"; side?: MarkdownEditorTableInsertSide }
  | { type: "insertImage"; attrs: { alt?: string | null; src: string; title?: string | null } }
  | { type: "insertTable"; options?: MarkdownEditorTableInsertOptions }
  | { type: "moveTableColumn"; direction: MarkdownEditorTableColumnMoveDirection }
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
  | { type: "blockquote" | "bulletList" | "hardBreak" | "horizontalRule" | "orderedList" | "paragraph" | "table" | "tableCellSelection" | "taskList" }
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
  | { type: "navigateToDefinition" | "navigateToReference"; label: string; occurrence?: number }
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
  | { target: MathNodeTarget; type: "remove" | "retryPreview" | "togglePreview" };

export type BrowserLabHtmlCommandRequest =
  | { source: string; target: HtmlNodeTarget; type: "update" }
  | { target: HtmlNodeTarget; type: "remove" | "retryPreview" | "togglePreview" };

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
  resolutions: Array<{ kind: "image" | "link"; purpose: "load" | "open"; url: string }>;
  uploads: Array<{ fileName: string; source: "drop" | "paste" }>;
};

export type BrowserLabApi = {
  alertsCommand: (id: string, request: BrowserLabAlertsCommandRequest) => boolean;
  alertsSnapshot: (id: string) => BrowserLabAlertsSnapshot;
  alertsState: (id: string, request: BrowserLabAlertsStateRequest) => boolean;
  blur: (id: string) => void;
  clearEvents: (id: string) => void;
  active: (id: string, request: BrowserLabActiveRequest) => boolean;
  can: (id: string, request: BrowserLabCommandRequest) => boolean;
  command: (id: string, request: BrowserLabCommandRequest) => boolean;
  copySelection: (id: string) => BrowserLabCopyResult;
  diagramCommand: (id: string, request: BrowserLabDiagramCommandRequest) => boolean;
  diagramEditConvert: (id: string, kind: DiagramKind) => boolean;
  diagramEditRemove: (id: string) => boolean;
  diagramEditRestoreCodeBlock: (id: string) => boolean;
  diagramEditUpdate: (
    id: string,
    patch: Readonly<{ info?: string; source?: string }>,
  ) => boolean;
  diagramRendererCalls: (id: string) => readonly BrowserLabDiagramRendererCall[];
  diagramRendererSettle: (
    id: string,
    settlement?: BrowserLabDiagramRendererSettlement,
  ) => boolean;
  diagramSnapshot: (id: string) => DiagramsSnapshot;
  destroy: (id: string) => boolean;
  destroyEditor: (id: string) => boolean;
  destroyAll: () => void;
  dispatchTransfer: (id: string, spec: BrowserLabTransferSpec) => BrowserLabTransferResult;
  dispatchViewportEvent: (type: "resize" | "scroll") => void;
  events: (id: string) => BrowserLabEventSnapshot;
  extensionSnapshot: (id: string) => BrowserLabExtensionSnapshot;
  frontmatterCommand: (id: string, request: BrowserLabFrontmatterCommandRequest) => boolean;
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
  footnotesCommand: (id: string, request: BrowserLabFootnotesCommandRequest) => boolean;
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
  openUi: (id: string, kind: "code-language" | "image" | "link" | "table" | "table-create") => boolean;
  pendingOpaqueEdit: (id: string) => Pick<OpaqueMarkdownEditRequest, "kind" | "source"> | null;
  pendingFrontmatterEdit: (id: string) => Pick<
    FrontmatterEditRequest,
    "diagnostics" | "source"
  > | null;
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
    options?: Omit<BrowserLabEditorSpec, "direction" | "entry" | "id" | "placement" | "portal" | "root">,
  ) => BrowserLabSnapshot;
  resourceLog: (id: string) => BrowserLabResourceLog;
  reset: (id: string, markdown: string) => string;
  selectFootnote: (id: string, request: BrowserLabFootnoteSelectionRequest) => boolean;
  selectDiagram: (id: string, target: DiagramNodeTarget) => boolean;
  selectHtml: (id: string, target: HtmlNodeTarget) => boolean;
  selectMath: (id: string, target: MathNodeTarget) => boolean;
  selectToc: (id: string, occurrence?: number) => boolean;
  selectText: (id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number) => boolean;
  settle: (id?: string) => Promise<void>;
  snapshot: (id: string) => BrowserLabSnapshot;
  tableIssues: (id: string) => readonly MarkdownEditorTableIssue[];
  tocCommand: (id: string, request: BrowserLabTocCommandRequest) => boolean;
  tocSnapshot: (id: string) => TocSnapshot;
  tocState: (id: string, request: BrowserLabTocStateRequest) => boolean;
  unsubscribe: (id: string, type: MarkdownEditorEventName) => boolean;
  updateOpaque: (id: string, source: string) => boolean;
  updateOptions: (id: string, options: BrowserLabUpdateOptions) => BrowserLabUpdateResult;
};

declare global {
  interface Window {
    __MARKORA_BROWSER_LAB__?: BrowserLabApi;
  }
}

type MountedEditor = {
  activationObserver: MutationObserver;
  alertsExtension: AlertsExtension | null;
  changeCount: number;
  controlledEcho: boolean;
  diagramEditRequest: DiagramEditRequest | null;
  diagramExtension: DiagramsExtension | null;
  diagramRendererArtifacts: Set<Node>;
  diagramRendererCalls: Array<{
    aborted: boolean;
    id: number;
    info: string;
    kind: DiagramKind;
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  diagramRendererDeferred: Map<number, {
    reject(reason: unknown): void;
    request: DiagramRenderRequest;
    resolve(value: Node | DocumentFragment): void;
  }>;
  editor: MarkdownEditor;
  entry: "minimal" | "root";
  eventCounts: Record<MarkdownEditorEventName, number>;
  eventLog: BrowserLabEventRecord[];
  eventUnsubscribes: Map<MarkdownEditorEventName, () => void>;
  extensionActions?: HTMLElement;
  extensionMode?: "alerts" | "all-advanced" | "diagrams" | "footnotes" | "frontmatter" | "html" | "math" | "public-example" | "toc";
  footnotesExtension: FootnotesExtension | null;
  frontmatterEditRequest: FrontmatterEditRequest | null;
  frontmatterExtension: FrontmatterExtension | null;
  htmlEditRequest: HtmlEditRequest | null;
  htmlExtension: HtmlExtension | null;
  htmlRendererArtifacts: Set<Node>;
  htmlRendererCalls: Array<{
    aborted: boolean;
    id: number;
    kind: HtmlRenderRequest["kind"];
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  htmlRendererDeferred: Map<number, {
    reject(reason: unknown): void;
    request: HtmlRenderRequest;
    resolve(value: Node | DocumentFragment): void;
  }>;
  explicitPortalRoot?: HTMLElement | ShadowRoot;
  host: HTMLElement;
  id: string;
  mathEditRequest: MathEditRequest | null;
  mathExtension: MathExtension | null;
  mathRendererArtifacts: Set<Node>;
  mathRendererCalls: Array<{
    aborted: boolean;
    id: number;
    kind: MathKind;
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  mathRendererDeferred: Map<number, {
    reject(reason: unknown): void;
    request: MathRenderRequest;
    resolve(value: Node | DocumentFragment): void;
  }>;
  output: HTMLOutputElement;
  opaqueEditRequest: OpaqueMarkdownEditRequest | null;
  portalRoot: HTMLElement | ShadowRoot;
  root: Document | ShadowRoot;
  resourceLog: BrowserLabResourceLog;
  section: HTMLElement;
  tocExtension: TocExtension | null;
  transactionCount: number;
};

const OVERLAY_SELECTOR = ".mdw-link-editor, .mdw-image-editor, .mdw-code-language-editor, .mdw-table-size-editor, .mdw-table-toolbar";
const EVENT_NAMES: MarkdownEditorEventName[] = ["focus", "blur", "selection", "state", "update", "error", "asset"];

function createEventCounts(): Record<MarkdownEditorEventName, number> {
  return {
    asset: 0,
    blur: 0,
    error: 0,
    focus: 0,
    selection: 0,
    state: 0,
    update: 0,
  };
}

function createResourceLog(): BrowserLabResourceLog {
  return { loads: [], opens: [], resolutions: [], uploads: [] };
}

function createBrowserLabResources(
  mounted: MountedEditor,
  mode: BrowserLabEditorSpec["resourceMode"],
) {
  if (!mode) {
    return undefined;
  }

  if (mode === "immediate-upload") {
    return {
      assets: {
        allowedMimeTypes: ["*/*"],
        upload({ file, reportProgress, source }: Parameters<NonNullable<NonNullable<Parameters<typeof createEditor>[0]["resources"]>["assets"]>["upload"]>[0]) {
          mounted.resourceLog.uploads.push({ fileName: file.name, source });
          reportProgress(0.5);
          return Promise.resolve({
            kind: "link" as const,
            label: file.name,
            url: `/uploads/${encodeURIComponent(file.name)}`,
          });
        },
      },
    };
  }

  return {
    ...(mode === "custom-protocol" ? {
      images: { allowedProtocols: ["asset:"] },
      links: { allowedProtocols: ["acme:"] },
    } : {}),
    images: mode === "custom-protocol"
      ? { allowedProtocols: ["asset:"] }
      : { referrerPolicy: "no-referrer" as const },
    links: mode === "custom-protocol"
      ? { allowedProtocols: ["acme:"] }
      : undefined,
    loadImage: mode === "proxy-images"
      ? ({ storedUrl, url }: { storedUrl: string; url: string }) => {
          mounted.resourceLog.loads.push({ storedUrl, url });
          return { src: url };
        }
      : undefined,
    openUrl({ kind, storedUrl, url }: { kind: "image" | "link"; storedUrl: string; url: string }) {
      mounted.resourceLog.opens.push({ kind, storedUrl, url });
    },
    resolveUrl({ kind, purpose, url }: { kind: "image" | "link"; purpose: "load" | "open"; url: string }) {
      mounted.resourceLog.resolutions.push({ kind, purpose, url });
      if (mode === "deny-images" && kind === "image") {
        return null;
      }
      if (mode === "proxy-images" && kind === "image" && purpose === "load") {
        return "/__markora_resource_proxy.png";
      }
      return url;
    },
  };
}

function clearEventTracking(mounted: MountedEditor) {
  mounted.eventCounts = createEventCounts();
  mounted.eventLog.length = 0;
}

function recordEvent(mounted: MountedEditor, event: BrowserLabEventRecord) {
  mounted.eventCounts[event.type] += 1;
  mounted.eventLog.push(event);
}

function runBrowserLabCommand(editor: MarkdownEditor, request: BrowserLabCommandRequest) {
  switch (request.type) {
    case "addTableColumn": return editor.commands.addTableColumn(request.side);
    case "addTableRow": return editor.commands.addTableRow(request.side);
    case "deleteTable": return editor.commands.deleteTable();
    case "deleteTableColumn": return editor.commands.deleteTableColumn();
    case "deleteTableRow": return editor.commands.deleteTableRow();
    case "insertHardBreak": return editor.commands.insertHardBreak();
    case "insertHorizontalRule": return editor.commands.insertHorizontalRule();
    case "insertImage": return editor.commands.insertImage(request.attrs);
    case "insertTable": return editor.commands.insertTable(request.options);
    case "liftListItem": return editor.commands.liftListItem();
    case "moveTableColumn": return editor.commands.moveTableColumn(request.direction);
    case "moveTableRow": return editor.commands.moveTableRow(request.direction);
    case "pasteMarkdown": return editor.commands.pasteMarkdown(request.text);
    case "pastePlainText": return editor.commands.pastePlainText(request.text);
    case "redo": return editor.commands.redo();
    case "removeImage": return editor.commands.removeImage();
    case "removeLink": return editor.commands.removeLink();
    case "resizeTable": return editor.commands.resizeTable(request.options);
    case "setCodeBlock": return editor.commands.setCodeBlock(request.options);
    case "setHeading": return editor.commands.setHeading(request.level);
    case "setLink": return editor.commands.setLink(request.href);
    case "setParagraph": return editor.commands.setParagraph();
    case "setTableColumnAlignment": return editor.commands.setTableColumnAlignment(request.alignment);
    case "setTaskChecked": return editor.commands.setTaskChecked(request.checked);
    case "sinkListItem": return editor.commands.sinkListItem();
    case "toggleBlockquote": return editor.commands.toggleBlockquote();
    case "toggleBulletList": return editor.commands.toggleBulletList();
    case "toggleMark": return editor.commands.toggleMark(request.mark);
    case "toggleOrderedList": return editor.commands.toggleOrderedList();
    case "toggleTaskList": return editor.commands.toggleTaskList();
    case "undo": return editor.commands.undo();
  }
}

function canRunBrowserLabCommand(editor: MarkdownEditor, request: BrowserLabCommandRequest) {
  switch (request.type) {
    case "addTableColumn": return editor.state.can.addTableColumn(request.side);
    case "addTableRow": return editor.state.can.addTableRow(request.side);
    case "deleteTable": return editor.state.can.deleteTable();
    case "deleteTableColumn": return editor.state.can.deleteTableColumn();
    case "deleteTableRow": return editor.state.can.deleteTableRow();
    case "insertHardBreak": return editor.state.can.insertHardBreak();
    case "insertHorizontalRule": return editor.state.can.insertHorizontalRule();
    case "insertImage": return editor.state.can.insertImage();
    case "insertTable": return editor.state.can.insertTable(request.options);
    case "liftListItem": return editor.state.can.liftListItem();
    case "moveTableColumn": return editor.state.can.moveTableColumn(request.direction);
    case "moveTableRow": return editor.state.can.moveTableRow(request.direction);
    case "pasteMarkdown": return editor.state.can.pasteMarkdown();
    case "pastePlainText": return editor.state.can.pastePlainText();
    case "redo": return editor.state.can.redo();
    case "removeImage": return editor.state.can.removeImage();
    case "removeLink": return editor.state.can.removeLink();
    case "resizeTable": return editor.state.can.resizeTable(request.options);
    case "setCodeBlock": return editor.state.can.setCodeBlock(request.options);
    case "setHeading": return editor.state.can.setHeading(request.level);
    case "setLink": return editor.state.can.setLink();
    case "setParagraph": return editor.state.can.setParagraph();
    case "setTableColumnAlignment": return editor.state.can.setTableColumnAlignment(request.alignment);
    case "setTaskChecked": return editor.state.can.setTaskChecked(request.checked);
    case "sinkListItem": return editor.state.can.sinkListItem();
    case "toggleBlockquote": return editor.state.can.toggleBlockquote();
    case "toggleBulletList": return editor.state.can.toggleBulletList();
    case "toggleMark": return editor.state.can.toggleMark(request.mark);
    case "toggleOrderedList": return editor.state.can.toggleOrderedList();
    case "toggleTaskList": return editor.state.can.toggleTaskList();
    case "undo": return editor.state.can.undo();
  }
}

function readBrowserLabActiveState(editor: MarkdownEditor, request: BrowserLabActiveRequest) {
  switch (request.type) {
    case "blockquote": return editor.state.isActive.blockquote();
    case "bulletList": return editor.state.isActive.bulletList();
    case "codeBlock": return editor.state.isActive.codeBlock(request.options);
    case "hardBreak": return editor.state.isActive.hardBreak();
    case "heading": return editor.state.isActive.heading(request.level);
    case "horizontalRule": return editor.state.isActive.horizontalRule();
    case "orderedList": return editor.state.isActive.orderedList();
    case "paragraph": return editor.state.isActive.paragraph();
    case "table": return editor.state.isActive.table();
    case "tableCellSelection": return editor.state.isActive.tableCellSelection();
    case "tableColumnAlignment": return editor.state.isActive.tableColumnAlignment(request.alignment);
    case "taskChecked": return editor.state.isActive.taskChecked(request.checked);
    case "taskList": return editor.state.isActive.taskList();
  }
}

function subscribeToEditorEvents(mounted: MountedEditor) {
  for (const unsubscribe of mounted.eventUnsubscribes.values()) {
    unsubscribe();
  }

  mounted.eventUnsubscribes.clear();
  mounted.eventUnsubscribes.set("focus", mounted.editor.subscribe("focus", () => {
    recordEvent(mounted, { type: "focus" });
  }));
  mounted.eventUnsubscribes.set("blur", mounted.editor.subscribe("blur", () => {
    recordEvent(mounted, { type: "blur" });
  }));
  mounted.eventUnsubscribes.set("selection", mounted.editor.subscribe("selection", (event) => {
    recordEvent(mounted, {
      previousSelection: event.previousSelection,
      selection: event.selection,
      type: "selection",
    });
  }));
  mounted.eventUnsubscribes.set("state", mounted.editor.subscribe("state", (event) => {
    recordEvent(mounted, {
      docChanged: event.docChanged,
      selection: event.selection,
      selectionChanged: event.selectionChanged,
      type: "state",
    });
  }));
  mounted.eventUnsubscribes.set("update", mounted.editor.subscribe("update", (event) => {
    recordEvent(mounted, {
      selection: event.selection,
      type: "update",
    });
  }));
  mounted.eventUnsubscribes.set("error", mounted.editor.subscribe("error", (event) => {
    recordEvent(mounted, {
      code: event.code,
      contribution: "contribution" in event.context ? event.context.contribution : undefined,
      extension: "extension" in event.context ? event.context.extension : undefined,
      language: "language" in event.context ? event.context.language : undefined,
      message: event.error instanceof Error ? event.error.message : String(event.error),
      phase: "phase" in event.context ? event.context.phase : undefined,
      type: "error",
    });
  }));
  mounted.eventUnsubscribes.set("asset", mounted.editor.subscribe("asset", (event) => {
    recordEvent(mounted, {
      fileName: event.upload.file.name,
      progress: event.upload.progress,
      reason: event.reason,
      status: event.upload.status,
      type: "asset",
    });
  }));
}

function requireEditor(editors: Map<string, MountedEditor>, id: string) {
  const mounted = editors.get(id);

  if (!mounted) {
    throw new Error(`Browser lab editor \"${id}\" is not mounted.`);
  }

  return mounted;
}

function requireAlertsHandle(mounted: MountedEditor) {
  if (!mounted.alertsExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no alerts extension.`);
  }

  return mounted.editor.extensions.get(mounted.alertsExtension);
}

function requireDiagramsHandle(mounted: MountedEditor) {
  if (!mounted.diagramExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no diagrams extension.`);
  }

  return mounted.editor.extensions.get(mounted.diagramExtension);
}

function requireFrontmatterHandle(mounted: MountedEditor) {
  if (!mounted.frontmatterExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no front matter extension.`);
  }

  return mounted.editor.extensions.get(mounted.frontmatterExtension);
}

function requireHtmlHandle(mounted: MountedEditor) {
  if (!mounted.htmlExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no HTML extension.`);
  }

  return mounted.editor.extensions.get(mounted.htmlExtension);
}

function requireFootnotesHandle(mounted: MountedEditor) {
  if (!mounted.footnotesExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no footnotes extension.`);
  }

  return mounted.editor.extensions.get(mounted.footnotesExtension);
}

function requireMathHandle(mounted: MountedEditor) {
  if (!mounted.mathExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no math extension.`);
  }

  return mounted.editor.extensions.get(mounted.mathExtension);
}

function requireTocHandle(mounted: MountedEditor) {
  if (!mounted.tocExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no TOC extension.`);
  }

  return mounted.editor.extensions.get(mounted.tocExtension);
}

function normalizeBrowserLabAlertsMessages(
  overrides: BrowserLabAlertsMessages | undefined,
): AlertsMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(overrides).map(([key, message]) => [
    key,
    typeof defaultAlertsMessages[key as keyof AlertsMessages] === "function"
      ? () => message
      : message,
  ])) as AlertsMessageOverrides;
}

function normalizeBrowserLabDiagramMessages(
  overrides: BrowserLabDiagramMessages | undefined,
): DiagramMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(overrides).map(([key, message]) => [
    key,
    typeof defaultDiagramMessages[key as keyof DiagramMessages] === "function"
      ? () => message
      : message,
  ])) as DiagramMessageOverrides;
}

function normalizeBrowserLabMathMessages(
  overrides: BrowserLabMathMessages | undefined,
): MathMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(overrides).map(([key, message]) => [
    key,
    typeof defaultMathMessages[key as keyof MathMessages] === "function"
      ? () => message
      : message,
  ])) as MathMessageOverrides;
}

function normalizeBrowserLabHtmlMessages(
  overrides: BrowserLabHtmlMessages | undefined,
): HtmlMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(overrides).map(([key, message]) => [
    key,
    typeof defaultHtmlMessages[key as keyof HtmlMessages] === "function"
      ? () => message
      : message,
  ])) as HtmlMessageOverrides;
}

function normalizeBrowserLabTocMessages(
  overrides: BrowserLabTocMessages | undefined,
): TocMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(overrides).map(([key, message]) => [
    key,
    typeof defaultTocMessages[key as keyof TocMessages] === "function"
      ? () => message
      : message,
  ])) as TocMessageOverrides;
}

function createBrowserLabMathOutput(request: MathRenderRequest, callId: number) {
  const output = request.ownerDocument.createElement("span");
  output.className = "browser-lab-math-rendered";
  output.textContent = `Rendered ${request.kind} math ${callId}: ${request.source}`;
  return output;
}

function createBrowserLabDiagramOutput(request: DiagramRenderRequest, callId: number) {
  const svg = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 640 40");
  const title = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = `Rendered ${request.kind} diagram ${callId}`;
  const text = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", "8");
  text.setAttribute("y", "24");
  text.textContent = `${request.info}: ${request.source}`;
  svg.append(title, text);
  return svg;
}

function clearDiagramRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.diagramRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.diagramRendererArtifacts.clear();
}

function createBrowserLabDiagramRenderer(
  mounted: MountedEditor,
  mode: BrowserLabDiagramRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (request: DiagramRenderRequest): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.diagramRendererCalls.length + 1,
      info: request.info,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.diagramRendererCalls.push(call);
    request.signal.addEventListener("abort", () => {
      call.aborted = true;
    }, { once: true });

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(`Browser lab ${request.kind} diagram renderer threw for call ${call.id}.`);
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(new Error(
        `Browser lab ${request.kind} diagram renderer rejected call ${call.id}.`,
      ));
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.diagramRendererDeferred.set(call.id, { reject, request, resolve });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument = request.ownerDocument.implementation
        .createHTMLDocument("Browser lab foreign diagram renderer");
      const output = foreignDocument.createElement("div");
      output.textContent = request.source;
      return output;
    }

    if (mode === "string") {
      return "<svg><text>renderer strings are forbidden</text></svg>" as unknown as Node;
    }

    if (mode === "unsafe") {
      const wrapper = request.ownerDocument.createElement("div");
      const script = request.ownerDocument.createElement("script");
      script.textContent = "window.__markoraUnsafeDiagramRenderer = true";
      const image = request.ownerDocument.createElement("img");
      image.setAttribute("onerror", "window.__markoraUnsafeDiagramRenderer = true");
      const frame = request.ownerDocument.createElement("iframe");
      const sourceProbe = request.ownerDocument.createElement("div");
      sourceProbe.setAttribute("src", "https://markora-diagrams.invalid/image.png");
      const form = request.ownerDocument.createElement("form");
      form.action = "https://markora-diagrams.invalid/submit";
      form.append(request.ownerDocument.createElement("input"));
      const custom = request.ownerDocument.createElement("markora-diagram-probe");
      const svg = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("onload", "window.__markoraUnsafeDiagramRenderer = true");
      const svgImage = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "image");
      const use = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#missing-local-reference");
      const link = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "a");
      link.setAttribute("href", "https://markora-diagrams.invalid/navigation");
      const foreignObject = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "foreignObject",
      );
      foreignObject.append(request.ownerDocument.createElement("button"));
      const animate = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "animate");
      animate.setAttribute("onbegin", "window.__markoraUnsafeDiagramRenderer = true");
      const styled = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
      styled.setAttribute("style", "fill:url(https://markora-diagrams.invalid/fill.svg#probe)");
      svg.append(svgImage, use, link, foreignObject, animate, styled);
      wrapper.append(script, image, frame, sourceProbe, form, custom, svg);
      return wrapper;
    }

    if (mode === "unsafe-css-var") {
      const svg = request.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      const rect = request.ownerDocument.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("style", "fill:var(--markora-diagram-network-probe)");
      svg.append(rect);
      return svg;
    }

    const output = createBrowserLabDiagramOutput(request, call.id);

    if (mode === "connected") {
      (output as SVGSVGElement).dataset.e2eDiagramRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.diagramRendererArtifacts.add(output);
      request.signal.addEventListener("abort", () => {
        output.remove();
        mounted.diagramRendererArtifacts.delete(output);
      }, { once: true });
    }

    return output;
  };
}

function createBrowserLabDiagramRenderers(
  mounted: MountedEditor,
  modes: BrowserLabEditorSpec["diagramRendererModes"],
) {
  const renderers: Partial<Record<DiagramKind, DiagramRenderer>> = {};

  for (const kind of BROWSER_LAB_DIAGRAM_KINDS) {
    const renderer = createBrowserLabDiagramRenderer(mounted, modes?.[kind]);

    if (renderer) {
      renderers[kind] = renderer;
    }
  }

  return renderers;
}

function runBrowserLabDiagramCommand(
  mounted: MountedEditor,
  request: BrowserLabDiagramCommandRequest,
) {
  const commands = requireDiagramsHandle(mounted).commands;

  switch (request.type) {
    case "convert": return commands.convert(request.target, request.kind);
    case "convertCodeBlock": return commands.convertCodeBlock(request.kind);
    case "insert": return commands.insert(request.options);
    case "remove": return commands.remove(request.target);
    case "restoreCodeBlock": return commands.restoreCodeBlock(request.target);
    case "retryPreview": return commands.retryPreview(request.target);
    case "togglePreview": return commands.togglePreview(request.target);
    case "update": return commands.update(request.target, request.patch);
  }
}

function createBrowserLabHtmlOutput(request: HtmlRenderRequest, callId: number) {
  const output = request.ownerDocument.createElement("article");
  output.className = "browser-lab-html-rendered";
  output.textContent = `Rendered ${request.kind} HTML ${callId}: ${request.source}`;
  return output;
}

function clearHtmlRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.htmlRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.htmlRendererArtifacts.clear();
}

function createBrowserLabHtmlRenderer(
  mounted: MountedEditor,
  mode: BrowserLabHtmlRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (request: HtmlRenderRequest): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.htmlRendererCalls.length + 1,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.htmlRendererCalls.push(call);
    request.signal.addEventListener("abort", () => {
      call.aborted = true;
    }, { once: true });

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(`Browser lab HTML renderer threw for call ${call.id}.`);
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(new Error(
        `Browser lab HTML renderer rejected call ${call.id}.`,
      ));
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.htmlRendererDeferred.set(call.id, { reject, request, resolve });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument = request.ownerDocument.implementation
        .createHTMLDocument("Browser lab foreign HTML renderer");
      const output = foreignDocument.createElement("article");
      output.textContent = request.source;
      return output;
    }

    const output = createBrowserLabHtmlOutput(request, call.id);

    if (mode === "string") {
      return "<article>renderer strings are forbidden</article>" as unknown as Node;
    }

    if (mode === "unsafe") {
      const wrapper = request.ownerDocument.createElement("div");
      const script = request.ownerDocument.createElement("script");
      script.textContent = "window.__markoraUnsafeHtmlRenderer = true";
      const image = request.ownerDocument.createElement("img");
      const frame = request.ownerDocument.createElement("iframe");
      const link = request.ownerDocument.createElement("a");
      link.href = "https://markora-html.invalid/renderer-link";
      link.textContent = "unsafe renderer link";
      const form = request.ownerDocument.createElement("form");
      form.action = "https://markora-html.invalid/renderer-submit";
      form.append(request.ownerDocument.createElement("input"));
      const svg = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      wrapper.append(script, image, frame, link, form, svg);
      return wrapper;
    }

    if (mode === "connected") {
      output.dataset.e2eHtmlRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.htmlRendererArtifacts.add(output);
      request.signal.addEventListener("abort", () => {
        output.remove();
        mounted.htmlRendererArtifacts.delete(output);
      }, { once: true });
    }

    return output;
  };
}

function runBrowserLabHtmlCommand(
  mounted: MountedEditor,
  request: BrowserLabHtmlCommandRequest,
) {
  const commands = requireHtmlHandle(mounted).commands;

  switch (request.type) {
    case "remove": return commands.remove(request.target);
    case "retryPreview": return commands.retryPreview(request.target);
    case "togglePreview": return commands.togglePreview(request.target);
    case "update": return commands.update(request.target, request.source);
  }
}

function clearMathRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.mathRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.mathRendererArtifacts.clear();
}

function createBrowserLabMathRenderer(
  mounted: MountedEditor,
  mode: BrowserLabMathRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (request: MathRenderRequest): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.mathRendererCalls.length + 1,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.mathRendererCalls.push(call);
    request.signal.addEventListener("abort", () => {
      call.aborted = true;
    }, { once: true });

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(`Browser lab math renderer threw for call ${call.id}.`);
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(new Error(
        `Browser lab math renderer rejected call ${call.id}.`,
      ));
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.mathRendererDeferred.set(call.id, { reject, request, resolve });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument = request.ownerDocument.implementation
        .createHTMLDocument("Browser lab foreign math renderer");
      const output = foreignDocument.createElement("span");
      output.textContent = request.source;
      return output;
    }

    const output = createBrowserLabMathOutput(request, call.id);

    if (mode === "unsafe") {
      output.setAttribute("onclick", "window.__markoraUnsafeMathRenderer = true");
      return output;
    }

    if (mode === "connected") {
      output.dataset.e2eMathRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.mathRendererArtifacts.add(output);
      request.signal.addEventListener("abort", () => {
        output.remove();
        mounted.mathRendererArtifacts.delete(output);
      }, { once: true });
    }

    return output;
  };
}

function runBrowserLabMathCommand(
  mounted: MountedEditor,
  request: BrowserLabMathCommandRequest,
) {
  const commands = requireMathHandle(mounted).commands;

  switch (request.type) {
    case "convert": return commands.convert(request.target, request.kind);
    case "insertBlock": return commands.insertBlock(request.source);
    case "insertInline": return commands.insertInline(request.source);
    case "remove": return commands.remove(request.target);
    case "retryPreview": return commands.retryPreview(request.target);
    case "togglePreview": return commands.togglePreview(request.target);
    case "update": return commands.update(request.target, request.source);
  }
}

function runBrowserLabAlertsCommand(
  mounted: MountedEditor,
  request: BrowserLabAlertsCommandRequest,
) {
  const commands = requireAlertsHandle(mounted).commands;

  switch (request.type) {
    case "setKind": return commands.setKind(request.kind);
    case "toggle": return commands.toggle(request.kind);
    case "unwrap": return commands.unwrap();
    case "wrap": return commands.wrap(request.kind);
  }
}

function readBrowserLabAlertsState(
  mounted: MountedEditor,
  request: BrowserLabAlertsStateRequest,
) {
  const state = requireAlertsHandle(mounted).state;

  switch (request.type) {
    case "canSetKind": return state.canSetKind(request.kind);
    case "canToggle": return state.canToggle(request.kind);
    case "canUnwrap": return state.canUnwrap();
    case "canWrap": return state.canWrap(request.kind);
    case "isActive": return state.isActive();
  }
}

function runBrowserLabTocCommand(
  mounted: MountedEditor,
  request: BrowserLabTocCommandRequest,
) {
  const commands = requireTocHandle(mounted).commands;
  return request.type === "insert" ? commands.insert() : commands.remove();
}

function readBrowserLabTocState(
  mounted: MountedEditor,
  request: BrowserLabTocStateRequest,
) {
  const state = requireTocHandle(mounted).state;

  switch (request.type) {
    case "canInsert": return state.canInsert();
    case "canRemove": return state.canRemove();
    case "isActive": return state.isActive();
  }
}

function cloneEditorStyles(shadowRoot: ShadowRoot) {
  for (const style of document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
    shadowRoot.append(style.cloneNode(true));
  }

  const fixtureStyles = document.createElement("style");
  fixtureStyles.textContent = `
    :host { color: #0f172a; font-family: Inter, system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    .browser-lab-frame { min-width: 0; padding: 20px; background: #fff; }
    .browser-lab-editor-host { min-height: 260px; }
    .browser-lab-portal { position: relative; z-index: 10; }
  `;
  shadowRoot.append(fixtureStyles);
}

function describeActiveElement(mounted: MountedEditor) {
  const activeElement = mounted.root instanceof ShadowRoot
    ? mounted.root.activeElement
    : document.activeElement;

  if (!(activeElement instanceof HTMLElement)) {
    return null;
  }

  if (activeElement.classList.contains("cm-content")) {
    return "code-mirror";
  }

  if (activeElement.classList.contains("ProseMirror")) {
    return "prosemirror";
  }

  return activeElement.getAttribute("aria-label")
    ?? activeElement.getAttribute("role")
    ?? activeElement.tagName.toLowerCase();
}

function readSnapshot(mounted: MountedEditor): BrowserLabSnapshot {
  mounted.editor.flushChange();
  const { selection } = mounted.editor.view.state;
  const activeElement = mounted.root instanceof ShadowRoot
    ? mounted.root.activeElement
    : document.activeElement;

  return {
    activeElement: describeActiveElement(mounted),
    changeCount: mounted.changeCount,
    codeBlocks: {
      active: mounted.editor.view.dom.querySelectorAll('[data-mdw-code-block-state="active"]').length,
      codeMirrorEditors: mounted.editor.view.dom.querySelectorAll(".cm-editor").length,
      error: mounted.editor.view.dom.querySelectorAll('[data-mdw-code-block-state="error"]').length,
      inactive: mounted.editor.view.dom.querySelectorAll('[data-mdw-code-block-state="inactive"]').length,
      loading: mounted.editor.view.dom.querySelectorAll('[data-mdw-code-block-state="loading"]').length,
      staticViews: mounted.editor.view.dom.querySelectorAll(".mdw-code-block-static").length,
      total: mounted.editor.view.dom.querySelectorAll(".mdw-code-block").length,
    },
    codeMirrorFocused: activeElement instanceof HTMLElement && activeElement.classList.contains("cm-content"),
    id: mounted.section.dataset.e2eEditor ?? "",
    markdown: mounted.editor.getMarkdown(),
    prosemirrorFocused: mounted.editor.view.hasFocus(),
    selection: {
      anchor: selection.anchor,
      from: selection.from,
      head: selection.head,
      to: selection.to,
    },
    transactionCount: mounted.transactionCount,
  };
}

function readExtensionSnapshot(mounted: MountedEditor): BrowserLabExtensionSnapshot {
  const registry = mounted.editor.extensions;
  const calloutLifecycle = registry.has(publicCalloutExtension)
    ? { ...registry.get(publicCalloutExtension).storage }
    : null;

  return {
    calloutLifecycle,
    manifest: registry.manifest.extensions.map(({ name, version }) => ({ name, version })),
    uiActions: registry.uiActions.map(({ defaultLabel, group, id }) => ({
      defaultLabel,
      group,
      id,
    })),
  };
}

function renderExtensionActions(mounted: MountedEditor) {
  mounted.extensionActions?.remove();
  mounted.extensionActions = undefined;

  if (mounted.editor.extensions.uiActions.length === 0) {
    return;
  }

  const toolbar = mounted.section.ownerDocument.createElement("div");
  toolbar.className = "browser-lab-extension-actions";
  toolbar.dataset.e2eExtensionActions = mounted.id;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", `${mounted.id} extension actions`);

  for (const action of mounted.editor.extensions.uiActions) {
    const button = toolbar.ownerDocument.createElement("button");
    button.type = "button";
    button.dataset.e2eExtensionAction = action.id;
    button.textContent = action.defaultLabel;
    button.disabled = !action.isEnabled();
    button.addEventListener("click", () => {
      action.run();
      mounted.editor.flushChange();
      mounted.output.textContent = mounted.editor.getMarkdown();
      button.disabled = !action.isEnabled();
    });
    toolbar.append(button);
  }

  mounted.section.insertBefore(toolbar, mounted.output);
  mounted.extensionActions = toolbar;
}

export function BrowserLabPage() {
  const labRootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const labRoot = labRootRef.current;

    if (!labRoot) {
      return;
    }

    const editors = new Map<string, MountedEditor>();
    const listenerLedger = createGlobalListenerLedger(window);
    let didActivateCodeMirror = false;
    let didAcceptFirefoxCodeMirrorBaseline = false;
    const noteCodeMirrorActivation = (node: Node) => {
      if (
        node instanceof Element
        && (node.matches(".cm-editor") || node.querySelector(".cm-editor"))
      ) {
        didActivateCodeMirror = true;
      }
    };
    const mountEditorInHost = (
      mounted: MountedEditor,
      spec: Omit<BrowserLabEditorSpec, "direction" | "entry" | "id" | "placement" | "portal" | "root">,
    ) => {
      mounted.controlledEcho = spec.controlledEcho ?? false;
      const extensionMode = spec.extensionMode ?? mounted.extensionMode;
      const allAdvanced = extensionMode === "all-advanced";
      mounted.extensionMode = extensionMode;
      mounted.diagramEditRequest = null;
      mounted.diagramRendererCalls.length = 0;
      mounted.diagramRendererDeferred.clear();
      clearDiagramRendererArtifacts(mounted);
      delete mounted.section.dataset.pendingDiagramEdit;
      mounted.frontmatterEditRequest = null;
      delete mounted.section.dataset.pendingFrontmatterEdit;
      mounted.htmlEditRequest = null;
      mounted.htmlRendererCalls.length = 0;
      mounted.htmlRendererDeferred.clear();
      clearHtmlRendererArtifacts(mounted);
      delete mounted.section.dataset.pendingHtmlEdit;
      mounted.mathEditRequest = null;
      mounted.mathRendererCalls.length = 0;
      mounted.mathRendererDeferred.clear();
      clearMathRendererArtifacts(mounted);
      delete mounted.section.dataset.pendingMathEdit;
      mounted.alertsExtension = extensionMode === "alerts" || allAdvanced
        ? createAlertsExtension({
            messages: normalizeBrowserLabAlertsMessages(spec.alertsMessages),
          })
        : null;
      mounted.diagramExtension = extensionMode === "diagrams" || allAdvanced
        ? createDiagramsExtension({
            messages: normalizeBrowserLabDiagramMessages(spec.diagramMessages),
            onEditSource(request) {
              mounted.diagramEditRequest = request;
              mounted.section.dataset.pendingDiagramEdit = "true";
            },
            renderers: createBrowserLabDiagramRenderers(
              mounted,
              spec.diagramRendererModes,
            ),
          })
        : null;
      mounted.frontmatterExtension = extensionMode === "frontmatter" || allAdvanced
        ? createFrontmatterExtension({
            messages: spec.frontmatterMessages,
            onEditSource(request) {
              mounted.frontmatterEditRequest = request;
              mounted.section.dataset.pendingFrontmatterEdit = "true";
            },
          })
        : null;
      mounted.footnotesExtension = extensionMode === "footnotes" || allAdvanced
        ? createFootnotesExtension({
            messages: spec.footnotesMessages
              ? Object.fromEntries(
                  Object.entries(spec.footnotesMessages).map(([key, message]) => [
                    key,
                    () => message,
                  ]),
                ) as FootnotesMessageOverrides
              : undefined,
          })
        : null;
      mounted.htmlExtension = extensionMode === "html" || allAdvanced
        ? createHtmlExtension({
            messages: normalizeBrowserLabHtmlMessages(spec.htmlMessages),
            onEditSource(request) {
              mounted.htmlEditRequest = request;
              mounted.section.dataset.pendingHtmlEdit = "true";
            },
            renderer: createBrowserLabHtmlRenderer(
              mounted,
              spec.htmlRendererMode,
            ),
          })
        : null;
      mounted.mathExtension = extensionMode === "math" || allAdvanced
        ? createMathExtension({
            messages: normalizeBrowserLabMathMessages(spec.mathMessages),
            onEditSource(request) {
              mounted.mathEditRequest = request;
              mounted.section.dataset.pendingMathEdit = "true";
            },
            renderer: createBrowserLabMathRenderer(
              mounted,
              spec.mathRendererMode,
            ),
          })
        : null;
      mounted.tocExtension = extensionMode === "toc" || allAdvanced
        ? createTocExtension({
            messages: normalizeBrowserLabTocMessages(spec.tocMessages),
          })
        : null;
      const extensions = extensionMode === "public-example"
        ? publicExampleExtensions
        : allAdvanced
          ? [
              mounted.frontmatterExtension!,
              mounted.footnotesExtension!,
              mounted.mathExtension!,
              mounted.alertsExtension!,
              mounted.tocExtension!,
              mounted.htmlExtension!,
              mounted.diagramExtension!,
            ]
          : mounted.alertsExtension
          ? [mounted.alertsExtension]
          : mounted.frontmatterExtension
            ? [mounted.frontmatterExtension]
            : mounted.footnotesExtension
              ? [mounted.footnotesExtension]
              : mounted.htmlExtension
                ? [mounted.htmlExtension]
                : mounted.mathExtension
                  ? [mounted.mathExtension]
                  : mounted.tocExtension
                    ? [mounted.tocExtension]
                    : mounted.diagramExtension
                      ? [mounted.diagramExtension]
                      : undefined;
      const existingOverlays = new Set(
        mounted.portalRoot.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR),
      );

      const createEntryEditor = mounted.entry === "minimal"
        ? createMinimalEditor
        : createEditor;

      mounted.editor = listenerLedger.scope(mounted.id, () => createEntryEditor({
        ariaLabel: spec.ariaLabel ?? (spec.ariaLabelledBy ? undefined : `${mounted.id} Markdown editor`),
        ariaLabelledBy: spec.ariaLabelledBy,
        attributes: spec.attributes,
        autofocus: spec.autofocus,
        editable: spec.editable,
        element: mounted.host,
        extensions,
        initialSelection: spec.initialSelection,
        markdown: spec.markdown ?? `# ${mounted.id}\n\nBrowser lab paragraph.`,
        messages: spec.messages,
        onChange(markdown) {
          mounted.changeCount += 1;
          mounted.output.dataset.changeCount = String(mounted.changeCount);
          mounted.output.textContent = markdown;

          if (mounted.controlledEcho) {
            mounted.editor.commands.reconcileMarkdown(markdown);
          }
        },
        onTransaction() {
          mounted.transactionCount += 1;
          mounted.output.dataset.transactionCount = String(mounted.transactionCount);
        },
        onEditOpaqueMarkdown(request) {
          mounted.opaqueEditRequest = request;
          mounted.section.dataset.pendingOpaqueKind = request.kind;
        },
        placeholder: spec.placeholder,
        resources: createBrowserLabResources(mounted, spec.resourceMode),
        shortcuts: spec.shortcuts,
        typing: spec.typing,
        ui: mounted.explicitPortalRoot
          ? createDefaultUi({
              messages: spec.uiMessages,
              portalRoot: mounted.explicitPortalRoot,
            })
          : createDefaultUi({ messages: spec.uiMessages }),
      }));

      subscribeToEditorEvents(mounted);
      renderExtensionActions(mounted);

      for (const overlay of mounted.portalRoot.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
        if (!existingOverlays.has(overlay)) {
          overlay.dataset.e2eOwner = mounted.id;
        }
      }

      mounted.output.textContent = mounted.editor.getMarkdown();
    };

    const destroy = (id: string) => {
      const mounted = editors.get(id);

      if (!mounted) {
        return false;
      }

      try {
        if (mounted.editor.view.dom.querySelector(".cm-editor")) {
          didActivateCodeMirror = true;
        }

        mounted.editor.destroy();
      } finally {
        clearDiagramRendererArtifacts(mounted);
        clearHtmlRendererArtifacts(mounted);
        clearMathRendererArtifacts(mounted);
        for (const unsubscribe of mounted.eventUnsubscribes.values()) {
          unsubscribe();
        }

        mounted.eventUnsubscribes.clear();
        mounted.activationObserver.disconnect();
        mounted.section.remove();
        editors.delete(id);
      }

      return true;
    };

    const destroyAll = () => {
      for (const id of [...editors.keys()]) {
        destroy(id);
      }
    };

    const api: BrowserLabApi = {
      ready: true,
      alertsCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const handled = runBrowserLabAlertsCommand(mounted, request);

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
          renderExtensionActions(mounted);
        }

        return handled;
      },
      alertsSnapshot(id) {
        const state = requireAlertsHandle(requireEditor(editors, id)).state;
        return {
          active: state.getActive(),
          alerts: state.getAlerts(),
        };
      },
      alertsState(id, request) {
        return readBrowserLabAlertsState(requireEditor(editors, id), request);
      },
      diagramCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const handled = runBrowserLabDiagramCommand(mounted, request);

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
        }

        return handled;
      },
      diagramEditConvert(id, kind) {
        const mounted = requireEditor(editors, id);
        const request = mounted.diagramEditRequest;

        if (!request || !request.convert(kind)) {
          return false;
        }

        mounted.diagramEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      diagramEditRemove(id) {
        const mounted = requireEditor(editors, id);
        const request = mounted.diagramEditRequest;

        if (!request || !request.remove()) {
          return false;
        }

        mounted.diagramEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      diagramEditRestoreCodeBlock(id) {
        const mounted = requireEditor(editors, id);
        const request = mounted.diagramEditRequest;

        if (!request || !request.restoreCodeBlock()) {
          return false;
        }

        mounted.diagramEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      diagramEditUpdate(id, patch) {
        const mounted = requireEditor(editors, id);
        const request = mounted.diagramEditRequest;

        if (!request || !request.update(patch)) {
          return false;
        }

        mounted.diagramEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      diagramRendererCalls(id) {
        return requireEditor(editors, id).diagramRendererCalls.map((call) => ({
          ...call,
        }));
      },
      diagramRendererSettle(id, settlement = {}) {
        const mounted = requireEditor(editors, id);
        const pendingCallIds = [...mounted.diagramRendererDeferred.keys()];
        const callId = settlement.callId
          ?? pendingCallIds[pendingCallIds.length - 1];

        if (callId === undefined) {
          return false;
        }

        const deferred = mounted.diagramRendererDeferred.get(callId);
        const call = mounted.diagramRendererCalls.find(({ id: nextId }) => nextId === callId);

        if (!deferred || !call || call.settled !== "pending") {
          return false;
        }

        mounted.diagramRendererDeferred.delete(callId);

        if (settlement.outcome === "reject") {
          call.settled = "rejected";
          deferred.reject(new Error(
            `Browser lab deferred ${call.kind} diagram renderer rejected call ${callId}.`,
          ));
        } else {
          call.settled = "resolved";
          deferred.resolve(createBrowserLabDiagramOutput(deferred.request, callId));
        }

        return true;
      },
      diagramSnapshot(id) {
        return requireDiagramsHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      blur(id) {
        requireEditor(editors, id).editor.blur();
      },
      clearEvents(id) {
        clearEventTracking(requireEditor(editors, id));
      },
      mount(spec) {
        const id = spec.id.trim();

        if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
          throw new Error("Browser lab editor ids may contain only letters, numbers, underscores, and hyphens.");
        }

        if (editors.has(id)) {
          throw new Error(`Browser lab editor \"${id}\" is already mounted.`);
        }

        const rootMode = spec.root ?? "document";
        const portalMode = spec.portal ?? "default";
        const section = document.createElement("section");
        section.className = "browser-lab-editor";
        section.dataset.e2eEditor = id;
        section.dataset.entry = spec.entry ?? "root";
        section.dataset.placement = spec.placement ?? "normal";
        section.dataset.portal = portalMode;
        section.dataset.root = rootMode;

        const heading = document.createElement("h2");
        heading.className = "browser-lab-editor-label";
        heading.id = `browser-lab-editor-label-${id}`;
        heading.textContent = id;
        section.append(heading);

        let editorRoot: Document | ShadowRoot = document;
        let contentRoot: HTMLElement | ShadowRoot = section;

        if (rootMode === "shadow") {
          const shadowHost = document.createElement("div");
          shadowHost.className = "browser-lab-shadow-host";
          shadowHost.dataset.e2eShadowHost = id;
          section.append(shadowHost);
          const shadowRoot = shadowHost.attachShadow({ mode: "open" });
          cloneEditorStyles(shadowRoot);
          editorRoot = shadowRoot;
          contentRoot = shadowRoot;
        }

        const frame = document.createElement("div");
        frame.className = `browser-lab-frame browser-lab-frame--${portalMode}`;
        frame.dataset.e2eFrame = id;
        frame.dir = spec.direction ?? "auto";
        if (spec.language) {
          frame.lang = spec.language;
        }
        if (spec.theme) {
          frame.dataset.mdwTheme = spec.theme;
        }
        if (spec.motion) {
          frame.dataset.mdwMotion = spec.motion;
        }
        const host = document.createElement("div");
        host.className = "browser-lab-editor-host";
        host.dataset.e2eHost = id;
        frame.append(host);

        let explicitPortalRoot: HTMLElement | ShadowRoot | undefined;

        if (portalMode === "body") {
          explicitPortalRoot = document.body;
        } else if (portalMode === "local" || portalMode === "positioned" || portalMode === "transformed") {
          const portal = document.createElement("div");
          portal.className = "browser-lab-portal";
          portal.dataset.e2ePortal = id;
          frame.append(portal);
          explicitPortalRoot = portal;
        }

        contentRoot.append(frame);
        const output = document.createElement("output");
        output.className = "browser-lab-output";
        output.dataset.e2eOutput = id;
        output.dataset.changeCount = "0";
        output.dataset.transactionCount = "0";
        output.setAttribute("aria-label", `${id} Markdown output`);
        output.tabIndex = 0;
        section.append(output);
        labRoot.append(section);

        const effectivePortalRoot = explicitPortalRoot
          ?? (rootMode === "shadow" ? editorRoot as ShadowRoot : document.body);
        const activationObserver = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              noteCodeMirrorActivation(node);
            }
          }
        });
        activationObserver.observe(host, { childList: true, subtree: true });
        const mounted: MountedEditor = {
          activationObserver,
          alertsExtension: null,
          changeCount: 0,
          controlledEcho: false,
          diagramEditRequest: null,
          diagramExtension: null,
          diagramRendererArtifacts: new Set(),
          diagramRendererCalls: [],
          diagramRendererDeferred: new Map(),
          editor: null as unknown as MarkdownEditor,
          entry: spec.entry ?? "root",
          eventCounts: createEventCounts(),
          eventLog: [],
          eventUnsubscribes: new Map(),
          extensionMode: spec.extensionMode,
          explicitPortalRoot,
          footnotesExtension: null,
          frontmatterEditRequest: null,
          frontmatterExtension: null,
          host,
          htmlEditRequest: null,
          htmlExtension: null,
          htmlRendererArtifacts: new Set(),
          htmlRendererCalls: [],
          htmlRendererDeferred: new Map(),
          id,
          mathEditRequest: null,
          mathExtension: null,
          mathRendererArtifacts: new Set(),
          mathRendererCalls: [],
          mathRendererDeferred: new Map(),
          opaqueEditRequest: null,
          output,
          portalRoot: effectivePortalRoot,
          root: editorRoot,
          resourceLog: createResourceLog(),
          section,
          tocExtension: null,
          transactionCount: 0,
        };

        try {
          mountEditorInHost(mounted, spec);
        } catch (error) {
          clearDiagramRendererArtifacts(mounted);
          clearHtmlRendererArtifacts(mounted);
          activationObserver.disconnect();
          section.remove();
          throw error;
        }

        editors.set(id, mounted);
        return readSnapshot(mounted);
      },
      copySelection(id) {
        const mounted = requireEditor(editors, id);
        const activeElement = mounted.root instanceof ShadowRoot
          ? mounted.root.activeElement
          : mounted.host.ownerDocument.activeElement;
        const target = activeElement instanceof Node && mounted.editor.view.dom.contains(activeElement)
          ? activeElement
          : mounted.editor.view.dom;
        const transfer = new DataTransfer();
        const event = new ClipboardEvent("copy", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
          composed: true,
        });

        if (event.clipboardData !== transfer) {
          Object.defineProperty(event, "clipboardData", {
            configurable: true,
            value: transfer,
          });
        }

        target.dispatchEvent(event);

        return {
          defaultPrevented: event.defaultPrevented,
          html: transfer.getData("text/html"),
          markdown: transfer.getData("text/markdown"),
          plain: transfer.getData("text/plain"),
          types: Array.from(transfer.types),
        };
      },
      destroy,
      destroyEditor(id) {
        const mounted = requireEditor(editors, id);
        const wasDestroyed = mounted.editor.isDestroyed;
        mounted.editor.destroy();
        clearDiagramRendererArtifacts(mounted);
        clearHtmlRendererArtifacts(mounted);
        clearMathRendererArtifacts(mounted);

        for (const button of mounted.extensionActions?.querySelectorAll("button") ?? []) {
          button.disabled = true;
        }

        return !wasDestroyed && mounted.editor.isDestroyed;
      },
      destroyAll,
      events(id) {
        const mounted = requireEditor(editors, id);
        const counts = createEventCounts();

        for (const eventName of EVENT_NAMES) {
          counts[eventName] = mounted.eventCounts[eventName];
        }

        return {
          counts,
          log: mounted.eventLog.map((event) => ({ ...event })),
        };
      },
      extensionSnapshot(id) {
        return readExtensionSnapshot(requireEditor(editors, id));
      },
      frontmatterCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const commands = requireFrontmatterHandle(mounted).commands;
        const changed = request.type === "insert"
          ? commands.insert(request.source)
          : request.type === "update"
            ? commands.update(request.source)
            : commands.remove();

        if (changed) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
        }

        renderExtensionActions(mounted);

        return changed;
      },
      frontmatterEditRemove(id) {
        const mounted = requireEditor(editors, id);
        const request = mounted.frontmatterEditRequest;

        if (!request || !request.remove()) {
          return false;
        }

        mounted.frontmatterEditRequest = null;
        delete mounted.section.dataset.pendingFrontmatterEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        renderExtensionActions(mounted);
        return true;
      },
      frontmatterEditUpdate(id, source) {
        const mounted = requireEditor(editors, id);
        const request = mounted.frontmatterEditRequest;

        if (!request || !request.update(source)) {
          return false;
        }

        mounted.frontmatterEditRequest = null;
        delete mounted.section.dataset.pendingFrontmatterEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        renderExtensionActions(mounted);
        return true;
      },
      frontmatterSnapshot(id) {
        return requireFrontmatterHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      footnotesCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const commands = requireFootnotesHandle(mounted).commands;
        let handled: boolean;

        switch (request.type) {
          case "insertDefinition":
            handled = commands.insertDefinition(request.label);
            break;
          case "insertReference":
            handled = commands.insertReference(request.label);
            break;
          case "navigateToDefinition":
            handled = commands.navigateToDefinition(request.label, request.occurrence);
            break;
          case "navigateToReference":
            handled = commands.navigateToReference(request.label, request.occurrence);
            break;
          case "removeDefinition":
            handled = commands.removeDefinition(request.target, {
              references: request.references,
            });
            break;
          case "renameDefinition":
            handled = commands.renameDefinition(request.target, request.nextLabel, {
              references: request.references,
            });
            break;
        }

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
        }

        return handled;
      },
      footnotesSnapshot(id) {
        return requireFootnotesHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      focus(id, selection) {
        requireEditor(editors, id).editor.focus(selection);
      },
      getMarkdown(id) {
        const mounted = requireEditor(editors, id);
        mounted.editor.flushChange();
        return mounted.editor.getMarkdown();
      },
      isDestroyed(id) {
        return requireEditor(editors, id).editor.isDestroyed;
      },
      htmlCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const handled = runBrowserLabHtmlCommand(mounted, request);

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
        }

        return handled;
      },
      htmlEditRemove(id) {
        const mounted = requireEditor(editors, id);
        const request = mounted.htmlEditRequest;

        if (!request || !request.remove()) {
          return false;
        }

        mounted.htmlEditRequest = null;
        delete mounted.section.dataset.pendingHtmlEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      htmlEditUpdate(id, source) {
        const mounted = requireEditor(editors, id);
        const request = mounted.htmlEditRequest;

        if (!request || !request.update(source)) {
          return false;
        }

        mounted.htmlEditRequest = null;
        delete mounted.section.dataset.pendingHtmlEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      htmlRendererCalls(id) {
        return requireEditor(editors, id).htmlRendererCalls.map((call) => ({
          ...call,
        }));
      },
      htmlRendererSettle(id, settlement = {}) {
        const mounted = requireEditor(editors, id);
        const pendingCallIds = [...mounted.htmlRendererDeferred.keys()];
        const callId = settlement.callId
          ?? pendingCallIds[pendingCallIds.length - 1];

        if (callId === undefined) {
          return false;
        }

        const deferred = mounted.htmlRendererDeferred.get(callId);
        const call = mounted.htmlRendererCalls.find(({ id: nextId }) => nextId === callId);

        if (!deferred || !call || call.settled !== "pending") {
          return false;
        }

        mounted.htmlRendererDeferred.delete(callId);

        if (settlement.outcome === "reject") {
          call.settled = "rejected";
          deferred.reject(new Error(
            `Browser lab deferred HTML renderer rejected call ${callId}.`,
          ));
        } else {
          call.settled = "resolved";
          deferred.resolve(createBrowserLabHtmlOutput(deferred.request, callId));
        }

        return true;
      },
      htmlSnapshot(id) {
        return requireHtmlHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      mathCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const handled = runBrowserLabMathCommand(mounted, request);

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
        }

        return handled;
      },
      mathEditConvert(id, kind) {
        const mounted = requireEditor(editors, id);
        const request = mounted.mathEditRequest;

        if (!request || !request.convert(kind)) {
          return false;
        }

        mounted.mathEditRequest = null;
        delete mounted.section.dataset.pendingMathEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      mathEditRemove(id) {
        const mounted = requireEditor(editors, id);
        const request = mounted.mathEditRequest;

        if (!request || !request.remove()) {
          return false;
        }

        mounted.mathEditRequest = null;
        delete mounted.section.dataset.pendingMathEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      mathEditUpdate(id, source) {
        const mounted = requireEditor(editors, id);
        const request = mounted.mathEditRequest;

        if (!request || !request.update(source)) {
          return false;
        }

        mounted.mathEditRequest = null;
        delete mounted.section.dataset.pendingMathEdit;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      mathRendererCalls(id) {
        return requireEditor(editors, id).mathRendererCalls.map((call) => ({
          ...call,
        }));
      },
      mathRendererSettle(id, settlement = {}) {
        const mounted = requireEditor(editors, id);
        const pendingCallIds = [...mounted.mathRendererDeferred.keys()];
        const callId = settlement.callId
          ?? pendingCallIds[pendingCallIds.length - 1];

        if (callId === undefined) {
          return false;
        }

        const deferred = mounted.mathRendererDeferred.get(callId);
        const call = mounted.mathRendererCalls.find(({ id: nextId }) => nextId === callId);

        if (!deferred || !call || call.settled !== "pending") {
          return false;
        }

        mounted.mathRendererDeferred.delete(callId);

        if (settlement.outcome === "reject") {
          call.settled = "rejected";
          deferred.reject(new Error(
            `Browser lab deferred math renderer rejected call ${callId}.`,
          ));
        } else {
          call.settled = "resolved";
          deferred.resolve(createBrowserLabMathOutput(deferred.request, callId));
        }

        return true;
      },
      mathSnapshot(id) {
        return requireMathHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      tocCommand(id, request) {
        const mounted = requireEditor(editors, id);
        const handled = runBrowserLabTocCommand(mounted, request);

        if (handled) {
          mounted.editor.flushChange();
          mounted.output.textContent = mounted.editor.getMarkdown();
          renderExtensionActions(mounted);
        }

        return handled;
      },
      tocSnapshot(id) {
        return requireTocHandle(requireEditor(editors, id)).state.getSnapshot();
      },
      tocState(id, request) {
        return readBrowserLabTocState(requireEditor(editors, id), request);
      },
      remount(id, options = {}) {
        const mounted = requireEditor(editors, id);

        if (!mounted.editor.isDestroyed) {
          throw new Error(`Browser lab editor \"${id}\" must be destroyed before remounting.`);
        }

        for (const unsubscribe of mounted.eventUnsubscribes.values()) {
          unsubscribe();
        }

        mounted.eventUnsubscribes.clear();
        mounted.changeCount = 0;
        mounted.transactionCount = 0;
        mounted.opaqueEditRequest = null;
        mounted.output.dataset.changeCount = "0";
        mounted.output.dataset.transactionCount = "0";
        delete mounted.section.dataset.pendingOpaqueKind;
        clearEventTracking(mounted);
        mounted.resourceLog = createResourceLog();
        mountEditorInHost(mounted, options);
        return readSnapshot(mounted);
      },
      reset(id, markdown) {
        const mounted = requireEditor(editors, id);
        mounted.diagramEditRequest = null;
        mounted.htmlEditRequest = null;
        mounted.opaqueEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        delete mounted.section.dataset.pendingHtmlEdit;
        delete mounted.section.dataset.pendingOpaqueKind;
        mounted.editor.commands.resetMarkdown(markdown, { emitChange: true });
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return mounted.editor.getMarkdown();
      },
      resourceLog(id) {
        const log = requireEditor(editors, id).resourceLog;
        return {
          loads: log.loads.map((entry) => ({ ...entry })),
          opens: log.opens.map((entry) => ({ ...entry })),
          resolutions: log.resolutions.map((entry) => ({ ...entry })),
          uploads: log.uploads.map((entry) => ({ ...entry })),
        };
      },
      reconcile(id, markdown, options) {
        const mounted = requireEditor(editors, id);
        mounted.diagramEditRequest = null;
        mounted.htmlEditRequest = null;
        mounted.opaqueEditRequest = null;
        delete mounted.section.dataset.pendingDiagramEdit;
        delete mounted.section.dataset.pendingHtmlEdit;
        delete mounted.section.dataset.pendingOpaqueKind;
        const changed = mounted.editor.commands.reconcileMarkdown(markdown, options);
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();

        return {
          changed,
          snapshot: readSnapshot(mounted),
        };
      },
      selectDiagram(id, target) {
        const mounted = requireEditor(editors, id);
        const snapshot = requireDiagramsHandle(mounted).state.getNode(target);

        if (!snapshot) {
          return false;
        }

        const view = mounted.editor.view;
        const node = view.state.doc.nodeAt(snapshot.position);

        if (!node || node.type.name !== "diagram" || view.composing) {
          return false;
        }

        const selection = NodeSelection.create(view.state.doc, snapshot.position);

        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        }

        view.focus();
        return true;
      },
      selectFootnote(id, request) {
        const mounted = requireEditor(editors, id);
        const handle = requireFootnotesHandle(mounted);
        const occurrence = request.occurrence ?? 1;

        if (!Number.isInteger(occurrence) || occurrence < 1) {
          return false;
        }

        const snapshot = request.kind === "definition"
          ? handle.state.getDefinition({ label: request.label, occurrence })
          : handle.state.getReferences(request.label)[occurrence - 1] ?? null;

        if (!snapshot) {
          return false;
        }

        const view = mounted.editor.view;
        const node = view.state.doc.nodeAt(snapshot.position);
        const expectedType = request.kind === "definition"
          ? "footnote_definition"
          : "footnote_reference";

        if (!node || node.type.name !== expectedType || view.composing) {
          return false;
        }

        let selection: Selection = NodeSelection.create(view.state.doc, snapshot.position);

        if (request.content) {
          if (request.kind !== "definition") {
            return false;
          }

          const from = request.content.from ?? 0;
          const to = request.content.to ?? node.content.size;

          if (
            !Number.isInteger(from)
            || !Number.isInteger(to)
            || from < 0
            || to < from
            || to > node.content.size
          ) {
            return false;
          }

          const contentStart = snapshot.position + 1;
          const contentEnd = contentStart + node.content.size;
          selection = TextSelection.between(
            view.state.doc.resolve(contentStart + from),
            view.state.doc.resolve(contentStart + to),
          );

          if (selection.from < contentStart || selection.to > contentEnd) {
            return false;
          }
        }

        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        }
        view.focus();
        return true;
      },
      selectHtml(id, target) {
        const mounted = requireEditor(editors, id);
        const snapshot = requireHtmlHandle(mounted).state.getNode(target);

        if (!snapshot) {
          return false;
        }

        const view = mounted.editor.view;
        const node = view.state.doc.nodeAt(snapshot.position);
        const expectedType = snapshot.display === "inline"
          ? "html_inline"
          : "html_block";

        if (!node || node.type.name !== expectedType || view.composing) {
          return false;
        }

        const selection = NodeSelection.create(view.state.doc, snapshot.position);

        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        }

        view.focus();
        return true;
      },
      selectMath(id, target) {
        const mounted = requireEditor(editors, id);
        const snapshot = requireMathHandle(mounted).state.getNode(target);

        if (!snapshot) {
          return false;
        }

        const view = mounted.editor.view;
        const node = view.state.doc.nodeAt(snapshot.position);
        const expectedType = snapshot.kind === "inline"
          ? "math_inline"
          : "math_block";

        if (!node || node.type.name !== expectedType || view.composing) {
          return false;
        }

        const selection = NodeSelection.create(view.state.doc, snapshot.position);

        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        }

        view.focus();
        return true;
      },
      selectToc(id, occurrence = 1) {
        if (!Number.isInteger(occurrence) || occurrence < 1) {
          return false;
        }

        const mounted = requireEditor(editors, id);
        const snapshot = requireTocHandle(mounted).state.getSnapshot()
          .tocs[occurrence - 1];

        if (!snapshot) {
          return false;
        }

        const view = mounted.editor.view;
        const node = view.state.doc.nodeAt(snapshot.position);

        if (!node || node.type.name !== "toc" || view.composing) {
          return false;
        }

        const selection = NodeSelection.create(view.state.doc, snapshot.position);

        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        }

        view.focus();
        renderExtensionActions(mounted);
        return true;
      },
      selectText(id, text, mode = "all", occurrence = 0) {
        if (!text || occurrence < 0) {
          return false;
        }

        const mounted = requireEditor(editors, id);
        let remainingOccurrence = occurrence;
        let match: { from: number; to: number } | null = null;

        mounted.editor.view.state.doc.descendants((node, pos) => {
          if (match || !node.isText || !node.text) {
            return !match;
          }

          let searchFrom = 0;

          while (searchFrom <= node.text.length) {
            const index = node.text.indexOf(text, searchFrom);

            if (index < 0) {
              break;
            }

            if (remainingOccurrence === 0) {
              match = { from: pos + index, to: pos + index + text.length };
              return false;
            }

            remainingOccurrence -= 1;
            searchFrom = index + Math.max(1, text.length);
          }

          return true;
        });

        const resolvedMatch = match as { from: number; to: number } | null;

        if (!resolvedMatch) {
          return false;
        }

        const from = mode === "end" ? resolvedMatch.to : resolvedMatch.from;
        const to = mode === "start" ? resolvedMatch.from : mode === "end" ? resolvedMatch.to : resolvedMatch.to;
        mounted.editor.focus({ anchor: from, head: to });
        return true;
      },
      snapshot(id) {
        return readSnapshot(requireEditor(editors, id));
      },
      active(id, request) {
        return readBrowserLabActiveState(requireEditor(editors, id).editor, request);
      },
      can(id, request) {
        return canRunBrowserLabCommand(requireEditor(editors, id).editor, request);
      },
      command(id, request) {
        return runBrowserLabCommand(requireEditor(editors, id).editor, request);
      },
      openUi(id, kind) {
        const ui = requireEditor(editors, id).editor.ui;
        if (kind === "code-language") return Boolean(ui?.editCodeBlockLanguage());
        if (kind === "link") return Boolean(ui?.editLink());
        if (kind === "image") return Boolean(ui?.editImage());
        if (kind === "table-create") return Boolean(ui?.createTable());
        return Boolean(ui?.editTable());
      },
      pendingOpaqueEdit(id) {
        const request = requireEditor(editors, id).opaqueEditRequest;
        return request ? { kind: request.kind, source: request.source } : null;
      },
      pendingFrontmatterEdit(id) {
        const request = requireEditor(editors, id).frontmatterEditRequest;
        return request
          ? { diagnostics: request.diagnostics, source: request.source }
          : null;
      },
      pendingDiagramEdit(id) {
        const request = requireEditor(editors, id).diagramEditRequest;
        return request
          ? {
              identity: request.identity,
              info: request.info,
              kind: request.kind,
              position: request.position,
              render: { ...request.render },
              source: request.source,
            }
          : null;
      },
      pendingHtmlEdit(id) {
        const request = requireEditor(editors, id).htmlEditRequest;
        return request
          ? {
              display: request.display,
              identity: request.identity,
              kind: request.kind,
              position: request.position,
              render: { ...request.render },
              source: request.source,
            }
          : null;
      },
      pendingMathEdit(id) {
        const request = requireEditor(editors, id).mathEditRequest;
        return request
          ? {
              kind: request.kind,
              position: request.position,
              render: { ...request.render },
              source: request.source,
            }
          : null;
      },
      updateOpaque(id, source) {
        const mounted = requireEditor(editors, id);
        const request = mounted.opaqueEditRequest;

        if (!request || !request.update(source)) {
          return false;
        }

        mounted.opaqueEditRequest = null;
        delete mounted.section.dataset.pendingOpaqueKind;
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return true;
      },
      tableIssues(id) {
        return requireEditor(editors, id).editor.state.tableIssues();
      },
      unsubscribe(id, type) {
        const mounted = requireEditor(editors, id);
        const unsubscribe = mounted.eventUnsubscribes.get(type);

        if (!unsubscribe) {
          return false;
        }

        unsubscribe();
        mounted.eventUnsubscribes.delete(type);
        return true;
      },
      updateOptions(id, options) {
        const mounted = requireEditor(editors, id);
        const previousState = mounted.editor.view.state;
        mounted.editor.updateOptions(options);
        renderExtensionActions(mounted);

        return {
          snapshot: readSnapshot(mounted),
          statePreserved: mounted.editor.view.state === previousState,
        };
      },
      listenerSnapshot(id) {
        listenerLedger.acceptPlaywrightHarnessBaseline();
        listenerLedger.acceptAxeCoreBaseline();

        if (didActivateCodeMirror && !didAcceptFirefoxCodeMirrorBaseline) {
          didAcceptFirefoxCodeMirrorBaseline = listenerLedger.acceptFirefoxCodeMirrorCopyCutBaseline();
        }

        return listenerLedger.snapshot(id);
      },
      dispatchTransfer(id, spec) {
        const mounted = requireEditor(editors, id);
        const target = spec.target === "code-mirror"
          ? mounted.editor.view.dom.querySelector<HTMLElement>(".cm-content")
          : spec.target === "static-code"
            ? mounted.editor.view.dom.querySelector<HTMLElement>(".mdw-code-block-static-code")
            : mounted.editor.view.dom;

        if (!target) {
          throw new Error(`Browser lab editor \"${id}\" has no ${spec.target ?? "prosemirror"} transfer target.`);
        }

        target.focus();
        const transfer = new DataTransfer();

        if (spec.plain !== undefined) {
          transfer.setData("text/plain", spec.plain);
        }

        if (spec.html !== undefined) {
          transfer.setData("text/html", spec.html);
        }

        if (spec.markdown !== undefined) {
          transfer.setData("text/markdown", spec.markdown);
        }

        for (const file of spec.files ?? []) {
          transfer.items.add(new File([file.contents], file.name, { type: file.type }));
        }

        const rect = target.getBoundingClientRect();
        const eventInit = {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(12, rect.width / 2),
          clientY: rect.top + Math.min(12, rect.height / 2),
          composed: true,
        };
        const event = spec.event === "paste"
          ? new ClipboardEvent("paste", { ...eventInit, clipboardData: transfer })
          : new DragEvent(spec.event, { ...eventInit, dataTransfer: transfer });
        const attachedTransfer = spec.event === "paste"
          ? (event as ClipboardEvent).clipboardData
          : (event as DragEvent).dataTransfer;

        // Firefox does not retain constructor-supplied transfer data on
        // synthetic clipboard events. Attach it explicitly so this test-only
        // fixture exercises the same product path in every required engine.
        if (attachedTransfer !== transfer) {
          Object.defineProperty(event, spec.event === "paste" ? "clipboardData" : "dataTransfer", {
            configurable: true,
            value: transfer,
          });
        }

        target.dispatchEvent(event);

        return {
          defaultPrevented: event.defaultPrevented,
          fileCount: transfer.files.length,
          types: Array.from(transfer.types),
        };
      },
      mountedIds() {
        return [...editors.keys()];
      },
      dispatchViewportEvent(type) {
        window.visualViewport?.dispatchEvent(new Event(type));
      },
      async settle(id) {
        if (id && editors.has(id)) {
          requireEditor(editors, id).editor.flushChange();
        } else if (!id) {
          for (const mounted of editors.values()) {
            mounted.editor.flushChange();
          }
        }

        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      },
    };

    window.__MARKORA_BROWSER_LAB__ = api;
    labRoot.dataset.ready = "true";

    return () => {
      destroyAll();
      listenerLedger.restore();

      if (window.__MARKORA_BROWSER_LAB__ === api) {
        delete window.__MARKORA_BROWSER_LAB__;
      }
    };
  }, []);

  return (
    <section
      ref={labRootRef}
      aria-labelledby="browser-lab-title"
      className="browser-lab"
      data-e2e-browser-lab
      data-ready="false"
    >
      <h1 id="browser-lab-title" className="browser-lab-title">Markora browser regression lab</h1>
    </section>
  );
}
