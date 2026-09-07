// @vitest-environment node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, DocumentConflictError, saveFile } from "../src/persistence";
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(tmpdir(), "markora-save-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe("atomic document persistence", () => {
  it("writes a complete replacement and retains the previous version", async () => {
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "before", { mode: 0o640 });
    await saveFile(fs, path, file, "after", "before");
    expect(await fs.readFile(file, "utf8")).toBe("after");
    expect(await fs.readFile(path.join(directory, ".note.md.markora-backup"), "utf8")).toBe("before");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
  });

  it("leaves the original intact when replacement fails and removes temporary files", async () => {
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "before");
    const failingFs = { ...fs, rename: async () => { throw new Error("disk failure"); } };
    await expect(atomicWrite(failingFs, path, file, "after")).rejects.toThrow("disk failure");
    expect(await fs.readFile(file, "utf8")).toBe("before");
    expect(await fs.readdir(directory)).toEqual(["note.md"]);
  });

  it("protects external edits, deletions, and newly created destinations", async () => {
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "external edit");
    await expect(saveFile(fs, path, file, "ours", "original")).rejects.toBeInstanceOf(DocumentConflictError);
    await expect(saveFile(fs, path, file, "ours", null)).rejects.toBeInstanceOf(DocumentConflictError);
    expect(await fs.readFile(file, "utf8")).toBe("external edit");
    await fs.unlink(file);
    await expect(saveFile(fs, path, file, "ours", "original")).rejects.toBeInstanceOf(DocumentConflictError);
  });

  it("preserves a symbolic link when saving its target", async () => {
    if (process.platform === "win32") return;
    const target = path.join(directory, "target.md"), link = path.join(directory, "link.md");
    await fs.writeFile(target, "before");
    await fs.symlink(target, link);
    await saveFile(fs, path, link, "after", "before");
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("after");
  });
});

it("copies relative images for Save As without overwriting unrelated files", async () => {
  const { copyRelativeImages } = await import("../src/persistence");
  const first = path.join(directory, "first"), second = path.join(directory, "second");
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.writeFile(path.join(first, "picture name.png"), "image bytes");
  const urls = ["picture%20name.png", "https://example.com/remote.png"];
  await copyRelativeImages(fs, path, path.join(first, "note.md"), path.join(second, "note.md"), urls);
  expect(await fs.readFile(path.join(second, "picture name.png"), "utf8")).toBe("image bytes");
  await fs.writeFile(path.join(second, "picture name.png"), "unrelated bytes");
  await expect(copyRelativeImages(fs, path, path.join(first, "note.md"), path.join(second, "note.md"), urls)).rejects.toThrow("unrelated image");
  expect(await fs.readFile(path.join(second, "picture name.png"), "utf8")).toBe("unrelated bytes");
});
