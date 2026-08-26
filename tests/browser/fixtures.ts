import { expect, test as base, type ConsoleMessage, type Page, type TestInfo } from "@playwright/test";

export type LabSelectionTarget =
  | "all"
  | "end"
  | "start"
  | { anchor: number; head?: number };

export type LabEventName = "asset" | "blur" | "error" | "focus" | "selection" | "state" | "update";

export type LabSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: "all" | "managed-block" | "node" | "other" | "table-cell" | "text";
  to: number;
};

export type LabEventRecord = {
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
  previousSelection?: LabSelectionSnapshot;
  selection?: LabSelectionSnapshot;
  selectionChanged?: boolean;
  status?: string;
  type: LabEventName;
};

type BrowserLabWindowApi = NonNullable<Window["__MARKORA_BROWSER_LAB__"]>;
export type LabDiagramSnapshot = ReturnType<BrowserLabWindowApi["diagramSnapshot"]>;
export type LabDiagramNodeTarget = Omit<LabDiagramSnapshot["nodes"][number], "render">;
export type LabDiagramKind = LabDiagramNodeTarget["kind"];
export type LabDiagramRenderSnapshot = LabDiagramSnapshot["nodes"][number]["render"];
export type LabDiagramCommandRequest = Parameters<BrowserLabWindowApi["diagramCommand"]>[1];
export type LabDiagramEditSnapshot = NonNullable<
  ReturnType<BrowserLabWindowApi["pendingDiagramEdit"]>
>;
export type LabDiagramRendererCall = ReturnType<
  BrowserLabWindowApi["diagramRendererCalls"]
>[number];
export type LabDiagramRendererSettlement = NonNullable<
  Parameters<BrowserLabWindowApi["diagramRendererSettle"]>[1]
>;
export type LabHtmlSnapshot = ReturnType<BrowserLabWindowApi["htmlSnapshot"]>;
export type LabHtmlNodeTarget = Omit<LabHtmlSnapshot["nodes"][number], "render">;
export type LabHtmlDisplay = LabHtmlNodeTarget["display"];
export type LabHtmlKind = LabHtmlNodeTarget["kind"];
export type LabHtmlRenderSnapshot = LabHtmlSnapshot["nodes"][number]["render"];
export type LabHtmlCommandRequest = Parameters<BrowserLabWindowApi["htmlCommand"]>[1];
export type LabHtmlEditSnapshot = NonNullable<
  ReturnType<BrowserLabWindowApi["pendingHtmlEdit"]>
>;
export type LabHtmlRendererCall = ReturnType<
  BrowserLabWindowApi["htmlRendererCalls"]
>[number];
export type LabHtmlRendererSettlement = NonNullable<
  Parameters<BrowserLabWindowApi["htmlRendererSettle"]>[1]
>;
export type LabCommandRequest = Parameters<BrowserLabWindowApi["command"]>[1];
export type LabActiveRequest = Parameters<BrowserLabWindowApi["active"]>[1];
export type LabAlertsCommandRequest = Parameters<BrowserLabWindowApi["alertsCommand"]>[1];
export type LabAlertsStateRequest = Parameters<BrowserLabWindowApi["alertsState"]>[1];
export type LabAlertsSnapshot = ReturnType<BrowserLabWindowApi["alertsSnapshot"]>;
export type LabFootnotesCommandRequest = Parameters<BrowserLabWindowApi["footnotesCommand"]>[1];
export type LabFootnoteSelectionRequest = Parameters<BrowserLabWindowApi["selectFootnote"]>[1];
export type LabFootnotesSnapshot = ReturnType<BrowserLabWindowApi["footnotesSnapshot"]>;
export type LabMathCommandRequest = Parameters<BrowserLabWindowApi["mathCommand"]>[1];
export type LabMathNodeTarget = Parameters<BrowserLabWindowApi["selectMath"]>[1];
export type LabMathRendererCall = ReturnType<BrowserLabWindowApi["mathRendererCalls"]>[number];
export type LabMathRendererSettlement = Parameters<BrowserLabWindowApi["mathRendererSettle"]>[1];
export type LabMathSnapshot = ReturnType<BrowserLabWindowApi["mathSnapshot"]>;
export type LabTableIssue = ReturnType<BrowserLabWindowApi["tableIssues"]>[number];
export type LabTocCommandRequest = Parameters<BrowserLabWindowApi["tocCommand"]>[1];
export type LabTocStateRequest = Parameters<BrowserLabWindowApi["tocState"]>[1];
export type LabTocSnapshot = ReturnType<BrowserLabWindowApi["tocSnapshot"]>;

