import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import { createAtomView, type AtomView, type AtomViewContext, type AtomViewSpec } from "../src/atomView";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    block_atom: { group: "block", atom: true, attrs: { label: { default: "Original" } }, toDOM: () => ["div"] },
    inline_atom: { group: "inline", inline: true, atom: true, attrs: { label: { default: "Original" } }, toDOM: () => ["span"] },
    text: { group: "inline" },
  },
});
const editors: EditorView[] = [];

function mount(
  spec: Partial<AtomViewSpec> = {},
  ownerDocument = document,
) {
  const display = spec.display ?? "block";
  const nodeType = display === "block" ? schema.nodes.block_atom : schema.nodes.inline_atom;
  const node = nodeType.create();
  const paragraph = schema.nodes.paragraph;
  const doc = display === "block"
    ? schema.nodes.doc.create(null, [paragraph.create(null, schema.text("Before")), node, paragraph.create()])
    : schema.nodes.doc.create(null, paragraph.create(null, [schema.text("Before "), node, schema.text(" after")]));
  const host = ownerDocument.createElement("div");
  ownerDocument.body.append(host);
  const instances: AtomView[] = [];
  const contexts: AtomViewContext[] = [];
  const view = new EditorView(host, {
    state: EditorState.create({ doc }),
    nodeViews: {
      [nodeType.name](currentNode, editor, getPos) {
        const atom = createAtomView(currentNode, editor, getPos, {
          label: current => String(current.attrs.label),
          ...spec,
          display,
          render(context) {
            contexts.push(context);
            if (spec.render) return spec.render(context);
            context.content.textContent = context.node.attrs.label;
            return { update: next => { next.content.textContent = next.node.attrs.label; } };
          },
        });
        instances.push(atom);
        return atom;
      },
    },
  });
  editors.push(view);
  return { atom: instances[0], context: contexts[0], contexts, instances, node, nodeType, view };
}

