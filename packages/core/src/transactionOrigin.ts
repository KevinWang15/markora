import { PluginKey, type Transaction } from "prosemirror-state";

export type MarkdownEditorBuiltinChangeOrigin =
  | "user"
  | "command"
  | "external"
  | "reset";

export type MarkdownEditorExtensionOrigin = `extension:${string}`;

export type MarkdownEditorChangeOrigin =
  | MarkdownEditorBuiltinChangeOrigin
  | MarkdownEditorExtensionOrigin;

export type MarkdownEditorChangeContext = Readonly<{
  origin: MarkdownEditorChangeOrigin;
}>;

const transactionOriginKey = new PluginKey<MarkdownEditorChangeOrigin>(
  "markoraTransactionOrigin",
);
const externalUpdateTransactions = new WeakSet<Transaction>();
const transactionEmitChanges = new WeakMap<Transaction, boolean>();

const builtinOrigins: readonly MarkdownEditorBuiltinChangeOrigin[] = [
  "user",
  "command",
  "external",
  "reset",
];

function isBuiltinOrigin(value: unknown): value is MarkdownEditorBuiltinChangeOrigin {
  return builtinOrigins.includes(value as MarkdownEditorBuiltinChangeOrigin);
}

function isExtensionOrigin(value: unknown): value is MarkdownEditorExtensionOrigin {
  if (typeof value !== "string" || !value.startsWith("extension:")) {
    return false;
  }

  return value.slice("extension:".length).trim().length > 0;
}

function isTransactionLike(value: unknown): value is Transaction {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getMeta?: unknown }).getMeta === "function"
  );
}

function readTransactionMeta<T>(
  transaction: Transaction,
  key: PluginKey<T>,
): unknown {
  const visited = new Set<Transaction>();
  let current: Transaction | undefined = transaction;

  while (current && !visited.has(current)) {
    visited.add(current);
    const value = current.getMeta(key);

    if (value !== undefined) {
      return value;
    }

    const appendedTransaction = current.getMeta("appendedTransaction");
    current = isTransactionLike(appendedTransaction)
      ? appendedTransaction
      : undefined;
  }

  return undefined;
}

export function setMarkdownEditorTransactionOrigin(
  transaction: Transaction,
  origin: MarkdownEditorExtensionOrigin,
): Transaction {
  if (!isExtensionOrigin(origin)) {
    throw new TypeError(
      'Markdown editor extension origins must use "extension:<nonempty-name>".',
    );
  }

  return transaction.setMeta(transactionOriginKey, origin);
}

export function getMarkdownEditorTransactionOrigin(
  transaction: Transaction,
): MarkdownEditorChangeOrigin | undefined {
  const origin = readTransactionMeta(transaction, transactionOriginKey);

  return isBuiltinOrigin(origin) || isExtensionOrigin(origin) ? origin : undefined;
}

/** @internal */
export function setBuiltinMarkdownEditorTransactionOrigin(
  transaction: Transaction,
  origin: MarkdownEditorBuiltinChangeOrigin,
): Transaction {
  if (!isBuiltinOrigin(origin)) {
    throw new TypeError(`Unknown markdown editor built-in origin: ${String(origin)}.`);
  }

  return transaction.setMeta(transactionOriginKey, origin);
}

/** @internal */
export function setMarkdownEditorExternalUpdatePermission(
  transaction: Transaction,
): Transaction {
  externalUpdateTransactions.add(transaction);
  return transaction;
}

/** @internal */
export function hasMarkdownEditorExternalUpdatePermission(
  transaction: Transaction,
): boolean {
  return externalUpdateTransactions.has(transaction);
}

/** @internal */
export function setMarkdownEditorTransactionEmitChange(
  transaction: Transaction,
  emitChange: boolean,
): Transaction {
  if (typeof emitChange !== "boolean") {
    throw new TypeError("Markdown editor transaction emitChange must be a boolean.");
  }

  transactionEmitChanges.set(transaction, emitChange);
  return transaction;
}

/** @internal */
export function getMarkdownEditorTransactionEmitChange(
  transaction: Transaction,
): boolean | undefined {
  return transactionEmitChanges.get(transaction);
}
