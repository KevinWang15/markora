import { JSDOM } from 'jsdom';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import { schema } from '../src/markdownCodec';
import { createTaskListHelpers } from '../src/taskListUtils';

function createFixture() {
  const foreignWindow = new JSDOM('<!doctype html><html><body></body></html>').window;
  const viewDom = foreignWindow.document.createElement('div');
  const listItemElement = foreignWindow.document.createElement('li');
  const control = foreignWindow.document.createElement('span');
  const content = foreignWindow.document.createElement('div');
  const paragraphElement = foreignWindow.document.createElement('p');
  listItemElement.dataset.task = 'true';
  control.dataset.mdwTaskControl = 'true';
  control.setAttribute('role', 'checkbox');
  control.tabIndex = 0;
  content.append(paragraphElement);
  listItemElement.append(control, content);
  viewDom.append(listItemElement);
  foreignWindow.document.body.append(viewDom);

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
    isDestroyed: false,
    nodeDOM() {
      return listItemElement;
    },
    posAtDOM() {
      return 3;
    },
  } as unknown as EditorView;

  return {
    control,
    focus,
    foreignWindow,
    getState: () => state,
    view,
  };
}

describe('task list realm handling', () => {
  it('toggles on primary mousedown and suppresses the following pointer click', () => {
    const fixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const mouseDown = new fixture.foreignWindow.MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      fixture.control.dispatchEvent(mouseDown);

      expect(fixture.control).toBeInstanceOf(fixture.foreignWindow.HTMLElement);
      expect(fixture.control).not.toBeInstanceOf(HTMLElement);
      expect(maybeToggleTaskListItem(fixture.view, 3, mouseDown as unknown as MouseEvent)).toBe(true);
      expect(mouseDown.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.focus).toHaveBeenCalledOnce();

      const pointerClick = new fixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });
      fixture.control.dispatchEvent(pointerClick);

      expect(maybeToggleTaskListItem(fixture.view, 3, pointerClick as unknown as MouseEvent)).toBe(true);
      expect(pointerClick.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it.each([' ', 'Enter'])('toggles with the %j keyboard activation key and keeps control focus', async (key) => {
    const fixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const event = new fixture.foreignWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      });
      fixture.control.dispatchEvent(event);

      expect(maybeToggleTaskListItem(fixture.view, 3, event as unknown as KeyboardEvent)).toBe(true);
      await Promise.resolve();

      expect(event.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.control);
      expect(fixture.focus).not.toHaveBeenCalled();
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it('toggles exactly once for an assistive-technology click', async () => {
    const fixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const event = new fixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });
      fixture.control.dispatchEvent(event);

      expect(maybeToggleTaskListItem(fixture.view, 3, event as unknown as MouseEvent)).toBe(true);
      await Promise.resolve();

      expect(event.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.control);
      expect(fixture.focus).not.toHaveBeenCalled();
    } finally {
      fixture.foreignWindow.close();
    }
  });
});
