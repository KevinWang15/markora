import { useCallback, type RefObject } from "react";
import type { MarkdownEditor } from "markora";
import type { MarkdownThemeController } from "markora/themes";
import type { DocumentController } from "./DocumentController";
import type { SourceEditorHandle } from "./SourceEditor";
import type { createDocumentBridge } from "./documentBridge";
import { captureExportTheme } from "./exportTheme";
import { desktop } from "./desktop";

export function useDocumentExport({ controller, editorRef, sourceEditorRef, sourceModeRef,
  documentBridge, documentName, themeController, finishRichInput, showError }: {
  controller: DocumentController;
  editorRef: RefObject<MarkdownEditor | null>;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
  sourceModeRef: RefObject<boolean>;
  documentBridge: ReturnType<typeof createDocumentBridge>;
  documentName: string;
  themeController: MarkdownThemeController;
  finishRichInput(): boolean;
  showError(cause: unknown, fallback: string): void;
}) {
  return useCallback(async (format: "html" | "pdf") => {
    if (controller.getSnapshot().exporting || document.querySelector("dialog[open]") || editorRef.current?.view.composing || sourceEditorRef.current?.isComposing()) return;
    const current = editorRef.current;
    if (!current || !finishRichInput()) return;
    current.flushChange();
    const path = controller.snapshot.path;
    try {
      await controller.export(async () => {
        const doc = sourceModeRef.current ? current.extensions.get(documentBridge).state.parse(sourceEditorRef.current?.getMarkdown() ?? controller.markdown) : current.view.state.doc;
        if (!doc) throw new Error("This source could not be parsed for export.");
        const exportTheme = format === "pdf" ? captureExportTheme(current.view.dom, themeController.getSnapshot().id) : undefined;
        const { buildExport, printExport } = await import("./exportDocument");
        const output = await buildExport(doc, documentName, { resolveImage: url => desktop.exportImage(path, url), theme: exportTheme });
        if (format === "html") await desktop.exportHtml(documentName.replace(/\.[^.]+$/u, "") + ".html", output.html);
        else await printExport(output, () => desktop.exportPdf(documentName.replace(/\.[^.]+$/u, "") + ".pdf"), desktop.isNative);
      });
    } catch (cause) { showError(cause, "The document could not be exported."); }
  }, [controller, documentName, showError, themeController, documentBridge, editorRef, sourceEditorRef, sourceModeRef, finishRichInput]);
}
