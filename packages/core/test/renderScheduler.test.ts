import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownRenderScheduler } from "../src/renderScheduler";

afterEach(() => vi.useRealTimers());

describe("renderer scheduling", () => {
  it("runs outside the caller's task and gives explicit requests FIFO priority", async () => {
    vi.useFakeTimers();
    const scheduler = createMarkdownRenderScheduler({ ownerWindow: window, maxConcurrent: 1 });
    const order: string[] = [];
    for (const [name, priority] of [["normal", "normal"], ["first", "high"], ["second", "high"]] as const) {
      scheduler.enqueue({ signal: new AbortController().signal, priority, isCurrent: () => true,
        run: () => { order.push(name); }, onError: cause => { throw cause; } });
    }
    expect(order).toEqual([]);
    await vi.runAllTimersAsync();
    expect(order).toEqual(["first", "second", "normal"]);
    scheduler.destroy();
  });

  it("releases cancelled work immediately without double-releasing on late settlement", async () => {
    vi.useFakeTimers();
    const scheduler = createMarkdownRenderScheduler({ ownerWindow: window, maxConcurrent: 1 });
    const starts: number[] = [];
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const resolve: Array<() => void> = [];
    controllers.forEach((controller, index) => scheduler.enqueue({
      signal: controller.signal, isCurrent: () => true, onError: vi.fn(),
      run: () => { starts.push(index); return new Promise<void>(done => { resolve[index] = done; }); },
    }));
    await vi.runAllTimersAsync();
    expect(starts).toEqual([0]);
    controllers[0]!.abort();
    await vi.runAllTimersAsync();
    expect(starts).toEqual([0, 1]);
    resolve[0]!();
    await vi.runAllTimersAsync();
    expect(starts).toEqual([0, 1]);
    resolve[1]!();
    await vi.runAllTimersAsync();
    expect(starts).toEqual([0, 1, 2]);
    scheduler.destroy();
    resolve[2]!();
  });

  it("drops cancelled, stale and destroyed queued work", async () => {
    vi.useFakeTimers();
    const scheduler = createMarkdownRenderScheduler({ ownerWindow: window, maxConcurrent: 1 });
    const controller = new AbortController();
    const run = vi.fn();
    scheduler.enqueue({ signal: controller.signal, isCurrent: () => true, run, onError: vi.fn() });
    controller.abort();
    scheduler.enqueue({ signal: new AbortController().signal, isCurrent: () => false, run, onError: vi.fn() });
    await vi.runAllTimersAsync();
    scheduler.enqueue({ signal: new AbortController().signal, isCurrent: () => true, run, onError: vi.fn() });
    scheduler.destroy();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers capacity after sync and async failures even if the error observer throws", async () => {
    vi.useFakeTimers();
    const scheduler = createMarkdownRenderScheduler({ ownerWindow: window, maxConcurrent: 1 });
    const error = new Error("renderer failed");
    const onError = vi.fn(() => { throw new Error("observer failed"); });
    const run = vi.fn();
    for (const task of [() => { throw error; }, () => Promise.reject(error), run]) {
      scheduler.enqueue({ signal: new AbortController().signal, isCurrent: () => true, run: task, onError });
    }
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
    scheduler.destroy();
  });
});
