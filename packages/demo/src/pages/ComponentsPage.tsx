import { useEffect, useRef, useState } from "react";
import { createEditor, type MarkdownEditor } from "markora";
import { createComponentRegistry, createComponentsExtension, type ComponentsExtension } from "markora-extension-components";
import { CodeBlock } from "../components/CodeBlock";
import { metricsChart } from "../components/metricsChart";
import "markora/styles.css";
import "markora-extension-components/styles.css";
import "./components.css";

const initialMarkdown = [
  "# Infrastructure overview",
  "A living runbook: write context in **Markdown**, then bring your own interactive components.",
  '```component:metrics-chart\n{\n  "title": "Production CPU",\n  "metric": "cpu",\n  "window": 15,\n  "color": "teal"\n}\n```',
  "## What to watch",
  "Keep CPU below **80%** during peak traffic. If utilization stays elevated, check the deployment timeline before scaling.",
].join("\n\n");

const exampleCode = `const chart = defineComponent({
  name: "metrics-chart",
  label: "Metrics chart",
  parseProps: chartSchema.parse,
  render({ element, props, signal }) {
    return mountChart(element, props, { signal });
  },
  edit({ props, update, cancel, signal }) {
    return openChartSettings({ props, onSave: update, onCancel: cancel, signal });
  },
});

const registry = createComponentRegistry([chart]);
const components = createComponentsExtension({ registry });
const editor = createEditor({ element, markdown, extensions: [components] });

editor.extensions.get(components).commands.insert(chart, {
  title: "Production CPU", metric: "cpu", window: 15, color: "teal",
});`;

export function ComponentsPage() {
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ editor: MarkdownEditor; extension: ComponentsExtension; register(): void; unregister(): void } | null>(null);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [editable, setEditable] = useState(true);
  const [registered, setRegistered] = useState(true);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [status, setStatus] = useState("Changes stay local to this page.");

  useEffect(() => {
    if (!mount.current) return;
    const registry = createComponentRegistry();
    let unregister = registry.register(metricsChart);
    const extension = createComponentsExtension({ registry });
    const editor = createEditor({
      element: mount.current,
      markdown: initialMarkdown,
      ariaLabel: "Infrastructure document",
      extensions: [extension],
    });
    const unsubscribe = editor.subscribe("state", () => setHistory({ undo: editor.state.can.undo(), redo: editor.state.can.redo() }));
    const stopSourcePreview = editor.subscribe("update", () => setMarkdown(editor.getMarkdown()));
    runtime.current = {
      editor, extension,
      register: () => { unregister = registry.register(metricsChart); },
      unregister: () => unregister(),
    };
    return () => {
      runtime.current = null;
      unsubscribe();
      stopSourcePreview();
      editor.destroy();
      unregister();
    };
  }, []);

  return <div className="doc-stack components-page">
    <section className="components-intro">
      <span className="card-kicker">CUSTOM COMPONENTS</span>
      <h1>Your product, inside the document.</h1>
      <p>Mix Markdown with charts, status cards, or any component you own. Typed properties, editable previews, and portable source—without a framework dependency.</p>
      <div className="components-badges"><span>Typed registration</span><span>Undo & redo</span><span>Host-owned rendering</span></div>
    </section>
    <section className="panel components-workspace" aria-label="Custom components playground">
      <header className="components-toolbar">
        <span><strong>Runbook</strong><small>Markdown + components</small></span>
        <button className="button button-primary" disabled={!editable || !registered} onClick={() => {
          const active = runtime.current;
          if (!active) return;
          active.editor.focus("end");
          active.editor.extensions.get(active.extension).commands.insert(metricsChart, { title: "HTTP requests", metric: "requests", window: 5, color: "blue" });
        }}>+ Insert chart</button>
        <button className="button button-secondary" disabled={!editable || !history.undo} onClick={() => runtime.current?.editor.commands.undo()}>Undo</button>
        <button className="button button-secondary" disabled={!editable || !history.redo} onClick={() => runtime.current?.editor.commands.redo()}>Redo</button>
      </header>
      <div className="components-editor" ref={mount} />
      <footer className="components-controls">
        <label><input type="checkbox" checked={!editable} onChange={event => {
          const next = !event.target.checked;
          setEditable(next);
          runtime.current?.editor.updateOptions({ editable: next });
        }} />Read-only</label>
        <label><input type="checkbox" checked={registered} onChange={event => {
          setRegistered(event.target.checked);
          if (event.target.checked) runtime.current?.register();
          else runtime.current?.unregister();
        }} />Chart registered</label>
        <button className="button button-secondary" onClick={() => {
          const editor = runtime.current?.editor;
          if (!editor) return;
          const saved = editor.getMarkdown();
          editor.commands.resetMarkdown(saved);
          setMarkdown(editor.getMarkdown());
          setStatus("Reloaded from Markdown. Properties and previews restored.");
        }}>Reload Markdown</button>
      </footer>
    </section>
    <p className="components-status" role="status">{status}</p>
    <details className="panel components-source" open>
      <summary>Portable Markdown <span>No hidden document state</span></summary>
      <pre data-component-markdown tabIndex={0} aria-label="Serialized Markdown">{markdown}</pre>
    </details>
    <section className="panel doc-panel">
      <span className="card-kicker">A SMALL, COMPOSABLE API</span>
      <h2>Define once. Register where you need it.</h2>
      <p>A definition pairs validation with a DOM renderer and an optional settings editor. Return a cleanup function to unmount your framework or disconnect a chart. Abort signals cancel outstanding work when a component changes or disappears.</p>
      <CodeBlock code={exampleCode} language="ts" title="markora-extension-components" />
      <p>Without a custom settings editor, Markora provides an accessible JSON editor. Unregistered or invalid components keep their source; registering them later restores their previews without changing the document. This example uses synthetic data and makes no network requests.</p>
      <a className="button button-secondary" href="https://github.com/KevinWang15/markora/tree/main/packages/extension-components">Read the component API contract</a>
    </section>
  </div>;
}
