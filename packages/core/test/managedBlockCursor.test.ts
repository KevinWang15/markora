import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { EditorView as CodeMirrorView, ViewPlugin } from '@codemirror/view';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import { createEditor as createMarkoraEditor } from '../src/createEditor';
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from '../src/managedBlockCursor';
import { createTableNavigation } from '../src/tableNavigation';
import {
  installControlledIntersectionObservers,
  type ControlledIntersectionObservers,
  waitForCodeBlockState,
} from './codeBlockTestUtils';

const foreignWindows: Array<Window & typeof globalThis> = [];
const editors: Array<ReturnType<typeof createMarkoraEditor>> = [];

function createEditor(options: Parameters<typeof createMarkoraEditor>[0]) {
  const editor = createMarkoraEditor(options);
  editors.push(editor);
  return editor;
}

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

  if (typeof targetWindow.document.elementFromPoint !== 'function') {
    targetWindow.document.elementFromPoint = () => null;
  }

  if (typeof targetWindow.document.execCommand !== 'function') {
    targetWindow.document.execCommand = () => false;
  }
}

installDomStubs();
const intersectionObservers = installControlledIntersectionObservers(window);

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

function pressModifiedKey(editor: ReturnType<typeof createEditor>, key: string, modifiers: KeyboardEventInit = {}) {
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

async function flushAnimationFrames(targetWindow: Window & typeof globalThis = window) {
  await new Promise<void>((resolve) => targetWindow.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => targetWindow.requestAnimationFrame(() => resolve()));
}

function focusCodeMirrorContent(editor: ReturnType<typeof createEditor>) {
  const cmContent = editor.view.dom.querySelector('.cm-content') as HTMLElement | null;
  expect(cmContent).not.toBeNull();
  cmContent!.focus();
  return cmContent!;
}

async function activateCodeMirrorAt(
  editor: ReturnType<typeof createEditor>,
  position: number,
  observers: ControlledIntersectionObservers = intersectionObservers,
) {
  observers.emitAll(true);
  await waitForCodeBlockState(editor, 'active');
  setSelection(editor, TextSelection.create(editor.view.state.doc, position));
  return focusCodeMirrorContent(editor);
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

afterAll(() => intersectionObservers.restore());

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  foreignWindows.splice(0).forEach((targetWindow) => targetWindow.close());
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

  it('uses physical RTL arrows at table boundaries', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| ראשון | שני |', '| --- | --- |', '| א | ב |'].join('\n'),
    });
    const table = findNodeByName(editor.view.state.doc, 'table');
    const tableDom = editor.view.nodeDOM(table.pos) as HTMLElement;
    tableDom.style.direction = 'rtl';

    setSelection(editor, findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, 1));
    expect(pressKey(editor, 'ArrowRight')).toBe(true);
    expectManagedCursor(editor, 'before', table.pos);

    expect(pressKey(editor, 'ArrowLeft')).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(
      findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, 1).from,
    );

    setSelection(editor, findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, -1));
    expect(pressKey(editor, 'ArrowLeft')).toBe(true);
    expectManagedCursor(editor, 'after', table.pos);

    expect(pressKey(editor, 'ArrowRight')).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(
      findSelectionInsideNode(editor.view.state.doc, table.pos, table.node, -1).from,
    );
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

  
  it('moves from code block start to previous paragraph end with one ArrowLeft', async () => {
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
    const cmContent = await activateCodeMirrorAt(editor, selection.from);

    dispatchDomKey(cmContent, 'ArrowLeft');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(paragraph.pos + paragraph.node.nodeSize - 1);
    editor.destroy();
  });

  it('uses physical RTL arrows at active code-block boundaries', async () => {
    let codeMirrorView: CodeMirrorView | null = null;
    const editor = createEditor({
      codeBlockLanguages: {
        rtl: async () => ViewPlugin.define((view) => {
          codeMirrorView = view;
          return {};
        }),
      },
      element: createHost(),
      markdown: ['```rtl', 'אבג', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeBlockDom = editor.view.nodeDOM(codeBlock.pos) as HTMLElement;
    codeBlockDom.style.direction = 'rtl';
    const cmContent = await activateCodeMirrorAt(editor, codeBlock.pos + 1);

    await vi.waitFor(() => expect(codeMirrorView).not.toBeNull());
    cmContent.style.direction = 'rtl';
    (codeMirrorView as CodeMirrorView).requestMeasure();
    await flushAnimationFrames();
    expect(getComputedStyle(cmContent).direction).toBe('rtl');
    dispatchDomKey(cmContent, 'ArrowRight');
    expectManagedCursor(editor, 'before', codeBlock.pos);

    (editor.view.nodeDOM(codeBlock.pos) as HTMLElement).style.direction = 'rtl';
    expect(pressKey(editor, 'ArrowLeft')).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);

    const capturedView = codeMirrorView as CodeMirrorView;
    capturedView.dispatch({
      selection: { anchor: capturedView.state.doc.length },
    });
    focusCodeMirrorContent(editor);
    dispatchDomKey(cmContent, 'ArrowLeft');
    expectManagedCursor(editor, 'after', codeBlock.pos);
  });

  it('claims the outer selection when a code block is clicked from another block', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['before', '', '```js', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const staticContent = editor.view.dom.querySelector('.mdw-code-block-static-code') as HTMLElement | null;

    expect(staticContent).not.toBeNull();
    expect(editor.view.state.selection.from).toBeLessThan(codeBlock.pos);

    staticContent!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    staticContent!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    staticContent!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitForCodeBlockState(editor, 'active');
    const cmContent = editor.view.dom.querySelector('.cm-content') as HTMLElement | null;
    expect(cmContent).not.toBeNull();
    cmContent!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(editor.view.state.selection.from).toBeGreaterThanOrEqual(codeBlock.pos + 1);
    expect(editor.view.state.selection.to).toBeLessThanOrEqual(codeBlock.pos + codeBlock.node.nodeSize - 1);
    editor.destroy();
  });

  it('forwards an edit after CodeMirror receives focus from a managed boundary', async () => {
    let codeMirrorView: CodeMirrorView | null = null;
    const editor = createEditor({
      codeBlockLanguages: {
        captured: async () => ViewPlugin.define((view) => {
          codeMirrorView = view;
          return {};
        }),
      },
      element: createHost(),
      markdown: ['```captured', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    editor.focus({ anchor: codeBlock.pos + 1, head: codeBlock.pos + 1 });

    await waitForCodeBlockState(editor, 'active');
    await vi.waitFor(() => expect(codeMirrorView).not.toBeNull());

    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      codeBlock.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);
    focusCodeMirrorContent(editor);

    expect(codeMirrorView).not.toBeNull();
    const capturedView = codeMirrorView as CodeMirrorView;
    capturedView.dispatch({
      changes: {
        from: capturedView.state.doc.length,
        insert: '!',
      },
    });

    expect(editor.getMarkdown()).toContain('const a = 1;!');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    editor.destroy();
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

  it('does not delete managed blocks for modified deletion keys', () => {
    const beforeEditor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });
    const beforeTable = findNodeByName(beforeEditor.view.state.doc, 'table');
    setSelection(beforeEditor, ManagedBlockCursor.create(
      beforeEditor.view.state.doc,
      beforeTable.pos,
      'before',
      (node) => isManagedBlockNodeFromSchema(beforeEditor.view.state.schema, node),
    )!);
    pressModifiedKey(beforeEditor, 'Delete', { ctrlKey: true });
    expect(countNodes(beforeEditor.view.state.doc, 'table')).toBe(1);

    const afterEditor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });
    const afterTable = findNodeByName(afterEditor.view.state.doc, 'table');
    setSelection(afterEditor, ManagedBlockCursor.create(
      afterEditor.view.state.doc,
      afterTable.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(afterEditor.view.state.schema, node),
    )!);
    pressModifiedKey(afterEditor, 'Backspace', { ctrlKey: true });
    expect(countNodes(afterEditor.view.state.doc, 'table')).toBe(1);
  });

  it.each(['before', 'after'] as const)(
    'materializes an editable paragraph on compositionstart at the %s-edge cursor',
    async (side) => {
      const editor = createEditor({
        element: createHost(),
        markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
      });
      const table = findNodeByName(editor.view.state.doc, 'table');
      setSelection(editor, ManagedBlockCursor.create(
        editor.view.state.doc,
        table.pos,
        side,
        (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
      )!);

      const event = new CompositionEvent('compositionstart', {
        bubbles: true,
        cancelable: true,
        data: '你',
      });
      editor.view.dom.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.view.state.selection.empty).toBe(true);
      expect(editor.view.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(editor.view.state.selection.$from.parent.textContent).toBe('');
      expect(editor.view.state.doc.child(side === 'before' ? 0 : 1).type.name).toBe('paragraph');
      expect(editor.view.state.doc.child(side === 'before' ? 1 : 0).type.name).toBe('table');

      editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '你',
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      editor.destroy();
    },
  );

  it('does not query debug-only cursor selectors when debug logging is disabled', () => {
    const selectors: string[] = [];
    const originalQuerySelector = Element.prototype.querySelector;
    let editor: ReturnType<typeof createEditor> | null = null;

    Element.prototype.querySelector = function patchedQuerySelector(this: Element, selector: string) {
      selectors.push(selector);
      return originalQuerySelector.call(this, selector);
    };

    try {
      editor = createEditor({
        element: createHost(),
        markdown: ['```js', 'const a = 1;', '```'].join('\n'),
      });

      const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
      setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, codeBlock.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

      expect(selectors.filter((selector) => (
        selector === '.cm-cursorLayer'
        || selector === '.cm-cursor'
        || selector === '.mdw-managed-block-cursor'
      ))).toEqual([]);
    } finally {
      Element.prototype.querySelector = originalQuerySelector;
      editor?.destroy();
    }
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

  it('uses the owner window for managed-mutation focus and ignores a destroyed view', () => {
    const foreignWindow = createForeignWindow();
    let scheduledFrame: FrameRequestCallback | null = null;
    foreignWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    }) as typeof requestAnimationFrame;
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });
    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      table.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);
    scheduledFrame = null;

    expect(textInput(editor, 'x')).toBe(true);
    expect(scheduledFrame).not.toBeNull();

    let focusCalls = 0;
    editor.view.focus = () => {
      focusCalls += 1;
    };
    editor.destroy();
    (scheduledFrame as FrameRequestCallback)(0);

    expect(focusCalls).toBe(0);
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

  it.each([
    ['table', ['| A | B |', '| --- | --- |', '| a | b |'].join('\n')],
    ['code_block', ['```js', 'const a = 1;', '```'].join('\n')],
  ] as const)('deletes the %s on Delete from before-edge cursor', (nodeName, markdown) => {
    const editor = createEditor({
      element: createHost(),
      markdown,
    });

    const managedBlock = findNodeByName(editor.view.state.doc, nodeName);
    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      managedBlock.pos,
      'before',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);

    expect(pressKey(editor, 'Delete')).toBe(true);
    expect(countNodes(editor.view.state.doc, nodeName)).toBe(0);
    expect(editor.view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('inserts a paragraph after a managed block on Delete from after-edge cursor', () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['| A | B |', '| --- | --- |', '| a | b |'].join('\n'),
    });

    const table = findNodeByName(editor.view.state.doc, 'table');
    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      table.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);

    expect(pressKey(editor, 'Delete')).toBe(true);
    expect(editor.view.state.doc.child(0).type.name).toBe('table');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
  });

  it('inserts a paragraph below the code block on Enter from after-edge cursor even if CodeMirror keeps focus', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const cmContent = await activateCodeMirrorAt(editor, codeBlock.pos + 1);
    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, codeBlock.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    cmContent.focus();
    dispatchDomKey(cmContent, 'Enter');

    expect(editor.view.state.doc.child(0).type.name).toBe('code_block');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    editor.destroy();
  });

  it('moves focus out of CodeMirror for managed cursors in a foreign window', async () => {
    const foreignWindow = createForeignWindow();
    const foreignIntersectionObservers = installControlledIntersectionObservers(foreignWindow);
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const cmContent = await activateCodeMirrorAt(
      editor,
      codeBlock.pos + 1,
      foreignIntersectionObservers,
    );

    expect(
      foreignWindow.document.activeElement &&
      (foreignWindow.document.activeElement === cmContent || cmContent.contains(foreignWindow.document.activeElement))
    ).toBe(true);

    setSelection(editor, ManagedBlockCursor.create(editor.view.state.doc, codeBlock.pos, 'after', (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node))!);

    await Promise.resolve();

    const activeElement = foreignWindow.document.activeElement as HTMLElement | null;

    expect(activeElement).not.toBeNull();
    expect(activeElement).not.toBe(cmContent);
    expect(activeElement?.closest('.cm-editor')).toBeNull();
    editor.destroy();
    foreignIntersectionObservers.restore();
  });

  it('preserves a host focus handoff before managed-cursor focus synchronization', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    await activateCodeMirrorAt(editor, codeBlock.pos + 1);
    const hostControl = document.createElement('button');
    hostControl.type = 'button';
    document.body.append(hostControl);
    editor.subscribe('selection', () => hostControl.focus());

    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      codeBlock.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);

    expect(document.activeElement).toBe(hostControl);
    await Promise.resolve();
    expect(document.activeElement).toBe(hostControl);
  });

  it('moves focus out of CodeMirror for a managed cursor in a shadow root', async () => {
    const shadowHost = document.createElement('div');
    document.body.append(shadowHost);
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const editorElement = document.createElement('div');
    shadowRoot.append(editorElement);
    const editor = createEditor({
      element: editorElement,
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const cmContent = await activateCodeMirrorAt(editor, codeBlock.pos + 1);
    let shadowActiveElement: Element | null = cmContent;
    Object.defineProperty(shadowRoot, 'activeElement', {
      configurable: true,
      get: () => shadowActiveElement,
    });
    Object.defineProperty(cmContent, 'blur', {
      configurable: true,
      value: () => {
        if (shadowActiveElement === cmContent) {
          shadowActiveElement = null;
        }
      },
    });
    Object.defineProperty(editor.view.dom, 'focus', {
      configurable: true,
      value: () => {
        shadowActiveElement = editor.view.dom;
      },
    });

    setSelection(editor, ManagedBlockCursor.create(
      editor.view.state.doc,
      codeBlock.pos,
      'after',
      (node) => isManagedBlockNodeFromSchema(editor.view.state.schema, node),
    )!);

    await Promise.resolve();
    expect(shadowRoot.activeElement).toBe(editor.view.dom);
  });

  it('recognizes adopted CodeMirror event targets without relying on the owner-window realm', async () => {
    const foreignWindow = createForeignWindow();
    const foreignIntersectionObservers = installControlledIntersectionObservers(foreignWindow);
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const cmContent = await activateCodeMirrorAt(
      editor,
      codeBlock.pos + 1,
      foreignIntersectionObservers,
    );
    const adoptedTarget = document.createElement('span');
    adoptedTarget.textContent = 'adopted target';
    cmContent.append(adoptedTarget);

    expect(adoptedTarget.ownerDocument).toBe(foreignWindow.document);
    expect(adoptedTarget).toBeInstanceOf(window.Node);
    expect(adoptedTarget).not.toBeInstanceOf(foreignWindow.Node);

    const outerMouseDown = vi.fn(() => false);
    editor.view.setProps({
      handleDOMEvents: {
        mousedown: outerMouseDown,
      },
    });
    adoptedTarget.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    }));

    expect(outerMouseDown).not.toHaveBeenCalled();

    const queueMicrotask = vi.fn<(callback: VoidFunction) => void>();
    foreignWindow.queueMicrotask = queueMicrotask;
    const delegatedTarget = document.createElement('span');
    editor.view.dom.querySelector('.mdw-code-block-static-gutter')!.append(delegatedTarget);

    expect(delegatedTarget.ownerDocument).toBe(foreignWindow.document);
    expect(delegatedTarget).not.toBeInstanceOf(foreignWindow.Node);

    delegatedTarget.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    // One task comes from the editor's composite blur tracker and one from the
    // code-block manager's delegated activity tracker.
    expect(queueMicrotask).toHaveBeenCalledTimes(2);

    queueMicrotask.mockClear();
    delegatedTarget.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

    expect(queueMicrotask).toHaveBeenCalledTimes(1);
    editor.destroy();
    foreignIntersectionObservers.restore();
  });

  it('keeps adopted CodeMirror focus inside the composite boundary and blurs it through the public API', async () => {
    const foreignWindow = createForeignWindow();
    const foreignIntersectionObservers = installControlledIntersectionObservers(foreignWindow);
    const editor = createEditor({
      element: createHost(foreignWindow.document),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });
    const blurEvents = vi.fn();
    editor.subscribe('blur', blurEvents);
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const cmContent = await activateCodeMirrorAt(
      editor,
      codeBlock.pos + 1,
      foreignIntersectionObservers,
    );
    await Promise.resolve();

    const adoptedControl = document.createElement('button');
    adoptedControl.type = 'button';
    editor.view.dom.querySelector('.cm-editor')!.append(adoptedControl);

    expect(adoptedControl.ownerDocument).toBe(foreignWindow.document);
    expect(adoptedControl).not.toBeInstanceOf(foreignWindow.HTMLElement);

    adoptedControl.focus();
    await Promise.resolve();

    expect(foreignWindow.document.activeElement).toBe(adoptedControl);
    expect(blurEvents).not.toHaveBeenCalled();

    // Exercise the containment check after the corresponding focusin has
    // already settled; an adopted active element must still be considered
    // part of the editor without an owner-realm instanceof guard.
    cmContent.dispatchEvent(new foreignWindow.FocusEvent('focusout', {
      bubbles: true,
      relatedTarget: adoptedControl,
    }));
    await Promise.resolve();

    expect(foreignWindow.document.activeElement).toBe(adoptedControl);
    expect(blurEvents).not.toHaveBeenCalled();

    editor.blur();
    await Promise.resolve();

    expect(foreignWindow.document.activeElement).not.toBe(adoptedControl);
    expect(editor.view.dom.contains(foreignWindow.document.activeElement)).toBe(false);
    expect(blurEvents).toHaveBeenCalledTimes(1);
    editor.destroy();
    foreignIntersectionObservers.restore();
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

  it('moves directly below the code block on ArrowDown from the last line', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    const cmContent = await activateCodeMirrorAt(editor, codeEndSelection.from);

    dispatchDomKey(cmContent, 'ArrowDown');

    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection).not.toBeInstanceOf(ManagedBlockCursor);
    expect(editor.view.state.doc.textBetween(editor.view.state.selection.from, editor.view.state.selection.to, '\n', '\n')).toBe('');
    expect(editor.view.state.selection.from).toBeGreaterThan(codeBlock.pos + codeBlock.node.nodeSize);
    await flushAnimationFrames();
    expect(document.activeElement).toBe(editor.view.dom);
    editor.destroy();
  });

  it('preserves a host focus handoff while completing a code-block exit', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    const cmContent = await activateCodeMirrorAt(editor, codeEndSelection.from);
    const hostControl = document.createElement('button');
    hostControl.type = 'button';
    document.body.append(hostControl);
    editor.subscribe('selection', () => hostControl.focus());

    dispatchDomKey(cmContent, 'ArrowDown');

    expect(document.activeElement).toBe(hostControl);
    await flushAnimationFrames();
    expect(document.activeElement).toBe(hostControl);
  });

  it('preserves a focusout-driven host handoff while leaving a code block', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    const cmContent = await activateCodeMirrorAt(editor, codeEndSelection.from);
    const hostControl = document.createElement('button');
    hostControl.type = 'button';
    document.body.append(hostControl);
    cmContent.addEventListener('focusout', () => hostControl.focus(), { once: true });

    dispatchDomKey(cmContent, 'ArrowDown');

    await flushAnimationFrames();
    expect(document.activeElement).toBe(hostControl);
  });

  it('preserves a public blur while completing a code-block exit', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    const cmContent = await activateCodeMirrorAt(editor, codeEndSelection.from);
    editor.subscribe('selection', () => editor.blur());

    dispatchDomKey(cmContent, 'ArrowDown');

    await flushAnimationFrames();
    expect(editor.view.dom.contains(document.activeElement)).toBe(false);
  });

  it('completes a code-block exit inside a shadow root', async () => {
    const shadowHost = document.createElement('div');
    document.body.append(shadowHost);
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const editorElement = document.createElement('div');
    shadowRoot.append(editorElement);
    const editor = createEditor({
      element: editorElement,
      markdown: ['```js', 'const a = 1;', '```', '', 'after'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const codeEndSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, -1);
    const cmContent = await activateCodeMirrorAt(editor, codeEndSelection.from);
    let shadowActiveElement: Element | null = cmContent;
    Object.defineProperty(shadowRoot, 'activeElement', {
      configurable: true,
      get: () => shadowActiveElement,
    });
    Object.defineProperty(cmContent, 'blur', {
      configurable: true,
      value: () => {
        if (shadowActiveElement === cmContent) {
          shadowActiveElement = null;
        }
      },
    });
    Object.defineProperty(editor.view.dom, 'focus', {
      configurable: true,
      value: () => {
        shadowActiveElement = editor.view.dom;
      },
    });

    dispatchDomKey(cmContent, 'ArrowDown');

    await flushAnimationFrames();
    expect(shadowRoot.activeElement).toBe(editor.view.dom);
  });

  it('preserves a host focus handoff from an outer-history subscriber', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'const a = 1;', '```'].join('\n'),
    });
    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const insertPos = codeBlock.pos + codeBlock.node.nodeSize - 1;
    const cmContent = await activateCodeMirrorAt(editor, insertPos);
    editor.view.dispatch(editor.view.state.tr.insertText('!', insertPos));
    const hostControl = document.createElement('button');
    hostControl.type = 'button';
    document.body.append(hostControl);
    editor.subscribe('update', () => hostControl.focus());
    const isMac = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform);

    cmContent.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: !isMac,
      metaKey: isMac,
    }));

    expect(editor.getMarkdown()).not.toContain('const a = 1;!');
    expect(document.activeElement).toBe(hostControl);
  });

  it('moves directly above the code block on ArrowUp from the first line', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['before', '', '```js', 'const a = 1;', '```'].join('\n'),
    });

    const codeBlock = findNodeByName(editor.view.state.doc, 'code_block');
    const paragraph = findNodeByName(editor.view.state.doc, 'paragraph');
    const codeStartSelection = findSelectionInsideNode(editor.view.state.doc, codeBlock.pos, codeBlock.node, 1);
    const cmContent = await activateCodeMirrorAt(editor, codeStartSelection.from);

    dispatchDomKey(cmContent, 'ArrowUp');

    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection).not.toBeInstanceOf(ManagedBlockCursor);
    expect(editor.view.state.selection.from).toBe(paragraph.pos + paragraph.node.nodeSize - 1);
    editor.destroy();
  });

  it('unwraps the code block into paragraphs on Backspace at start', async () => {
    const editor = createEditor({
      element: createHost(),
      markdown: ['```js', 'abc', 'def', '```'].join('\n'),
    });

    const cmContent = await activateCodeMirrorAt(editor, 2);

    dispatchDomKey(cmContent, 'Backspace');

    expect(countNodes(editor.view.state.doc, 'code_block')).toBe(0);
    expect(editor.view.state.doc.childCount).toBe(2);
    expect(editor.view.state.doc.child(0).type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(0).textContent).toBe('abc');
    expect(editor.view.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.view.state.doc.child(1).textContent).toBe('def');
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.state.selection.from).toBe(1);
    await flushAnimationFrames();
    expect(document.activeElement).toBe(editor.view.dom);
    editor.destroy();
  });

});
