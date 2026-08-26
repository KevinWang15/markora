import type { MarkType, Schema } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";

export type MarkdownEditorAutoPair =
  | "braces"
  | "double-quotes"
  | "emphasis-asterisks"
  | "emphasis-underscores"
  | "inline-code"
  | "parentheses"
  | "single-quotes"
  | "square-brackets"
  | "strikethrough"
  | "strong-asterisks"
  | "strong-underscores";

export type MarkdownEditorTypingOptions = Readonly<{
  /** Explicit, opt-in pairs. Conflicting pairs that use the same trigger are rejected. */
  autoPairs?: readonly MarkdownEditorAutoPair[];
  /** Wrap compatible text selections instead of replacing them. Defaults to true. */
  wrapSelection?: boolean;
}>;

export type MarkdownEditorHistoryAction = "redo" | "undo";

export type MarkdownEditorCodeAutoPairSnapshot = Readonly<{
  active: boolean;
  close: string;
  open: string;
  openPosition: number;
  position: number;
}>;

type AutoPairKind = "bracket" | "markdown" | "quote";

export type NormalizedMarkdownEditorAutoPair = Readonly<{
  autoClose: boolean;
  close: string;
  kind: AutoPairKind;
  mark?: "code" | "em" | "strike" | "strong";
  name: MarkdownEditorAutoPair;
  open: string;
  trigger: string;
}>;

export type NormalizedMarkdownEditorTypingOptions = Readonly<{
  autoPairs: readonly NormalizedMarkdownEditorAutoPair[];
  wrapSelection: boolean;
}>;

const AUTO_PAIR_SPECS: Readonly<Record<MarkdownEditorAutoPair, NormalizedMarkdownEditorAutoPair>> =
  Object.freeze({
    braces: Object.freeze({
      autoClose: true, close: "}", kind: "bracket", name: "braces", open: "{", trigger: "{",
    }),
    "double-quotes": Object.freeze({
      autoClose: true, close: '"', kind: "quote", name: "double-quotes", open: '"', trigger: '"',
    }),
    "emphasis-asterisks": Object.freeze({
      autoClose: true, close: "*", kind: "markdown", mark: "em", name: "emphasis-asterisks", open: "*", trigger: "*",
    }),
    "emphasis-underscores": Object.freeze({
      autoClose: true, close: "_", kind: "markdown", mark: "em", name: "emphasis-underscores", open: "_", trigger: "_",
    }),
    "inline-code": Object.freeze({
      autoClose: true, close: "`", kind: "markdown", mark: "code", name: "inline-code", open: "`", trigger: "`",
    }),
    parentheses: Object.freeze({
      autoClose: true, close: ")", kind: "bracket", name: "parentheses", open: "(", trigger: "(",
    }),
    "single-quotes": Object.freeze({
      autoClose: true, close: "'", kind: "quote", name: "single-quotes", open: "'", trigger: "'",
    }),
    "square-brackets": Object.freeze({
      autoClose: true, close: "]", kind: "bracket", name: "square-brackets", open: "[", trigger: "[",
    }),
    strikethrough: Object.freeze({
      autoClose: true, close: "~~", kind: "markdown", mark: "strike", name: "strikethrough", open: "~~", trigger: "~",
    }),
    "strong-asterisks": Object.freeze({
      autoClose: true, close: "**", kind: "markdown", mark: "strong", name: "strong-asterisks", open: "**", trigger: "*",
    }),
    "strong-underscores": Object.freeze({
      autoClose: true, close: "__", kind: "markdown", mark: "strong", name: "strong-underscores", open: "__", trigger: "_",
    }),
  });

