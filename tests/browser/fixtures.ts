import { expect, test as base, type ConsoleMessage, type Page, type TestInfo } from "@playwright/test";

export type LabSelectionTarget =
  | "all"
  | "end"
  | "start"
  | { anchor: number; head?: number };

export type LabEventName = "blur" | "error" | "focus" | "selection" | "update";

export type LabSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: "all" | "managed-block" | "node" | "other" | "text";
  to: number;
};

export type LabEventRecord = {
  code?: string;
  contribution?: string;
  extension?: string;
  language?: string;
  message?: string;
  phase?: string;
  previousSelection?: LabSelectionSnapshot;
  selection?: LabSelectionSnapshot;
  type: LabEventName;
};

export type LabUpdateOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: Record<string, string> | null;
  editable?: boolean;
  placeholder?: string | null;
};

export type LabEditorSpec = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  editable?: boolean;
  extensionMode?: "public-example";
  id: string;
  initialSelection?: LabSelectionTarget;
  markdown?: string;
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: "body" | "default" | "local" | "positioned" | "transformed";
  root?: "document" | "shadow";
};

export type LabSnapshot = {
  activeElement: string | null;
  changeCount: number;
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
  target?: "code-mirror" | "prosemirror";
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
      overlays: document.querySelectorAll(".mdw-link-editor, .mdw-image-editor, .mdw-table-toolbar").length,
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
  return page.evaluate((nextSpec) => window.__MARKORA_BROWSER_LAB__!.mount(nextSpec), spec) as Promise<LabSnapshot>;
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
    ({ editorId, nextOptions }) => window.__MARKORA_BROWSER_LAB__!.remount(editorId, nextOptions),
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
