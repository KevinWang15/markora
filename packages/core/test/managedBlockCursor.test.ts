import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import { createEditor } from '../src/createEditor';
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from '../src/managedBlockCursor';
import { createTableNavigation } from '../src/tableNavigation';

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
  }
}

function createHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function findNodeByName(doc: Parameters<typeof createEditor>[0] extends never ? never : any, name: string) {
  let found: { node: any; pos: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === name) {
      found = { node, pos };
      return false;
    }
    return undefined;
  });
  if (!found) {
    throw new Error(`Node ${name} not found`);
  }
  return found;
}

function findSelectionInsideNode(doc: any, nodePos: number, node: any, direction: -1 | 1) {
  const searchPos = direction < 0 ? nodePos + node.nodeSize - 1 : nodePos + 1;
  const selection = Selection.findFrom(doc.resolve(searchPos), direction, true);
  if (!selection) {
    throw new Error('Selection not found inside node');
  }
  return selection;
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

function pressModifiedKey(editor: ReturnType<typeof createEditor>, key: string, modifiers: { shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
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

function dispatchDomKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

function focusCodeMirrorContent(editor: ReturnType<typeof createEditor>) {
  const cmContent = editor.view.dom.querySelector('.cm-content') as HTMLElement | null;
  expect(cmContent).not.toBeNull();
  cmContent!.focus();
  return cmContent!;
}

function textInput(editor: ReturnType<typeof createEditor>, text: string) {
  let handled = false;
  editor.view.someProp('handleTextInput', (handler) => {
    if (handler(editor.view, editor.view.state.selection.from, editor.view.state.selection.to, text)) {
      handled = true;
      return true;
    }
    return undefined;
  });
  return handled;
}

function expectManagedCursor(editor: ReturnType<typeof createEditor>, side: 'before' | 'after', blockPos: number) {
  expect(editor.view.state.selection).toBeInstanceOf(ManagedBlockCursor);
  const selection = editor.view.state.selection as ManagedBlockCursor;
  expect(selection.side).toBe(side);
  expect(selection.blockPos).toBe(blockPos);
}

function countNodes(doc: any, name: string) {
  let count = 0;
  doc.descendants((node: any) => {
    if (node.type.name === name) {
      count += 1;
    }
  });
  return count;
}

function replaceDocument(editor: ReturnType<typeof createEditor>, doc: EditorState['doc']) {
  const nextState = EditorState.create({
    doc,
    plugins: editor.view.state.plugins,
  });

  editor.view.updateState(nextState);
}

function setSelectionInsideTableCell(editor: ReturnType<typeof createEditor>, rowIndex: number, cellIndex: number) {
  let currentRowIndex = -1;
  let currentCellIndex = -1;
  let targetCellPos: number | null = null;

  editor.view.state.doc.descendants((node: any, pos: number) => {
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
  setSelection(editor, selection!);
}

function createTestTableNavigation(editor: ReturnType<typeof createEditor>) {
  const { schema } = editor.view.state;

  return createTableNavigation({
    schema,
    getTableCellContext(state) {
      const { selection } = state;
      const { $from } = selection;
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
    normalizeTableAlignment(value) {
      return value === 'left' || value === 'center' || value === 'right' ? value : null;
    },
    moveBeforeManagedBlock: () => false,
    moveAfterManagedBlock: () => false,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ManagedBlockCursor', () => {
  it('moves to before-edge cursor on ArrowLeft from first table position', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    const selection = findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, 1);
    setSelection(editor, selection);

    expect(pressKey(editor, 'ArrowLeft')).toBe(true);
    expectManagedCursor(editor, 'before', table.pos);
  });

  it('deletes an empty first paragraph before a table on Backspace', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const { schema, plugins, doc } = editor.view.state;
    const existingTable = findNodeByName(doc, 'table');
    const nextState = EditorState.create({
      doc: schema.topNodeType.create(null, [schema.nodes.paragraph.create(), existingTable.node]),
      plugins,
    });
    editor.view.updateState(nextState);

    setSelection(editor, TextSelection.create(editor.view.state.doc, 1));

    expect(pressKey(editor, 'Backspace')).toBe(true);
    expect(editor.view.state.doc.firstChild?.type.name).toBe('table');

    const table = findNodeByName(editor.view.state.doc, 'table');
    expectManagedCursor(editor, 'before', table.pos);
  });

  
  it('moves from code block start to previous paragraph end with one ArrowLeft', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: [
        'Try [links](https://prosemirror.net), `code`, **bold**, *italic*, or start a line with # for a heading.',
        '',
        '```js',
        'const greet = (name) => {',
        '  console.log(`Hello, ${name}!`);',
        '};',
        '```',
      ].join('\n'),
    });

    const paragraph = findNodeByName(editor.view.state.doc, 'paragraph');
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const selection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, 1);
    setSelection(editor, selection);

    dispatchDomKey(focusCodeMirrorContent(editor), 'ArrowLeft');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(paragraph.pos + paragraph.node.nodeSize - 1);
  });

  it('extends selection upward into a top-of-document code block with Shift+ArrowUp', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const paragraph = findNodeByName(editor.view.state.doc, 'paragraph');
    const paragraphStart = paragraph.pos + 1;
    setSelection(editor, TextSelection.create(editor.view.state.doc, paragraphStart));

    expect(pressModifiedKey(editor, 'ArrowUp', { shiftKey: true })).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect((editor.view.state.selection as TextSelection).anchor).toBe(paragraphStart);
    expect((editor.view.state.selection as TextSelection).head).toBe(codeBlock.pos + 1);
  });

  it('extends selection downward into a bottom-of-document code block with Shift+ArrowDown', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['before', '', '```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const paragraph = findNodeByName(editor.view.state.doc, 'paragraph');
    const paragraphEnd = paragraph.pos + paragraph.node.nodeSize - 1;
    setSelection(editor, TextSelection.create(editor.view.state.doc, paragraphEnd));

    expect(pressModifiedKey(editor, 'ArrowDown', { shiftKey: true })).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect((editor.view.state.selection as TextSelection).anchor).toBe(paragraphEnd);
    expect((editor.view.state.selection as TextSelection).head).toBe(codeBlock.pos + codeBlock.node.nodeSize - 1);
  });

  it('moves to after-edge cursor on ArrowRight from last table position', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    const selection = findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, -1);
    setSelection(editor, selection);

    expect(pressKey(editor, 'ArrowRight')).toBe(true);
    expectManagedCursor(editor, 'after', table.pos);
  });

  it('re-enters the table on ArrowRight from before-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, table.pos, 'before', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    expect(pressKey(editor, 'ArrowRight')).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, 1).from);
  });

  it('inserts a paragraph above the table on Enter from before-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, table.pos, 'before', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(editor.view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(1).type.name).toBe('table');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
  });

  it('inserts typed text below the table on after-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, table.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    expect(textInput(editor, 'x')).toBe(true);
    expect(editor.view.state.doc.child(0).type.name).toBe('table');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(1).textContent).toBe('x');
  });

  it('deletes the table on Backspace from after-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, table.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    expect(pressKey(editor, 'Backspace')).toBe(true);
    expect(countNodes(editor.view.state.doc, 'table')).toBe(0);
    expect(editor.view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('deletes the code block on Backspace from after-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, codeBlock.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    expect(pressKey(editor, 'Backspace')).toBe(true);
    expect(countNodes(editor.view.state.doc, 'code_block')).toBe(0);
    expect(editor.view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('inserts a paragraph below the code block on Enter from after-edge cursor even if CodeMirror keeps focus', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, codeBlock.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    dispatchDomKey(focusCodeMirrorContent(editor), 'Enter');

    expect(editor.view.state.doc.child(0).type.name).toBe('code_block');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
  });

  it('removes the active table row from the toolbar', () => {
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

    replaceDocument(editor, schema.topNodeType.create(null, [
      table.create(null, [
        row.create(null, [
          header.create(null, [paragraph.create(null, schema.text('A'))]),
          header.create(null, [paragraph.create(null, schema.text('B'))]),
        ]),
        row.create(null, [
          cell.create(null, [paragraph.create(null, schema.text('one'))]),
          cell.create(null, [paragraph.create(null, schema.text('two'))]),
        ]),
        row.create(null, [
          cell.create(null, [paragraph.create(null, schema.text('three'))]),
          cell.create(null, [paragraph.create(null, schema.text('four'))]),
        ]),
      ]),
    ]));

    setSelectionInsideTableCell(editor, 1, 0);

    const tableNavigation = createTestTableNavigation(editor);
    expect(tableNavigation.removeTableRow(editor.view)).toBe(true);

    const markdown = editor.getMarkdown();
    expect(markdown).toContain('| A | B |');
    expect(markdown).not.toContain('| one | two |');
    expect(markdown).toContain('| three | four |');
  });

  it('removes the active table column from the toolbar', () => {
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

    replaceDocument(editor, schema.topNodeType.create(null, [
      table.create(null, [
        row.create(null, [
          header.create(null, [paragraph.create(null, schema.text('A'))]),
          header.create(null, [paragraph.create(null, schema.text('B'))]),
        ]),
        row.create(null, [
          cell.create(null, [paragraph.create(null, schema.text('one'))]),
          cell.create(null, [paragraph.create(null, schema.text('two'))]),
        ]),
      ]),
    ]));

    setSelectionInsideTableCell(editor, 1, 0);

    const tableNavigation = createTestTableNavigation(editor);
    expect(tableNavigation.removeTableColumn(editor.view)).toBe(true);

    const markdown = editor.getMarkdown();
    expect(markdown).toContain('| B |');
    expect(markdown).toContain('| --- |');
    expect(markdown).toContain('| two |');
    expect(markdown).not.toContain('| A | B |');
  });

  it('moves directly below the code block on ArrowDown from the last line', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    setSelection(editor, codeEndSelection);

    dispatchDomKey(focusCodeMirrorContent(editor), 'ArrowDown');

    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection).not.toBeInstanceOf(ManagedBlockCursor);
    expect(editor.view.state.doc.textBetween(editor.view.state.selection.from, editor.view.state.selection.to, '\n', '\n')).toBe('');
    expect(editor.view.state.selection.from).toBeGreaterThan(codeBlock.pos + codeBlock.node.nodeSize);
  });

  it('moves directly above the code block on ArrowUp from the first line', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['before', '', '```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const paragraph = findNodeByName(editor.view.state.doc, 'paragraph');
    const codeStartSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, 1);
    setSelection(editor, codeStartSelection);

    dispatchDomKey(focusCodeMirrorContent(editor), 'ArrowUp');

    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection).not.toBeInstanceOf(ManagedBlockCursor);
    expect(editor.view.state.selection.from).toBe(paragraph.pos + paragraph.node.nodeSize - 1);
  });

  it('unwraps the code block into paragraphs on Backspace at start', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'abc', 'def', '```'].join('\n'),
    });

    setSelection(editor, TextSelection.create(editor.view.state.doc, 2));

    dispatchDomKey(focusCodeMirrorContent(editor), 'Backspace');

    expect(countNodes(editor.view.state.doc, 'code_block')).toBe(0);
    expect(editor.view.state.doc.childCount).toBe(2);
    expect(editor.view.state.doc.child(0).type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(0).textContent).toBe('abc');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(1).textContent).toBe('def');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(1);
  });

});
