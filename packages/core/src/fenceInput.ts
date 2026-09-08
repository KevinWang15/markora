import { closeHistory } from "prosemirror-history";
import { TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkdownEditorCodec } from "./markdownCodec";

export type FenceInputCodec = Pick<MarkdownEditorCodec, "schema" | "parse">;

/** Resolve a typed opening fence through the host's Markdown dialect. This
 * keeps extension-owned fences consistent with imports, without teaching the
 * core about individual languages or parsing any surrounding document text. */
export function createFenceInputTransaction(state: EditorState, fence: string, codec: FenceInputCodec) {
  const { selection } = state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type !== codec.schema.nodes.paragraph
    || $from.parentOffset !== $from.parent.content.size) return null;
  const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u.exec(fence);
  if (!match || (match[1]![0] === "`" && match[2]!.includes("`"))) return null;

  const parsed = codec.parse(`${fence}\n${match[1]}`);
  const block = parsed?.firstChild;
  if (parsed?.childCount !== 1 || !block?.isTextblock || !block.type.spec.code
    || block.content.size !== 0) return null;
  const parent = $from.node(-1);
  const index = $from.index(-1);
  if (!parent.canReplaceWith(index, index + 1, block.type, block.marks)) return null;

  const start = $from.before();
  const tr = state.tr.replaceWith(start, $from.after(), block);
  tr.setSelection(TextSelection.create(tr.doc, start + 1));
  tr.setStoredMarks([]);
  return tr.scrollIntoView();
}

export function convertFenceToBlock(codec: FenceInputCodec, view: EditorView) {
  if (!view.editable || view.composing) return false;
  const tr = createFenceInputTransaction(view.state, view.state.selection.$from.parent.textContent, codec);
  if (!tr) return false;
  // Enter is a separate undo step: undo restores the literal opening fence.
  view.dispatch(closeHistory(tr));
  return true;
}
