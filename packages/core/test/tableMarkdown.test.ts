import { afterEach, describe, expect, it } from 'vitest';
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect());
}

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
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

function setSelectionToEndOfLastBlock(editor: ReturnType<typeof createEditor>) {
  const doc = editor.view.state.doc;
  const lastChild = doc.lastChild;

  if (!lastChild) {
    throw new Error('Document is empty');
  }

  const endPos = doc.content.size - 1;
  const selection = Selection.near(doc.resolve(endPos), -1);
  editor.view.dispatch(editor.view.state.tr.setSelection(selection));
}

function replaceDocument(editor: ReturnType<typeof createEditor>, doc: EditorState['doc']) {
  const nextState = EditorState.create({
    doc,
    plugins: editor.view.state.plugins,
  });

  editor.view.updateState(nextState);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('table markdown fidelity', () => {
  it('round-trips an ordinary imported pipe table without data loss', () => {
    const markdown = [
      '| H | J |',
      '| --- | --- |',
      '| A | B |',
    ].join('\n');
    const editor = createEditor({
      element: createHost(),
      markdown,
    });

    const table = editor.view.state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(2);
    expect(table?.content.content.map((row) => row.childCount)).toEqual([2, 2]);
    expect(table?.content.content.map((row) => row.content.content.map((cell) => cell.textContent))).toEqual([
      ['H', 'J'],
      ['A', 'B'],
    ]);
    expect(table?.firstChild?.content.content.map((cell) => cell.attrs.scope)).toEqual(['col', 'col']);
    expect(editor.view.dom.querySelector('th')?.getAttribute('scope')).toBe('col');
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('keeps every serialized pipe-table line inside its blockquote', () => {
    const markdown = [
      '> | A |',
      '> | --- |',
      '> | x |',
    ].join('\n');
    const editor = createEditor({
      element: createHost(),
      markdown,
    });

    expect(editor.view.state.doc.firstChild?.type.name).toBe('blockquote');
    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe('table');
    expect(editor.getMarkdown()).toBe(markdown);

    editor.commands.resetMarkdown(markdown);
    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe('table');
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('preserves explicit HTML row and column header scope through the clipboard parser', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });
    const html = [
      '<table><tbody>',
      '<tr><th scope="col">Name</th><th scope="col">Status</th></tr>',
      '<tr><th scope="row">Alpha</th><td>Ready</td></tr>',
      '</tbody></table>',
    ].join('');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        files: { length: 0 },
        items: [{ kind: 'string' }],
        types: ['text/html', 'text/plain'],
        getData(type: string) {
          return type.toLowerCase() === 'text/html' ? html : 'Name Status Alpha Ready';
        },
      },
    });

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const headers = [...editor.view.dom.querySelectorAll('th')];
    expect(headers.map((header) => header.getAttribute('scope'))).toEqual(['col', 'col', 'row']);
    const table = editor.view.state.doc.firstChild;
    expect(table?.child(0).content.content.map((cell) => cell.attrs.scope)).toEqual(['col', 'col']);
    expect(table?.child(1).firstChild?.attrs.scope).toBe('row');
  });

  it('imports alignment, escaped pipes, code, and inline marks', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: [
        '| Default | Left | Center | Right | Rich |',
        '| --- | :--- | :---: | ---: | --- |',
        '| Plain | escaped \\| pipe | `code \\| pipe` | ~~strike~~ | **bold** and *italic* |',
        '| Link | [Docs](/docs) | one | two | three |',
      ].join('\n'),
    });

    const table = editor.view.state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    expect(table?.firstChild?.childCount).toBe(5);
    expect(table?.firstChild?.content.content.map((cell) => cell.attrs.align)).toEqual([
      null,
      'left',
      'center',
      'right',
      null,
    ]);
    expect(table?.child(1).content.content.map((cell) => cell.attrs.align)).toEqual([
      null,
      'left',
      'center',
      'right',
      null,
    ]);
    expect(table?.content.content.map((row) => row.content.content.map((cell) => cell.type.name))).toEqual([
      ['table_header', 'table_header', 'table_header', 'table_header', 'table_header'],
      ['table_cell', 'table_cell', 'table_cell', 'table_cell', 'table_cell'],
      ['table_cell', 'table_cell', 'table_cell', 'table_cell', 'table_cell'],
    ]);
    expect(table?.content.content.every((row) =>
      row.content.content.every((cell) => cell.firstChild?.type.name === 'paragraph'))).toBe(true);
    expect(table?.child(1).content.content.map((cell) => cell.textContent)).toEqual([
      'Plain',
      'escaped | pipe',
      'code | pipe',
      'strike',
      'bold and italic',
    ]);
    expect(table?.child(1).child(2).firstChild?.firstChild?.marks.map((mark) => mark.type.name))
      .toEqual(['code']);
  });

  it('serializes inline markdown marks inside table cells', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    const { schema } = editor.view.state;
    const paragraph = schema.nodes.paragraph;
    const header = schema.nodes.table_header;
    const cell = schema.nodes.table_cell;
    const row = schema.nodes.table_row;
    const table = schema.nodes.table;

    const doc = schema.topNodeType.create(null, [
      table.create(null, [
        row.create(null, [
          header.create({ align: 'left' }, [
            paragraph.create(null, [schema.text('Alpha', [schema.marks.em.create()])]),
          ]),
          header.create({ align: 'right' }, [
            paragraph.create(null, [schema.text('Beta', [schema.marks.link.create({ href: 'https://example.com', title: null })])]),
          ]),
          header.create({ align: 'center' }, [
            paragraph.create(null, [schema.text('a|b', [schema.marks.code.create()])]),
          ]),
        ]),
        row.create(null, [
          cell.create({ align: 'left' }, [paragraph.create(null, schema.text('one'))]),
          cell.create({ align: 'right' }, [paragraph.create(null, schema.text('two'))]),
          cell.create({ align: 'center' }, [paragraph.create(null, schema.text('three'))]),
        ]),
      ]),
    ]);

    replaceDocument(editor, doc);

    expect(editor.getMarkdown()).toBe([
      '| *Alpha* | [Beta](https://example.com) | `a\\|b` |',
      '| :--- | ---: | :---: |',
      '| one | two | three |',
    ].join('\n'));
  });

  it('preserves inline markdown in headers during typed pipe-table conversion', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    const { schema } = editor.view.state;
    const headerParagraph = schema.nodes.paragraph.create(null, schema.text('| *Alpha* | [Beta](https://example.com) |'));
    const dividerParagraph = schema.nodes.paragraph.create(null, schema.text('| --- | --- |'));
    replaceDocument(editor, schema.topNodeType.create(null, [headerParagraph, dividerParagraph]));

    setSelectionToEndOfLastBlock(editor);

    expect(pressKey(editor, 'Enter')).toBe(true);
    expect([...editor.view.dom.querySelectorAll('th')].map((header) => header.getAttribute('scope')))
      .toEqual(['col', 'col']);
    expect(editor.getMarkdown()).toBe([
      '| *Alpha* | [Beta](https://example.com/) |',
      '| --- | --- |',
      '|  |  |',
    ].join('\n'));
  });

  it('round-trips escaped pipes and code spans in table cells', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '',
    });

    const { schema } = editor.view.state;
    const paragraph = schema.nodes.paragraph;
    const header = schema.nodes.table_header;
    const cell = schema.nodes.table_cell;
    const row = schema.nodes.table_row;
    const table = schema.nodes.table;
    const doc = schema.topNodeType.create(null, [
      table.create(null, [
        row.create(null, [
          header.create(null, [paragraph.create(null, schema.text('Name'))]),
          header.create(null, [paragraph.create(null, schema.text('Value'))]),
        ]),
        row.create(null, [
          cell.create(null, [paragraph.create(null, [schema.text('a|b', [schema.marks.code.create()])])]),
          cell.create(null, [paragraph.create(null, schema.text('escaped | pipe'))]),
        ]),
      ]),
    ]);

    replaceDocument(editor, doc);

    const roundTrip = editor.getMarkdown();
    expect(roundTrip).toBe([
      '| Name | Value |',
      '| --- | --- |',
      '| `a\\|b` | escaped \\| pipe |',
    ].join('\n'));
  });
});

