import type { MarkdownEditor } from "./createEditor";

export type MarkdownEditorSelectionKind =
  | "all"
  | "managed-block"
  | "node"
  | "other"
  | "text";

export type MarkdownEditorSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: MarkdownEditorSelectionKind;
  to: number;
};

type MarkdownEditorEventBase<TType extends string> = {
  editor: MarkdownEditor;
  type: TType;
};

export type MarkdownEditorFocusEvent = MarkdownEditorEventBase<"focus"> & {
  nativeEvent: FocusEvent;
};

export type MarkdownEditorBlurEvent = MarkdownEditorEventBase<"blur"> & {
  nativeEvent: FocusEvent;
};

export type MarkdownEditorSelectionEvent = MarkdownEditorEventBase<"selection"> & {
  previousSelection: MarkdownEditorSelectionSnapshot;
  selection: MarkdownEditorSelectionSnapshot;
};

export type MarkdownEditorUpdateEvent = MarkdownEditorEventBase<"update"> & {
  selection: MarkdownEditorSelectionSnapshot;
};

export type MarkdownEditorErrorCode = "code-block-language-load-failed";

export type MarkdownEditorErrorEvent = MarkdownEditorEventBase<"error"> & {
  code: MarkdownEditorErrorCode;
  context: {
    language: string;
  };
  error: unknown;
  recoverable: true;
};

export type MarkdownEditorEventMap = {
  blur: MarkdownEditorBlurEvent;
  error: MarkdownEditorErrorEvent;
  focus: MarkdownEditorFocusEvent;
  selection: MarkdownEditorSelectionEvent;
  update: MarkdownEditorUpdateEvent;
};

export type MarkdownEditorEventName = keyof MarkdownEditorEventMap;

export type MarkdownEditorEventListener<TType extends MarkdownEditorEventName> = (
  event: MarkdownEditorEventMap[TType],
) => void;

export type MarkdownEditorUnsubscribe = () => void;

export class MarkdownEditorDestroyedError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Cannot ${operation} after the Markora editor has been destroyed.`);
    this.name = "MarkdownEditorDestroyedError";
    this.operation = operation;
  }
}

type AnyEditorEvent = MarkdownEditorEventMap[MarkdownEditorEventName];
type AnyEditorEventListener = (event: AnyEditorEvent) => void;

export function createEditorEventDispatcher(reportUnhandled: (error: unknown) => void) {
  const listeners = new Map<MarkdownEditorEventName, Map<number, AnyEditorEventListener>>();
  let nextListenerId = 1;

  const subscribe = <TType extends MarkdownEditorEventName>(
    type: TType,
    listener: MarkdownEditorEventListener<TType>,
  ): MarkdownEditorUnsubscribe => {
    let bucket = listeners.get(type);

    if (!bucket) {
      bucket = new Map();
      listeners.set(type, bucket);
    }

    const listenerId = nextListenerId;
    nextListenerId += 1;
    bucket.set(listenerId, listener as AnyEditorEventListener);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }

      subscribed = false;
      const currentBucket = listeners.get(type);
      currentBucket?.delete(listenerId);

      if (currentBucket?.size === 0) {
        listeners.delete(type);
      }
    };
  };

  const emit = <TType extends MarkdownEditorEventName>(
    type: TType,
    event: MarkdownEditorEventMap[TType],
    shouldContinue?: () => boolean,
  ) => {
    const bucket = listeners.get(type);

    if (!bucket) {
      return 0;
    }

    const listenerIds = [...bucket.keys()];
    let delivered = 0;

    for (const listenerId of listenerIds) {
      if (shouldContinue && !shouldContinue()) {
        break;
      }

      const listener = bucket.get(listenerId);

      if (!listener) {
        continue;
      }

      try {
        listener(event);
      } catch (error) {
        reportUnhandled(error);
      }

      delivered += 1;
    }

    return delivered;
  };

  return {
    clear() {
      for (const bucket of listeners.values()) {
        bucket.clear();
      }

      listeners.clear();
    },
    emit,
    has(type: MarkdownEditorEventName) {
      return (listeners.get(type)?.size ?? 0) > 0;
    },
    subscribe,
  };
}
