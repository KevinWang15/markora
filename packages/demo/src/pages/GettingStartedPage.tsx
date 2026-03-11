import { CodeBlock } from "../components/CodeBlock";
import { installCommand, quickStartCode } from "../lib/content";

export function GettingStartedPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Getting started</span>
        <h2>Install the package and create an editor instance.</h2>
        <p>
          `markora` is framework-agnostic. You provide a host element, optional initial markdown,
          and callbacks for change or transaction observation.
        </p>
        <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
        <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
      </section>

      <section className="feature-strip docs-three-up">
        <article className="feature-card">
          <h3>Markdown-first</h3>
          <p>Import and export plain Markdown without hiding your content in a proprietary format.</p>
        </article>
        <article className="feature-card">
          <h3>App-friendly API</h3>
          <p>Use command helpers, toolbar state, `onChange`, `onTransaction`, and `flushChange` from the host app.</p>
        </article>
        <article className="feature-card">
          <h3>Polished defaults</h3>
          <p>Tables, task lists, links, images, and code blocks work out of the box with careful edge-case handling.</p>
        </article>
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Development</span>
          <h3>Smooth local workflow</h3>
          <p>`pnpm dev` watches the core package and runs the React docs/demo site together.</p>
          <ul className="check-list compact">
            <li>`pnpm dev` — editor watcher plus docs site</li>
            <li>`pnpm build` — package and docs build</li>
            <li>`pnpm release:check` — package dry run</li>
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Use cases</span>
          <h3>Great fit for product surfaces</h3>
          <p>Ship internal docs, knowledge bases, release notes, AI-assisted drafting, or customer-facing note editors.</p>
          <ul className="check-list compact">
            <li>Docs and wiki products</li>
            <li>SaaS text editors</li>
            <li>Internal tools and note-taking</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
