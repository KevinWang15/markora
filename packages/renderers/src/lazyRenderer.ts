export type RenderRequest = Readonly<{ signal: AbortSignal }>;
export type Renderer<Request extends RenderRequest, Output> = (request: Request) => Output | Promise<Output>;

/** One import per adapter, shared by simultaneous requests. A cancelled consumer
 * must not poison the shared import or delay a new consumer. Failed imports are
 * evicted so the extension's Retry action can try loading again. */
export function createLazyRenderer<Request extends RenderRequest, Output>(
  load: () => Promise<Renderer<Request, Output>>,
): Renderer<Request, Output> {
  let loading: Promise<Renderer<Request, Output>> | undefined;
  return async request => {
    request.signal.throwIfAborted();
    if (!loading) {
      const attempt = Promise.resolve().then(load);
      loading = attempt;
      void attempt.catch(() => { if (loading === attempt) loading = undefined; });
    }
    return abortable(loading.then(render => {
      request.signal.throwIfAborted();
      return render(request);
    }), request.signal);
  };
}

/** Stop waiting immediately, while observing the underlying task's eventual
 * rejection. This does not claim to interrupt synchronous engine execution. */
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    task.then(value => {
      signal.removeEventListener("abort", abort);
      if (!signal.aborted) resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
