const examples = [
  {
    title: "Product docs editor",
    summary: "Use the editor for knowledge bases, release notes, and internal documentation where markdown fidelity matters.",
    snippet: `const editor = createEditor({
  element,
  markdown: initialDoc,
  onChange(saveDraft),
  onChangeMode: "animationFrame",
});`,
  },
  {
    title: "AI draft review surface",
    summary: "Let an LLM generate markdown drafts, then hand them to users in a clean visual editor before publishing.",
    snippet: `editor.setMarkdown(aiDraft, { emitChange: true });
editor.flushChange();`,
  },
  {
    title: "Toolbar-driven CMS field",
    summary: "Bind the toolbar state into your app shell and expose only the controls your product wants to support.",
    snippet: `const state = editor.getToolbarState();
if (state.link.enabled) {
  editor.setLink("https://example.com");
}`,
  },
  {
    title: "Source-of-truth markdown storage",
    summary: "Persist the serialized markdown output directly so your backend stays plain-text and portable.",
    snippet: `onChange(markdown) {
  debouncedSave({ markdown });
}`,
  },
] as const;

const recipes = [
  {
    heading: "Sync with external state",
    body: "Use `setMarkdown()` when upstream content changes, and call `flushChange()` if you need immediate serialized output after the update.",
  },
  {
    heading: "Observe editor behavior",
    body: "Use `onTransaction` when you want analytics, selection awareness, or app-level reactions without serializing markdown on every keystroke.",
  },
  {
    heading: "Start with the live demo",
    body: "The `/demo` route in this docs site is already wired against the published package entrypoint, so it doubles as an integration reference.",
  },
] as const;

export function ExamplesPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Examples</span>
        <h2>Patterns for real apps, not just toy demos.</h2>
        <p>
          These examples show where Markora fits best: places where you want a Typora-like writing
          experience, but still need app-level control over storage, workflows, and UI.
        </p>
      </section>

      <section className="examples-grid">
        {examples.map((example) => (
          <article key={example.title} className="doc-card example-card">
            <span className="card-kicker">Use case</span>
            <h3>{example.title}</h3>
            <p>{example.summary}</p>
            <pre><code>{example.snippet}</code></pre>
          </article>
        ))}
      </section>

      <section className="docs-grid docs-grid-two">
        {recipes.map((recipe) => (
          <article key={recipe.heading} className="feature-card">
            <h3>{recipe.heading}</h3>
            <p>{recipe.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
