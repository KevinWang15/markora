import type { EditorView } from "prosemirror-view";

/** Remove this adapter when the supported ProseMirror destroy path releases the
 * invisible-selection guard. Keep the retained-listener regression test until then. */
export function destroyProseMirrorView(view: EditorView) {
  const input = (view as EditorView & {
    input?: { hideSelectionGuard: (() => void) | null };
  }).input;
  const selectionGuard = input?.hideSelectionGuard;

  // prosemirror-view 1.41 removes its main DOM observer on destroy, but not
  // the one-shot guard installed for an invisible selection. That document
  // listener retains the destroyed view until another selectionchange. An
  // embedded editor must release it synchronously because the host may keep
  // the document alive indefinitely.
  if (selectionGuard) {
    view.dom.ownerDocument.removeEventListener("selectionchange", selectionGuard);
    input.hideSelectionGuard = null;
  }

  view.destroy();
}

