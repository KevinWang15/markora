export type DocumentSnapshot = Readonly<{
  id: number;
  revision: number;
  markdown: string;
  path: string | null;
  savedMarkdown: string;
}>;

/** One authority for live content, the disk baseline, and asynchronous ownership. */
export class DocumentSession {
  private current: DocumentSnapshot;

  constructor(markdown: string) {
    this.current = { id: 0, revision: 0, markdown, path: null, savedMarkdown: markdown };
  }

  get snapshot() { return this.current; }
  get markdown() { return this.current.markdown; }
  get path() { return this.current.path; }
  get dirty() { return this.current.markdown !== this.current.savedMarkdown; }

  edit(markdown: string) {
    if (markdown !== this.current.markdown) {
      this.current = { ...this.current, markdown, revision: this.current.revision + 1 };
    }
    return this.current;
  }

  replace(path: string | null, markdown: string) {
    this.current = {
      id: this.current.id + 1,
      revision: 0,
      markdown,
      path,
      savedMarkdown: markdown,
    };
    return this.current;
  }

  saved(snapshot: DocumentSnapshot, path: string | null) {
    if (snapshot.id !== this.current.id) return false;
    this.current = { ...this.current, path: path ?? this.current.path, savedMarkdown: snapshot.markdown };
    return !this.dirty;
  }
}
