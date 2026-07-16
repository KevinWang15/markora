const extensionDefinitions = new WeakMap<object, unknown>();
const extensionPresets = new WeakMap<object, unknown>();

/** @internal */
export function registerMarkdownEditorExtensionDefinition(
  carrier: object,
  definition: unknown,
) {
  extensionDefinitions.set(carrier, definition);
}

/** @internal */
export function readRegisteredMarkdownEditorExtensionDefinition(
  carrier: object,
) {
  return extensionDefinitions.get(carrier);
}

/** @internal */
export function registerMarkdownEditorExtensionPreset(
  carrier: object,
  preset: unknown,
) {
  extensionPresets.set(carrier, preset);
}

/** @internal */
export function readRegisteredMarkdownEditorExtensionPreset(
  carrier: object,
) {
  return extensionPresets.get(carrier);
}
