import { expect, it, vi } from "vitest";
import { createLazyRenderer } from "../src/lazyRenderer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Request = { signal: AbortSignal; source: string };

it("does not load until requested, shares concurrent imports, and reuses a warm renderer", async () => {
  const ready = deferred<(request: Request) => string>();
  const load = vi.fn(() => ready.promise);
  const render = createLazyRenderer(load);
  expect(load).not.toHaveBeenCalled();
  const first = render({ signal: new AbortController().signal, source: "first" });
  const second = render({ signal: new AbortController().signal, source: "second" });
  ready.resolve(({ source }) => source);
  await expect(first).resolves.toBe("first");
  await expect(second).resolves.toBe("second");
  expect(await render({ signal: new AbortController().signal, source: "third" })).toBe("third");
  expect(load).toHaveBeenCalledTimes(1);
});

it("cancels one waiter without poisoning the shared import or rendering stale source", async () => {
  const ready = deferred<(request: Request) => string>();
  const engine = vi.fn(({ source }: Request) => source);
  const render = createLazyRenderer(() => ready.promise);
  const controller = new AbortController();
  const first = render({ signal: controller.signal, source: "stale" });
  const second = render({ signal: new AbortController().signal, source: "current" });
  controller.abort(new Error("Cancelled"));
  await expect(first).rejects.toThrow("Cancelled");
  ready.resolve(engine);
  await expect(second).resolves.toBe("current");
  expect(engine.mock.calls.map(([request]) => request.source)).toEqual(["current"]);
});

it("retries a failed import but does not reload an engine for a syntax error", async () => {
  const engine = vi.fn(({ source }: Request) => { if (source === "bad") throw new Error("Syntax"); return source; });
  const load = vi.fn<() => Promise<typeof engine>>()
    .mockRejectedValueOnce(new Error("Download failed")).mockResolvedValue(engine);
  const render = createLazyRenderer(load);
  const request = (source: string) => ({ source, signal: new AbortController().signal });
  await expect(render(request("first"))).rejects.toThrow("Download failed");
  await expect(render(request("bad"))).rejects.toThrow("Syntax");
  await expect(render(request("valid"))).resolves.toBe("valid");
  expect(load).toHaveBeenCalledTimes(2);
});

it("never starts loading for a request that is already cancelled", async () => {
  const load = vi.fn(async () => (_request: Request) => "unused");
  const render = createLazyRenderer(load);
  await expect(render({ source: "cancelled", signal: AbortSignal.abort() })).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
});
