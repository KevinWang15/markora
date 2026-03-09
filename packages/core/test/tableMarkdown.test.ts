import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Selection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';

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
    expect(editor.getMarkdown()).toBe([
      '| *Alpha* | [Beta](https://example.com) |',
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
    expect(taskItem).toBeInstanceOf(HTMLElement);
    expect(taskItem?.getAttribute('role')).toBe('checkbox');
    expect(taskItem?.getAttribute('aria-checked')).toBe('true');
  });
});
