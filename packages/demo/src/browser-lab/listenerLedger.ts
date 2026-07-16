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

const UNSCOPED_OWNER = "__browser-lab-unscoped__";

const PLAYWRIGHT_GLOBAL_LISTENER_TYPES = [
  "auxclick",
  "click",
  "contextmenu",
  "dblclick",
  "mousedown",
  "mousemove",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchcancel",
  "touchend",
  "touchstart",
] as const;

function getCapture(options?: boolean | EventListenerOptions) {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

export function createGlobalListenerLedger(win: Window) {
  const records: ListenerRecord[] = [];
  const restorers: Array<() => void> = [];
  let activeOwner: string | null = null;
  let axeCoreBaselineAccepted = false;
  let firefoxCodeMirrorBaselineAccepted = false;
  let playwrightHarnessBaselineAccepted = false;

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

      if (!listener || (typeof options === "object" && (options.once || options.signal?.aborted))) {
        return;
      }

      const record: ListenerRecord = {
        capture: getCapture(options),
        listener,
        // Dynamic imports and browser callbacks run after the synchronous
        // editor scope closes. Keep them in the aggregate ledger so teardown
        // cannot silently miss lazy-runtime leaks.
        owner: activeOwner ?? UNSCOPED_OWNER,
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
    acceptPlaywrightHarnessBaseline() {
      if (playwrightHarnessBaselineAccepted) {
        return false;
      }

      const sentinel = records.filter((record) => (
        record.owner === UNSCOPED_OWNER
        && record.target === win
        && record.type === "__playwright_global_listeners_check__"
      ));

      if (sentinel.length !== 1) {
        return false;
      }

      const baseline: ListenerRecord[] = [sentinel[0]!];

      for (const type of PLAYWRIGHT_GLOBAL_LISTENER_TYPES) {
        const matching = records.filter((record) => (
          record.owner === UNSCOPED_OWNER
          && record.target === win
          && record.type === type
        ));

        // Playwright installs one listener of each type with its private
        // sentinel. If product code adds the same global listener, accepting
        // one still leaves the extra record visible to teardown assertions.
        if (matching.length < 1) {
          return false;
        }

        baseline.push(matching[0]!);
      }

      for (const record of baseline) {
        const index = records.indexOf(record);

        if (index >= 0) {
          records.splice(index, 1);
        }
      }

      playwrightHarnessBaselineAccepted = true;
      return true;
    },
    acceptAxeCoreBaseline() {
      const axeVersion = (win as Window & { axe?: { version?: unknown } }).axe?.version;

      if (axeCoreBaselineAccepted || axeVersion !== "4.12.1") {
        return false;
      }

      const matching = records.filter((record) => (
        record.owner === UNSCOPED_OWNER
        && record.target === win
        && record.type === "message"
        && !record.capture
        && typeof record.listener === "function"
        && Function.prototype.toString.call(record.listener).includes("messageHandler")
      ));

      // axe-core 4.12.1 opens one frame messenger when its source is injected
      // by the Playwright accessibility harness and does not expose a matching
      // close operation. Accept only that identifiable function; an unrelated
      // product message listener remains in the ledger.
      if (matching.length !== 1) {
        return false;
      }

      records.splice(records.indexOf(matching[0]!), 1);
      axeCoreBaselineAccepted = true;
      return true;
    },
    acceptFirefoxCodeMirrorCopyCutBaseline() {
      if (firefoxCodeMirrorBaselineAccepted || !/Firefox\//i.test(win.navigator.userAgent)) {
        return false;
      }

      const matching = records.filter((record) => (
        record.owner === UNSCOPED_OWNER
        && record.target === win.document
        && !record.capture
        && (record.type === "copy" || record.type === "cut")
      ));
      const copy = matching.filter((record) => record.type === "copy");
      const cut = matching.filter((record) => record.type === "cut");

      // CodeMirror installs exactly one permanent no-op pair per document in
      // Firefox. Anything broader remains visible to teardown assertions.
      if (matching.length !== 2 || copy.length !== 1 || cut.length !== 1) {
        return false;
      }

      for (const record of matching) {
        const index = records.indexOf(record);

        if (index >= 0) {
          records.splice(index, 1);
        }
      }

      firefoxCodeMirrorBaselineAccepted = true;
      return true;
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
      axeCoreBaselineAccepted = false;
      firefoxCodeMirrorBaselineAccepted = false;
      playwrightHarnessBaselineAccepted = false;
    },
  };
}
