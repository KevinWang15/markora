import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../src/createEditor';
import { defaultMarkdownEditorMessages } from '../src/editorMessages';
import { createImageViewClass } from '../src/imageView';
import { schema } from '../src/markdownCodec';
import type { MarkdownEditorImageLoadRequest } from '../src/resourceApi';
import { normalizeMarkdownEditorResources } from '../src/resourcePolicy';

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('image node view', () => {
  it('exposes loading as semantic DOM state for tokenized CSS animation', () => {
    const ImageView = createImageViewClass({
      imageNodeType: schema.nodes.image,
      resources: normalizeMarkdownEditorResources({
        loadImage: () => new Promise(() => undefined),
      }),
    });
    const imageView = new ImageView(schema.nodes.image.create({
      alt: 'Pending',
      src: '/pending.png',
      title: null,
    }), document);

    expect(imageView.dom.dataset.mdwImageState).toBe('loading');
    expect(imageView.dom.querySelector('.mdw-image-spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(imageView.dom.querySelector('.mdw-image-status')?.getAttribute('role')).toBe('status');
    expect(imageView.dom.textContent).toContain('Loading image');
    expect(() => {
      imageView.destroy();
      imageView.destroy();
    }).not.toThrow();
  });

  it('settles the CSS state and supports localized resource-policy text', () => {
    const ImageView = createImageViewClass({
      imageNodeType: schema.nodes.image,
      messages: {
        ...defaultMarkdownEditorMessages,
        imageBlockedByPolicy: 'Imagen bloqueada',
      },
      resources: normalizeMarkdownEditorResources({
        loadImage: () => null,
      }),
    });
    const imageView = new ImageView(schema.nodes.image.create({
      alt: 'Fallback',
      src: '/fallback.png',
      title: null,
    }), document);

    expect(imageView.dom.dataset.mdwImageState).toBe('error');
    expect(imageView.dom.textContent).toContain('Imagen bloqueada');
    expect(imageView.dom.querySelector('.mdw-image-spinner')).toHaveProperty('hidden', true);
    expect(imageView.dom.querySelector('.mdw-image-error-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(() => imageView.destroy()).not.toThrow();
  });

  it('atomizes complete image Markdown from a regular document transaction', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    editor.view.dispatch(editor.view.state.tr.insertText('![alt](https://example.com/image.png)'));

    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe('image');
    editor.destroy();
  });

  it('defers image atomization until composition input is committed', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });
    const markdown = '![alt](https://example.com/image.png)';

    editor.view.dispatch(
      editor.view.state.tr
        .insertText(markdown)
        .setMeta('composition', 1),
    );

    expect(editor.view.state.doc.firstChild?.textContent).toBe(markdown);
    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe('text');

    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: markdown,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe('image');
    editor.destroy();
  });

  it('distinguishes standalone images from images mixed with paragraph text', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '![standalone](https://example.com/standalone.png)',
    });

    expect(editor.view.dom.querySelector('.mdw-image')?.classList.contains('mdw-image-standalone')).toBe(true);

    editor.commands.setMarkdown('Text before ![inline](https://example.com/inline.png)');

    expect(editor.view.dom.querySelector('.mdw-image')?.classList.contains('mdw-image-standalone')).toBe(false);
    editor.destroy();
  });

  it('refreshes the visible fallback when alt text changes after an image error', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '![Old fallback](https://example.com/missing.png)',
    });
    const image = editor.view.dom.querySelector('img');

    expect(image).not.toBeNull();
    image!.dispatchEvent(new Event('error'));
    expect(editor.view.dom.querySelector('.mdw-image')?.textContent).toContain('Old fallback');

    editor.commands.setMarkdown('![New fallback](https://example.com/missing.png)');

    expect(editor.view.dom.querySelector('.mdw-image')?.textContent).toContain('New fallback');
    expect(editor.view.dom.querySelector('.mdw-image')?.textContent).not.toContain('Old fallback');
    editor.destroy();
  });

  it('uses the latest alt text when an in-flight image request fails', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '![Old fallback](https://example.com/loading.png)',
    });
    const image = editor.view.dom.querySelector('img');

    expect(image).not.toBeNull();
    editor.commands.setMarkdown('![New fallback](https://example.com/loading.png)');
    image!.dispatchEvent(new Event('error'));

    expect(editor.view.dom.querySelector('.mdw-image')?.textContent).toContain('New fallback');
    expect(editor.view.dom.querySelector('.mdw-image')?.textContent).not.toContain('Old fallback');
    editor.destroy();
  });

  it('keeps a reentrant replacement request cancellable after aborting the stale request', () => {
    const requests: MarkdownEditorImageLoadRequest[] = [];
    let imageView!: InstanceType<ReturnType<typeof createImageViewClass>>;
    const ImageView = createImageViewClass({
      imageNodeType: schema.nodes.image,
      resources: normalizeMarkdownEditorResources({
        loadImage(request) {
          requests.push(request);
          if (request.storedUrl === '/first.png') {
            request.signal.addEventListener('abort', () => {
              imageView.update(schema.nodes.image.create({
                alt: 'Winner',
                src: '/winner.png',
                title: null,
              }));
            }, { once: true });
          }
          return new Promise(() => undefined);
        },
      }),
    });
    imageView = new ImageView(schema.nodes.image.create({
      alt: 'First',
      src: '/first.png',
      title: null,
    }), document);

    imageView.update(schema.nodes.image.create({
      alt: 'Trigger',
      src: '/trigger.png',
      title: null,
    }));

    expect(requests.map((request) => request.storedUrl)).toEqual([
      '/first.png',
      '/winner.png',
    ]);
    expect(requests[1].signal.aborted).toBe(false);

    imageView.destroy();
    expect(requests[1].signal.aborted).toBe(true);
  });
});
