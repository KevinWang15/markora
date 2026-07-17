import { TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarkdownEditorDestroyedError,
  createEditor as createCompatibilityEditor,
  type MarkdownEditor,
  type MarkdownEditorAssetEvent,
  type MarkdownEditorAssetUploadRequest,
  type MarkdownEditorAssetUploadResult,
} from '../src';
import { createEditor as createMinimalEditor } from '../src/minimal';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

type TransferMock = {
  dropEffect: string;
  files: readonly File[];
  items: ReadonlyArray<{
    getAsFile: () => File;
    kind: 'file';
  }>;
  types: readonly string[];
};

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    cancel() {},
    finished: Promise.resolve(),
  })) as unknown as typeof Element.prototype.animate;
}

function createHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createFile(name: string, type = 'image/png', contents = 'png') {
  return new File([contents], name, { type });
}

function dispatchFiles(
  editor: MarkdownEditor,
  source: 'drop' | 'paste',
  files: readonly File[],
) {
  const transfer: TransferMock = {
    dropEffect: 'none',
    files,
    items: files.map((file) => ({
      getAsFile: () => file,
      kind: 'file' as const,
    })),
    types: ['Files'],
  };
  const event = new Event(source, { bubbles: true, cancelable: true });

  Object.defineProperty(event, source === 'paste' ? 'clipboardData' : 'dataTransfer', {
    configurable: true,
    value: transfer,
  });

  if (source === 'drop') {
    Object.defineProperties(event, {
      clientX: { configurable: true, value: 10 },
      clientY: { configurable: true, value: 20 },
    });
  }

  editor.view.dom.dispatchEvent(event);
  return { event, transfer };
}

