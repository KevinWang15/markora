import { JSDOM } from 'jsdom';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import { schema } from '../src/markdownCodec';
import { createTaskListHelpers } from '../src/taskListUtils';

function createFixture(options: {
  editable?: boolean;
  handoffFocus?: boolean;
  shadow?: boolean;
} = {}) {
  const foreignWindow = new JSDOM('<!doctype html><html><body></body></html>').window;
  const viewDom = foreignWindow.document.createElement('div');
  const listItemElement = foreignWindow.document.createElement('li');
  const control = foreignWindow.document.createElement('button');
  const content = foreignWindow.document.createElement('div');
  const paragraphElement = foreignWindow.document.createElement('p');
  const externalControl = foreignWindow.document.createElement('button');
  const shadowHost = foreignWindow.document.createElement('div');
  const root = options.shadow ? shadowHost.attachShadow({ mode: 'open' }) : foreignWindow.document;
  listItemElement.dataset.task = 'true';
  control.dataset.mdwTaskControl = 'true';
  control.setAttribute('role', 'checkbox');
  control.type = 'button';
  control.disabled = options.editable === false;
  control.tabIndex = options.editable === false ? -1 : 0;
  content.append(paragraphElement);
  listItemElement.append(control, content);
  viewDom.append(listItemElement);
  externalControl.textContent = 'External';
  foreignWindow.document.body.append(externalControl);

  if (options.shadow) {
    foreignWindow.document.body.append(shadowHost);
    root.append(viewDom);
  } else {
    foreignWindow.document.body.append(viewDom);
  }

  const paragraph = schema.nodes.paragraph.create(null, schema.text('todo'));
  const listItem = schema.nodes.list_item.create({ checked: false }, paragraph);
  const bulletList = schema.nodes.bullet_list.create(null, listItem);
  let state = EditorState.create({
    doc: schema.nodes.doc.create(null, bulletList),
  });
  const focus = vi.fn();
  const view = {
    dom: viewDom,
    editable: options.editable ?? true,
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction);

      if (options.handoffFocus) {
        externalControl.focus();
      }
    },
    focus,
    isDestroyed: false,
    posAtDOM() {
      return 3;
    },
  } as unknown as EditorView;

  return {
    control,
    externalControl,
    focus,
    foreignWindow,
    getState: () => state,
    root,
    view,
  };
}

