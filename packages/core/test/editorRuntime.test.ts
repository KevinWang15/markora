import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { EditorView as CodeMirrorView, ViewPlugin } from '@codemirror/view';
import { createEditor } from '../src/createEditor';
import type { EditorUiFactory } from '../src';

const foreignWindows: Array<Window & typeof globalThis> = [];
const restores: Array<() => void> = [];

function installDomStubs(targetWindow: Window & typeof globalThis = window) {
  const RangeCtor = targetWindow.Range;

  if (RangeCtor && !RangeCtor.prototype.getClientRects) {
    RangeCtor.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (RangeCtor && !RangeCtor.prototype.getBoundingClientRect) {
    RangeCtor.prototype.getBoundingClientRect = (() => new targetWindow.DOMRect()) as () => DOMRect;
  }

  const ElementCtor = targetWindow.Element;

  if (ElementCtor && !ElementCtor.prototype.animate) {
    ElementCtor.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
  }

  if (typeof targetWindow.requestAnimationFrame !== 'function') {
    targetWindow.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      targetWindow.setTimeout(() => callback(Date.now()), 16)) as typeof requestAnimationFrame;
  }

  if (typeof targetWindow.cancelAnimationFrame !== 'function') {
    targetWindow.cancelAnimationFrame = ((frameId: number) => {
      targetWindow.clearTimeout(frameId);
    }) as typeof cancelAnimationFrame;
  }
}

installDomStubs();

function createHost(ownerDocument: Document = document) {
  const element = ownerDocument.createElement('div');
  ownerDocument.body.append(element);
  return element;
}

function createForeignWindow() {
  const targetWindow = new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window & typeof globalThis;
  foreignWindows.push(targetWindow);
  installDomStubs(targetWindow);
  return targetWindow;
}

function installAnimationFrameStub(targetWindow: Window & typeof globalThis = window) {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const originalRequestAnimationFrame = targetWindow.requestAnimationFrame;
  const originalCancelAnimationFrame = targetWindow.cancelAnimationFrame;

  targetWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  }) as typeof requestAnimationFrame;

  targetWindow.cancelAnimationFrame = ((frameId: number) => {
    callbacks.delete(frameId);
  }) as typeof cancelAnimationFrame;

  restores.push(() => {
    if (originalRequestAnimationFrame) {
      targetWindow.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (targetWindow as Partial<Window & typeof globalThis>).requestAnimationFrame;
    }

    if (originalCancelAnimationFrame) {
      targetWindow.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete (targetWindow as Partial<Window & typeof globalThis>).cancelAnimationFrame;
    }
  });

  return {
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      pendingCallbacks.forEach((callback) => callback(0));
    },
  };
}

function getDocumentStats(editor: ReturnType<typeof createEditor>) {
  let hasLink = false;
  let imageCount = 0;

  editor.view.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === 'link')) {
      hasLink = true;
    }

    if (node.type.name === 'image') {
      imageCount += 1;
    }

    return undefined;
  });

  return { hasLink, imageCount };
}

function findMarkedTextRange(editor: ReturnType<typeof createEditor>, markName: string) {
  let range: { start: number; end: number } | null = null;

  editor.view.state.doc.descendants((node, pos) => {
    if (!node.isText) {
      return undefined;
    }

    if (node.marks.some((mark) => mark.type.name === markName)) {
      range = {
        start: pos,
        end: pos + node.text!.length,
      };
      return false;
    }

    return undefined;
  });

  if (!range) {
    throw new Error(`Marked text for ${markName} not found`);
  }

  return range;
}

afterEach(() => {
  restores.splice(0).forEach((restore) => restore());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  foreignWindows.splice(0).forEach((targetWindow) => targetWindow.close());
});

