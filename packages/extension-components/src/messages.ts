export type ComponentMessages = Readonly<{
  edit: string;
  editSource: string;
  sourceLabel: string;
  apply: string;
  cancel: string;
  unavailable: string;
  invalidProps: string;
  renderFailed: string;
  staleEdit: string;
}>;

export const defaultComponentMessages: ComponentMessages = Object.freeze({
  edit: "Edit component",
  editSource: "Edit properties",
  sourceLabel: "Component properties (JSON)",
  apply: "Apply changes",
  cancel: "Cancel",
  unavailable: "This component is not registered. Its source is preserved.",
  invalidProps: "Invalid component properties. Edit the JSON source to repair them.",
  renderFailed: "The component could not be rendered. Its source is preserved.",
  staleEdit: "This component changed while you were editing. Reopen the editor to try again.",
});

export function normalizeMessages(overrides: Partial<ComponentMessages> = {}): ComponentMessages {
  const messages = { ...defaultComponentMessages };
  for (const key of Object.keys(overrides) as (keyof ComponentMessages)[]) {
    if (!Object.prototype.hasOwnProperty.call(defaultComponentMessages, key)
      || typeof overrides[key] !== "string" || !overrides[key]!.trim()) {
      throw new TypeError(`Invalid component message "${key}".`);
    }
    messages[key] = overrides[key]!;
  }
  return Object.freeze(messages);
}
