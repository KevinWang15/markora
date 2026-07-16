import { Fragment, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  getTransferData,
  getTransferredFiles,
  hasTransferredFiles,
} from "./fileTransferGuard";
import type {
  MarkdownEditorAssetEventReason,
  MarkdownEditorAssets,
  MarkdownEditorAssetUploadError,
  MarkdownEditorAssetUploadErrorCode,
  MarkdownEditorAssetUploadResult,
  MarkdownEditorAssetUploadSnapshot,
  MarkdownEditorAssetTransferKind,
} from "./resourceApi";
import {
  assetMimeTypeIsAllowed,
  sanitizeResourceUrl,
  type NormalizedMarkdownEditorResources,
} from "./resourcePolicy";
import { setBuiltinMarkdownEditorTransactionOrigin } from "./transactionOrigin";

type UploadAnchor = Readonly<{
  batchId: string;
  from: number;
  id: string;
  index: number;
  to: number;
}>;

type UploadAnchorState = ReadonlyMap<string, UploadAnchor>;

type UploadAnchorMeta =
  | Readonly<{ anchors: readonly UploadAnchor[]; type: "add" }>
  | Readonly<{ ids: readonly string[]; type: "complete" }>
  | Readonly<{ id: string; type: "remove" }>;

type NormalizedUploadResult = Readonly<{
  alt: string | null;
  kind: "image";
  title: string | null;
  url: string;
}> | Readonly<{
  kind: "link";
  label: string;
  title: string | null;
  url: string;
}>;

type UploadTask = {
  attempt: number;
  batchId: string;
  controller: AbortController | null;
  error: MarkdownEditorAssetUploadError | undefined;
  file: File;
  id: string;
  index: number;
  progress: number | null;
  result: NormalizedUploadResult | null;
  source: MarkdownEditorAssetTransferKind;
  status: "failed" | "ready" | "uploading";
  transitioning: boolean;
};

export type CreateAssetUploadControllerOptions = {
  assertActive: (operation: string) => void;
  emit: (
    reason: MarkdownEditorAssetEventReason,
    upload: MarkdownEditorAssetUploadSnapshot,
  ) => void;
  getView: () => EditorView | null;
  isActive: () => boolean;
  ownerWindow: Window & typeof globalThis;
  reportUnhandled: (error: unknown) => void;
  resources: NormalizedMarkdownEditorResources;
  schema: Schema;
};

const uploadAnchorKey = new PluginKey<UploadAnchorState>("markoraAssetUploads");

function createUploadAnchorStateSpec() {
  return {
    init: () => new Map() as UploadAnchorState,
    apply(transaction: Transaction, previous: UploadAnchorState) {
      const meta = transaction.getMeta(uploadAnchorKey) as UploadAnchorMeta | undefined;
      const next = new Map<string, UploadAnchor>();

      for (const anchor of previous.values()) {
        if (meta?.type === "complete" && meta.ids.includes(anchor.id)) {
          continue;
        }

        if (transaction.docChanged) {
          const from = transaction.mapping.map(anchor.from, 1);
          const to = anchor.from === anchor.to
            ? from
            : transaction.mapping.map(anchor.to, -1);
          next.set(anchor.id, {
            ...anchor,
            from: Math.min(from, to),
            to: Math.max(from, to),
          });
          continue;
        }

        next.set(anchor.id, anchor);
      }

      if (meta?.type === "remove") {
        next.delete(meta.id);
      } else if (meta?.type === "add") {
        for (const anchor of meta.anchors) {
          next.set(anchor.id, anchor);
        }
      }

      return next;
    },
  };
}

