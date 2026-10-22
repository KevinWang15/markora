import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { AllSelection, NodeSelection } from "markora/extension-api";
import {
  createComponentRegistry, createComponentsExtension, defineComponent,
  type ComponentEditRequest, type ComponentOptions,
} from "../src/index";
import { snapshotProps } from "../src/props";
import { serializeProps } from "../src/registry";

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();

type ChartProps = { title: string; points: readonly number[] };
const editors: MarkdownEditor[] = [];
const source = '{"title":"CPU","points":[12,34,21]}';
const markdown = `Before\n\n\`\`\`component:metrics-chart\n${source}\n\`\`\`\n\nAfter`;

function chart(overrides: Partial<ComponentOptions<ChartProps>> = {}) {
  return defineComponent({
    name: "metrics-chart",
    label: "Metrics chart",
    parseProps(value): ChartProps {
      const props = value as ChartProps;
      if (typeof props.title !== "string" || !Array.isArray(props.points)
        || !props.points.every(point => typeof point === "number")) throw new TypeError("Expected a title and numeric points.");
      return { title: props.title, points: props.points };
    },
    render: ({ element, props }) => { element.textContent = `${props.title}: ${props.points.join(", ")}`; },
    ...overrides,
  });
}

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
  document.body.replaceChildren();
});

