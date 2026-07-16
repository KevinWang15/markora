import { describe, expect, it, vi } from "vitest";
import { createMarkdownEditorLifecycleScope } from "../src/extensionLifecycle";

describe("extension lifecycle scopes", () => {
  it("aborts and cleans resources in reverse registration order", () => {
    const events: string[] = [];
    const owned = createMarkdownEditorLifecycleScope();
    owned.publicScope.signal.addEventListener("abort", () => events.push("abort"));
    owned.publicScope.addCleanup(() => events.push("first"));
    owned.publicScope.addCleanup(() => events.push("second"));

    expect(owned.cleanup()).toEqual([]);
    expect(events).toEqual(["abort", "second", "first"]);
    expect(owned.publicScope.signal.aborted).toBe(true);
    expect(owned.isCleaned).toBe(true);
  });

  it("continues after cleanup failures and is idempotent", () => {
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const owned = createMarkdownEditorLifecycleScope();
    owned.publicScope.addCleanup(first);
    owned.publicScope.addCleanup(second);

    const errors = owned.cleanup();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "cleanup failed" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(owned.cleanup()).toEqual([]);
    expect(first).toHaveBeenCalledOnce();
  });

  it("allows early abort but rejects registration after cleanup", () => {
    const owned = createMarkdownEditorLifecycleScope();

    owned.abort();
    expect(owned.publicScope.signal.aborted).toBe(true);
    expect(() => owned.publicScope.addCleanup(() => undefined)).not.toThrow();
    owned.cleanup();
    expect(() => owned.publicScope.addCleanup(() => undefined)).toThrow(
      /after its lifecycle scope has closed/,
    );
  });
});
