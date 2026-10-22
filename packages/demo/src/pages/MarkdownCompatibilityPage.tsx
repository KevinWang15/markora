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

const opaqueSyntax = [
  "Conservative document-head YAML-like front matter",
  "Standalone display math",
  "CommonMark HTML blocks, inline HTML, and comments",
  "Balanced directive containers, leaves, and inline directives",
] as const;

const optionalSyntax = [
  ["markora-extension-components", "Typed custom components in component:name fences with host rendering and property editing"],
  ["markora-extension-frontmatter", "Exact-source document-head YAML-like front matter; no YAML runtime"],
  ["markora-extension-footnotes", "Semantic references, definitions, indexing, and navigation"],
  ["markora-extension-math", "Inline and block math source with an optional host renderer"],
  ["markora-extension-alerts", "GitHub-style NOTE, TIP, IMPORTANT, WARNING, and CAUTION blocks"],
  ["markora-extension-toc", "A generated heading outline represented in Markdown by [TOC]"],
  ["markora-extension-html", "Exact-source HTML atoms with optional host-sanitized block previews (root default runtime only)"],
  ["markora-extension-diagrams", "Mermaid, GeoJSON, TopoJSON, and STL fences with optional host renderers"],
] as const;

const normalizationExamples = [
  ["- item", "* item"],
  ["Heading\\n=======", "# Heading"],
  ["_em_ / __strong__", "*em* / **strong**"],
  ["Reference link definitions", "Inline links at each use"],
  ["CRLF or CR in supported syntax", "LF without a terminal newline"],
  ["Top-level opaque source", "Exact source island with canonical separators"],
] as const;

export function MarkdownCompatibilityPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Markdown compatibility</span>
        <h1>A documented dialect with predictable output.</h1>
        <p>
          Markora parses Markdown into a structured document. It preserves supported meaning, but it does
          {" "}not retain original source spelling, whitespace, markers, or reference-definition layout.
        </p>
        <p>
          The root entry conservatively retains recognized front matter,
          {" "}display math, HTML, comments, and directives are retained as inert exact-source atoms. Optional extension definitions can claim documented
          {" "}forms and add semantic editing without increasing the default bundle.
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

      <section className="docs-grid docs-three-up">
        <article className="doc-card">
          <span className="card-kicker">Base semantic dialect</span>
          <h2>Semantic import, normalized serialization</h2>
          <ul className="check-list compact">
            {supportedSyntax.map((syntax) => <li key={syntax}>{syntax}</li>)}
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Base exact-source fallback</span>
          <h2>Exact, inert source islands</h2>
          <ul className="check-list compact">
            {opaqueSyntax.map((syntax) => <li key={syntax}>{syntax}</li>)}
          </ul>
          <p>
            Raw HTML and script source is displayed as text, never executed. Downstream renderers still need independent sanitization.
          </p>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Opt-in semantics</span>
          <h2>Install syntax deliberately</h2>
          <p>
            Without <code>markora-extension-diagrams</code>, a fenced <code>mermaid</code> block remains generic code.
            The package adds source semantics and bounded host-rendered previews; it bundles no rendering engine.
          </p>
          <p>
            The same principle applies across the extension set: only an installed package may claim its documented
            {" "}fallback form. Other unrecognized syntax still has no preservation guarantee.
          </p>
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Official syntax packages</span>
        <h2>Choose the document semantics your product owns.</h2>
        <dl className="extension-package-list">
          {optionalSyntax.map(([packageName, description]) => (
            <div className="extension-package-row" key={packageName}>
              <dt>
                <a href={`https://github.com/KevinWang15/markora/tree/main/packages/${packageName.slice("markora-".length)}`}>
                  <code>{packageName}</code>
                </a>
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <p>
          Math, HTML, and diagram packages do not bundle renderer engines. Source mode remains complete without
          {" "}callbacks; if you add a renderer, the host still owns its dependency, policy, and output styling.
          {" "}Import each package&apos;s stylesheet explicitly and persist <code>editor.extensions.manifest</code> beside
          {" "}Markdown so future editors restore a compatible syntax graph before parsing the document.
        </p>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Canonical serialization</span>
        <h2>Expect supported source spelling to change.</h2>
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