describe('task list accessibility', () => {
  it('exposes task list semantics in the DOM', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '- [x] done',
    });

    const taskItem = editor.view.dom.querySelector('li[data-task="true"]');
    const taskControl = taskItem?.querySelector<HTMLElement>('[data-mdw-task-control="true"]');
    expect(taskItem).toBeInstanceOf(HTMLElement);
    expect(taskItem?.getAttribute('role')).toBeNull();
    expect(taskControl?.tagName).toBe('BUTTON');
    expect(taskControl?.getAttribute('type')).toBe('button');
    expect(taskControl?.getAttribute('role')).toBe('checkbox');
    expect(taskControl?.getAttribute('aria-checked')).toBe('true');
    expect(taskControl?.getAttribute('aria-disabled')).toBe('false');
    expect(taskControl?.getAttribute('aria-label')).toBe('done');
    expect(taskControl?.getAttribute('aria-labelledby')).toBeNull();
    expect(taskControl?.tabIndex).toBe(0);
  });

  it('keeps selection and native checkbox identity through activation, undo, and redo', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '- [ ] todo',
    });
    const getControl = () => editor.view.dom.querySelector<HTMLElement>('[data-mdw-task-control="true"]');
    const control = getControl();
    expect(control).not.toBeNull();
    const initialSelection = editor.view.state.selection;
    control?.focus();
    const space = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
    });
    control?.dispatchEvent(space);
    control?.click();

    expect(space.defaultPrevented).toBe(false);
    expect(editor.getMarkdown()).toBe('* [x] todo');
    expect(getControl()?.getAttribute('aria-checked')).toBe('true');
    expect(getControl()).toBe(control);
    expect(document.activeElement).toBe(getControl());
    expect(editor.view.state.selection.eq(initialSelection)).toBe(true);

    const undoEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
    });
    getControl()?.dispatchEvent(undoEvent);
    await Promise.resolve();

    expect(undoEvent.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe('* [ ] todo');
    expect(getControl()?.getAttribute('aria-checked')).toBe('false');
    expect(getControl()).toBe(control);
    expect(document.activeElement).toBe(getControl());
    expect(editor.view.state.selection.eq(initialSelection)).toBe(true);

    const redoEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
      shiftKey: true,
    });
    getControl()?.dispatchEvent(redoEvent);
    await Promise.resolve();

    expect(redoEvent.defaultPrevented).toBe(true);
    expect(editor.getMarkdown()).toBe('* [x] todo');
    expect(getControl()?.getAttribute('aria-checked')).toBe('true');
    expect(getControl()).toBe(control);
    expect(document.activeElement).toBe(getControl());
    expect(editor.view.state.selection.eq(initialSelection)).toBe(true);
  });

  it('leaves Tab and Shift-Tab on task controls to native focus navigation', () => {
    const markdown = '* [ ] first\n* [ ] second';
    const editor = createEditor({
      element: createHost(),
      markdown,
    });
    const controls = [...editor.view.dom.querySelectorAll<HTMLElement>('[data-mdw-task-control="true"]')];
    expect(controls).toHaveLength(2);
    controls[1].focus();

    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
        shiftKey,
      });

      expect(controls[1].dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.getMarkdown()).toBe(markdown);
      expect(editor.view.state.doc.firstChild?.childCount).toBe(2);
      expect(editor.view.dom.querySelectorAll('li[data-task="true"] li[data-task="true"]')).toHaveLength(0);
    }
  });

  it('ignores checkbox chrome when task DOM is parsed back into a document', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: '- [x] done',
    });
    const container = document.createElement('div');
    container.append(DOMSerializer.fromSchema(editor.view.state.schema).serializeFragment(
      editor.view.state.doc.content,
    ));

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);
    expect(container.textContent).not.toContain('Task:');
    const reparsed = ProseMirrorDOMParser.fromSchema(editor.view.state.schema).parse(container);
    expect(reparsed.textContent).toBe('done');
    expect(reparsed.firstChild?.firstChild?.attrs.checked).toBe(true);
  });
});
