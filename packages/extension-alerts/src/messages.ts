import type { AlertKind } from "./index.js";

export type AlertsMessages = Readonly<{
  alertLabel(kind: AlertKind, kindLabel: string): string;
  cautionKindLabel: string;
  importantKindLabel: string;
  invalidDocumentDiagnostic(kind: string): string;
  noteKindLabel: string;
  tipKindLabel: string;
  toggleAlert: string;
  warningKindLabel: string;
}>;

export type AlertsMessageOverrides = Partial<AlertsMessages>;

export const defaultAlertsMessages: AlertsMessages = Object.freeze({
  alertLabel: (_kind, kindLabel) => `${kindLabel} alert`,
  cautionKindLabel: "Caution",
  importantKindLabel: "Important",
  invalidDocumentDiagnostic: (kind) => `Alert kind "${kind}" is invalid; the document change was rejected.`,
  noteKindLabel: "Note",
  tipKindLabel: "Tip",
  toggleAlert: "Toggle alert",
  warningKindLabel: "Warning",
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeAlertsMessages(
  overrides: AlertsMessageOverrides | undefined,
): AlertsMessages {
  if (overrides === undefined) {
    return defaultAlertsMessages;
  }

  if (!isPlainObject(overrides)) {
    throw new TypeError("Alert messages must be a plain partial message object.");
  }

  const knownKeys = new Set(Object.keys(defaultAlertsMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`Unknown alert message key "${key}".`);
    }

    const defaultValue = defaultAlertsMessages[key as keyof AlertsMessages];

    if (typeof value !== typeof defaultValue) {
      throw new TypeError(
        `Alert message "${key}" must be ${typeof defaultValue === "function" ? "a formatter function" : "a non-empty string"}.`,
      );
    }

    if (typeof value === "string" && !value.trim()) {
      throw new TypeError(`Alert message "${key}" must be a non-empty string.`);
    }
  }

  const merged = { ...defaultAlertsMessages, ...overrides };
  const alertLabel = (...args: Parameters<AlertsMessages["alertLabel"]>) => {
    const value = merged.alertLabel(...args);
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError('Alert message "alertLabel" must return non-empty text.');
    }
    return value;
  };
  const invalidDocumentDiagnostic = (
    ...args: Parameters<AlertsMessages["invalidDocumentDiagnostic"]>
  ) => {
    const value = merged.invalidDocumentDiagnostic(...args);
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(
        'Alert message "invalidDocumentDiagnostic" must return non-empty text.',
      );
    }
    return value;
  };

  alertLabel("note", merged.noteKindLabel);
  invalidDocumentDiagnostic("unknown");

  return Object.freeze({
    ...merged,
    alertLabel,
    invalidDocumentDiagnostic,
  });
}