function normalizeOptionalText(value: unknown, name: string) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string or null.`);
  }
  return value.trim() || null;
}

function normalizeUploadResult(
  resources: NormalizedMarkdownEditorResources,
  file: File,
  result: MarkdownEditorAssetUploadResult,
): NormalizedUploadResult {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new TypeError("Asset upload results must be objects.");
  }

  if (result.kind !== "image" && result.kind !== "link") {
    throw new RangeError('Asset upload result kind must be "image" or "link".');
  }

  if (typeof result.url !== "string") {
    throw new TypeError("Asset upload result URL must be a string.");
  }

  const url = sanitizeResourceUrl(resources, result.kind, result.url);
  if (!url) {
    throw new RangeError("Asset upload result URL was rejected by the configured resource policy.");
  }

  const title = normalizeOptionalText(result.title, "Asset upload result title");

  if (result.kind === "image") {
    return Object.freeze({
      alt: normalizeOptionalText(result.alt, "Asset upload result alt text") ?? file.name,
      kind: "image" as const,
      title,
      url,
    });
  }

  return Object.freeze({
    kind: "link" as const,
    label: normalizeOptionalText(result.label, "Asset upload result label")
      ?? normalizeOptionalText(file.name, "Asset file name")
      ?? "Uploaded file",
    title,
    url,
  });
}

function makeError(
  code: MarkdownEditorAssetUploadErrorCode,
  message: string,
  cause?: unknown,
): MarkdownEditorAssetUploadError {
  return Object.freeze({
    ...(cause === undefined ? {} : { cause }),
    code,
    message,
  });
}

function snapshotFile(file: File) {
  return Object.freeze({
    lastModified: file.lastModified,
    name: file.name,
    size: file.size,
    type: file.type,
  });
}

function snapshotTask(
  task: UploadTask,
  status: MarkdownEditorAssetUploadSnapshot["status"] = task.status === "ready"
    ? "uploading"
    : task.status,
) {
  return Object.freeze({
    ...(task.error ? { error: task.error } : {}),
    file: snapshotFile(task.file),
    id: task.id,
    progress: task.progress,
    source: task.source,
    status,
  }) satisfies MarkdownEditorAssetUploadSnapshot;
}

function createRejectedSnapshot(
  id: string,
  file: File,
  source: MarkdownEditorAssetTransferKind,
  error: MarkdownEditorAssetUploadError,
) {
  return Object.freeze({
    error,
    file: snapshotFile(file),
    id,
    progress: null,
    source,
    status: "rejected" as const,
  });
}

function setDropEffect(event: Event, effect: "copy" | "none") {
  const transfer = getTransferData(event);
  try {
    if (transfer && "dropEffect" in transfer) {
      transfer.dropEffect = effect;
    }
  } catch {
    // Preventing the browser default remains sufficient for protected data.
  }
}

export function createAssetUploadController(
  options: CreateAssetUploadControllerOptions,
) {
  const {
    assertActive,
    emit,
    getView,
    isActive,
    ownerWindow,
    reportUnhandled,
    resources,
    schema,
  } = options;
  const uploadOptions = resources.assets;
  const tasks = new Map<string, UploadTask>();
  let nextBatchId = 1;
  let nextUploadId = 1;

  const getAnchor = (id: string) => {
    const view = getView();
    return view ? uploadAnchorKey.getState(view.state)?.get(id) ?? null : null;
  };

  const dispatchMeta = (meta: UploadAnchorMeta) => {
    const view = getView();
    if (!view || view.isDestroyed || !isActive()) {
      return false;
    }

    const transaction = view.state.tr
      .setMeta(uploadAnchorKey, meta)
      .setMeta("addToHistory", false);
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "user");

    try {
      view.dispatch(transaction);
    } catch (error) {
      reportUnhandled(error);
    }

    if (meta.type === "add") {
      return meta.anchors.every((anchor) => Boolean(getAnchor(anchor.id)));
    }
    return meta.type === "remove" ? !getAnchor(meta.id) : meta.ids.every((id) => !getAnchor(id));
  };

  const failTask = (
    task: UploadTask,
    code: MarkdownEditorAssetUploadErrorCode,
    message: string,
    cause?: unknown,
  ) => {
    if (!tasks.has(task.id)) {
      return;
    }

    const controller = task.controller;
    task.controller = null;
    task.status = "failed";
    task.transitioning = true;
    task.error = makeError(code, message, cause);
    task.result = null;
    controller?.abort();

    if (!tasks.has(task.id)) {
      return;
    }

    task.transitioning = false;
    emit("failed", snapshotTask(task));
  };

  const createInsertionNode = (
    result: NormalizedUploadResult,
  ): ProseMirrorNode | null => {
    if (result.kind === "image") {
      return schema.nodes.image?.create({
        alt: result.alt,
        src: result.url,
        title: result.title,
      }) ?? null;
    }

    const linkType = schema.marks.link;
    if (!linkType) {
      return null;
    }

    return schema.text(result.label, [linkType.create({
      href: result.url,
      title: result.title,
    })]);
  };

  const flushBatch = (batchId: string) => {
    const batch = [...tasks.values()]
      .filter((task) => task.batchId === batchId)
      .sort((left, right) => left.index - right.index);

    if (batch.length === 0 || batch.some((task) => task.status !== "ready" || !task.result)) {
      return;
    }

    const anchors = batch.map((task) => getAnchor(task.id));
    const firstAnchor = anchors[0];
    if (
      !firstAnchor
      || anchors.some((anchor) => (
        !anchor
        || anchor.from !== firstAnchor.from
        || anchor.to !== firstAnchor.to
      ))
    ) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The upload batch no longer has one valid insertion anchor.");
      }
      return;
    }

    const view = getView();
    if (
      !view
      || view.isDestroyed
      || !isActive()
      || !view.editable
      || view.composing
    ) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The uploaded asset cannot be inserted in the editor's current state.");
      }
      return;
    }

    let nodes: Array<ProseMirrorNode | null>;
    try {
      nodes = batch.map((task) => createInsertionNode(task.result!));
    } catch (error) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The active schema could not create this uploaded asset.", error);
      }
      return;
    }
    if (nodes.some((node) => !node)) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The active schema cannot represent this uploaded asset.");
      }
      return;
    }

    let transaction: Transaction;
    try {
      transaction = view.state.tr.replaceWith(
        firstAnchor.from,
        firstAnchor.to,
        Fragment.fromArray(nodes as ProseMirrorNode[]),
      );
    } catch (error) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The upload anchor no longer accepts this asset.", error);
      }
      return;
    }

    if (!transaction.docChanged) {
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The upload anchor no longer accepts this asset.");
      }
      return;
    }

    transaction.setMeta(uploadAnchorKey, {
      ids: batch.map((task) => task.id),
      type: "complete",
    } satisfies UploadAnchorMeta);
    setBuiltinMarkdownEditorTransactionOrigin(transaction, "user");

    const completed = batch.map((task) => snapshotTask(task, "completed"));
    for (const task of batch) {
      task.controller = null;
      tasks.delete(task.id);
    }

    let dispatchError: unknown;
    try {
      view.dispatch(transaction.scrollIntoView());
    } catch (error) {
      dispatchError = error;
    }

    if (batch.some((task) => getAnchor(task.id))) {
      for (const task of batch) {
        tasks.set(task.id, task);
      }
      for (const task of batch) {
        failTask(task, "insertion-blocked", "The uploaded asset transaction was not accepted.", dispatchError);
      }
      return;
    }

    for (const upload of completed) {
      emit("completed", upload);
    }

    if (dispatchError !== undefined) {
      reportUnhandled(dispatchError);
    }
  };

  const finishAttempt = (
    task: UploadTask,
    result: MarkdownEditorAssetUploadResult,
    attempt: number,
    controller: AbortController,
  ) => {
    const isCurrentAttempt = () => (
      tasks.get(task.id) === task
      && task.attempt === attempt
      && task.status === "uploading"
      && task.controller === controller
      && !controller.signal.aborted
    );

    if (!isCurrentAttempt()) {
      return;
    }

    let normalizedResult: NormalizedUploadResult;
    try {
      normalizedResult = normalizeUploadResult(resources, task.file, result);
    } catch (error) {
      if (isCurrentAttempt()) {
        failTask(task, "invalid-result", "The asset upload returned an invalid result.", error);
      }
      return;
    }

    if (!isCurrentAttempt()) {
      return;
    }

    task.result = normalizedResult;
    task.controller = null;
    task.error = undefined;
    task.progress = 1;
    task.status = "ready";
    flushBatch(task.batchId);
  };

  const startAttempt = (task: UploadTask, reason: "retried" | "started") => {
    if (!uploadOptions || !tasks.has(task.id) || !isActive() || task.transitioning) {
      return false;
    }

    const view = getView();
    if (!view || view.isDestroyed || !view.editable || view.composing || !getAnchor(task.id)) {
      return false;
    }

    const previousController = task.controller;
    task.controller = null;
    task.transitioning = true;
    previousController?.abort();

    if (
      !tasks.has(task.id)
      || !isActive()
      || view.isDestroyed
      || !view.editable
      || view.composing
      || !getAnchor(task.id)
    ) {
      if (tasks.has(task.id)) {
        task.transitioning = false;
      }
      return false;
    }

    task.transitioning = false;
    task.attempt += 1;
    const attempt = task.attempt;
    const controller = new ownerWindow.AbortController();
    task.controller = controller;
    task.error = undefined;
    task.progress = null;
    task.result = null;
    task.status = "uploading";
    emit(reason, snapshotTask(task));

    if (
      !tasks.has(task.id)
      || task.attempt !== attempt
      || task.controller !== controller
      || controller.signal.aborted
    ) {
      return false;
    }

    const request = Object.freeze({
      file: task.file,
      id: task.id,
      reportProgress(progress: number) {
        if (!tasks.has(task.id) || task.attempt !== attempt || task.status !== "uploading") {
          return;
        }

        if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1) {
          failTask(task, "invalid-result", "Asset upload progress must be a finite number from 0 through 1.");
          return;
        }

        task.progress = progress;
        emit("progress", snapshotTask(task));
      },
      signal: controller.signal,
      source: task.source,
    });

    let pending: MarkdownEditorAssetUploadResult | PromiseLike<MarkdownEditorAssetUploadResult>;
    try {
      pending = uploadOptions.upload(request);
    } catch (error) {
      failTask(task, "upload-failed", "The host asset upload handler failed.", error);
      return false;
    }

    Promise.resolve(pending).then(
      (result) => {
        if (
          tasks.has(task.id)
          && task.attempt === attempt
          && task.status === "uploading"
          && task.controller === controller
          && !controller.signal.aborted
        ) {
          finishAttempt(task, result, attempt, controller);
        }
      },
      (error) => {
        if (
          tasks.has(task.id)
          && task.attempt === attempt
          && task.status === "uploading"
          && task.controller === controller
          && !controller.signal.aborted
        ) {
          failTask(task, "upload-failed", "The host asset upload handler failed.", error);
        }
      },
    );
    return true;
  };

  const cancelInternal = (
    id: string,
    shouldEmit: boolean,
    shouldDispatch: boolean,
    shouldFlushBatch = true,
    allowTransition = false,
  ) => {
    const task = tasks.get(id);
    if (!task || (task.transitioning && !allowTransition)) {
      return false;
    }

    const controller = task.controller;
    const cancelled = snapshotTask(task, "cancelled");
    task.controller = null;
    tasks.delete(id);

    if (shouldDispatch) {
      dispatchMeta({ id, type: "remove" });
    }
    controller?.abort();
    if (shouldEmit) {
      emit("cancelled", cancelled);
    }
    if (shouldFlushBatch) {
      flushBatch(task.batchId);
    }
    return true;
  };

  const rejectFile = (
    file: File,
    source: MarkdownEditorAssetTransferKind,
    code: MarkdownEditorAssetUploadErrorCode,
    message: string,
  ) => {
    const id = `asset-${nextUploadId++}`;
    emit("rejected", createRejectedSnapshot(id, file, source, makeError(code, message)));
  };

  const handleTransfer = (
    view: EditorView,
    event: ClipboardEvent | DragEvent,
    source: MarkdownEditorAssetTransferKind,
  ) => {
    const transfer = getTransferData(event);
    if (!hasTransferredFiles(transfer)) {
      return false;
    }

    event.preventDefault();
    setDropEffect(event, "none");

    if (!uploadOptions) {
      return true;
    }

    const files = getTransferredFiles(transfer);
    if (files.length === 0) {
      return true;
    }

    if (!isActive() || !view.editable || view.composing) {
      for (const file of files) {
        rejectFile(file, source, "insertion-blocked", "Files cannot be uploaded in the editor's current state.");
      }
      return true;
    }

    if (files.length > uploadOptions.maxFiles) {
      for (const file of files) {
        rejectFile(
          file,
          source,
          "too-many-files",
          `A transfer may contain at most ${uploadOptions.maxFiles} files.`,
        );
      }
      return true;
    }

    const validFiles: File[] = [];
    for (const file of files) {
      if (!assetMimeTypeIsAllowed(file.type, uploadOptions.allowedMimeTypes)) {
        rejectFile(
          file,
          source,
          "unsupported-file-type",
          `${file.type || "The empty MIME type"} is not accepted for asset upload.`,
        );
      } else if (file.size > uploadOptions.maxFileBytes) {
        rejectFile(
          file,
          source,
          "file-too-large",
          `Asset files may contain at most ${uploadOptions.maxFileBytes} bytes.`,
        );
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      return true;
    }

    const batchId = `asset-batch-${nextBatchId++}`;
    let from = view.state.selection.from;
    let to = view.state.selection.to;

    if (source === "drop") {
      try {
        const drop = view.posAtCoords({
          left: (event as DragEvent).clientX,
          top: (event as DragEvent).clientY,
        });
        from = to = drop?.pos ?? from;
      } catch {
        to = from;
      }
    }

    const anchors: UploadAnchor[] = validFiles.map((file, index) => {
      const id = `asset-${nextUploadId++}`;
      const task: UploadTask = {
        attempt: 0,
        batchId,
        controller: null,
        error: undefined,
        file,
        id,
        index,
        progress: null,
        result: null,
        source,
        status: "uploading",
        transitioning: false,
      };
      tasks.set(id, task);
      return Object.freeze({ batchId, from, id, index, to });
    });

    if (!dispatchMeta({ anchors, type: "add" })) {
      for (const anchor of anchors) {
        const task = tasks.get(anchor.id);
        if (task) {
          failTask(task, "insertion-blocked", "The editor could not retain an insertion anchor for this upload.");
        }
      }
      return true;
    }

    setDropEffect(event, "copy");
    for (const anchor of anchors) {
      const task = tasks.get(anchor.id);
      if (task) {
        startAttempt(task, "started");
      }
    }
    return true;
  };

  const plugin = new Plugin({
    key: uploadAnchorKey,
    state: createUploadAnchorStateSpec(),
    props: {
      handleDOMEvents: {
        dragover(_view, event) {
          if (!hasTransferredFiles(getTransferData(event))) {
            return false;
          }

          event.preventDefault();
          const view = getView();
          setDropEffect(
            event,
            uploadOptions && view?.editable && !view.composing && isActive() ? "copy" : "none",
          );
          return true;
        },
        drop(view, event) {
          return handleTransfer(view, event, "drop");
        },
        paste(view, event) {
          return handleTransfer(view, event, "paste");
        },
      },
    },
  });

  const api: MarkdownEditorAssets = {
    cancel(id) {
      assertActive("cancel an asset upload");
      if (typeof id !== "string") {
        throw new TypeError("Asset upload IDs must be strings.");
      }
      return cancelInternal(id, true, true);
    },
    getUploads() {
      assertActive("read asset uploads");
      return Object.freeze([...tasks.values()].map((task) => snapshotTask(task)));
    },
    retry(id) {
      assertActive("retry an asset upload");
      if (typeof id !== "string") {
        throw new TypeError("Asset upload IDs must be strings.");
      }

      const task = tasks.get(id);
      const view = getView();
      if (
        !task
        || task.status !== "failed"
        || task.transitioning
        || !view
        || view.isDestroyed
        || !view.editable
        || view.composing
        || !getAnchor(id)
      ) {
        return false;
      }

      return startAttempt(task, "retried");
    },
  };

  return Object.freeze({
    api: Object.freeze(api),
    cancelAll({ dispatch = true, emit: shouldEmit = true } = {}) {
      for (const id of [...tasks.keys()]) {
        cancelInternal(id, shouldEmit, dispatch, false, true);
      }
    },
    plugin,
  });
}
