export type MarkdownEditorLifecycleScope = Readonly<{
  signal: AbortSignal;
  addCleanup(cleanup: () => void): void;
}>;

export type MarkdownEditorOwnedLifecycleScope = Readonly<{
  publicScope: MarkdownEditorLifecycleScope;
  abort(): void;
  cleanup(): readonly unknown[];
  readonly isCleaned: boolean;
}>;

/**
 * Creates one phase-owned synchronous lifecycle scope.
 *
 * Cleanup registration is intentionally append-only. Teardown aborts first,
 * invokes callbacks in reverse registration order, continues after failures,
 * and is idempotent so creation rollback and normal destroy can share it.
 */
export function createMarkdownEditorLifecycleScope(): MarkdownEditorOwnedLifecycleScope {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let cleaned = false;

  const publicScope = Object.freeze({
    signal: controller.signal,
    addCleanup(cleanup: () => void) {
      if (typeof cleanup !== "function") {
        throw new TypeError("Extension lifecycle cleanup must be a function.");
      }

      if (cleaned) {
        throw new Error("Cannot register extension cleanup after its lifecycle scope has closed.");
      }

      cleanups.push(cleanup);
    },
  });

  return {
    publicScope,
    abort() {
      controller.abort();
    },
    cleanup() {
      if (cleaned) {
        return [];
      }

      cleaned = true;
      controller.abort();
      const errors: unknown[] = [];

      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        try {
          cleanups[index]?.();
        } catch (error) {
          errors.push(error);
        }
      }

      cleanups.length = 0;
      return errors;
    },
    get isCleaned() {
      return cleaned;
    },
  };
}
