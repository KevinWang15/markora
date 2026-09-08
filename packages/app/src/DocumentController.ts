import { DocumentHistory } from "./DocumentHistory";
import { DocumentSession, type DocumentSnapshot } from "./documentSession";

export type DocumentControllerSnapshot = Readonly<{
  document: DocumentSnapshot;
  saving: boolean;
  savingCopy: boolean;
  exporting: boolean;
}>;

/** Owns document identity and asynchronous operation ordering independently of
 * React. View adapters handle parsing, dialogs, resources and native transport. */
export class DocumentController {
  private readonly session: DocumentSession;
  readonly history: DocumentHistory;
  private current: DocumentControllerSnapshot;
  private listeners = new Set<() => void>();
  private openVersion = 0;

  constructor(markdown: string) {
    this.session = new DocumentSession(markdown);
    this.history = new DocumentHistory(markdown);
    this.current = { document: this.session.snapshot, saving: false, savingCopy: false, exporting: false };
  }

  get snapshot() { return this.session.snapshot; }
  get markdown() { return this.session.markdown; }
  get path() { return this.session.path; }
  get dirty() { return this.session.dirty; }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<DocumentControllerSnapshot> = {}) {
    this.current = { ...this.current, ...patch, document: this.session.snapshot };
    for (const listener of this.listeners) listener();
  }

  edit(markdown: string) {
    const previous = this.session.snapshot;
    this.session.edit(markdown);
    if (previous !== this.session.snapshot) this.publish();
  }

  replace(path: string | null, markdown: string) {
    this.openVersion += 1;
    this.history.reset(markdown);
    this.session.replace(path, markdown);
    this.publish();
  }

  async open<T>(load: () => Promise<T | null>, accept: (value: T) => void, onError: (error: unknown) => void) {
    const version = ++this.openVersion;
    try {
      const value = await load();
      if (value !== null && version === this.openVersion) accept(value);
    } catch (error) {
      if (version === this.openVersion) onError(error);
    }
  }

  async save(options: {
    flush(): void;
    write(snapshot: DocumentSnapshot): Promise<{ path: string | null } | null>;
    didSave?(snapshot: DocumentSnapshot, path: string | null): void;
    savingCopy?: boolean;
  }): Promise<boolean> {
    if (this.current.saving) return false;
    this.publish({ saving: true, savingCopy: options.savingCopy ?? false });
    try {
      options.flush();
      const snapshot = this.session.snapshot;
      const result = await options.write(snapshot);
      if (!result) return false;
      options.flush();
      const clean = this.session.saved(snapshot, result.path);
      this.publish();
      options.didSave?.(snapshot, result.path);
      return clean;
    } finally {
      this.publish({ saving: false, savingCopy: false });
    }
  }

  async export(operation: () => Promise<void>) {
    if (this.current.exporting) return false;
    this.publish({ exporting: true });
    try {
      await operation();
      return true;
    } finally {
      this.publish({ exporting: false });
    }
  }
}
