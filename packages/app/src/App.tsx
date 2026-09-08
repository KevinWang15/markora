import { createApplicationActions, matchApplicationShortcut, type ApplicationActionBindings } from "./applicationActions";
import Bold from "@lucide/icons/icons/bold";
import Check from "@lucide/icons/icons/check";
import Clock3 from "@lucide/icons/icons/clock-3";
import Code2 from "@lucide/icons/icons/code";
import FileCode from "@lucide/icons/icons/file-code";
import FilePlus2 from "@lucide/icons/icons/file-plus";
import FileText from "@lucide/icons/icons/file-text";
import Folder from "@lucide/icons/icons/folder";
import FolderOpen from "@lucide/icons/icons/folder-open";
import ImagePlus from "@lucide/icons/icons/image-plus";
import Italic from "@lucide/icons/icons/italic";
import Link2 from "@lucide/icons/icons/link-2";
import ListTree from "@lucide/icons/icons/list-tree";
import PanelLeftClose from "@lucide/icons/icons/panel-left-close";
import PanelLeftOpen from "@lucide/icons/icons/panel-left-open";
import Redo2 from "@lucide/icons/icons/redo-2";
import Search from "@lucide/icons/icons/search";
import Download from "@lucide/icons/icons/download";
import Printer from "@lucide/icons/icons/printer";
import Save from "@lucide/icons/icons/save";
import Sigma from "@lucide/icons/icons/sigma";
import Strikethrough from "@lucide/icons/icons/strikethrough";
import SunMoon from "@lucide/icons/icons/sun-moon";
import Table2 from "@lucide/icons/icons/table-2";
import Undo2 from "@lucide/icons/icons/undo-2";
import X from "@lucide/icons/icons/x";
import { createEditor, type MarkdownEditor, type MarkdownEditorHeadingLevel } from "markora";
import { createTocExtension } from "markora-extension-toc";
import { useDocumentAnalysis } from "./useDocumentAnalysis";
import { createFootnotesExtension } from "markora-extension-footnotes";
import { createMathExtension } from "markora-extension-math";
import { createDiagramsExtension } from "markora-extension-diagrams";
import { createRenderers, type MarkoraRenderers } from "markora-renderers";
import "markora-renderers/styles.css";
import { SourceDialog, type SourceEdit } from "./SourceDialog";
import { createDocumentBridge } from "./documentBridge";
import { FindBar } from "./FindBar";
import { createSearchExtension } from "./searchExtension";
import { findTextMatches, type SearchOptions, type SearchResults } from "./search";
import { DocumentController } from "./DocumentController";
import { createMathContextMenuProvider } from "@markora/react-ui/mathContextMenu";
import { createDiagramContextMenuProvider } from "@markora/react-ui/diagramContextMenu";
import { createDefaultUi } from "markora-ui";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { MarkdownThemeController } from "markora/themes";
import { desktop } from "./desktop";
import { captureExportTheme } from "./exportTheme";
import { type DocumentSnapshot } from "./documentSession";
import { Dialog } from "./Dialog";
import { RecoveryJournal } from "./RecoveryJournal";
import {
  documentNameFromPath,
  isMarkdownPath,
  type DocumentOutlineItem,
  type RecentDocument,
  upsertRecentDocument,
} from "./document";
import { Icon } from "./Icon";
import type { SourceEditorHandle, SourceViewState } from "./SourceEditor";
import { welcomeMarkdown } from "./welcome";

const SourceEditor = lazy(async () => ({
  default: (await import("./SourceEditor")).SourceEditor,
}));

type SidebarTab = "outline" | "recent";
type PendingAction = Readonly<{
  action: () => void | Promise<void>;
  message: string;
  title: string;
}>;

const EMPTY_SEARCH: SearchResults = { matches: [], truncated: false };

const RECENTS_KEY = "markora-app.recent-documents";

function readStoredRecents() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is RecentDocument => Boolean(
          item && typeof item === "object"
          && typeof (item as RecentDocument).name === "string"
          && typeof (item as RecentDocument).path === "string"
          && typeof (item as RecentDocument).touchedAt === "number",
        )).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function formatRecentTime(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function markdownFileFromTransfer(transfer: DataTransfer) {
  const itemFiles = Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = itemFiles.length ? itemFiles : Array.from(transfer.files);
  return files.length === 1 && isMarkdownPath(files[0].name) ? files[0] : null;
}

function ToolbarButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
  shortcut,
}: Readonly<{
  active?: boolean;
  disabled?: boolean;
  icon: Parameters<typeof Icon>[0]["icon"];
  label: string;
  onClick: () => void;
  shortcut?: string;
}>) {
  return (
    <button
      aria-label={label}
      aria-pressed={active || undefined}
      className="app-toolbar-button"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title={shortcut ? `${label} (${shortcut})` : label}
      type="button"
    >
      <Icon icon={icon} />
    </button>
  );
}

