import type { HtmlDisplay, HtmlSourceKind } from "./source";

export type HtmlMessages = Readonly<{
  blockKindLabel: string;
  commentKindLabel: string;
  editSource: string;
  inlineKindLabel: string;
  invalidDocumentDiagnostic: string;
  invalidRendererOutputDiagnostic: string;
  invalidSourceDiagnostic(display: HtmlDisplay): string;
  previewFailed: string;
  previewLabel: string;
  previewLoading: string;
  rendererFailedDiagnostic: string;
  rendererUnavailable: string;
  renderOutputLimitDiagnostic: string;
  retryPreview: string;
  showPreview: string;
  showSource: string;
  sourceLabel(kind: HtmlSourceKind): string;
  sourceTooLargeDiagnostic(maxBytes: number): string;
  unsafeRendererOutputDiagnostic: string;
}>;

export type HtmlMessageOverrides = Partial<HtmlMessages>;

export const defaultHtmlMessages: HtmlMessages = Object.freeze({
  blockKindLabel: "HTML block",
  commentKindLabel: "HTML comment",
  editSource: "Edit HTML source",
  inlineKindLabel: "Inline HTML",
  invalidDocumentDiagnostic: "HTML atoms must remain one exact CommonMark HTML token in their original block or inline placement.",
  invalidRendererOutputDiagnostic: "The HTML renderer returned an invalid DOM result; exact source remains available.",
  invalidSourceDiagnostic: (display) => `HTML source must classify as exactly one ${display} HTML atom.`,
  previewFailed: "HTML preview failed; exact source remains available.",
  previewLabel: "Sanitized HTML preview",
  previewLoading: "Rendering sanitized HTML preview",
  rendererFailedDiagnostic: "The HTML preview could not be rendered; exact source remains available.",
  rendererUnavailable: "HTML preview is unavailable; exact source remains available.",
  renderOutputLimitDiagnostic: "The HTML preview exceeded the safe output limit; exact source remains available.",
  retryPreview: "Retry HTML preview",
  showPreview: "Show HTML preview",
  showSource: "Show HTML source",
  sourceLabel: (kind) => kind === "html-block"
    ? "HTML block source"
    : kind === "inline-html" ? "Inline HTML source" : "HTML comment source",
  sourceTooLargeDiagnostic: (maxBytes) => `HTML source exceeds the safe ${maxBytes.toLocaleString("en-US")}-byte preview limit; exact source remains editable and serializes unchanged.`,
  unsafeRendererOutputDiagnostic: "The HTML renderer returned unsafe DOM; exact source remains available.",
});

type MessageKey = keyof HtmlMessages;

const formatterSamples: Readonly<Partial<Record<MessageKey, readonly unknown[]>>> = Object.freeze({
  invalidSourceDiagnostic: ["block"],
  sourceLabel: ["html-block"],
  sourceTooLargeDiagnostic: [262_144],
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateText(key: MessageKey, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`HTML message "${key}" must be a non-empty string.`);
  }
  return value;
}

function wrapFormatter(
  key: MessageKey,
  formatter: (...args: never[]) => string,
  samples: readonly unknown[],
) {
  const invoke = (...args: unknown[]) => validateText(
    key,
    (formatter as (...values: unknown[]) => unknown)(...args),
  );
  invoke(...samples);
  return invoke;
}

export function normalizeHtmlMessages(
  overrides: HtmlMessageOverrides | undefined,
): HtmlMessages {
  if (overrides === undefined) {
    return defaultHtmlMessages;
  }
  if (!isPlainObject(overrides)) {
    throw new TypeError("HTML messages must be a plain partial message object.");
  }

  const known = new Set(Object.keys(defaultHtmlMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!known.has(key)) {
      throw new TypeError(`Unknown HTML message key "${key}".`);
    }
    const messageKey = key as MessageKey;
    const baseline = defaultHtmlMessages[messageKey];

    if (typeof value !== typeof baseline) {
      throw new TypeError(`HTML message "${key}" has the wrong value type.`);
    }
    if (typeof value === "string") {
      validateText(messageKey, value);
    }
  }

  const merged = { ...defaultHtmlMessages, ...overrides } as HtmlMessages;
  const normalized = {} as { -readonly [K in MessageKey]: HtmlMessages[K] };

  for (const key of Object.keys(defaultHtmlMessages) as MessageKey[]) {
    const value = merged[key];
    normalized[key] = (
      typeof value === "function"
        ? wrapFormatter(key, value as (...args: never[]) => string, formatterSamples[key] ?? [])
        : validateText(key, value)
    ) as never;
  }
  return Object.freeze(normalized);
}
