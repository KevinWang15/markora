import AlertTriangle from "@lucide/icons/icons/triangle-alert";
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
import Save from "@lucide/icons/icons/save";
import Strikethrough from "@lucide/icons/icons/strikethrough";
import SunMoon from "@lucide/icons/icons/sun-moon";
import Table2 from "@lucide/icons/icons/table-2";
import Undo2 from "@lucide/icons/icons/undo-2";
import X from "@lucide/icons/icons/x";
import { createEditor, type MarkdownEditor, type MarkdownEditorHeadingLevel } from "markora";
import { createDefaultUi } from "markora-ui";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { desktop } from "./desktop";
import {
  countDocumentCharacters,
  countDocumentWords,
  documentNameFromPath,
  isMarkdownPath,
  parseDocumentOutline,
  type RecentDocument,
  upsertRecentDocument,
} from "./document";
import { Icon } from "./Icon";
import type { SourceEditorHandle } from "./SourceEditor";
import { welcomeMarkdown } from "./welcome";

const SourceEditor = lazy(async () => ({
  default: (await import("./SourceEditor")).SourceEditor,
}));

type Theme = "system" | "light" | "dark";
type SidebarTab = "outline" | "recent";
type DocumentSnapshot = Readonly<{
  markdown: string;
  path: string | null;
  savedMarkdown: string;
}>;
type PendingAction = Readonly<{
  action: () => void | Promise<void>;
  message: string;
  title: string;
}>;

const RECENTS_KEY = "markora-app.recent-documents";
const THEME_KEY = "markora-app.theme";

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

