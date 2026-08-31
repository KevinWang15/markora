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
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
  toggleTheme: () => void;
}>;

type NodePath = {
  basename: (path: string, suffix?: string) => string;
  dirname: (path: string) => string;
  extname: (path: string) => string;
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  resolve: (...parts: string[]) => string;
};

type NodeFs = {
  access: (path: string) => Promise<void>;
  copyFile: (source: string, destination: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  writeFile: (path: string, content: string, encoding: "utf8") => Promise<void>;
};

type NodeUrl = {
  pathToFileURL: (path: string) => URL;
};

type NwMenu = {
  append: (item: NwMenuItem) => void;
  createMacBuiltin?: (applicationName: string, options?: { hideEdit?: boolean; hideWindow?: boolean }) => void;
};

type NwMenuItem = object;

type NwWindow = {
  menu: NwMenu | null;
  on: (event: "close", listener: () => void) => void;
  close: (force?: boolean) => void;
};

type NwRuntime = {
  App: {
    argv: string[];
    startPath: string;
    on: (event: "open", listener: (commandLine: string) => void) => void;
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
    fs: runtime.require("node:fs/promises") as NodeFs,
    path: runtime.require("node:path") as NodePath,
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

  if (runtime.process.platform === "darwin" && menu.createMacBuiltin) {
    menu.createMacBuiltin("Markora", { hideEdit: false, hideWindow: false });
  } else {
    const appendItem = (target: NwMenu, options: Record<string, unknown>) => {
      target.append(new runtime.MenuItem(options));
    };
    const file = new runtime.Menu();
    appendItem(file, { label: "New", key: "n", modifiers: "ctrl", click: actions.newDocument });
    appendItem(file, { label: "Open…", key: "o", modifiers: "ctrl", click: actions.openDocument });
    appendItem(file, { type: "separator" });
    appendItem(file, { label: "Save", key: "s", modifiers: "ctrl", click: actions.saveDocument });
    appendItem(file, { label: "Save As…", key: "s", modifiers: "ctrl-shift", click: actions.saveDocumentAs });
    appendItem(file, { type: "separator" });
    appendItem(file, { label: "Close", key: "w", modifiers: "ctrl", click: () => runtime.Window.get().close() });
    appendItem(menu, { label: "File", submenu: file });

    const view = new runtime.Menu();
    appendItem(view, { label: "Toggle Sidebar", key: "\\", modifiers: "ctrl-shift", click: actions.toggleSidebar });
    appendItem(view, { label: "Source Mode", key: "/", modifiers: "ctrl", click: actions.toggleSourceMode });
    appendItem(view, { label: "Toggle Theme", click: actions.toggleTheme });
    appendItem(menu, { label: "View", submenu: view });
  }

  runtime.Window.get().menu = menu;
}

export const desktop = {
  isNative: Boolean(getNw()),
  isMac: getNw()?.process.platform === "darwin",

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
    return await modules.fs.readFile(path, "utf8");
  },

  async saveDocument(path: string | null, suggestedName: string, content: string) {
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
    await modules.fs.writeFile(destination, content, "utf8");
    return destination;
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
    const absolutePath = modules.path.resolve(modules.path.dirname(documentPath), storedUrl);
    return modules.url.pathToFileURL(absolutePath).href;
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
    return () => undefined;
  },

  setWindowTitle(title: string) {
    document.title = title;
  },

  installCloseHandler(handler: () => void) {
    const runtime = getNw();
    if (!runtime) return;
    runtime.Window.get().on("close", handler);
  },

  forceClose() {
    getNw()?.Window.get().close(true);
  },

  installMenu(actions: DesktopMenuActions) {
    createNativeMenu(actions);
  },
};
