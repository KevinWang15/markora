export type FootnotesMessages = Readonly<{
  backReferenceLabel(label: string, number: number, occurrence: number): string;
  backReferenceText(occurrence: number): string;
  definitionLabel(label: string, number: number): string;
  definitionSourceLabel(label: string): string;
  definitionText(label: string, number: number): string;
  duplicateDefinitionDiagnostic(label: string, occurrence: number): string;
  duplicateDefinitionLabel(label: string, number: number, occurrence: number): string;
  invalidDocumentDiagnostic(label: string): string;
  invalidReferenceContextDiagnostic(label: string): string;
  nestedDefinitionDiagnostic(label: string): string;
  referenceLabel(label: string, number: number, occurrence: number): string;
  referenceSourceLabel(label: string): string;
  referenceText(number: number): string;
  referencesLabel(label: string): string;
  unresolvedReferenceDiagnostic(label: string, occurrence: number): string;
  unresolvedReferenceLabel(label: string, number: number, occurrence: number): string;
}>;

export type FootnotesMessageOverrides = Partial<FootnotesMessages>;

export const defaultFootnotesMessages: FootnotesMessages = Object.freeze({
  backReferenceLabel: (label, number, occurrence) => (
    `Back to reference ${occurrence} for footnote ${number}: ${label}`
  ),
  backReferenceText: (occurrence) => occurrence === 1 ? "↩" : `↩${occurrence}`,
  definitionLabel: (label, number) => `Footnote ${number} definition: ${label}`,
  definitionSourceLabel: (label) => `Footnote definition: ${label}`,
  definitionText: (label, number) => `Footnote ${number}: ${label}`,
  duplicateDefinitionDiagnostic: (label, occurrence) => (
    `Footnote definition ${occurrence} for "${label}" is a duplicate; the first definition resolves references.`
  ),
  duplicateDefinitionLabel: (label, number, occurrence) => (
    `Duplicate definition ${occurrence} for footnote ${number}: ${label}`
  ),
  invalidDocumentDiagnostic: (label) => (
    `Footnote label "${label}" is invalid; the document change was rejected.`
  ),
  invalidReferenceContextDiagnostic: (label) => (
    `Footnote reference "${label}" cannot carry a code mark; the document change was rejected.`
  ),
  nestedDefinitionDiagnostic: (label) => (
    `Footnote definition "${label}" cannot be nested inside another footnote definition.`
  ),
  referenceLabel: (label, number, occurrence) => (
    `Footnote ${number}, reference ${occurrence}: ${label}`
  ),
  referenceSourceLabel: (label) => `Footnote reference: ${label}`,
  referenceText: (number) => String(number),
  referencesLabel: (label) => `References to footnote: ${label}`,
  unresolvedReferenceDiagnostic: (label, occurrence) => (
    `Footnote reference ${occurrence} for "${label}" has no definition.`
  ),
  unresolvedReferenceLabel: (label, number, occurrence) => (
    `Unresolved footnote ${number}, reference ${occurrence}: ${label}`
  ),
});

type MessageKey = keyof FootnotesMessages;

const formatterSamples: Readonly<Record<MessageKey, readonly unknown[]>> = Object.freeze({
  backReferenceLabel: ["note", 1, 1],
  backReferenceText: [1],
  definitionLabel: ["note", 1],
  definitionSourceLabel: ["note"],
  definitionText: ["note", 1],
  duplicateDefinitionDiagnostic: ["note", 2],
  duplicateDefinitionLabel: ["note", 1, 2],
  invalidDocumentDiagnostic: ["note"],
  invalidReferenceContextDiagnostic: ["note"],
  nestedDefinitionDiagnostic: ["note"],
  referenceLabel: ["note", 1, 1],
  referenceSourceLabel: ["note"],
  referenceText: [1],
  referencesLabel: ["note"],
  unresolvedReferenceDiagnostic: ["note", 1],
  unresolvedReferenceLabel: ["note", 1, 1],
});

function validateOutput(key: MessageKey, output: unknown): string {
  if (typeof output !== "string" || !output.trim()) {
    throw new TypeError(`Footnotes message formatter "${key}" must return a non-empty string.`);
  }

  return output;
}

function wrapFormatter<K extends MessageKey>(
  key: K,
  formatter: FootnotesMessages[K],
): FootnotesMessages[K] {
  const wrapped = (...args: unknown[]) => validateOutput(
    key,
    (formatter as (...values: unknown[]) => unknown)(...args),
  );

  validateOutput(
    key,
    (formatter as (...values: unknown[]) => unknown)(...formatterSamples[key]),
  );
  return wrapped as FootnotesMessages[K];
}

export function normalizeFootnotesMessages(
  overrides: FootnotesMessageOverrides | undefined,
): FootnotesMessages {
  if (overrides === undefined) {
    return defaultFootnotesMessages;
  }

  if (
    typeof overrides !== "object"
    || overrides === null
    || Array.isArray(overrides)
    || (
      Object.getPrototypeOf(overrides) !== Object.prototype
      && Object.getPrototypeOf(overrides) !== null
    )
  ) {
    throw new TypeError("Footnotes messages must be a plain partial message object.");
  }

  const knownKeys = new Set(Object.keys(defaultFootnotesMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`Unknown footnotes message key "${key}".`);
    }

    if (typeof value !== "function") {
      throw new TypeError(`Footnotes message "${key}" must be a formatter function.`);
    }
  }

  const merged = { ...defaultFootnotesMessages, ...overrides } as FootnotesMessages;
  const normalized = {} as { -readonly [K in MessageKey]: FootnotesMessages[K] };

  for (const key of Object.keys(defaultFootnotesMessages) as MessageKey[]) {
    normalized[key] = wrapFormatter(key, merged[key]) as never;
  }

  return Object.freeze(normalized);
}
