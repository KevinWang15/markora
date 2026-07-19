export type TocMessages = Readonly<{
  emptyState: string;
  goToHeadingLabel(label: string, level: number, index: number): string;
  insertToc: string;
  invalidPlacementDiagnostic: string;
  navigationLabel(occurrence: number, total: number): string;
  removeToc: string;
  untitledHeadingLabel(level: number, index: number): string;
}>;

export type TocMessageOverrides = Partial<TocMessages>;

export const defaultTocMessages: TocMessages = Object.freeze({
  emptyState: "No headings",
  goToHeadingLabel: (label, level, index) => (
    `Go to heading ${index}, level ${level}: ${label}`
  ),
  insertToc: "Insert table of contents",
  invalidPlacementDiagnostic: "Table of contents markers must be top-level document blocks.",
  navigationLabel: (occurrence, total) => total > 1
    ? `Table of contents ${occurrence} of ${total}`
    : "Table of contents",
  removeToc: "Remove table of contents",
  untitledHeadingLabel: (level, index) => (
    `Untitled heading ${index}, level ${level}`
  ),
});

type MessageKey = keyof TocMessages;

const formatterSamples: Readonly<Partial<Record<
  MessageKey,
  readonly unknown[]
>>> = Object.freeze({
  goToHeadingLabel: ["Introduction", 2, 1],
  navigationLabel: [1, 2],
  untitledHeadingLabel: [2, 1],
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
    throw new TypeError(`TOC message "${key}" must be a non-empty string.`);
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

export function normalizeTocMessages(
  overrides: TocMessageOverrides | undefined,
): TocMessages {
  if (overrides === undefined) {
    return defaultTocMessages;
  }

  if (!isPlainObject(overrides)) {
    throw new TypeError("TOC messages must be a plain partial message object.");
  }

  const knownKeys = new Set(Object.keys(defaultTocMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`Unknown TOC message key "${key}".`);
    }

    const messageKey = key as MessageKey;
    const defaultValue = defaultTocMessages[messageKey];

    if (typeof value !== typeof defaultValue) {
      const expected = typeof defaultValue === "function"
        ? "a formatter function"
        : "a non-empty string";
      throw new TypeError(`TOC message "${key}" must be ${expected}.`);
    }

    if (typeof value === "string") {
      validateText(messageKey, value);
    }
  }

  const merged = { ...defaultTocMessages, ...overrides } as TocMessages;
  const normalized = {} as { -readonly [K in MessageKey]: TocMessages[K] };

  for (const key of Object.keys(defaultTocMessages) as MessageKey[]) {
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
