export type ChangeEmitterOptions<TDoc> = {
  initialDoc: TDoc;
  mode: "immediate" | "animationFrame";
  onChange?: (markdown: string) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  serialize: (doc: TDoc) => string;
};

export function createChangeEmitter<TDoc>(options: ChangeEmitterOptions<TDoc>) {
  const { cancelFrame, initialDoc, mode, onChange, requestFrame, serialize } = options;
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
  };
}
