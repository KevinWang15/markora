export { renderMath } from "@markora/react-ui/renderMath";
import type { DiagramRenderer } from "markora-extension-diagrams";

let diagramSequence = 0;
let diagramQueue: Promise<unknown> = Promise.resolve();
export const renderMermaid: DiagramRenderer = request => {
  // Mermaid owns singleton configuration and a temporary layout tree.
  const task = diagramQueue.then(async () => {
    const { source, ownerDocument, signal } = request;
    signal.throwIfAborted();
    if (source.length > 50_000) throw new Error("Diagram source exceeds the preview limit.");
    if (/%%\s*\{|^---\s*$/mu.test(source)) throw new Error("Diagram configuration directives are not supported in previews.");
    const { default: mermaid } = await import("mermaid");
    signal.throwIfAborted();
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral",
      htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: 50_000, maxEdges: 500,
      suppressErrorRendering: true });
    const container = ownerDocument.createElement("div");
    container.style.cssText = "position:fixed;left:-100000px;width:1000px;visibility:hidden;pointer-events:none";
    ownerDocument.body.append(container);
    try {
      const { svg } = await mermaid.render(`markora-diagram-${++diagramSequence}`, source, container);
      signal.throwIfAborted();
      const template = ownerDocument.createElement("template");
      template.innerHTML = svg;
      // Styling belongs to the host; the extension's final DOM clamp rejects
      // active output, foreignObject, external references, and unsafe attributes.
      template.content.querySelectorAll("style, filter").forEach(element => element.remove());
      template.content.querySelectorAll("*").forEach(element => {
        for (const attribute of [...element.attributes]) {
          if (attribute.name.startsWith("data-") || attribute.name === "aria-roledescription") element.removeAttribute(attribute.name);
          if (attribute.name === "filter") element.removeAttribute(attribute.name);
        }
        if (element instanceof SVGElement) element.style.removeProperty("filter");
      });
      return ownerDocument.importNode(template.content, true);
    } finally { container.remove(); }
  });
  diagramQueue = task.catch(() => undefined);
  return task;
};
