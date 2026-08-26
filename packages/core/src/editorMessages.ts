import type { OpaqueMarkdownKind } from "./opaqueMarkdown";

export type MarkdownEditorCodeBlockLanguageMessageContext = Readonly<{
  /** The exact fence info stored on the code block, or an empty string. */
  language: string;
  /** The visible language label after applying the plain-text fallback. */
  languageLabel: string;
}>;

export type MarkdownEditorOpaqueMessageContext = Readonly<{
  kind: OpaqueMarkdownKind;
  kindLabel: string;
}>;

export type MarkdownEditorMessages = Readonly<{
  codeBlockEditorLabel: string;
  codeBlockPlainTextLabel: string;
  codeBlockEditLanguageLabel: (
    context: MarkdownEditorCodeBlockLanguageMessageContext,
  ) => string;
  imageBlockedByPolicy: string;
  imageEmptyAltTextLabel: string;
  imageFailedToLoad: string;
  imageLoading: string;
  imageMissingUrl: string;
  opaqueEditSource: string;
  opaqueEditSourceLabel: (context: MarkdownEditorOpaqueMessageContext) => string;
  opaqueKindLabels: Readonly<Record<OpaqueMarkdownKind, string>>;
  opaqueSourceLabel: (context: MarkdownEditorOpaqueMessageContext) => string;
  taskFallbackLabel: string;
  uploadedFileLabel: string;
}>;

export type MarkdownEditorMessageOverrides = Readonly<
  Partial<Omit<MarkdownEditorMessages, "opaqueKindLabels">>
  & {
    opaqueKindLabels?: Readonly<Partial<Record<OpaqueMarkdownKind, string>>>;
  }
>;

const DEFAULT_OPAQUE_KIND_LABELS: Readonly<Record<OpaqueMarkdownKind, string>> = Object.freeze({
  "display-math": "Display math",
  "directive-container": "Directive container",
  "directive-leaf": "Directive",
  frontmatter: "Front matter",
  "html-block": "HTML block",
  "html-comment": "HTML comment",
  "inline-directive": "Inline directive",
  "inline-html": "Inline HTML",
  "unknown-fence": "Unknown fenced extension",
});

export const defaultMarkdownEditorMessages: MarkdownEditorMessages = Object.freeze({
  codeBlockEditorLabel: "Code block editor",
  codeBlockPlainTextLabel: "plain text",
  codeBlockEditLanguageLabel: ({ languageLabel }) => (
    `Edit code block language: ${languageLabel}`
  ),
  imageBlockedByPolicy: "Image blocked by resource policy",
  imageEmptyAltTextLabel: "Image without alternative text",
  imageFailedToLoad: "Image failed to load",
  imageLoading: "Loading image",
  imageMissingUrl: "Missing image URL",
  opaqueEditSource: "Edit source",
  opaqueEditSourceLabel: ({ kindLabel }) => `Edit ${kindLabel} Markdown source`,
  opaqueKindLabels: DEFAULT_OPAQUE_KIND_LABELS,
  opaqueSourceLabel: ({ kindLabel }) => `${kindLabel} Markdown source`,
  taskFallbackLabel: "Task",
  uploadedFileLabel: "Uploaded file",
});

const MESSAGE_KEYS = Object.freeze([
  "codeBlockEditorLabel",
  "codeBlockPlainTextLabel",
  "codeBlockEditLanguageLabel",
  "imageBlockedByPolicy",
  "imageEmptyAltTextLabel",
  "imageFailedToLoad",
  "imageLoading",
  "imageMissingUrl",
  "opaqueEditSource",
  "opaqueEditSourceLabel",
  "opaqueKindLabels",
  "opaqueSourceLabel",
  "taskFallbackLabel",
  "uploadedFileLabel",
] as const satisfies readonly (keyof MarkdownEditorMessages)[]);

const STRING_MESSAGE_KEYS = Object.freeze([
  "codeBlockEditorLabel",
  "codeBlockPlainTextLabel",
  "imageBlockedByPolicy",
  "imageEmptyAltTextLabel",
  "imageFailedToLoad",
  "imageLoading",
  "imageMissingUrl",
  "opaqueEditSource",
  "taskFallbackLabel",
  "uploadedFileLabel",
] as const);

const FORMATTER_MESSAGE_KEYS = Object.freeze([
  "codeBlockEditLanguageLabel",
  "opaqueEditSourceLabel",
  "opaqueSourceLabel",
] as const);

const OPAQUE_KINDS = Object.freeze(
  Object.keys(DEFAULT_OPAQUE_KIND_LABELS) as OpaqueMarkdownKind[],
);

function isOwn(record: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be an ordinary or null-prototype object.`);
  }
}

function assertKnownKeys(record: Record<string, unknown>, keys: readonly string[], path: string) {
  const knownKeys = new Set(keys);

  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !knownKeys.has(key)) {
      throw new TypeError(`${path} contains the unknown key ${JSON.stringify(String(key))}.`);
    }
  }
}

function readNonblankString(value: unknown, path: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a nonblank string.`);
  }

  return value;
}

function wrapFormatter<Context>(value: unknown, path: string): (context: Context) => string {
  if (typeof value !== "function") {
    throw new TypeError(`${path} must be a function.`);
  }

  const formatter = value as (context: Context) => unknown;
  return (context) => readNonblankString(formatter(context), `${path} result`);
}

/** @internal Normalizes and snapshots creation-time message overrides. */
export function normalizeMarkdownEditorMessages(
  overrides: MarkdownEditorMessageOverrides | undefined,
): MarkdownEditorMessages {
  if (overrides === undefined) {
    return defaultMarkdownEditorMessages;
  }

  assertPlainRecord(overrides, "messages");
  assertKnownKeys(overrides, MESSAGE_KEYS, "messages");

  const values = new Map<string, unknown>();
  for (const key of MESSAGE_KEYS) {
    if (isOwn(overrides, key) && overrides[key] !== undefined) {
      values.set(key, overrides[key]);
    }
  }

  const strings = Object.fromEntries(STRING_MESSAGE_KEYS.map((key) => [
    key,
    values.has(key)
      ? readNonblankString(values.get(key), `messages.${key}`)
      : defaultMarkdownEditorMessages[key],
  ])) as Pick<MarkdownEditorMessages, typeof STRING_MESSAGE_KEYS[number]>;

  const formatters = Object.fromEntries(FORMATTER_MESSAGE_KEYS.map((key) => [
    key,
    values.has(key)
      ? wrapFormatter(values.get(key), `messages.${key}`)
      : defaultMarkdownEditorMessages[key],
  ])) as Pick<MarkdownEditorMessages, typeof FORMATTER_MESSAGE_KEYS[number]>;

  let opaqueKindLabels = defaultMarkdownEditorMessages.opaqueKindLabels;
  if (values.has("opaqueKindLabels")) {
    const overrideLabels = values.get("opaqueKindLabels");
    assertPlainRecord(overrideLabels, "messages.opaqueKindLabels");
    assertKnownKeys(overrideLabels, OPAQUE_KINDS, "messages.opaqueKindLabels");
    const nextLabels = { ...defaultMarkdownEditorMessages.opaqueKindLabels };

    for (const kind of OPAQUE_KINDS) {
      if (isOwn(overrideLabels, kind) && overrideLabels[kind] !== undefined) {
        nextLabels[kind] = readNonblankString(
          overrideLabels[kind],
          `messages.opaqueKindLabels.${kind}`,
        );
      }
    }
    opaqueKindLabels = Object.freeze(nextLabels);
  }

  return Object.freeze({
    ...strings,
    ...formatters,
    opaqueKindLabels,
  });
}
