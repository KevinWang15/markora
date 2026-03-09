import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
  }
}

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
}

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function setSelection(editor: ReturnType<typeof createEditor>, selection: Selection) {
  editor.view.dispatch(editor.view.state.tr.setSelection(selection));
}

function pressKey(editor: ReturnType<typeof createEditor>, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  let handled = false;
  editor.view.someProp('handleKeyDown', (handler) => {
    if (handler(editor.view, event)) {
      handled = true;
      return true;
    }
    return undefined;
  });
  return handled;
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

function findNodeByName(editor: ReturnType<typeof createEditor>, name: string) {
  let found: { pos: number; nodeSize: number } | null = null;

  editor.view.state.doc.descendants((node, pos) => {
    if (node.type.name === name) {
      found = { pos, nodeSize: node.nodeSize };
      return false;
    }
    return undefined;
  });

  if (!found) {
    throw new Error(`Node ${name} not found`);
  }

  return found;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('toolbar state', () => {
  it('marks bold active when the cursor is inside strong text', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '**xx**',
    });

    const range = findMarkedTextRange(editor, 'strong');
    setSelection(editor, TextSelection.create(editor.view.state.doc, range.start + 1));

    expect(editor.getToolbarState().bold.active).toBe(true);
  });

  it('marks bold inactive after escaping outside the strong boundary', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '**xx**',
    });

    const range = findMarkedTextRange(editor, 'strong');
    setSelection(editor, TextSelection.create(editor.view.state.doc, range.end));

    expect(editor.getToolbarState().bold.active).toBe(true);
    expect(pressKey(editor, 'ArrowRight')).toBe(true);
    expect(editor.getToolbarState().bold.active).toBe(false);
  });

  it('shows link active inside a link and can remove it', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '[docs](https://example.com)',
    });

    const range = findMarkedTextRange(editor, 'link');
    setSelection(editor, TextSelection.create(editor.view.state.doc, range.start + 1));

    const toolbarState = editor.getToolbarState();
    expect(toolbarState.link.active).toBe(true);
    expect(toolbarState.link.enabled).toBe(true);
    expect(editor.removeLink()).toBe(true);
    expect(editor.getMarkdown()).toBe('docs');
  });

  it('shows image active on image selection and can remove it', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '![alt](https://example.com/image.png)',
    });

    const image = findNodeByName(editor, 'image');
    setSelection(editor, NodeSelection.create(editor.view.state.doc, image.pos));

    const toolbarState = editor.getToolbarState();
    expect(toolbarState.image.active).toBe(true);
    expect(toolbarState.image.enabled).toBe(true);
    expect(editor.removeImage()).toBe(true);
    expect(editor.getMarkdown()).toBe('');
  });

  it('enables link creation for a text selection and applies it', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: 'hello world',
    });

    setSelection(editor, TextSelection.create(editor.view.state.doc, 1, 6));

    const toolbarState = editor.getToolbarState();
    expect(toolbarState.link.active).toBe(false);
    expect(toolbarState.link.enabled).toBe(true);
    expect(editor.setLink('https://example.com')).toBe(true);
    expect(editor.getMarkdown()).toBe('[hello](https://example.com/) world');
  });

  it('enables image insertion and inserts a selected image node', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    const toolbarState = editor.getToolbarState();
    expect(toolbarState.image.active).toBe(false);
    expect(toolbarState.image.enabled).toBe(true);
    expect(editor.insertImage({ src: 'https://example.com/image.png', alt: 'alt text' })).toBe(true);

    const image = findNodeByName(editor, 'image');
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.view.state.selection as NodeSelection).from).toBe(image.pos);
    expect(editor.getMarkdown()).toBe('![alt text](https://example.com/image.png)');
  });

  it('disables inline mark buttons inside a code block', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const answer = 42;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor, 'code_block');
    const selection = Selection.findFrom(editor.view.state.doc.resolve(codeBlock.pos + 1), 1, true);
    expect(selection).not.toBeNull();
    setSelection(editor, selection!);

    const toolbarState = editor.getToolbarState();

    expect(toolbarState.bold.enabled).toBe(false);
    expect(toolbarState.italic.enabled).toBe(false);
    expect(toolbarState.code.enabled).toBe(false);
    expect(toolbarState.strike.enabled).toBe(false);
  });

  it('recomputes toolbar state after setMarkdown', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: 'plain text',
    });

    expect(editor.getToolbarState().bold.enabled).toBe(true);

    editor.setMarkdown(['```js', 'const answer = 42;', '```'].join('\n'));

    const toolbarState = editor.getToolbarState();
    expect(toolbarState.bold.enabled).toBe(false);
    expect(toolbarState.code.enabled).toBe(false);
  });
});
