import { createEditor } from "markora";
import { createComponentRegistry, createComponentsExtension, defineComponent, type ComponentProps, type ComponentReadonly } from "../src/index";

const chart = defineComponent({
  name: "chart",
  parseProps: (value: unknown) => ({ title: String(value) }),
  render({ props, element }) { element.textContent = props.title; },
  edit({ props, update }) { update({ title: props.title }); },
});
const registry = createComponentRegistry([chart]);
const extension = createComponentsExtension({ registry });
const editor = createEditor({ element: document.createElement("div"), extensions: [extension] });
const api = editor.extensions.get(extension);
api.commands.insert(chart, { title: "CPU" });
api.commands.update(chart, { title: "Memory" }, 0);
const title: string | undefined = api.state.getProps(chart, 0)?.title;
void title;
// @ts-expect-error Component props are inferred from the definition.
api.commands.insert(chart, { title: 42 });
// @ts-expect-error Required properties cannot be omitted.
api.commands.update(chart, {});
registry.register(chart)();

const nested = defineComponent({
  name: "nested",
  parseProps: () => ({ series: [{ points: [1, 2], label: "CPU" }], range: [0, 60] as [number, number] }),
  render({ props }) {
    // @ts-expect-error Nested object properties are immutable.
    props.series[0].label = "Memory";
    // @ts-expect-error Nested arrays are immutable.
    props.series[0].points.push(3);
    // @ts-expect-error Tuples retain readonly element types.
    props.range[0] = 1;
    const range: readonly [number, number] = props.range;
    void range;
  },
  edit({ props, update }) { update(props); },
});
const props = api.state.getProps(nested, 0);
if (props) {
  api.commands.update(nested, props, 0);
  api.commands.insert(nested, props);
  // @ts-expect-error State query snapshots are deeply immutable.
  props.series[0].points[0] = 42;
}

const jsonProps: ComponentProps = { nested: { values: [1, null, true, "text"] } };
const immutableJson: ComponentReadonly<ComponentProps> = jsonProps;
const arbitrary = defineComponent({ name: "arbitrary", parseProps: (): ComponentProps => immutableJson, render() {} });
api.commands.insert(arbitrary, jsonProps);
const nullable: ComponentReadonly<{ nested?: { value: number } | null }> = { nested: { value: 1 } };
if (nullable.nested) {
  // @ts-expect-error Optional nullable objects remain deeply immutable.
  nullable.nested.value = 2;
}
