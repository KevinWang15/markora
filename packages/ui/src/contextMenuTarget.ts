import type { MarkdownEditor } from "markora";
import { NodeSelection, TextSelection } from "prosemirror-state";

/** Nested editors and form controls own their own selection and native clipboard menu. */
export function ownsMenuEvent(editor: MarkdownEditor, event: Event) {
  const win = editor.view.dom.ownerDocument.defaultView!;
  const path = event.composedPath();
  const target = path.find(node => node instanceof win.Element) as Element | undefined;
  return !!target && path.includes(editor.view.dom)
    && !target.closest('input, textarea, select, button, .cm-editor, [data-mdw-native-context-menu]');
}

export function targetPointerSelection(editor: MarkdownEditor, x: number, y: number) {
  const { view } = editor;
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return false;
  const { doc, selection } = view.state;
  // Preserve text, node, and rectangular table selections under the pointer.
  const inside = selection.ranges.some(range => hit.pos >= range.$from.pos && hit.pos <= range.$to.pos);
  if (!selection.empty && inside) return true;
  const node = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
  const next = node?.isAtom && NodeSelection.isSelectable(node)
    ? NodeSelection.create(doc, hit.inside)
    : TextSelection.near(doc.resolve(hit.pos));
  if (!selection.eq(next)) view.dispatch(view.state.tr.setSelection(next).setMeta("addToHistory", false));
  return true;
}
