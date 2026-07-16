import { CodeBlock } from "../components/CodeBlock";
import { DocPageNav } from "../components/DocPageNav";
import { installCommand, quickStartCode } from "../lib/content";

const lifecycleCode = `const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ariaLabel: "Document body",
  initialSelection: "end",
  onChange(nextMarkdown) {
    saveDraft(nextMarkdown); // Coalesced idle delivery is the default.
  },
});

const unsubscribe = editor.subscribe("update", ({ origin, selection }) => {
  renderToolbar(selection);
  markDocumentDirty(origin); // Synchronous and serialization-free.
});

editor.focus();

form.addEventListener("submit", () => {
  editor.flushChange();
  markdownField.value = editor.getMarkdown();
});

// When your host screen unmounts:
unsubscribe();
editor.destroy();`;

export function GettingStartedPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Getting started</span>
        <h2>Install the packages and mount an editor instance.</h2>
        <p>
          <code>markora</code> is framework-agnostic and headless by default. Add <code>markora-ui</code>
          {" "}when you want the repo&apos;s built-in link, image, and table overlays.
        </p>
        <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
        <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
      </section>

      <section className="feature-strip docs-three-up">
        <article className="feature-card">
          <h3>Headless core</h3>
          <p>
            <code>markora</code> owns parsing, serialization, commands, state, and embedded CodeMirror
            {" "}code-block editing.
          </p>
        </article>
        <article className="feature-card">
          <h3>Optional default UI</h3>
          <p>
            <code>markora-ui</code> adds the built-in link editor, image editor, and table toolbar so
            {" "}you do not have to build those overlays first.
          </p>
        </article>
        <article className="feature-card">
          <h3>Extensible languages</h3>
          <p>
            Use <code>codeBlockLanguages</code> when you want to add or override lazy-loaded fenced code
            {" "}block support.
          </p>
        </article>
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Lifecycle</span>
          <h3>Subscribe, focus, and destroy safely</h3>
          <p>
            Keep a stable host element, use the typed focus and event APIs, and call <code>editor.destroy()</code>
            {" "}when the surrounding screen or component unmounts. Idle <code>onChange</code> delivery is the default, so
            {" "}rapid edits coalesce without synchronous full-document serialization. Use <code>update</code> for cheap dirty
            {" "}signals, and pair <code>flushChange()</code> with <code>getMarkdown()</code> when submission needs the latest
            {" "}snapshot immediately. Unsubscribe and destroy are both idempotent; destroy performs a final flush.
          </p>
          <CodeBlock code={lifecycleCode} language="ts" title="Lifecycle" />
        </article>
        <article className="doc-card">
          <span className="card-kicker">Development</span>
          <h3>Use the repo workflows</h3>
          <p>
            The workspace ships a docs site, packed-consumer smoke test, and an internal fixture lab for
            {" "}regression work.
          </p>
          <ul className="check-list compact">
            <li><code>pnpm dev</code> — core watcher plus docs/demo site</li>
            <li><code>pnpm dev:ui</code> — watch the optional UI package only</li>
            <li><code>pnpm check</code> — workspace validation and test suite</li>
            <li><code>/__dev</code> — internal fixture route for tables, tasks, quotes, and code blocks</li>
          </ul>
        </article>
      </section>

      <DocPageNav />
    </div>
  );
}
