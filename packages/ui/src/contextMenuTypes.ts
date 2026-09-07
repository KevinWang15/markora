import type { MarkdownEditor, MarkdownEditorClipboardContent } from "markora";

export type ContextMenuClipboardContent = MarkdownEditorClipboardContent;

/** Transport only; the editor and UI own selection, serialization, and stale-mutation guards. */
export type ContextMenuClipboard = Readonly<{
  read?: () => Promise<ContextMenuClipboardContent>;
  write?: (content: ContextMenuClipboardContent) => Promise<void>;
}>;

export type ContextMenuContext = Readonly<{
  editor: MarkdownEditor;
  selection: MarkdownEditor["view"]["state"]["selection"];
  source: "pointer" | "keyboard";
  signal: AbortSignal;
  /** Check after any await before changing the editor. */
  isCurrent: () => boolean;
}>;

export type ContextMenuAction = Readonly<{
  type: "action";
  id: string;
  label: string;
  shortcut?: string;
  enabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  run: (context: ContextMenuContext) => boolean | void | Promise<boolean | void>;
}>;

export type ContextMenuSubmenu = Readonly<{
  type: "submenu";
  id: string;
  label: string;
  items: readonly ContextMenuItem[];
}>;

export type ContextMenuItem = ContextMenuAction | ContextMenuSubmenu | Readonly<{ type: "separator" }>;

export type ContextMenuProvider = Readonly<{
  id: string;
  /** Lower values come first; ties retain registration order. Defaults occupy 10–60. */
  order?: number;
  items: (context: ContextMenuContext) => readonly ContextMenuItem[];
}>;

export type ContextMenuMessages = Readonly<{
  menuLabel: string;
  extensionsLabel: string;
  pendingLabel: string;
  errorLabel: string;
  clipboardErrorLabel: string;
  /** Translate any built-in or contributed item using its stable ID. */
  itemLabel: (id: string, fallback: string) => string;
}>;

export type ContextMenuConfig = Readonly<{
  includeDefaults?: boolean;
  includeExtensionActions?: boolean;
  providers?: readonly ContextMenuProvider[];
  /** Customize/remove/reorder defaults or replace their callbacks (for example, host document history). */
  transform?: (items: readonly ContextMenuItem[], context: ContextMenuContext) => readonly ContextMenuItem[];
  clipboard?: ContextMenuClipboard;
  messages?: Partial<ContextMenuMessages>;
  onError?: (error: unknown, context: ContextMenuContext) => void;
}>;
