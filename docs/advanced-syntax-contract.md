# Markora advanced-syntax extension contract

- Status: Accepted implementation contract for `EE-021`
- Accepted: 2026-07-18
- Scope: embedded `markora` and `markora/minimal` editors

This document freezes the product, fidelity, packaging, rendering, security,
accessibility, and verification boundaries for Markora's optional advanced
syntax. It is normative for `EE-021`; a feature is not complete merely because
its parser or preview works in isolation.

The existing [extension-system RFC](./extension-system-rfc.md) remains the
kernel contract. The
[Markdown compatibility contract](../packages/core/MARKDOWN_COMPATIBILITY.md)
continues to describe released behavior and must be updated as each package
ships.

## Decisions

1. Advanced syntax ships in seven separate npm packages. None is added to the
   default preset, imported by `markora`, or discovered through a registry.
2. Every package works with both `markora` and `markora/minimal`, except
   `markora-extension-html`, which is deliberately root-only because it depends
   on the compatibility codec's exact opaque-HTML token hydration.
3. Syntax and source representation never depend on a preview renderer. The
   editor can parse, edit, copy, serialize, reset, reconcile, and undo every
   installed syntax with no renderer configured.
4. Renderers are host-injected callbacks. Markora does not bundle, download,
   auto-discover, or dynamically import KaTeX, MathJax, Mermaid, a YAML form
   renderer, an HTML sanitizer, or any other rendering engine.
5. A renderer returns DOM owned by the editor's `Document`, or a
   `DocumentFragment`. Renderer strings, `TrustedHTML`, `innerHTML`,
   `outerHTML`, `insertAdjacentHTML`, and equivalent raw-HTML sinks are not part
   of the extension contract.
6. Front matter and raw HTML retain exact source islands. Footnotes, math,
   alerts, TOC markers, and diagram fences have semantic/canonical Markdown
   contracts described below. Preview DOM is derived state and is never
   serialized.
7. The installed extension manifest is part of the persistence boundary. An
   absent extension does not acquire an implied preservation guarantee beyond
   the documented base-editor fallback.

## Packages and entry-point support

| Package | Definition factory | Manifest identity | Root | Minimal |
| --- | --- | --- | --- | --- |
| `markora-extension-frontmatter` | `createFrontmatterExtension()` | `markora-extension-frontmatter` | Supported | Supported |
| `markora-extension-footnotes` | `createFootnotesExtension()` | `markora-extension-footnotes` | Supported | Supported |
| `markora-extension-math` | `createMathExtension()` | `markora-extension-math` | Supported | Supported |
| `markora-extension-alerts` | `createAlertsExtension()` | `markora-extension-alerts` | Supported | Supported |
| `markora-extension-toc` | `createTocExtension()` | `markora-extension-toc` | Supported | Supported |
| `markora-extension-html` | `createHtmlExtension()` | `markora-extension-html` | Supported | Rejected |
| `markora-extension-diagrams` | `createDiagramsExtension()` | `markora-extension-diagrams` | Supported | Supported |

Each package:

- is side-effect-free ESM and peer-depends on a compatible `markora` version;
- imports public constructors and types through `markora/extension-api`;
- exports its definition factory and public types from `.`;
- exports `./styles.css` explicitly when it renders document UI, with that CSS
  as its only declared package side effect;
- owns a stable schema/token/manifest identity and follows the extension RFC's
  SemVer rules;
- exposes dialect-changing JSON configuration in its manifest entry, while
  renderer, source-editor, localization, URL-policy, and other trusted runtime
  callbacks remain outside the manifest;
- has no static or dynamic dependency on any of the other six feature packages.

The public definition identity deliberately matches the unscoped package name.
Public packages do not use the kernel-reserved `markora/*` or `@markora/*`
extension namespaces.

`markora-extension-html` declares root-only compatibility and must fail with an
attributed `EXTENSION_INCOMPATIBLE` error before the host is claimed when used
with `markora/minimal`. It must not silently accept normalized or reconstructed
HTML in place of the compatibility codec's exact top-level and inline source
spans.

