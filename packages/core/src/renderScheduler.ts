/** Scheduling only: output validation and source generations belong to callers. */
export type MarkdownRenderTask = Readonly<{
  signal: AbortSignal;
  priority?: "normal" | "high";
  isCurrent(): boolean;
  run(): void | PromiseLike<void>;
  onError(cause: unknown): void;
}>;

export type MarkdownRenderSchedulerOptions = Readonly<{
  ownerWindow: Pick<Window, "setTimeout" | "clearTimeout">;
  maxConcurrent: number;
}>;

/** The cap counts live, non-cancelled jobs. Hosts must honor AbortSignal to
 * stop their underlying work; late settlement cannot reclaim a slot twice. */
export function createMarkdownRenderScheduler({ ownerWindow, maxConcurrent }: MarkdownRenderSchedulerOptions) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("Renderer concurrency must be a positive integer.");
  }
  type Job = { task: MarkdownRenderTask; finish(): void };
  const high = new Set<Job>();
  const normal = new Set<Job>();
  const running = new Set<Job>();
  let timer: number | null = null;
  let destroyed = false;

  function schedule() {
    if (destroyed || timer !== null || running.size >= maxConcurrent || !(high.size || normal.size)) return;
    // One task per turn, including synchronous renderers, avoids an input-path
    // invocation and gives the browser a chance to process new input.
    timer = ownerWindow.setTimeout(pump, 0);
  }

  function pump() {
    timer = null;
    if (destroyed || running.size >= maxConcurrent) return;
    const job = high.values().next().value ?? normal.values().next().value;
    if (!job) return;
    high.delete(job);
    normal.delete(job);
    running.add(job);
    const { task } = job;
    const fail = (cause: unknown) => {
      if (!destroyed && !task.signal.aborted) {
        try { task.onError(cause); } catch { /* diagnostic observer isolation */ }
      }
    };
    try {
      if (task.signal.aborted || !task.isCurrent()) job.finish();
      else void Promise.resolve(task.run()).then(job.finish, cause => {
        fail(cause);
        job.finish();
      });
    } catch (cause) {
      fail(cause);
      job.finish();
    }
    schedule();
  }

  return Object.freeze({
    enqueue(task: MarkdownRenderTask) {
      if (destroyed || task.signal.aborted) return;
      let finished = false;
      const job: Job = { task, finish() {
        if (finished) return;
        finished = true;
        high.delete(job);
        normal.delete(job);
        running.delete(job);
        task.signal.removeEventListener("abort", job.finish);
        schedule();
      } };
      task.signal.addEventListener("abort", job.finish, { once: true });
      (task.priority === "high" ? high : normal).add(job);
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) ownerWindow.clearTimeout(timer);
      timer = null;
      for (const queue of [high, normal, running]) {
        for (const job of queue) job.finish();
      }
    },
  });
}