export function App({ themeController }: Readonly<{ themeController: MarkdownThemeController }>) {
  const theme = useSyncExternalStore(themeController.subscribe, themeController.getSnapshot);
  const [sourceEdit, setSourceEdit] = useState<SourceEdit | null>(null);
  const renderersRef = useRef<MarkoraRenderers | null>(null);
  const [mathExtension] = useState(() => createMathExtension({ renderer: request => renderersRef.current!.math(request) }));
  const [diagramsExtension] = useState(() => createDiagramsExtension({ renderers: { mermaid: request => renderersRef.current!.diagrams.mermaid(request), plantuml: request => renderersRef.current!.diagrams.plantuml(request) }, onEditSource: request =>
    setSourceEdit({ title: `Edit ${request.kind}`, source: request.source, update: source => request.update({ source }) }) }));
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const sourceEditorRef = useRef<SourceEditorHandle | null>(null);
  const sourceViewRef = useRef<SourceViewState | undefined>(undefined);
  const richScrollRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [searchExtension] = useState(() => createSearchExtension());
  const [tocExtension] = useState(() => createTocExtension());
  const [documentBridge] = useState(() => createDocumentBridge());
  const [controller] = useState(() => new DocumentController(welcomeMarkdown));
  const actionBindings = useRef<ApplicationActionBindings>(null!);
  const [actions] = useState(() => createApplicationActions(
    () => actionBindings.current,
    () => !document.querySelector("dialog[open]"),
  ));
  const { document: documentSnapshot, saving, savingCopy, exporting } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const applyingHistoryRef = useRef(false);
  const resourcePathRef = useRef<string | null>(null);
  const sourceModeRef = useRef(false);
  const sourceEntryMarkdownRef = useRef(welcomeMarkdown);
  const dragDepthRef = useRef(0);
  const [startupReady, setStartupReady] = useState(false);
  const recoveryReadyRef = useRef(false);
  const recoveryRef = useRef<RecoveryJournal | null>(null);
  const [recoveryCandidate, setRecoveryCandidate] = useState<DocumentSnapshot | null>(null);
  const closeRequestedRef = useRef(false);
  const [recents, setRecents] = useState<readonly RecentDocument[]>(readStoredRecents);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("outline");
  const [editorVersion, setEditorVersion] = useState(0);
  const [sourceEditorVersion, setSourceEditorVersion] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [dropFileName, setDropFileName] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({ query: "", caseSensitive: false, wholeWord: false });
  const [replacement, setReplacement] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [sourceConversionWarning, setSourceConversionWarning] = useState<string | null>(null);
  const [tableSaveWarning, setTableSaveWarning] = useState<{ saveAs: boolean; message: string } | null>(null);

  const dirty = documentSnapshot.markdown !== documentSnapshot.savedMarkdown;
  const documentName = documentNameFromPath(documentSnapshot.path);
  const analysis = useDocumentAnalysis(documentSnapshot.markdown, sourceMode && sidebarOpen && sidebarTab === "outline");
  const outline: readonly DocumentOutlineItem[] = sourceMode ? analysis.outline
    : editorRef.current?.extensions.get(tocExtension).state.getSnapshot().headings.map(heading => ({
      id: `heading-${heading.position}`, level: heading.level, text: heading.label, position: heading.position, offset: 0,
    })) ?? [];
  const { words: wordCount, characters: characterCount } = analysis;
  useEffect(() => { if (analysis.error) setError(analysis.error); }, [analysis.error]);

  useEffect(() => {
    desktop.setWindowTitle(`${dirty ? "• " : ""}${documentName} — Markora`);
  }, [dirty, documentName, documentSnapshot.markdown, documentSnapshot.path]);

  useEffect(() => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  }, [recents]);

  const updateLiveMarkdown = useCallback((markdown: string) => {
    if (sourceModeRef.current && !applyingHistoryRef.current) controller.history.record({
      source: markdown, mode: "source", selection: sourceEditorRef.current?.getSelection(),
    }, "source");
    controller.edit(markdown);
  }, []);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const renderers = createRenderers();
    renderersRef.current = renderers;
    const editor = createEditor({
      element: host,
      ariaLabel: "Markdown document",
      markdown: controller.markdown,
      autofocus: true,
      placeholder: "Start writing…",
      attributes: { "data-markora-app-editor": "true" },
      ui: createDefaultUi({ contextMenu: {
        clipboard: desktop.getClipboard(),
        providers: [createMathContextMenuProvider(mathExtension, () => { actions.run("math"); }), createDiagramContextMenuProvider(diagramsExtension)],
        onError: cause => showError(cause, "This editor action could not be completed."),
        transform: items => actions.bindHistoryMenu(items),
      } }),
      extensions: [createFootnotesExtension(), tocExtension, documentBridge, searchExtension, mathExtension, diagramsExtension],
      resources: {
        images: { allowedProtocols: ["http:", "https:", "data:", "file:"] },
        links: { allowedProtocols: ["http:", "https:", "mailto:", "tel:", "file:"] },
        resolveUrl: ({ url }) => desktop.resolveResource(resourcePathRef.current, url),
        openUrl: ({ url }) => desktop.openExternal(url),
        assets: {
          allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
          upload: async ({ file, reportProgress, signal }) => {
            reportProgress(0.2);
            const snapshot = controller.snapshot;
            const image = { file, path: (file as File & { path?: string }).path ?? null };
            let storedUrl = await desktop.storeImage(image, snapshot.path);
            if (signal.aborted || snapshot.id !== controller.snapshot.id) throw new DOMException("Upload cancelled", "AbortError");
            if (snapshot.path !== controller.path) storedUrl = await desktop.storeImage(image, controller.path);
            if (signal.aborted || snapshot.id !== controller.snapshot.id || sourceModeRef.current) throw new DOMException("Upload cancelled", "AbortError");
            reportProgress(1);
            return { kind: "image", url: storedUrl, alt: file.name.replace(/\.[^.]+$/u, "") };
          },
        },
      },
      onChange: updateLiveMarkdown,
    });
    editorRef.current = editor;
    setEditorVersion((version) => version + 1);
    const untrackErrors = editor.subscribe("error", event => {
      setError(event.error instanceof Error ? event.error.message : "The editor could not complete this operation.");
    });
    const untrackAssets = editor.subscribe("asset", event => {
      if (event.upload.error) setError(event.upload.error.message);
    });
    const breakInputHistory = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches("textarea, input")) controller.history.breakGroup();
    };
    editor.view.dom.addEventListener("focusin", breakInputHistory);
    editor.view.dom.addEventListener("focusout", breakInputHistory);
    const untrackHistory = editor.subscribe("update", event => {
      if (applyingHistoryRef.current || event.origin === "reset" || sourceModeRef.current) return;
      const { doc, selection } = editor.view.state;
      controller.history.record({ source: doc, mode: "rich", richSelection: selection.getBookmark() },
        event.origin === "user" ? "rich" : null);
    });
    const unsubscribe = editor.subscribe("state", () => setEditorVersion((version) => version + 1));

    return () => {
      unsubscribe();
      untrackHistory();
      editor.view.dom.removeEventListener("focusin", breakInputHistory);
      editor.view.dom.removeEventListener("focusout", breakInputHistory);
      untrackAssets();
      untrackErrors();
      editor.destroy();
      renderers.destroy();
      renderersRef.current = null;
      editorRef.current = null;
    };
  }, [updateLiveMarkdown]);

  const rememberPath = useCallback((path: string) => {
    setRecents((current) => upsertRecentDocument(current, path));
  }, []);

  const showError = useCallback((cause: unknown, fallback: string) => {
    setError(cause instanceof Error ? cause.message : fallback);

  }, []);

  if (!recoveryRef.current) {
    recoveryRef.current = new RecoveryJournal(snapshot => desktop.writeRecovery(snapshot), cause => showError(cause, "Recovery could not be saved."));
  }

  useEffect(() => {
    if (recoveryReadyRef.current) recoveryRef.current!.schedule(documentSnapshot);
  }, [documentSnapshot, startupReady]);

  const replaceDocument = useCallback((path: string | null, markdown: string) => {
    const previousPath = resourcePathRef.current;
    resourcePathRef.current = path;
    try {
      editorRef.current?.commands.resetMarkdown(markdown);
      editorRef.current?.refreshResources();
    } catch (cause) {
      resourcePathRef.current = previousPath;
      editorRef.current?.refreshResources();
      throw cause;
    }
    sourceEntryMarkdownRef.current = markdown;
    sourceViewRef.current = undefined;
    setSearchIndex(-1);
    richScrollRef.current = 0;
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    controller.replace(path, markdown);
    setDocumentRevision((revision) => revision + 1);
    if (path) rememberPath(path);
    window.requestAnimationFrame(() => {
      if (sourceModeRef.current) sourceEditorRef.current?.focus();
      else editorRef.current?.focus("start");
    });
  }, [rememberPath]);

  const finishRichInput = () => sourceModeRef.current
    || (editorRef.current?.extensions.get(mathExtension).commands.finishEditing() ?? true);

  const saveDocument = useCallback(async (saveAs = false, acceptTableLoss = false) => {
    if (controller.getSnapshot().saving || !finishRichInput()) return false;
    const editor = editorRef.current;
    const issues = !sourceModeRef.current ? editor?.state.tableIssues() ?? [] : [];
    if (issues.length && !acceptTableLoss) {
      setTableSaveWarning({ saveAs, message: [...new Set(issues.map(issue => issue.message))].join(" ") });
      return false;
    }
    setError(null);
    try {
      return await controller.save({
        flush: () => { if (!sourceModeRef.current) editorRef.current?.flushChange(); },
        savingCopy: saveAs && !!controller.path && !!editor,
        write: async snapshot => {
          let assets: { sourcePath: string; urls: string[] } | undefined;
          if (saveAs && snapshot.path && editor) {
            const doc = sourceModeRef.current ? editor.extensions.get(documentBridge).state.parse(snapshot.markdown) : editor.view.state.doc;
            const urls: string[] = [];
            doc?.descendants(node => { if (node.type.name === "image") urls.push(String(node.attrs.src)); });
            assets = { sourcePath: snapshot.path, urls };
          }
          const path = await desktop.saveDocument(saveAs ? null : snapshot.path,
            documentNameFromPath(snapshot.path), snapshot.markdown, assets);
          return desktop.isNative && !path ? null : { path };
        },
        didSave: (snapshot, path) => {
          if (snapshot.id === controller.snapshot.id && resourcePathRef.current !== controller.path) {
            resourcePathRef.current = controller.path;
            editorRef.current?.refreshResources();
          }
          if (path) rememberPath(path);
        },
      });
    } catch (cause) {
      showError(cause, "The document could not be saved.");
      return false;
    }
  }, [controller, rememberPath, showError]);

  const guardUnsaved = useCallback((action: PendingAction["action"], title: string, message: string) => {
    if (document.querySelector("dialog[open]") || !finishRichInput()) return;
    if (!sourceModeRef.current) editorRef.current?.flushChange();
    const run = async () => {
      try { await action(); }
      catch (cause) { showError(cause, "The document could not be changed."); }
    };
    if (!controller.dirty) {
      void run();
      return;
    }
    setError(null);
    setPendingAction({ action: run, title, message });
  }, [showError]);

  const acceptOpenedDocument = useCallback((path: string | null, content: string) => {
    guardUnsaved(() => replaceDocument(path, content), "Save your changes?",
      "Your changes will be lost if you open another document.");
  }, [guardUnsaved, replaceDocument]);

  const openPath = useCallback(async (path: string) => {
    await controller.open(() => desktop.readDocument(path),
      content => acceptOpenedDocument(path, content),
      cause => showError(cause, `Could not open ${documentNameFromPath(path)}.`));
  }, [controller, acceptOpenedDocument, showError]);

  const requestOpenPath = openPath;

  const openDocument = useCallback(async () => {
    await controller.open(() => desktop.openDocument(),
      opened => acceptOpenedDocument(opened.path, opened.content),
      cause => showError(cause, "The document could not be opened."));
  }, [controller, acceptOpenedDocument, showError]);

  const newDocument = useCallback(() => {
    guardUnsaved(
      () => replaceDocument(null, ""),
      "Save your changes?",
      "Your changes will be lost if you create a new document.",
    );
  }, [guardUnsaved, replaceDocument]);

  const toggleSourceMode = useCallback((acceptConversion = false) => {
    acceptConversion = acceptConversion === true;
    if (editorRef.current?.view.composing || sourceEditorRef.current?.isComposing()) return;
    if (document.querySelector("dialog[open]") && !acceptConversion) return;
    controller.history.breakGroup();
    if (sourceModeRef.current) {
      sourceViewRef.current = sourceEditorRef.current?.captureView();
      const markdown = controller.markdown;
      try {
        if (markdown !== sourceEntryMarkdownRef.current) {
          editorRef.current?.commands.reconcileMarkdown(markdown);
        }
      } catch (cause) {
        showError(cause, "The Markdown source could not be rendered.");
        return;
      }
      sourceModeRef.current = false;
      setSourceMode(false);
      window.requestAnimationFrame(() => {
        editorRef.current?.focus();
        if (viewportRef.current) viewportRef.current.scrollTop = richScrollRef.current;
      });
      return;
    }

    const editor = editorRef.current;
    if (!finishRichInput()) return;
    const issues = editor?.state.tableIssues() ?? [];
    if (issues.length && !acceptConversion) {
      setSourceConversionWarning([...new Set(issues.map(issue => issue.message))].join(" "));
      return;
    }
    richScrollRef.current = viewportRef.current?.scrollTop ?? 0;
    editor?.flushChange();
    const markdown = controller.markdown;
    updateLiveMarkdown(markdown);
    sourceEntryMarkdownRef.current = markdown;
    sourceModeRef.current = true;
    setSourceMode(true);
  }, [showError, updateLiveMarkdown]);

  useEffect(() => {
    return desktop.installCloseHandler(() => {
      if (closeRequestedRef.current) return;
      guardUnsaved(() => {
        closeRequestedRef.current = true;
        const snapshot = controller.snapshot;
        recoveryRef.current!.schedule({ ...snapshot, savedMarkdown: snapshot.markdown });
        void recoveryRef.current!.flush().then(() => {
          if (!sourceModeRef.current) editorRef.current?.flushChange();
          const current = controller.snapshot;
          if (current.id !== snapshot.id || current.revision !== snapshot.revision) {
            closeRequestedRef.current = false;
            recoveryRef.current!.schedule(current);
            return;
          }
          desktop.forceClose();
        }).catch(cause => {
          closeRequestedRef.current = false;
          showError(cause, "Recovery could not be saved before closing.");
        });
      }, "Save before closing?", "Your unsaved changes will be lost when Markora closes.");
    });
  }, [guardUnsaved, showError]);

  useEffect(() => {
    let cancelled = false;
    void desktop.readRecovery().then(recovery => {
      if (cancelled) return;
      setStartupReady(true);
      if (recovery) {
        setRecoveryCandidate(recovery);
      } else {
        recoveryReadyRef.current = true;
        const startupPath = desktop.getStartupPath();
        if (startupPath) void openPath(startupPath);
      }
    }, cause => {
      if (!cancelled) {
        setStartupReady(true);
        showError(cause, "Recovery could not be read. It has been left intact.");
      }
    });
    const unsubscribe = desktop.onOpenPath(requestOpenPath);
    return () => { cancelled = true; unsubscribe(); };
  }, [openPath, requestOpenPath, showError]);

  const requestDroppedDocument = useCallback(async (file: File) => {
    await controller.open(() => desktop.openDroppedDocument(file),
      opened => acceptOpenedDocument(opened.path, opened.content),
      cause => showError(cause, `Could not open ${file.name}.`));
  }, [controller, acceptOpenedDocument, showError]);

  useEffect(() => {
    const resetDropTarget = () => {
      dragDepthRef.current = 0;
      setDropFileName(null);
    };
    const handleDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      const file = markdownFileFromTransfer(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setDropFileName(file.name);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      const file = markdownFileFromTransfer(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDropFileName(file.name);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (dragDepthRef.current === 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDropFileName(null);
    };
    const handleDrop = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      const file = markdownFileFromTransfer(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      resetDropTarget();
      requestDroppedDocument(file);
    };

    window.addEventListener("dragenter", handleDragEnter, true);
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("dragleave", handleDragLeave, true);
    window.addEventListener("drop", handleDrop, true);
    window.addEventListener("dragend", resetDropTarget, true);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true);
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("dragleave", handleDragLeave, true);
      window.removeEventListener("drop", handleDrop, true);
      window.removeEventListener("dragend", resetDropTarget, true);
    };
  }, [requestDroppedDocument]);

  const navigateHistory = useCallback((direction: "undo" | "redo") => {
    const editor = editorRef.current;
    if (!editor || editor.view.composing || sourceEditorRef.current?.isComposing() || !finishRichInput()) return;
    if (!sourceModeRef.current) editor.flushChange();
    const entry = controller.history[direction]();
    if (!entry) return;
    const markdown = typeof entry.source === "string"
      ? entry.source : editor.extensions.get(documentBridge).state.serialize(entry.source);
    applyingHistoryRef.current = true;
    try {
      if (!sourceModeRef.current) {
        if (typeof entry.source === "string") {
          editor.commands.resetMarkdown(markdown);
        } else {
          // Rich snapshots can contain structure that Markdown cannot encode.
          // Restore the stored model so undo never silently flattens that data.
          editor.view.dispatch(editor.view.state.tr
            .replaceWith(0, editor.view.state.doc.content.size, entry.source.content)
            .setMeta("addToHistory", false));
        }
        sourceEntryMarkdownRef.current = markdown;
      }
      controller.edit(markdown);
      if (sourceModeRef.current) {
        sourceEditorRef.current?.setMarkdown(markdown, entry.mode === "source" ? entry.selection : undefined);
        sourceEditorRef.current?.focus();
      } else {
        if (entry.mode === "rich" && entry.richSelection) {
          editor.view.dispatch(editor.view.state.tr.setSelection(entry.richSelection.resolve(editor.view.state.doc)));
        }
        editor.focus();
      }
      setEditorVersion(version => version + 1);
    } catch (cause) {
      controller.history[direction === "undo" ? "redo" : "undo"]();
      showError(cause, "This change could not be restored. Try source mode.");
    } finally { applyingHistoryRef.current = false; }
  }, [showError]);

  const sourceMatches = useMemo(() => searchOpen && sourceMode
    ? findTextMatches(documentSnapshot.markdown.replace(/\r\n?/gu, "\n"), searchOptions) : EMPTY_SEARCH,
  [documentSnapshot.markdown, searchOptions, searchOpen, sourceMode]);
  const searchResults = sourceMode ? sourceMatches : editorRef.current?.extensions.get(searchExtension).state.getMatches() ?? EMPTY_SEARCH;

  useEffect(() => {
    editorRef.current?.extensions.get(searchExtension).commands.configure(searchOpen && !sourceMode ? searchOptions : null);
    setSearchIndex(-1);
  }, [searchOpen, sourceMode, searchOptions]);
  useEffect(() => {
    if (sourceMode) sourceEditorRef.current?.setSearch(searchOpen ? sourceMatches.matches : [], searchIndex);
  }, [sourceMode, searchOpen, sourceMatches, searchIndex, documentRevision]);

  const openSearch = useCallback(() => {
    if (document.querySelector("dialog[open]")) return;
    setSearchOpen(true);
    setSearchFocusRequest(value => value + 1);
  }, []);
  const openMath = useCallback(() => {
    const current = editorRef.current;
    if (!current || sourceModeRef.current || controller.getSnapshot().exporting
      || current.view.composing || document.querySelector("dialog[open]")) return;
    controller.history.breakGroup();
    current.extensions.get(mathExtension).commands.editSelection();
  }, []);
  const exportDocument = useCallback(async (format: "html" | "pdf") => {
    if (controller.getSnapshot().exporting || document.querySelector("dialog[open]") || editorRef.current?.view.composing || sourceEditorRef.current?.isComposing()) return;
    const current = editorRef.current;
    if (!current || !finishRichInput()) return;
    current.flushChange();
    const path = controller.snapshot.path;
    try {
      await controller.export(async () => {
        const doc = sourceModeRef.current ? current.extensions.get(documentBridge).state.parse(sourceEditorRef.current?.getMarkdown() ?? controller.markdown) : current.view.state.doc;
        if (!doc) throw new Error("This source could not be parsed for export.");
        const exportTheme = format === "pdf" ? captureExportTheme(current.view.dom, themeController.getSnapshot().id) : undefined;
        const { buildExport, printExport } = await import("./exportDocument");
        const output = await buildExport(doc, documentName, { resolveImage: url => desktop.exportImage(path, url), theme: exportTheme });
        if (format === "html") await desktop.exportHtml(documentName.replace(/\.[^.]+$/u, "") + ".html", output.html);
        else await printExport(output, () => desktop.exportPdf(documentName.replace(/\.[^.]+$/u, "") + ".pdf"), desktop.isNative);
      });
    } catch (cause) { showError(cause, "The document could not be exported."); }
  }, [controller, documentName, showError, themeController, documentBridge]);
  useEffect(() => {
    desktop.installMenu({
      newDocument: () => { actions.run("new"); },
      openDocument: () => { actions.run("open"); },
      saveDocument: () => { actions.run("save"); },
      saveDocumentAs: () => { actions.run("saveAs"); },
      toggleSidebar: () => { actions.run("sidebar"); },
      toggleSourceMode: () => { actions.run("source"); },
      exportPdf: () => { actions.run("exportPdf"); },
      exportHtml: () => { actions.run("exportHtml"); },
      canExport: actions.can("exportPdf"),
      insertMath: () => { actions.run("math"); },
      canInsertMath: actions.can("math"),
      themes: themeController.themes,
      theme: theme.id,
      setTheme: themeController.setTheme,
    });
  }, [actions, themeController, theme.id, exporting, startupReady, sourceMode, pendingAction, recoveryCandidate, sourceEdit, sourceConversionWarning, tableSaveWarning]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (sourceModeRef.current) sourceEditorRef.current?.focus();
    else editorRef.current?.focus();
  }, []);
  const nextMatch = (direction: 1 | -1) => {
    const handle = editorRef.current?.extensions.get(searchExtension);
    if (!sourceModeRef.current) handle?.commands.configure(searchOptions);
    const result = sourceModeRef.current ? sourceMatches : handle?.state.getMatches() ?? EMPTY_SEARCH;
    if (!result.matches.length) return;
    const index = (searchIndex < 0 ? direction > 0 ? 0 : result.matches.length - 1 : searchIndex + direction + result.matches.length) % result.matches.length;
    setSearchIndex(index);
    if (sourceModeRef.current) sourceEditorRef.current?.selectMatch(result.matches[index]);
    else handle?.commands.select(index);
  };
  const replaceMatches = (all: boolean) => {
    if (savingCopy || sourceEditorRef.current?.isComposing() || editorRef.current?.view.composing) return;
    controller.history.breakGroup();
    if (sourceModeRef.current) {
      const matches = findTextMatches(sourceEditorRef.current?.getMarkdown() ?? "", searchOptions);
      if (all && matches.truncated) return;
      sourceEditorRef.current?.replaceMatches(all ? matches.matches : matches.matches.slice(searchIndex, searchIndex + 1), replacement);
    } else {
      const handle = editorRef.current?.extensions.get(searchExtension);
      handle?.commands.configure(searchOptions);
      handle?.commands.replace(replacement, all ? undefined : searchIndex);
      editorRef.current?.flushChange();
    }
    controller.history.breakGroup();
    setSearchIndex(-1);
  };

  useEffect(() => {
    const onHistoryInput = (event: InputEvent) => {
      if (event.isComposing || !(event.target instanceof Element) || !event.target.closest(".app-editor, .app-source-editor")) return;
      if (event.target.closest("textarea, input")) return;
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      event.stopPropagation();
      actions.run(event.inputType === "historyUndo" ? "undo" : "redo");
    };
    window.addEventListener("beforeinput", onHistoryInput, true);
    return () => window.removeEventListener("beforeinput", onHistoryInput, true);
  }, [navigateHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && searchOpen && !event.isComposing && !document.querySelector("dialog[open]")) {
        event.preventDefault(); closeSearch(); return;
      }
      if (document.querySelector("dialog[open]") || event.isComposing) return;
      const ownsHistory = event.target instanceof Element && !event.target.closest("textarea, input") && !!event.target.closest(".app-editor, .app-source-editor");
      const action = matchApplicationShortcut(event, ownsHistory);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      actions.run(action);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [navigateHistory, newDocument, openDocument, openSearch, closeSearch, searchOpen, pendingAction, recoveryCandidate, tableSaveWarning, sourceConversionWarning, saveDocument, toggleSourceMode, openMath]);

  const editor = editorRef.current;
  const active = {
    bold: editor?.state.isActive.mark("strong") ?? false,
    italic: editor?.state.isActive.mark("em") ?? false,
    strike: editor?.state.isActive.mark("strike") ?? false,
    code: editor?.state.isActive.mark("code") ?? false,
  };
  const activeBlock = ([1, 2, 3, 4, 5, 6] as const)
    .find((level) => editor?.state.isActive.heading(level))?.toString() ?? "";
  void editorVersion;
  void sourceEditorVersion;

  const sourceShortcut = desktop.isMac ? "⌘/" : "Ctrl+/";
  // Presentation follows React state. Reading the previous committed DOM here
  // can leave toolbar actions disabled after a dialog unmounts.
  const hasOpenDialog = Boolean(pendingAction || recoveryCandidate || sourceEdit
    || sourceConversionWarning || tableSaveWarning);
  const canInteract = () => !hasOpenDialog
    && !editorRef.current?.view.composing && !sourceEditorRef.current?.isComposing();
  const canEditHistory = () => canInteract() && (sourceModeRef.current || !!editorRef.current?.view.editable);
  actionBindings.current = {
    new: { enabled: canInteract, run: newDocument },
    open: { enabled: canInteract, run: openDocument },
    save: { enabled: () => canInteract() && !controller.getSnapshot().saving, run: async () => { await saveDocument(false); } },
    saveAs: { enabled: () => canInteract() && !controller.getSnapshot().saving, run: async () => { await saveDocument(true); } },
    undo: { enabled: () => canEditHistory() && controller.history.canUndo, run: () => navigateHistory("undo") },
    redo: { enabled: () => canEditHistory() && controller.history.canRedo, run: () => navigateHistory("redo") },
    exportHtml: { enabled: () => canInteract() && !controller.getSnapshot().exporting, run: () => exportDocument("html") },
    exportPdf: { enabled: () => canInteract() && !controller.getSnapshot().exporting, run: () => exportDocument("pdf") },
    math: { enabled: () => canInteract() && startupReady && !sourceModeRef.current && !controller.getSnapshot().exporting, run: openMath },
    search: { enabled: canInteract, run: openSearch },
    source: { enabled: canInteract, run: toggleSourceMode },
    sidebar: { enabled: canInteract, run: () => setSidebarOpen(open => !open) },
  };
  const canUndo = actions.can("undo");
  const canRedo = actions.can("redo");

  const insertLink = () => {
    if (editor?.state.isActive.mark("link")) {
      editor.ui?.editLink();
      return;
    }
    const url = window.prompt("Link URL", "https://");
    if (url?.trim()) editor?.commands.setLink(url.trim());
  };

  const insertImage = async () => {
    const snapshot = controller.snapshot;
    try {
      const image = await desktop.chooseImage();
      if (!image || snapshot.id !== controller.snapshot.id) return;
      let url = await desktop.storeImage(image, snapshot.path);
      if (snapshot.id !== controller.snapshot.id) return;
      if (snapshot.path !== controller.path) url = await desktop.storeImage(image, controller.path);
      if (snapshot.id !== controller.snapshot.id || sourceModeRef.current) return;
      editorRef.current?.commands.insertImage({
        src: url,
        alt: image.file.name.replace(/\.[^.]+$/u, ""),
      });
    } catch (cause) {
      showError(cause, "The image could not be inserted.");
    }
  };

  const scrollToHeading = (item: DocumentOutlineItem) => {
    if (sourceMode) {
      sourceEditorRef.current?.revealOffset(item.offset);
      return;
    }
    if (item.position === undefined || !editor) return;
    editor.focus({ anchor: item.position + 1 });
    const heading = editor.view.nodeDOM(item.position);
    if (heading instanceof HTMLElement) heading.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center",
    });
  };

  return (
    <div className="markora-app mdw-ui" data-theme={theme.id} inert={!startupReady}>
      <header className="app-titlebar">
        <div className="app-titlebar-leading">
          <button
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            className="app-sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            title="Toggle sidebar (Ctrl+Shift+\\)"
            type="button"
          >
            <Icon icon={sidebarOpen ? PanelLeftClose : PanelLeftOpen} size={19} />
          </button>
          <span className="app-brand-mark" aria-hidden="true">M</span>
          <span className="app-brand-name">Markora</span>
        </div>
        <h1 className="app-document-title" title={documentSnapshot.path ?? "Unsaved document"}>
          {documentName}<span className="app-dirty-dot" data-visible={dirty || undefined}>•</span>
        </h1>
        <div className="app-titlebar-actions">
          <label className="app-theme-picker" title={theme.description}>
            <Icon icon={SunMoon} />
            <span className="app-visually-hidden">Theme</span>
            <select aria-label="Theme" value={theme.id} onChange={event => themeController.setTheme(event.target.value)}>
              {themeController.themes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="app-workspace">
        <aside className="app-sidebar" data-open={sidebarOpen || undefined} aria-hidden={!sidebarOpen}>
          <div className="app-sidebar-tabs" role="tablist" aria-label="Sidebar">
            <button
              aria-selected={sidebarTab === "outline"}
              className="app-sidebar-tab"
              onClick={() => setSidebarTab("outline")}
              role="tab"
              type="button"
            >
              <Icon icon={ListTree} size={16} /> Outline
            </button>
            <button
              aria-selected={sidebarTab === "recent"}
              className="app-sidebar-tab"
              onClick={() => setSidebarTab("recent")}
              role="tab"
              type="button"
            >
              <Icon icon={Clock3} size={16} /> Recent
            </button>
          </div>

          {sidebarTab === "outline" ? (
            <nav className="app-outline" aria-label="Document outline" aria-busy={sourceMode && analysis.stale}>
              {outline.length ? outline.map((item) => (
                <button
                  className="app-outline-item"
                  disabled={sourceMode && analysis.stale}
                  key={item.id}
                  onClick={() => scrollToHeading(item)}
                  style={{ "--outline-depth": item.level - 1 } as CSSProperties}
                  title={item.text}
                  type="button"
                >
                  {item.text}
                </button>
              )) : (
                <div className="app-sidebar-empty">
                  <Icon icon={ListTree} size={22} />
                  <span>Add headings to build an outline.</span>
                </div>
              )}
            </nav>
          ) : (
            <div className="app-recents">
              {recents.length ? recents.map((item) => (
                <div className="app-recent-row" key={item.path}>
                  <button className="app-recent-document" onClick={() => requestOpenPath(item.path)} type="button">
                    <Icon icon={FileText} size={17} />
                    <span className="app-recent-copy">
                      <span className="app-recent-name">{item.name}</span>
                      <span className="app-recent-path">{item.path}</span>
                    </span>
                    <span className="app-recent-time">{formatRecentTime(item.touchedAt)}</span>
                  </button>
                  {desktop.isNative && (
                    <button
                      aria-label={`Show ${item.name} in folder`}
                      className="app-reveal-button"
                      onClick={() => desktop.revealFile(item.path)}
                      title="Show in folder"
                      type="button"
                    >
                      <Icon icon={Folder} size={15} />
                    </button>
                  )}
                </div>
              )) : (
                <div className="app-sidebar-empty">
                  <Icon icon={Clock3} size={22} />
                  <span>Your recent documents will appear here.</span>
                </div>
              )}
            </div>
          )}

          <div className="app-sidebar-footer">
            <button onClick={() => { actions.run("new"); }} type="button"><Icon icon={FilePlus2} size={16} /> New</button>
            <button onClick={() => { actions.run("open"); }} type="button"><Icon icon={FolderOpen} size={16} /> Open</button>
          </div>
        </aside>

        <main className="app-main">
          <div className="app-toolbar" role="toolbar" aria-label="Document tools">
            <div className="app-toolbar-group app-file-tools">
              <ToolbarButton icon={FilePlus2} label="New document" onClick={() => { actions.run("new"); }} shortcut="Ctrl+N" />
              <ToolbarButton icon={FolderOpen} label="Open document" onClick={() => { actions.run("open"); }} shortcut="Ctrl+O" />
              <ToolbarButton disabled={saving} icon={saving ? Check : Save} label="Save document" onClick={() => { actions.run("save"); }} shortcut="Ctrl+S" />
              <ToolbarButton disabled={exporting} icon={Download} label="Export HTML" onClick={() => { actions.run("exportHtml"); }} />
              <ToolbarButton disabled={exporting} icon={Printer} label={desktop.isNative ? "Export PDF" : "Print / Save as PDF"} onClick={() => { actions.run("exportPdf"); }} />
            </div>
            <span className="app-toolbar-divider" />
            <div className="app-toolbar-group">
              <ToolbarButton disabled={!canUndo} icon={Undo2} label="Undo" onClick={() => { actions.run("undo"); }} shortcut="Ctrl+Z" />
              <ToolbarButton disabled={!canRedo} icon={Redo2} label="Redo" onClick={() => { actions.run("redo"); }} shortcut="Ctrl+Shift+Z" />
            </div>
            <span className="app-toolbar-divider" />
            <select
              aria-label="Text style"
              className="app-block-select"
              disabled={sourceMode}
              onChange={(event) => {
                const level = Number(event.target.value);
                if (level) editor?.commands.setHeading(level as MarkdownEditorHeadingLevel);
                else editor?.commands.setParagraph();
              }}
              value={activeBlock}
            >
              <option value="">Normal text</option>
              <option value="1">Heading 1</option>
              <option value="2">Heading 2</option>
              <option value="3">Heading 3</option>
              <option value="4">Heading 4</option>
              <option value="5">Heading 5</option>
              <option value="6">Heading 6</option>
            </select>
            <div className="app-toolbar-group">
              <ToolbarButton active={!sourceMode && active.bold} disabled={sourceMode} icon={Bold} label="Bold" onClick={() => editor?.commands.toggleMark("strong")} shortcut="Ctrl+B" />
              <ToolbarButton active={!sourceMode && active.italic} disabled={sourceMode} icon={Italic} label="Italic" onClick={() => editor?.commands.toggleMark("em")} shortcut="Ctrl+I" />
              <ToolbarButton active={!sourceMode && active.strike} disabled={sourceMode} icon={Strikethrough} label="Strikethrough" onClick={() => editor?.commands.toggleMark("strike")} />
              <ToolbarButton active={!sourceMode && active.code} disabled={sourceMode} icon={Code2} label="Inline code" onClick={() => editor?.commands.toggleMark("code")} />
            </div>
            <span className="app-toolbar-divider" />
            <div className="app-toolbar-group">
              <ToolbarButton disabled={sourceMode || exporting} icon={Sigma} label="Insert math" onClick={() => { actions.run("math"); }} shortcut={desktop.isMac ? "⌘Shift+M" : "Ctrl+Shift+M"} />
              <ToolbarButton disabled={sourceMode} icon={Link2} label="Add or edit link" onClick={insertLink} />
              <ToolbarButton disabled={sourceMode} icon={ImagePlus} label="Insert image" onClick={() => void insertImage()} />
              <ToolbarButton disabled={sourceMode} icon={Table2} label="Insert table" onClick={() => editor?.ui?.createTable()} />
            </div>
            <span className="app-toolbar-divider" />
            <div className="app-toolbar-group app-source-tools">
              <ToolbarButton icon={Search} label="Find and replace" onClick={() => { actions.run("search"); }} shortcut="Ctrl+F" />
              <ToolbarButton
                active={sourceMode}
                icon={FileCode}
                label={sourceMode ? "Return to rich text" : "Edit Markdown source"}
                onClick={toggleSourceMode}
                shortcut={sourceShortcut}
              />
            </div>
          </div>

          {searchOpen && <FindBar options={searchOptions} onOptions={options => { setSearchOptions(options); setSearchIndex(-1); }}
            replacement={replacement} onReplacement={setReplacement} results={searchResults} index={searchIndex}
            focusRequest={searchFocusRequest} onNext={nextMatch} onReplace={replaceMatches} onClose={closeSearch} />}

          <div className="app-document-viewport" ref={viewportRef} inert={savingCopy} data-source-mode={sourceMode || undefined}>
            <div className="app-editor" hidden={sourceMode} ref={editorHostRef} />
            {sourceMode && (
              <div className="app-source-shell">
                <Suspense fallback={<div className="app-source-loading">Opening source editor…</div>}>
                  <SourceEditor
                    key={documentRevision}
                    markdown={documentSnapshot.markdown}
                    savedView={sourceViewRef.current}
                    onChange={updateLiveMarkdown}
                    onHistoryChange={() => setSourceEditorVersion((version) => version + 1)}
                    ref={sourceEditorRef}
                  />
                </Suspense>
              </div>
            )}
          </div>

          <footer className="app-statusbar">
            <div className="app-status-leading">
              <button
                className="app-file-location"
                disabled={!documentSnapshot.path || !desktop.isNative}
                onClick={() => documentSnapshot.path && desktop.revealFile(documentSnapshot.path)}
                title={documentSnapshot.path ?? "Save the document to choose a location"}
                type="button"
              >
                {dirty ? "Edited" : documentSnapshot.path ? "Saved" : "Ready"}
              </button>
              {sourceMode && <span className="app-mode-indicator"><Icon icon={FileCode} size={13} /> Source</span>}
            </div>
            <div className="app-document-stats" aria-label={`${wordCount} words, ${characterCount} characters`}>
              <span>{wordCount.toLocaleString()} words</span>
              <span>{characterCount.toLocaleString()} characters</span>
            </div>
          </footer>
        </main>
      </div>

      {dropFileName && (
        <div className="app-drop-overlay" role="status">
          <div className="app-drop-card">
            <span className="app-drop-icon"><Icon icon={FileText} size={27} /></span>
            <strong>Open Markdown document</strong>
            <span>{dropFileName}</span>
          </div>
        </div>
      )}

      {pendingAction && (
        <Dialog title={pendingAction.title} message={pendingAction.message}
          onCancel={() => setPendingAction(null)} busy={saving} error={error ?? undefined}>
          <button className="markora-dialog-button" disabled={saving} onClick={() => setPendingAction(null)} type="button">Cancel</button>
          <button className="markora-dialog-button markora-dialog-button-danger" disabled={saving} onClick={() => {
            const action = pendingAction.action;
            setPendingAction(null);
            void action();
          }} type="button">Don’t save</button>
          <button autoFocus className="markora-dialog-button markora-dialog-button-primary" disabled={saving} onClick={async () => {
            const action = pendingAction.action;
            if (await saveDocument(false)) {
              setPendingAction(null);
              await action();
            }
          }} type="button">{saving ? "Saving…" : "Save"}</button>
        </Dialog>
      )}

      {sourceEdit && <SourceDialog request={sourceEdit} onClose={() => setSourceEdit(null)} onSaved={() => {
        editorRef.current?.flushChange(); controller.history.breakGroup();
      }} />}
      {sourceConversionWarning && (
        <Dialog title="Review source conversion" message={`${sourceConversionWarning} Editing Markdown source may flatten this structure. You can undo the change to recover the rich document.`}
          onCancel={() => setSourceConversionWarning(null)}>
          <button autoFocus className="markora-dialog-button" type="button" onClick={() => setSourceConversionWarning(null)}>Keep rich text</button>
          <button className="markora-dialog-button markora-dialog-button-primary" type="button" onClick={() => {
            setSourceConversionWarning(null);
            toggleSourceMode(true);
          }}>Continue to source</button>
        </Dialog>
      )}

      {tableSaveWarning && (
        <Dialog title="Review table conversion" message={tableSaveWarning.message}
          onCancel={() => setTableSaveWarning(null)} busy={saving} error={error ?? undefined}>
          <button autoFocus className="markora-dialog-button" disabled={saving} onClick={() => setTableSaveWarning(null)} type="button">Keep editing</button>
          <button className="markora-dialog-button markora-dialog-button-primary" disabled={saving} onClick={async () => {
            if (await saveDocument(tableSaveWarning.saveAs, true)) {
              setTableSaveWarning(null);
              if (pendingAction) { const action = pendingAction.action; setPendingAction(null); await action(); }
            }
          }} type="button">Save Markdown</button>
        </Dialog>
      )}

      {recoveryCandidate && (
        <Dialog title="Recover your document?" message={`Unsaved changes to ${documentNameFromPath(recoveryCandidate.path)} were recovered from the previous session.`}
          onCancel={() => {}}>
          <button className="markora-dialog-button" type="button" onClick={() => {
            recoveryReadyRef.current = true;
            setRecoveryCandidate(null);
            recoveryRef.current!.schedule(controller.snapshot);
            const startupPath = desktop.getStartupPath();
            if (startupPath) void openPath(startupPath);
          }}>Discard recovery</button>
          <button autoFocus className="markora-dialog-button markora-dialog-button-primary" type="button" onClick={() => {
            const recovered = recoveryCandidate;
            replaceDocument(recovered.path, recovered.savedMarkdown);
            if (recovered.path) desktop.restoreDiskBaseline(recovered.path, recovered.savedMarkdown);
            sourceModeRef.current = true;
            updateLiveMarkdown(recovered.markdown);
            sourceEntryMarkdownRef.current = recovered.savedMarkdown;
            sourceModeRef.current = true;
            setSourceMode(true);
            recoveryReadyRef.current = true;
            setRecoveryCandidate(null);
          }}>Restore</button>
        </Dialog>
      )}

      {error && (
        <div className="app-toast" role="alert">
          <strong>Error</strong>
          <span>{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)} type="button"><Icon icon={X} size={16} /></button>
        </div>
      )}
    </div>
  );
}
