import mermaid from "mermaid";
import type { DiagramRenderer } from "markora-extension-diagrams";
import { parseDiagramSvg } from "./svg";
import { inlineMermaidStyles } from "./mermaid-style";

// This adapter renders explicit requests. Mermaid's automatic page-load scan is
// unnecessary and otherwise retains a global listener after a late lazy import.
if (typeof window !== "undefined") window.removeEventListener("load", mermaid.contentLoaded);

let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

export const renderMermaid: DiagramRenderer = request => {
  // Mermaid owns singleton configuration and temporary layout DOM. Keep actual
  // engine calls serialized even when a consumer stops waiting after abort.
  const task = queue.then(async () => {
    const { source, ownerDocument, signal } = request;
    signal.throwIfAborted();
    if (source.length > 50_000) throw new Error("Diagram source exceeds the preview limit.");
    if (/%%\s*\{|^---\s*$/mu.test(source)) throw new Error("Diagram configuration directives are not supported in previews.");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral",
      htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: 50_000, maxEdges: 500,
      suppressErrorRendering: true });
    const container = ownerDocument.createElement("div");
    container.style.cssText = "position:fixed;left:-100000px;width:1000px;visibility:hidden;pointer-events:none";
    ownerDocument.body.append(container);
    try {
      const { svg } = await mermaid.render(`markora-diagram-${++sequence}`, source, container);
      signal.throwIfAborted();
      return parseDiagramSvg(inlineMermaidStyles(svg, container), ownerDocument);
    } finally { container.remove(); }
  });
  queue = task.catch(() => undefined);
  return task;
};
