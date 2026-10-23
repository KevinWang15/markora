import {
  createAtomView,
  type AtomControl,
  type AtomRendering,
  type AtomView,
  type AtomViewContext,
  type AtomViewSpec,
  type EditorView,
  type Node,
  type NodeViewConstructor,
} from "../src/extension-api";

declare const node: Node;
declare const view: EditorView;
const controls: readonly AtomControl[] = [{
  label: "Edit",
  ariaLabel: context => String(context.node.attrs.label),
  hidden: context => context.signal.aborted,
  disabled: context => !context.editable,
  onClick(context, event) {
    const position: number | undefined = context.getPos();
    const signal: AbortSignal = context.signal;
    const click: MouseEvent = event;
    void position;
    void signal;
    void click;
  },
}];
const spec: AtomViewSpec = {
  display: "block",
  tagName: "section",
  role: "region",
  header: true,
  statusDisplay: "visible",
  label: current => String(current.attrs.label),
  controls,
  render(context) {
    const state: AtomViewContext = context;
    const rendering: AtomRendering = {
      update(next) {
        state.content.textContent = next.node.attrs.label;
        return true;
      },
      selectionChanged(next) {
        const selected: boolean = next.selected;
        state.content.hidden = !selected;
      },
      destroy() { state.content.replaceChildren(); },
    };
    return rendering;
  },
  ownsEvents: (target, context, event) => context.content.contains(target) && event.type !== "keydown",
};
const atom: AtomView = createAtomView(node, view, () => undefined, spec);
const refreshed: boolean = atom.refresh();
const constructor: NodeViewConstructor = (current, editor, getPos) => createAtomView(current, editor, getPos, spec);
type Assert<Condition extends true> = Condition;
type SynchronousRendering = Assert<Promise<AtomRendering> extends ReturnType<AtomViewSpec["render"]> ? false : true>;
const synchronous: SynchronousRendering = true;
void refreshed;
void constructor;
void synchronous;
