import { keydownHandler } from "prosemirror-keymap";
import type { Command, Plugin } from "prosemirror-state";
import { Plugin as ProseMirrorPlugin } from "prosemirror-state";

export type MarkdownEditorShortcutBinding = false | string | readonly string[];
export type MarkdownEditorShortcutMap = Readonly<Record<string, MarkdownEditorShortcutBinding>>;

export type NormalizedMarkdownEditorShortcutMap = Readonly<Record<string, readonly string[]>>;

export type MarkdownEditorShortcutContribution = Readonly<{
  command: Command;
  defaultKeys: readonly string[];
  id: string;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const IS_MAC_PLATFORM = typeof navigator !== "undefined"
  && /Mac|iP(hone|[oa]d)/u.test(navigator.platform);

function normalizeKeyName(value: string, id: string) {
  const parts = value.split(/-(?!$)/u);
  let result = parts[parts.length - 1]!;
  let alt = false;
  let ctrl = false;
  let meta = false;
  let shift = false;

  if (result === "Space") result = " ";

  for (const modifier of parts.slice(0, -1)) {
    if (/^(cmd|meta|m)$/iu.test(modifier)) meta = true;
    else if (/^a(lt)?$/iu.test(modifier)) alt = true;
    else if (/^(c|ctrl|control)$/iu.test(modifier)) ctrl = true;
    else if (/^s(hift)?$/iu.test(modifier)) shift = true;
    else if (/^mod$/iu.test(modifier)) {
      if (IS_MAC_PLATFORM) meta = true;
      else ctrl = true;
    } else {
      throw new RangeError(
        `Shortcut key ${JSON.stringify(value)} for ${JSON.stringify(id)} uses an unknown modifier ${JSON.stringify(modifier)}.`,
      );
    }
  }

  if (alt) result = `Alt-${result}`;
  if (ctrl) result = `Ctrl-${result}`;
  if (meta) result = `Meta-${result}`;
  if (shift) result = `Shift-${result}`;
  return result;
}

function normalizeKeys(value: MarkdownEditorShortcutBinding, id: string) {
  if (value === false) return Object.freeze([]) as readonly string[];
  const values = typeof value === "string" ? [value] : value;

  if (!Array.isArray(values)) {
    throw new TypeError(`Shortcut binding ${JSON.stringify(id)} must be a string, an array of strings, or false.`);
  }

  if (values.length > 16) {
    throw new RangeError(`Shortcut binding ${JSON.stringify(id)} may contain at most 16 keys.`);
  }

  const keys: string[] = [];

  for (const candidate of values) {
    if (typeof candidate !== "string") {
      throw new TypeError(`Shortcut binding ${JSON.stringify(id)} must contain only strings.`);
    }

    if (!candidate.trim() || candidate !== candidate.trim() || candidate.length > 128) {
      throw new RangeError(`Shortcut key ${JSON.stringify(candidate)} for ${JSON.stringify(id)} is invalid.`);
    }

    const normalized = normalizeKeyName(candidate, id);
    if (!keys.includes(normalized)) keys.push(normalized);
  }

  return Object.freeze(keys);
}

export function normalizeMarkdownEditorShortcuts(
  value: MarkdownEditorShortcutMap | undefined,
): NormalizedMarkdownEditorShortcutMap {
  if (value !== undefined && !isPlainRecord(value)) {
    throw new TypeError("Shortcut options must be an object.");
  }

  const normalized: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;

  for (const [id, binding] of Object.entries(value ?? {})) {
    if (!id.trim() || id !== id.trim() || id.length > 256) {
      throw new RangeError(`Shortcut contribution ID ${JSON.stringify(id)} is invalid.`);
    }

    normalized[id] = normalizeKeys(binding, id);
  }

  return Object.freeze(normalized);
}

export function resolveMarkdownEditorShortcutKeys(
  shortcuts: NormalizedMarkdownEditorShortcutMap,
  id: string,
  defaultKeys: readonly string[],
) {
  return Object.prototype.hasOwnProperty.call(shortcuts, id)
    ? shortcuts[id]!
    : normalizeKeys(defaultKeys, id);
}

export function createCompositionSafeMarkdownEditorKeymap(
  bindings: Readonly<Record<string, Command>>,
): Plugin | null {
  if (Object.keys(bindings).length === 0) return null;
  const handleKeyDown = keydownHandler({ ...bindings });

  return new ProseMirrorPlugin({
    props: {
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        return handleKeyDown(view, event);
      },
    },
  });
}

export function createMarkdownEditorShortcutKeymap(
  contributions: readonly MarkdownEditorShortcutContribution[],
  shortcuts: NormalizedMarkdownEditorShortcutMap,
): Plugin | null {
  const candidatesByKey = new Map<string, Command[]>();
  const blockedDefaultKeys = new Set<string>();

  for (const contribution of contributions) {
    const resolvedKeys = resolveMarkdownEditorShortcutKeys(
      shortcuts,
      contribution.id,
      contribution.defaultKeys,
    );

    for (const key of resolvedKeys) {
      const candidates = candidatesByKey.get(key) ?? [];
      candidates.push(contribution.command);
      candidatesByKey.set(key, candidates);
    }

    for (const defaultKey of normalizeKeys(contribution.defaultKeys, contribution.id)) {
      if (!resolvedKeys.includes(defaultKey)) blockedDefaultKeys.add(defaultKey);
    }
  }

  for (const key of blockedDefaultKeys) {
    const candidates = candidatesByKey.get(key) ?? [];
    candidates.push(() => true);
    candidatesByKey.set(key, candidates);
  }

  if (candidatesByKey.size === 0) return null;

  const bindings: Record<string, Command> = {};

  for (const [key, candidates] of candidatesByKey) {
    bindings[key] = (state, dispatch, view) => {
      if (view?.composing) return false;

      for (const command of candidates) {
        if (command(state, dispatch, view)) return true;
      }

      return false;
    };
  }

  return createCompositionSafeMarkdownEditorKeymap(bindings);
}