const AUTO_PAIR_NAMES = new Set(Object.keys(AUTO_PAIR_SPECS));
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;
const WHITESPACE_CHARACTER = /\s/u;
const PUNCTUATION_CHARACTER = /[\p{P}\p{S}]/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeMarkdownEditorTypingOptions(
  value: MarkdownEditorTypingOptions | undefined,
): NormalizedMarkdownEditorTypingOptions {
  if (value !== undefined && !isPlainRecord(value)) {
    throw new TypeError("Typing options must be an object.");
  }

  const configuredPairs = value?.autoPairs === undefined ? [] : value.autoPairs;

  if (!Array.isArray(configuredPairs)) {
    throw new TypeError("typing.autoPairs must be an array.");
  }

  if (value?.wrapSelection !== undefined && typeof value.wrapSelection !== "boolean") {
    throw new TypeError("typing.wrapSelection must be a boolean.");
  }

  const names = new Set<MarkdownEditorAutoPair>();
  const triggers = new Map<string, MarkdownEditorAutoPair>();
  const autoPairs: NormalizedMarkdownEditorAutoPair[] = [];

  for (const candidate of configuredPairs) {
    if (typeof candidate !== "string" || !AUTO_PAIR_NAMES.has(candidate)) {
      throw new RangeError(`Unknown Markdown editor auto-pair ${JSON.stringify(candidate)}.`);
    }

    const name = candidate as MarkdownEditorAutoPair;

    if (names.has(name)) {
      throw new RangeError(`Markdown editor auto-pair ${JSON.stringify(name)} is configured more than once.`);
    }

    const spec = AUTO_PAIR_SPECS[name];
    const previous = triggers.get(spec.trigger);

    if (previous) {
      const previousSpec = AUTO_PAIR_SPECS[previous];
      const compatibleMarkdownPromotion = (
        previousSpec.kind === "markdown"
        && spec.kind === "markdown"
        && new Set([previousSpec.mark, spec.mark]).has("em")
        && new Set([previousSpec.mark, spec.mark]).has("strong")
        && previousSpec.open.length !== spec.open.length
      );

      if (!compatibleMarkdownPromotion) {
        throw new RangeError(
          `Markdown editor auto-pairs ${JSON.stringify(previous)} and ${JSON.stringify(name)} share the ${JSON.stringify(spec.trigger)} trigger.`,
        );
      }
    } else {
      triggers.set(spec.trigger, name);
    }

    names.add(name);
    autoPairs.push(spec);
  }

  return Object.freeze({
    autoPairs: Object.freeze(autoPairs),
    wrapSelection: value?.wrapSelection ?? true,
  });
}

function hasOddEscapingBackslashes(text: string) {
  let count = 0;

  for (let index = text.length - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    count += 1;
  }

  return count % 2 === 1;
}

export function canOpenMarkdownEditorAutoPair(
  pair: NormalizedMarkdownEditorAutoPair,
  textBefore: string,
  textAfter: string,
) {
  if (hasOddEscapingBackslashes(textBefore)) return false;

  const beforeCharacters = Array.from(textBefore);
  const previous = beforeCharacters[beforeCharacters.length - 1] ?? "";
  const next = Array.from(textAfter)[0] ?? "";

  if (pair.kind === "quote") {
    return !WORD_CHARACTER.test(previous);
  }

  if (pair.kind === "markdown") {
    if (!next) {
      return !previous || WHITESPACE_CHARACTER.test(previous) || PUNCTUATION_CHARACTER.test(previous);
    }

    return !WHITESPACE_CHARACTER.test(next) && (
      !PUNCTUATION_CHARACTER.test(next)
      || !previous
      || WHITESPACE_CHARACTER.test(previous)
      || PUNCTUATION_CHARACTER.test(previous)
    );
  }

  return true;
}

function getMarkType(schema: Schema, pair: NormalizedMarkdownEditorAutoPair): MarkType | null {
  return pair.mark ? schema.marks[pair.mark] ?? null : null;
}

function rangeFullyHasMark(
  state: EditorState,
  from: number,
  to: number,
  markType: MarkType,
) {
  let sawInline = false;
  let fullyMarked = true;

  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true;
    sawInline = true;

    if (!markType.isInSet(node.marks)) fullyMarked = false;
    return undefined;
  });

  return sawInline && fullyMarked;
}

type TrackedAutoPair = Readonly<{
  active: boolean;
  closeProgress: number;
  closeFrom: number;
  id: number;
  name: MarkdownEditorAutoPair;
  openFrom: number;
}>;

type PendingAutoPair = Readonly<{
  from: number;
  name: MarkdownEditorAutoPair;
}>;

type AutoPairPluginState = Readonly<{
  pairs: readonly TrackedAutoPair[];
  pending: PendingAutoPair | null;
}>;

type AutoPairPluginMeta = Readonly<{
  add?: TrackedAutoPair;
  deactivate?: number;
  pending?: PendingAutoPair | null;
  progress?: Readonly<{ id: number; value: number }>;
  remove?: number;
}>;

export const MARKDOWN_EDITOR_APPLIED_INPUT_RULE_META = "markora:applied-input-rule";
export const MARKDOWN_EDITOR_HISTORY_ACTION_META = "markora:history-action";

