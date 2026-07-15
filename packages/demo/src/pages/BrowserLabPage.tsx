import {
  createEditor,
  type MarkdownEditor,
  type MarkdownEditorMark,
  type OpaqueMarkdownEditRequest,
} from "markora";
import { createDefaultUi } from "markora-ui";
import { TextSelection } from "prosemirror-state";
import { useEffect, useRef } from "react";
import { createGlobalListenerLedger, type ListenerSnapshot } from "../browser-lab/listenerLedger";

export type BrowserLabRoot = "document" | "shadow";
export type BrowserLabPortal = "body" | "default" | "local" | "positioned" | "transformed";

export type BrowserLabEditorSpec = {
  id: string;
  markdown?: string;
  placement?: "bottom-right" | "normal";
  portal?: BrowserLabPortal;
  root?: BrowserLabRoot;
};

export type BrowserLabSnapshot = {
  activeElement: string | null;
  changeCount: number;
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

export type BrowserLabApi = {
  command: (
    id: string,
    command: "insertImage" | "redo" | "setLink" | "toggleMark" | "undo",
    value?: string | { alt?: string | null; src: string; title?: string | null } | MarkdownEditorMark,
  ) => boolean;
  destroy: (id: string) => boolean;
  destroyAll: () => void;
  dispatchViewportEvent: (type: "resize" | "scroll") => void;
  getMarkdown: (id: string) => string;
  listenerSnapshot: (id?: string) => ListenerSnapshot;
  mount: (spec: BrowserLabEditorSpec) => BrowserLabSnapshot;
  mountedIds: () => string[];
  openUi: (id: string, kind: "image" | "link") => boolean;
  pendingOpaqueEdit: (id: string) => Pick<OpaqueMarkdownEditRequest, "kind" | "source"> | null;
  ready: true;
  reset: (id: string, markdown: string) => string;
  selectText: (id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number) => boolean;
  settle: (id?: string) => Promise<void>;
  snapshot: (id: string) => BrowserLabSnapshot;
  updateOpaque: (id: string, source: string) => boolean;
};

declare global {
  interface Window {
    __MARKORA_BROWSER_LAB__?: BrowserLabApi;
  }
}

type MountedEditor = {
  changeCount: number;
  editor: MarkdownEditor;
  host: HTMLElement;
  output: HTMLOutputElement;
  opaqueEditRequest: OpaqueMarkdownEditRequest | null;
  root: Document | ShadowRoot;
  section: HTMLElement;
  transactionCount: number;
};

const OVERLAY_SELECTOR = ".mdw-link-editor, .mdw-image-editor, .mdw-table-toolbar";

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

export function BrowserLabPage() {
  const labRootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const labRoot = labRootRef.current;

    if (!labRoot) {
      return;
    }

    const editors = new Map<string, MountedEditor>();
    const listenerLedger = createGlobalListenerLedger(window);
    const codeMirrorBaselineOwner = "__codemirror-browser-baseline";
    const codeMirrorBaselineHost = document.createElement("div");
    codeMirrorBaselineHost.hidden = true;
    labRoot.append(codeMirrorBaselineHost);
    const codeMirrorBaselineEditor = listenerLedger.scope(codeMirrorBaselineOwner, () => createEditor({
      element: codeMirrorBaselineHost,
      markdown: "```\nbrowser baseline\n```",
    }));
    codeMirrorBaselineEditor.destroy();
    codeMirrorBaselineHost.remove();
    const codeMirrorBaseline = listenerLedger.snapshot(codeMirrorBaselineOwner);
    const expectedFirefoxBaseline = codeMirrorBaseline.total === 2
      && codeMirrorBaseline.byTargetAndType["document:copy"] === 1
      && codeMirrorBaseline.byTargetAndType["document:cut"] === 1
      && Object.keys(codeMirrorBaseline.byTargetAndType).length === 2;

    if (codeMirrorBaseline.total !== 0 && !expectedFirefoxBaseline) {
      throw new Error(`Unexpected CodeMirror global-listener baseline: ${JSON.stringify(codeMirrorBaseline)}`);
    }

    // CodeMirror intentionally installs one document-level copy/cut pair per
    // Firefox document to work around an upstream empty-selection bug. Warm it
    // before measurements so editor lifecycle deltas remain exact.
    listenerLedger.acceptBaseline(codeMirrorBaselineOwner);

    const destroy = (id: string) => {
      const mounted = editors.get(id);

      if (!mounted) {
        return false;
      }

      mounted.editor.destroy();
      mounted.section.remove();
      editors.delete(id);
      return true;
    };

    const destroyAll = () => {
      for (const id of [...editors.keys()]) {
        destroy(id);
      }
    };

    const api: BrowserLabApi = {
      ready: true,
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
        section.append(output);
        labRoot.append(section);

        const effectivePortalRoot = explicitPortalRoot
          ?? (rootMode === "shadow" ? editorRoot as ShadowRoot : document.body);
        const existingOverlays = new Set(effectivePortalRoot.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR));
        const mounted: MountedEditor = {
          changeCount: 0,
          editor: null as unknown as MarkdownEditor,
          host,
          opaqueEditRequest: null,
          output,
          root: editorRoot,
          section,
          transactionCount: 0,
        };

        try {
          mounted.editor = listenerLedger.scope(id, () => createEditor({
            element: host,
            markdown: spec.markdown ?? `# ${id}\n\nBrowser lab paragraph.`,
            onChangeMode: "animationFrame",
            onChange(markdown) {
              mounted.changeCount += 1;
              output.dataset.changeCount = String(mounted.changeCount);
              output.textContent = markdown;
            },
            onTransaction() {
              mounted.transactionCount += 1;
              output.dataset.transactionCount = String(mounted.transactionCount);
            },
            onEditOpaqueMarkdown(request) {
              mounted.opaqueEditRequest = request;
              section.dataset.pendingOpaqueKind = request.kind;
            },
            ui: explicitPortalRoot
              ? createDefaultUi({ portalRoot: explicitPortalRoot })
              : createDefaultUi(),
          }));

        } catch (error) {
          section.remove();
          throw error;
        }

        for (const overlay of effectivePortalRoot.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
          if (!existingOverlays.has(overlay)) {
            overlay.dataset.e2eOwner = id;
          }
        }

        output.textContent = mounted.editor.getMarkdown();
        editors.set(id, mounted);
        return readSnapshot(mounted);
      },
      destroy,
      destroyAll,
      getMarkdown(id) {
        const mounted = requireEditor(editors, id);
        mounted.editor.flushChange();
        return mounted.editor.getMarkdown();
      },
      reset(id, markdown) {
        const mounted = requireEditor(editors, id);
        mounted.opaqueEditRequest = null;
        delete mounted.section.dataset.pendingOpaqueKind;
        mounted.editor.commands.setMarkdown(markdown, { emitChange: true });
        mounted.editor.flushChange();
        mounted.output.textContent = mounted.editor.getMarkdown();
        return mounted.editor.getMarkdown();
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
        const selection = TextSelection.create(mounted.editor.view.state.doc, from, to);
        mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(selection).scrollIntoView());
        mounted.editor.view.focus();
        return true;
      },
      snapshot(id) {
        return readSnapshot(requireEditor(editors, id));
      },
      command(id, command, value) {
        const editor = requireEditor(editors, id).editor;

        switch (command) {
          case "insertImage":
            return typeof value === "object" && value !== null
              ? editor.commands.insertImage(value)
              : false;
          case "redo":
            return editor.commands.redo();
          case "setLink":
            return typeof value === "string" ? editor.commands.setLink(value) : false;
          case "toggleMark":
            return value === "strong" || value === "em" || value === "code" || value === "strike"
              ? editor.commands.toggleMark(value)
              : false;
          case "undo":
            return editor.commands.undo();
        }
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
      listenerSnapshot(id) {
        return listenerLedger.snapshot(id);
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
    <main ref={labRootRef} className="browser-lab" data-e2e-browser-lab data-ready="false">
      <h1 className="browser-lab-title">Markora browser regression lab</h1>
    </main>
  );
}
