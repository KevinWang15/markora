import {
  createEditor,
  type MarkdownEditor,
  type MarkdownEditorCodeBlockOptions,
  type MarkdownEditorEventName,
  type MarkdownEditorHeadingLevel,
  type MarkdownEditorMark,
  type MarkdownEditorSelectionSnapshot,
  type MarkdownEditorSelectionTarget,
  type MarkdownEditorTableAlignment,
  type MarkdownEditorTableInsertOptions,
  type OpaqueMarkdownEditRequest,
  type UpdateEditorOptions,
} from "markora";
import { createDefaultUi } from "markora-ui";
import { useEffect, useRef } from "react";
import { createGlobalListenerLedger, type ListenerSnapshot } from "../browser-lab/listenerLedger";
import {
  publicCalloutExtension,
  publicExampleExtensions,
} from "../extensions/publicExampleExtensions";

export type BrowserLabRoot = "document" | "shadow";
export type BrowserLabPortal = "body" | "default" | "local" | "positioned" | "transformed";

export type BrowserLabEditorSpec = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  editable?: boolean;
  extensionMode?: "public-example";
  id: string;
  initialSelection?: MarkdownEditorSelectionTarget;
  markdown?: string;
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: BrowserLabPortal;
  root?: BrowserLabRoot;
  resourceMode?: "custom-protocol" | "deny-images" | "immediate-upload" | "proxy-images";
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

export type BrowserLabCommandRequest =
  | { type: BrowserLabNoArgumentCommand }
  | { type: "insertImage"; attrs: { alt?: string | null; src: string; title?: string | null } }
  | { type: "insertTable"; options?: MarkdownEditorTableInsertOptions }
  | { type: "pasteMarkdown" | "pastePlainText"; text: string }
  | { type: "setCodeBlock"; options?: MarkdownEditorCodeBlockOptions }
  | { type: "setHeading"; level: MarkdownEditorHeadingLevel }
  | { type: "setLink"; href: string }
  | { type: "setTableColumnAlignment"; alignment: MarkdownEditorTableAlignment }
  | { type: "setTaskChecked"; checked: boolean }
  | { type: "toggleMark"; mark: MarkdownEditorMark };

export type BrowserLabActiveRequest =
  | { type: "blockquote" | "bulletList" | "hardBreak" | "horizontalRule" | "orderedList" | "paragraph" | "table" | "taskList" }
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
  blur: (id: string) => void;
  clearEvents: (id: string) => void;
  active: (id: string, request: BrowserLabActiveRequest) => boolean;
  can: (id: string, request: BrowserLabCommandRequest) => boolean;
  command: (id: string, request: BrowserLabCommandRequest) => boolean;
  copySelection: (id: string) => BrowserLabCopyResult;
  destroy: (id: string) => boolean;
  destroyEditor: (id: string) => boolean;
  destroyAll: () => void;
  dispatchTransfer: (id: string, spec: BrowserLabTransferSpec) => BrowserLabTransferResult;
  dispatchViewportEvent: (type: "resize" | "scroll") => void;
  events: (id: string) => BrowserLabEventSnapshot;
  extensionSnapshot: (id: string) => BrowserLabExtensionSnapshot;
  focus: (id: string, selection?: MarkdownEditorSelectionTarget) => void;
  getMarkdown: (id: string) => string;
  isDestroyed: (id: string) => boolean;
  listenerSnapshot: (id?: string) => ListenerSnapshot;
  mount: (spec: BrowserLabEditorSpec) => BrowserLabSnapshot;
  mountedIds: () => string[];
  openUi: (id: string, kind: "image" | "link") => boolean;
  pendingOpaqueEdit: (id: string) => Pick<OpaqueMarkdownEditRequest, "kind" | "source"> | null;
  ready: true;
  reconcile: (
    id: string,
    markdown: string,
    options?: { emitChange?: boolean },
  ) => BrowserLabReconcileResult;
  remount: (
    id: string,
    options?: Omit<BrowserLabEditorSpec, "direction" | "id" | "placement" | "portal" | "root">,
  ) => BrowserLabSnapshot;
  resourceLog: (id: string) => BrowserLabResourceLog;
  reset: (id: string, markdown: string) => string;
  selectText: (id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number) => boolean;
  settle: (id?: string) => Promise<void>;
  snapshot: (id: string) => BrowserLabSnapshot;
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
  changeCount: number;
  controlledEcho: boolean;
  editor: MarkdownEditor;
  eventCounts: Record<MarkdownEditorEventName, number>;
  eventLog: BrowserLabEventRecord[];
  eventUnsubscribes: Map<MarkdownEditorEventName, () => void>;
  extensionActions?: HTMLElement;
  extensionMode?: "public-example";
  explicitPortalRoot?: HTMLElement | ShadowRoot;
  host: HTMLElement;
  id: string;
  output: HTMLOutputElement;
  opaqueEditRequest: OpaqueMarkdownEditRequest | null;
  portalRoot: HTMLElement | ShadowRoot;
  root: Document | ShadowRoot;
  resourceLog: BrowserLabResourceLog;
  section: HTMLElement;
  transactionCount: number;
};

