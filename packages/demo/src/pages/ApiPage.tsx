const apiRows = [
  ["createEditor({ element, markdown, onChange, onTransaction, onChangeMode })", "Creates the editor view and returns the host API."],
  ["editor.getMarkdown()", "Returns the current Markdown string."],
  ["editor.setMarkdown(markdown, { emitChange })", "Replaces the document, optionally re-emitting `onChange`."],
  ["editor.flushChange()", "Flushes any pending animation-frame batched markdown emission."],
  ["editor.getToolbarState()", "Returns active/enabled state for toolbar buttons."],
  ["editor.toggleBold() / toggleItalic() / toggleCode() / toggleStrike()", "Applies inline formatting commands."],
  ["editor.setLink() / editLink() / removeLink()", "Creates, edits, or removes links."],
  ["editor.insertImage() / editImage() / removeImage()", "Creates, edits, or removes images."],
  ["editor.undo() / redo()", "Runs history commands."],
  ["editor.destroy()", "Destroys the editor view and listeners."],
] as const;

export function ApiPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">API overview</span>
        <h2>Small surface area, enough control for real apps.</h2>
        <p>
          The library keeps its host API intentionally tight: markdown in, markdown out, toolbar state, media actions,
          and a handful of command helpers for integration work.
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
            <li>`setMarkdown()` is silent by default.</li>
            <li>`onChangeMode: "animationFrame"` helps smooth larger documents.</li>
            <li>`onTransaction` lets hosts observe view updates without forcing markdown serialization every time.</li>
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Feature coverage</span>
          <ul className="check-list compact">
            <li>Inline marks: bold, italic, code, strike, links</li>
            <li>Blocks: headings, quotes, lists, task lists, images, code fences, tables</li>
            <li>Editing polish: overlays, safer URLs, block cursor helpers, and table navigation</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
