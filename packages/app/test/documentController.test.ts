import { describe, expect, it, vi } from "vitest";
import { DocumentController } from "../src/DocumentController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("document operations", () => {
  it("saves a snapshot while retaining edits made during the write", async () => {
    const controller = new DocumentController("initial");
    controller.edit("saving");
    const write = deferred<{ path: string }>();
    const observed: boolean[] = [];
    const unsubscribe = controller.subscribe(() => observed.push(controller.getSnapshot().saving));
    const save = controller.save({ flush() {}, write: snapshot => {
      expect(snapshot.markdown).toBe("saving");
      return write.promise;
    } });
    const duplicate = vi.fn();
    expect(await controller.save({ flush() {}, write: duplicate })).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();
    controller.edit("newer");
    write.resolve({ path: "/document.md" });
    expect(await save).toBe(false);
    expect(controller.snapshot).toMatchObject({ markdown: "newer", savedMarkdown: "saving", path: "/document.md" });
    expect(observed[0]).toBe(true);
    expect(observed.at(-1)).toBe(false);
    unsubscribe();
  });

  it("does not apply a completed save to a replacement document", async () => {
    const controller = new DocumentController("old");
    const write = deferred<{ path: string }>();
    const save = controller.save({ flush() {}, write: () => write.promise });
    controller.replace("/new.md", "new");
    write.resolve({ path: "/old.md" });
    expect(await save).toBe(false);
    expect(controller.snapshot).toMatchObject({ path: "/new.md", markdown: "new", savedMarkdown: "new" });
  });

  it("releases locks after cancellation, write failure, and flush failure", async () => {
    const controller = new DocumentController("old");
    expect(await controller.save({ flush() {}, write: async () => null, savingCopy: true })).toBe(false);
    await expect(controller.save({ flush() {}, write: async () => { throw Error("disk"); } })).rejects.toThrow("disk");
    await expect(controller.save({ flush() { throw Error("flush"); }, write: vi.fn() })).rejects.toThrow("flush");
    expect(controller.getSnapshot()).toMatchObject({ saving: false, savingCopy: false });
  });

  it("ignores stale open results and errors, including after New", async () => {
    const controller = new DocumentController("");
    const first = deferred<string>();
    const second = deferred<string>();
    const accept = vi.fn();
    const error = vi.fn();
    const a = controller.open(() => first.promise, accept, error);
    const b = controller.open(() => second.promise, accept, error);
    second.resolve("second");
    await b;
    first.reject(Error("obsolete"));
    await a;
    expect(accept).toHaveBeenCalledExactlyOnceWith("second");
    expect(error).not.toHaveBeenCalled();
    const pending = deferred<string>();
    const c = controller.open(() => pending.promise, accept, error);
    controller.replace(null, "new");
    pending.resolve("late");
    await c;
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("serializes export requests and releases the lock after failure", async () => {
    const controller = new DocumentController("");
    const job = deferred<void>();
    const first = controller.export(() => job.promise);
    const duplicate = vi.fn();
    expect(await controller.export(duplicate)).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();
    job.reject(Error("printer"));
    await expect(first).rejects.toThrow("printer");
    expect(controller.getSnapshot().exporting).toBe(false);
  });
});
