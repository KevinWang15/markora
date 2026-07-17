export type DefaultUiTableMode = "create" | "resize";

export type DefaultUiTableGroup = "row" | "column" | "alignment" | "table";

export type DefaultUiTableControl =
  | "insert-row-before"
  | "insert-row-after"
  | "move-row-up"
  | "move-row-down"
  | "delete-row"
  | "insert-column-before"
  | "insert-column-after"
  | "move-column-left"
  | "move-column-right"
  | "delete-column"
  | "automatic-alignment"
  | "align-left"
  | "align-center"
  | "align-right"
  | "resize-table"
  | "delete-table";

export type DefaultUiTableAction = Exclude<
  DefaultUiTableControl,
  "resize-table" | "delete-table"
>;

export type DefaultUiTableSelectionContext = Readonly<{
  /** One-based inclusive column index. */
  columnFrom: number;
  /** One-based inclusive column index. */
  columnTo: number;
  /** One-based inclusive row index. */
  rowFrom: number;
  /** One-based inclusive row index. */
  rowTo: number;
}>;

export type DefaultUiTableActionStatusContext = Readonly<{
  action: DefaultUiTableAction;
  selection: DefaultUiTableSelectionContext | null;
}>;

export type DefaultUiMessages = Readonly<{
  cancelButtonLabel: string;
  codeBlockLanguageDialogLabel: string;
  codeBlockLanguageInputLabel: string;
  codeBlockLanguageInputPlaceholder: string;
  codeBlockLanguageInvalidError: (context: Readonly<{ maximumLength: number }>) => string;
  codeBlockLanguageStaleError: string;
  imageAltInputLabel: string;
  imageAltInputPlaceholder: string;
  imageDialogLabel: string;
  imageTitleInputLabel: string;
  imageTitleInputPlaceholder: string;
  imageUrlInputLabel: string;
  imageUrlInputPlaceholder: string;
  imageUrlInvalidError: string;
  linkDialogLabel: string;
  linkUrlInputLabel: string;
  linkUrlInputPlaceholder: string;
  linkUrlInvalidError: string;
  removeButtonLabel: string;
  saveButtonLabel: string;
  tableActionStatus: (context: DefaultUiTableActionStatusContext) => string;
  tableColumnsInputLabel: string;
  tableControlLabel: (control: DefaultUiTableControl) => string;
  tableDialogLabel: (mode: DefaultUiTableMode) => string;
  tableDimensionsInvalidError: (
    context: Readonly<{ maximum: number; minimum: number }>,
  ) => string;
  tableGroupLabel: (group: DefaultUiTableGroup) => string;
  tableOperationError: (mode: DefaultUiTableMode) => string;
  tableRowsInputLabel: string;
  tableSelectionStatus: (context: DefaultUiTableSelectionContext) => string;
  tableSubmitButtonLabel: (mode: DefaultUiTableMode) => string;
  tableToolbarLabel: string;
  unlinkButtonLabel: string;
}>;

export type DefaultUiMessageOverrides = Readonly<Partial<DefaultUiMessages>>;

const tableControlLabels: Readonly<Record<DefaultUiTableControl, string>> = Object.freeze({
  "insert-row-before": "Insert row before",
  "insert-row-after": "Insert row after",
  "move-row-up": "Move row up",
  "move-row-down": "Move row down",
  "delete-row": "Delete row",
  "insert-column-before": "Insert column before",
  "insert-column-after": "Insert column after",
  "move-column-left": "Move column left",
  "move-column-right": "Move column right",
  "delete-column": "Delete column",
  "automatic-alignment": "Automatic alignment",
  "align-left": "Align left",
  "align-center": "Align center",
  "align-right": "Align right",
  "resize-table": "Resize table",
  "delete-table": "Delete table",
});

const tableGroupLabels: Readonly<Record<DefaultUiTableGroup, string>> = Object.freeze({
  row: "Row",
  column: "Column",
  alignment: "Alignment",
  table: "Table",
});

const tableActionLabels: Readonly<Record<DefaultUiTableAction, string>> = Object.freeze({
  "insert-row-before": "Inserted row before.",
  "insert-row-after": "Inserted row after.",
  "move-row-up": "Moved row up.",
  "move-row-down": "Moved row down.",
  "delete-row": "Deleted row.",
  "insert-column-before": "Inserted column before.",
  "insert-column-after": "Inserted column after.",
  "move-column-left": "Moved column left.",
  "move-column-right": "Moved column right.",
  "delete-column": "Deleted column.",
  "automatic-alignment": "Set automatic alignment.",
  "align-left": "Aligned column left.",
  "align-center": "Aligned column center.",
  "align-right": "Aligned column right.",
});

function describeTableSelection(context: DefaultUiTableSelectionContext) {
  const { columnFrom, columnTo, rowFrom, rowTo } = context;

  if (rowFrom === rowTo && columnFrom === columnTo) {
    return `Cell at row ${rowFrom}, column ${columnFrom} selected.`;
  }

  const rows = rowFrom === rowTo ? `row ${rowFrom}` : `rows ${rowFrom} through ${rowTo}`;
  const columns = columnFrom === columnTo
    ? `column ${columnFrom}`
    : `columns ${columnFrom} through ${columnTo}`;
  return `Rectangular selection: ${rows} and ${columns}.`;
}

