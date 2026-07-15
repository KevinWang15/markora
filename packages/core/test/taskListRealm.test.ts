import { JSDOM } from 'jsdom';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import { schema } from '../src/markdownCodec';
import { createTaskListHelpers } from '../src/taskListUtils';

describe('task list realm handling', () => {
  it('toggles a task checkbox rendered in the editor host window', () => {
    const foreignWindow = new JSDOM('<!doctype html><html><body></body></html>').window;

    try {
      const viewDom = foreignWindow.document.createElement('div');
      const listItemElement = foreignWindow.document.createElement('li');
      const paragraphElement = foreignWindow.document.createElement('p');
      listItemElement.dataset.task = 'true';
      listItemElement.append(paragraphElement);
      viewDom.append(listItemElement);

      const paragraph = schema.nodes.paragraph.create(null, schema.text('todo'));
      const listItem = schema.nodes.list_item.create({ checked: false }, paragraph);
      const bulletList = schema.nodes.bullet_list.create(null, listItem);
      let state = EditorState.create({
        doc: schema.nodes.doc.create(null, bulletList),
      });
      const focus = vi.fn();
      const view = {
        dom: viewDom,
        get state() {
          return state;
        },
        dispatch(transaction: Transaction) {
          state = state.apply(transaction);
        },
        focus,
        posAtDOM() {
          return 3;
        },
      } as unknown as EditorView;
      const event = new foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
      });
      paragraphElement.dispatchEvent(event);

      expect(paragraphElement).toBeInstanceOf(foreignWindow.HTMLElement);
      expect(paragraphElement).not.toBeInstanceOf(HTMLElement);

      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const handled = maybeToggleTaskListItem(view, 3, event as unknown as MouseEvent);

      expect(handled).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(state.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      foreignWindow.close();
    }
  });
});
