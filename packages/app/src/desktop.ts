import type { ContextMenuClipboard } from "markora-ui";
import { atomicWrite, copyRelativeImages, isMissingFile, readIfPresent, saveFile, type FileSystem, type PathModule } from "./persistence";
import type { DocumentSnapshot } from "./documentSession";
import { extractOpenPath, parseCommandLineArguments } from "./document";

export type OpenedDocument = Readonly<{
  content: string;
  path: string | null;
}>;

export type PickedImage = Readonly<{
  file: File;
  path: string | null;
}>;

export type DesktopMenuActions = Readonly<{
  newDocument: () => void;
  openDocument: () => void;
  saveDocument: () => void;
  saveDocumentAs: () => void;
  exportPdf: () => void;
  exportHtml: () => void;
  canExport: boolean;
  insertMath: () => void;
  canInsertMath: boolean;
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
  themes: readonly Readonly<{ id: string; label: string }>[];
  theme: string;
  setTheme: (id: string) => void;
}>;

type NodeUrl = {
  pathToFileURL: (path: string) => URL;
  fileURLToPath: (url: string) => string;
};

type NwMenu = {
  append: (item: NwMenuItem) => void;
  insert: (item: NwMenuItem, index: number) => void;
  createMacBuiltin?: (applicationName: string, options?: { hideEdit?: boolean; hideWindow?: boolean }) => void;
};

type NwMenuItem = { checked?: boolean };

type NwWindow = {
  menu: NwMenu | null;
  on: (event: "close", listener: () => void) => void;
  removeListener: (event: "close", listener: () => void) => void;
  close: (force?: boolean) => void;
};

type NwRuntime = {
  Clipboard?: { get: () => {
    get: (type: "text" | "html") => string;
    set: (items: { type: "text" | "html"; data: string }[]) => void;
    readAvailableTypes: () => string[];
  } };
  App: {
    argv: string[];
    startPath: string;
    dataPath: string;
    on: (event: "open", listener: (commandLine: string) => void) => void;
    removeListener: (event: "open", listener: (commandLine: string) => void) => void;
  };
  Menu: new (options?: { type?: "menubar" | "contextmenu" }) => NwMenu;
  MenuItem: new (options: Record<string, unknown>) => NwMenuItem;
  Shell: {
    openExternal: (url: string) => void;
    showItemInFolder: (path: string) => void;
  };
  Window: { get: () => NwWindow };
  process: { platform: string };
  require: (module: string) => unknown;
};

declare global {
  interface Window {
    nw?: NwRuntime;
  }
}

function getNw() {
  return window.nw;
}

function getNodeModules() {
  const runtime = getNw();
  if (!runtime) return null;
  return {
    fs: runtime.require("node:fs/promises") as FileSystem,
    path: runtime.require("node:path") as PathModule,
    url: runtime.require("node:url") as NodeUrl,
  };
}

function pickFile(options: Readonly<{
  accept: string;
  saveAs?: string;
  workingDirectory?: string;
}>) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    if (options.saveAs) input.setAttribute("nwsaveas", options.saveAs);
    if (options.workingDirectory) input.setAttribute("nwworkingdir", options.workingDirectory);
    input.style.display = "none";

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

function nativeFilePath(file: File) {
  return (file as File & { path?: string }).path ?? null;
}