## Source-claim foundation

Before the feature packages ship, the shared extension kernel must expose
stable claim points for document-head front matter, display math, blockquotes,
HTML block/inline tokens, and specialized fenced-code info strings. A specific
installed syntax runs before the generic opaque, blockquote, paragraph, or code
fallback in either host extension order.

The claim boundary must provide the exact top-level source span where this
contract promises exact fidelity. Optional packages must not read private
Markdown-it environment keys or replace foundation parser/serializer handlers.
A successful claim emits a token owned by that package and maps to a schema
node owned by that package; generic opaque preservation and generic code remain
the fallback when no package claims the source.

The front-matter, footnote, math, alert, TOC, and diagram claims must be
available in the shared root/minimal kernel. Exact HTML token hydration remains
in the compatibility codec and is the only root-only claim in `EE-021`.

## Fidelity and absent-extension behavior

| Feature | Installed-package fidelity | Renderer absent or failed | Package absent |
| --- | --- | --- | --- |
| Front matter | Exact source island, including BOM, delimiter spelling, indentation, comments, whitespace, and internal line endings | Exact source shell remains editable and serializes unchanged | Root retains its conservative opaque front-matter atom; minimal retains its existing unsupported/unreported behavior |
| Footnotes | Semantic round-trip with canonical reference and definition layout | Semantic reference/definition DOM remains; Markdown is unchanged | Existing unsupported/unreported behavior; definitions may be reinterpreted or lost |
| Math | Canonical `$...$` or `$$` shell with expression source retained as node content | Source shell remains readable/editable and serializes canonically | Root preserves recognized standalone display math opaquely; inline math and minimal behavior remain unsupported/unreported |
| Alerts | Semantic round-trip with canonical GitHub blockquote markers and uppercase kind | Editable alert DOM remains; Markdown is unchanged | Existing ordinary-blockquote fallback; the alert marker may be escaped or folded |
| TOC | Canonical standalone `[TOC]` marker; generated outline is never serialized | Generated outline uses the package's built-in source-safe DOM and needs no external renderer | Existing unsupported/unreported literal-text behavior; the marker normally escapes on output |
| HTML | Exact CommonMark-recognized block/inline/comment source; preview is derived | Exact inert source view remains; no preview DOM survives a failure | Root retains exact opaque HTML atoms; minimal is outside this package's compatibility contract |
| Diagrams | Semantic diagram node with canonical safe fence and complete normalized info string/body | Exact diagram text remains in a source shell and serializes as a generic safe fence | Existing generic fenced-code behavior in root and minimal |

“Exact source island” has the same boundary as the current opaque-source
contract: source inside the atom is exact, while inter-block spacing and the
document terminal-newline policy remain serializer-owned. “Canonical” means
`parse -> serialize -> parse` preserves represented semantics, not authored
delimiter, marker, indentation, or line-ending spelling.

Hosts that persist any non-default syntax must store
`editor.extensions.manifest` beside Markdown and load a compatible extension
set before editing. The table above is a recovery description, not permission
to discard that manifest.

## Syntax contracts

### YAML front matter — Jekyll form

The package recognizes one document-head block only:

- an optional UTF-8 BOM followed immediately by a standalone `---` opener;
- one or more source lines containing at least one YAML mapping-looking key;
- a standalone `---` closer, or the already-supported YAML document-end `...`
  closer;
- no preceding blank line, prose, comment, or second front-matter block.

Jekyll's `---` closer is the documented authoring form. The `...` closer is
accepted to preserve the existing exact-source boundary. TOML `+++`, JSON
metadata, YAML without a closing delimiter, and thematic breaks without a
mapping-looking entry are not claimed.

Raw source is authoritative. Parsed YAML, diagnostics, key summaries, or host
forms are derived state and must not rewrite comments, anchors, aliases, key
order, scalar style, quoting, or delimiters unless the host explicitly submits
new source. Invalid or over-limit YAML remains an exact source node with a
recoverable diagnostic; it never becomes executable data.

