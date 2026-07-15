import { Slice, type Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

function replaceEntireDocument(
  state: EditorState,
  nextDoc: ProseMirrorNode,
): Transaction {
  return state.tr.replace(
    0,
    state.doc.content.size,
    new Slice(nextDoc.content, 0, 0),
  );
}

/** @internal */
export function buildReconciledDocumentTransaction(
  state: EditorState,
  nextDoc: ProseMirrorNode,
): Transaction {
  const start = state.doc.content.findDiffStart(nextDoc.content);

  if (start === null) {
    return state.tr;
  }

  const end = state.doc.content.findDiffEnd(nextDoc.content);

  if (end === null) {
    return replaceEntireDocument(state, nextDoc);
  }

  let oldEnd = end.a;
  let newEnd = end.b;
  const overlap = start - Math.min(oldEnd, newEnd);

  if (overlap > 0) {
    oldEnd += overlap;
    newEnd += overlap;
  }

  try {
    const transaction = state.tr.replace(
      start,
      oldEnd,
      nextDoc.slice(start, newEnd),
    );

    if (transaction.doc.eq(nextDoc)) {
      return transaction;
    }
  } catch {
    // Some valid structural changes cannot be represented by the narrow slice.
  }

  return replaceEntireDocument(state, nextDoc);
}
