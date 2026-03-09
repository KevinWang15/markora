import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export function createTaskListHelpers(schema: Schema) {
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

  function maybeToggleTaskListItem(view: EditorView, pos: number, event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof HTMLElement) || event.metaKey || event.ctrlKey) {
      return false;
    }

    const listItemElement = target.closest('li[data-task="true"]');

    if (!(listItemElement instanceof HTMLElement)) {
      return false;
    }

    const paragraph = listItemElement.querySelector(":scope > p");
    const contentLeft = paragraph instanceof HTMLElement ? paragraph.getBoundingClientRect().left : listItemElement.getBoundingClientRect().left;
    const checkboxZoneLeft = contentLeft - 32;
    const checkboxZoneRight = contentLeft + 8;

    if (event.clientX < checkboxZoneLeft || event.clientX > checkboxZoneRight) {
      return false;
    }

    let resolvedPos = pos;

    try {
      resolvedPos = view.posAtDOM(listItemElement, 0);
    } catch {
      resolvedPos = pos;
    }

    event.preventDefault();
    const handled = toggleTaskListItemAtResolvedPos(view, resolvedPos);

    if (handled) {
      view.focus();
    }

    return handled;
  }

  return {
    getTaskListItemAtResolvedPos,
    toggleTaskListItemAtResolvedPos,
    maybeToggleTaskListItem,
  };
}