Only one front-matter node may occur, at document position zero. Commands,
Markdown paste, rich paste, drag/drop, and raw transactions must not silently
create a second or non-head front-matter block. The extension either rejects
that insertion atomically with an attributed diagnostic or keeps it literal;
it never serializes a non-head node as active front matter.

### Footnotes — GitHub form

The package recognizes:

```md
Text with a reference.[^note]

[^note]: Footnote text.
```

- A reference is `[^label]` outside code, HTML, math, and escaped text.
- A definition begins at a block boundary with `[^label]:`.
- The label is the trimmed, non-empty text between `[^` and `]`; `]` and line
  endings are forbidden. Matching is case-sensitive after trimming.
- A definition's first supported block may begin after the colon. Further
  supported blocks use four-space continuation indentation.
- Repeated references are supported and receive deterministic back-reference
  order based on document order.
- An unresolved reference and every duplicate definition remain represented and
  serialize canonically. The first definition in document order resolves the
  label; duplicates and unresolved labels are exposed as non-destructive state
  diagnostics.
- GitHub-style inline footnotes such as `^[text]` are not accepted in version 1.

References serialize as `[^label]`. Definitions serialize at their model
position with `[^label]: ` on the first line and canonical four-space
continuations. Rendering may collect definitions visually, but visual placement
does not reorder Markdown or mutate the document.

### Inline and block math — GitHub form

Inline math uses `$expression$` on one source line. An opening delimiter must
not be escaped, followed by whitespace, or immediately preceded by an ASCII
letter or digit. A closing delimiter must not be escaped, preceded by
whitespace, or immediately followed by an ASCII letter or digit. The expression
must be non-empty. These boundaries keep common currency text out of math.

Block math uses either a standalone `$$expression$$` line or content between
standalone `$$` delimiter lines. Canonical output always uses:

```md
$$
expression
$$
```

Code spans, code blocks, escaped dollar signs, unmatched delimiters, and
delimiter-looking text inside a diagram or raw-HTML source node are not math.
Inline source retains its expression characters; block source retains its
expression lines with canonical LF line endings and canonical delimiters.

The package does not interpret TeX commands as HTML, URLs, JavaScript, or
network requests. A configured renderer is presentation-only.

### Alerts — GitHub form

The package recognizes a blockquote whose first content line is exactly one of:

```md
> [!NOTE]
> [!TIP]
> [!IMPORTANT]
> [!WARNING]
> [!CAUTION]
```

Surrounding horizontal whitespace on the marker line is ignored. Kinds are
case-insensitive on input and serialize uppercase. The marker line contains no
custom title or trailing content. Following supported blockquote content is the
editable alert body; nested supported blocks are retained. A malformed or
unknown marker remains an ordinary blockquote.

Canonical Markdown writes the marker as the first quoted line and serializes
the body with the ordinary canonical blockquote rules. Version 1 does not accept
the demo-only `:::note` directive form as an alert.

### Generated TOC — Typora form

The package recognizes a standalone line whose trimmed content is `[toc]`,
matched case-insensitively. Canonical output is:

```md
[TOC]
```

Leading and trailing horizontal whitespace around the standalone marker is
accepted and normalized away. A marker embedded in prose, escaped, placed in a
code span or block, or used as list/blockquote content is not claimed in
version 1.

The node generates an outline from document headings at levels 1 through 6 in
document order. Generated labels and nesting update after heading text, level,
order, insertion, deletion, undo/redo, reset, and reconciliation. Generated
entries are derived DOM only: they do not enter copy Markdown, persistence, or
the undo history. Activating an entry moves the model selection to its heading;
it does not depend on global slug IDs or navigate the embedding page.

Multiple TOC nodes are allowed and show the same current outline. A document
with no headings renders a localized empty state while retaining the marker.

### Raw HTML — CommonMark/GitHub form

The package claims the compatibility codec's currently recognized CommonMark
HTML blocks, inline HTML, and comments. It retains the exact hydrated source
span and never reparses preview DOM back into Markdown.