function subscribeToAssets(editor: MarkdownEditor) {
  const events: MarkdownEditorAssetEvent[] = [];
  editor.subscribe('asset', (event) => events.push(event));
  return events;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const entries = [
  ['compatibility', createCompatibilityEditor],
  ['minimal', createMinimalEditor],
] as const;

describe.each(entries)('%s editor asset uploads', (_name, createEditor) => {
  it.each(['paste', 'drop'] as const)('inserts one successful %s upload', async (source) => {
    const requests: MarkdownEditorAssetUploadRequest[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: '',
      resources: {
        assets: {
          upload(request) {
            requests.push(request);
            return source === 'paste'
              ? { kind: 'image', url: `/assets/${request.file.name}` }
              : { kind: 'link', url: `/assets/${request.file.name}` };
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    if (source === 'drop') {
      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ inside: -1, pos: 1 });
    }

    const file = createFile('hero.png');
    const { event, transfer } = dispatchFiles(editor, source, [file]);
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('copy');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ file, source });
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'completed']);
    expect(events[0].upload).toMatchObject({
      file: { name: 'hero.png', size: 3, type: 'image/png' },
      progress: null,
      source,
      status: 'uploading',
    });
    expect(events[1].upload).toMatchObject({ progress: 1, status: 'completed' });
    expect(editor.assets.getUploads()).toEqual([]);

    const inserted = editor.view.state.doc.firstChild?.firstChild;
    if (source === 'paste') {
      expect(inserted?.type.name).toBe('image');
      expect(inserted?.attrs).toMatchObject({
        alt: 'hero.png',
        src: '/assets/hero.png',
        title: null,
      });
    } else {
      expect(inserted?.text).toBe('hero.png');
      expect(inserted?.marks[0]?.type.name).toBe('link');
      expect(inserted?.marks[0]?.attrs.href).toBe('/assets/hero.png');
    }
  });

  it('commits an out-of-order multi-file batch once, in transfer order and one history step', async () => {
    const pending = new Map<string, Deferred<MarkdownEditorAssetUploadResult>>();
    const docTransactions: unknown[] = [];
    const editor = track(createEditor({
      element: createHost(),
      markdown: '',
      onTransaction(transaction) {
        if (transaction.docChanged) {
          docTransactions.push(transaction);
        }
      },
      resources: {
        assets: {
          upload(request) {
            const attempt = deferred<MarkdownEditorAssetUploadResult>();
            pending.set(request.file.name, attempt);
            return attempt.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [
      createFile('first.png'),
      createFile('second.png'),
    ]);

    pending.get('second.png')!.resolve({
      alt: 'Second',
      kind: 'image',
      url: '/uploads/second.png',
    });
    await flushMicrotasks();

    expect(docTransactions).toEqual([]);
    expect(editor.view.state.doc.firstChild?.childCount).toBe(0);

    pending.get('first.png')!.resolve({
      alt: 'First',
      kind: 'image',
      url: '/uploads/first.png',
    });
    await flushMicrotasks();

    expect(docTransactions).toHaveLength(1);
    expect(events.map(({ reason }) => reason)).toEqual([
      'started',
      'started',
      'completed',
      'completed',
    ]);
    expect(events.slice(-2).map(({ upload }) => upload.file.name)).toEqual([
      'first.png',
      'second.png',
    ]);
    const paragraph = editor.view.state.doc.firstChild;
    expect(paragraph?.childCount).toBe(2);
    expect(paragraph?.child(0).attrs.src).toBe('/uploads/first.png');
    expect(paragraph?.child(1).attrs.src).toBe('/uploads/second.png');

    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.firstChild?.childCount).toBe(0);
    expect(editor.commands.undo()).toBe(false);
  });
});

describe('asset upload integration policy and lifecycle', () => {
  it('removes a completed batch atomically before delivering terminal events', async () => {
    const requests: MarkdownEditorAssetUploadRequest[] = [];
    const events: MarkdownEditorAssetEvent[] = [];
    const reentrantCancels: boolean[] = [];
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: '',
      resources: {
        assets: {
          upload(request) {
            requests.push(request);
            return { kind: 'image', url: `/uploads/${request.file.name}` };
          },
        },
      },
    }));
    editor.subscribe('asset', (event) => {
      events.push(event);
      if (event.reason === 'completed' && reentrantCancels.length === 0) {
        reentrantCancels.push(editor.assets.cancel(requests[1].id));
      }
    });

    dispatchFiles(editor, 'paste', [
      createFile('first.png'),
      createFile('second.png'),
    ]);
    await flushMicrotasks();

    expect(reentrantCancels).toEqual([false]);
    expect(events.map(({ reason }) => reason)).toEqual([
      'started',
      'started',
      'completed',
      'completed',
    ]);
    expect(editor.assets.getUploads()).toEqual([]);
  });

  it('emits progress without mutating the document', () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    const docTransactions: unknown[] = [];
    let request: MarkdownEditorAssetUploadRequest | undefined;
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'unchanged',
      onTransaction(transaction) {
        if (transaction.docChanged) {
          docTransactions.push(transaction);
        }
      },
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('progress.png')]);
    const before = editor.view.state.doc;
    request!.reportProgress(0.4);

    expect(editor.view.state.doc).toBe(before);
    expect(editor.getMarkdown()).toBe('unchanged');
    expect(docTransactions).toEqual([]);
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'progress']);
    expect(events[1].upload).toMatchObject({ progress: 0.4, status: 'uploading' });
    expect(editor.assets.getUploads()[0]).toMatchObject({ progress: 0.4, status: 'uploading' });
  });

  it('maps a pending insertion anchor through an intervening edit', async () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'tail',
      resources: {
        assets: { upload: () => pending.promise },
      },
    }));
    editor.view.dispatch(editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, 1),
    ));

    dispatchFiles(editor, 'paste', [createFile('mapped.png')]);
    editor.view.dispatch(editor.view.state.tr.insertText('prefix ', 1));
    pending.resolve({ kind: 'image', url: '/uploads/mapped.png' });
    await flushMicrotasks();

    const paragraph = editor.view.state.doc.firstChild;
    expect(paragraph?.childCount).toBe(3);
    expect(paragraph?.child(0).text).toBe('prefix ');
    expect(paragraph?.child(1).type.name).toBe('image');
    expect(paragraph?.child(1).attrs.src).toBe('/uploads/mapped.png');
    expect(paragraph?.child(2).text).toBe('tail');
  });

  it('rejects excessive batches, unsupported MIME types, and oversized files before upload', () => {
    const upload = vi.fn(() => ({ kind: 'image' as const, url: '/unused.png' }));
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'safe',
      resources: {
        assets: {
          allowedMimeTypes: ['image/png'],
          maxFileBytes: 3,
          maxFiles: 1,
          upload,
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('one.png'), createFile('two.png')]);
    dispatchFiles(editor, 'paste', [createFile('notes.txt', 'text/plain')]);
    dispatchFiles(editor, 'paste', [createFile('large.png', 'image/png', '1234')]);

    expect(upload).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe('safe');
    expect(editor.assets.getUploads()).toEqual([]);
    expect(events.map(({ reason }) => reason)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ]);
    expect(events.map(({ upload: snapshot }) => snapshot.error?.code)).toEqual([
      'too-many-files',
      'too-many-files',
      'unsupported-file-type',
      'file-too-large',
    ]);
    expect(events.every(({ upload: snapshot }) => snapshot.status === 'rejected')).toBe(true);
  });

  it('retains a failed upload for retry and inserts the successful retry', async () => {
    const attempts: Array<Deferred<MarkdownEditorAssetUploadResult>> = [];
    const requests: MarkdownEditorAssetUploadRequest[] = [];
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: '',
      resources: {
        assets: {
          upload(request) {
            requests.push(request);
            const attempt = deferred<MarkdownEditorAssetUploadResult>();
            attempts.push(attempt);
            return attempt.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);
    const failure = new Error('storage offline');

    dispatchFiles(editor, 'paste', [createFile('report.png')]);
    attempts[0].reject(failure);
    await flushMicrotasks();

    const failed = editor.assets.getUploads()[0];
    expect(failed).toMatchObject({
      error: { cause: failure, code: 'upload-failed' },
      status: 'failed',
    });
    expect(requests[0].signal.aborted).toBe(true);
    expect(editor.assets.retry(failed.id)).toBe(true);
    expect(requests[1].id).toBe(requests[0].id);

    attempts[1].resolve({
      kind: 'link',
      label: 'Uploaded report',
      url: '/uploads/report.pdf',
    });
    await flushMicrotasks();

    expect(events.map(({ reason }) => reason)).toEqual([
      'started',
      'failed',
      'retried',
      'completed',
    ]);
    expect(editor.assets.getUploads()).toEqual([]);
    const inserted = editor.view.state.doc.firstChild?.firstChild;
    expect(inserted?.text).toBe('Uploaded report');
    expect(inserted?.marks[0]?.attrs.href).toBe('/uploads/report.pdf');
  });

  it('does not let a reentrant result getter overwrite a retried attempt', async () => {
    const retry = deferred<MarkdownEditorAssetUploadResult>();
    const requests: MarkdownEditorAssetUploadRequest[] = [];
    let editor!: MarkdownEditor;
    editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: '',
      resources: {
        assets: {
          upload(request): MarkdownEditorAssetUploadResult | PromiseLike<MarkdownEditorAssetUploadResult> {
            requests.push(request);
            if (requests.length > 1) {
              return retry.promise;
            }

            return Object.defineProperties({}, {
              kind: {
                get() {
                  request.reportProgress(-1);
                  return 'image';
                },
              },
              url: { value: '/uploads/stale.png' },
            }) as MarkdownEditorAssetUploadResult;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);
    const retryResults: boolean[] = [];
    editor.subscribe('asset', (event) => {
      if (event.reason === 'failed') {
        retryResults.push(editor.assets.retry(event.upload.id));
      }
    });

    dispatchFiles(editor, 'paste', [createFile('reentrant-result.png')]);
    await flushMicrotasks();

    expect(retryResults).toEqual([true]);
    expect(events.map(({ reason }) => reason)).toEqual([
      'started',
      'failed',
      'retried',
    ]);
    expect(editor.assets.getUploads()[0]).toMatchObject({ status: 'uploading' });
    expect(editor.view.state.doc.firstChild?.childCount).toBe(0);

    retry.resolve({ kind: 'image', url: '/uploads/current.png' });
    await flushMicrotasks();

    expect(events.map(({ reason }) => reason)).toEqual([
      'started',
      'failed',
      'retried',
      'completed',
    ]);
    expect(editor.view.state.doc.firstChild?.firstChild?.attrs.src).toBe(
      '/uploads/current.png',
    );
  });

  it('aborts cancellation and ignores a late successful resolution', async () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    let request: MarkdownEditorAssetUploadRequest | undefined;
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'stable',
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('cancelled.png')]);
    const id = request!.id;
    expect(editor.assets.cancel(id)).toBe(true);
    expect(request!.signal.aborted).toBe(true);
    expect(editor.assets.cancel(id)).toBe(false);
    expect(editor.assets.getUploads()).toEqual([]);

    pending.resolve({ kind: 'image', url: '/uploads/too-late.png' });
    await flushMicrotasks();

    expect(editor.getMarkdown()).toBe('stable');
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'cancelled']);
  });

  it('commits cancellation before a synchronous abort listener reenters', () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    const reentrantCancels: boolean[] = [];
    let request!: MarkdownEditorAssetUploadRequest;
    let editor!: MarkdownEditor;
    editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'stable',
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            request.signal.addEventListener('abort', () => {
              reentrantCancels.push(editor.assets.cancel(request.id));
            }, { once: true });
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('reentrant-cancel.png')]);

    expect(editor.assets.cancel(request.id)).toBe(true);
    expect(request.signal.aborted).toBe(true);
    expect(reentrantCancels).toEqual([false]);
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'cancelled']);
    expect(editor.assets.getUploads()).toEqual([]);
  });

  it('settles failure before a synchronous abort listener can change it', async () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    const reentrantCancels: boolean[] = [];
    let request!: MarkdownEditorAssetUploadRequest;
    let editor!: MarkdownEditor;
    editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'stable',
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            request.signal.addEventListener('abort', () => {
              reentrantCancels.push(editor.assets.cancel(request.id));
            }, { once: true });
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('reentrant-failure.png')]);
    pending.reject(new Error('offline'));
    await flushMicrotasks();

    expect(request.signal.aborted).toBe(true);
    expect(reentrantCancels).toEqual([false]);
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'failed']);
    expect(editor.assets.getUploads()[0]).toMatchObject({ status: 'failed' });
  });

  it('uses a non-empty fallback for a link uploaded from an unnamed file', async () => {
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: '',
      messages: { uploadedFileLabel: 'Fichier téléversé' },
      resources: {
        assets: {
          upload: () => ({ kind: 'link', url: '/uploads/unnamed' }),
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('')]);
    await flushMicrotasks();

    expect(events.map(({ reason }) => reason)).toEqual(['started', 'completed']);
    expect(editor.view.state.doc.firstChild?.textContent).toBe('Fichier téléversé');
    expect(editor.view.state.doc.firstChild?.firstChild?.marks[0]?.attrs.href).toBe(
      '/uploads/unnamed',
    );
  });

  it('cancels pending uploads on reset and ignores their late resolution', async () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    let request: MarkdownEditorAssetUploadRequest | undefined;
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'before',
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('reset.png')]);
    editor.commands.resetMarkdown('replacement');

    expect(request!.signal.aborted).toBe(true);
    expect(editor.assets.getUploads()).toEqual([]);
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'cancelled']);

    pending.resolve({ kind: 'image', url: '/uploads/too-late.png' });
    await flushMicrotasks();
    expect(editor.getMarkdown()).toBe('replacement');
    expect(events.map(({ reason }) => reason)).toEqual(['started', 'cancelled']);
  });

  it('silently aborts pending uploads during destroy', async () => {
    const pending = deferred<MarkdownEditorAssetUploadResult>();
    let request: MarkdownEditorAssetUploadRequest | undefined;
    const editor = track(createCompatibilityEditor({
      element: createHost(),
      markdown: 'before',
      resources: {
        assets: {
          upload(nextRequest) {
            request = nextRequest;
            return pending.promise;
          },
        },
      },
    }));
    const events = subscribeToAssets(editor);

    dispatchFiles(editor, 'paste', [createFile('destroy.png')]);
    editor.destroy();

    expect(request!.signal.aborted).toBe(true);
    expect(events.map(({ reason }) => reason)).toEqual(['started']);
    expect(() => editor.assets.getUploads()).toThrow(MarkdownEditorDestroyedError);

    pending.resolve({ kind: 'image', url: '/uploads/too-late.png' });
    await flushMicrotasks();
    expect(editor.getMarkdown()).toBe('before');
  });

  it('rejects file transfer while read-only without invoking the host uploader', () => {
    const upload = vi.fn(() => ({ kind: 'image' as const, url: '/unused.png' }));
    const editor = track(createCompatibilityEditor({
      editable: false,
      element: createHost(),
      markdown: 'read only',
      resources: { assets: { upload } },
    }));
    const events = subscribeToAssets(editor);

    const { event, transfer } = dispatchFiles(editor, 'paste', [createFile('blocked.png')]);

    expect(event.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('none');
    expect(upload).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toBe('read only');
    expect(editor.assets.getUploads()).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reason: 'rejected',
      upload: {
        error: { code: 'insertion-blocked' },
        source: 'paste',
        status: 'rejected',
      },
    });
  });
});
