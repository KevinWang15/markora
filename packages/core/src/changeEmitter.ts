export type ChangeEmitterOptions<TDoc, TContext> = {
  initialDoc: TDoc;
  initialMarkdown?: string;
  mode: "immediate" | "animationFrame";
  onChange?: (markdown: string, context: TContext) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
  serialize: (doc: TDoc) => string;
};

export type ChangeEmitterRuntimeOptions<TContext> = {
  mode?: "immediate" | "animationFrame";
  onChange?: ((markdown: string, context: TContext) => void) | null;
};

export function createChangeEmitter<TDoc, TContext>(options: ChangeEmitterOptions<TDoc, TContext>) {
  const { cancelFrame, initialDoc, requestFrame, serialize } = options;
  let mode = options.mode;
  let onChange = options.onChange;
  let lastSerializedDoc = initialDoc;
  let lastSerializedMarkdown = options.initialMarkdown ?? serialize(initialDoc);
  let pendingFrame: number | null = null;
  let pendingDoc: TDoc | null = null;
  let pendingContext: TContext | null = null;

  const getMarkdown = (targetDoc: TDoc) => {
    if (targetDoc === lastSerializedDoc) {
      return lastSerializedMarkdown;
    }

    lastSerializedMarkdown = serialize(targetDoc);
    lastSerializedDoc = targetDoc;
    return lastSerializedMarkdown;
  };

  const emit = (targetDoc: TDoc, context: TContext) => {
    pendingDoc = null;
    pendingContext = null;
    onChange?.(getMarkdown(targetDoc), context);
  };

  const cancel = () => {
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    pendingDoc = null;
    pendingContext = null;
  };

  const flush = () => {
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    if (pendingDoc && pendingContext) {
      emit(pendingDoc, pendingContext);
    }
  };

  const schedule = (targetDoc: TDoc, context: TContext) => {
    if (!onChange) {
      return;
    }

    if (mode === "immediate") {
      emit(targetDoc, context);
      return;
    }

    pendingDoc = targetDoc;
    pendingContext = context;

    if (pendingFrame !== null) {
      return;
    }

    pendingFrame = requestFrame(() => {
      pendingFrame = null;

      if (pendingDoc && pendingContext) {
        emit(pendingDoc, pendingContext);
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
    update(nextOptions: ChangeEmitterRuntimeOptions<TContext>) {
      if (nextOptions.mode !== undefined) {
        mode = nextOptions.mode;
      }

      if (nextOptions.onChange !== undefined) {
        onChange = nextOptions.onChange ?? undefined;
      }
    },
  };
}