Version 1 previews complete block HTML atoms only. Inline HTML and comments
remain exact, source-editable atoms because opening and closing inline tags are
separate tokenizer spans and reconstructing a live subtree would change the
supported Markdown between them. This limitation is explicit rather than
guessing a cross-node HTML tree.

Preview is opt-in and requires a host renderer that acts as the product's HTML
parser/sanitizer and returns DOM. Markora still applies the non-bypassable DOM
clamp below. Without that callback, or after any parse, policy, render, or clamp
failure, the exact inert source view remains.

### Diagrams — GitHub fenced-code forms

The package recognizes fenced code whose first normalized info-string token is
one of:

- `mermaid`
- `geojson`
- `topojson`
- `stl`

Matching is case-sensitive, following GitHub's documented fenced forms. The
complete normalized info string and body remain model data. Any other info
string is ordinary code. Backtick, tilde, and fence-length spelling normalize
through Markora's existing safe code-fence serializer; a body delimiter run can
never truncate output.

Each kind requires an explicitly configured host renderer. No Mermaid, mapping,
3D, remote-service, or worker implementation is bundled. A kind without a
renderer uses the source shell and still serializes as a valid generic fence.

## Host renderer contract

The math, HTML, and diagram factories may accept package-specific renderers with
this common behavioral shape:

```ts
type AdvancedSyntaxRenderRequest<TKind extends string> = Readonly<{
  kind: TKind;
  source: string;
  ownerDocument: Document;
  signal: AbortSignal;
}>;

type AdvancedSyntaxRenderer<TKind extends string> = (
  request: AdvancedSyntaxRenderRequest<TKind>,
) =>
  | Node
  | DocumentFragment
  | Promise<Node | DocumentFragment>;
```

The concrete package types may add immutable source metadata, but they retain
these rules:

- Renderer callbacks are trusted runtime-only configuration captured by the
  extension factory. Changing one requires recreating the editor.
- Each invocation gets a fresh signal. Source change, retry, reset,
  reconciliation, node removal, preview deactivation, renderer replacement by
  editor recreation, and editor destruction abort the previous generation.
- A monotonically versioned result may commit only when the node, source,
  renderer, preview state, and editor lifecycle are still current. Late success
  and failure are ignored after cleanup.
- Renderer work begins outside the document transaction and outside the
  synchronous typing path. Expensive block previews activate only when near the
  viewport. One node's failure does not block editing or sibling previews.
- A missing callback, thrown exception, rejected promise, invalid return value,
  wrong-document node, already-connected node, or rejected DOM subtree emits an
  attributed recoverable extension error and restores the source presentation.
- The editor never passes renderer DOM to the Markdown serializer, clipboard
  Markdown, history, or extension storage.
- Strings and HTML-string wrapper types are rejected at runtime. Markora never
  assigns authored source or a renderer result to an HTML string sink.

## Non-bypassable security policy

Extensions run as trusted application code; this contract is defense in depth,
not a sandbox around a malicious callback. Renderer packages and services are
still explicitly audited by the host.

Before attaching returned DOM, the owning extension clones the approved subtree
into an extension-owned wrapper and applies a package-specific allowlist. At a
minimum it rejects or removes:

- `script`, `iframe`, `object`, `embed`, `base`, `meta`, `link`, executable
  SVG/MathML nodes, custom elements, and active form controls;
- `on*` event attributes, `srcdoc`, inline script, refresh directives, and
  namespace tricks;
- `javascript:` and `vbscript:` URLs in every spelling;
- network-capable `src`, `href`, `xlink:href`, CSS `url()`, `@import`, and
  equivalent references unless a package-specific host policy explicitly
  approves the normalized destination and purpose;
- `foreignObject`, external SVG use, animation/event elements, and IDs or URL
  fragments that escape the extension-owned namespace.

Default policy performs no network request and opens no link. Core
`CreateEditorOptions.resources` does not implicitly authorize an extension
renderer. Optional URL approval callbacks must document allowed protocols,
credentials, referrer behavior, cancellation, and navigation versus load
purpose.

