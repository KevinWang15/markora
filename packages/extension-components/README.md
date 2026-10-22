# markora-extension-components

Typed, editable, host-rendered **block components** inside Markdown. Use charts, status cards, maps, or application-specific widgets without building ProseMirror nodes or adopting a UI framework.

Works with both `markora` and `markora/minimal`. The core bundle is unchanged. No chart engine, framework, schema library, network client, or executable document syntax is bundled.

## Install

```sh
npm install markora markora-extension-components
```

## Define and register

```ts
import { createEditor } from "markora";
import {
  defineComponent,
  createComponentRegistry,
  createComponentsExtension,
} from "markora-extension-components";
import "markora/styles.css";
import "markora-extension-components/styles.css";

const metricCard = defineComponent({
  name: "metric-card",
  label: "Metric card",
  parseProps(value: unknown) {
    const props = value as { title?: unknown; value?: unknown };
    if (typeof props.title !== "string" || typeof props.value !== "number") {
      throw new TypeError("Expected a title and numeric value.");
    }
    return { title: props.title, value: props.value };
  },
  render({ element, props }) {
    const heading = element.ownerDocument.createElement("strong");
    heading.textContent = `${props.title}: ${props.value}`;
    element.append(heading);
  },
});

const registry = createComponentRegistry([metricCard]);
const components = createComponentsExtension({ registry });
const editor = createEditor({ element, markdown, extensions: [components] });
const api = editor.extensions.get(components);

api.commands.insert(metricCard, { title: "CPU utilization", value: 34.8 });
api.commands.update(metricCard, { title: "CPU utilization", value: 42 });
```

`parseProps` infers the property type throughout rendering, editing, insertion, updates, and state queries. A schema library's synchronous `.parse` function can be used instead. Names are stable, case-sensitive lowercase kebab-case identifiers, up to 100 characters; labels are presentation only. Definitions and registries have no browser dependency and can be created during SSR.

`parseProps` must be a pure, synchronous decoder: the same input should produce the same output, without changing editor state or registration. It receives a deeply frozen JSON object and may validate, supply defaults, or derive display properties. Its result must also be a JSON object. Parsing runs independently for write validation, rendering, editing, and state queries; do not rely on a particular call count. **Submitted data is persisted, not the parser's result.** Transformations therefore never compound merely through validation or serializing/reloading Markdown. Defaults and transformations affect the returned snapshots; to persist a migration, explicitly submit the migrated properties. Passing a parsed snapshot back to `update()` is an explicit submission: use idempotent normalization for editable properties, or convert derived display values back to their stored representation before submitting.

Registration is explicit and never driven by document source:

```ts
const unregister = registry.register(anotherComponent);
registry.has("metric-card");
registry.get("metric-card");
registry.getAll();
unregister();
```

Duplicate names throw. The idempotent unregister function removes only its registration. Registries can be shared across editors deliberately, or created per embed for isolation. Registration changes refresh matching previews, not Markdown or history. Removing a registration preserves every occurrence as inert source; registering the name again restores its previews. Unrelated registrations do not interrupt open editors or renderers.

## Markdown contract

````markdown
# Production

```component:metric-card
{"title":"CPU utilization","value":34.8}
```

Write ordinary Markdown around the component.
````

The extension claims only fences whose entire trimmed info string is `component:<name>`. The existing Markdown tokenizer owns indentation, nested lists/quotes, and closing delimiters. Tilde fences and unclosed fences are also accepted. Serialization uses backticks, lengthens the fence around embedded backtick runs, normalizes line endings to LF, and retains the body text—including invalid JSON and unknown component names. Original delimiter spelling and indentation are not retained. API inserts and typed updates validate once, then serialize the submitted properties as two-space-indented JSON; source edits preserve their submitted formatting.

Without this extension, the same Markdown is an ordinary code fence. Without a matching registry entry, it is an inert component with a source editor. Invalid properties and renderer failures show a safe source fallback; Markdown never invokes JavaScript or loads a component by name. Components are atomic blocks, not inline widgets or containers for editable Markdown children.

Persist `editor.getMarkdown()` and `editor.extensions.manifest`. Restore compatible definitions and the extension before loading the document. Component definitions and their schemas are application configuration, not part of the extension manifest. Hosts own property migrations and compatibility of each stable component name.

## Rendering and lifecycle

`render({ element, props, editable, signal })` receives a fresh mount in the editor's owner document and a deeply frozen JSON snapshot. Mount a chart, a web component, or a framework root there. Return a cleanup function to disconnect observers, clear timers, unsubscribe, or unmount a framework root.

`ComponentReadonly<T>` expresses that immutability in TypeScript, including nested objects, arrays, and tuples. Command inputs and edit updates accept these snapshots as well as ordinary mutable values; create new values instead of mutating a snapshot.

Callbacks are **synchronous** and return `void` or a cleanup function, not a Promise. For asynchronous work, start it inside the callback, handle rejections, and use the supplied signal. The signal aborts before cleanup when properties or editable state change, registration disappears, or the node/editor is destroyed. A fresh mount is used on each render; late asynchronous writes cannot overwrite the current preview. Presentation changes do not create editor transactions.

