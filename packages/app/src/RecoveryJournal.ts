import type { DocumentSnapshot } from "./documentSession";

/** Coalesces checkpoints and serializes disk writes, including clean checkpoints. */
export class RecoveryJournal {
  private pending: DocumentSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private write: (snapshot: DocumentSnapshot) => Promise<void>,
    private onError: (cause: unknown) => void,
  ) {}

  schedule(snapshot: DocumentSnapshot) {
    this.pending = snapshot;
    if (this.timer === null) {
      this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 300);
    }
  }

  flush() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const snapshot = this.pending;
    this.pending = null;
    if (snapshot) {
      this.writing = this.writing.catch(() => undefined).then(() => this.write(snapshot));
    }
    return this.writing;
  }
}
