import type { Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { throwCollectedErrors } from "./runtimeErrors";
import {
  getMarkdownEditorTransactionEmitChange,
  getMarkdownEditorTransactionOrigin,
  setBuiltinMarkdownEditorTransactionOrigin,
  type MarkdownEditorChangeContext,
  type MarkdownEditorChangeOrigin,
} from "./transactionOrigin";

export function createChangeContext(origin: MarkdownEditorChangeOrigin): MarkdownEditorChangeContext {
  return Object.freeze({ origin });
}

/** Shared transaction ordering. Feature assemblies supply view-specific behavior;
 * the runtime owns origin, callback isolation, and reentrant delivery guards. */
export function createTransactionDispatcher(options: {
  isActive(): boolean;
  isPasting(): boolean;
  onTransaction(transaction: Transaction, view: EditorView, context: MarkdownEditorChangeContext): void;
  scheduleChange(doc: Node, context: MarkdownEditorChangeContext): void;
  emitStateEvents(previous: EditorState, next: EditorState, changed: boolean, origin: MarkdownEditorChangeOrigin): void;
  updateView?(view: EditorView, state: EditorState, transaction: Transaction, errors: unknown[]): void;
}) {
  return function dispatchTransaction(this: EditorView, transaction: Transaction) {
    const view = this;
    let origin = getMarkdownEditorTransactionOrigin(transaction);
    if (!origin) {
      origin = options.isPasting() ? "command" : "user";
      setBuiltinMarkdownEditorTransactionOrigin(transaction, origin);
    }
    const context = createChangeContext(origin);
    const shouldEmitChange = getMarkdownEditorTransactionEmitChange(transaction) ?? (origin !== "external");
    const previous = view.state;
    const next = previous.apply(transaction);
    const errors: unknown[] = [];

    try {
      if (options.updateView) options.updateView(view, next, transaction, errors);
      else view.updateState(next);
    } catch (error) {
      errors.push(error);
    }

    if (options.isActive() && !view.isDestroyed) {
      try {
        options.onTransaction(transaction, view, context);
      } catch (error) {
        errors.push(error);
      }
    }

    const changed = !previous.doc.eq(next.doc);
    if (options.isActive() && !view.isDestroyed && view.state.doc.eq(next.doc)) {
      if (changed && shouldEmitChange) {
        try {
          options.scheduleChange(next.doc, context);
        } catch (error) {
          errors.push(error);
        }
      }
      options.emitStateEvents(previous, next, changed, origin);
    }
    throwCollectedErrors("Multiple Markora callbacks failed for one transaction.", errors);
  };
}