describe('task list realm handling', () => {
  it('leaves native task controls inert in read-only mode while preserving Tab routing', () => {
    const fixture = createFixture({ editable: false });

    try {
      const {
        handleNativeTaskControlKeyDown,
        maybeToggleTaskListItem,
        toggleTaskListItemAtResolvedPos,
      } = createTaskListHelpers(schema);
      const activation = new fixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });
      fixture.control.dispatchEvent(activation);

      expect(fixture.control.disabled).toBe(true);
      expect(maybeToggleTaskListItem(fixture.view, 3, activation as unknown as MouseEvent)).toBe(false);
      expect(activation.defaultPrevented).toBe(false);
      expect(toggleTaskListItemAtResolvedPos(fixture.view, 3)).toBe(false);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(false);
      expect(fixture.focus).not.toHaveBeenCalled();

      const tab = new fixture.foreignWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
      });
      fixture.control.dispatchEvent(tab);
      expect(handleNativeTaskControlKeyDown(fixture.view, tab as unknown as KeyboardEvent)).toBe(true);
      expect(tab.defaultPrevented).toBe(false);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it('toggles on primary mousedown and suppresses the following pointer click', () => {
    const fixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const initialSelection = fixture.getState().selection;
      const mouseDown = new fixture.foreignWindow.MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      fixture.control.dispatchEvent(mouseDown);

      expect(fixture.control).toBeInstanceOf(fixture.foreignWindow.HTMLButtonElement);
      expect(fixture.control).not.toBeInstanceOf(HTMLButtonElement);
      expect(maybeToggleTaskListItem(fixture.view, 3, mouseDown as unknown as MouseEvent)).toBe(true);
      expect(mouseDown.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.getState().selection.eq(initialSelection)).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.control);
      expect(fixture.focus).not.toHaveBeenCalled();

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

  it.each([' ', 'Enter'])('leaves the %j activation key to the native button click', (key) => {
    const fixture = createFixture();

    try {
      const { handleNativeTaskControlKeyDown, maybeToggleTaskListItem } = createTaskListHelpers(schema);
      fixture.control.focus();
      const keyDown = new fixture.foreignWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      });
      fixture.control.dispatchEvent(keyDown);

      expect(handleNativeTaskControlKeyDown(fixture.view, keyDown as unknown as KeyboardEvent)).toBe(true);
      expect(keyDown.defaultPrevented).toBe(false);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(false);

      const nativeClick = new fixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });
      fixture.control.dispatchEvent(nativeClick);
      expect(maybeToggleTaskListItem(fixture.view, 3, nativeClick as unknown as MouseEvent)).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.control);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it.each([' ', 'Enter'])('suppresses repeated %j activation before a native click', (key) => {
    const fixture = createFixture();

    try {
      const { handleNativeTaskControlKeyDown } = createTaskListHelpers(schema);
      const repeated = new fixture.foreignWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        repeat: true,
      });
      fixture.control.dispatchEvent(repeated);

      expect(handleNativeTaskControlKeyDown(fixture.view, repeated as unknown as KeyboardEvent)).toBe(true);
      expect(repeated.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(false);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it('toggles exactly once for an assistive-technology click', () => {
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
      expect(event.defaultPrevented).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.control);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it('does not steal an intervening host focus handoff', () => {
    const fixture = createFixture({ handoffFocus: true });

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      const event = new fixture.foreignWindow.MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      fixture.control.dispatchEvent(event);

      expect(maybeToggleTaskListItem(fixture.view, 3, event as unknown as MouseEvent)).toBe(true);
      expect(fixture.getState().doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      expect(fixture.foreignWindow.document.activeElement).toBe(fixture.externalControl);
    } finally {
      fixture.foreignWindow.close();
    }
  });

  it('preserves capture-phase focus for an AT click but focuses a pointer target', () => {
    const atFixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      atFixture.externalControl.focus();
      const atClick = new atFixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });
      atFixture.control.dispatchEvent(atClick);

      expect(maybeToggleTaskListItem(atFixture.view, 3, atClick as unknown as MouseEvent)).toBe(true);
      expect(atFixture.foreignWindow.document.activeElement).toBe(atFixture.externalControl);
    } finally {
      atFixture.foreignWindow.close();
    }

    const pointerFixture = createFixture();

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      pointerFixture.externalControl.focus();
      const mouseDown = new pointerFixture.foreignWindow.MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      pointerFixture.control.dispatchEvent(mouseDown);

      expect(maybeToggleTaskListItem(pointerFixture.view, 3, mouseDown as unknown as MouseEvent)).toBe(true);
      expect(pointerFixture.foreignWindow.document.activeElement).toBe(pointerFixture.control);
    } finally {
      pointerFixture.foreignWindow.close();
    }
  });

  it('uses root-local focus in a foreign ShadowRoot', () => {
    const fixture = createFixture({ shadow: true });

    try {
      const { maybeToggleTaskListItem } = createTaskListHelpers(schema);
      let handled = false;
      fixture.view.dom.addEventListener('click', (event) => {
        handled = maybeToggleTaskListItem(fixture.view, 3, event as MouseEvent);
      }, { once: true });
      const event = new fixture.foreignWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 0,
      });
      fixture.control.dispatchEvent(event);

      expect(handled).toBe(true);
      expect(fixture.root.activeElement).toBe(fixture.control);
      expect(fixture.foreignWindow.document.activeElement).toBe((fixture.root as ShadowRoot).host);
    } finally {
      fixture.foreignWindow.close();
    }
  });
});
