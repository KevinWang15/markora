import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPlantUmlRenderer } from "../src/plantuml";

const engines: ReturnType<typeof createPlantUmlRenderer>[] = [];
const frame = () => document.querySelector("iframe")!;
const request = (signal = new AbortController().signal) => ({
  kind: "plantuml" as const, info: "plantuml", source: "Alice -> Bob: hello", ownerDocument: document, signal,
});
function setup() { const engine = createPlantUmlRenderer(1000); engines.push(engine); return engine; }
function message(data: unknown, source = frame().contentWindow) {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("creates no frame until needed, serializes shared-engine work, and releases idle DOM", async () => {
  const engine = setup();
  expect(frame()).toBeNull();
  const first = engine.render(request());
  const post = vi.spyOn(frame().contentWindow!, "postMessage");
  const second = engine.render(request());
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame().srcdoc).toContain("connect-src 'none'");
  message({ type: "markora:plantuml:ready" });
  expect(post).toHaveBeenCalledTimes(1);
  message({ type: "markora:plantuml:result", id: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>First</text></svg>' });
  const output = await first;
  expect(output.ownerDocument).toBe(document);
  expect(output.textContent).toBe("First");
  expect(post).toHaveBeenCalledTimes(2);
  message({ type: "markora:plantuml:result", id: 2, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  await second;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(frame()).toBeNull();
});

it("cancellation discards the active context and lets the next request start cleanly", async () => {
  const engine = setup();
  const controller = new AbortController();
  const first = engine.render(request(controller.signal));
  const oldFrame = frame();
  const second = engine.render(request());
  controller.abort(new Error("Aborted"));
  await expect(first).rejects.toThrow("Aborted");
  expect(oldFrame.isConnected).toBe(false);
  expect(frame()).not.toBe(oldFrame);
  message({ type: "markora:plantuml:result", id: 2, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, window);
  message({ type: "markora:plantuml:ready" });
  message({ type: "markora:plantuml:result", id: 2, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  await expect(second).resolves.toBeInstanceOf(DocumentFragment);
});

it("timeouts and teardown reject pending work and remove the rendering frame", async () => {
  const engine = setup();
  const first = engine.render(request());
  const failed = expect(first).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(1000);
  await failed;
  expect(frame()).toBeNull();
  const second = engine.render(request());
  const third = engine.render(request());
  engine.destroy();
  await expect(second).rejects.toThrow("destroyed");
  await expect(third).rejects.toThrow("destroyed");
  expect(frame()).toBeNull();
});