export function createTrackedHistoryCommand(
  command: Command,
  action: MarkdownEditorHistoryAction,
): Command {
  return (state, dispatch, view) => command(
    state,
    dispatch
      ? (transaction) => {
          transaction.setMeta(MARKDOWN_EDITOR_HISTORY_ACTION_META, action);
          dispatch(transaction);
        }
      : undefined,
    view,
  );
}

function readInlineText(state: EditorState, from: number, length: number) {
  if (from < 0 || from + length > state.doc.content.size) return null;
  const $from = state.doc.resolve(from);
  const parentOffset = $from.parentOffset;

  if (!$from.parent.inlineContent || parentOffset + length > $from.parent.content.size) return null;
  return $from.parent.textBetween(parentOffset, parentOffset + length, "\uFFFC", "\uFFFC");
}

function trackedPairIsValid(
  state: EditorState,
  tracked: TrackedAutoPair,
  spec: NormalizedMarkdownEditorAutoPair,
) {
  if (
    readInlineText(state, tracked.openFrom, spec.open.length) !== spec.open
    || readInlineText(state, tracked.closeFrom, spec.close.length) !== spec.close
  ) {
    return false;
  }

  return state.doc.resolve(tracked.openFrom).sameParent(state.doc.resolve(tracked.closeFrom));
}

function rehydrateTrackedPair(
  state: EditorState,
  tracked: TrackedAutoPair,
  spec: NormalizedMarkdownEditorAutoPair,
) {
  if (readInlineText(state, tracked.openFrom, spec.open.length) !== spec.open) {
    return Object.freeze({ ...tracked, active: false, closeProgress: 0 });
  }

  const candidates = [
    tracked.closeFrom,
    tracked.closeFrom - spec.close.length,
    tracked.openFrom + spec.open.length,
  ];

  for (const closeFrom of candidates) {
    const candidate = Object.freeze({
      ...tracked,
      active: true,
      closeFrom,
      closeProgress: 0,
    });

    if (trackedPairIsValid(state, candidate, spec)) return candidate;
  }

  return Object.freeze({ ...tracked, active: false, closeProgress: 0 });
}

function mapTrackedPairWithoutDelimiterEdits(
  transaction: Transaction,
  tracked: TrackedAutoPair,
  spec: NormalizedMarkdownEditorAutoPair,
) {
  let openFrom = tracked.openFrom;
  let closeFrom = tracked.closeFrom;

  for (const stepMap of transaction.mapping.maps) {
    let touchesDelimiter = false;

    stepMap.forEach((oldStart, oldEnd) => {
      const touchesRange = (from: number, to: number) => (
        oldStart === oldEnd
          ? oldStart > from && oldStart < to
          : oldStart < to && oldEnd > from
      );

      if (
        touchesRange(openFrom, openFrom + spec.open.length)
        || touchesRange(closeFrom, closeFrom + spec.close.length)
      ) {
        touchesDelimiter = true;
      }
    });

    if (touchesDelimiter) return null;
    openFrom = stepMap.map(openFrom, 1);
    closeFrom = stepMap.map(closeFrom, 1);
  }

  return { closeFrom, openFrom };
}

