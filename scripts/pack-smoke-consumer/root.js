import {
  createEditor,
  createDefaultCodeBlockLanguageRegistry,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
} from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

export function mountRootEditor(element) {
  return createEditor({
    element,
    markdown: "# Packed root editor",
    resources: {
      images: { referrerPolicy: "no-referrer" },
      links: { allowedProtocols: ["https:"] },
    },
    ui: createDefaultUi(),
  });
}

export const packedRootSurface = [
  typeof createEditor,
  typeof createDefaultCodeBlockLanguageRegistry,
  typeof getMarkdownEditorTransactionOrigin,
  typeof setMarkdownEditorTransactionOrigin,
  typeof createDefaultUi,
].join(":");
