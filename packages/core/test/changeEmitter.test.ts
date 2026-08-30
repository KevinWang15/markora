import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../src/changeEmitter";
import { createHostIdleScheduler } from "../src/idleScheduler";

type TestDoc = { value: string };
type TestContext = { origin: string };

function createHarness(options: {
  onChange?: (markdown: string, context: TestContext) => void;
  serialize?: (doc: TestDoc) => string;
} = {}) {
  const initialDoc = { value: "initial" };
  let currentDoc = initialDoc;
  const idleCallbacks: Array<{
    active: boolean;
    callback: () => void;
    postponeCalls: number;
  }> = [];
  const reportAsyncError = vi.fn();
  const serialize = vi.fn(options.serialize ?? ((doc: TestDoc) => doc.value));
  const onChange = vi.fn(options.onChange ?? (() => undefined));
  const emitter = createChangeEmitter<TestDoc, TestContext>({
    initialDoc,
    initialMarkdown: "initial",
    isDeliveryValid: (doc) => doc === currentDoc,
    onChange,
    reportAsyncError,
    scheduleIdle(callback) {
      const pending = { active: true, callback, postponeCalls: 0 };
      idleCallbacks.push(pending);
      return {
        cancel() {
          pending.active = false;
        },
        postpone() {
          pending.postponeCalls += 1;
        },
      };
    },
    serialize,
  });

  return {
    emitter,
    idleCallbacks,
    initialDoc,
    onChange,
    reportAsyncError,
    serialize,
    setCurrentDoc(doc: TestDoc) {
      currentDoc = doc;
    },
    runIdle(index = idleCallbacks.length - 1) {
      const pending = idleCallbacks[index];
      if (pending?.active) {
        pending.callback();
      }
    },
  };
}

