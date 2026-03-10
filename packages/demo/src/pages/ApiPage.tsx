const apiRows = [
  ["createEditor({ element, markdown, onChange, onTransaction, onChangeMode, ui })", "Creates the editor view and returns the host API."],
  ["editor.getMarkdown()", "Returns the current Markdown string."],
  ["editor.commands.setMarkdown(markdown, { emitChange })", "Replaces the document through the structured headless API."],
  ["editor.flushChange()", "Flushes any pending animation-frame batched markdown emission."],
  ["editor.state.can.* / editor.state.isActive.*", "Lets hosts derive toolbar and feature state without built-in UI."],
  ["editor.getToolbarState()", "Returns a compatibility snapshot for toolbar buttons."],
  [`editor.commands.toggleMark("strong" | "em" | "code" | "strike")`, "Applies inline formatting commands."],
  ["editor.commands.setLink() / removeLink()", "Creates or removes links without UI assumptions."],
  ["editor.commands.insertImage() / removeImage()", "Creates or removes images without UI assumptions."],
  ["editor.ui?.editLink() / editor.ui?.editImage()", "Optional namespaced UI entry points when overlays are attached."],
  ["editor.commands.undo() / editor.commands.redo()", "Runs history commands."],
  ["editor.destroy()", "Destroys the editor view and listeners."],
] as const;

export function ApiPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">API overview</span>
        <h2>Small surface area, enough control for real apps.</h2>
        <p>
          The library keeps its host API intentionally tight: markdown in, markdown out, structured commands/state, and
          optional compatibility helpers for existing integrations.
        </p>
      </section>

      <section className="panel doc-panel">
        <div className="api-table">
          <div className="api-table-head">Method</div>
          <div className="api-table-head">What it does</div>
          {apiRows.map(([method, description]) => (
            <>
              <code key={`${method}-method`} className="api-cell api-method">{method}</code>
              <div key={`${method}-description`} className="api-cell">{description}</div>
            </>
          ))}
        </div>
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Behavior notes</span>
          <ul className="check-list compact">
            <li>`editor.commands.setMarkdown()` is silent by default.</li>
            <li>`onChangeMode: "animationFrame"` helps smooth larger documents.</li>
            <li>`onTransaction` lets hosts observe view updates without forcing markdown serialization every time.</li>
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Feature coverage</span>
          <ul className="check-list compact">
            <li>Inline marks: bold, italic, code, strike, links</li>
            <li>Blocks: headings, quotes, lists, task lists, images, code fences, tables</li>
            <li>Editing polish: optional default UI, safer URLs, block cursor helpers, and table navigation</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
