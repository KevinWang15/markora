import {
  defineMarkoraMarkdownEditorExtension,
  defineMarkdownEditorPreset,
  type MarkdownEditorExtensionPreset,
} from "./extensionApi";
import { MARKORA_VERSION } from "./extensionVersion";

// These definitions name the compatibility adapters that still own legacy
// foundation patches. Their schema/runtime contributions migrate onto the
// same public path incrementally without changing persisted identities.
const compatibilityBuiltins = [
  ["@markora/strike", "Strike-through Markdown syntax"],
  ["@markora/table", "GFM pipe tables and table navigation"],
  ["@markora/task-list", "Task list item attributes and controls"],
  ["@markora/code-mirror", "Nested CodeMirror fence rendering"],
  ["@markora/opaque", "Opaque unsupported-Markdown preservation"],
] as const;

export const defaultMarkdownEditorExtensions = Object.freeze(
  compatibilityBuiltins.map(([name, description]) => (
    defineMarkoraMarkdownEditorExtension({
      name,
      version: "1.0.0",
      compatibility: { extensionApi: "^1.0.0", markora: "^0.0.1" },
      configuration: { description, adapter: "compatibility-foundation" },
    })
  )),
);

const defaultPreset = defineMarkdownEditorPreset({
  name: "markora/default",
  version: MARKORA_VERSION,
  extensions: defaultMarkdownEditorExtensions,
});

export function createDefaultMarkdownEditorPreset(): MarkdownEditorExtensionPreset {
  return defaultPreset;
}
