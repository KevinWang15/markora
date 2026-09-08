import { afterEach, describe, expect, it } from 'vitest';
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';
import { createTableNavigation } from '../src/tableNavigation';

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function replaceDocument(editor: ReturnType<typeof createEditor>, doc: EditorState['doc']) {
  editor.view.updateState(EditorState.create({
    doc,
    plugins: editor.view.state.plugins,
  }));
}

function setSelectionInsideTableCell(editor: ReturnType<typeof createEditor>, rowIndex: number, cellIndex: number) {
  let currentRowIndex = -1;
  let currentCellIndex = -1;
  let targetCellPos: number | null = null;

  editor.view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table_row') {
      currentRowIndex += 1;
      currentCellIndex = -1;
      return undefined;
    }

    if (currentRowIndex === rowIndex && (node.type.name === 'table_cell' || node.type.name === 'table_header')) {
      currentCellIndex += 1;

      if (currentCellIndex === cellIndex) {
        targetCellPos = pos;
        return false;
      }
    }

    return undefined;
  });

  expect(targetCellPos).not.toBeNull();
  const selection = Selection.findFrom(editor.view.state.doc.resolve(targetCellPos! + 2), 1, true);
  expect(selection).not.toBeNull();
  editor.view.dispatch(editor.view.state.tr.setSelection(selection!));
}

function createTestTableNavigation(editor: ReturnType<typeof createEditor>) {
  const { schema } = editor.view.state;

  return createTableNavigation({
    schema,
    getTableCellContext(state) {
      const { $from } = state.selection;
      let tableDepth = -1;
      let rowDepth = -1;
      let cellDepth = -1;

      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);

        if (cellDepth < 0 && (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header)) {
          cellDepth = depth;
          continue;
        }

        if (rowDepth < 0 && node.type === schema.nodes.table_row) {
          rowDepth = depth;
          continue;
        }

        if (tableDepth < 0 && node.type === schema.nodes.table) {
          tableDepth = depth;
          break;
        }
      }

      if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) {
        return null;
      }

      return {
        table: $from.node(tableDepth),
        row: $from.node(rowDepth),
        cell: $from.node(cellDepth),
        tablePos: $from.before(tableDepth),
        rowPos: $from.before(rowDepth),
        cellPos: $from.before(cellDepth),
        rowIndex: $from.index(tableDepth),
        cellIndex: $from.index(rowDepth),
      };
    },
    moveBeforeManagedBlock: () => false,
    moveAfterManagedBlock: () => false,
  });
}

function parseHtmlDocument(editor: ReturnType<typeof createEditor>, html: string) {
  const source = document.createElement('div');
  source.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(editor.view.state.schema).parse(source);
}

function getRowWidths(editor: ReturnType<typeof createEditor>) {
  const table = editor.view.state.doc.firstChild;
  expect(table?.type.name).toBe('table');
  return Array.from({ length: table!.childCount }, (_, index) => table!.child(index).childCount);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ragged table column removal', () => {
  it('keeps pasted ragged HTML tables structurally valid after removing a populated column', () => {
    const editor = createEditor({ element: createHost() });
    const pastedDocument = parseHtmlDocument(editor, [
      '<table><tbody>',
      '<tr><th>A</th><th>B</th></tr>',
      '<tr><td>one</td></tr>',
      '</tbody></table>',
    ].join(''));

    replaceDocument(editor, pastedDocument);
    expect(getRowWidths(editor)).toEqual([2, 1]);
    setSelectionInsideTableCell(editor, 0, 0);

    expect(createTestTableNavigation(editor).removeTableColumn(editor.view)).toBe(true);

    expect(getRowWidths(editor)).toEqual([1, 1]);
    expect(() => editor.view.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe('| B |\n| --- |\n|  |');
    editor.destroy();
  });

  it('preserves existing rectangular-table column removal behavior', () => {
    const editor = createEditor({ element: createHost() });
    const pastedDocument = parseHtmlDocument(editor, [
      '<table><tbody>',
      '<tr><th>A</th><th>B</th></tr>',
      '<tr><td>one</td><td>two</td></tr>',
      '</tbody></table>',
    ].join(''));

    replaceDocument(editor, pastedDocument);
    setSelectionInsideTableCell(editor, 1, 0);

    expect(createTestTableNavigation(editor).removeTableColumn(editor.view)).toBe(true);

    expect(getRowWidths(editor)).toEqual([1, 1]);
    expect(() => editor.view.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe('| B |\n| --- |\n| two |');
    editor.destroy();
  });
});

describe('direct table axis reordering', () => {
  const markdown = [
    '| H1 | H2 | H3 |',
    '| --- | --- | --- |',
    '| a | b | c |',
    '| d | e | f |',
  ].join('\n');

  it('moves a selected row to its final index atomically while keeping the header pinned', () => {
    const editor = createEditor({ element: createHost(), markdown });
    const navigation = createTestTableNavigation(editor);
    setSelectionInsideTableCell(editor, 1, 0);
    expect(navigation.selectTableRow(editor.view, 1)).toBe(true);
    expect(navigation.moveTableRowTo(editor.view, 2)).toBe(true);
    expect(editor.getMarkdown()).toBe([
      '| H1 | H2 | H3 |',
      '| --- | --- | --- |',
      '| d | e | f |',
      '| a | b | c |',
    ].join('\n'));
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);

    expect(navigation.selectTableRow(editor.view, 0)).toBe(true);
    expect(navigation.moveTableRowTo(editor.view, 1)).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it('moves a selected column directly across multiple positions in one undo step', () => {
    const editor = createEditor({ element: createHost(), markdown });
    const navigation = createTestTableNavigation(editor);
    setSelectionInsideTableCell(editor, 1, 0);
    expect(navigation.selectTableColumn(editor.view, 0)).toBe(true);
    expect(navigation.moveTableColumnTo(editor.view, 2)).toBe(true);
    expect(editor.getMarkdown()).toBe([
      '| H2 | H3 | H1 |',
      '| --- | --- | --- |',
      '| b | c | a |',
      '| e | f | d |',
    ].join('\n'));
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });
});
