export type ChangeEmitterOptions<TDoc> = {
  initialDoc: TDoc;
  mode: "immediate" | "animationFrame";
  onChange?: (markdown: string) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  serialize: (doc: TDoc) => string;
};

export type ChangeEmitterRuntimeOptions = {
  mode?: "immediate" | "animationFrame";
  onChange?: ((markdown: string) => void) | null;
};

export function createChangeEmitter<TDoc>(options: ChangeEmitterOptions<TDoc>) {
  const { cancelFrame, initialDoc, requestFrame, serialize } = options;
  let mode = options.mode;
  let onChange = options.onChange;
  let lastSerializedDoc = initialDoc;
  let lastSerializedMarkdown = serialize(initialDoc);
  let pendingFrame: number | null = null;
  let pendingDoc: TDoc | null = null;

  const getMarkdown = (targetDoc: TDoc) => {
    if (targetDoc === lastSerializedDoc) {
      return lastSerializedMarkdown;
    }

    lastSerializedMarkdown = serialize(targetDoc);
    lastSerializedDoc = targetDoc;
    return lastSerializedMarkdown;
  };

  const emit = (targetDoc: TDoc) => {
    pendingDoc = null;
    onChange?.(getMarkdown(targetDoc));
  };

  const cancel = () => {
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    pendingDoc = null;
  };

  const flush = () => {
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    if (pendingDoc) {
      emit(pendingDoc);
    }
  };

  const schedule = (targetDoc: TDoc) => {
    if (!onChange) {
      return;
    }

    if (mode === "immediate") {
      emit(targetDoc);
      return;
    }

    pendingDoc = targetDoc;

    if (pendingFrame !== null) {
      return;
    }

    pendingFrame = requestFrame(() => {
      pendingFrame = null;

      if (pendingDoc) {
        emit(pendingDoc);
      }
    });
  };

  const cache = (targetDoc: TDoc) => {
    lastSerializedMarkdown = serialize(targetDoc);
    lastSerializedDoc = targetDoc;
    return lastSerializedMarkdown;
  };

  return {
    cache,
    cancel,
    flush,
    getMarkdown,
    schedule,
    update(nextOptions: ChangeEmitterRuntimeOptions) {
      if (nextOptions.mode !== undefined) {
        mode = nextOptions.mode;
      }

      if (nextOptions.onChange !== undefined) {
        onChange = nextOptions.onChange ?? undefined;
      }
    },
  };
}
