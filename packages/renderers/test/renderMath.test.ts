import { afterEach, expect, it } from "vitest";
import { createRenderers, type MarkoraRenderers } from "../src/index";
const registries: MarkoraRenderers[] = [];
const renderMath = (...args: Parameters<MarkoraRenderers["math"]>) => {
  const renderers = createRenderers(); registries.push(renderers);
  return renderers.math(...args);
};
afterEach(() => { for (const renderers of registries.splice(0)) renderers.destroy(); });

it("renders semantic MathML for both hosts without styles, links, or font assets", async () => {
  for (const kind of ["inline", "block"] as const) {
    const result = await renderMath({ source: String.raw`\frac{a}{b}`, kind, ownerDocument: document, signal: new AbortController().signal });
    const host = document.createElement("div"); host.append(result);
    expect(host.querySelector("math mfrac")).not.toBeNull();
    expect(host.querySelector("math")?.getAttribute("display")).toBe(kind === "block" ? "block" : null);
    expect(host.querySelector("script, style, link, img, a")).toBeNull();
    expect(host.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(String.raw`\frac{a}{b}`);
  }
});

it("rejects invalid LaTeX and cancelled previews instead of returning stale output", async () => {
  const controller = new AbortController();
  await expect(renderMath({ source: String.raw`\notARealCommand`, kind: "block", ownerDocument: document, signal: controller.signal })).rejects.toThrow("Undefined control sequence");
  controller.abort();
  await expect(renderMath({ source: "x", kind: "inline", ownerDocument: document, signal: controller.signal })).rejects.toThrow();
});
