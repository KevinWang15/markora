export type FrontmatterMessages = Readonly<{
  aliasLimitDiagnostic: string;
  customTagDiagnostic: string;
  documentInvariantDiagnostic: string;
  editSource: string;
  insertFrontmatter: string;
  invalidStructureDiagnostic: string;
  kindLabel: string;
  nestingLimitDiagnostic: string;
  sourceLabel: string;
  sourceTooLargeDiagnostic: string;
  tabIndentationDiagnostic: string;
  unbalancedFlowDiagnostic: string;
}>;

export type FrontmatterMessageOverrides = Partial<FrontmatterMessages>;

export const defaultFrontmatterMessages: FrontmatterMessages = Object.freeze({
  aliasLimitDiagnostic: "YAML aliases exceed the safe inspection limit; source remains inert.",
  customTagDiagnostic: "YAML tags are not interpreted; source remains inert.",
  documentInvariantDiagnostic: "Front matter must have a valid source envelope, be the only front-matter node, and remain at the document head.",
  editSource: "Edit front matter source",
  insertFrontmatter: "Insert front matter",
  invalidStructureDiagnostic: "Front matter must use a document-head YAML delimiter and contain a mapping key.",
  kindLabel: "YAML front matter",
  nestingLimitDiagnostic: "YAML nesting exceeds the safe inspection limit; source remains inert.",
  sourceLabel: "YAML front matter source",
  sourceTooLargeDiagnostic: "Front matter exceeds the safe source-size limit; source remains inert.",
  tabIndentationDiagnostic: "Tab indentation is not portable YAML and may not be understood by downstream tools.",
  unbalancedFlowDiagnostic: "YAML flow brackets appear unbalanced; source remains editable and exact.",
});

export function normalizeFrontmatterMessages(
  overrides: FrontmatterMessageOverrides | undefined,
): FrontmatterMessages {
  if (overrides === undefined) {
    return defaultFrontmatterMessages;
  }

  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    throw new TypeError("Front matter messages must be a plain partial message object.");
  }

  const knownKeys = new Set(Object.keys(defaultFrontmatterMessages));

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`Unknown front matter message key "${key}".`);
    }

    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Front matter message "${key}" must be a non-empty string.`);
    }
  }

  return Object.freeze({ ...defaultFrontmatterMessages, ...overrides });
}
