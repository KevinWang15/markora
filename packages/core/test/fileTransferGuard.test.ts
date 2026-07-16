import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';
import {
  getTransferredFiles,
  hasTransferredFiles,
  rejectFileTransferEvent,
} from '../src/fileTransferGuard';

type TransferMock = {
  files?: { readonly length: number; readonly [index: number]: File };
  items?: ArrayLike<{ readonly kind?: string | null } | null>;
  types?: readonly string[];
  dropEffect?: string;
  getData?: (type: string) => string;
};

const editors: Array<ReturnType<typeof createEditor>> = [];

function installDomStubs() {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
  }

  if (!Element.prototype.animate) {
    Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
  }

  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(Date.now()), 16)) as typeof requestAnimationFrame;
  }

  if (typeof window.cancelAnimationFrame !== 'function') {
    window.cancelAnimationFrame = ((frameId: number) => {
      window.clearTimeout(frameId);
    }) as typeof cancelAnimationFrame;
  }
}

installDomStubs();

function createHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

function trackEditor(options: Parameters<typeof createEditor>[0]) {
  const editor = createEditor(options);
  editors.push(editor);
  return editor;
}

function createTransferEvent(
  type: 'paste' | 'dragover' | 'drop',
  property: 'clipboardData' | 'dataTransfer',
  transfer: TransferMock,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, property, {
    configurable: true,
    value: transfer,
  });
  return event;
}

function fileTransfer({ mixed = false }: { mixed?: boolean } = {}): TransferMock {
  const file = new File(['secret'], 'secret.txt', { type: 'text/plain' });
  const items = mixed
    ? [{ kind: 'string' }, { kind: 'file' }]
    : [{ kind: 'file' }];

  return {
    files: { 0: file, length: 1 },
    items,
    types: mixed ? ['text/plain', 'Files'] : ['Files'],
    dropEffect: 'copy',
    getData: (type) => type.toLowerCase().includes('text') ? 'must not be inserted' : '',
  };
}

function textTransfer(text: string, html = ''): TransferMock {
  return {
    files: { length: 0 },
    items: [{ kind: 'string' }],
    types: html ? ['text/plain', 'text/html'] : ['text/plain'],
    getData(type) {
      const normalizedType = type.toLowerCase();

      if (normalizedType === 'text/html') {
        return html;
      }

      if (normalizedType === 'text' || normalizedType === 'text/plain') {
        return text;
      }

      return '';
    },
  };
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
});

describe('file transfer detection', () => {
  it('accepts missing, empty, and string-only transfer data', () => {
    expect(hasTransferredFiles(null)).toBe(false);
    expect(hasTransferredFiles({})).toBe(false);
    expect(hasTransferredFiles({ files: { length: 0 }, items: [] })).toBe(false);
    expect(hasTransferredFiles({ files: { length: 0 }, items: [{ kind: 'string' }] })).toBe(false);
  });

  it('detects files from FileList and DataTransferItemList representations', () => {
    expect(hasTransferredFiles({ files: { length: 1 } })).toBe(true);
    expect(hasTransferredFiles({
      files: { length: 0 },
      items: [{ kind: 'string' }],
      types: ['text/plain', 'Files'],
    })).toBe(true);
    expect(hasTransferredFiles({
      files: { length: 0 },
      items: { 0: { kind: 'string' }, 1: { kind: 'file' }, length: 2 },
    })).toBe(true);
  });

  it('falls back to transfer items when access to files throws', () => {
    const transfer = Object.defineProperty(
      { items: [{ kind: 'file' }] },
      'files',
      { get: () => { throw new Error('protected'); } },
    );

    expect(hasTransferredFiles(transfer)).toBe(true);
  });

  it('does not merge fresh item wrappers into a populated FileList', () => {
    const listed = new File(['same'], 'same.png', { type: 'image/png' });
    const rematerialized = new File(['same'], 'same.png', { type: 'image/png' });

    expect(getTransferredFiles({
      files: [listed],
      items: [{ kind: 'file', getAsFile: () => rematerialized }],
    })).toEqual([listed]);
  });
});

describe('file transfer event handling', () => {
  it.each([
    ['paste', 'clipboardData'],
    ['dragover', 'dataTransfer'],
    ['drop', 'dataTransfer'],
  ] as const)('rejects file-bearing %s events', (type, property) => {
    const transfer = fileTransfer({ mixed: true });
    const event = createTransferEvent(type, property, transfer);

    expect(rejectFileTransferEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('none');
  });

  it('leaves ordinary text and rich transfer events alone', () => {
    const plainEvent = createTransferEvent('paste', 'clipboardData', textTransfer('plain'));
    const richEvent = createTransferEvent('paste', 'clipboardData', textTransfer('bold', '<strong>bold</strong>'));

    expect(rejectFileTransferEvent(plainEvent)).toBe(false);
    expect(plainEvent.defaultPrevented).toBe(false);
    expect(rejectFileTransferEvent(richEvent)).toBe(false);
    expect(richEvent.defaultPrevented).toBe(false);
  });
});

describe('embedded editor file transfer guard', () => {
  it.each([
    ['paste', 'clipboardData'],
    ['dragover', 'dataTransfer'],
    ['drop', 'dataTransfer'],
  ] as const)('rejects mixed file and text %s without changing the ProseMirror document', (type, property) => {
    const changes: string[] = [];
    const editor = trackEditor({
      element: createHost(),
      markdown: 'before',
      onChange: (markdown) => changes.push(markdown),
    });
    const event = createTransferEvent(type, property, fileTransfer({ mixed: true }));

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe('before');
    expect(changes).toEqual([]);
  });

  it('continues to process ordinary rich text paste in ProseMirror', () => {
    const editor = trackEditor({ element: createHost(), markdown: 'before' });
    const selection = TextSelection.create(editor.view.state.doc, editor.view.state.doc.content.size - 1);
    editor.view.dispatch(editor.view.state.tr.setSelection(selection));
    const event = createTransferEvent(
      'paste',
      'clipboardData',
      textTransfer(' after', '<strong> after</strong>'),
    );

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe('before**after**');
  });

  it.each([
    ['paste', 'clipboardData'],
    ['dragover', 'dataTransfer'],
    ['drop', 'dataTransfer'],
  ] as const)('rejects mixed file and text %s without changing a CodeMirror code block', (type, property) => {
    const changes: string[] = [];
    const markdown = ['```js', 'const value = 1;', '```'].join('\n');
    const editor = trackEditor({
      element: createHost(),
      markdown,
      onChange: (nextMarkdown) => changes.push(nextMarkdown),
    });
    const codeMirrorContent = editor.view.dom.querySelector<HTMLElement>('.cm-content');
    expect(codeMirrorContent).not.toBeNull();
    const event = createTransferEvent(type, property, fileTransfer({ mixed: true }));

    codeMirrorContent!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).toEqual([]);
  });

  it('continues to process ordinary text paste in a CodeMirror code block', () => {
    const editor = trackEditor({
      element: createHost(),
      markdown: ['```js', 'value', '```'].join('\n'),
    });
    const codeMirrorContent = editor.view.dom.querySelector<HTMLElement>('.cm-content');
    expect(codeMirrorContent).not.toBeNull();
    codeMirrorContent!.focus();
    const event = createTransferEvent('paste', 'clipboardData', textTransfer('next'));

    codeMirrorContent!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toContain('next');
  });
});
