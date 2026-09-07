import type { MarkdownEditorHeadingLevel } from "markora";
import { copySelection, pasteClipboard } from "./contextMenuClipboard";
import type { ContextMenuAction, ContextMenuClipboard, ContextMenuContext, ContextMenuItem, ContextMenuProvider } from "./contextMenuTypes";

export function createDefaultMenuProviders(context: ContextMenuContext, clipboard: ContextMenuClipboard): readonly ContextMenuProvider[] {
  const { editor } = context;
  const { commands, state } = editor;
  const { can, isActive } = state;
  const editable = editor.view.editable;
  const mac = /Mac|iPhone|iPad/u.test(editor.view.dom.ownerDocument.defaultView?.navigator.platform ?? "");
  const mod = mac ? "⌘" : "Ctrl+";
  const action = (id: string, label: string, run: ContextMenuAction["run"], enabled = true,
    extra: Partial<Pick<ContextMenuAction, "checked" | "shortcut" | "danger">> = {}): ContextMenuAction => (
    { type: "action", id, label, run, enabled, ...extra }
  );
  const contextual: ContextMenuItem[] = [];
  if (isActive.mark("link")) contextual.push(
    action("link.edit", "Edit link…", () => editor.ui?.editLink(), editable),
    action("link.remove", "Remove link", () => commands.removeLink(), can.removeLink()),
  );
  if (isActive.node("image")) contextual.push(
    action("image.edit", "Edit image…", () => editor.ui?.editImage(), editable),
    action("image.remove", "Remove image", () => commands.removeImage(), can.removeImage(), { danger: true }),
  );
  if (isActive.codeBlock()) contextual.push(action("code.language", "Edit code language…", () => editor.ui?.editCodeBlockLanguage(), editable));
  if (isActive.table()) contextual.push(
    { type: "submenu", id: "table.row", label: "Row", items: [
      action("table.row.before", "Insert row before", () => commands.addTableRow("before"), can.addTableRow("before")),
      action("table.row.after", "Insert row after", () => commands.addTableRow("after"), can.addTableRow("after")),
      action("table.row.up", "Move row up", () => commands.moveTableRow("up"), can.moveTableRow("up")),
      action("table.row.down", "Move row down", () => commands.moveTableRow("down"), can.moveTableRow("down")),
      action("table.row.delete", "Delete row", () => commands.deleteTableRow(), can.deleteTableRow(), { danger: true }),
    ] },
    { type: "submenu", id: "table.column", label: "Column", items: [
      action("table.column.before", "Insert column before", () => commands.addTableColumn("before"), can.addTableColumn("before")),
      action("table.column.after", "Insert column after", () => commands.addTableColumn("after"), can.addTableColumn("after")),
      action("table.column.left", "Move column left", () => commands.moveTableColumn("left"), can.moveTableColumn("left")),
      action("table.column.right", "Move column right", () => commands.moveTableColumn("right"), can.moveTableColumn("right")),
      action("table.column.delete", "Delete column", () => commands.deleteTableColumn(), can.deleteTableColumn(), { danger: true }),
    ] },
    { type: "submenu", id: "table.alignment", label: "Column alignment", items: ([null, "left", "center", "right"] as const).map(alignment =>
      action(`table.align.${alignment ?? "auto"}`, alignment ? alignment[0].toUpperCase() + alignment.slice(1) : "Automatic",
        () => commands.setTableColumnAlignment(alignment), can.setTableColumnAlignment(alignment), { checked: isActive.tableColumnAlignment(alignment) })) },
    action("table.edit", "Table controls…", () => editor.ui?.editTable(), editable),
    action("table.delete", "Delete table", () => commands.deleteTable(), can.deleteTable(), { danger: true }),
  );
  return [
    { id: "markora.context", order: 10, items: () => contextual },
    { id: "markora.clipboard", order: 20, items: () => [
      action("clipboard.cut", "Cut", current => copySelection(current, clipboard, true), editable && !context.selection.empty && !!clipboard.write, { shortcut: `${mod}X` }),
      action("clipboard.copy", "Copy", current => copySelection(current, clipboard), !context.selection.empty && !!clipboard.write, { shortcut: `${mod}C` }),
      action("clipboard.paste", "Paste", current => pasteClipboard(current, clipboard), can.pastePlainText() && !!clipboard.read, { shortcut: `${mod}V` }),
      action("clipboard.paste-plain", "Paste as plain text", current => pasteClipboard(current, clipboard, true), can.pastePlainText() && !!clipboard.read, { shortcut: `${mod}Shift+V` }),
      action("selection.all", "Select all", () => editor.focus("all"), true, { shortcut: `${mod}A` }),
    ] },
    { id: "markora.format", order: 30, items: () => [
      { type: "submenu", id: "format", label: "Format", items: [
        ...([ ["strong", "bold", "Bold", "B"], ["em", "italic", "Italic", "I"], ["code", "code", "Inline code", "E"], ["strike", "strike", "Strikethrough", "Shift+X"] ] as const).map(([mark, id, label, shortcut]) =>
          action(`format.${id}`, label, () => commands.toggleMark(mark), can.toggleMark(mark), { checked: isActive.mark(mark), shortcut: `${mod}${shortcut}` })),
      ] },
      { type: "submenu", id: "paragraph", label: "Paragraph", items: [
        action("paragraph.text", "Paragraph", () => commands.setParagraph(), can.setParagraph(), { checked: isActive.paragraph() }),
        ...([1, 2, 3, 4, 5, 6] as MarkdownEditorHeadingLevel[]).map(level => action(`paragraph.heading-${level}`, `Heading ${level}`,
          () => commands.setHeading(level), can.setHeading(level), { checked: isActive.heading(level) })),
        { type: "separator" },
        action("paragraph.quote", "Blockquote", () => commands.toggleBlockquote(), can.toggleBlockquote(), { checked: isActive.blockquote() }),
        action("paragraph.bullet", "Bullet list", () => commands.toggleBulletList(), can.toggleBulletList(), { checked: isActive.bulletList() }),
        action("paragraph.ordered", "Numbered list", () => commands.toggleOrderedList(), can.toggleOrderedList(), { checked: isActive.orderedList() }),
        action("paragraph.task", "Task list", () => commands.toggleTaskList(), can.toggleTaskList(), { checked: isActive.taskList() }),
        action("paragraph.code", "Code block", () => commands.setCodeBlock(), can.setCodeBlock(), { checked: isActive.codeBlock() }),
      ] },
    ] },
    { id: "markora.insert", order: 40, items: () => [{ type: "submenu", id: "insert", label: "Insert", items: [
      action("insert.table", "Table…", () => editor.ui?.createTable(), can.insertTable()),
      action("insert.rule", "Horizontal rule", () => commands.insertHorizontalRule(), can.insertHorizontalRule()),
    ] }] },
    { id: "markora.history", order: 50, items: () => [
      action("history.undo", "Undo", () => commands.undo(), can.undo(), { shortcut: `${mod}Z` }),
      action("history.redo", "Redo", () => commands.redo(), can.redo(), { shortcut: `${mod}Shift+Z` }),
    ] },
  ];
}
