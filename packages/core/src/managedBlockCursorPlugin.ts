import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { ManagedBlockCursor, type ManagedBlockBoundary, type BoundarySide } from "./managedBlockCursor";

function debugManagedBlockCursor(..._args: unknown[]) {
}

function logManagedBlockCursor(view: EditorView, phase: string) {
  const selection = view.state.selection;
  const cmCursorLayer = view.dom.querySelector(".cm-cursorLayer");
  const cmCursor = view.dom.querySelector(".cm-cursor");
  const managedNode = view.dom.querySelector(".mdw-managed-block-cursor");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
    phase,
    selectionType: selection.constructor.name,
    from: selection.from,
    to: selection.to,
    isManagedBlockCursor: selection instanceof ManagedBlockCursor,
    editorClasses: Array.from(view.dom.classList),
    activeElement: activeElement ? {
      tag: activeElement.tagName,
      className: activeElement.className,
      contentEditable: activeElement.getAttribute("contenteditable"),
    } : null,
    cmCursorLayer: cmCursorLayer instanceof HTMLElement ? {
      className: cmCursorLayer.className,
      childCount: cmCursorLayer.childElementCount,
    } : null,
    cmCursor: cmCursor instanceof HTMLElement ? {
      className: cmCursor.className,
      style: cmCursor.getAttribute("style"),
    } : null,
    managedNode: managedNode instanceof HTMLElement ? {
      tag: managedNode.tagName,
      className: managedNode.className,
    } : null,
  }));
}

function focusOuterViewForManagedCursor(view: EditorView) {
  const activeElement = document.activeElement;

  debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
    phase: "focus-sync:start",
    selectionType: view.state.selection.constructor.name,
    from: view.state.selection.from,
    to: view.state.selection.to,
    activeElement: activeElement instanceof HTMLElement ? {
      tag: activeElement.tagName,
      className: activeElement.className,
      contentEditable: activeElement.getAttribute("contenteditable"),
      inEditor: view.dom.contains(activeElement),
      inCodeMirror: !!activeElement.closest(".cm-editor"),
    } : null,
  }));

  if (!(activeElement instanceof HTMLElement) || !view.dom.contains(activeElement)) {
    return;
  }

  if (!activeElement.closest(".cm-editor")) {
    return;
  }

  queueMicrotask(() => {
    debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
      phase: "focus-sync:microtask:before",
      selectionType: view.state.selection.constructor.name,
      from: view.state.selection.from,
      to: view.state.selection.to,
      activeElement: document.activeElement instanceof HTMLElement ? {
        tag: document.activeElement.tagName,
        className: document.activeElement.className,
        contentEditable: document.activeElement.getAttribute("contenteditable"),
        inEditor: view.dom.contains(document.activeElement),
        inCodeMirror: !!document.activeElement.closest(".cm-editor"),
      } : null,
    }));

    if (!(view.state.selection instanceof ManagedBlockCursor)) {
      return;
    }

    if (document.activeElement instanceof HTMLElement && view.dom.contains(document.activeElement) && document.activeElement.closest(".cm-editor")) {
      document.activeElement.blur();
    }

    view.dom.focus();

    debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
      phase: "focus-sync:microtask:after",
      selectionType: view.state.selection.constructor.name,
      from: view.state.selection.from,
      to: view.state.selection.to,
      activeElement: document.activeElement instanceof HTMLElement ? {
        tag: document.activeElement.tagName,
        className: document.activeElement.className,
        contentEditable: document.activeElement.getAttribute("contenteditable"),
        inEditor: view.dom.contains(document.activeElement),
        inCodeMirror: !!document.activeElement.closest(".cm-editor"),
      } : null,
    }));
  });
}

export type CreateManagedBlockBoundaryPluginOptions = {
  isManagedBlockNode: (node: Parameters<typeof ManagedBlockCursor.create>[3] extends infer T ? T extends (...args: any[]) => any ? Parameters<T>[0] : never : never) => boolean;
  getTableBoundaryEscapeInfo: (state: EditorView["state"], side: BoundarySide) => { tablePos: number } | null;
  moveBeforeManagedBlock: (view: EditorView, blockPos: number) => boolean;
  setManagedBlockBoundarySelection: (view: EditorView, blockPos: number, side: BoundarySide) => boolean;
  getManagedBlockBoundary: (state: EditorView["state"]) => ManagedBlockBoundary | null;
  moveInsideManagedBlock: (view: EditorView, boundary: ManagedBlockBoundary) => boolean;
  insertParagraphAtManagedBlockBoundary: (view: EditorView, boundary: ManagedBlockBoundary, text?: string) => boolean;
  removeManagedBlockAtBoundary: (view: EditorView, boundary: ManagedBlockBoundary) => boolean;
};

