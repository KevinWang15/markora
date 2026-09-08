import type { Node as ProseMirrorNode } from "prosemirror-model";
import { AllSelection, NodeSelection, Selection, TextSelection } from "prosemirror-state";
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