describe.each([["root", createEditor], ["minimal", createMinimalEditor]] as const)("%s components", (_name, create) => {
  function mount(options: { definition?: ReturnType<typeof chart>; markdown?: string; registered?: boolean } = {}) {
    const definition = options.definition ?? chart();
    const registry = createComponentRegistry(options.registered === false ? [] : [definition]);
    const extension = createComponentsExtension({ registry });
    const editor = create({ element: host(), extensions: [extension], markdown: options.markdown ?? markdown });
    editors.push(editor);
    const api = editor.extensions.get(extension);
    return { editor, registry, definition, api };
  }

  it("renders registered components and preserves imported source", () => {
    const { editor, api, definition } = mount();
    expect(editor.getMarkdown()).toBe(markdown);
    expect(api.state.getNodes()).toEqual([{ name: "metrics-chart", position: 8, source }]);
    expect(document.querySelector('[data-status="ready"]')?.textContent).toContain("CPU: 12, 34, 21");
    expect(api.state.getProps(definition, 8)).toEqual({ title: "CPU", points: [12, 34, 21] });
    expect(api.state.getSelected()).toBeNull();
  });

  it("round-trips nested blocks, delimiter runs, empty and malformed source", () => {
    const input = '> ~~~~component:missing\n> {"text":"```"}\n> ~~~~\n\n* item\n\n  ```component:missing\n  bad json\n  ```\n\n```component:missing\n```';
    const { editor, api } = mount({ markdown: input });
    expect(api.state.getNodes().map(node => node.source)).toEqual(['{"text":"```"}', 'bad json', '']);
    const serialized = editor.getMarkdown();
    editor.commands.resetMarkdown(serialized);
    expect(editor.getMarkdown()).toBe(serialized);
    expect(api.state.getNodes()).toHaveLength(3);
  });

  it("ignores ordinary code fences and invalid component identifiers", () => {
    const { api } = mount({ markdown: '```json\n{}\n```\n\n```component:BadName\n{}\n```\n\n```component:chart extra\n{}\n```' });
    expect(api.state.getNodes()).toEqual([]);
  });

  it("supports late registration and removal without changing Markdown or history", () => {
    const { editor, api, registry, definition } = mount({ registered: false });
    expect(document.querySelector('[data-status="unregistered"]')).not.toBeNull();
    const changes = vi.fn();
    editor.subscribe("update", changes);
    const unregister = registry.register(definition);
    expect(document.querySelector('[data-status="ready"]')).not.toBeNull();
    unregister();
    unregister();
    expect(document.querySelector('[data-status="unregistered"]')).not.toBeNull();
    expect(editor.getMarkdown()).toBe(markdown);
    expect(changes).not.toHaveBeenCalled();
    expect(api.commands.insert(definition, { title: "No", points: [] })).toBe(false);
  });

  it("inserts, updates, removes and independently undoes each operation", () => {
    const { editor, api, definition } = mount({ markdown: "" });
    expect(api.commands.insert(definition, { title: "CPU", points: [1] })).toBe(true);
    expect(api.state.getSelected()?.name).toBe("metrics-chart");
    expect(api.commands.update(definition, { title: "Memory", points: [2] })).toBe(true);
    expect(api.state.getProps(definition)?.title).toBe("Memory");
    expect(editor.commands.undo()).toBe(true);
    expect(api.state.getProps(definition)?.title).toBe("CPU");
    expect(editor.commands.redo()).toBe(true);
    expect(api.commands.remove()).toBe(true);
    expect(api.state.getNodes()).toHaveLength(0);
    expect(editor.commands.undo()).toBe(true);
    expect(api.state.getNodes()).toHaveLength(1);
  });

  it("validates edits, reports errors inline, supports cancel and commits once", () => {
    const { editor, api } = mount();
    expect(api.commands.edit(8)).toBe(true);
    const input = document.querySelector("textarea")!;
    input.value = '{"title": false}';
    (document.querySelector("form button") as HTMLButtonElement).click();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(editor.getMarkdown()).toBe(markdown);
    input.value = '{"title":"Memory","points":[42]}';
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(editor.getMarkdown()).toContain('"Memory"');
    editor.commands.undo();
    expect(editor.getMarkdown()).toBe(markdown);
    api.commands.edit(8);
    input.value = '{"title":"Discard","points":[]}';
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.getMarkdown()).toBe(markdown);
    expect(document.querySelector("form")!.hidden).toBe(true);
  });

  it("preserves invalid and potentially hostile source without running it", () => {
    const hostile = '<img src=x onerror=alert(1)><script>throw Error()</script>';
    const { editor } = mount({ markdown: `\`\`\`component:metrics-chart\n${hostile}\n\`\`\`` });
    expect(document.querySelector('[data-status="invalid"] pre')?.textContent).toBe(hostile);
    expect(document.querySelector("img, script")).toBeNull();
    expect(editor.getMarkdown()).toContain(hostile);
  });

  it("tracks async edits when text before the component moves its position", () => {
    let request: ComponentEditRequest<ChartProps> | undefined;
    const { editor, api } = mount({ definition: chart({ edit: value => { request = value; } }) });
    api.commands.edit(8);
    editor.view.dispatch(editor.view.state.tr.insertText("prefix ", 1));
    expect(request!.anchor.ownerDocument).toBe(document);
    expect(request!.signal.aborted).toBe(false);
    expect(request!.update({ title: "Updated", points: [] })).toBe(true);
    expect(request!.signal.aborted).toBe(true);
    expect(request!.update({ title: "Twice", points: [] })).toBe(false);
    expect(editor.getMarkdown()).toContain('"Updated"');
  });

  it.each(["update", "remove", "reset", "same-reset", "readonly", "unregister", "destroy"])("rejects stale edit callbacks after %s", action => {
    let request: ComponentEditRequest<ChartProps> | undefined;
    const cleanup = vi.fn();
    const definition = chart({ edit: value => { request = value; return cleanup; } });
    const { editor, api, registry } = mount({ definition, registered: false });
    const unregister = registry.register(definition);
    api.commands.edit(8);
    if (action === "update") api.commands.update(definition, { title: "New", points: [] }, 8);
    if (action === "remove") api.commands.remove(8);
    if (action === "reset") editor.commands.resetMarkdown("Replacement");
    if (action === "same-reset") editor.commands.resetMarkdown(markdown);
    if (action === "readonly") editor.updateOptions({ editable: false });
    if (action === "unregister") unregister();
    if (action === "destroy") editor.destroy();
    expect(request!.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(request!.update({ title: "Stale", points: [] })).toBe(false);
  });

  it("cleans up renderers, uses frozen snapshots, and disables editing in read-only mode", () => {
    const signals: AbortSignal[] = [];
    const cleanups = vi.fn();
    const definition = chart({ render: ({ props, signal, element, editable }) => {
      expect(Object.isFrozen(props)).toBe(true);
      expect(Object.isFrozen(props.points)).toBe(true);
      signals.push(signal);
      element.textContent = String(editable);
      return cleanups;
    } });
    const { editor, api } = mount({ definition });
    api.commands.update(definition, { title: "New", points: [] }, 8);
    expect(signals[0].aborted).toBe(true);
    editor.updateOptions({ editable: false });
    expect(api.commands.edit(8)).toBe(false);
    expect(api.commands.remove(8)).toBe(false);
    expect(api.commands.update(definition, { title: "No", points: [] }, 8)).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(".mdw-component-header button")!.hidden).toBe(true);
    editor.destroy();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(cleanups).toHaveBeenCalledTimes(signals.length);
  });

  it("contains renderer failures and preserves editable source", () => {
    const { editor, registry, definition, api } = mount({ registered: false, definition: chart({ render() { throw new Error("boom"); } }) });
    const errors = vi.fn();
    editor.subscribe("error", errors);
    registry.register(definition);
    expect(document.querySelector('[data-status="error"]')).not.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(api.commands.edit(8)).toBe(true);
  });

  it("copies and pastes as Markdown, and supports all-selection replacement", () => {
    const { editor, api } = mount();
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, 8)));
    expect(api.state.getSelected()?.source).toBe(source);
    const captured = editor.clipboard.captureSelection();
    expect(captured?.content.markdown).toContain("component:metrics-chart");
    expect(captured?.content.html).not.toContain("mdw-component-preview");
    expect(editor.clipboard.paste(captured!.content)).toBe(true);
    expect(api.state.getNodes()).toHaveLength(1);
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, 8)));
    editor.commands.pasteMarkdown(`\`\`\`component:metrics-chart\n${source}\n\`\`\``);
    expect(api.state.getNodes()).toHaveLength(1);
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    editor.commands.pasteMarkdown("Replacement");
    expect(api.state.getNodes()).toHaveLength(0);
  });

  it("does not restart renders or cancel edits when unrelated components register", () => {
    let request: ComponentEditRequest<ChartProps> | undefined;
    const render = vi.fn();
    const { api, registry } = mount({ definition: chart({ render, edit: value => { request = value; } }) });
    api.commands.edit(8);
    registry.register(chart({ name: "other-chart" }))();
    expect(render).toHaveBeenCalledTimes(1);
    expect(request!.signal.aborted).toBe(false);
    request!.cancel();
    expect(request!.signal.aborted).toBe(true);
  });

  it("rejects an edit after source-identical replacement of the same node object", () => {
    let request: ComponentEditRequest<ChartProps> | undefined;
    const { editor, api } = mount({ definition: chart({ edit: value => { request = value; } }) });
    api.commands.edit(8);
    const node = editor.view.state.doc.nodeAt(8)!;
    editor.view.dispatch(editor.view.state.tr.replaceWith(8, 8 + node.nodeSize, node));
    expect(request!.signal.aborted).toBe(true);
    expect(request!.update({ title: "Stale", points: [] })).toBe(false);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("isolates late renderer work from the current preview", () => {
    const mounts: HTMLElement[] = [];
    const signals: AbortSignal[] = [];
    const { api, definition } = mount({ definition: chart({ render: ({ element, props, signal }) => {
      mounts.push(element);
      signals.push(signal);
      element.textContent = props.title;
    } }) });
    api.commands.update(definition, { title: "New preview", points: [] }, 8);
    mounts[0].textContent = "Late result";
    expect(signals[0].aborted).toBe(true);
    expect(mounts[0].isConnected).toBe(false);
    expect(document.querySelector(".mdw-component-preview")?.textContent).toBe("New preview");
  });

  it("keeps shared registries usable after one editor is destroyed", () => {
    const registry = createComponentRegistry();
    const extension = createComponentsExtension({ registry });
    const first = create({ element: host(), extensions: [extension], markdown });
    const second = create({ element: host(), extensions: [extension], markdown });
    editors.push(first, second);
    first.destroy();
    const unregister = registry.register(chart());
    expect(document.querySelectorAll('[data-status="ready"]')).toHaveLength(1);
    expect(second.getMarkdown()).toBe(markdown);
    unregister();
    expect(document.querySelectorAll('[data-status="unregistered"]')).toHaveLength(1);
  });

  it("persists submitted properties without repeatedly applying parser transformations", () => {
    const parseProps = vi.fn((value: unknown) => {
      const props = value as ChartProps;
      return { title: `${props.title}!`, points: props.points };
    });
    let request: ComponentEditRequest<ChartProps> | undefined;
    const { editor, api, definition } = mount({ definition: chart({ parseProps, edit: value => { request = value; } }) });
    parseProps.mockClear();
    expect(api.commands.update(definition, { title: "Memory", points: [] }, 8)).toBe(true);
    expect(parseProps).toHaveBeenCalledTimes(2);
    expect(api.state.getNodes()[0].source).toBe(JSON.stringify({ title: "Memory", points: [] }, null, 2));
    expect(api.state.getProps(definition, 8)?.title).toBe("Memory!");
    api.commands.edit(8);
    expect(request!.update({ title: "Traffic", points: [] })).toBe(true);
    expect(api.state.getProps(definition, 8)?.title).toBe("Traffic!");
    api.commands.updateSource('{"title":"Disk","points":[]}', 8);
    expect(api.state.getProps(definition, 8)?.title).toBe("Disk!");
    editor.commands.resetMarkdown(editor.getMarkdown());
    expect(api.state.getProps(definition, 8)?.title).toBe("Disk!");
  });

  it("rejects invalid attribute-only transactions without corrupting source", () => {
    const { editor } = mount();
    editor.view.dispatch(editor.view.state.tr.setNodeAttribute(8, "name", "Not valid"));
    editor.view.dispatch(editor.view.state.tr.setNodeAttribute(8, "source", "bad\rsource"));
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("does not dispatch stale commands after a parser reenters the editor", () => {
    let reenter = () => {};
    const definition = chart({ parseProps: value => { reenter(); return value as ChartProps; } });
    const { editor, api } = mount({ definition });
    reenter = () => { reenter = () => {}; editor.commands.resetMarkdown("Replacement"); };
    expect(api.commands.update(definition, { title: "Stale", points: [] }, 8)).toBe(false);
    expect(editor.getMarkdown()).toBe("Replacement");
  });

  it.each(["return", "throw"])("does not overwrite a reentrant unregister when render callbacks %s", outcome => {
    let unregister = () => {};
    let active = false;
    const cleanup = vi.fn();
    const definition = chart({ render: () => {
      if (active) {
        unregister();
        if (outcome === "throw") throw new Error("Failure after unregister");
      }
      return cleanup;
    } });
    const { editor, api, registry } = mount({ definition, registered: false });
    const errors = vi.fn();
    editor.subscribe("error", errors);
    unregister = registry.register(definition);
    active = true;
    api.commands.update(definition, { title: "New", points: [] }, 8);
    expect(document.querySelector('.mdw-component')?.getAttribute("data-status")).toBe("unregistered");
    expect(document.querySelector('.mdw-component-preview')?.textContent).toContain('"New"');
    expect(cleanup).toHaveBeenCalledTimes(outcome === "throw" ? 1 : 2);
    expect(errors).toHaveBeenCalledTimes(outcome === "throw" ? 1 : 0);
  });

  it("cleans up synchronously completed editors once, including late cleanup returns", () => {
    const cleanup = vi.fn();
    let request: ComponentEditRequest<ChartProps> | undefined;
    const { api } = mount({ definition: chart({ edit: value => {
      request = value;
      expect(value.update({ title: "Saved immediately", points: [] })).toBe(true);
      value.cancel();
      return cleanup;
    } }) });
    expect(api.commands.edit(8)).toBe(true);
    expect(request!.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(api.state.getNodes()[0].source).toContain("Saved immediately");
  });

  it("observes registration changes during the initial render", () => {
    const cleanup = vi.fn();
    const definition = chart({ render: () => { unregister(); return cleanup; } });
    const registry = createComponentRegistry();
    const unregister = registry.register(definition);
    const extension = createComponentsExtension({ registry });
    const editor = create({ element: host(), markdown, extensions: [extension] });
    editors.push(editor);
    expect(document.querySelector('.mdw-component')?.getAttribute("data-status")).toBe("unregistered");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it("does not resume an obsolete refresh after abort listeners unregister the component", () => {
    let unregister = () => {};
    const cleanup = vi.fn();
    const render = vi.fn(({ signal }: Parameters<NonNullable<ComponentOptions<ChartProps>["render"]>>[0]) => {
      signal.addEventListener("abort", () => unregister(), { once: true });
      return cleanup;
    });
    const { api, registry, definition } = mount({ definition: chart({ render }), registered: false });
    unregister = registry.register(definition);
    api.commands.update(definition, { title: "New", points: [] }, 8);
    expect(document.querySelector('.mdw-component')?.getAttribute("data-status")).toBe("unregistered");
    expect(render).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not discard a replacement edit session opened during cleanup", () => {
    let openAgain = false;
    const requests: ComponentEditRequest<ChartProps>[] = [];
    const { api } = mount({ definition: chart({ edit: request => {
      requests.push(request);
      return () => { if (openAgain) { openAgain = false; api.commands.edit(8); } };
    } }) });
    api.commands.edit(8);
    openAgain = true;
    expect(api.commands.edit(8)).toBe(false);
    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].cancel();
    expect(requests[1].signal.aborted).toBe(true);
  });
});

describe("component contracts", () => {
  it("rejects duplicate names, forged definitions, and malformed registrations", () => {
    const definition = chart();
    const registry = createComponentRegistry([definition]);
    expect(() => registry.register(definition)).toThrow("already registered");
    expect(() => registry.register({ ...definition })).toThrow("defineComponent");
    expect(() => chart({ name: "Not valid" })).toThrow("kebab-case");
    expect(() => chart({ name: undefined })).toThrow("kebab-case");
    expect(() => chart({ label: " " })).toThrow("non-empty");
    expect(Object.isFrozen(registry.getAll())).toBe(true);
    expect(registry.get("metrics-chart")).toBe(definition);
  });

  it.each([undefined, new Date(), NaN, Infinity, BigInt(1), () => {}, Symbol("x")])("rejects non-JSON props: %s", value => {
    expect(() => snapshotProps({ value })).toThrow(TypeError);
  });

  it("rejects cycles, holes, accessors, excessive depth and oversized props", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => snapshotProps(cyclic)).toThrow("acyclic");
    expect(() => snapshotProps({ values: new Array(2) })).toThrow("holes");
    const getter = vi.fn();
    expect(() => snapshotProps(Object.defineProperty({}, "secret", { enumerable: true, get: getter }))).toThrow("accessors");
    expect(getter).not.toHaveBeenCalled();
    let nested: unknown = {};
    for (let depth = 0; depth < 35; depth++) nested = { nested };
    expect(() => snapshotProps(nested)).toThrow("nesting");
    expect(() => snapshotProps({ text: "x".repeat(65536) })).toThrow("exceed");
  });

  it("handles prototype-like keys as data without pollution", () => {
    const props = snapshotProps(JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe"}'));
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(props.constructor).toBe("safe");
  });

  it("validates once when serializing and leaves transformations out of persistent source", () => {
    const parseProps = vi.fn((value: unknown) => ({ title: `${(value as ChartProps).title}!`, points: [] }));
    expect(serializeProps(chart({ parseProps }), { title: "CPU", points: [] })).toBe('{\n  "title": "CPU",\n  "points": []\n}');
    expect(parseProps).toHaveBeenCalledTimes(1);
  });

  it.each(["plain", "escaped", "surrogate", "nested", "array"])("enforces exact pretty-JSON size limits for %s properties", kind => {
    const value = (length: number) => {
      const text = "x".repeat(length);
      if (kind === "escaped") return { text: `\n\t\\\"${text}` };
      if (kind === "surrogate") return { text: `\ud800${text}` };
      if (kind === "nested") return { nested: { text }, empty: {} };
      if (kind === "array") return { list: [text, null, [], true, -0] };
      return { text };
    };
    const overhead = JSON.stringify(value(0), null, 2).length;
    const boundary = value(65_536 - overhead);
    expect(JSON.stringify(snapshotProps(boundary), null, 2)).toHaveLength(65_536);
    expect(() => snapshotProps(value(65_537 - overhead))).toThrow("exceed");
  });

  it("stops traversing when the aggregate size budget is exhausted", () => {
    const inspect = vi.fn();
    const unvisited = new Proxy({}, { getPrototypeOf() { inspect(); return Object.prototype; } });
    expect(() => snapshotProps({ first: "x".repeat(40_000), second: "y".repeat(40_000), unvisited })).toThrow("exceed");
    expect(inspect).not.toHaveBeenCalled();
    expect(() => snapshotProps({ values: new Array(1_000_000_000) })).toThrow("exceed");
  });

  it("accepts plain JSON objects from another realm without accepting class instances", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const other = frame.contentWindow as Window & typeof globalThis;
    const value = other.JSON.parse('{"nested":{"points":[1,2]}}');
    expect(snapshotProps(value)).toEqual(value);
    expect(() => snapshotProps({ date: new other.Date() })).toThrow("plain JSON");
  });
});
