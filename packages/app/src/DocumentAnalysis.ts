import type { DocumentOutlineItem } from "./document";
export type AnalysisRequest = { revision: number; markdown: string; outline: boolean };
export type AnalysisResult = { revision: number; words: number; characters: number; outline: readonly DocumentOutlineItem[] };

/** At most one worker request and the newest pending revision are retained. */
export class DocumentAnalysis {
  private revision = 0;
  private pending: AnalysisRequest | null = null;
  private busy = false;
  constructor(private send: (request: AnalysisRequest) => void, private accept: (result: AnalysisResult) => void) {}
  schedule(markdown: string, outline: boolean) {
    this.pending = { revision: ++this.revision, markdown, outline };
    return this.revision;
  }
  flush() {
    if (this.busy || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.busy = true;
    this.send(request);
  }
  receive(result: AnalysisResult) {
    this.busy = false;
    if (result.revision === this.revision) this.accept(result);
    this.flush();
  }
}
