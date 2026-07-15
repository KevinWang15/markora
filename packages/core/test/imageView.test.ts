import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from '../src/createEditor';

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('image node view', () => {
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
});
