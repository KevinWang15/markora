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
          {" "}when you want built-in link, image, table, and code-fence metadata overlays. The quick start
          {" "}scopes the automatic theme to this embed; your surrounding application remains untouched.
        </p>
        <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
        <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
      </section>

      <section className="feature-strip docs-three-up">
        <article className="feature-card">
          <h3>Predictable Markdown</h3>
          <p>
            A published semantic dialect normalizes supported Markdown while conservative fallback nodes
            {" "}keep recognized unsupported source inert and exact.
          </p>
        </article>
        <article className="feature-card">
          <h3>Embedded lifecycle</h3>
          <p>
            Reconcile authoritative snapshots, observe cheap state events, flush at save boundaries, and
            {" "}tear down every owned resource with one idempotent call.
          </p>
        </article>
        <article className="feature-card">
          <h3>Mature interactions</h3>
          <p>
            Clipboard modes, table operations, task lists, typing assistance, lazy code runtimes, and
            {" "}host-owned file uploads cover the awkward parts of a real editor.
          </p>
        </article>
        <article className="feature-card">
          <h3>Opt-in syntax</h3>
          <p>
            Seven official packages add front matter, footnotes, math, alerts, TOCs, HTML, and diagrams
            {" "}without making any of them part of the base bundle.
          </p>
        </article>
        <article className="feature-card">
          <h3>Accessible by design</h3>
          <p>
            Keyboard operation, localized messages, RTL layout, forced-colors support, and scoped themes
            {" "}are built for product embeds rather than a fixed application shell.
          </p>
        </article>
        <article className="feature-card">
          <h3>Tested boundaries</h3>
          <p>
            Browser, package-isolation, accessibility, performance, and packed-consumer checks protect
            {" "}the integration points your host depends on.
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
          <span className="card-kicker">Embedded by design</span>
          <h3>Keep product policy in the host</h3>
          <p>
            Markora owns editing mechanics, not your application shell. Your host chooses persistence,
            {" "}revision handling, navigation, network access, uploads, renderer engines, and surrounding UI.
          </p>
          <ul className="check-list compact">
            <li>Mount in ordinary DOM or Shadow DOM and scope presentation per embed.</li>
            <li>Provide accessible upload progress, failure, Cancel, and Retry UI when enabling assets.</li>
            <li>Add only the syntax packages and renderer callbacks your document format requires.</li>
            <li>Persist the extension manifest beside Markdown whenever optional syntax is enabled.</li>
          </ul>
        </article>
      </section>

      <DocPageNav />
    </div>
  );
}
