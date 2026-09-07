import type { Node as MarkdownNode } from "markora/extension-api";

export type HistoryEntry = Readonly<{
  source: string | MarkdownNode;
  mode: "source" | "rich";
  selection?: { anchor: number; head: number };
}>;

/** A document history shared by the two views. Rich snapshots share immutable nodes. */
export class DocumentHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private group: string | null = null;
  private time = 0;
  current: HistoryEntry;

  constructor(source: string) { this.current = { source, mode: "source" }; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  breakGroup() { this.group = null; }

  reset(source: string) {
    this.past = []; this.future = []; this.group = null;
    this.current = { source, mode: "source" };
  }

  record(entry: HistoryEntry, group: string | null, now = Date.now()) {
    if (entry.source === this.current.source) return;
    if (!group || group !== this.group || now - this.time > 500) this.past.push(this.current);
    this.current = entry;
    this.future = [];
    this.group = group;
    this.time = now;
    // Bound retention. Nodes share structure, so this is a conservative estimate.
    const size = (entry: HistoryEntry) => typeof entry.source === "string" ? entry.source.length : entry.source.content.size;
    let retained = this.past.reduce((total, value) => total + size(value), size(this.current));
    while (this.past.length > 1 && (this.past.length > 200 || retained > 16 * 1024 * 1024)) retained -= size(this.past.shift()!);
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(this.current); this.current = entry; this.breakGroup();
    return entry;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(this.current); this.current = entry; this.breakGroup();
    return entry;
  }
}
