import { createRenderers } from "markora-renderers";
import "markora-renderers/styles.css";
import { createEditor, type MarkdownEditor } from "markora";
import { createAlertsExtension } from "markora-extension-alerts";
import "markora-extension-alerts/styles.css";
import { createDiagramsExtension } from "markora-extension-diagrams";
import "markora-extension-diagrams/styles.css";
import {
  createFootnotesExtension,
  type FootnotesMessageOverrides,
} from "markora-extension-footnotes";
import "markora-extension-footnotes/styles.css";
import { createFrontmatterExtension } from "markora-extension-frontmatter";
import "markora-extension-frontmatter/styles.css";
import { createHtmlExtension } from "markora-extension-html";
import "markora-extension-html/styles.css";
import { createMathExtension, type MathEditRequest } from "markora-extension-math";
import "markora-extension-math/styles.css";
import { createTocExtension } from "markora-extension-toc";
import "markora-extension-toc/styles.css";
import { createDefaultUi } from "markora-ui";
import {
  NodeSelection,
  TextSelection,
  type Selection,
} from "markora/extension-api";
import { createEditor as createMinimalEditor } from "markora/minimal";
import * as themeApi from "markora/themes";
import { publicExampleExtensions } from "../extensions/publicExampleExtensions";
import {
  canRunBrowserLabCommand,
  clearDiagramRendererArtifacts,
  clearEventTracking,
  clearHtmlRendererArtifacts,
  clearMathRendererArtifacts,
  cloneEditorStyles,
  createBrowserLabDiagramOutput,
  createBrowserLabDiagramRenderers,
  createBrowserLabHtmlOutput,
  createBrowserLabHtmlRenderer,
  createBrowserLabMathOutput,
  createBrowserLabMathRenderer,
  createBrowserLabResources,
  createEventCounts,
  createResourceLog,
  EVENT_NAMES,
  normalizeBrowserLabAlertsMessages,
  normalizeBrowserLabDiagramMessages,
  normalizeBrowserLabHtmlMessages,
  normalizeBrowserLabMathMessages,
  normalizeBrowserLabTocMessages,
  OVERLAY_SELECTOR,
  readBrowserLabActiveState,
  readBrowserLabAlertsState,
  readBrowserLabTocState,
  readExtensionSnapshot,
  readSnapshot,
  renderExtensionActions,
  requireAlertsHandle,
  requireDiagramsHandle,
  requireEditor,
  requireFootnotesHandle,
  requireFrontmatterHandle,
  requireHtmlHandle,
  requireMathHandle,
  requireTocHandle,
  runBrowserLabAlertsCommand,
  runBrowserLabCommand,
  runBrowserLabDiagramCommand,
  runBrowserLabHtmlCommand,
  runBrowserLabMathCommand,
  runBrowserLabTocCommand,
  subscribeToEditorEvents,
  type MountedEditor,
} from "./editorAdapter";
import { createGlobalListenerLedger } from "./listenerLedger";
import type { BrowserLabApi, BrowserLabEditorSpec } from "./protocol";