describe("change emitter", () => {
  it("defers idle serialization and coalesces the latest document and context", () => {
    const harness = createHarness();
    const first = { value: "first" };
    const latest = { value: "latest" };

    harness.setCurrentDoc(first);
    harness.emitter.schedule(first, { origin: "first" });
    harness.setCurrentDoc(latest);
    harness.emitter.schedule(latest, { origin: "latest" });

    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(harness.idleCallbacks).toHaveLength(1);
    expect(harness.idleCallbacks[0]?.postponeCalls).toBe(1);

    harness.runIdle();
    expect(harness.serialize).toHaveBeenCalledOnce();
    expect(harness.serialize).toHaveBeenCalledWith(latest);
    expect(harness.onChange).toHaveBeenCalledWith("latest", { origin: "latest" });
  });

  it("uses synchronous getMarkdown and flush paths without duplicate serialization", () => {
    const harness = createHarness();
    const next = { value: "next" };
    harness.setCurrentDoc(next);
    harness.emitter.schedule(next, { origin: "user" });

    expect(harness.emitter.getMarkdown(next)).toBe("next");
    expect(harness.serialize).toHaveBeenCalledOnce();
    harness.emitter.flush();

    expect(harness.serialize).toHaveBeenCalledOnce();
    expect(harness.onChange).toHaveBeenCalledWith("next", { origin: "user" });
    harness.runIdle();
    expect(harness.onChange).toHaveBeenCalledOnce();
  });

  it("cancels deferred output and invalidates a delivery cancelled during serialization", () => {
    const harness = createHarness();
    const cancelled = { value: "cancelled" };
    harness.setCurrentDoc(cancelled);
    harness.emitter.schedule(cancelled, { origin: "user" });
    harness.emitter.cancel();
    harness.runIdle();
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.onChange).not.toHaveBeenCalled();

    const reentrant = createHarness({
      serialize(doc) {
        reentrant.emitter.cancel();
        return doc.value;
      },
    });
    const next = { value: "next" };
    reentrant.setCurrentDoc(next);
    reentrant.emitter.schedule(next, { origin: "user" });
    reentrant.runIdle();
    expect(reentrant.onChange).not.toHaveBeenCalled();
  });

  it("does not serialize a delivery that is already stale", () => {
    const harness = createHarness();
    const stale = { value: "stale" };
    const current = { value: "current" };
    harness.setCurrentDoc(stale);
    harness.emitter.schedule(stale, { origin: "stale" });
    harness.setCurrentDoc(current);

    harness.runIdle();

    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  it("keeps serialization out of a sustained burst and delivers the latest change after quiet", () => {
    vi.useFakeTimers();
    const idleWindow = window as Window & typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void,
        options?: { timeout?: number },
      ) => number;
    };
    const previousRequestIdle = idleWindow.requestIdleCallback;
    const previousCancelIdle = idleWindow.cancelIdleCallback;
    let idleCallback: ((deadline: { didTimeout: boolean; timeRemaining(): number }) => void) | null = null;
    idleWindow.requestIdleCallback = vi.fn((callback) => {
      idleCallback = callback;
      return 71;
    });
    idleWindow.cancelIdleCallback = vi.fn(() => {
      idleCallback = null;
    });

    try {
      const initialDoc = { value: "initial" };
      let currentDoc = initialDoc;
      const serialize = vi.fn((doc: TestDoc) => doc.value);
      const onChange = vi.fn();
      const idleScheduler = createHostIdleScheduler(idleWindow);
      const emitter = createChangeEmitter<TestDoc, TestContext>({
        initialDoc,
        initialMarkdown: "initial",
        isDeliveryValid: (doc) => doc === currentDoc,
        onChange,
        reportAsyncError: vi.fn(),
        scheduleIdle: idleScheduler.schedule,
        serialize,
      });

      for (let index = 0; index <= 11; index += 1) {
        if (index > 0) {
          vi.advanceTimersByTime(100);
        }
        currentDoc = { value: `change-${index}` };
        emitter.schedule(currentDoc, { origin: `origin-${index}` });
      }

      expect(serialize).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(serialize).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(serialize).not.toHaveBeenCalled();
      expect(idleCallback).not.toBeNull();

      idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });

      expect(serialize).toHaveBeenCalledOnce();
      expect(serialize).toHaveBeenCalledWith(currentDoc);
      expect(onChange).toHaveBeenCalledWith("change-11", { origin: "origin-11" });
    } finally {
      idleWindow.requestIdleCallback = previousRequestIdle;
      idleWindow.cancelIdleCallback = previousCancelIdle;
      vi.useRealTimers();
    }
  });

  it("keeps a reentrant newer schedule after the detached delivery", () => {
    const first = { value: "first" };
    const latest = { value: "latest" };
    const contexts: string[] = [];
    const harness = createHarness({
      onChange(_markdown, context) {
        contexts.push(context.origin);
        if (context.origin === "first") {
          harness.setCurrentDoc(latest);
          harness.emitter.schedule(latest, { origin: "latest" });
        }
      },
    });
    harness.setCurrentDoc(first);
    harness.emitter.schedule(first, { origin: "first" });

    harness.runIdle(0);
    expect(contexts).toEqual(["first"]);
    expect(harness.idleCallbacks).toHaveLength(2);
    harness.runIdle(1);
    expect(contexts).toEqual(["first", "latest"]);
  });

  it("retries serializer failures unless a newer pending document supersedes them", () => {
    const failure = new Error("serialize failed");
    let shouldFail = true;
    const retry = createHarness({
      serialize(doc) {
        if (shouldFail) {
          shouldFail = false;
          throw failure;
        }
        return doc.value;
      },
    });
    const failed = { value: "failed" };
    retry.setCurrentDoc(failed);
    retry.emitter.schedule(failed, { origin: "failed" });
    retry.runIdle();
    expect(retry.reportAsyncError).toHaveBeenCalledWith(failure);
    retry.emitter.flush();
    expect(retry.onChange).toHaveBeenCalledWith("failed", { origin: "failed" });

    const first = { value: "first" };
    const latest = { value: "latest" };
    const supersededFailure = new Error("superseded");
    const superseded = createHarness({
      serialize(doc) {
        if (doc === first) {
          superseded.setCurrentDoc(latest);
          superseded.emitter.schedule(latest, { origin: "latest" });
          throw supersededFailure;
        }
        return doc.value;
      },
    });
    superseded.setCurrentDoc(first);
    superseded.emitter.schedule(first, { origin: "first" });
    superseded.runIdle(0);
    superseded.emitter.flush();

    expect(superseded.reportAsyncError).toHaveBeenCalledWith(supersededFailure);
    expect(superseded.onChange).toHaveBeenCalledTimes(1);
    expect(superseded.onChange).toHaveBeenCalledWith("latest", { origin: "latest" });
  });

  it("reports an async listener failure once and treats it as delivered", () => {
    const failure = new Error("listener failed");
    const harness = createHarness({
      onChange() {
        throw failure;
      },
    });
    const next = { value: "next" };
    harness.setCurrentDoc(next);
    harness.emitter.schedule(next, { origin: "user" });
    harness.runIdle();
    harness.emitter.flush();

    expect(harness.reportAsyncError).toHaveBeenCalledOnce();
    expect(harness.reportAsyncError).toHaveBeenCalledWith(failure);
    expect(harness.onChange).toHaveBeenCalledOnce();
  });
});
