import {
  TextSelection,
  createAtomView,
  type AtomViewContext,
  type EditorView,
  type Node as ProseMirrorNode,
  type NodeType,
  type NodeViewConstructor,
  type PluginKey,
} from "markora/extension-api";
import type { TocMessages } from "./messages.js";
import type { TocIndex } from "./model.js";

export type TocRuntimeStorage = {
  readonly refreshers: Set<() => void>;
};

type TocNodeTypes = Readonly<{
  heading: NodeType;
  toc: NodeType;
}>;

type CreateTocNodeViewOptions = Readonly<{
  indexKey: PluginKey<TocIndex>;
  messages: TocMessages;
  nodeTypes: TocNodeTypes;
  storage: TocRuntimeStorage;
}>;

type OutlineHeading = TocIndex["snapshot"]["headings"][number];

type OutlineBranch = {
  readonly children: OutlineBranch[];
  readonly heading: OutlineHeading;
  readonly ordinal: number;
};

function safePosition(
  view: EditorView,
  getPos: () => number | undefined,
  nodeType: NodeType,
) {
  if (view.isDestroyed) {
    return null;
  }

  try {
    const position = getPos();
    return typeof position === "number"
      && view.state.doc.nodeAt(position)?.type === nodeType
      ? position
      : null;
  } catch {
    return null;
  }
}

function eventElement(event: Event, container: HTMLElement) {
  const ownerWindow = container.ownerDocument.defaultView;
  const target = event.target;

  if (!ownerWindow || !(target instanceof ownerWindow.Node)) {
    return null;
  }

  return target instanceof ownerWindow.Element
    ? target
    : target.parentElement;
}

function entryButton(event: Event, container: HTMLElement) {
  const element = eventElement(event, container);
  const button = element?.closest<HTMLButtonElement>("button[data-mdw-toc-entry]")
    ?? null;

  return button && container.contains(button) ? button : null;
}