```ts
render({ element, props, signal }) {
  const chart = mountChart(element, props);
  void fetchMetrics(props, { signal }).then(data => {
    if (!signal.aborted) chart.setData(data);
  }).catch(error => {
    if (!signal.aborted) showChartError(element, error);
  });
  return () => chart.destroy();
}
```

Render and edit callbacks are **trusted application code**, not sandboxed HTML renderers. They own output accessibility, URL/network policy, escaping, and any event listeners outside the provided mount. Do not assign untrusted properties to `innerHTML`. The package's fallback UI uses `textContent`. Renderer/edit/cleanup exceptions use Markora's existing `error` event channel. Validation failures on imported documents stay local to the source fallback.

## Editing

Every editable block has an accessible JSON properties editor, with validation feedback, Apply/Cancel, Escape to cancel, and Ctrl/Cmd+Enter to apply. A definition can add a host-owned settings UI:

```ts
edit({ anchor, props, update, cancel, signal }) {
  return openSettingsDialog({
    anchor,
    initialValues: props,
    onSave: update,
    onCancel: cancel,
    signal,
  });
}
```

`update(nextProps)` validates and commits one undoable change, then closes the edit session. It throws on invalid properties and returns `false` when the session is stale, the original node changed/disappeared, registration changed, or the editor became read-only/is composing. Capture this request for asynchronous dialogs; **do not cache numeric positions across asynchronous work**. Unchanged nodes can move when surrounding text changes without invalidating the request. `cancel()` aborts the session without changing Markdown. Return cleanup to remove the settings UI and restore focus. Only one session per component is active; opening another cancels the old one.

Read-only mode hides editing controls and blocks mutation commands and outstanding update callbacks. Unknown or invalid components always use the source editor. A custom settings editor is offered alongside the source editor for valid registered components.

The request's `anchor` is the component element. Use `anchor.ownerDocument` and `anchor.getRootNode()` to place settings UI correctly in iframe or Shadow DOM embeds, rather than assuming the global document.

## Commands and state

```ts
const { commands, state } = editor.extensions.get(components);

commands.insert(metricCard, { title: "CPU", value: 42 });
commands.update(metricCard, { title: "CPU", value: 55 }, position);
commands.updateSource('{"title":"CPU","value":55}', position);
commands.edit(position);
commands.remove(position);

state.getNodes();
state.getSelected();
state.getProps(metricCard, position);
```

- `insert()` replaces a text selection, but never a selected block: with a component (or other block) selected, the new component goes right after it and becomes selected. Consecutive inserts therefore add components in order.
- Optional positions default to the current component node selection. Positions are synchronous ProseMirror offsets, not persistent identifiers.
- Commands return `false` for unavailable targets, unregistered definitions, read-only/composition states, and document mutations that do not change source. `edit()` returns whether an editor was opened.
- Malformed command properties/source throw through Markora's extension error boundary. `updateSource()` requires a JSON object and, when registered, valid component properties; it cannot be used to introduce malformed JSON. Imported malformed source remains preserved and repairable.
- `getNodes()` returns frozen `{ name, position, source }` snapshots; `getSelected()` returns one snapshot or `null`. `getProps()` returns a frozen, validated typed snapshot or `null` for missing, invalid, or differently registered targets.
- Component mutation commands integrate with editor history, change events, clipboard serialization, reconciliation, and managed block navigation. Rendered DOM is never serialized into Markdown or clipboard content.
- Properties must be a plain JSON object containing finite numbers, strings, booleans, null, arrays, or other plain objects, including objects from another window/iframe. Cycles, sparse arrays, symbols, accessors, hidden properties, and class instances are rejected. Source is limited to 65,536 UTF-16 code units; snapshots to 32 nesting levels and 65,536 code units of two-space-indented JSON. An incremental size budget stops cloning once exhausted, including string escaping, keys, and indentation. Oversized imported source remains visible/preserved but is not rendered. Property enumeration and trusted application callbacks (including proxies) are not a sandbox or a hard execution-time limit.
- `createComponentsExtension({ registry, messages })` accepts partial overrides of `defaultComponentMessages` for all built-in controls and fallback copy. Host validation messages are owned by `parseProps`.

## Development

```sh
pnpm --filter markora-extension-components build
pnpm --filter markora-extension-components typecheck
pnpm --filter markora-extension-components test
pnpm --filter markora-extension-components benchmark
pnpm exec playwright test tests/browser/components.required.spec.ts --project=chromium
pnpm exec playwright test tests/browser/components-embed.required.spec.ts
```

The docs demo at `/docs/components` includes an editable metrics chart, live Markdown, registration toggling, read-only mode, and reload/history controls. Browser coverage includes direct CDP input, DOM snapshots, screenshots, accessibility checks, mobile layout, iframe/Shadow DOM embeds, and lifecycle transitions.

The component index maps existing occurrences through transaction steps and scans only changed ranges. Attribute/mark-only steps use structural diffs; validation and indexing share the same scan. Tests compare incremental results with full rebuilds, preserve identities across wrapping/movement, and assert bounded subtree traversal in a 10,000-paragraph document. The benchmark reports index/validation overhead separately from editor layout and host rendering, with 1,000/10,000 paragraphs and 1/100 components; timings are diagnostic, not machine-dependent CI gates.
