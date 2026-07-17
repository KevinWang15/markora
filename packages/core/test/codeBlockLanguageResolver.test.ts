import type { Extension } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { createCodeBlockLanguageResolver } from "../src/codeBlockLanguages";

function deferredExtension() {
  let resolve!: (extension: Extension) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Extension>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe("code-block language resolver", () => {
  it.each(["constructor", "__proto__"])(
    "does not resolve inherited object key %j as a language extension",
    (language) => {
      const resolver = createCodeBlockLanguageResolver();
      const subscription = resolver.subscribe(language, {
        onRejected: () => false,
        onResolved: () => undefined,
      });

      expect(subscription).toEqual({ status: "missing" });
    },
  );

  it("does not accumulate subscribers or host-promise handlers after cancellation", async () => {
    let hostThenCalls = 0;
    const neverSettlingHostPromise = {
      then() {
        hostThenCalls += 1;
      },
    } as unknown as Promise<Extension>;
    const loader = vi.fn(() => neverSettlingHostPromise);
    const resolver = createCodeBlockLanguageResolver({ pending: loader });

    for (let index = 0; index < 250; index += 1) {
      const subscription = resolver.subscribe("pending", {
        onRejected: () => false,
        onResolved: () => undefined,
      });

      expect(subscription.status).toBe("pending");
      expect(resolver.getPendingSubscriberCount("pending")).toBe(1);

      if (subscription.status === "pending") {
        subscription.unsubscribe();
        subscription.unsubscribe();
      }

      expect(resolver.getPendingSubscriberCount("pending")).toBe(0);
    }

    await Promise.resolve();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(hostThenCalls).toBe(1);
    expect(resolver.getPendingSubscriberCount()).toBe(0);
  });

  it("delivers only to live subscribers and caches a resolved extension", async () => {
    const deferred = deferredExtension();
    const loader = vi.fn(() => deferred.promise);
    const resolver = createCodeBlockLanguageResolver({ cached: loader });
    const staleResolved = vi.fn();
    const liveResolved = vi.fn();
    const stale = resolver.subscribe("cached", {
      onRejected: () => false,
      onResolved: staleResolved,
    });
    const live = resolver.subscribe("cached", {
      onRejected: () => false,
      onResolved: liveResolved,
    });

    expect(stale.status).toBe("pending");
    expect(live.status).toBe("pending");
    expect(resolver.getPendingSubscriberCount("cached")).toBe(2);
    if (stale.status === "pending") {
      stale.unsubscribe();
    }

    const extension: Extension = [];
    deferred.resolve(extension);
    await deferred.promise;
    await Promise.resolve();

    expect(staleResolved).not.toHaveBeenCalled();
    expect(liveResolved).toHaveBeenCalledExactlyOnceWith(extension);
    expect(resolver.getPendingSubscriberCount("cached")).toBe(0);

    const cached = resolver.subscribe("cached", {
      onRejected: () => false,
      onResolved: vi.fn(),
    });
    expect(cached).toEqual({ extension, status: "resolved" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reports one shared rejection and permits a later retry", async () => {
    const first = deferredExtension();
    const second = deferredExtension();
    const loader = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const resolver = createCodeBlockLanguageResolver({ retry: loader });
    const reportDecisions: boolean[] = [];

    for (let index = 0; index < 2; index += 1) {
      resolver.subscribe("retry", {
        onRejected: (_error, reportSharedFailure) => {
          reportDecisions.push(reportSharedFailure);
          return true;
        },
        onResolved: () => undefined,
      });
    }

    const failure = new Error("language unavailable");
    first.reject(failure);
    await expect(first.promise).rejects.toBe(failure);
    await Promise.resolve();

    expect(reportDecisions).toEqual([true, false]);
    expect(resolver.getPendingSubscriberCount()).toBe(0);

    const retry = resolver.subscribe("retry", {
      onRejected: () => true,
      onResolved: () => undefined,
    });
    expect(retry.status).toBe("pending");
    expect(loader).toHaveBeenCalledTimes(2);

    if (retry.status === "pending") {
      retry.unsubscribe();
    }
  });
});
