type MathMessageKind = "inline" | "block";

export type MathMessages = Readonly<{
  blockKindLabel: string;
  blockSourceLabel(source: string): string;
  editSource: string;
  inlineKindLabel: string;
  inlineSourceLabel(source: string): string;
  invalidBlockSourceDiagnostic: string;
  invalidDocumentDiagnostic: string;
  invalidInlineSourceDiagnostic: string;
  invalidRendererOutputDiagnostic(kind: MathMessageKind): string;
  previewFailed: string;
  previewLabel(kind: MathMessageKind): string;
  previewLoading: string;
  rendererFailedDiagnostic(kind: MathMessageKind): string;
  rendererUnavailable: string;
  renderOutputLimitDiagnostic(kind: MathMessageKind): string;
  retryPreview: string;
  showPreview: string;
  showSource: string;
  sourceTooLargeDiagnostic(maxBytes: number): string;
  unsafeRendererOutputDiagnostic(kind: MathMessageKind): string;
}>;

export type MathMessageOverrides = Partial<MathMessages>;

function kindName(kind: MathMessageKind) {
  return kind === "inline" ? "Inline math" : "Block math";
}

export const defaultMathMessages: MathMessages = Object.freeze({
  blockKindLabel: "Block math",
  blockSourceLabel: (source) => `Block math source: ${source}`,
  editSource: "Edit math source",
  inlineKindLabel: "Inline math",
  inlineSourceLabel: (source) => `Inline math source: ${source}`,
  invalidBlockSourceDiagnostic: "Block math source must use canonical line endings and cannot contain a standalone double-dollar delimiter line.",
  invalidDocumentDiagnostic: "Math nodes must contain canonical source, use valid Markdown boundaries, and remain outside code.",
  invalidInlineSourceDiagnostic: "Inline math source must be non-empty, stay on one line, have no surrounding whitespace, and round-trip through one single-dollar shell.",
  invalidRendererOutputDiagnostic: (kind) => `${kindName(kind)} renderer returned an invalid DOM result; source remains available.`,
  previewFailed: "Math preview failed; source remains available.",
  previewLabel: (kind) => `${kindName(kind)} preview`,
  previewLoading: "Rendering math preview",
  rendererFailedDiagnostic: (kind) => `${kindName(kind)} preview could not be rendered; source remains available.`,
  rendererUnavailable: "Math preview is unavailable; source remains available.",
  renderOutputLimitDiagnostic: (kind) => `${kindName(kind)} preview exceeded the safe output limit; source remains available.`,
  retryPreview: "Retry math preview",
  showPreview: "Show math preview",
  showSource: "Show math source",
  sourceTooLargeDiagnostic: (maxBytes) => `Math source exceeds the safe ${maxBytes.toLocaleString("en-US")}-byte rendering limit; source remains editable and serializes unchanged.`,
  unsafeRendererOutputDiagnostic: (kind) => `${kindName(kind)} renderer returned unsafe DOM; source remains available.`,
});

type MessageKey = keyof MathMessages;

const formatterSamples: Readonly<Partial<Record<MessageKey, readonly unknown[]>>> = Object.freeze({
  blockSourceLabel: ["x^2"],
  inlineSourceLabel: ["x^2"],
  invalidRendererOutputDiagnostic: ["inline"],
  previewLabel: ["block"],
  rendererFailedDiagnostic: ["inline"],
  renderOutputLimitDiagnostic: ["block"],
  sourceTooLargeDiagnostic: [65_536],
  unsafeRendererOutputDiagnostic: ["inline"],
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
    throw new TypeError(`Math message "${key}" must be a non-empty string.`);
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

export function normalizeMathMessages(
  overrides: MathMessageOverrides | undefined,
): MathMessages {
  if (overrides === undefined) {
    return defaultMathMessages;
  }

  if (!isPlainObject(overrides)) {
    throw new TypeError("Math messages must be a plain partial message object.");
  }

  const knownKeys = new Set(Object.keys(defaultMathMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`Unknown math message key "${key}".`);
    }

    const messageKey = key as MessageKey;
    const defaultValue = defaultMathMessages[messageKey];

    if (typeof value !== typeof defaultValue) {
      const expected = typeof defaultValue === "function"
        ? "a formatter function"
        : "a non-empty string";
      throw new TypeError(`Math message "${key}" must be ${expected}.`);
    }

    if (typeof value === "string") {
      validateText(messageKey, value);
    }
  }

  const merged = { ...defaultMathMessages, ...overrides } as MathMessages;
  const normalized = {} as { -readonly [K in MessageKey]: MathMessages[K] };

  for (const key of Object.keys(defaultMathMessages) as MessageKey[]) {
    const message = merged[key];
    const samples = formatterSamples[key];

    normalized[key] = (
      typeof message === "function"
        ? wrapFormatter(
            key,
            message as (...args: never[]) => string,
            samples ?? [],
          )
        : validateText(key, message)
    ) as never;
  }

  return Object.freeze(normalized);
}