export function createManagedBlockBoundaryPlugin(options: CreateManagedBlockBoundaryPluginOptions) {
  const handleManagedBlockKeyDown = (view: EditorView, event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      const tableInfo = options.getTableBoundaryEscapeInfo(view.state, "before");

      if (tableInfo) {
        const handled = options.moveBeforeManagedBlock(view, tableInfo.tablePos);

        if (handled) {
          event.preventDefault();
        }

        return handled;
      }
    }

    if (event.key === "ArrowRight") {
      const tableInfo = options.getTableBoundaryEscapeInfo(view.state, "after");

      if (tableInfo) {
        const handled = options.setManagedBlockBoundarySelection(view, tableInfo.tablePos, "after");

        if (handled) {
          event.preventDefault();
        }

        return handled;
      }
    }

    const boundary = options.getManagedBlockBoundary(view.state);

    if (!boundary) {
      return false;
    }

    if (event.key === "ArrowLeft" && boundary.side === "after") {
      const handled = options.moveInsideManagedBlock(view, boundary);

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    if (event.key === "ArrowRight" && boundary.side === "before") {
      const handled = options.moveInsideManagedBlock(view, boundary);

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    if (event.key === "Enter") {
      debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
        phase: "handleKeyDown:enter",
        selectionType: view.state.selection.constructor.name,
        from: view.state.selection.from,
        to: view.state.selection.to,
        boundarySide: boundary.side,
        activeElement: document.activeElement instanceof HTMLElement ? {
          tag: document.activeElement.tagName,
          className: document.activeElement.className,
          contentEditable: document.activeElement.getAttribute("contenteditable"),
          inEditor: view.dom.contains(document.activeElement),
          inCodeMirror: !!document.activeElement.closest(".cm-editor"),
        } : null,
      }));

      const handled = options.insertParagraphAtManagedBlockBoundary(view, boundary);

      debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
        phase: "handleKeyDown:enter:after",
        handled,
        selectionType: view.state.selection.constructor.name,
        from: view.state.selection.from,
        to: view.state.selection.to,
        activeElement: document.activeElement instanceof HTMLElement ? {
          tag: document.activeElement.tagName,
          className: document.activeElement.className,
          contentEditable: document.activeElement.getAttribute("contenteditable"),
          inEditor: view.dom.contains(document.activeElement),
          inCodeMirror: !!document.activeElement.closest(".cm-editor"),
        } : null,
      }));

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    if (event.key === "Backspace") {
      const handled = boundary.side === "after"
        ? options.removeManagedBlockAtBoundary(view, boundary)
        : options.insertParagraphAtManagedBlockBoundary(view, boundary);

      if (handled) {
        event.preventDefault();
      }

      return handled;
    }

    return false;
  };

  return new Plugin({
    props: {
      decorations(state) {
        const selection = state.selection;

        if (!(selection instanceof ManagedBlockCursor)) {
          return null;
        }

        const block = state.doc.nodeAt(selection.blockPos);

        if (!block || !options.isManagedBlockNode(block)) {
          return null;
        }

        return DecorationSet.create(state.doc, [
          Decoration.node(selection.blockPos, selection.blockPos + block.nodeSize, {
            class: `mdw-managed-block-cursor mdw-managed-block-cursor-${selection.side}`,
          }),
        ]);
      },
      handleKeyDown(view, event) {
        debugManagedBlockCursor("[managed-block-debug]", JSON.stringify({
          phase: "handleKeyDown:start",
          key: event.key,
          selectionType: view.state.selection.constructor.name,
          from: view.state.selection.from,
          to: view.state.selection.to,
          activeElement: document.activeElement instanceof HTMLElement ? {
            tag: document.activeElement.tagName,
            className: document.activeElement.className,
            contentEditable: document.activeElement.getAttribute("contenteditable"),
            inEditor: view.dom.contains(document.activeElement),
            inCodeMirror: !!document.activeElement.closest(".cm-editor"),
          } : null,
        }));

        return handleManagedBlockKeyDown(view, event);
      },
      handleTextInput(view, _from, _to, text) {
        const boundary = options.getManagedBlockBoundary(view.state);

        if (!boundary) {
          return false;
        }

        return options.insertParagraphAtManagedBlockBoundary(view, boundary, text);
      },
    },
    view(editorView) {
      const className = "mdw-has-managed-block-cursor";
      const sync = (view: EditorView) => {
        const hasManagedBlockCursor = view.state.selection instanceof ManagedBlockCursor;
        view.dom.classList.toggle(className, hasManagedBlockCursor);

        if (hasManagedBlockCursor) {
          focusOuterViewForManagedCursor(view);
        }

        logManagedBlockCursor(view, "plugin-sync");
      };

      sync(editorView);

      return {
        update(view) {
          sync(view);
        },
        destroy() {
          editorView.dom.classList.remove(className);
        },
      };
    },
  });
}