Front-matter parsing uses a safe data schema: no object construction, custom
tags, executable values, prototype mutation, or implicit network access. It
bounds source bytes, nesting, alias count, and alias expansion. Math and diagram
packages bound source bytes, rendered node count, output bytes, and concurrent
renders. An over-limit operation leaves source intact and reports a recoverable
error.

Serialized Markdown remains untrusted input for every downstream publishing
surface. Safe editor preview does not certify later HTML rendering.

## Accessibility, localization, and visual ownership

Every factory accepts validated partial message overrides with frozen English
defaults. All package-owned visible text, action labels, node names, empty
states, loading/failure status, kind labels, and formatter output flow through
that package's message contract. Extension packages do not read core or
`markora-ui` message objects implicitly.

Package DOM inherits the editor's `lang` and computed `dir`. Package CSS uses
logical properties, public package-specific `--mdw-*` tokens, forced-colors
rules, and reduced-motion behavior. Styles are an explicit package CSS import;
the host owns product typography, surrounding controls, and renderer-specific
CSS.

The source representation is always a complete accessible fallback:

- front matter, math, HTML, and diagrams expose their source and kind through a
  stable accessible name even when a visual preview exists;
- renderer DOM is never the sole accessible representation of authored source;
- alerts expose kind independently of color and retain ordinary editable
  content navigation;
- footnote references and definitions expose deterministic reference,
  definition, and back-reference relationships without using authored labels as
  global DOM IDs;
- TOC output is a labelled navigation list whose entries move editor selection
  by keyboard without trapping focus;
- loading and failure announcements are polite, deduplicated, and do not fire
  after a stale render has been aborted;
- source/edit/preview/retry actions remain keyboard-invokable, composition-safe,
  read-only aware, and usable at 200% zoom.

## Per-feature acceptance matrix

| Package | Codec and fidelity evidence | Command/state evidence | Browser, accessibility, and safety evidence |
| --- | --- | --- | --- |
| Front matter | Jekyll opener/closers, BOM and mixed line endings, comments/anchors, invalid YAML, negative thematic breaks, one head node, exact copy/reset/reconcile | Insert or replace source, remove, inspect source/diagnostics; duplicate/non-head rejection; read-only, composition, undo/redo, origin and stale edit | Source editor handoff, invalid/over-limit fallback, keyboard boundary navigation, localized label, hostile YAML limits, root/minimal parity |
| Footnotes | References, multiline definitions, repeated/unresolved/duplicate labels, canonical continuation, whole and partial clipboard, reset/reconcile | Insert reference/definition, navigate both directions, rename/remove with explicit orphan behavior, pure diagnostics; one-step undo and selection restoration | Keyboard reference/back-reference flow, editor-scoped IDs across multiple editors/Shadow DOM, axe, read-only and paste-label collisions |
| Math | Currency/code/escape negatives, inline and both block inputs, canonical block shell, exact expression payload, Markdown/HTML/plain clipboard | Insert/edit/remove inline and block source, convert where valid, toggle/retry preview, render state query; no-op/read-only/composition/undo | Missing/throwing/rejecting/stale renderer, hostile DOM clamp, source fallback, AT source name, RTL, teardown and zero late commits in all engines |
| Alerts | Five kinds, case normalization, nested supported body blocks, malformed/unknown marker negatives, canonical blockquote output, clipboard | Wrap/toggle, set kind, unwrap, active/enabled state; selection/content preservation, one undo, extension origin | Editable contentDOM, kind without color, localization/RTL/contrast, keyboard and axe, ordinary blockquote remains unchanged |
| TOC | Standalone case-insensitive marker, canonical `[TOC]`, inline/code/list/blockquote negatives, generated output excluded from every serialization/clipboard representation, marker survives empty outline | Insert/remove and active/enabled state; duplicate policy, undo/redo, selection restoration | Live heading add/edit/level/reorder/reset updates, keyboard navigation by model position, labelled nav/empty state, Shadow DOM and duplicate headings |
| HTML | Exact hydrated block/inline/comment spans, block-preview-only boundary, Markdown copy/reset/reconcile, malformed source fallback, no preview serialization | Edit/update source through a stale-safe host handoff, toggle/retry block preview, source/render state; read-only and undo/redo | Root success and minimal pre-claim rejection, hostile HTML/SVG corpus, invalid/wrong-document/connected/string renderer rejection, no execution/network, accessible source fallback |
| Diagrams | Four exact info kinds, case/unknown negatives, complete info string, safe long-fence serialization, body edge cases, generic-code absent-package behavior | Insert/convert/update/remove, toggle/retry preview, kind/render state; code-selection and undo preservation | Per-kind missing/failure/stale renderer, SVG/DOM clamp, no network/navigation, accessible description/source, viewport activation, teardown across all engines |

