import type { ContextMenuClipboard, ContextMenuContext } from "./contextMenuTypes";

export function createBrowserClipboard(win: Window & typeof globalThis): ContextMenuClipboard {
  const clipboard = win.navigator.clipboard;
  return {
    read: clipboard?.read ? async () => {
      const items = await clipboard.read();
      const item = items.find(value => value.types.includes("text/html") || value.types.includes("text/plain"));
      if (!item) throw new Error("The clipboard does not contain supported text.");
      const text = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
      const html = item.types.includes("text/html") ? await (await item.getType("text/html")).text() : undefined;
      return { text, html };
    } : clipboard?.readText ? async () => ({ text: await clipboard.readText() }) : undefined,
    write: typeof clipboard?.write === "function" && typeof win.ClipboardItem === "function" ? async content => {
      const data: Record<string, Blob> = { "text/plain": new win.Blob([content.text], { type: "text/plain" }) };
      if (content.html) data["text/html"] = new win.Blob([content.html], { type: "text/html" });
      await clipboard.write([new win.ClipboardItem(data)]);
    } : clipboard?.writeText ? content => clipboard.writeText(content.text) : undefined,
  };
}

export async function copySelection(context: ContextMenuContext, clipboard: ContextMenuClipboard, cut = false) {
  const { editor, selection } = context;
  if (!context.isCurrent() || selection.empty || !clipboard.write || (cut && !editor.view.editable)) return false;
  const captured = editor.clipboard.captureSelection();
  if (!captured) return false;
  await clipboard.write(captured.content);
  if (!context.isCurrent()) return false;
  return cut ? captured.deleteSelection() : true;
}

export async function pasteClipboard(context: ContextMenuContext, clipboard: ContextMenuClipboard, plain = false) {
  if (!context.isCurrent() || !context.editor.view.editable || !clipboard.read) return false;
  const content = await clipboard.read();
  if (!context.isCurrent() || !context.editor.view.editable) return false;
  if (plain) return context.editor.commands.pastePlainText(content.text);
  return context.editor.clipboard.paste(content);
}