export const defaultUiMessages: DefaultUiMessages = Object.freeze({
  cancelButtonLabel: "Cancel",
  codeBlockLanguageDialogLabel: "Edit code block language",
  codeBlockLanguageInputLabel: "Code block language or fence info",
  codeBlockLanguageInputPlaceholder: "Language or fence info",
  codeBlockLanguageInvalidError: ({ maximumLength }) => (
    `Fence info must be at most ${maximumLength} characters with no NUL or line-break characters.`
  ),
  codeBlockLanguageStaleError: "The code block changed. Close this editor and try again.",
  imageAltInputLabel: "Alt text",
  imageAltInputPlaceholder: "Alt text",
  imageDialogLabel: "Edit image",
  imageTitleInputLabel: "Title",
  imageTitleInputPlaceholder: "Title",
  imageUrlInputLabel: "Image URL",
  imageUrlInputPlaceholder: "Image URL",
  imageUrlInvalidError: "Enter a valid image URL.",
  linkDialogLabel: "Edit link",
  linkUrlInputLabel: "Link URL",
  linkUrlInputPlaceholder: "https://example.com",
  linkUrlInvalidError: "Enter a valid link URL.",
  removeButtonLabel: "Remove",
  saveButtonLabel: "Save",
  tableActionStatus: ({ action, selection }) => selection
    ? `${tableActionLabels[action]} ${describeTableSelection(selection)}`
    : tableActionLabels[action],
  tableColumnsInputLabel: "Columns",
  tableControlLabel: (control) => tableControlLabels[control],
  tableDialogLabel: (mode) => mode === "create" ? "Create table" : "Resize table",
  tableDimensionsInvalidError: ({ maximum, minimum }) => (
    `Enter whole numbers from ${minimum} through ${maximum}.`
  ),
  tableGroupLabel: (group) => tableGroupLabels[group],
  tableOperationError: (mode) => mode === "create"
    ? "The table could not be inserted at the current selection."
    : "The table could not be resized. Clear content outside the new size and try again.",
  tableRowsInputLabel: "Rows",
  tableSelectionStatus: describeTableSelection,
  tableSubmitButtonLabel: (mode) => mode === "create" ? "Create" : "Resize",
  tableToolbarLabel: "Table controls",
  unlinkButtonLabel: "Unlink",
});

const messageKeys = Object.freeze(
  Object.keys(defaultUiMessages) as (keyof DefaultUiMessages)[],
);
const messageKeySet = new Set<PropertyKey>(messageKeys);

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function requireNonblankString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a nonblank string.`);
  }

  return value;
}

export function formatDefaultUiMessage<TArgs extends readonly unknown[]>(
  name: string,
  formatter: (...args: TArgs) => string,
  ...args: TArgs
) {
  return requireNonblankString(formatter(...args), `${name} result`);
}

function validateFormatterResults(messages: DefaultUiMessages) {
  const selection = Object.freeze({ columnFrom: 2, columnTo: 3, rowFrom: 3, rowTo: 4 });
  const singleCell = Object.freeze({ columnFrom: 2, columnTo: 2, rowFrom: 3, rowTo: 3 });

  formatDefaultUiMessage(
    "messages.codeBlockLanguageInvalidError",
    messages.codeBlockLanguageInvalidError,
    Object.freeze({ maximumLength: 128 }),
  );
  formatDefaultUiMessage(
    "messages.tableDimensionsInvalidError",
    messages.tableDimensionsInvalidError,
    Object.freeze({ maximum: 100, minimum: 1 }),
  );

  for (const control of Object.keys(tableControlLabels) as DefaultUiTableControl[]) {
    formatDefaultUiMessage("messages.tableControlLabel", messages.tableControlLabel, control);
  }

  for (const group of Object.keys(tableGroupLabels) as DefaultUiTableGroup[]) {
    formatDefaultUiMessage("messages.tableGroupLabel", messages.tableGroupLabel, group);
  }

  for (const mode of ["create", "resize"] as const) {
    formatDefaultUiMessage("messages.tableDialogLabel", messages.tableDialogLabel, mode);
    formatDefaultUiMessage("messages.tableOperationError", messages.tableOperationError, mode);
    formatDefaultUiMessage("messages.tableSubmitButtonLabel", messages.tableSubmitButtonLabel, mode);
  }

  formatDefaultUiMessage("messages.tableSelectionStatus", messages.tableSelectionStatus, singleCell);
  formatDefaultUiMessage("messages.tableSelectionStatus", messages.tableSelectionStatus, selection);

  for (const action of Object.keys(tableActionLabels) as DefaultUiTableAction[]) {
    formatDefaultUiMessage(
      "messages.tableActionStatus",
      messages.tableActionStatus,
      Object.freeze({ action, selection }),
    );
  }

  formatDefaultUiMessage(
    "messages.tableActionStatus",
    messages.tableActionStatus,
    Object.freeze({ action: "delete-row", selection: null }),
  );
}

export function normalizeDefaultUiMessages(
  overrides: DefaultUiMessageOverrides | undefined,
): DefaultUiMessages {
  if (overrides === undefined) {
    return defaultUiMessages;
  }

  if (!isRecord(overrides)) {
    throw new TypeError("Default UI messages must be an object.");
  }

  for (const key of Reflect.ownKeys(overrides)) {
    if (!messageKeySet.has(key)) {
      throw new RangeError(`Unknown default UI message key ${String(key)}.`);
    }
  }

  const normalized = { ...defaultUiMessages };

  for (const key of messageKeys) {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
      continue;
    }

    const value = overrides[key];
    if (value === undefined) {
      continue;
    }

    if (typeof defaultUiMessages[key] === "function") {
      if (typeof value !== "function") {
        throw new TypeError(`messages.${key} must be a function.`);
      }
    } else {
      requireNonblankString(value, `messages.${key}`);
    }

    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  const result = Object.freeze(normalized) as DefaultUiMessages;
  validateFormatterResults(result);
  return result;
}
