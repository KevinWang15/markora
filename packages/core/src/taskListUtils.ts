import type { Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type TaskControlFocusIntent = {
  control: HTMLElement;
  documentActiveElement: Element | null;
  root: Document | ShadowRoot;
  rootActiveElement: Element | null;
};

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

  function captureTaskControlFocusIntent(view: EditorView, control: HTMLElement): TaskControlFocusIntent {
    const ownerDocument = view.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const rootNode = control.getRootNode();
    const root = ownerWindow && rootNode instanceof ownerWindow.ShadowRoot
      ? rootNode
      : ownerDocument;

    return {
      control,
      documentActiveElement: ownerDocument.activeElement,
      root,
      rootActiveElement: root.activeElement,
    };
  }

  function focusWasHandedOff(
    view: EditorView,
    intent: TaskControlFocusIntent,
  ) {
    const ownerDocument = view.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const rootActiveElement = intent.root.activeElement;
    const allowedRootElements = new Set<Element | null>([
      null,
      intent.control,
      intent.rootActiveElement,
      ownerDocument.body,
    ]);

    if (
      rootActiveElement?.isConnected
      && !allowedRootElements.has(rootActiveElement)
    ) {
      return true;
    }

    if (!(ownerWindow && intent.root instanceof ownerWindow.ShadowRoot)) {
      return false;
    }

    const documentActiveElement = ownerDocument.activeElement;
    const allowedDocumentElements = new Set<Element | null>([
      null,
      intent.documentActiveElement,
      intent.root.host,
      ownerDocument.body,
    ]);

    return Boolean(
      documentActiveElement?.isConnected
      && !allowedDocumentElements.has(documentActiveElement),
    );
  }

  function hasInitialExternalFocus(view: EditorView, intent: TaskControlFocusIntent) {
    const ownerDocument = view.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const rootActiveElement = intent.rootActiveElement;

    if (
      rootActiveElement?.isConnected
      && rootActiveElement !== ownerDocument.body
      && !view.dom.contains(rootActiveElement)
    ) {
      return true;
    }

    if (!(ownerWindow && intent.root instanceof ownerWindow.ShadowRoot)) {
      return false;
    }

    const documentActiveElement = intent.documentActiveElement;
    return Boolean(
      documentActiveElement?.isConnected
      && documentActiveElement !== ownerDocument.body
      && documentActiveElement !== intent.root.host,
    );
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

  function handleNativeTaskControlKeyDown(view: EditorView, event: KeyboardEvent) {
    if (!getOwnedTaskControl(view, event)) {
      return false;
    }

    if (event.key === "Tab") {
      return !event.altKey && !event.ctrlKey && !event.metaKey;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return false;
    }

    // A real button synthesizes one detail-zero click for Enter or Space.
    // Keep ProseMirror's keymaps out of that native path, and suppress key
    // repeat or modified activation before the browser can synthesize clicks.
    if (
      event.isComposing
      || event.repeat
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      event.preventDefault();
    }

    return true;
  }

  function maybeToggleTaskListItem(view: EditorView, pos: number, event: MouseEvent) {
    if (!view.editable) {
      return false;
    }

    const ownerWindow = view.dom.ownerDocument.defaultView;
    const control = getOwnedTaskControl(view, event);

    if (!ownerWindow || !control) {
      return false;
    }

    if (event instanceof ownerWindow.MouseEvent) {
      if (event.type === "click") {
        if (event.detail !== 0) {
          event.preventDefault();
          return true;
        }

        event.preventDefault();
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

    const focusIntent = captureTaskControlFocusIntent(view, control);
    const preserveInitialHandoff = event.type === "click"
      && event.detail === 0
      && hasInitialExternalFocus(view, focusIntent);
    const handled = toggleTaskListItemAtResolvedPos(view, listItem.resolvedPos);

    if (
      handled
      && !view.isDestroyed
      && view.editable
      && control.isConnected
      && view.dom.contains(control)
      && !preserveInitialHandoff
      && !focusWasHandedOff(view, focusIntent)
    ) {
      control.focus({ preventScroll: true });
    }

    return handled;
  }

  return {
    getTaskListItemAtResolvedPos,
    toggleTaskListItemAtResolvedPos,
    handleNativeTaskControlKeyDown,
    maybeToggleTaskListItem,
  };
}
