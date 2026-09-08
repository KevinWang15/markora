import {
  createEditor,
  createMinimalMarkdownEditorPreset,
} from "markora/minimal";
import {
  packedCalloutExtension,
  packedHighlightExtension,
} from "./extensions";
import "markora/minimal.css";

export const packedExternalExtensions = [
  packedCalloutExtension,
  packedHighlightExtension,
];

export function mountMinimalEditor(element) {
  return createEditor({
    element,
    extensions: packedExternalExtensions,
    markdown: ":::note\nPacked ==extension== consumer.\n:::",
  });
}

export const packedMinimalSurface = [
  typeof createEditor,
  typeof createMinimalMarkdownEditorPreset,
].join(":");
