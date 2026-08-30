import { EditorState, Plugin, type Transaction } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./support/currentMarkdownCodec";
import {
  getMarkdownEditorTransactionEmitChange,
  getMarkdownEditorTransactionOrigin,
  hasMarkdownEditorExternalUpdatePermission,
  setBuiltinMarkdownEditorTransactionOrigin,
  setMarkdownEditorExternalUpdatePermission,
  setMarkdownEditorTransactionEmitChange,
  setMarkdownEditorTransactionOrigin,
  type MarkdownEditorBuiltinChangeOrigin,
  type MarkdownEditorExtensionOrigin,
} from "../src/transactionOrigin";

function createState(plugins: readonly Plugin[] = []) {
  return EditorState.create({
    doc: parseMarkdown("alpha"),
    plugins,
  });
}

describe("markdown editor transaction origins", () => {
  it("tags extension transactions and returns the same transaction", () => {
    const transaction = createState().tr;
    const result = setMarkdownEditorTransactionOrigin(
      transaction,
      "extension:collaboration",
    );

    expect(result).toBe(transaction);
    expect(getMarkdownEditorTransactionOrigin(transaction)).toBe(
      "extension:collaboration",
    );
  });

  it.each(["user", "extension:", "extension:   ", "other:value", ""])(
    "rejects invalid public extension origin %j",
    (origin) => {
      expect(() =>
        setMarkdownEditorTransactionOrigin(
          createState().tr,
          origin as MarkdownEditorExtensionOrigin,
        ),
      ).toThrow(TypeError);
    },
  );

  it.each<MarkdownEditorBuiltinChangeOrigin>([
    "user",
    "command",
    "external",
    "reset",
  ])("supports the built-in %s origin internally", (origin) => {
    const transaction = createState().tr;

    expect(setBuiltinMarkdownEditorTransactionOrigin(transaction, origin)).toBe(
      transaction,
    );
    expect(getMarkdownEditorTransactionOrigin(transaction)).toBe(origin);
  });

  it("follows ProseMirror appendedTransaction metadata", () => {
    const appendPlugin = new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.getMeta("append-once"))) {
          return null;
        }

        return newState.tr;
      },
    });
    const state = createState([appendPlugin]);
    const root = setBuiltinMarkdownEditorTransactionOrigin(
      state.tr.setMeta("append-once", true),
      "external",
    );
    const result = state.applyTransaction(root);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[1]?.getMeta("appendedTransaction")).toBe(root);
    expect(getMarkdownEditorTransactionOrigin(result.transactions[1]!)).toBe(
      "external",
    );
  });

  it("prefers an appended transaction's own origin", () => {
    const state = createState();
    const root = setBuiltinMarkdownEditorTransactionOrigin(state.tr, "external");
    const appended = state.tr.setMeta("appendedTransaction", root);

    setMarkdownEditorTransactionOrigin(appended, "extension:normalizer");

    expect(getMarkdownEditorTransactionOrigin(appended)).toBe(
      "extension:normalizer",
    );
  });

  it("does not confer external-update permission through public origin tagging", () => {
    const readonlyPlugin = new Plugin({
      filterTransaction(transaction) {
        return (
          !transaction.docChanged ||
          hasMarkdownEditorExternalUpdatePermission(transaction)
        );
      },
    });
    const state = createState([readonlyPlugin]);
    const publicTransaction = setMarkdownEditorTransactionOrigin(
      state.tr.insertText("!", 2),
      "extension:host",
    );

    expect(hasMarkdownEditorExternalUpdatePermission(publicTransaction)).toBe(
      false,
    );
    expect(state.applyTransaction(publicTransaction).transactions).toHaveLength(
      0,
    );

    const permittedTransaction = setMarkdownEditorExternalUpdatePermission(
      state.tr.insertText("!", 2),
    );
    expect(state.applyTransaction(permittedTransaction).transactions).toHaveLength(
      1,
    );

    const forgedAppend = state.tr
      .insertText("!", 2)
      .setMeta("appendedTransaction", permittedTransaction);
    expect(hasMarkdownEditorExternalUpdatePermission(forgedAppend)).toBe(false);
    expect(state.applyTransaction(forgedAppend).transactions).toHaveLength(0);
  });

  it.each([true, false])("stores the emitChange decision %s", (emitChange) => {
    const transaction = createState().tr;

    expect(getMarkdownEditorTransactionEmitChange(transaction)).toBeUndefined();
    expect(
      setMarkdownEditorTransactionEmitChange(transaction, emitChange),
    ).toBe(transaction);
    expect(getMarkdownEditorTransactionEmitChange(transaction)).toBe(emitChange);
  });

  it("ignores malformed and cyclic appendedTransaction metadata", () => {
    const transaction = createState().tr;

    transaction.setMeta("appendedTransaction", transaction as Transaction);

    expect(getMarkdownEditorTransactionOrigin(transaction)).toBeUndefined();
  });
});