“Command evidence” includes public declaration tests and package-consumer use of
the exact definition handle. Every mutating command is one guarded extension
transaction when successful, returns `false` without focus/history/events on a
semantic no-op, respects read-only and active composition, and reports its
qualified extension origin.

## Package, browser, and performance gates

### Package gates

For each package, retained automation must:

1. build declarations and ESM from the package itself;
2. pack and unpack its tarball into an isolated consumer rather than resolving
   workspace source;
3. typecheck its factory options, typed handle, messages, renderer request, and
   invalid API cases against packed `markora`;
4. execute one root consumer and one `markora/minimal` consumer; the HTML
   minimal consumer must assert the documented pre-claim incompatibility;
5. verify exports, files, license/readme, peer dependencies, side effects, and
   Node ESM import without browser globals;
6. bundle each package alone and in an all-seven consumer, proving that omitted
   packages and all renderer engines have no static or dynamic module path;
7. prove that importing none of the packages leaves the existing root and
   minimal graphs and default extension manifests unchanged.

### Browser gates

Every browser-facing row in the matrix is `@required` in Chromium, Firefox, and
WebKit. The retained matrix covers document and open-Shadow-DOM embeddings,
multiple simultaneous editors, editable/read-only transitions, keyboard-only
operation, IME-safe actions, copy/paste, undo/redo, reset/reconcile, renderer
failure/cancellation, removal, and teardown. Capability skips require an
explicit platform boundary and equivalent retained evidence; a package cannot
declare completion from Chromium-only preview testing.

Each package has a focused axe check plus behavior assertions. The all-seven
fixture additionally proves deterministic tokenizer ordering, independent
manifest entries, no NodeView/contribution collision, combined clipboard
round-trip, and complete cleanup with zero console errors, page errors, or
failed unexpected requests.

### Performance gates

Before a package is marked complete, checked-in budgets record its production
minified raw/gzip JavaScript, explicit CSS, static module count, and any emitted
chunks. Only crossed failure ceilings may be raised, and the completion note
records the exact delta. Source-only consumers must contain no renderer engine
or renderer CSS.

`pnpm perf:ci` must continue to pass the existing 100 KiB, 500 KiB, and 1 MiB
latency, hot-path, memory, teardown, and zero-retention gates with no optional
package installed and with the all-seven source features installed. Additional
feature workloads cover documents containing many references/definitions,
math nodes, alerts, TOCs, HTML atoms, and diagrams. They verify:

- no full-document serialization or renderer call enters synchronous typing;
- TOC/footnote document indexes update incrementally or within an approved
  measured bound;
- block renderers activate near the viewport rather than for every offscreen
  node;
- concurrency and output bounds hold under renderer pressure;
- abort controllers, observers, preview DOM, promises, and host callbacks are
  released after node removal, reset, failed creation, and destruction.

Final feature and foundation commits run the repository's applicable
`pnpm check`, required browser matrix, `pnpm pack:smoke`, `pnpm perf:ci`, and
`git diff --check` gates. The tracking plan remains the authority for status;
this contract does not itself mark any `EE-021` sub-item complete.
