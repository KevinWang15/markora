import type { MathRenderer } from "markora-extension-math";

/** Native MathML avoids webfont loads and remains portable in exported documents. */
export const renderMath: MathRenderer = async ({ source, kind, ownerDocument, signal }) => {
  if (source.length > 65_536) throw new Error("Math source exceeds the preview limit.");
  const { default: katex } = await import("katex");
  signal.throwIfAborted();
  const template = ownerDocument.createElement("template");
  template.innerHTML = katex.renderToString(source, {
    displayMode: kind === "block", output: "mathml", trust: false,
    throwOnError: true, strict: "error", maxExpand: 1000, maxSize: 100,
  });
  return ownerDocument.importNode(template.content, true);
};