async function fileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function createNativeMenu(actions: DesktopMenuActions) {
  const runtime = getNw();
  if (!runtime) return;
  const menu = new runtime.Menu({ type: "menubar" });
  const isMac = runtime.process.platform === "darwin";
  const modifier = isMac ? "cmd" : "ctrl";
  const appendItem = (target: NwMenu, options: Record<string, unknown>) => {
    target.append(new runtime.MenuItem(options));
  };

  if (isMac && menu.createMacBuiltin) {
    menu.createMacBuiltin("Markora", { hideEdit: false, hideWindow: false });
  }

  const file = new runtime.Menu();
  appendItem(file, { label: "New", key: "n", modifiers: modifier, click: actions.newDocument });
  appendItem(file, { label: "Open…", key: "o", modifiers: modifier, click: actions.openDocument });
  appendItem(file, { type: "separator" });
  appendItem(file, { label: "Save", key: "s", modifiers: modifier, click: actions.saveDocument });
  appendItem(file, { label: "Save As…", key: "s", modifiers: `${modifier}-shift`, click: actions.saveDocumentAs });
  appendItem(file, { type: "separator" });
  const exports = new runtime.Menu();
  appendItem(exports, { label: "PDF…", enabled: actions.canExport, click: actions.exportPdf });
  appendItem(exports, { label: "HTML…", enabled: actions.canExport, click: actions.exportHtml });
  appendItem(file, { label: "Export", submenu: exports });
  appendItem(file, { type: "separator" });
  appendItem(file, { label: "Close", key: "w", modifiers: modifier, click: () => runtime.Window.get().close() });
  const fileItem = new runtime.MenuItem({ label: "File", submenu: file });
  // Keep the standard App, Edit and Window menus on macOS.
  if (isMac && menu.createMacBuiltin) menu.insert(fileItem, 1);
  else menu.append(fileItem);

  const insert = new runtime.Menu();
  appendItem(insert, { label: "Math", key: "m", modifiers: `${modifier}-shift`, enabled: actions.canInsertMath, click: actions.insertMath });
  const insertItem = new runtime.MenuItem({ label: "Insert", submenu: insert });
  if (isMac && menu.createMacBuiltin) menu.insert(insertItem, 3);
  else menu.append(insertItem);

  const view = new runtime.Menu();
  appendItem(view, { label: "Toggle Sidebar", key: "\\", modifiers: `${modifier}-shift`, click: actions.toggleSidebar });
  appendItem(view, { label: "Source Mode", key: "/", modifiers: modifier, click: actions.toggleSourceMode });
  const viewItem = new runtime.MenuItem({ label: "View", submenu: view });
  if (isMac && menu.createMacBuiltin) menu.insert(viewItem, 4);
  else menu.append(viewItem);

  const themes = new runtime.Menu();
  for (const theme of actions.themes) {
    const item: NwMenuItem = new runtime.MenuItem({
      label: theme.label,
      type: "checkbox",
      checked: actions.theme === theme.id,
      click: () => {
        // Native checkboxes toggle before invoking click; a selected theme stays checked.
        item.checked = true;
        actions.setTheme(theme.id);
      },
    });
    themes.append(item);
  }
  menu.append(new runtime.MenuItem({ label: "Themes", submenu: themes }));
  runtime.Window.get().menu = menu;
}

const diskBaselines = new Map<string, string | null>();