function readStoredTheme(): Theme {
  const theme = localStorage.getItem(THEME_KEY);
  return theme === "light" || theme === "dark" ? theme : "system";
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

export function App() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const sourceEditorRef = useRef<SourceEditorHandle | null>(null);
  const pathRef = useRef<string | null>(null);
  const markdownRef = useRef(welcomeMarkdown);
  const savedMarkdownRef = useRef(welcomeMarkdown);
  const dirtyRef = useRef(false);
  const sourceModeRef = useRef(false);
  const sourceEntryMarkdownRef = useRef(welcomeMarkdown);
  const dragDepthRef = useRef(0);
  const closeRequestedRef = useRef(false);
  const [documentSnapshot, setDocumentSnapshot] = useState<DocumentSnapshot>({
    markdown: welcomeMarkdown,
    path: null,
    savedMarkdown: welcomeMarkdown,
  });
  const [recents, setRecents] = useState<readonly RecentDocument[]>(readStoredRecents);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("outline");
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [editorVersion, setEditorVersion] = useState(0);
  const [sourceEditorVersion, setSourceEditorVersion] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [dropFileName, setDropFileName] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = documentSnapshot.markdown !== documentSnapshot.savedMarkdown;
  const documentName = documentNameFromPath(documentSnapshot.path);
  const outline = useMemo(
    () => parseDocumentOutline(documentSnapshot.markdown),
    [documentSnapshot.markdown],
  );
  const wordCount = useMemo(
    () => countDocumentWords(documentSnapshot.markdown),
    [documentSnapshot.markdown],
  );
  const characterCount = useMemo(
    () => countDocumentCharacters(documentSnapshot.markdown),
    [documentSnapshot.markdown],
  );

  useEffect(() => {
    pathRef.current = documentSnapshot.path;
    markdownRef.current = documentSnapshot.markdown;
    dirtyRef.current = dirty;
    desktop.setWindowTitle(`${dirty ? "• " : ""}${documentName} — Markora`);
  }, [dirty, documentName, documentSnapshot.markdown, documentSnapshot.path]);

  useEffect(() => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  }, [recents]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const updateLiveMarkdown = useCallback((markdown: string) => {
    markdownRef.current = markdown;
    dirtyRef.current = markdown !== savedMarkdownRef.current;
    setDocumentSnapshot((current) => ({ ...current, markdown }));
  }, []);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const editor = createEditor({
      element: host,
      ariaLabel: "Markdown document",
      markdown: markdownRef.current,
      autofocus: true,
      placeholder: "Start writing…",
      attributes: { "data-markora-app-editor": "true" },
      ui: createDefaultUi(),
      resources: {
        images: { allowedProtocols: ["http:", "https:", "data:", "file:"] },
        links: { allowedProtocols: ["http:", "https:", "mailto:", "tel:", "file:"] },
        resolveUrl: ({ url }) => desktop.resolveResource(pathRef.current, url),
        openUrl: ({ url }) => desktop.openExternal(url),
        assets: {
          allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
          upload: async ({ file, reportProgress }) => {
            reportProgress(0.2);
            const storedUrl = await desktop.storeImage(
              { file, path: (file as File & { path?: string }).path ?? null },
              pathRef.current,
            );
            reportProgress(1);
            return { kind: "image", url: storedUrl, alt: file.name.replace(/\.[^.]+$/u, "") };
          },
        },
      },
      onChange: updateLiveMarkdown,
    });
    editorRef.current = editor;
    setEditorVersion((version) => version + 1);
    const unsubscribe = editor.subscribe("state", () => setEditorVersion((version) => version + 1));

    return () => {
      unsubscribe();
      editor.destroy();
      editorRef.current = null;
    };
  }, [updateLiveMarkdown]);

  const rememberPath = useCallback((path: string) => {
    setRecents((current) => upsertRecentDocument(current, path));
  }, []);

  const showError = useCallback((cause: unknown, fallback: string) => {
    setError(cause instanceof Error ? cause.message : fallback);
    window.setTimeout(() => setError(null), 5000);
  }, []);

  const replaceDocument = useCallback((path: string | null, markdown: string) => {
    editorRef.current?.commands.resetMarkdown(markdown);
    markdownRef.current = markdown;
    savedMarkdownRef.current = markdown;
    sourceEntryMarkdownRef.current = markdown;
    dirtyRef.current = false;
    pathRef.current = path;
    setDocumentSnapshot({ markdown, path, savedMarkdown: markdown });
    setDocumentRevision((revision) => revision + 1);
    if (path) rememberPath(path);
    window.requestAnimationFrame(() => {
      if (sourceModeRef.current) sourceEditorRef.current?.focus();
      else editorRef.current?.focus("start");
    });
  }, [rememberPath]);

  const saveDocument = useCallback(async (saveAs = false) => {
    const editor = editorRef.current;
    if (!sourceModeRef.current) editor?.flushChange();
    const markdown = sourceModeRef.current
      ? markdownRef.current
      : editor?.getMarkdown() ?? markdownRef.current;
    setSaving(true);
    try {
      const path = await desktop.saveDocument(
        saveAs ? null : pathRef.current,
        documentNameFromPath(pathRef.current),
        markdown,
      );
      if (desktop.isNative && !path) return false;
      pathRef.current = path ?? pathRef.current;
      markdownRef.current = markdown;
      savedMarkdownRef.current = markdown;
      dirtyRef.current = false;
      setDocumentSnapshot({ markdown, path: pathRef.current, savedMarkdown: markdown });
      if (path) rememberPath(path);
      return true;
    } catch (cause) {
      showError(cause, "The document could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [rememberPath, showError]);

  const guardUnsaved = useCallback((action: PendingAction["action"], title: string, message: string) => {
    if (!sourceModeRef.current) editorRef.current?.flushChange();
    if (!dirtyRef.current) {
      void action();
      return;
    }
    setPendingAction({ action, title, message });
  }, []);

  const openPath = useCallback(async (path: string) => {
    try {
      replaceDocument(path, await desktop.readDocument(path));
    } catch (cause) {
      showError(cause, `Could not open ${documentNameFromPath(path)}.`);
    }
  }, [replaceDocument, showError]);

  const requestOpenPath = useCallback((path: string) => {
    guardUnsaved(
      () => openPath(path),
      "Save your changes?",
      `Your changes to ${documentNameFromPath(pathRef.current)} will be lost if you open another document.`,
    );
  }, [guardUnsaved, openPath]);

  const openDocument = useCallback(() => {
    guardUnsaved(async () => {
      try {
        const opened = await desktop.openDocument();
        if (opened) replaceDocument(opened.path, opened.content);
      } catch (cause) {
        showError(cause, "The document could not be opened.");
      }
    }, "Save your changes?", "Your changes will be lost if you open another document.");
  }, [guardUnsaved, replaceDocument, showError]);

  const newDocument = useCallback(() => {
    guardUnsaved(
      () => replaceDocument(null, ""),
      "Save your changes?",
      "Your changes will be lost if you create a new document.",
    );
  }, [guardUnsaved, replaceDocument]);

  const toggleSourceMode = useCallback(() => {
    if (sourceModeRef.current) {
      const markdown = markdownRef.current;
      try {
        if (markdown !== sourceEntryMarkdownRef.current) {
          editorRef.current?.commands.resetMarkdown(markdown);
        }
      } catch (cause) {
        showError(cause, "The Markdown source could not be rendered.");
        return;
      }
      sourceModeRef.current = false;
      setSourceMode(false);
      window.requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }

    const editor = editorRef.current;
    editor?.flushChange();
    const markdown = markdownRef.current;
    updateLiveMarkdown(markdown);
    sourceEntryMarkdownRef.current = markdown;
    sourceModeRef.current = true;
    setSourceMode(true);
  }, [showError, updateLiveMarkdown]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === "system" ? "light" : current === "light" ? "dark" : "system");
  }, []);

  useEffect(() => {
    desktop.installMenu({
      newDocument,
      openDocument,
      saveDocument: () => void saveDocument(false),
      saveDocumentAs: () => void saveDocument(true),
      toggleSidebar: () => setSidebarOpen((open) => !open),
      toggleSourceMode,
      toggleTheme,
    });
  }, [newDocument, openDocument, saveDocument, toggleSourceMode, toggleTheme]);

  useEffect(() => {
    desktop.installCloseHandler(() => {
      if (closeRequestedRef.current) return;
      guardUnsaved(() => {
        closeRequestedRef.current = true;
        desktop.forceClose();
      }, "Save before closing?", "Your unsaved changes will be lost when Markora closes.");
    });
  }, [guardUnsaved]);

  useEffect(() => {
    const startupPath = desktop.getStartupPath();
    if (startupPath) void openPath(startupPath);
    return desktop.onOpenPath(requestOpenPath);
  }, [openPath, requestOpenPath]);

  const requestDroppedDocument = useCallback((file: File) => {
    guardUnsaved(async () => {
      try {
        const opened = await desktop.openDroppedDocument(file);
        replaceDocument(opened.path, opened.content);
      } catch (cause) {
        showError(cause, `Could not open ${file.name}.`);
      }
    }, "Save your changes?", "Your changes will be lost if you open the dropped document.");
  }, [guardUnsaved, replaceDocument, showError]);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pendingAction) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (!event.altKey && !event.shiftKey && (event.code === "Slash" || key === "/")) {
        event.preventDefault();
        event.stopPropagation();
        toggleSourceMode();
      } else if (key === "n") {
        event.preventDefault();
        newDocument();
      } else if (key === "o") {
        event.preventDefault();
        openDocument();
      } else if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      } else if (event.shiftKey && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [newDocument, openDocument, pendingAction, saveDocument, toggleSourceMode]);

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
  const canUndo = sourceMode
    ? sourceEditorRef.current?.canUndo() ?? false
    : editor?.state.can.undo() ?? false;
  const canRedo = sourceMode
    ? sourceEditorRef.current?.canRedo() ?? false
    : editor?.state.can.redo() ?? false;

  const insertLink = () => {
    if (editor?.state.isActive.mark("link")) {
      editor.ui?.editLink();
      return;
    }
    const url = window.prompt("Link URL", "https://");
    if (url?.trim()) editor?.commands.setLink(url.trim());
  };

  const insertImage = async () => {
    try {
      const image = await desktop.chooseImage();
      if (!image) return;
      const url = await desktop.storeImage(image, pathRef.current);
      editorRef.current?.commands.insertImage({
        src: url,
        alt: image.file.name.replace(/\.[^.]+$/u, ""),
      });
    } catch (cause) {
      showError(cause, "The image could not be inserted.");
    }
  };

  const scrollToHeading = (index: number, offset: number) => {
    if (sourceMode) {
      sourceEditorRef.current?.revealOffset(offset);
      return;
    }
    const heading = editorHostRef.current?.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
    heading?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className={`markora-app mdw-ui mdw-theme-${theme === "system" ? "auto" : theme}`} data-theme={theme}>
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
          <ToolbarButton icon={SunMoon} label={`Theme: ${theme}`} onClick={toggleTheme} />
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
            <nav className="app-outline" aria-label="Document outline">
              {outline.length ? outline.map((item, index) => (
                <button
                  className="app-outline-item"
                  key={item.id}
                  onClick={() => scrollToHeading(index, item.offset)}
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
            <button onClick={newDocument} type="button"><Icon icon={FilePlus2} size={16} /> New</button>
            <button onClick={openDocument} type="button"><Icon icon={FolderOpen} size={16} /> Open</button>
          </div>
        </aside>

        <main className="app-main">
          <div className="app-toolbar" role="toolbar" aria-label="Document tools">
            <div className="app-toolbar-group app-file-tools">
              <ToolbarButton icon={FilePlus2} label="New document" onClick={newDocument} shortcut="Ctrl+N" />
              <ToolbarButton icon={FolderOpen} label="Open document" onClick={openDocument} shortcut="Ctrl+O" />
              <ToolbarButton disabled={saving} icon={saving ? Check : Save} label="Save document" onClick={() => void saveDocument(false)} shortcut="Ctrl+S" />
            </div>
            <span className="app-toolbar-divider" />
            <div className="app-toolbar-group">
              <ToolbarButton disabled={!canUndo} icon={Undo2} label="Undo" onClick={() => sourceMode ? sourceEditorRef.current?.undo() : editor?.commands.undo()} shortcut="Ctrl+Z" />
              <ToolbarButton disabled={!canRedo} icon={Redo2} label="Redo" onClick={() => sourceMode ? sourceEditorRef.current?.redo() : editor?.commands.redo()} shortcut="Ctrl+Shift+Z" />
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
              <ToolbarButton disabled={sourceMode} icon={Link2} label="Add or edit link" onClick={insertLink} />
              <ToolbarButton disabled={sourceMode} icon={ImagePlus} label="Insert image" onClick={() => void insertImage()} />
              <ToolbarButton disabled={sourceMode} icon={Table2} label="Insert table" onClick={() => editor?.ui?.createTable()} />
            </div>
            <span className="app-toolbar-divider" />
            <div className="app-toolbar-group app-source-tools">
              <ToolbarButton
                active={sourceMode}
                icon={FileCode}
                label={sourceMode ? "Return to rich text" : "Edit Markdown source"}
                onClick={toggleSourceMode}
                shortcut={sourceShortcut}
              />
            </div>
          </div>

          <div className="app-document-viewport" data-source-mode={sourceMode || undefined}>
            <div className="app-editor" hidden={sourceMode} ref={editorHostRef} />
            {sourceMode && (
              <div className="app-source-shell">
                <Suspense fallback={<div className="app-source-loading">Opening source editor…</div>}>
                  <SourceEditor
                    key={documentRevision}
                    markdown={documentSnapshot.markdown}
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
        <div className="app-dialog-backdrop" role="presentation">
          <section aria-describedby="unsaved-message" aria-labelledby="unsaved-title" aria-modal="true" className="app-dialog" role="alertdialog">
            <div className="app-dialog-icon"><Icon icon={AlertTriangle} size={22} /></div>
            <div className="app-dialog-copy">
              <h2 id="unsaved-title">{pendingAction.title}</h2>
              <p id="unsaved-message">{pendingAction.message}</p>
            </div>
            <div className="app-dialog-actions">
              <button className="app-dialog-button" onClick={() => setPendingAction(null)} type="button">Cancel</button>
              <button
                className="app-dialog-button app-dialog-button-danger"
                onClick={() => {
                  const action = pendingAction.action;
                  setPendingAction(null);
                  void action();
                }}
                type="button"
              >
                Don’t save
              </button>
              <button
                autoFocus
                className="app-dialog-button app-dialog-button-primary"
                onClick={async () => {
                  const action = pendingAction.action;
                  if (await saveDocument(false)) {
                    setPendingAction(null);
                    await action();
                  }
                }}
                type="button"
              >
                Save
              </button>
            </div>
          </section>
        </div>
      )}

      {error && (
        <div className="app-toast" role="alert">
          <Icon icon={AlertTriangle} size={18} />
          <span>{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)} type="button"><Icon icon={X} size={16} /></button>
        </div>
      )}
    </div>
  );
}
