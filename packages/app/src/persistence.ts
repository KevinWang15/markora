import type * as NodeFs from "node:fs/promises";
import type * as NodePath from "node:path";

export type FileSystem = typeof NodeFs;
export type PathModule = typeof NodePath;

export class DocumentConflictError extends Error {
  readonly code = "DOCUMENT_CONFLICT";
  constructor() {
    super("This file changed outside Markora. Reopen it to review the disk version, or use Save As to keep your changes in another file.");
    this.name = "DocumentConflictError";
  }
}

export function isMissingFile(cause: unknown) {
  return (cause as NodeJS.ErrnoException)?.code === "ENOENT";
}

export async function readIfPresent(fs: FileSystem, path: string) {
  try { return await fs.readFile(path, "utf8"); }
  catch (cause) { if (isMissingFile(cause)) return null; throw cause; }
}

/** Replaces a file only after its complete new contents have reached the filesystem. */
export async function atomicWrite(fs: FileSystem, path: PathModule, destination: string, content: string, beforeReplace?: () => Promise<void>) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  const mode = await fs.stat(destination).then(stat => stat.mode, cause => {
    if (isMissingFile(cause)) return 0o600;
    throw cause;
  });
  const handle = await fs.open(temporary, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    await beforeReplace?.();
    await fs.rename(temporary, destination);
    // Directory syncing is unavailable on some platforms/filesystems.
    let directory;
    try {
      directory = await fs.open(path.dirname(destination), "r");
      await directory.sync();
    } catch (cause) {
      if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "EACCES"].includes((cause as NodeJS.ErrnoException).code ?? "")) throw cause;
    } finally { await directory?.close(); }
  } finally {
    await handle.close().catch(() => undefined);
    await fs.unlink(temporary).catch(cause => { if (!isMissingFile(cause)) throw cause; });
  }
}

export async function saveFile(
  fs: FileSystem,
  path: PathModule,
  destination: string,
  content: string,
  expected: string | null,
) {
  // Preserve symlinks by replacing their targets, not the link itself.
  const target = await fs.realpath(destination).catch(cause => {
    if (isMissingFile(cause)) return destination;
    throw cause;
  });
  if (await readIfPresent(fs, target) !== expected) throw new DocumentConflictError();
  if (expected !== null) {
    await atomicWrite(fs, path, path.join(path.dirname(target), `.${path.basename(target)}.markora-backup`), expected);
  }
  // Recheck after backup I/O before preparing the replacement.
  if (await readIfPresent(fs, target) !== expected) throw new DocumentConflictError();
  await atomicWrite(fs, path, target, content, async () => {
    if (await readIfPresent(fs, target) !== expected) throw new DocumentConflictError();
  });
}