export function createAutoPairPlugin(options: {
  inputRulePlugins?: readonly Plugin[];
  schema: Schema;
  typing: NormalizedMarkdownEditorTypingOptions;
}) {
  const { inputRulePlugins = [], schema, typing } = options;

  if (typing.autoPairs.length === 0) return null;

  const enabledPairs = typing.autoPairs.filter((pair) => !pair.mark || schema.marks[pair.mark]);

  if (enabledPairs.length === 0) return null;

  const pairsByName = new Map(enabledPairs.map((pair) => [pair.name, pair]));
  const openingPairs = [...enabledPairs]
    .sort((left, right) => left.open.length - right.open.length);
  const caretOpeningPairs = openingPairs.filter((pair) => pair.autoClose);
  const pluginKey = new PluginKey<AutoPairPluginState>("markoraAutoPairs");
  let nextPairId = 1;

  return new Plugin<AutoPairPluginState>({
    key: pluginKey,
    state: {
      init: () => Object.freeze({ pairs: Object.freeze([]), pending: null }),
      apply(transaction, previous, _oldState, newState) {
        const meta = transaction.getMeta(pluginKey) as AutoPairPluginMeta | undefined;
        let pairs = previous.pairs;

        if (transaction.docChanged) {
          const historyAction = transaction.getMeta(MARKDOWN_EDITOR_HISTORY_ACTION_META);
          pairs = previous.pairs.flatMap((tracked) => {
            const spec = pairsByName.get(tracked.name);

            if (!spec) return [];
            if (meta?.deactivate === tracked.id) {
              return [Object.freeze({ ...tracked, active: false, closeProgress: 0 })];
            }
            if (!tracked.active && historyAction !== "redo" && historyAction !== "undo") {
              return [];
            }

            const mappedPositions = mapTrackedPairWithoutDelimiterEdits(
              transaction,
              tracked,
              spec,
            );

            if (mappedPositions) {
              const rehydrated = rehydrateTrackedPair(
                newState,
                Object.freeze({
                  ...tracked,
                  active: false,
                  ...mappedPositions,
                }),
                spec,
              );

              if (rehydrated.active) {
                return [rehydrated];
              }
            }

            if (historyAction === "redo" || historyAction === "undo") {
              const original = rehydrateTrackedPair(
                newState,
                Object.freeze({ ...tracked, active: false, closeProgress: 0 }),
                spec,
              );

              return [original.active
                ? original
                : Object.freeze({ ...tracked, active: false, closeProgress: 0 })];
            }

            return [];
          });
        }

        if (meta?.remove !== undefined) {
          pairs = pairs.filter((tracked) => tracked.id !== meta.remove);
        }

        if (meta?.progress) {
          pairs = pairs.map((tracked) => tracked.id === meta.progress!.id
            ? Object.freeze({ ...tracked, closeProgress: meta.progress!.value })
            : tracked);
        }

        if (meta?.add) pairs = [...pairs, meta.add];

        if (pairs.length > 64) pairs = pairs.slice(-64);

        let pending = previous.pending;

        if (transaction.docChanged) pending = null;
        if (meta && Object.prototype.hasOwnProperty.call(meta, "pending")) {
          pending = meta.pending ?? null;
        }

        if (pending) {
          const spec = pairsByName.get(pending.name);
          const selectionAtEnd = newState.selection.empty
            && newState.selection.from === pending.from + (spec?.trigger.length ?? 0);

          if (!spec || !selectionAtEnd || readInlineText(newState, pending.from, spec.trigger.length) !== spec.trigger) {
            pending = null;
          }
        }

        return Object.freeze({ pairs: Object.freeze(pairs), pending });
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (view.composing || !(view.state.selection instanceof TextSelection)) return false;

        const { selection } = view.state;

        if (selection.from !== from || selection.to !== to || !selection.$from.sameParent(selection.$to)) {
          return false;
        }

        const parent = selection.$from.parent;

        if (
          !parent.inlineContent
          || parent.type === schema.nodes.code_block
          || Boolean(
            schema.marks.code
            && (
              selection.empty
                ? schema.marks.code.isInSet(view.state.storedMarks ?? selection.$from.marks())
                : view.state.doc.rangeHasMark(selection.from, selection.to, schema.marks.code)
            )
          )
        ) {
          return false;
        }

        if (!selection.empty) {
          if (!typing.wrapSelection) return false;
          const pair = openingPairs.find((candidate) => candidate.trigger === text);

          if (!pair) return false;

          const markType = getMarkType(schema, pair);
          const transaction = view.state.tr;

          if (pair.mark) {
            if (!markType || !parent.type.allowsMarkType(markType)) return false;
            if (rangeFullyHasMark(view.state, from, to, markType)) {
              transaction.removeMark(from, to, markType);
            } else {
              transaction.addMark(from, to, markType.create());
            }
            transaction.setSelection(TextSelection.create(
              transaction.doc,
              selection.anchor,
              selection.head,
            ));
          } else {
            transaction.insertText(pair.close, to);
            transaction.insertText(pair.open, from);
            transaction.setSelection(TextSelection.create(
              transaction.doc,
              selection.anchor + pair.open.length,
              selection.head + pair.open.length,
            ));
            transaction.setMeta(pluginKey, {
              add: Object.freeze({
                active: true,
                closeFrom: to + pair.open.length,
                closeProgress: 0,
                id: nextPairId++,
                name: pair.name,
                openFrom: from,
              }),
            } satisfies AutoPairPluginMeta);
          }

          view.dispatch(transaction.scrollIntoView());
          return true;
        }

        const pluginState = pluginKey.getState(view.state);
        const pending = pluginState?.pending;
        const pendingPair = pending ? pairsByName.get(pending.name) : undefined;

        if (
          pending
          && pendingPair
          && pendingPair.open.length > pendingPair.trigger.length
          && pendingPair.trigger === text
          && pending.from + pendingPair.trigger.length === from
        ) {
          const remainder = pendingPair.open.slice(pendingPair.trigger.length);
          const inserted = `${remainder}${pendingPair.close}`;
          const transaction = view.state.tr.insertText(inserted, from, to);
          const closeFrom = from + remainder.length;
          transaction.setSelection(TextSelection.create(transaction.doc, closeFrom));
          transaction.setMeta(pluginKey, {
            add: Object.freeze({
              active: true,
              closeFrom,
              closeProgress: 0,
              id: nextPairId++,
              name: pendingPair.name,
              openFrom: pending.from,
            }),
            pending: null,
          } satisfies AutoPairPluginMeta);
          view.dispatch(transaction.scrollIntoView());
          return true;
        }

        const parentStart = selection.$from.start();
        const offset = from - parentStart;
        const textBefore = parent.textBetween(0, offset, "\uFFFC", "\uFFFC");
        const textAfter = parent.textBetween(offset, parent.content.size, "\uFFFC", "\uFFFC");
        const tracked = pluginState?.pairs.find((candidate) => (
          candidate.active
          &&
          candidate.closeFrom + candidate.closeProgress === from
          && pairsByName.get(candidate.name)?.close.startsWith(text)
        ));
        const closingPair = tracked ? pairsByName.get(tracked.name) : undefined;

        if (closingPair && tracked) {
          const promotion = caretOpeningPairs.find((candidate) => (
            candidate.trigger === text
            && candidate.kind === "markdown"
            && candidate.open.length > closingPair.open.length
            && tracked.closeProgress === 0
            && tracked.openFrom + closingPair.open.length === from
          ));

          if (promotion) {
            const addedLength = promotion.open.length - closingPair.open.length;
            const addedOpen = promotion.open.slice(closingPair.open.length);
            const addedClose = promotion.close.slice(0, addedLength);
            const transaction = view.state.tr.insertText(`${addedOpen}${addedClose}`, from, to);
            const closeFrom = from + addedOpen.length;
            transaction.setSelection(TextSelection.create(transaction.doc, closeFrom));
            transaction.setMeta(pluginKey, {
              add: Object.freeze({
                active: true,
                closeFrom,
                closeProgress: 0,
                id: nextPairId++,
                name: promotion.name,
                openFrom: tracked.openFrom,
              }),
              remove: tracked.id,
            } satisfies AutoPairPluginMeta);
            view.dispatch(transaction.scrollIntoView());
            return true;
          }

          const nextProgress = tracked.closeProgress + text.length;

          if (nextProgress < closingPair.close.length) {
            const transaction = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, tracked.closeFrom + nextProgress),
            );
            transaction.setMeta("addToHistory", false);
            transaction.setMeta(pluginKey, {
              progress: { id: tracked.id, value: nextProgress },
            } satisfies AutoPairPluginMeta);
            view.dispatch(transaction.scrollIntoView());
            return true;
          }

          const contentFrom = tracked.openFrom + closingPair.open.length;
          const markType = getMarkType(schema, closingPair);

          if (
            markType
            && contentFrom < from
            && parent.type.allowsMarkType(markType)
          ) {
            const transaction = view.state.tr;
            transaction.delete(tracked.closeFrom, tracked.closeFrom + closingPair.close.length);
            transaction.delete(tracked.openFrom, tracked.openFrom + closingPair.open.length);
            const contentTo = tracked.closeFrom - closingPair.open.length;
            transaction.addMark(tracked.openFrom, contentTo, markType.create());
            transaction.setSelection(TextSelection.create(transaction.doc, contentTo));
            transaction.setMeta(pluginKey, { remove: tracked.id } satisfies AutoPairPluginMeta);
            view.dispatch(transaction.scrollIntoView());
          } else {
            const transaction = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, from + closingPair.close.length),
            );
            transaction.setMeta("addToHistory", false);
            transaction.setMeta(pluginKey, { remove: tracked.id } satisfies AutoPairPluginMeta);
            view.dispatch(transaction.scrollIntoView());
          }

          return true;
        }

        const openingPair = caretOpeningPairs.find((candidate) => candidate.trigger === text);

        if (
          !openingPair
          || (openingPair.mark && !parent.type.allowsMarkType(getMarkType(schema, openingPair)!))
          || !canOpenMarkdownEditorAutoPair(openingPair, textBefore, textAfter)
        ) {
          return false;
        }

        if (openingPair.open.length > openingPair.trigger.length) {
          const transaction = view.state.tr.insertText(text, from, to);
          transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
          transaction.setMeta(pluginKey, {
            pending: Object.freeze({ from, name: openingPair.name }),
          } satisfies AutoPairPluginMeta);
          view.dispatch(transaction.scrollIntoView());
          return true;
        }

        const transaction = view.state.tr.insertText(
          `${openingPair.open}${openingPair.close}`,
          from,
          to,
        );
        transaction.setSelection(TextSelection.create(
          transaction.doc,
          from + openingPair.open.length,
        ));
        transaction.setMeta(pluginKey, {
          add: Object.freeze({
            active: true,
            closeFrom: from + openingPair.open.length,
            closeProgress: 0,
            id: nextPairId++,
            name: openingPair.name,
            openFrom: from,
          }),
        } satisfies AutoPairPluginMeta);
        view.dispatch(transaction.scrollIntoView());
        return true;
      },
      handleKeyDown(view, event) {
        if (
          event.key !== "Backspace"
          || event.altKey
          || event.ctrlKey
          || event.metaKey
          || event.isComposing
          || event.keyCode === 229
          || view.composing
          || !(view.state.selection instanceof TextSelection)
          || !view.state.selection.empty
        ) {
          return false;
        }

        const { selection } = view.state;
        const parent = selection.$from.parent;

        if (!parent.inlineContent || parent.type === schema.nodes.code_block) return false;

        const pluginState = pluginKey.getState(view.state);
        const tracked = pluginState?.pairs.find((candidate) => {
          const pair = pairsByName.get(candidate.name);
          return candidate.active && pair
            ? candidate.openFrom + pair.open.length === selection.from
              && candidate.closeFrom === selection.from
              && candidate.closeProgress === 0
            : false;
        });
        const pair = tracked ? pairsByName.get(tracked.name) : undefined;

        if (!pair || !tracked) return false;

        event.preventDefault();
        const from = tracked.openFrom;
        const transaction = view.state.tr.delete(
          from,
          tracked.closeFrom + pair.close.length,
        );
        transaction.setSelection(TextSelection.create(transaction.doc, from));
        transaction.setMeta(pluginKey, { deactivate: tracked.id } satisfies AutoPairPluginMeta);
        view.dispatch(transaction.scrollIntoView());
        return true;
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const previous = pluginKey.getState(oldState);

      if (!previous || previous.pairs.length === 0) return null;

      let appliedInput: { from: number; text: string } | null = null;

      for (const transaction of transactions) {
        const extensionMeta = transaction.getMeta(MARKDOWN_EDITOR_APPLIED_INPUT_RULE_META) as
          | { from?: unknown; text?: unknown }
          | undefined;

        if (typeof extensionMeta?.from === "number" && typeof extensionMeta.text === "string") {
          appliedInput = { from: extensionMeta.from, text: extensionMeta.text };
          break;
        }

        for (const inputRulePlugin of inputRulePlugins) {
          const inputRuleMeta = transaction.getMeta(inputRulePlugin) as
            | { from?: unknown; text?: unknown }
            | undefined;

          if (typeof inputRuleMeta?.from === "number" && typeof inputRuleMeta.text === "string") {
            appliedInput = { from: inputRuleMeta.from, text: inputRuleMeta.text };
            break;
          }
        }

        if (appliedInput) break;
      }

      if (!appliedInput) return null;

      const tracked = previous.pairs.find((candidate) => {
        const pair = pairsByName.get(candidate.name);
        return candidate.active && pair
          ? candidate.closeFrom + candidate.closeProgress === appliedInput!.from
            && pair.close.slice(candidate.closeProgress).startsWith(appliedInput!.text)
          : false;
      });
      const pair = tracked ? pairsByName.get(tracked.name) : undefined;

      if (!tracked || !pair) return null;

      let mappedClose = tracked.closeFrom + tracked.closeProgress;

      for (const transaction of transactions) {
        mappedClose = transaction.mapping.map(mappedClose, 1);
      }

      const remainingClose = pair.close.slice(tracked.closeProgress);

      if (readInlineText(newState, mappedClose, remainingClose.length) !== remainingClose) {
        return null;
      }

      const transaction = newState.tr.delete(mappedClose, mappedClose + remainingClose.length);
      transaction.setMeta(pluginKey, { remove: tracked.id } satisfies AutoPairPluginMeta);
      return transaction;
    },
  });
}
