import type { DiagramRenderer } from "markora-extension-diagrams";
import type { MathRenderer } from "markora-extension-math";
import { abortable, createLazyRenderer } from "./lazyRenderer";
import { createPlantUmlRenderer } from "./plantuml";

export { createLazyRenderer } from "./lazyRenderer";
export type { Renderer, RenderRequest } from "./lazyRenderer";

export type RendererOptions = Readonly<{ timeoutMs?: number }>;

/** Optional batteries for the headless syntax extensions. Constructing this
 * registry loads no engine and performs no rendering. Keep one per host and
 * destroy it after destroying that host's editor(s). */
export function createRenderers(options: RendererOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError("Renderer timeout must be between 1 and 120000 milliseconds.");
  }
  const plantuml = createPlantUmlRenderer(timeoutMs);
  const controller = new AbortController();
  const owned = <R extends { signal: AbortSignal }, T>(render: (request: R) => T) => async (request: R): Promise<Awaited<T>> => {
    controller.signal.throwIfAborted();
    request.signal.throwIfAborted();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error("Rendering timed out.")), timeoutMs);
    const signal = AbortSignal.any([request.signal, controller.signal, deadline.signal]);
    try {
      return await abortable(Promise.resolve().then(() => {
        signal.throwIfAborted();
        return render({ ...request, signal });
      }), signal);
    } finally { clearTimeout(timer); }
  };
  const lazyMath = createLazyRenderer(() => import("./math-engine").then(module => module.renderMath));
  const lazyMermaid = createLazyRenderer(() => import("./mermaid-engine").then(module => module.renderMermaid));
  const math: MathRenderer = owned(request => {
    if (request.source.length > 65_536) throw new Error("Math source exceeds the preview limit.");
    return lazyMath(request);
  });
  const mermaid: DiagramRenderer = owned(request => {
    if (request.source.length > 50_000) throw new Error("Diagram source exceeds the preview limit.");
    return lazyMermaid(request);
  });
  return Object.freeze({
    math,
    diagrams: Object.freeze({ mermaid, plantuml: owned(plantuml.render) }),
    destroy() { controller.abort(); plantuml.destroy(); },
  });
}

export type MarkoraRenderers = ReturnType<typeof createRenderers>;
