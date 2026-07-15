import { Fragment } from "react";
import { DocPageNav } from "../components/DocPageNav";

const supportedSyntax = [
  "Paragraphs, headings, blockquotes, thematic breaks, and hard breaks",
  "Ordinary bullet, ordered, and nested lists",
  "Flat task-list items with one paragraph",
  "Fenced and indented code blocks with generic info strings",
  "Emphasis, strong, inline code, links, images, and strikethrough",
  "Rectangular pipe tables with alignment and inline cell content",
] as const;

const unsupportedSyntax = [
  "YAML front matter and footnotes",
  "Inline or display math",
  "GitHub alerts and callouts",
  "Raw HTML and comments",
  "Directives and generated TOC markers",
  "Diagram semantics or previews",
] as const;

const normalizationExamples = [
  ["- item", "* item"],
  ["Heading\\n=======", "# Heading"],
  ["_em_ / __strong__", "*em* / **strong**"],
  ["Reference link definitions", "Inline links at each use"],
  ["CRLF or CR", "LF without a terminal newline"],
] as const;

export function MarkdownCompatibilityPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Markdown compatibility</span>
        <h2>A documented subset with normalized output.</h2>
        <p>
          Markora parses Markdown into a structured document. It preserves supported meaning, but it does
          {" "}not retain original source spelling, whitespace, markers, or reference-definition layout.
        </p>
        <p>
          Unsupported extensions are not yet preserved opaquely or rejected with an error. Constrain or
          {" "}validate input before import when the original source must remain recoverable.
        </p>
        <a
          className="button button-secondary"
          href="https://github.com/KevinWang15/markora/blob/main/packages/core/MARKDOWN_COMPATIBILITY.md"
          target="_blank"
          rel="noreferrer"
        >
          Read the complete fidelity contract
        </a>
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Supported shapes</span>
          <h3>Semantic import, normalized serialization</h3>
          <ul className="check-list compact">
            {supportedSyntax.map((syntax) => <li key={syntax}>{syntax}</li>)}
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">No preservation guarantee</span>
          <h3>Route these constructs elsewhere</h3>
          <ul className="check-list compact">
            {unsupportedSyntax.map((syntax) => <li key={syntax}>{syntax}</li>)}
          </ul>
          <p>
            A fenced <code>mermaid</code> block remains generic code; Markora does not interpret or execute it.
          </p>
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Canonical serialization</span>
        <h2>Expect source spelling to change.</h2>
        <div className="api-table">
          <div className="api-table-head">Input</div>
          <div className="api-table-head">Output</div>
          {normalizationExamples.map(([input, output]) => (
            <Fragment key={input}>
              <code className="api-cell">{input}</code>
              <code className="api-cell">{output}</code>
            </Fragment>
          ))}
        </div>
      </section>

      <DocPageNav />
    </div>
  );
}
