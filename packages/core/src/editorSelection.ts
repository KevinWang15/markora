import type { Node as ProseMirrorNode } from "prosemirror-model";
import { AllSelection, NodeSelection, Plugin, Selection, TextSelection } from "prosemirror-state";
import { ManagedBlockCursor } from "./managedBlockCursor";
import type { MarkdownEditorSelectionTarget } from "./editorApi";
import type { MarkdownEditorSelectionKind, MarkdownEditorSelectionSnapshot } from "./editorEvents";

export function resolveSelectionTarget(
  doc: ProseMirrorNode,
  target: MarkdownEditorSelectionTarget,
) {
  if (target === "all") {
    return new AllSelection(doc);
  }

  if (target === "start") {
    return Selection.atStart(doc);
  }

  if (target === "end") {
    return Selection.atEnd(doc);
  }

  const { anchor } = target;
  const head = target.head ?? anchor;

  if (!Number.isInteger(anchor) || !Number.isInteger(head)) {
    throw new RangeError("Editor selection positions must be integers.");
  }

  if (anchor < 0 || anchor > doc.content.size || head < 0 || head > doc.content.size) {
    throw new RangeError(`Editor selection positions must be between 0 and ${doc.content.size}.`);
  }

  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);

  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) {
    throw new RangeError("Editor selection positions must resolve inside text blocks.");
  }

  return TextSelection.create(doc, anchor, head);
}

export function getSelectionKind(selection: Selection): MarkdownEditorSelectionKind {
  if (selection instanceof ManagedBlockCursor) {
    return "managed-block";
  }

  if (selection instanceof AllSelection) {
    return "all";
  }

  if (selection instanceof NodeSelection) {
    return "node";
  }

  if (selection instanceof TextSelection) {
    return "text";
  }

  return "other";
}

export function snapshotSelection(selection: Selection, classify: (selection: Selection) => MarkdownEditorSelectionKind = getSelectionKind): MarkdownEditorSelectionSnapshot {
  return {
    anchor: selection.anchor,
    empty: selection.empty,
    from: selection.from,
    head: selection.head,
    kind: classify(selection),
    to: selection.to,
  };
}


// A read-only editor is a document to read: the reader selects text and copies it, as on any
// page. So its selection is one the browser draws, never an editing selection Markora draws
// (a selected node, all, table cells, gap and block cursors) with its rings: a node or a cursor
// becomes the collapsed text position it is at, all or a range the editor draws (visible: false,
// as table cells) the text range it covers. Text and document ranges are kept.

/** The selection a read-only editor keeps for `selection`; null when it keeps that one. */
export function readOnlySelection(doc: ProseMirrorNode, selection: Selection): Selection | null {
  if (selection instanceof TextSelection) return null;
  let text: Selection | null = null;
  if (selection instanceof NodeSelection || selection.empty) {
    const $pos = selection.$from;
    text = $pos.parent.inlineContent
      ? TextSelection.create(doc, $pos.pos)
      : Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true);
  } else if (selection instanceof AllSelection || !selection.visible) {
    text = TextSelection.between(selection.$from, selection.$to);
  }
  return text && !text.eq(selection) ? text : null;
}

/** A new state's selection, given or the document's start, as a read-only editor keeps it. */
export function readOnlyStartSelection(doc: ProseMirrorNode, selection: Selection = Selection.atStart(doc)): Selection {
  return readOnlySelection(doc, selection) ?? selection;
}

/** Keeps a read-only editor's selection the one readOnlySelection gives, whatever set or mapped it. */
export function createReadOnlySelectionPlugin(isEditable: () => boolean) {
  return new Plugin({
    appendTransaction(_transactions, _oldState, state) {
      if (isEditable()) return null;
      const selection = readOnlySelection(state.doc, state.selection);
      return selection ? state.tr.setSelection(selection) : null;
    },
  });
}
