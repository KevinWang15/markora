import { defineMarkdownEditorExtension, type Node as MarkdownNode } from "markora/extension-api";

/** Uses the editor's configured dialect for history and source validation. */
export function createDocumentBridge() {
  return defineMarkdownEditorExtension({
    name: "markora-app-document",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.1.0", markora: "^0.1.0" },
    createRuntime({ codec }) {
      return { state: {
        parse: (source: string) => codec.parse(source),
        serialize: (doc: MarkdownNode) => codec.serialize(doc),
      } };
    },
  });
}
