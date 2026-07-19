import type { DiagramKind } from "./source";

export type DiagramMessages = Readonly<{
  editSource: string;
  invalidDocumentDiagnostic: string;
  invalidInfoDiagnostic: string;
  invalidRendererOutputDiagnostic(kind: DiagramKind): string;
  kindLabel(kind: DiagramKind): string;
  previewFailed: string;
  previewLabel(kind: DiagramKind): string;
  previewLoading: string;
  rendererFailedDiagnostic(kind: DiagramKind): string;
  rendererUnavailable(kind: DiagramKind): string;
  renderOutputLimitDiagnostic(kind: DiagramKind): string;
  retryPreview: string;
  showPreview: string;
  showSource: string;
  sourceLabel(kind: DiagramKind, info: string): string;
  sourceTooLargeDiagnostic(maxBytes: number): string;
  unsafeRendererOutputDiagnostic(kind: DiagramKind): string;
}>;

export type DiagramMessageOverrides = Partial<DiagramMessages>;

function englishKind(kind: DiagramKind) {
  return kind === "mermaid"
    ? "Mermaid"
    : kind === "geojson"
      ? "GeoJSON"
      : kind === "topojson" ? "TopoJSON" : "STL";
}

export const defaultDiagramMessages: DiagramMessages = Object.freeze({
  editSource: "Edit diagram source",
  invalidDocumentDiagnostic: "Diagram nodes must retain a supported kind, a normalized complete fence info string, and canonical code text.",
  invalidInfoDiagnostic: "Diagram info must be a normalized one-line fenced-code info string whose first token is mermaid, geojson, topojson, or stl.",
  invalidRendererOutputDiagnostic: (kind) => `${englishKind(kind)} renderer returned an invalid DOM result; source remains available.`,
  kindLabel: (kind) => `${englishKind(kind)} diagram`,
  previewFailed: "Diagram preview failed; source remains available.",
  previewLabel: (kind) => `${englishKind(kind)} diagram preview`,
  previewLoading: "Rendering diagram preview",
  rendererFailedDiagnostic: (kind) => `${englishKind(kind)} preview could not be rendered; source remains available.`,
  rendererUnavailable: (kind) => `${englishKind(kind)} preview is unavailable; source remains available.`,
  renderOutputLimitDiagnostic: (kind) => `${englishKind(kind)} preview exceeded the safe output limit; source remains available.`,
  retryPreview: "Retry diagram preview",
  showPreview: "Show diagram preview",
  showSource: "Show diagram source",
  sourceLabel: (kind, info) => `${englishKind(kind)} diagram source; fence info: ${info}`,
  sourceTooLargeDiagnostic: (maxBytes) => `Diagram source exceeds the safe ${maxBytes.toLocaleString("en-US")}-byte rendering limit; source remains editable and serializes unchanged.`,
  unsafeRendererOutputDiagnostic: (kind) => `${englishKind(kind)} renderer returned unsafe DOM; source remains available.`,
});

type MessageKey = keyof DiagramMessages;

const formatterSamples: Readonly<Partial<Record<MessageKey, readonly unknown[]>>> = Object.freeze({
  invalidRendererOutputDiagnostic: ["mermaid"],
  kindLabel: ["geojson"],
  previewLabel: ["topojson"],
  rendererFailedDiagnostic: ["stl"],
  rendererUnavailable: ["mermaid"],
  renderOutputLimitDiagnostic: ["geojson"],
  sourceLabel: ["mermaid", "mermaid theme=neutral"],
  sourceTooLargeDiagnostic: [65_536],
  unsafeRendererOutputDiagnostic: ["stl"],
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
    throw new TypeError(`Diagram message "${key}" must be a non-empty string.`);
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

export function normalizeDiagramMessages(
  overrides: DiagramMessageOverrides | undefined,
): DiagramMessages {
  if (overrides === undefined) {
    return defaultDiagramMessages;
  }
  if (!isPlainObject(overrides)) {
    throw new TypeError("Diagram messages must be a plain partial message object.");
  }

  const known = new Set(Object.keys(defaultDiagramMessages));
  for (const [key, value] of Object.entries(overrides)) {
    if (!known.has(key)) {
      throw new TypeError(`Unknown diagram message key "${key}".`);
    }
    const messageKey = key as MessageKey;
    const baseline = defaultDiagramMessages[messageKey];
    if (typeof value !== typeof baseline) {
      throw new TypeError(`Diagram message "${key}" has the wrong value type.`);
    }
    if (typeof value === "string") {
      validateText(messageKey, value);
    }
  }

  const merged = { ...defaultDiagramMessages, ...overrides } as DiagramMessages;
  const normalized = {} as { -readonly [K in MessageKey]: DiagramMessages[K] };
  for (const key of Object.keys(defaultDiagramMessages) as MessageKey[]) {
    const value = merged[key];
    normalized[key] = (
      typeof value === "function"
        ? wrapFormatter(key, value as (...args: never[]) => string, formatterSamples[key] ?? [])
        : validateText(key, value)
    ) as never;
  }
  return Object.freeze(normalized);
}
