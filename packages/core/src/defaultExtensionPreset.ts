import {
  defineMarkdownEditorPreset,
  type MarkdownEditorExtensionPreset,
} from "./extensionApi";
import { MARKORA_VERSION } from "./extensionVersion";

const defaultPreset = defineMarkdownEditorPreset({
  name: "markora/default",
  version: MARKORA_VERSION,
  extensions: [],
});

export function createDefaultMarkdownEditorPreset(): MarkdownEditorExtensionPreset {
  return defaultPreset;
}
