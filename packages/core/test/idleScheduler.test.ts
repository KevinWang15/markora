import { describe, expect, it, vi } from "vitest";
import { createHostIdleScheduler } from "../src/idleScheduler";

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining(): number }) => void;

function createSchedulerWindow(options: { nativeIdle?: boolean } = {}) {
  let currentTime = 0;
  let nextHandle = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const idleCallbacks = new Map<number, IdleCallback>();
  const timers = new Map<number, {
    callback: () => void;
    delay: number;
    due: number;
  }>();
  const cancelAnimationFrame = vi.fn((handle: number) => frames.delete(handle));
  const cancelIdleCallback = vi.fn((handle: number) => idleCallbacks.delete(handle));
  const clearTimeout = vi.fn((handle: number) => timers.delete(handle));
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    frames.set(handle, callback);
    return handle;
  });
  const requestIdleCallback = vi.fn((callback: IdleCallback, idleOptions?: { timeout?: number }) => {
    const handle = nextHandle++;
    idleCallbacks.set(handle, callback);
    return handle;
  });
  const setTimeout = vi.fn((callback: () => void, delay = 0) => {
    const handle = nextHandle++;
    timers.set(handle, { callback, delay, due: currentTime + delay });
    return handle;
  });
  const ownerWindow = {
    cancelAnimationFrame,
    clearTimeout,
    performance: { now: () => currentTime },
    requestAnimationFrame,
    setTimeout,
    ...(options.nativeIdle ? { cancelIdleCallback, requestIdleCallback } : {}),
  } as unknown as Window & typeof globalThis;

  const advanceBy = (duration: number) => {
    const target = currentTime + duration;

    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];

      if (!next) {
        break;
      }

      const [handle, timer] = next;
      currentTime = timer.due;
      timers.delete(handle);
      timer.callback();
    }

    currentTime = target;
  };

  const takeFrame = () => {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) {
      return undefined;
    }
    frames.delete(entry[0]);
    return entry[1];
  };

  const takeIdle = () => {
    const entry = idleCallbacks.entries().next().value as [number, IdleCallback] | undefined;
    if (!entry) {
      return undefined;
    }
    idleCallbacks.delete(entry[0]);
    return entry[1];
  };

  return {
    advanceBy,
    cancelAnimationFrame,
    cancelIdleCallback,
    clearTimeout,
    frames,
    idleCallbacks,
    ownerWindow,
    requestAnimationFrame,
    requestIdleCallback,
    setTimeout,
    takeFrame,
    takeIdle,
    timers,
  };
}

describe("host idle scheduler", () => {
  it("waits for quiet before requesting host idle with the remaining deadline", () => {
    const host = createSchedulerWindow({ nativeIdle: true });
    const callback = vi.fn();
    const task = createHostIdleScheduler(host.ownerWindow).schedule(callback);

    expect(host.requestIdleCallback).not.toHaveBeenCalled();
    expect([...host.timers.values()].map(({ delay }) => delay).sort((a, b) => a - b))
      .toEqual([300, 5_000]);

    host.advanceBy(299);
    expect(host.requestIdleCallback).not.toHaveBeenCalled();
    host.advanceBy(1);
    expect(host.requestIdleCallback).toHaveBeenCalledOnce();
    expect(host.requestIdleCallback.mock.calls[0]?.[1]).toEqual({ timeout: 4_700 });
    expect(host.requestAnimationFrame).not.toHaveBeenCalled();

    const idle = host.takeIdle()!;
    idle({ didTimeout: false, timeRemaining: () => 10 });
    idle({ didTimeout: true, timeRemaining: () => 0 });
    task.cancel();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("resets the quiet period across a sustained burst without moving its deadline", () => {
    const host = createSchedulerWindow({ nativeIdle: true });
    const callback = vi.fn();
    const task = createHostIdleScheduler(host.ownerWindow).schedule(callback);

    for (let elapsed = 100; elapsed <= 1_100; elapsed += 100) {
      host.advanceBy(100);
      task.postpone();
    }

    expect(callback).not.toHaveBeenCalled();
    expect(host.requestIdleCallback).not.toHaveBeenCalled();
    host.advanceBy(299);
    expect(host.requestIdleCallback).not.toHaveBeenCalled();
    host.advanceBy(1);
    expect(host.requestIdleCallback).toHaveBeenCalledOnce();
    expect(host.requestIdleCallback.mock.calls[0]?.[1]).toEqual({ timeout: 3_600 });

    host.takeIdle()?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("falls back to a post-paint timer without running work inside the frame", () => {
    const host = createSchedulerWindow();
    const callback = vi.fn();
    createHostIdleScheduler(host.ownerWindow).schedule(callback);

    host.advanceBy(300);
    const frame = host.takeFrame()!;
    frame(300);
    expect(callback).not.toHaveBeenCalled();

    host.advanceBy(0);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("uses the absolute watchdog when continuous activity starves presentation", () => {
    const host = createSchedulerWindow();
    const callback = vi.fn();
    const task = createHostIdleScheduler(host.ownerWindow).schedule(callback);

    for (let elapsed = 100; elapsed < 5_000; elapsed += 100) {
      host.advanceBy(100);
      task.postpone();
    }

    expect(callback).not.toHaveBeenCalled();
    expect(host.requestAnimationFrame).not.toHaveBeenCalled();
    host.advanceBy(100);
    expect(callback).toHaveBeenCalledOnce();
    expect(host.timers.size).toBe(0);
  });

  it("cancels native and fallback work and ignores captured stale callbacks", () => {
    const nativeHost = createSchedulerWindow({ nativeIdle: true });
    const nativeCallback = vi.fn();
    const nativeTask = createHostIdleScheduler(nativeHost.ownerWindow).schedule(nativeCallback);
    nativeHost.advanceBy(300);
    const staleIdle = nativeHost.takeIdle()!;
    nativeTask.postpone();
    nativeHost.advanceBy(300);
    expect(nativeHost.idleCallbacks.size).toBe(1);
    staleIdle({ didTimeout: false, timeRemaining: () => 10 });
    nativeTask.cancel();
    nativeTask.cancel();
    expect(nativeCallback).not.toHaveBeenCalled();
    expect(nativeHost.idleCallbacks.size).toBe(0);
    expect(nativeHost.timers.size).toBe(0);

    const fallbackHost = createSchedulerWindow();
    const fallbackCallback = vi.fn();
    const fallbackTask = createHostIdleScheduler(fallbackHost.ownerWindow).schedule(fallbackCallback);
    fallbackHost.advanceBy(300);
    const staleFrame = fallbackHost.takeFrame()!;
    fallbackTask.postpone();
    fallbackHost.advanceBy(300);
    expect(fallbackHost.frames.size).toBe(1);
    const timerCountAfterPostpone = fallbackHost.setTimeout.mock.calls.length;
    staleFrame(300);
    expect(fallbackHost.setTimeout).toHaveBeenCalledTimes(timerCountAfterPostpone);
    fallbackTask.cancel();
    fallbackTask.cancel();
    expect(fallbackHost.frames.size).toBe(0);
    expect(fallbackHost.timers.size).toBe(0);
    expect(fallbackCallback).not.toHaveBeenCalled();
  });
});