const OVERLAY_SELECTOR = ".mdw-link-editor, .mdw-image-editor, .mdw-table-toolbar";
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
    case "addTableColumn": return editor.commands.addTableColumn();
    case "addTableRow": return editor.commands.addTableRow();
    case "deleteTable": return editor.commands.deleteTable();
    case "deleteTableColumn": return editor.commands.deleteTableColumn();
    case "deleteTableRow": return editor.commands.deleteTableRow();
    case "insertHardBreak": return editor.commands.insertHardBreak();
    case "insertHorizontalRule": return editor.commands.insertHorizontalRule();
    case "insertImage": return editor.commands.insertImage(request.attrs);
    case "insertTable": return editor.commands.insertTable(request.options);
    case "liftListItem": return editor.commands.liftListItem();
    case "pasteMarkdown": return editor.commands.pasteMarkdown(request.text);
    case "pastePlainText": return editor.commands.pastePlainText(request.text);
    case "redo": return editor.commands.redo();
    case "removeImage": return editor.commands.removeImage();
    case "removeLink": return editor.commands.removeLink();
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
    case "addTableColumn": return editor.state.can.addTableColumn();
    case "addTableRow": return editor.state.can.addTableRow();
    case "deleteTable": return editor.state.can.deleteTable();
    case "deleteTableColumn": return editor.state.can.deleteTableColumn();
    case "deleteTableRow": return editor.state.can.deleteTableRow();
    case "insertHardBreak": return editor.state.can.insertHardBreak();
    case "insertHorizontalRule": return editor.state.can.insertHorizontalRule();
    case "insertImage": return editor.state.can.insertImage();
    case "insertTable": return editor.state.can.insertTable(request.options);
    case "liftListItem": return editor.state.can.liftListItem();
    case "pasteMarkdown": return editor.state.can.pasteMarkdown();
    case "pastePlainText": return editor.state.can.pastePlainText();
    case "redo": return editor.state.can.redo();
    case "removeImage": return editor.state.can.removeImage();
    case "removeLink": return editor.state.can.removeLink();
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
      spec: Omit<BrowserLabEditorSpec, "direction" | "id" | "placement" | "portal" | "root">,
    ) => {
      mounted.controlledEcho = spec.controlledEcho ?? false;
      const extensionMode = spec.extensionMode ?? mounted.extensionMode;
      mounted.extensionMode = extensionMode;
      const existingOverlays = new Set(
        mounted.portalRoot.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR),
      );

      mounted.editor = listenerLedger.scope(mounted.id, () => createEditor({
        ariaLabel: spec.ariaLabel ?? (spec.ariaLabelledBy ? undefined : `${mounted.id} Markdown editor`),
        ariaLabelledBy: spec.ariaLabelledBy,
        attributes: spec.attributes,
        autofocus: spec.autofocus,
        editable: spec.editable,
        element: mounted.host,
        extensions: extensionMode === "public-example" ? publicExampleExtensions : undefined,
        initialSelection: spec.initialSelection,
        markdown: spec.markdown ?? `# ${mounted.id}\n\nBrowser lab paragraph.`,
        onChangeMode: "animationFrame",
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
        ui: mounted.explicitPortalRoot
          ? createDefaultUi({ portalRoot: mounted.explicitPortalRoot })
          : createDefaultUi(),
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
          changeCount: 0,
          controlledEcho: false,
          editor: null as unknown as MarkdownEditor,
          eventCounts: createEventCounts(),
          eventLog: [],
          eventUnsubscribes: new Map(),
          extensionMode: spec.extensionMode,
          explicitPortalRoot,
          host,
          id,
          opaqueEditRequest: null,
          output,
          portalRoot: effectivePortalRoot,
          root: editorRoot,
          resourceLog: createResourceLog(),
          section,
          transactionCount: 0,
        };

        try {
          mountEditorInHost(mounted, spec);
        } catch (error) {
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
        mounted.opaqueEditRequest = null;
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
        mounted.opaqueEditRequest = null;
        delete mounted.section.dataset.pendingOpaqueKind;
        const changed = mounted.editor.commands.reconcileMarkdown(markdown, options);
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();

        return {
          changed,
          snapshot: readSnapshot(mounted),
        };
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
        return kind === "link" ? Boolean(ui?.editLink()) : Boolean(ui?.editImage());
      },
      pendingOpaqueEdit(id) {
        const request = requireEditor(editors, id).opaqueEditRequest;
        return request ? { kind: request.kind, source: request.source } : null;
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
