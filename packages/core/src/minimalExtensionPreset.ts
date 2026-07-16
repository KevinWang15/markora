import {
  defineMarkdownEditorPreset,
  type MarkdownEditorExtensionPreset,
} from "./extensionApi";
import { MARKORA_VERSION } from "./extensionVersion";

const minimalPreset = defineMarkdownEditorPreset({
  name: "markora/minimal",
  version: MARKORA_VERSION,
  extensions: [],
});

export function createMinimalMarkdownEditorPreset(): MarkdownEditorExtensionPreset {
  return minimalPreset;
}