export type LabUpdateOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: Record<string, string> | null;
  editable?: boolean;
  placeholder?: string | null;
};

export type LabEditorSpec = {
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
  diagramMessages?: Partial<Record<
    | "editSource"
    | "invalidDocumentDiagnostic"
    | "invalidInfoDiagnostic"
    | "invalidRendererOutputDiagnostic"
    | "kindLabel"
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
  diagramRendererModes?: Partial<Record<
    LabDiagramKind,
    | "connected"
    | "deferred"
    | "missing"
    | "reject"
    | "string"
    | "sync"
    | "throw"
    | "unsafe"
    | "unsafe-css-var"
    | "wrong-document"
  >>;
  editable?: boolean;
  entry?: "minimal" | "root";
  extensionMode?: "alerts" | "all-advanced" | "diagrams" | "footnotes" | "frontmatter" | "html" | "math" | "public-example" | "toc";
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
  initialSelection?: LabSelectionTarget;
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
    imageEmptyAltTextLabel?: string;
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

export type LabSnapshot = {
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

export type LabExtensionSnapshot = {
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

export type LabTransferSpec = {
  event: "dragover" | "drop" | "paste";
  files?: Array<{ contents: string; name: string; type: string }>;
  html?: string;
  markdown?: string;
  plain?: string;
  target?: "code-mirror" | "prosemirror" | "static-code";
};

type BrowserFailure = {
  detail: string;
  kind: "console" | "pageerror" | "requestfailed" | "response";
};

type BrowserFixtures = {
  labPage: Page;
};

function describeConsoleMessage(message: ConsoleMessage) {
  const location = message.location();
  const suffix = location.url
    ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
    : "";
  return `${message.type()}: ${message.text()}${suffix}`;
}

async function attachDiagnostics(testInfo: TestInfo, failures: BrowserFailure[], page: Page) {
  const state = await page.evaluate(() => {
    const lab = window.__MARKORA_BROWSER_LAB__;
    return {
      listeners: lab?.listenerSnapshot() ?? null,
      mounted: lab?.mountedIds() ?? [],
    };
  }).catch((error: unknown) => ({ evaluateError: String(error) }));

  await testInfo.attach("browser-diagnostics.json", {
    body: JSON.stringify({ failures, state }, null, 2),
    contentType: "application/json",
  });
}

export const test = base.extend<BrowserFixtures>({
  labPage: async ({ page }, use, testInfo) => {
    const failures: BrowserFailure[] = [];
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === "error" || message.type() === "assert") {
        failures.push({ kind: "console", detail: describeConsoleMessage(message) });
      }
    };
    const onPageError = (error: Error) => {
      failures.push({ kind: "pageerror", detail: error.stack ?? error.message });
    };
    const onRequestFailed = (request: { failure(): { errorText: string } | null; method(): string; url(): string }) => {
      failures.push({
        kind: "requestfailed",
        detail: `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
      });
    };
    const onResponse = (response: { request(): { method(): string }; status(): number; url(): string }) => {
      if (response.status() >= 400) {
        failures.push({
          kind: "response",
          detail: `${response.status()} ${response.request().method()} ${response.url()}`,
        });
      }
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);

    await page.goto("/__browser");
    await expect(page.locator("[data-e2e-browser-lab]")).toHaveAttribute("data-ready", "true");

    await use(page);

    await page.evaluate(async () => {
      const lab = window.__MARKORA_BROWSER_LAB__;
      lab?.destroyAll();
      await lab?.settle();
    });

    const teardown = await page.evaluate(() => ({
      editors: document.querySelectorAll("[data-e2e-editor], .ProseMirror, .cm-editor").length,
      listeners: window.__MARKORA_BROWSER_LAB__?.listenerSnapshot() ?? { total: -1, byTargetAndType: {} },
      overlays: document.querySelectorAll(".mdw-link-editor, .mdw-image-editor, .mdw-table-size-editor, .mdw-table-toolbar").length,
    }));

    await attachDiagnostics(testInfo, failures, page);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);

    expect(teardown, "browser lab teardown must release editor DOM, overlays, and global listeners").toEqual({
      editors: 0,
      listeners: { total: 0, byTargetAndType: {} },
      overlays: 0,
    });
    expect(failures, "browser runtime failures").toEqual([]);
  },
});

export { expect } from "@playwright/test";

export async function mountEditor(page: Page, spec: LabEditorSpec) {
  return page.evaluate(
    (nextSpec) => (window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi).mount(nextSpec),
    spec,
  ) as Promise<LabSnapshot>;
}

export async function focusEditor(page: Page, id: string, selection?: LabSelectionTarget) {
  await page.evaluate(
    ({ editorId, target }) => window.__MARKORA_BROWSER_LAB__!.focus(editorId, target),
    { editorId: id, target: selection },
  );
}

export async function blurEditor(page: Page, id: string) {
  await page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.blur(editorId), id);
}

export async function clearEditorEvents(page: Page, id: string) {
  await page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.clearEvents(editorId), id);
}

export async function getEditorEvents(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.events(editorId), id) as Promise<{
    counts: Record<LabEventName, number>;
    log: LabEventRecord[];
  }>;
}

export async function runEditorCommand(page: Page, id: string, request: LabCommandRequest) {
  return page.evaluate(
    ({ editorId, command }) => window.__MARKORA_BROWSER_LAB__!.command(editorId, command),
    { command: request, editorId: id },
  );
}

export async function canRunEditorCommand(page: Page, id: string, request: LabCommandRequest) {
  return page.evaluate(
    ({ editorId, command }) => window.__MARKORA_BROWSER_LAB__!.can(editorId, command),
    { command: request, editorId: id },
  );
}

export async function getEditorActiveState(page: Page, id: string, request: LabActiveRequest) {
  return page.evaluate(
    ({ editorId, active }) => window.__MARKORA_BROWSER_LAB__!.active(editorId, active),
    { active: request, editorId: id },
  );
}

export async function getTableIssues(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.tableIssues(editorId),
    id,
  ) as Promise<readonly LabTableIssue[]>;
}

export async function openEditorUi(
  page: Page,
  id: string,
  kind: "code-language" | "image" | "link" | "table" | "table-create",
) {
  return page.evaluate(
    ({ editorId, uiKind }) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, uiKind),
    { editorId: id, uiKind: kind },
  );
}

export async function unsubscribeEditorEvent(page: Page, id: string, type: LabEventName) {
  return page.evaluate(
    ({ editorId, eventType }) => window.__MARKORA_BROWSER_LAB__!.unsubscribe(editorId, eventType),
    { editorId: id, eventType: type },
  );
}

export async function updateEditorOptions(page: Page, id: string, options: LabUpdateOptions) {
  return page.evaluate(
    ({ editorId, nextOptions }) => window.__MARKORA_BROWSER_LAB__!.updateOptions(editorId, nextOptions),
    { editorId: id, nextOptions: options },
  ) as Promise<{ snapshot: LabSnapshot; statePreserved: boolean }>;
}

export async function copyEditorSelection(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.copySelection(editorId), id);
}

export async function destroyEditorOnly(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.destroyEditor(editorId), id);
}

export async function isEditorDestroyed(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.isDestroyed(editorId), id);
}

export async function remountEditor(
  page: Page,
  id: string,
  options: Omit<LabEditorSpec, "direction" | "id" | "placement" | "portal" | "root"> = {},
) {
  return page.evaluate(
    ({ editorId, nextOptions }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).remount(editorId, nextOptions),
    { editorId: id, nextOptions: options },
  ) as Promise<LabSnapshot>;
}

export async function getMarkdown(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.getMarkdown(editorId), id);
}

export async function getExtensionSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.extensionSnapshot(editorId),
    id,
  ) as Promise<LabExtensionSnapshot>;
}

export async function runAlertsCommand(
  page: Page,
  id: string,
  request: LabAlertsCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.alertsCommand(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getAlertsState(
  page: Page,
  id: string,
  request: LabAlertsStateRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.alertsState(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getAlertsSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.alertsSnapshot(editorId),
    id,
  ) as Promise<LabAlertsSnapshot>;
}

export async function runFootnotesCommand(
  page: Page,
  id: string,
  request: LabFootnotesCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.footnotesCommand(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getFootnotesSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.footnotesSnapshot(editorId),
    id,
  ) as Promise<LabFootnotesSnapshot>;
}

export async function runHtmlCommand(
  page: Page,
  id: string,
  request: LabHtmlCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlCommand(editorId, nextRequest),
    { editorId: id, nextRequest: request },
  );
}

export async function runDiagramCommand(
  page: Page,
  id: string,
  request: LabDiagramCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramCommand(editorId, nextRequest),
    { editorId: id, nextRequest: request },
  );
}

export async function getDiagramSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramSnapshot(editorId),
    id,
  ) as Promise<LabDiagramSnapshot>;
}

export async function getDiagramRendererCalls(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramRendererCalls(editorId),
    id,
  ) as Promise<readonly LabDiagramRendererCall[]>;
}

export async function settleDiagramRenderer(
  page: Page,
  id: string,
  settlement?: LabDiagramRendererSettlement,
) {
  return page.evaluate(
    ({ editorId, nextSettlement }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramRendererSettle(editorId, nextSettlement),
    { editorId: id, nextSettlement: settlement },
  );
}

export async function getPendingDiagramEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).pendingDiagramEdit(editorId),
    id,
  ) as Promise<LabDiagramEditSnapshot | null>;
}

export async function updatePendingDiagramEdit(
  page: Page,
  id: string,
  patch: Readonly<{ info?: string; source?: string }>,
) {
  return page.evaluate(
    ({ editorId, nextPatch }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramEditUpdate(editorId, nextPatch),
    { editorId: id, nextPatch: patch },
  );
}

export async function convertPendingDiagramEdit(
  page: Page,
  id: string,
  kind: LabDiagramKind,
) {
  return page.evaluate(
    ({ editorId, nextKind }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramEditConvert(editorId, nextKind),
    { editorId: id, nextKind: kind },
  );
}

export async function restorePendingDiagramEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramEditRestoreCodeBlock(editorId),
    id,
  );
}

export async function removePendingDiagramEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).diagramEditRemove(editorId),
    id,
  );
}

export async function selectDiagram(
  page: Page,
  id: string,
  target: LabDiagramNodeTarget,
) {
  return page.evaluate(
    ({ editorId, nextTarget }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).selectDiagram(editorId, nextTarget),
    { editorId: id, nextTarget: target },
  );
}

export async function getHtmlSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlSnapshot(editorId),
    id,
  ) as Promise<LabHtmlSnapshot>;
}

export async function getHtmlRendererCalls(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlRendererCalls(editorId),
    id,
  ) as Promise<readonly LabHtmlRendererCall[]>;
}

export async function settleHtmlRenderer(
  page: Page,
  id: string,
  settlement?: LabHtmlRendererSettlement,
) {
  return page.evaluate(
    ({ editorId, nextSettlement }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlRendererSettle(editorId, nextSettlement),
    { editorId: id, nextSettlement: settlement },
  );
}

export async function getPendingHtmlEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).pendingHtmlEdit(editorId),
    id,
  ) as Promise<LabHtmlEditSnapshot | null>;
}

export async function updatePendingHtmlEdit(page: Page, id: string, source: string) {
  return page.evaluate(
    ({ editorId, nextSource }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlEditUpdate(editorId, nextSource),
    { editorId: id, nextSource: source },
  );
}

export async function removePendingHtmlEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).htmlEditRemove(editorId),
    id,
  );
}

export async function selectHtml(
  page: Page,
  id: string,
  target: LabHtmlNodeTarget,
) {
  return page.evaluate(
    ({ editorId, nextTarget }) => (
      window.__MARKORA_BROWSER_LAB__ as BrowserLabWindowApi
    ).selectHtml(editorId, nextTarget),
    { editorId: id, nextTarget: target },
  );
}

export async function runMathCommand(
  page: Page,
  id: string,
  request: LabMathCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.mathCommand(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getMathSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.mathSnapshot(editorId),
    id,
  ) as Promise<LabMathSnapshot>;
}

export async function runTocCommand(
  page: Page,
  id: string,
  request: LabTocCommandRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.tocCommand(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getTocState(
  page: Page,
  id: string,
  request: LabTocStateRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.tocState(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function getTocSnapshot(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.tocSnapshot(editorId),
    id,
  ) as Promise<LabTocSnapshot>;
}

export async function getMathRendererCalls(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.mathRendererCalls(editorId),
    id,
  ) as Promise<readonly LabMathRendererCall[]>;
}

export async function settleMathRenderer(
  page: Page,
  id: string,
  settlement?: LabMathRendererSettlement,
) {
  return page.evaluate(
    ({ editorId, nextSettlement }) => (
      window.__MARKORA_BROWSER_LAB__!.mathRendererSettle(
        editorId,
        nextSettlement,
      )
    ),
    { editorId: id, nextSettlement: settlement },
  );
}

export async function getPendingMathEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.pendingMathEdit(editorId),
    id,
  );
}

export async function updatePendingMathEdit(page: Page, id: string, source: string) {
  return page.evaluate(
    ({ editorId, nextSource }) => (
      window.__MARKORA_BROWSER_LAB__!.mathEditUpdate(editorId, nextSource)
    ),
    { editorId: id, nextSource: source },
  );
}

export async function removePendingMathEdit(page: Page, id: string) {
  return page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.mathEditRemove(editorId),
    id,
  );
}

export async function convertPendingMathEdit(
  page: Page,
  id: string,
  kind: "block" | "inline",
) {
  return page.evaluate(
    ({ editorId, nextKind }) => (
      window.__MARKORA_BROWSER_LAB__!.mathEditConvert(editorId, nextKind)
    ),
    { editorId: id, nextKind: kind },
  );
}

export async function selectMath(
  page: Page,
  id: string,
  target: LabMathNodeTarget,
) {
  return page.evaluate(
    ({ editorId, nextTarget }) => (
      window.__MARKORA_BROWSER_LAB__!.selectMath(editorId, nextTarget)
    ),
    { editorId: id, nextTarget: target },
  );
}

export async function selectToc(page: Page, id: string, occurrence?: number) {
  return page.evaluate(
    ({ editorId, nextOccurrence }) => (
      window.__MARKORA_BROWSER_LAB__!.selectToc(editorId, nextOccurrence)
    ),
    { editorId: id, nextOccurrence: occurrence },
  );
}

export async function selectFootnote(
  page: Page,
  id: string,
  request: LabFootnoteSelectionRequest,
) {
  return page.evaluate(
    ({ editorId, nextRequest }) => (
      window.__MARKORA_BROWSER_LAB__!.selectFootnote(editorId, nextRequest)
    ),
    { editorId: id, nextRequest: request },
  );
}

export async function resetEditor(page: Page, id: string, markdown: string) {
  return page.evaluate(
    ({ editorId, source }) => window.__MARKORA_BROWSER_LAB__!.reset(editorId, source),
    { editorId: id, source: markdown },
  );
}

export async function reconcileEditor(
  page: Page,
  id: string,
  markdown: string,
  options?: { emitChange?: boolean },
) {
  return page.evaluate(
    ({ editorId, nextOptions, source }) => (
      window.__MARKORA_BROWSER_LAB__!.reconcile(editorId, source, nextOptions)
    ),
    { editorId: id, nextOptions: options, source: markdown },
  ) as Promise<{ changed: boolean; snapshot: LabSnapshot }>;
}

export async function settleEditor(page: Page, id?: string) {
  await page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.settle(editorId), id);
}

export async function snapshotEditor(page: Page, id: string) {
  return page.evaluate((editorId) => window.__MARKORA_BROWSER_LAB__!.snapshot(editorId), id) as Promise<LabSnapshot>;
}

export async function dispatchTransfer(page: Page, id: string, spec: LabTransferSpec) {
  return page.evaluate(
    ({ editorId, transferSpec }) => window.__MARKORA_BROWSER_LAB__!.dispatchTransfer(editorId, transferSpec),
    { editorId: id, transferSpec: spec },
  );
}

export function editorLocator(page: Page, id: string) {
  return page.locator(`[data-e2e-editor="${id}"] .ProseMirror`);
}

export function ownedOverlay(page: Page, id: string, selector: string) {
  return page.locator(`${selector}[data-e2e-owner="${id}"]`);
}