describe('editor runtime', () => {
  it('cancels a queued user change when setMarkdown replaces the document silently', () => {
    const changes: string[] = [];
    const animationFrames = installAnimationFrameStub();
    const editor = createEditor({
      element: createHost(),
      markdown: 'alpha',
      onChangeMode: 'animationFrame',
      onChange(markdown) {
        changes.push(markdown);
      },
    });

    const insertPos = editor.view.state.doc.content.size - 1;
    editor.view.dispatch(editor.view.state.tr.insertText('!', insertPos));
    editor.commands.setMarkdown('fresh');
    animationFrames.flush();

    expect(changes).toEqual([]);
    expect(editor.getMarkdown()).toBe('fresh');
  });

  it('replaces a queued user change with the new API update when emitChange is enabled', () => {
    const changes: string[] = [];
    const animationFrames = installAnimationFrameStub();
    const editor = createEditor({
      element: createHost(),
      markdown: 'alpha',
      onChangeMode: 'animationFrame',
      onChange(markdown) {
        changes.push(markdown);
      },
    });

    const insertPos = editor.view.state.doc.content.size - 1;
    editor.view.dispatch(editor.view.state.tr.insertText('!', insertPos));
    editor.commands.setMarkdown('fresh', { emitChange: true });
    animationFrames.flush();

    expect(changes).toEqual(['fresh']);
  });

  it('uses the host window requestAnimationFrame for scheduled updates', () => {
    const globalAnimationFrames = installAnimationFrameStub();
    const foreignWindow = createForeignWindow();
    const foreignAnimationFrames = installAnimationFrameStub(foreignWindow);
    const changes: string[] = [];
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: 'alpha',
      onChangeMode: 'animationFrame',
      onChange(markdown) {
        changes.push(markdown);
      },
    });

    const insertPos = editor.view.state.doc.content.size - 1;
    editor.view.dispatch(editor.view.state.tr.insertText('!', insertPos));
    globalAnimationFrames.flush();

    expect(changes).toEqual([]);

    foreignAnimationFrames.flush();

    expect(changes).toEqual(['alpha!']);
    editor.destroy();
  });

  it('renders code block node views in the host document', () => {
    const foreignWindow = createForeignWindow();
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: '```ts\nconst value = 1\n```',
    });

    const codeBlock = editor.view.dom.querySelector('.mdw-code-block');
    const languageBadge = editor.view.dom.querySelector('.mdw-code-block-language');

    expect(codeBlock).not.toBeNull();
    expect(languageBadge?.textContent).toBe('ts');
    expect(codeBlock?.ownerDocument).toBe(foreignWindow.document);
    expect(document.querySelector('.mdw-code-block')).toBeNull();
    editor.destroy();
  });

  it('loads custom code block language support lazily', async () => {
    const loader = vi.fn(async () => ViewPlugin.define((view) => {
      view.dom.setAttribute('data-language-loaded', 'custom');
      return {};
    }));
    const editor = createEditor({
      codeBlockLanguages: {
        custom: loader,
      },
      element: createHost(),
      markdown: ['```custom', 'const value = 1', '```'].join('\n'),
    });

    const codeMirrorDom = editor.view.dom.querySelector('.cm-editor');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(codeMirrorDom?.getAttribute('data-language-loaded')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(codeMirrorDom?.getAttribute('data-language-loaded')).toBe('custom');
    editor.destroy();
  });

  it('reuses the same lazy language loader for matching code blocks', async () => {
    const loader = vi.fn(async () => ViewPlugin.define((view) => {
      view.dom.setAttribute('data-language-loaded', 'custom');
      return {};
    }));
    const editor = createEditor({
      codeBlockLanguages: {
        custom: loader,
      },
      element: createHost(),
      markdown: ['```custom', 'first', '```', '', '```custom', 'second', '```'].join('\n'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.querySelectorAll('.cm-editor[data-language-loaded="custom"]').length).toBe(2);
    editor.destroy();
  });

  it('does not expose removed flat alias methods at runtime', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: 'hello',
    });

    expect('setMarkdown' in editor).toBe(false);
    expect('toggleBold' in editor).toBe(false);
    expect('setLink' in editor).toBe(false);
    expect('editLink' in editor).toBe(false);
    expect('undo' in editor).toBe(false);
  });

  it('exposes structured commands and state helpers', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: 'hello',
    });

    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6)));

    expect(editor.state.can.toggleMark('strong')).toBe(true);
    expect(editor.state.isActive.mark('strong')).toBe(false);
    expect(editor.commands.toggleMark('strong')).toBe(true);
    expect(editor.state.isActive.mark('strong')).toBe(true);

    editor.commands.setMarkdown('[docs](https://example.com)');
    const range = findMarkedTextRange(editor, 'link');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, range.start + 1)));

    expect(editor.state.can.setLink()).toBe(true);
    expect(editor.state.isActive.mark('link')).toBe(true);
    expect(editor.commands.setLink('https://openai.com')).toBe(true);
    expect(editor.getMarkdown()).toContain('https://openai.com/');
  });

  it('sanitizes imported markdown and preserves relative URLs', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '[docs](/docs) ![safe](./images/pic.png) [bad](ftp://example.com/file) ![oops](blob:https://example.com/id)',
    });

    const { hasLink, imageCount } = getDocumentStats(editor);

    expect(hasLink).toBe(true);
    expect(imageCount).toBe(1);
    expect(editor.getMarkdown()).toContain('[docs](/docs)');
    expect(editor.getMarkdown()).toContain('![safe](./images/pic.png)');
    expect(editor.getMarkdown()).not.toContain('ftp://example.com/file');
    expect(editor.getMarkdown()).not.toContain('blob:https://example.com/id');
  });

  it('sanitizes unsafe pasted link and image attrs before insertion', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    const { schema } = editor.view.state;
    const unsafeLink = schema.marks.link.create({ href: 'javascript:alert(1)', title: null });
    const unsafeImage = schema.nodes.image.create({ src: 'javascript:alert(1)', alt: 'oops', title: null });
    const slice = new Slice(
      Fragment.from(
        schema.nodes.paragraph.create(null, [schema.text('docs', [unsafeLink]), unsafeImage]),
      ),
      0,
      0,
    );

    let transformPasted: ((nextSlice: Slice, view: typeof editor.view, plain: boolean) => Slice) | null = null;
    editor.view.someProp('transformPasted', (value) => {
      transformPasted = value as typeof transformPasted;
      return true;
    });

    expect(transformPasted).not.toBeNull();

    const sanitizedSlice = transformPasted!(slice, editor.view, false);
    const paragraph = sanitizedSlice.content.firstChild;

    expect(paragraph?.textContent).toBe('docs');
    expect(paragraph?.childCount).toBe(1);
    expect(paragraph?.firstChild?.marks).toEqual([]);
  });

  it('stays headless by default without creating overlay UI', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '[docs](https://example.com)',
    });

    const range = findMarkedTextRange(editor, 'link');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, range.start + 1)));

    expect(document.body.querySelector('.mdw-link-editor')).toBeNull();
    expect(document.body.querySelector('.mdw-image-editor')).toBeNull();
    expect(document.body.querySelector('.mdw-table-toolbar')).toBeNull();
    expect(editor.ui).toBeNull();
    expect(editor.ui?.editLink()).toBeUndefined();
  });

  it('uses the provided ui factory for link editing', () => {
    let openedHref: string | null = null;
    let linkEditorDestroyed = false;

    const ui: EditorUiFactory = () => ({
      enabled: true,
      clearSelectionAnchor() {},
      createSelectionAnchor() {
        return document.createElement('span');
      },
      imageEditor: {
        close() {},
        destroy() {},
        open() {},
      },
      linkEditor: {
        close() {},
        destroy() {
          linkEditorDestroyed = true;
        },
        open(_view, _marker, href) {
          openedHref = href;
        },
      },
      tableToolbar: {
        destroy() {},
        update() {},
      },
    });

    const editor = createEditor({
      element: createHost(),
      markdown: '[docs](https://example.com)',
      ui,
    });

    const range = findMarkedTextRange(editor, 'link');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, range.start + 1)));

    expect(editor.ui?.editLink()).toBe(true);
    expect(openedHref).toBe('https://example.com/');

    editor.destroy();
    expect(linkEditorDestroyed).toBe(true);
  });
});