function entryOrdinal(button: HTMLButtonElement) {
  const ordinal = Number(button.dataset.mdwTocEntry);
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

/**
 * Build a heading tree without manufacturing inaccessible placeholder items
 * when authored heading levels skip (for example, H1 directly to H3).
 */
function buildOutline(headings: readonly OutlineHeading[]) {
  const roots: OutlineBranch[] = [];
  const stack: OutlineBranch[] = [];

  headings.forEach((heading, ordinal) => {
    while (
      stack.length > 0
      && stack[stack.length - 1]!.heading.level >= heading.level
    ) {
      stack.pop();
    }

    const branch: OutlineBranch = {
      children: [],
      heading,
      ordinal: ordinal + 1,
    };
    const parent = stack[stack.length - 1];

    if (parent) {
      parent.children.push(branch);
    } else {
      roots.push(branch);
    }

    stack.push(branch);
  });

  return roots;
}

export function createTocNodeView(
  options: CreateTocNodeViewOptions,
): NodeViewConstructor {
  const { indexKey, messages, nodeTypes, storage } = options;

  class TocNodeView {
    readonly dom: HTMLElement;

    private destroyed = false;
    private readonly outline: HTMLElement;
    private renderedSignature: string | null = null;

    constructor(
      node: ProseMirrorNode,
      private readonly view: EditorView,
      private readonly getPos: () => number | undefined,
      frame: AtomViewContext,
    ) {
      if (node.type !== nodeTypes.toc) {
        throw new RangeError(
          `TOC NodeView expected ${nodeTypes.toc.name}, received ${node.type.name}.`,
        );
      }

      const ownerDocument = view.dom.ownerDocument;
      this.dom = frame.dom;
      this.dom.dataset.mdwToc = "";

      const header = frame.header!;
      header.classList.add("mdw-toc__header");
      header.dataset.mdwTocHeader = "";

      const source = ownerDocument.createElement("span");
      source.className = "mdw-toc__source";
      source.dataset.mdwTocSource = "";
      source.textContent = "[TOC]";
      header.append(source);

      this.outline = ownerDocument.createElement("div");
      this.outline.className = "mdw-toc__outline";
      this.outline.dataset.mdwTocOutline = "";
      frame.content.append(this.outline);
      this.dom.addEventListener("click", this.handleClick, { signal: frame.signal });
      this.dom.addEventListener("keydown", this.handleKeyDown, { signal: frame.signal });
      storage.refreshers.add(this.refresh);
      this.render();
    }

    update(node: ProseMirrorNode) {
      if (node.type !== nodeTypes.toc) {
        return false;
      }

      // A hard EditorState reset may recreate plugin views while retaining
      // this NodeView. Reassert ownership of the refresh callback.
      storage.refreshers.add(this.refresh);
      this.render();
      return true;
    }

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;
      storage.refreshers.delete(this.refresh);
      this.outline.replaceChildren();
    }

    private readonly refresh = () => {
      if (!this.destroyed) {
        this.render();
      }
    };

    private readonly handleClick = (event: MouseEvent) => {
      const button = entryButton(event, this.dom);
      const ordinal = button ? entryOrdinal(button) : null;

      if (ordinal === null) {
        return;
      }

      this.activate(ordinal);
      event.preventDefault();
      event.stopPropagation();
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key !== "Enter" && event.key !== " ")
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) {
        return;
      }

      const button = entryButton(event, this.dom);
      const ordinal = button ? entryOrdinal(button) : null;

      if (ordinal === null) {
        return;
      }

      this.activate(ordinal);
      event.preventDefault();
      event.stopPropagation();
    };

    private activate(ordinal: number) {
      if (this.destroyed || this.view.isDestroyed || this.view.composing) {
        return false;
      }

      // Resolve the ordinal against the current plugin state rather than
      // retaining a render-time position. This keeps navigation correct after
      // mapped edits without repainting an otherwise unchanged outline.
      const heading = indexKey.getState(this.view.state)?.snapshot.headings[ordinal - 1];

      if (
        !heading
        || this.view.state.doc.nodeAt(heading.position)?.type !== nodeTypes.heading
      ) {
        return false;
      }

      const selection = TextSelection.create(
        this.view.state.doc,
        heading.position + 1,
      );

      if (!selection.eq(this.view.state.selection)) {
        this.view.dispatch(
          this.view.state.tr
            .setSelection(selection)
            .setMeta("addToHistory", false)
            .scrollIntoView(),
        );
      }

      this.view.focus();
      return true;
    }

    private createList(branches: readonly OutlineBranch[], nested: boolean) {
      const list = this.view.dom.ownerDocument.createElement("ol");
      list.className = nested
        ? "mdw-toc__list mdw-toc__list--nested"
        : "mdw-toc__list";
      list.dataset.mdwTocList = nested ? "nested" : "root";
      // Preserve announced list semantics in WebKit even though the optional
      // stylesheet removes visual list markers.
      list.setAttribute("role", "list");

      for (const branch of branches) {
        const item = this.view.dom.ownerDocument.createElement("li");
        item.className = "mdw-toc__item";
        item.dataset.mdwTocLevel = String(branch.heading.level);

        const button = this.view.dom.ownerDocument.createElement("button");
        button.className = "mdw-toc__entry";
        button.type = "button";
        button.dataset.mdwTocEntry = String(branch.ordinal);
        button.dataset.mdwTocLevel = String(branch.heading.level);
        button.textContent = branch.heading.label;
        button.setAttribute(
          "aria-label",
          messages.goToHeadingLabel(
            branch.heading.label,
            branch.heading.level,
            branch.ordinal,
          ),
        );
        item.append(button);

        if (branch.children.length > 0) {
          item.append(this.createList(branch.children, true));
        }

        list.append(item);
      }

      return list;
    }

    private render() {
      const index = indexKey.getState(this.view.state);
      const position = safePosition(this.view, this.getPos, nodeTypes.toc);

      if (!index || position === null) {
        return;
      }

      const tocOffset = index.snapshot.tocs.findIndex((toc) => (
        toc.position === position
      ));
      const occurrence = tocOffset < 0 ? 1 : tocOffset + 1;
      const total = Math.max(1, index.snapshot.tocs.length);
      const navigationLabel = messages.navigationLabel(occurrence, total);
      const signature = JSON.stringify([
        navigationLabel,
        index.snapshot.headings.map(({ label, level }) => [label, level]),
      ]);

      this.dom.dataset.mdwTocOccurrence = String(occurrence);
      this.dom.setAttribute("aria-label", navigationLabel);

      if (signature === this.renderedSignature) {
        return;
      }

      this.renderedSignature = signature;

      if (index.snapshot.headings.length === 0) {
        const empty = this.view.dom.ownerDocument.createElement("p");
        empty.className = "mdw-toc__empty";
        empty.dataset.mdwTocEmpty = "";
        empty.textContent = messages.emptyState;
        this.outline.replaceChildren(empty);
        return;
      }

      this.outline.replaceChildren(
        this.createList(buildOutline(index.snapshot.headings), false),
      );
    }
  }

  return (node, view, getPos) => createAtomView(node, view, getPos, {
    display: "block",
    tagName: "nav",
    role: "navigation",
    className: "mdw-toc",
    label: () => {
      const index = indexKey.getState(view.state);
      const position = safePosition(view, getPos, nodeTypes.toc);
      const offset = index?.snapshot.tocs.findIndex(toc => toc.position === position) ?? -1;
      return messages.navigationLabel(offset < 0 ? 1 : offset + 1, Math.max(1, index?.snapshot.tocs.length ?? 0));
    },
    ownsEvents: (_target, frame, event) => entryButton(event, frame.dom) !== null,
    render(frame) {
      const renderer = new TocNodeView(node, view, getPos, frame);
      return { update: current => renderer.update(current.node), destroy: () => renderer.destroy() };
    },
  });
}
