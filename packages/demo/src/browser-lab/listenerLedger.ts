export type ListenerSnapshot = {
  total: number;
  byTargetAndType: Record<string, number>;
};

type GlobalTargetName = "document" | "visualViewport" | "window";

type ListenerRecord = {
  capture: boolean;
  listener: EventListenerOrEventListenerObject;
  owner: string;
  target: EventTarget;
  targetName: GlobalTargetName;
  type: string;
};

type MutableEventTarget = {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => void;
};

function getCapture(options?: boolean | EventListenerOptions) {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

export function createGlobalListenerLedger(win: Window) {
  const records: ListenerRecord[] = [];
  const restorers: Array<() => void> = [];
  let activeOwner: string | null = null;

  const removeRecord = (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean,
  ) => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];

      if (
        record?.target === target
        && record.type === type
        && record.listener === listener
        && record.capture === capture
      ) {
        records.splice(index, 1);
      }
    }
  };

  const patchTarget = (target: EventTarget, targetName: GlobalTargetName) => {
    const mutableTarget = target as unknown as MutableEventTarget;
    const originalAdd = mutableTarget.addEventListener;
    const originalRemove = mutableTarget.removeEventListener;

    mutableTarget.addEventListener = (type, listener, options) => {
      originalAdd.call(target, type, listener, options);

      if (!listener || !activeOwner || (typeof options === "object" && (options.once || options.signal?.aborted))) {
        return;
      }

      const record: ListenerRecord = {
        capture: getCapture(options),
        listener,
        owner: activeOwner,
        target,
        targetName,
        type,
      };

      const duplicate = records.some((candidate) => (
        candidate.target === record.target
        && candidate.type === record.type
        && candidate.listener === record.listener
        && candidate.capture === record.capture
      ));

      if (!duplicate) {
        records.push(record);
      }

      if (typeof options === "object" && options.signal) {
        options.signal.addEventListener("abort", () => {
          removeRecord(target, type, listener, record.capture);
        }, { once: true });
      }
    };

    mutableTarget.removeEventListener = (type, listener, options) => {
      originalRemove.call(target, type, listener, options);

      if (listener) {
        removeRecord(target, type, listener, getCapture(options));
      }
    };

    restorers.push(() => {
      mutableTarget.addEventListener = originalAdd;
      mutableTarget.removeEventListener = originalRemove;
    });
  };

  patchTarget(win, "window");
  patchTarget(win.document, "document");

  if (win.visualViewport) {
    patchTarget(win.visualViewport, "visualViewport");
  }

  return {
    acceptBaseline(owner: string) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.owner === owner) {
          records.splice(index, 1);
        }
      }
    },
    scope<T>(owner: string, callback: () => T) {
      const previousOwner = activeOwner;
      activeOwner = owner;

      try {
        return callback();
      } finally {
        activeOwner = previousOwner;
      }
    },
    snapshot(owner?: string): ListenerSnapshot {
      const matchingRecords = owner
        ? records.filter((record) => record.owner === owner)
        : records;
      const byTargetAndType: Record<string, number> = {};

      for (const record of matchingRecords) {
        const key = `${record.targetName}:${record.type}`;
        byTargetAndType[key] = (byTargetAndType[key] ?? 0) + 1;
      }

      return {
        total: matchingRecords.length,
        byTargetAndType,
      };
    },
    restore() {
      for (const restore of restorers.reverse()) {
        restore();
      }

      records.splice(0);
      activeOwner = null;
    },
  };
}
