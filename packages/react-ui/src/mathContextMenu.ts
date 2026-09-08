import type { MathExtension } from "markora-extension-math";
import type { ContextMenuProvider } from "markora-ui";

/** Host adapter: math stays independent of React and of the optional default UI. */
export function createMathContextMenuProvider(extension: MathExtension, openMath: () => void): ContextMenuProvider {
  return {
    id: "math", order: 35,
    items({ editor, selection }) {
      const handle = editor.extensions.get(extension);
      const target = handle.state.getNodes().find(node => node.position === selection.from
        && editor.view.state.doc.nodeAt(node.position)?.nodeSize === selection.to - selection.from);
      const editable = editor.view.editable;
      if (!target) return [{ type: "action", id: "math.insert", label: "Insert display math", shortcut: /Mac|iPhone|iPad/u.test(editor.view.dom.ownerDocument.defaultView?.navigator.platform ?? "") ? "⇧⌘M" : "Ctrl+Shift+M",
        enabled: editable && editor.state.can.pasteMarkdown(), run: openMath },
        { type: "action", id: "math.insertInline", label: "Insert inline math", enabled: editable && editor.state.can.pasteMarkdown(), run: () => handle.commands.editSelection("inline") }];
      return [
        { type: "action", id: "math.edit", label: "Edit formula", enabled: editable, run: () => handle.commands.edit(target) },
        { type: "action", id: "math.preview", label: "Toggle formula preview", run: () => handle.commands.togglePreview(target) },
        { type: "action", id: "math.convert", label: target.kind === "inline" ? "Convert to display math" : "Convert to inline math",
          enabled: editable, run: () => handle.commands.convert(target, target.kind === "inline" ? "block" : "inline") },
        { type: "action", id: "math.remove", label: "Remove formula", enabled: editable, danger: true, run: () => handle.commands.remove(target) },
      ];
    },
  };
}
