import type { HostIdleTask } from "./idleScheduler";

export type ChangeEmitterOptions<TDoc, TContext> = {
  initialDoc: TDoc;
  initialMarkdown?: string;
  onChange?: (markdown: string, context: TContext) => void;
  isDeliveryValid: (doc: TDoc) => boolean;
  scheduleIdle: (callback: () => void) => HostIdleTask;
  reportAsyncError: (error: unknown) => void;
  serialize: (doc: TDoc) => string;
};

export type ChangeEmitterRuntimeOptions<TContext> = {
  onChange?: ((markdown: string, context: TContext) => void) | null;
};

type PendingChange<TDoc, TContext> = {
  context: TContext;
  doc: TDoc;
  epoch: number;
  listener: (markdown: string, context: TContext) => void;
};

export function createChangeEmitter<TDoc, TContext>(options: ChangeEmitterOptions<TDoc, TContext>) {
  const {
    initialDoc,
    isDeliveryValid,
    reportAsyncError,
    scheduleIdle,
    serialize,
  } = options;
  let onChange = options.onChange;
  let lastSerializedDoc = initialDoc;
  let lastSerializedMarkdown = options.initialMarkdown ?? serialize(initialDoc);
  let invalidationEpoch = 0;
  let pending: PendingChange<TDoc, TContext> | null = null;
  let pendingIdleTask: HostIdleTask | null = null;

  const getMarkdown = (targetDoc: TDoc) => {
    if (targetDoc === lastSerializedDoc) {
      return lastSerializedMarkdown;
    }

    const markdown = serialize(targetDoc);
    lastSerializedMarkdown = markdown;
    lastSerializedDoc = targetDoc;
    return markdown;
  };

  const cancelScheduledWork = () => {
    if (pendingIdleTask) {
      const idleTask = pendingIdleTask;
      pendingIdleTask = null;
      idleTask.cancel();
    }
  };

  const deliver = (
    delivery: PendingChange<TDoc, TContext>,
    restoreAfterSerializerFailure: boolean,
    force: boolean,
  ) => {
    const isCurrentDelivery = () => (
      delivery.epoch === invalidationEpoch
      && isDeliveryValid(delivery.doc)
    );

    if (!force && !isCurrentDelivery()) {
      return;
    }

    let markdown: string;

    try {
      markdown = getMarkdown(delivery.doc);
    } catch (error) {
      if (
        restoreAfterSerializerFailure
        && delivery.epoch === invalidationEpoch
        && pending === null
        && isDeliveryValid(delivery.doc)
      ) {
        pending = delivery;
      }
      throw error;
    }

    if (!force && !isCurrentDelivery()) {
      return;
    }

    // Listener failures count as delivered and must not retry host side effects.
    delivery.listener(markdown, delivery.context);
  };

  const takePending = () => {
    const delivery = pending;
    pending = null;
    cancelScheduledWork();
    return delivery;
  };

  const drainAsync = () => {
    const delivery = takePending();

    if (!delivery) {
      return;
    }

    try {
      deliver(delivery, true, false);
    } catch (error) {
      reportAsyncError(error);
    }
  };

  const cancel = () => {
    cancelScheduledWork();
    pending = null;
    invalidationEpoch += 1;
  };

  const flushPending = (force: boolean) => {
    const delivery = takePending();

    if (delivery) {
      deliver(delivery, !force, force);
    }
  };

  const flush = () => flushPending(false);

  const schedule = (targetDoc: TDoc, context: TContext) => {
    const listener = onChange;

    if (!listener) {
      return;
    }

    const delivery: PendingChange<TDoc, TContext> = {
      context,
      doc: targetDoc,
      epoch: invalidationEpoch,
      listener,
    };

    pending = delivery;

    if (pendingIdleTask) {
      pendingIdleTask.postpone();
    } else {
      pendingIdleTask = scheduleIdle(() => {
        pendingIdleTask = null;
        drainAsync();
      });
    }
  };

  return {
    cache: getMarkdown,
    cancel,
    flush,
    flushFinal: () => flushPending(true),
    getMarkdown,
    schedule,
    update(nextOptions: ChangeEmitterRuntimeOptions<TContext>) {
      if (nextOptions.onChange !== undefined) {
        onChange = nextOptions.onChange ?? undefined;
      }
    },
  };
}
