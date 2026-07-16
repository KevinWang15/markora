const IDLE_QUIET_PERIOD_MS = 300;
const IDLE_MAX_WAIT_MS = 5_000;

type HostIdleWindow = Window & typeof globalThis & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void,
    options?: { timeout?: number },
  ) => number;
};

export type HostIdleTask = Readonly<{
  cancel(): void;
  postpone(): void;
}>;

export type HostIdleScheduler = {
  schedule(callback: () => void): HostIdleTask;
};

/** Schedule indivisible background work in the editor host's own window. */
export function createHostIdleScheduler(ownerWindow: HostIdleWindow): HostIdleScheduler {
  const requestFrame = typeof ownerWindow.requestAnimationFrame === "function"
    ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
    : ((callback: FrameRequestCallback) => ownerWindow.setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = typeof ownerWindow.cancelAnimationFrame === "function"
    ? ownerWindow.cancelAnimationFrame.bind(ownerWindow)
    : ((handle: number) => ownerWindow.clearTimeout(handle));
  const now = ownerWindow.performance.now.bind(ownerWindow.performance);

  return Object.freeze({
    schedule(callback: () => void) {
      let active = true;
      let generation = 0;
      let frameHandle: number | null = null;
      let idleHandle: number | null = null;
      let postPaintTimer: number | null = null;
      let quietTimer: number | null = null;
      let watchdogTimer: number | null = null;
      const deadline = now() + IDLE_MAX_WAIT_MS;

      const cancelDeliveryOpportunity = () => {
        if (idleHandle !== null) {
          ownerWindow.cancelIdleCallback?.(idleHandle);
          idleHandle = null;
        }
        if (frameHandle !== null) {
          cancelFrame(frameHandle);
          frameHandle = null;
        }
        if (postPaintTimer !== null) {
          ownerWindow.clearTimeout(postPaintTimer);
          postPaintTimer = null;
        }
        if (quietTimer !== null) {
          ownerWindow.clearTimeout(quietTimer);
          quietTimer = null;
        }
      };

      const cancelHandles = () => {
        cancelDeliveryOpportunity();
        if (watchdogTimer !== null) {
          ownerWindow.clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
      };

      const run = () => {
        if (!active) {
          return;
        }

        active = false;
        generation += 1;
        cancelHandles();
        callback();
      };

      const queueAfterQuiet = (expectedGeneration: number) => {
        if (!active || generation !== expectedGeneration) {
          return;
        }

        if (
          typeof ownerWindow.requestIdleCallback === "function"
          && typeof ownerWindow.cancelIdleCallback === "function"
        ) {
          const remaining = Math.max(0, Math.ceil(deadline - now()));
          const scheduledIdleHandle = ownerWindow.requestIdleCallback(() => {
            if (idleHandle === scheduledIdleHandle) {
              idleHandle = null;
            }
            if (active && generation === expectedGeneration) {
              run();
            }
          }, { timeout: remaining });
          idleHandle = scheduledIdleHandle;
          return;
        }

        const scheduledFrameHandle = requestFrame(() => {
          if (frameHandle === scheduledFrameHandle) {
            frameHandle = null;
          }
          if (!active || generation !== expectedGeneration) {
            return;
          }
          const scheduledPostPaintTimer = ownerWindow.setTimeout(() => {
            if (postPaintTimer === scheduledPostPaintTimer) {
              postPaintTimer = null;
            }
            if (active && generation === expectedGeneration) {
              run();
            }
          }, 0);
          postPaintTimer = scheduledPostPaintTimer;
        });
        frameHandle = scheduledFrameHandle;
      };

      const scheduleQuietPeriod = () => {
        generation += 1;
        const expectedGeneration = generation;
        cancelDeliveryOpportunity();
        const scheduledQuietTimer = ownerWindow.setTimeout(() => {
          if (quietTimer === scheduledQuietTimer) {
            quietTimer = null;
          }
          queueAfterQuiet(expectedGeneration);
        }, IDLE_QUIET_PERIOD_MS);
        quietTimer = scheduledQuietTimer;
      };

      watchdogTimer = ownerWindow.setTimeout(run, IDLE_MAX_WAIT_MS);
      scheduleQuietPeriod();

      return Object.freeze({
        cancel() {
          if (!active) {
            return;
          }

          active = false;
          generation += 1;
          cancelHandles();
        },
        postpone() {
          if (active) {
            scheduleQuietPeriod();
          }
        },
      });
    },
  });
}