export const desktop = {
  /** Native clipboard transport; document semantics remain in editor.clipboard. */
  getClipboard(): ContextMenuClipboard | undefined {
    const clipboard = getNw()?.Clipboard?.get();
    if (!clipboard) return undefined;
    return {
      async read() {
        const types = clipboard.readAvailableTypes();
        if (!types.includes("text") && !types.includes("html")) throw new Error("The clipboard does not contain supported text.");
        return { text: types.includes("text") ? clipboard.get("text") : "",
          html: types.includes("html") ? clipboard.get("html") : undefined };
      },
      async write(content) {
        // One multi-format write preserves both formats; separate writes would overwrite each other.
        const items: { type: "text" | "html"; data: string }[] = [{ type: "text", data: content.text }];
        if (content.html) items.push({ type: "html", data: content.html });
        clipboard.set(items);
      },
    };
  },
  isNative: Boolean(getNw()),
  isMac: getNw()?.process.platform === "darwin",

  async exportHtml(suggestedName: string, content: string) {
    const modules = getNodeModules();
    if (!modules) {
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
      link.href = url; link.download = suggestedName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const file = await pickFile({ accept: ".html,text/html", saveAs: suggestedName });
    const destination = file && nativeFilePath(file);
    if (!destination) return;
    await saveFile(modules.fs, modules.path, destination, content, await readIfPresent(modules.fs, destination));
  },

  async exportImage(documentPath: string | null, storedUrl: string) {
    const url = this.resolveResource(documentPath, storedUrl);
    const modules = getNodeModules();
    if (!url.startsWith("file:") || !modules) return url;
    const path = modules.url.fileURLToPath(url);
    const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
    const type = mime[modules.path.extname(path).toLowerCase()];
    if (!type) throw new Error("Only PNG, JPEG, GIF, WebP and SVG images can be embedded in an export.");
    if ((await modules.fs.stat(path)).size > 20 * 1024 * 1024) throw new Error("An image exceeds the 20 MB export limit.");
    return `data:${type};base64,${(await modules.fs.readFile(path)).toString("base64")}`;
  },

  async exportPdf(suggestedName: string) {
    const modules = getNodeModules();
    if (!modules) { window.print(); return; }
    const file = await pickFile({ accept: ".pdf,application/pdf", saveAs: suggestedName });
    const destination = file && nativeFilePath(file);
    if (!destination) return;
    const read = () => modules.fs.readFile(destination).catch(cause => { if (isMissingFile(cause)) return null; throw cause; });
    const expected = await read();
    const { captureNativePdf } = await import("./nativePdf");
    const bytes = await captureNativePdf();
    await atomicWrite(modules.fs, modules.path, destination, bytes, async () => {
      const current = await read();
      if (current === null ? expected !== null : expected === null || !current.equals(expected)) throw new Error("The PDF destination changed during export. Choose another destination.");
    });
  },

  async openDocument(): Promise<OpenedDocument | null> {
    const file = await pickFile({ accept: ".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain" });
    if (!file) return null;
    const path = nativeFilePath(file);
    if (path) return { content: await this.readDocument(path), path };
    return { content: await file.text(), path: null };
  },

  async openDroppedDocument(file: File): Promise<OpenedDocument> {
    const path = nativeFilePath(file);
    return {
      content: path ? await this.readDocument(path) : await file.text(),
      path,
    };
  },

  async readDocument(path: string) {
    const modules = getNodeModules();
    if (!modules) throw new Error("Reading a file path requires the desktop app.");
    const content = await modules.fs.readFile(path, "utf8");
    diskBaselines.set(path, content);
    return content;
  },

  async saveDocument(path: string | null, suggestedName: string, content: string, assets?: { sourcePath: string; urls: readonly string[] }) {
    const modules = getNodeModules();
    if (!modules) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      link.download = suggestedName;
      link.click();
      URL.revokeObjectURL(link.href);
      return null;
    }

    let destination = path;
    if (!destination) {
      const file = await pickFile({ accept: ".md,text/markdown", saveAs: suggestedName });
      destination = file ? nativeFilePath(file) : null;
    }
    if (!destination) return null;
    const expected = diskBaselines.has(destination)
      ? diskBaselines.get(destination)!
      : await readIfPresent(modules.fs, destination);
    if (assets) await copyRelativeImages(modules.fs, modules.path, assets.sourcePath, destination, assets.urls);
    await saveFile(modules.fs, modules.path, destination, content, expected);
    diskBaselines.set(destination, content);
    return destination;
  },

  async readRecovery(): Promise<DocumentSnapshot | null> {
    const modules = getNodeModules();
    const runtime = getNw();
    const source = modules && runtime
      ? await readIfPresent(modules.fs, modules.path.join(runtime.App.dataPath, "recovery.json"))
      : localStorage.getItem("markora-app.recovery");
    if (!source) return null;
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object") throw new Error("The recovery file is invalid.");
    const record = value as DocumentSnapshot;
    if (typeof record.markdown !== "string" || typeof record.savedMarkdown !== "string"
      || !(record.path === null || typeof record.path === "string")) throw new Error("The recovery file is invalid.");
    return record.markdown === record.savedMarkdown ? null : record;
  },

  async writeRecovery(snapshot: DocumentSnapshot) {
    const modules = getNodeModules();
    const runtime = getNw();
    if (modules && runtime) {
      await modules.fs.mkdir(runtime.App.dataPath, { recursive: true });
      const destination = modules.path.join(runtime.App.dataPath, "recovery.json");
      // An atomic clean checkpoint also survives a crash during document switching.
      await atomicWrite(modules.fs, modules.path, destination, JSON.stringify(snapshot));
    } else {
      localStorage.setItem("markora-app.recovery", JSON.stringify(snapshot));
    }
  },

  restoreDiskBaseline(path: string, content: string) {
    diskBaselines.set(path, content);
  },

  async chooseImage(): Promise<PickedImage | null> {
    const file = await pickFile({ accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml" });
    return file ? { file, path: nativeFilePath(file) } : null;
  },

  async storeImage(image: PickedImage, documentPath: string | null) {
    const modules = getNodeModules();
    if (!modules || !image.path || !documentPath) return await fileAsDataUrl(image.file);

    const extension = modules.path.extname(image.path).toLowerCase();
    const documentStem = modules.path.basename(documentPath, modules.path.extname(documentPath));
    const assetDirectory = modules.path.join(modules.path.dirname(documentPath), `${documentStem}.assets`);
    await modules.fs.mkdir(assetDirectory, { recursive: true });

    const rawStem = modules.path.basename(image.path, extension)
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "image";
    let destination = modules.path.join(assetDirectory, `${rawStem}${extension}`);
    let counter = 2;
    while (true) {
      try {
        await modules.fs.access(destination);
        destination = modules.path.join(assetDirectory, `${rawStem}-${counter}${extension}`);
        counter += 1;
      } catch {
        break;
      }
    }
    await modules.fs.copyFile(image.path, destination);
    return modules.path.relative(modules.path.dirname(documentPath), destination).replace(/\\/gu, "/");
  },

  resolveResource(documentPath: string | null, storedUrl: string) {
    if (!documentPath || /^(?:[a-z]+:|#)/iu.test(storedUrl)) return storedUrl;
    const modules = getNodeModules();
    if (!modules) return storedUrl;
    return new URL(storedUrl.replace(/\\/gu, "/"), modules.url.pathToFileURL(documentPath)).href;
  },

  openExternal(url: string) {
    const runtime = getNw();
    if (runtime) runtime.Shell.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  },

  revealFile(path: string) {
    getNw()?.Shell.showItemInFolder(path);
  },

  getStartupPath() {
    const runtime = getNw();
    if (!runtime) return null;
    const openPath = extractOpenPath(runtime.App.argv);
    const modules = getNodeModules();
    return openPath && modules ? modules.path.resolve(runtime.App.startPath, openPath) : openPath;
  },

  onOpenPath(listener: (path: string) => void) {
    const runtime = getNw();
    if (!runtime) return () => undefined;
    const handler = (commandLine: string) => {
      const openPath = extractOpenPath(parseCommandLineArguments(commandLine));
      const modules = getNodeModules();
      if (openPath) listener(modules ? modules.path.resolve(runtime.App.startPath, openPath) : openPath);
    };
    runtime.App.on("open", handler);
    return () => runtime.App.removeListener("open", handler);
  },

  setWindowTitle(title: string) {
    document.title = title;
  },

  installCloseHandler(handler: () => void) {
    const runtime = getNw();
    if (!runtime) return () => undefined;
    const win = runtime.Window.get();
    win.on("close", handler);
    return () => win.removeListener("close", handler);
  },

  forceClose() {
    getNw()?.Window.get().close(true);
  },

  installMenu(actions: DesktopMenuActions) {
    createNativeMenu(actions);
  },
};
