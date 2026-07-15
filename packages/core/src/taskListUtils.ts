import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export function createTaskListHelpers(schema: Schema) {
  const taskControlSelector = '[data-mdw-task-control="true"]';

  function getOwnedTaskControl(view: EditorView, event: Event) {
    const target = event.target;
    const ownerWindow = view.dom.ownerDocument.defaultView;

    if (!ownerWindow || !(target instanceof ownerWindow.HTMLElement)) {
      return null;
    }

    const control = target.closest(taskControlSelector);

    return control instanceof ownerWindow.HTMLElement && view.dom.contains(control)
      ? control
      : null;
  }

  function getTaskListItemAtResolvedPos(state: EditorState, resolvedPos: number) {
    const $pos = state.doc.resolve(resolvedPos);

    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);

      if (node.type === schema.nodes.list_item && typeof node.attrs.checked === "boolean") {
        return {
          node,
          pos: $pos.before(depth),
        };
      }
    }

    return null;
  }

  function toggleTaskListItemAtResolvedPos(view: EditorView, resolvedPos: number) {
    if (!view.editable) {
      return false;
    }

    const listItem = getTaskListItemAtResolvedPos(view.state, resolvedPos);

    if (!listItem) {
      return false;
    }

    const tr = view.state.tr.setNodeMarkup(listItem.pos, schema.nodes.list_item, {
      ...listItem.node.attrs,
      checked: !listItem.node.attrs.checked,
    });
    view.dispatch(tr);
    return true;
  }

  function focusTaskControl(
    view: EditorView,
    listItemPos: number,
    shouldFocus?: (listItem: ProseMirrorNode) => boolean,
  ) {
    queueMicrotask(() => {
      if (view.isDestroyed || !view.editable) {
        return;
      }

      const currentListItem = view.state.doc.nodeAt(listItemPos);

      if (!currentListItem || (shouldFocus && !shouldFocus(currentListItem))) {
        return;
      }

      let listItemDom: Node | null = null;

      try {
        listItemDom = view.nodeDOM(listItemPos);
      } catch {
        return;
      }

      const ownerWindow = view.dom.ownerDocument.defaultView;

      if (!(ownerWindow && listItemDom instanceof ownerWindow.HTMLElement)) {
        return;
      }

      const control = listItemDom.querySelector(taskControlSelector);

      if (control instanceof ownerWindow.HTMLElement) {
        control.focus();
      }
    });
  }

  function getTaskListItemForControl(view: EditorView, control: HTMLElement, fallbackPos: number) {
    const ownerWindow = view.dom.ownerDocument.defaultView;
    const listItemElement = control.closest('li[data-task="true"]');

    if (!(ownerWindow && listItemElement instanceof ownerWindow.HTMLElement)) {
      return null;
    }

    let resolvedPos = fallbackPos;

    try {
      resolvedPos = view.posAtDOM(listItemElement, 0);
    } catch {
      resolvedPos = fallbackPos;
    }

    const listItem = getTaskListItemAtResolvedPos(view.state, resolvedPos);
    return listItem ? { ...listItem, resolvedPos } : null;
  }

  function shouldUseNativeTaskControlTab(view: EditorView, event: KeyboardEvent) {
    return event.key === "Tab"
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !!getOwnedTaskControl(view, event);
  }

  function scheduleTaskControlFocusAfterHistoryShortcut(view: EditorView, event: KeyboardEvent) {
    if (!view.editable) {
      return false;
    }

    const key = event.key.toLowerCase();
    const isHistoryShortcut = !event.altKey
      && (event.ctrlKey || event.metaKey)
      && (key === "z" || (key === "y" && !event.shiftKey));

    if (!isHistoryShortcut) {
      return false;
    }

    const control = getOwnedTaskControl(view, event);

    if (!control) {
      return false;
    }

    const listItem = getTaskListItemForControl(view, control, view.state.selection.from);

    if (!listItem) {
      return false;
    }

    // History commands run synchronously later in the same keydown dispatch.
    // Refocus in a microtask so nodeDOM resolves the control rendered by the
    // resulting state, without taking ownership of the shortcut itself.
    const previousChecked = listItem.node.attrs.checked;
    const previousContent = listItem.node.content;
    const previousType = listItem.node.type;
    focusTaskControl(view, listItem.pos, (currentListItem) => (
      currentListItem.type === previousType
      && currentListItem.content.eq(previousContent)
      && typeof currentListItem.attrs.checked === "boolean"
      && currentListItem.attrs.checked !== previousChecked
    ));
    return true;
  }

  function maybeToggleTaskListItem(view: EditorView, pos: number, event: MouseEvent | KeyboardEvent) {
    if (!view.editable) {
      return false;
    }

    const ownerWindow = view.dom.ownerDocument.defaultView;
    const control = getOwnedTaskControl(view, event);

    if (!ownerWindow || !control) {
      return false;
    }

    let shouldRefocusControl = false;

    if (event instanceof ownerWindow.KeyboardEvent) {
      const isActivationKey = event.key === "Enter" || event.key === " " || event.key === "Spacebar";

      if (!isActivationKey || event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }

      event.preventDefault();

      if (event.repeat) {
        return true;
      }

      shouldRefocusControl = true;
    } else if (event instanceof ownerWindow.MouseEvent) {
      if (event.type === "click") {
        if (event.detail !== 0) {
          event.preventDefault();
          return true;
        }

        event.preventDefault();
        shouldRefocusControl = true;
      } else if (
        event.type !== "mousedown"
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
      ) {
        return false;
      } else {
        event.preventDefault();
      }
    } else {
      return false;
    }

    const listItem = getTaskListItemForControl(view, control, pos);

    if (!listItem) {
      return false;
    }

    const handled = toggleTaskListItemAtResolvedPos(view, listItem.resolvedPos);

    if (handled && !view.isDestroyed) {
      if (shouldRefocusControl) {
        focusTaskControl(view, listItem.pos);
      } else {
        view.focus();
      }
    }

    return handled;
  }

  return {
    getTaskListItemAtResolvedPos,
    toggleTaskListItemAtResolvedPos,
    maybeToggleTaskListItem,
    scheduleTaskControlFocusAfterHistoryShortcut,
    shouldUseNativeTaskControlTab,
  };
}
