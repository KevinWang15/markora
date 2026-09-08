import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { Selection, TextSelection, type SelectionBookmark } from "prosemirror-state";

type Mapping = Parameters<Selection["map"]>[1];

/** A document range may end beside an atomic block, where no text caret exists.
 * Unlike a gap cursor, it is nonempty and uses the normal selection slice and
 * replacement operations. Text-only endpoints keep the standard TextSelection. */
export function createDocumentRange(doc: ProseMirrorNode, anchor: number, head: number): Selection {
  for (const pos of [anchor, head]) {
    if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) throw new RangeError("Invalid document range endpoint.");
  }
  const $anchor = doc.resolve(anchor), $head = doc.resolve(head);
  if (anchor === head) return Selection.near($head);
  if ($anchor.parent.inlineContent && $head.parent.inlineContent) return TextSelection.create(doc, anchor, head);
  return new DocumentRangeSelection($anchor, $head);
}

export class DocumentRangeSelection extends Selection {
  constructor($anchor: ResolvedPos, $head: ResolvedPos) { super($anchor, $head); }

  map(doc: ProseMirrorNode, mapping: Mapping): Selection {
    const forward = this.anchor < this.head;
    return createDocumentRange(doc, mapping.map(this.anchor, forward ? 1 : -1), mapping.map(this.head, forward ? -1 : 1));
  }

  eq(other: Selection) {
    return other instanceof DocumentRangeSelection && other.anchor === this.anchor && other.head === this.head;
  }

  toJSON() { return { type: "markora-document-range", anchor: this.anchor, head: this.head }; }

  static fromJSON(doc: ProseMirrorNode, json: { anchor: number; head: number }): Selection {
    return createDocumentRange(doc, json.anchor, json.head);
  }

  getBookmark(): SelectionBookmark { return new DocumentRangeBookmark(this.anchor, this.head); }
}

class DocumentRangeBookmark implements SelectionBookmark {
  constructor(readonly anchor: number, readonly head: number) {}
  map(mapping: Mapping): SelectionBookmark {
    const forward = this.anchor < this.head;
    return new DocumentRangeBookmark(mapping.map(this.anchor, forward ? 1 : -1), mapping.map(this.head, forward ? -1 : 1));
  }
  resolve(doc: ProseMirrorNode): Selection { return createDocumentRange(doc, this.anchor, this.head); }
}

Selection.jsonID("markora-document-range", DocumentRangeSelection);