function eventAt(target: EventTarget, type: string, ownerDocument = document) {
  const EventConstructor = ownerDocument.defaultView!.Event;
  const event = new EventConstructor(type, { cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const view of editors.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each(["block", "inline"] as const)("%s atom frame", display => {
  it("creates an accessible non-editable frame in the editor's document", () => {
    const { atom, context } = mount({ display, className: "custom-atom" });
    expect(atom.dom.tagName).toBe(display === "block" ? "DIV" : "SPAN");
    expect(atom.dom.classList.contains("mdw-atom")).toBe(true);
    expect(atom.dom.classList.contains(`mdw-atom-${display}`)).toBe(true);
    expect(atom.dom.classList.contains("custom-atom")).toBe(true);
    expect(atom.dom.getAttribute("contenteditable")).toBe("false");
    expect(atom.dom.getAttribute("role")).toBe("group");
    expect(atom.dom.getAttribute("aria-label")).toBe("Original");
    expect(Boolean(context.header)).toBe(display === "block");
    expect(context.controls.parentElement).toBe(context.header ?? atom.dom);
    expect(context.content.textContent).toBe("Original");
    expect(context.status.getAttribute("role")).toBe("status");
    expect(context.status.getAttribute("aria-live")).toBe("polite");
    expect(context.status.getAttribute("aria-atomic")).toBe("true");
    expect(context.signal.aborted).toBe(false);
    expect(context.editable).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("changes only the shared selection class", () => {
    const { atom, view } = mount({ display });
    const selection = view.state.selection;
    atom.selectNode?.();
    atom.selectNode?.();
    expect(atom.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    atom.deselectNode?.();
    atom.deselectNode?.();
    expect(atom.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
    expect(view.state.selection).toBe(selection);
  });

  it("owns controls and explicitly claimed regions without swallowing the frame", () => {
    const { atom, context } = mount({
      display,
      controls: [{ label: "Edit", onClick: vi.fn() }],
      render(current) {
        current.content.append(current.dom.ownerDocument.createElement("textarea"));
      },
      ownsEvents: (target, current, event) => current.content.contains(target) && event.type !== "keydown",
    });
    const button = context.controls.querySelector("button")!;
    const input = context.content.querySelector("textarea")!;
    for (const type of ["mousedown", "pointerdown", "keydown", "beforeinput", "compositionstart", "copy"]) {
      expect(atom.stopEvent?.(eventAt(button, type))).toBe(true);
      expect(atom.stopEvent?.(eventAt(atom.dom, type))).toBe(false);
    }
    expect(atom.stopEvent?.(eventAt(input, "compositionstart"))).toBe(true);
    expect(atom.stopEvent?.(eventAt(input, "keydown"))).toBe(false);
    expect(atom.stopEvent?.(new Event("click"))).toBe(false);
    expect(atom.stopEvent?.(eventAt(window, "click"))).toBe(false);
    expect(atom.stopEvent?.(eventAt(document.body, "click"))).toBe(false);
  });

  it("ignores internal DOM and selection mutations, but not external selections", () => {
    const { atom, context } = mount({ display });
    const observer = new MutationObserver(() => {});
    observer.observe(atom.dom, { attributes: true, childList: true, characterData: true, subtree: true });
    context.status.textContent = "Ready";
    context.content.firstChild!.textContent = "Updated preview";
    atom.dom.setAttribute("data-ready", "true");
    const mutations = observer.takeRecords();
    observer.disconnect();
    expect(mutations.length).toBeGreaterThan(0);
    for (const mutation of mutations) expect(atom.ignoreMutation?.(mutation)).toBe(true);
    expect(atom.ignoreMutation?.({ type: "selection", target: context.content })).toBe(true);
    expect(atom.ignoreMutation?.({ type: "selection", target: document.body })).toBe(false);
  });
});

describe("atom controls and updates", () => {
  it("notifies selection transitions and refreshes selection-dependent controls", () => {
    const selectionChanged = vi.fn();
    const { atom, context, view } = mount({
      controls: [{ label: "Edit", hidden: current => !current.selected, onClick: vi.fn() }],
      render: () => ({ selectionChanged }),
    });
    const selection = view.state.selection;
    const button = context.controls.querySelector<HTMLButtonElement>("button")!;
    expect(context.selected).toBe(false);
    expect(button.hidden).toBe(true);
    atom.selectNode?.();
    atom.selectNode?.();
    expect(button.hidden).toBe(false);
    atom.deselectNode?.();
    expect(button.hidden).toBe(true);
    expect(selectionChanged.mock.calls.map(([current]) => current.selected)).toEqual([true, false]);
    expect(context.selected).toBe(false);
    expect(view.state.selection).toBe(selection);
    atom.destroy?.();
    atom.selectNode?.();
    expect(selectionChanged).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest reentrant update in the frame and action context", () => {
    let replace: (() => void) | undefined;
    const onClick = vi.fn();
    const { atom, nodeType } = mount({
      controls: [{ label: "Inspect", onClick }],
      render: () => ({ update(current) { if (current.node.attrs.label === "Outer") replace?.(); } }),
    });
    replace = () => { atom.update?.(nodeType.create({ label: "Winner" }), [], DecorationSet.empty); };
    atom.update?.(nodeType.create({ label: "Outer" }), [], DecorationSet.empty);
    expect(atom.dom.getAttribute("aria-label")).toBe("Winner");
    atom.dom.querySelector<HTMLButtonElement>("button")!.click();
    expect(onClick.mock.lastCall?.[0].node.attrs.label).toBe("Winner");
  });

  it("refreshes labels and gives actions the current node and live position", () => {
    const onClick = vi.fn();
    const { atom, context, nodeType, view } = mount({
      controls: [{
        label: current => current.node.attrs.label,
        ariaLabel: current => `Edit ${current.node.attrs.label}`,
        className: "edit-atom",
        onClick,
      }],
    });
    const position = context.getPos()!;
    const button = atom.dom.querySelector<HTMLButtonElement>("button")!;
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("false");
    view.dispatch(view.state.tr.setNodeMarkup(position, nodeType, { label: "Updated" }));
    expect(atom.dom.getAttribute("aria-label")).toBe("Updated");
    expect(button.textContent).toBe("Updated");
    expect(button.getAttribute("aria-label")).toBe("Edit Updated");
    const paragraph = schema.nodes.paragraph.create(null, schema.text("Inserted"));
    view.dispatch(view.state.tr.insert(0, paragraph));
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
    const current = onClick.mock.calls[0][0] as AtomViewContext;
    expect(current.node.attrs.label).toBe("Updated");
    expect(current.getPos()).toBe(position + paragraph.nodeSize);
  });

  it("blocks stale controls immediately and reflects read-only transitions on refresh", () => {
    const onEdit = vi.fn();
    const onInspect = vi.fn();
    const update = vi.fn();
    const { atom, view } = mount({
      controls: [
        { label: "Edit", onClick: onEdit },
        { label: "Inspect", requiresEditable: false, onClick: onInspect },
      ],
      render: () => ({ update }),
    });
    const [edit, inspect] = atom.dom.querySelectorAll<HTMLButtonElement>("button");
    view.setProps({ editable: () => false });
    eventAt(edit, "click");
    expect(onEdit).not.toHaveBeenCalled();
    expect(atom.refresh()).toBe(true);
    expect(update.mock.lastCall?.[0].editable).toBe(false);
    expect(edit.disabled).toBe(true);
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    expect(inspect.disabled).toBe(false);
    inspect.click();
    expect(onInspect).toHaveBeenCalledOnce();
    view.setProps({ editable: () => true });
    atom.refresh();
    expect(edit.disabled).toBe(false);
    expect(edit.getAttribute("aria-disabled")).toBe("false");
    edit.click();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("respects live hidden and disabled predicates even before refresh", () => {
    let hidden = false;
    let disabled = false;
    const onClick = vi.fn();
    const { atom } = mount({ controls: [{ label: "Edit", hidden: () => hidden, disabled: () => disabled, onClick }] });
    const button = atom.dom.querySelector<HTMLButtonElement>("button")!;
    hidden = true;
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    atom.refresh();
    expect(button.hidden).toBe(true);
    expect(button.disabled).toBe(true);
    hidden = false;
    disabled = true;
    atom.refresh();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    disabled = false;
    atom.refresh();
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("lets ProseMirror recreate renderings that reject an update", () => {
    const cleanup = vi.fn();
    const { atom, context, contexts, instances, view, nodeType } = mount({
      render: () => ({ update: () => false, destroy: cleanup }),
    });
    view.dispatch(view.state.tr.setNodeMarkup(context.getPos()!, nodeType, { label: "Recreated" }));
    expect(instances).toHaveLength(2);
    expect(instances[1]).not.toBe(atom);
    expect(instances[1].dom.getAttribute("aria-label")).toBe("Recreated");
    expect(context.signal.aborted).toBe(true);
    expect(contexts[1].signal.aborted).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("retains static renderings only while their node is equal", () => {
    const { atom, node, nodeType } = mount({ render: () => {} });
    expect(atom.refresh()).toBe(true);
    expect(atom.update?.(nodeType.create(node.attrs), [], DecorationSet.empty)).toBe(true);
    expect(atom.update?.(nodeType.create({ label: "Changed" }), [], DecorationSet.empty)).toBe(false);
    expect(atom.update?.(schema.nodes.paragraph.create(), [], DecorationSet.empty)).toBe(false);
    expect(atom.dom.getAttribute("aria-label")).toBe("Original");
  });
});

describe("atom lifecycle and owner document", () => {
  it.each([
    { display: "block", tagName: "nav", role: "navigation", header: false },
    { display: "inline", tagName: "sup", role: "note", header: true },
  ] as const)("preserves semantic $tagName frames and optional headers", spec => {
    const { atom, context } = mount({ ...spec, statusDisplay: "visible" });
    expect(atom.dom.tagName).toBe(spec.tagName.toUpperCase());
    expect(atom.dom.getAttribute("role")).toBe(spec.role);
    expect(Boolean(context.header)).toBe(spec.header);
    expect(context.status.classList.contains("mdw-atom-status-visible")).toBe(true);
    expect(context.status.tagName).toBe(spec.display === "block" ? "DIV" : "SPAN");
  });

  it("disposes a renderer whose selection callback fails", () => {
    const destroy = vi.fn();
    const { atom, context } = mount({
      render: () => ({ selectionChanged() { throw new Error("selection failed"); }, destroy }),
    });
    expect(() => atom.selectNode?.()).toThrow("selection failed");
    expect(context.signal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(() => atom.destroy?.()).not.toThrow();
  });

  it("aborts before cleanup and removes control listeners exactly once", () => {
    const cleanup = vi.fn((signal: AbortSignal) => expect(signal.aborted).toBe(true));
    const onClick = vi.fn();
    const { atom, context, node } = mount({
      controls: [{ label: "Edit", onClick }],
      render: current => ({ destroy: () => cleanup(current.signal) }),
    });
    const button = atom.dom.querySelector<HTMLButtonElement>("button")!;
    const remove = vi.spyOn(button, "removeEventListener");
    atom.destroy?.();
    atom.destroy?.();
    expect(context.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(atom.refresh()).toBe(false);
    expect(atom.update?.(node, [], DecorationSet.empty)).toBe(false);
    expect(atom.stopEvent?.(eventAt(button, "click"))).toBe(false);
    atom.selectNode?.();
    expect(atom.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
  });

  it("still aborts and removes controls if renderer cleanup throws", () => {
    const { atom, context } = mount({ render: () => ({ destroy() { throw new Error("cleanup"); } }) });
    expect(() => atom.destroy?.()).toThrow("cleanup");
    expect(context.signal.aborted).toBe(true);
    expect(() => atom.destroy?.()).not.toThrow();
  });

  it("aborts partial setup when rendering fails", () => {
    const { node, view } = mount();
    const contexts: AtomViewContext[] = [];
    const onClick = vi.fn();
    expect(() => createAtomView(node, view, () => 0, {
      display: "block", label: () => "Broken", controls: [{ label: "Edit", onClick }],
      render(current) {
        contexts.push(current);
        throw new Error("render failed");
      },
    })).toThrow("render failed");
    expect(contexts[0].signal.aborted).toBe(true);
    contexts[0].controls.querySelector<HTMLButtonElement>("button")!.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("preserves an update failure while disposing a throwing renderer", () => {
    const cleanup = vi.fn(() => { throw new Error("cleanup failed"); });
    const { atom, context } = mount({
      render: () => ({ update() { throw new Error("update failed"); }, destroy: cleanup }),
    });
    expect(() => atom.refresh()).toThrow("update failed");
    expect(context.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(() => atom.destroy?.()).not.toThrow();
  });

  it("does not refresh a frame destroyed by its own update callback", () => {
    let destroy: (() => void) | undefined;
    const { atom, context } = mount({ render: () => ({ update: () => { destroy?.(); } }) });
    destroy = () => atom.destroy?.();
    expect(atom.refresh()).toBe(false);
    expect(context.signal.aborted).toBe(true);
  });

  it("uses iframe DOM and signals without instanceof checks against the global realm", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const ownerDocument = iframe.contentDocument!;
    const { atom, context } = mount({ controls: [{ label: "Edit", onClick: vi.fn() }] }, ownerDocument);
    expect(atom.dom.ownerDocument).toBe(ownerDocument);
    expect(context.signal).toBeInstanceOf(ownerDocument.defaultView!.AbortSignal);
    const button = context.controls.querySelector("button")!;
    expect(button instanceof window.Node).toBe(false);
    expect(atom.stopEvent?.(eventAt(button, "click", ownerDocument))).toBe(true);
  });

  it("supports detached owner documents with no defaultView", () => {
    const ownerDocument = document.implementation.createHTMLDocument("detached");
    const { atom, context } = mount({ controls: [{ label: "Edit", onClick: vi.fn() }] }, ownerDocument);
    expect(ownerDocument.defaultView).toBeNull();
    const button = context.controls.querySelector("button")!;
    expect(atom.stopEvent?.(eventAt(button, "click"))).toBe(true);
  });

  it("rejects editable containers, text, and mismatched display modes before rendering", () => {
    const { view, node } = mount();
    const render = vi.fn();
    const spec: AtomViewSpec = { display: "inline", label: () => "Invalid", render };
    expect(() => createAtomView(node, view, () => 0, spec)).toThrow(RangeError);
    expect(() => createAtomView(schema.text("text"), view, () => 0, spec)).toThrow(RangeError);
    expect(() => createAtomView(schema.nodes.paragraph.create(), view, () => 0, { ...spec, display: "block" })).toThrow(RangeError);
    expect(render).not.toHaveBeenCalled();
  });
});
