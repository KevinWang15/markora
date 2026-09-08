import { expect, it } from "vitest";
import { createRenderers } from "../src/index";

it("validates deadlines and keeps construction and cancelled requests cold", async () => {
  for (const timeoutMs of [0, -1, Infinity, NaN, 120_001]) {
    expect(() => createRenderers({ timeoutMs })).toThrow(RangeError);
  }
  const registry = createRenderers();
  try {
    const request = { source: "x", ownerDocument: document, signal: AbortSignal.abort() };
    await expect(registry.math({ ...request, kind: "inline" })).rejects.toThrow();
    await expect(registry.diagrams.plantuml({ ...request, kind: "plantuml", info: "plantuml" })).rejects.toThrow();
    expect(document.querySelector("iframe")).toBeNull();
  } finally { registry.destroy(); }
});

it("host teardown cancels active and queued work and prevents registry reuse", async () => {
  const registry = createRenderers();
  const request = { source: "Alice -> Bob", ownerDocument: document, signal: new AbortController().signal,
    kind: "plantuml" as const, info: "plantuml" };
  const first = registry.diagrams.plantuml(request);
  const second = registry.diagrams.plantuml(request);
  await Promise.resolve();
  expect(document.querySelector("iframe")).not.toBeNull();
  registry.destroy();
  registry.destroy();
  await expect(first).rejects.toThrow();
  await expect(second).rejects.toThrow();
  await expect(registry.math({ ...request, kind: "inline" })).rejects.toThrow();
  await expect(registry.diagrams.mermaid({ ...request, kind: "mermaid" })).rejects.toThrow();
  expect(document.querySelector("iframe")).toBeNull();
});
