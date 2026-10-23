import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

export type AtomViewContext = Readonly<{
  node: ProseMirrorNode;
  view: EditorView;
  getPos: () => number | undefined;
  dom: HTMLElement;
  header: HTMLElement | null;
  controls: HTMLElement;
  content: HTMLElement;
  status: HTMLElement;
  editable: boolean;
  selected: boolean;
  signal: AbortSignal;
}>;

type AtomControlLabel = string | ((context: AtomViewContext) => string);

export type AtomControl = Readonly<{
  label: AtomControlLabel;
  ariaLabel?: AtomControlLabel;
  className?: string;
  hidden?: (context: AtomViewContext) => boolean;
  disabled?: (context: AtomViewContext) => boolean;
  requiresEditable?: boolean;
  onClick: (context: AtomViewContext, event: MouseEvent) => void;
}>;

export type AtomRendering = Readonly<{
  update?: (context: AtomViewContext) => boolean | void;
  selectionChanged?: (context: AtomViewContext) => void;
  destroy?: () => void;
}>;

export type AtomViewSpec = Readonly<{
  display: "block" | "inline";
  tagName?: "div" | "section" | "nav" | "span" | "sup";
  role?: string;
  header?: boolean;
  statusDisplay?: "hidden" | "visible";
  className?: string;
  label: (node: ProseMirrorNode) => string;
  controls?: readonly AtomControl[];
  render: (context: AtomViewContext) => AtomRendering | void;
  ownsEvents?: (target: Node, context: AtomViewContext, event: Event) => boolean;
}>;

export type AtomView = NodeView & {
  readonly dom: HTMLElement;
  refresh(): boolean;
};

function isInside(target: EventTarget | null, element: HTMLElement): target is Node {
  try {
    return target !== null && element.contains(target as Node);
  } catch {
    return false;
  }
}

function readLabel(label: AtomControlLabel, context: AtomViewContext) {
  return typeof label === "function" ? label(context) : label;
}

export function createAtomView(
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
  spec: AtomViewSpec,
): AtomView {
  if ((spec.display !== "block" && spec.display !== "inline")
    || node.isText || !node.isAtom || node.isInline !== (spec.display === "inline")) {
    throw new RangeError(`Atom view requires a ${spec.display} atom, received ${node.type.name}.`);
  }

  const ownerDocument = view.dom.ownerDocument;
  const Controller = ownerDocument.defaultView?.AbortController ?? AbortController;
  const controller = new Controller();
  const dom = ownerDocument.createElement(spec.tagName ?? (spec.display === "block" ? "div" : "span"));
  dom.className = `mdw-atom mdw-atom-${spec.display}${spec.className ? ` ${spec.className}` : ""}`;
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("role", spec.role ?? "group");

  const header = (spec.header ?? spec.display === "block")
    ? ownerDocument.createElement(spec.display === "block" ? "div" : "span") : null;
  const controls = ownerDocument.createElement("span");
  const content = ownerDocument.createElement(spec.display === "block" ? "div" : "span");
  const status = ownerDocument.createElement(spec.display === "block" && spec.statusDisplay === "visible" ? "div" : "span");
  controls.className = "mdw-atom-controls";
  content.className = "mdw-atom-content";
  status.className = `mdw-atom-status${spec.statusDisplay === "visible" ? " mdw-atom-status-visible" : ""}`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  if (header) {
    header.className = "mdw-atom-header";
    header.append(controls);
    dom.append(header, content, status);
  } else {
    dom.append(content, controls, status);
  }

  let currentNode = node;
  let rendering: AtomRendering | void;
  let destroyed = false;
  let selected = false;
  let updateVersion = 0;
  const listeners: Array<() => void> = [];
  const buttons: Array<{ control: AtomControl; button: HTMLButtonElement }> = [];

  function context(nextNode = currentNode): AtomViewContext {
    return Object.freeze({
      node: nextNode, view, getPos, dom, header, controls, content, status,
      editable: view.editable,
      selected,
      signal: controller.signal,
    });
  }

  function isDisabled(control: AtomControl, current: AtomViewContext) {
    return (control.requiresEditable !== false && !current.editable)
      || control.hidden?.(current) === true || control.disabled?.(current) === true;
  }

  function refreshFrame(current: AtomViewContext) {
    dom.setAttribute("aria-label", spec.label(current.node));
    for (const { control, button } of buttons) {
      const label = readLabel(control.label, current);
      button.textContent = label;
      button.setAttribute("aria-label", control.ariaLabel === undefined ? label : readLabel(control.ariaLabel, current));
      button.hidden = control.hidden?.(current) === true;
      button.disabled = isDisabled(control, current);
      button.setAttribute("aria-disabled", String(button.disabled));
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const previous = rendering;
    rendering = undefined;
    for (const remove of listeners.splice(0)) remove();
    try {
      controller.abort();
    } finally {
      previous?.destroy?.();
    }
  }

  function fail(cause: unknown): never {
    try {
      destroy();
    } finally {
      throw cause;
    }
  }

  function update(nextNode: ProseMirrorNode) {
    if (destroyed || view.isDestroyed || nextNode.type !== node.type) return false;
    const version = ++updateVersion;
    const current = context(nextNode);
    try {
      if (rendering?.update) {
        if (rendering.update(current) === false) return false;
      } else if (!nextNode.eq(currentNode)) {
        return false;
      }
      if (destroyed || view.isDestroyed) return false;
      if (version !== updateVersion) return true;
      currentNode = nextNode;
      refreshFrame(current);
      return true;
    } catch (cause) {
      return fail(cause);
    }
  }

  function setSelected(nextSelected: boolean) {
    if (destroyed || selected === nextSelected) return;
    selected = nextSelected;
    dom.classList.toggle("ProseMirror-selectednode", selected);
    try {
      rendering?.selectionChanged?.(context());
      if (!destroyed) refreshFrame(context());
    } catch (cause) {
      fail(cause);
    }
  }

  const atom: AtomView = {
    dom,
    update,
    refresh: () => update(currentNode),
    selectNode() {
      setSelected(true);
    },
    deselectNode() {
      setSelected(false);
    },
    stopEvent(event) {
      return !destroyed && isInside(event.target, dom)
        && (controls.contains(event.target) || spec.ownsEvents?.(event.target, context(), event) === true);
    },
    ignoreMutation: mutation => isInside(mutation.target, dom),
    destroy,
  };

  try {
    for (const control of spec.controls ?? []) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      if (control.className) button.className = control.className;
      const onClick = (event: MouseEvent) => {
        if (destroyed || view.isDestroyed) return;
        const current = context();
        if (!isDisabled(control, current)) control.onClick(current, event);
      };
      button.addEventListener("click", onClick);
      listeners.push(() => button.removeEventListener("click", onClick));
      buttons.push({ control, button });
      controls.append(button);
    }
    rendering = spec.render(context());
    refreshFrame(context());
    return atom;
  } catch (cause) {
    return fail(cause);
  }
}
