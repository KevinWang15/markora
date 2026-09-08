import type { DiagramRenderRequest, DiagramRenderer } from "markora-extension-diagrams";
import { parseDiagramSvg } from "./svg";

// URL assets are emitted by the host bundler, including under a Pages base path
// or relative file:// base. Merely importing the adapter does not request it.
const runtimeUrl = new URL("./plantuml-frame.js", import.meta.url).href;
type Job = {
  id: number;
  request: DiagramRenderRequest;
  resolve(value: DocumentFragment): void;
  reject(error: unknown): void;
  abort(): void;
};

class PlantUmlSession {
  private frame?: HTMLIFrameElement;
  private ready = false;
  private active?: Job;
  private pending: Job[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private destroyed = false;
  private readonly win: Window;

  constructor(private readonly doc: Document, private readonly timeoutMs: number) {
    this.win = doc.defaultView!;
  }

  render(request: DiagramRenderRequest): Promise<DocumentFragment> {
    request.signal.throwIfAborted();
    if (this.destroyed) return Promise.reject(new Error("Renderer has been destroyed."));
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.sequence, request, resolve, reject, abort: () => {
        if (this.active === job) this.finish(request.signal.reason, undefined, true);
        else {
          this.pending = this.pending.filter(candidate => candidate !== job);
          request.signal.removeEventListener("abort", job.abort);
          reject(request.signal.reason);
        }
      } };
      request.signal.addEventListener("abort", job.abort, { once: true });
      this.pending.push(job);
      this.pump();
    });
  }

  private releaseFrame() {
    this.win.removeEventListener("message", this.onMessage);
    this.frame?.remove();
    this.frame = undefined;
    this.ready = false;
  }

  private createFrame() {
    const frame = this.doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Local PlantUML rendering engine";
    frame.style.cssText = "position:fixed;left:-100000px;width:1000px;height:1px;visibility:hidden;pointer-events:none;border:0";
    const escapedUrl = runtimeUrl.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${escapedUrl} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'"><script src="${escapedUrl}"></script>`;
    this.frame = frame;
    this.win.addEventListener("message", this.onMessage);
    this.doc.body.append(frame);
  }

  private onMessage = (event: MessageEvent) => {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    if (event.data?.type === "markora:plantuml:ready") {
      this.ready = true;
      this.send();
    } else if (event.data?.type === "markora:plantuml:result" && event.data.id === this.active?.id) {
      try {
        if (typeof event.data.error === "string") throw new Error(event.data.error);
        if (typeof event.data.svg !== "string") throw new Error("Invalid PlantUML output.");
        this.finish(undefined, parseDiagramSvg(event.data.svg, this.doc, true));
      } catch (error) { this.finish(error); }
    }
  };

  private send() {
    if (!this.ready || !this.active) return;
    let { source } = this.active.request;
    if (!/^\s*@start\w+/imu.test(source)) source = `@startuml\n${source}\n@enduml`;
    this.frame!.contentWindow!.postMessage({ type: "markora:plantuml:render", id: this.active.id, source }, "*");
  }

  private pump() {
    if (this.destroyed || this.active) return;
    clearTimeout(this.idleTimer);
    this.active = this.pending.shift();
    if (!this.active) {
      // Retain the warm engine briefly for source editing, then release its
      // browsing context. Explicit host teardown releases it immediately.
      this.idleTimer = setTimeout(() => this.releaseFrame(), 30_000);
      return;
    }
    this.timer = setTimeout(() => this.finish(new Error("PlantUML rendering timed out."), undefined, true), this.timeoutMs);
    if (!this.frame) this.createFrame();
    else this.send();
  }

  private finish(error?: unknown, result?: DocumentFragment, reset = false) {
    const job = this.active;
    if (!job) return;
    this.active = undefined;
    clearTimeout(this.timer);
    job.request.signal.removeEventListener("abort", job.abort);
    if (reset) this.releaseFrame();
    if (result) job.resolve(result);
    else job.reject(error);
    this.pump();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearTimeout(this.idleTimer);
    this.releaseFrame();
    for (const job of [...(this.active ? [this.active] : []), ...this.pending]) {
      job.request.signal.removeEventListener("abort", job.abort);
      job.reject(new Error("Renderer has been destroyed."));
    }
    this.active = undefined;
    this.pending = [];
  }
}

export function createPlantUmlRenderer(timeoutMs: number) {
  const sessions = new Map<Document, PlantUmlSession>();
  let destroyed = false;
  const render: DiagramRenderer = request => {
    request.signal.throwIfAborted();
    if (destroyed) throw new Error("Renderer has been destroyed.");
    if (request.source.length > 50_000) throw new Error("Diagram source exceeds the preview limit.");
    let session = sessions.get(request.ownerDocument);
    if (!session) {
      session = new PlantUmlSession(request.ownerDocument, timeoutMs);
      sessions.set(request.ownerDocument, session);
    }
    return session.render(request);
  };
  return { render, destroy() {
    destroyed = true;
    for (const session of sessions.values()) session.destroy();
    sessions.clear();
  } };
}
