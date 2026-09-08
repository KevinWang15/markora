import katex from "katex";
import type { MathRenderer } from "markora-extension-math";

/** Native MathML stays portable in exports and needs no CSS or web fonts. */
export const renderMath: MathRenderer = ({ source, kind, ownerDocument, signal }) => {
  signal.throwIfAborted();
  if (source.length > 65_536) throw new Error("Math source exceeds the preview limit.");
  const template = ownerDocument.createElement("template");
  template.innerHTML = katex.renderToString(source, {
    displayMode: kind === "block", output: "mathml", trust: false,
    throwOnError: true, strict: "error", maxExpand: 1000, maxSize: 100,
  });
  return ownerDocument.importNode(template.content, true);
};