export function mountBrowserLab(labRoot: HTMLElement) {
  const editors = new Map<string, MountedEditor>();
  const listenerLedger = createGlobalListenerLedger(window);
  let didActivateCodeMirror = false;
  let didAcceptFirefoxCodeMirrorBaseline = false;
  const noteCodeMirrorActivation = (node: Node) => {
    if (
      node instanceof Element &&
      (node.matches(".cm-editor") || node.querySelector(".cm-editor"))
    ) {
      didActivateCodeMirror = true;
    }
  };
  const mountEditorInHost = (
    mounted: MountedEditor,
    spec: Omit<
      BrowserLabEditorSpec,
      "direction" | "entry" | "id" | "placement" | "portal" | "root"
    >,
  ) => {
    mounted.localRenderers?.destroy();
    mounted.localRenderers = spec.localRenderers ? createRenderers() : undefined;
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
    mounted.alertsExtension =
      extensionMode === "alerts" || allAdvanced
        ? createAlertsExtension({
            messages: normalizeBrowserLabAlertsMessages(spec.alertsMessages),
          })
        : null;
    mounted.diagramExtension =
      extensionMode === "diagrams" || allAdvanced
        ? createDiagramsExtension({
            messages: normalizeBrowserLabDiagramMessages(spec.diagramMessages),
            onEditSource(request) {
              mounted.diagramEditRequest = request;
              mounted.section.dataset.pendingDiagramEdit = "true";
            },
            renderers: mounted.localRenderers?.diagrams ?? createBrowserLabDiagramRenderers(
              mounted,
              spec.diagramRendererModes,
            ),
          })
        : null;
    mounted.frontmatterExtension =
      extensionMode === "frontmatter" || allAdvanced
        ? createFrontmatterExtension({
            messages: spec.frontmatterMessages,
            onEditSource(request) {
              mounted.frontmatterEditRequest = request;
              mounted.section.dataset.pendingFrontmatterEdit = "true";
            },
          })
        : null;
    mounted.footnotesExtension =
      extensionMode === "footnotes" || allAdvanced
        ? createFootnotesExtension({
            messages: spec.footnotesMessages
              ? (Object.fromEntries(
                  Object.entries(spec.footnotesMessages).map(
                    ([key, message]) => [key, () => message],
                  ),
                ) as FootnotesMessageOverrides)
              : undefined,
          })
        : null;
    mounted.htmlExtension =
      extensionMode === "html" || allAdvanced
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
    mounted.mathExtension =
      extensionMode === "math" || allAdvanced
        ? createMathExtension({
            messages: normalizeBrowserLabMathMessages(spec.mathMessages),
            ...(spec.mathEditMode === "in-place" ? {} : { onEditSource(request: MathEditRequest) {
              mounted.mathEditRequest = request;
              mounted.section.dataset.pendingMathEdit = "true";
            } }),
            renderer: mounted.localRenderers?.math ?? createBrowserLabMathRenderer(
              mounted,
              spec.mathRendererMode,
            ),
          })
        : null;
    mounted.tocExtension =
      extensionMode === "toc" || allAdvanced
        ? createTocExtension({
            messages: normalizeBrowserLabTocMessages(spec.tocMessages),
          })
        : null;
    const extensions =
      extensionMode === "public-example"
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

    const createEntryEditor =
      mounted.entry === "minimal" ? createMinimalEditor : createEditor;

    mounted.editor = listenerLedger.scope(mounted.id, () =>
      createEntryEditor({
        ariaLabel:
          spec.ariaLabel ??
          (spec.ariaLabelledBy ? undefined : `${mounted.id} Markdown editor`),
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
          mounted.output.dataset.transactionCount = String(
            mounted.transactionCount,
          );
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
              contextMenu: spec.contextMenu,
              portalRoot: mounted.explicitPortalRoot,
            })
          : createDefaultUi({
              messages: spec.uiMessages,
              contextMenu: spec.contextMenu,
            }),
      }),
    );

    subscribeToEditorEvents(mounted);
    renderExtensionActions(mounted);

    for (const overlay of mounted.portalRoot.querySelectorAll<HTMLElement>(
      OVERLAY_SELECTOR,
    )) {
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
      mounted.localRenderers?.destroy();
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
    themes: themeApi,
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
      const callId =
        settlement.callId ?? pendingCallIds[pendingCallIds.length - 1];

      if (callId === undefined) {
        return false;
      }

      const deferred = mounted.diagramRendererDeferred.get(callId);
      const call = mounted.diagramRendererCalls.find(
        ({ id: nextId }) => nextId === callId,
      );

      if (!deferred || !call || call.settled !== "pending") {
        return false;
      }

      mounted.diagramRendererDeferred.delete(callId);

      if (settlement.outcome === "reject") {
        call.settled = "rejected";
        deferred.reject(
          new Error(
            `Browser lab deferred ${call.kind} diagram renderer rejected call ${callId}.`,
          ),
        );
      } else {
        call.settled = "resolved";
        deferred.resolve(
          createBrowserLabDiagramOutput(deferred.request, callId),
        );
      }

      return true;
    },
    diagramSnapshot(id) {
      return requireDiagramsHandle(
        requireEditor(editors, id),
      ).state.getSnapshot();
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
        throw new Error(
          "Browser lab editor ids may contain only letters, numbers, underscores, and hyphens.",
        );
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
      } else if (
        portalMode === "local" ||
        portalMode === "positioned" ||
        portalMode === "transformed"
      ) {
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

      const effectivePortalRoot =
        explicitPortalRoot ??
        (rootMode === "shadow" ? (editorRoot as ShadowRoot) : document.body);
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
      const activeElement =
        mounted.root instanceof ShadowRoot
          ? mounted.root.activeElement
          : mounted.host.ownerDocument.activeElement;
      const target =
        activeElement instanceof Node &&
        mounted.editor.view.dom.contains(activeElement)
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
      mounted.localRenderers?.destroy();
      clearDiagramRendererArtifacts(mounted);
      clearHtmlRendererArtifacts(mounted);
      clearMathRendererArtifacts(mounted);

      for (const button of mounted.extensionActions?.querySelectorAll(
        "button",
      ) ?? []) {
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
      const changed =
        request.type === "insert"
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
      return requireFrontmatterHandle(
        requireEditor(editors, id),
      ).state.getSnapshot();
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
          handled = commands.navigateToDefinition(
            request.label,
            request.occurrence,
          );
          break;
        case "navigateToReference":
          handled = commands.navigateToReference(
            request.label,
            request.occurrence,
          );
          break;
        case "removeDefinition":
          handled = commands.removeDefinition(request.target, {
            references: request.references,
          });
          break;
        case "renameDefinition":
          handled = commands.renameDefinition(
            request.target,
            request.nextLabel,
            {
              references: request.references,
            },
          );
          break;
      }

      if (handled) {
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
      }

      return handled;
    },
    footnotesSnapshot(id) {
      return requireFootnotesHandle(
        requireEditor(editors, id),
      ).state.getSnapshot();
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
      const callId =
        settlement.callId ?? pendingCallIds[pendingCallIds.length - 1];

      if (callId === undefined) {
        return false;
      }

      const deferred = mounted.htmlRendererDeferred.get(callId);
      const call = mounted.htmlRendererCalls.find(
        ({ id: nextId }) => nextId === callId,
      );

      if (!deferred || !call || call.settled !== "pending") {
        return false;
      }

      mounted.htmlRendererDeferred.delete(callId);

      if (settlement.outcome === "reject") {
        call.settled = "rejected";
        deferred.reject(
          new Error(
            `Browser lab deferred HTML renderer rejected call ${callId}.`,
          ),
        );
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
      const callId =
        settlement.callId ?? pendingCallIds[pendingCallIds.length - 1];

      if (callId === undefined) {
        return false;
      }

      const deferred = mounted.mathRendererDeferred.get(callId);
      const call = mounted.mathRendererCalls.find(
        ({ id: nextId }) => nextId === callId,
      );

      if (!deferred || !call || call.settled !== "pending") {
        return false;
      }

      mounted.mathRendererDeferred.delete(callId);

      if (settlement.outcome === "reject") {
        call.settled = "rejected";
        deferred.reject(
          new Error(
            `Browser lab deferred math renderer rejected call ${callId}.`,
          ),
        );
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
        throw new Error(
          `Browser lab editor \"${id}\" must be destroyed before remounting.`,
        );
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
      const changed = mounted.editor.commands.reconcileMarkdown(
        markdown,
        options,
      );
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

      const snapshot =
        request.kind === "definition"
          ? handle.state.getDefinition({ label: request.label, occurrence })
          : (handle.state.getReferences(request.label)[occurrence - 1] ?? null);

      if (!snapshot) {
        return false;
      }

      const view = mounted.editor.view;
      const node = view.state.doc.nodeAt(snapshot.position);
      const expectedType =
        request.kind === "definition"
          ? "footnote_definition"
          : "footnote_reference";

      if (!node || node.type.name !== expectedType || view.composing) {
        return false;
      }

      let selection: Selection = NodeSelection.create(
        view.state.doc,
        snapshot.position,
      );

      if (request.content) {
        if (request.kind !== "definition") {
          return false;
        }

        const from = request.content.from ?? 0;
        const to = request.content.to ?? node.content.size;

        if (
          !Number.isInteger(from) ||
          !Number.isInteger(to) ||
          from < 0 ||
          to < from ||
          to > node.content.size
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
      const expectedType =
        snapshot.display === "inline" ? "html_inline" : "html_block";

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
      const expectedType =
        snapshot.kind === "inline" ? "math_inline" : "math_block";

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
      const snapshot =
        requireTocHandle(mounted).state.getSnapshot().tocs[occurrence - 1];

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
      const to =
        mode === "start"
          ? resolvedMatch.from
          : mode === "end"
            ? resolvedMatch.to
            : resolvedMatch.to;
      mounted.editor.focus({ anchor: from, head: to });
      return true;
    },
    snapshot(id) {
      return readSnapshot(requireEditor(editors, id));
    },
    active(id, request) {
      return readBrowserLabActiveState(
        requireEditor(editors, id).editor,
        request,
      );
    },
    can(id, request) {
      return canRunBrowserLabCommand(
        requireEditor(editors, id).editor,
        request,
      );
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
        didAcceptFirefoxCodeMirrorBaseline =
          listenerLedger.acceptFirefoxCodeMirrorCopyCutBaseline();
      }

      return listenerLedger.snapshot(id);
    },
    dispatchTransfer(id, spec) {
      const mounted = requireEditor(editors, id);
      const target =
        spec.target === "code-mirror"
          ? mounted.editor.view.dom.querySelector<HTMLElement>(".cm-content")
          : spec.target === "static-code"
            ? mounted.editor.view.dom.querySelector<HTMLElement>(
                ".mdw-code-block-static-code",
              )
            : mounted.editor.view.dom;

      if (!target) {
        throw new Error(
          `Browser lab editor \"${id}\" has no ${spec.target ?? "prosemirror"} transfer target.`,
        );
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
        transfer.items.add(
          new File([file.contents], file.name, { type: file.type }),
        );
      }

      const rect = target.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
        composed: true,
      };
      const event =
        spec.event === "paste"
          ? new ClipboardEvent("paste", {
              ...eventInit,
              clipboardData: transfer,
            })
          : new DragEvent(spec.event, { ...eventInit, dataTransfer: transfer });
      const attachedTransfer =
        spec.event === "paste"
          ? (event as ClipboardEvent).clipboardData
          : (event as DragEvent).dataTransfer;

      // Firefox does not retain constructor-supplied transfer data on
      // synthetic clipboard events. Attach it explicitly so this test-only
      // fixture exercises the same product path in every required engine.
      if (attachedTransfer !== transfer) {
        Object.defineProperty(
          event,
          spec.event === "paste" ? "clipboardData" : "dataTransfer",
          {
            configurable: true,
            value: transfer,
          },
        );
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

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
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
}
