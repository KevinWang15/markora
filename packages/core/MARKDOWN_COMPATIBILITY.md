# Markdown dialect and fidelity contract

Status: current `markora` `0.0.x` contract, updated and verified for `EE-019` on 2026-07-17.

This contract applies to Markdown passed through `createEditor({ markdown })`, `editor.commands.reconcileMarkdown()`, or `editor.commands.resetMarkdown()` and returned by `editor.getMarkdown()` or `onChange`. Deprecated `setMarkdown()` uses the same parsing boundary as `resetMarkdown()`.

## Read this before storing arbitrary Markdown

Markora is a structured editor, not a byte-preserving source editor. Import parses Markdown into a ProseMirror document immediately, and export writes a canonical representation of that document. Calling `getMarkdown()` without making an edit can therefore return different text from the input. The exception is the source carried by the deliberately recognized opaque constructs below.

The current dialect is a CommonMark-derived subset plus GFM-style pipe tables, strikethrough, and flat task-list items. It is not a claim of full CommonMark or GFM conformance.

Only use serialized Markora output as the sole stored copy when input is constrained to the supported dialect, plus the documented opaque shapes, and the normalizations below are acceptable. The current release has:

- no byte-for-byte lexical round-trip guarantee;
- exact source preservation for the conservative opaque shapes documented below;
- no preflight validator or structured unsupported-syntax error.

Syntax outside both the supported dialect and the recognized opaque shapes can still be reinterpreted, flattened, escaped, or dropped without an exception. Hosts accepting arbitrary Markdown should retain the original source, validate it before import, or offer a broader raw-source path.

## Fidelity labels

| Label | Meaning | Current guarantee |
| --- | --- | --- |
| Semantic round-trip | The represented editor structure and content survive `parse -> serialize -> parse`. Source spelling is not promised. | Available only for the supported shapes below. |
| Lexical round-trip | Original bytes, markers, escapes, whitespace, and reference definitions survive. | None. |
| Normalized output | The construct is supported semantically and exported in Markora's canonical spelling. | This is the normal guarantee for supported syntax. |
| Opaque preservation | Recognized source is retained as an inert atom rather than interpreted as editable structure. | Available only for the conservative block and inline shapes below. |
| Unsupported / rejected | The construct is outside the dialect and import reports an error instead of changing it. | No runtime error path exists yet. |
| Unsupported — unreported | The construct is outside the dialect, but the current permissive parser accepts or reinterprets it without a fidelity guarantee. | Transitional behavior documented below. |

## Supported dialect

| Construct | Accepted forms | Fidelity and limits |
| --- | --- | --- |
| Paragraphs and plain text | CommonMark paragraph text | Semantic round-trip for text content. Soft source line breaks become spaces, and surrounding block whitespace normalizes. |
| Headings | ATX levels 1–6 and Setext headings | Normalized to ATX `#` markers without optional closing hashes. |
| Blockquotes | CommonMark `>` blocks with supported child blocks | Normalized marker layout. Soft line breaks inside a paragraph become spaces. |
| Thematic breaks | CommonMark asterisk, hyphen, or underscore forms | Normalized to `---`. |
| Bullet lists | Ordinary lists using one marker style, including supported nested blocks | Normalized to `*` markers. Adjacent lists separated only by a different marker are a known limitation. |
| Ordered lists | Period or parenthesis delimiters with a start of 1 or greater | Normalized to period delimiters and explicit sequential numbering. A start of `0` is not supported reliably. |
| Task lists | Flat `[ ]`, `[x]`, or `[X]` items directly inside a bullet list | Normalized to `* [ ]` and `* [x]`. Nested lists or additional blocks inside task items are not supported reliably. |
| Code blocks | Indented blocks and backtick or tilde fences, with an optional info string | Code text and the complete normalized info string are semantic content. Surrounding info whitespace is trimmed on import and command input. Output uses a fence longer than delimiter runs in the body, choosing tildes when the info contains a backtick; the original fence character and length are otherwise not retained. NUL/CR/LF cannot occur in info, and raw NUL/CR code text injected through advanced transactions cannot be serialized exactly. |
| Emphasis and strong | CommonMark `*`/`_` and `**`/`__` forms | Normalized to `*emphasis*` and `**strong**`. |
| Inline code | CommonMark code spans | Code text is semantic content; delimiter length and padding normalize as needed. |
| Strikethrough | `~~text~~` | Markora/GFM-style extension with normalized `~~` markers. |
| Hard breaks | Backslash or two-space line breaks | Normalized to a backslash followed by LF. A soft line break is not a hard break. |
| Links | Inline links, CommonMark angle autolinks, and full/collapsed reference links, with optional titles | Normalized to inline links. Reference labels, definitions, and autolink spelling are not retained. Bare GFM URL/email autolinks are not enabled. |
| Images | Inline and reference images with alt text and optional titles | Normalized to inline image syntax after the per-editor URL policy. The default `data:` subset and limits are described below. |
| Pipe tables | Rectangular header/delimiter/body tables, optional outer pipes, alignment colons, and supported inline cell content | Normalized to outer pipes and `---` dividers. Default, left, center, and right alignment are retained. Literal pipes, including pipes in code spans, must be escaped. The semantic round-trip promise requires one unmerged cell with one paragraph per grid position and column headers in the first row. |

Code-block language loading affects only the embedded CodeMirror experience. Registry lookup does not constrain a syntactically valid normalized info string, so metadata remains generic even when no language package or renderer exists. Serialization rejects non-normalized surrounding info whitespace or NUL/line-break characters injected through advanced transactions instead of silently changing them.

## Opaque source preservation

Markora recognizes the following unsupported constructs and stores their source in `raw_block` or `raw_inline` atoms. They serialize as source rather than as escaped editor text, but they do not gain semantic editing or rendering behavior.

| Construct | Recognized shape | Opaque kind and limits |
| --- | --- | --- |
| YAML-like front matter | At the document head only: a `---` opener, a matching `---` or `...` closer, and at least one mapping-looking key between them | `frontmatter`. This is a conservative boundary detector, not a YAML parser or validator. A thematic-break sequence without a mapping entry is not front matter. |
| Display math | Either a complete `$$ ... $$` construct on one otherwise standalone line, or content between standalone `$$` delimiter lines | `display-math`. Inline `$...$` and `$$...$$` embedded in prose remain unsupported and are not classified as opaque math. |
| HTML blocks and comments | HTML block shapes recognized by the CommonMark tokenizer, including comments, declarations, CDATA, `script`, and `style` blocks | `html-block` or `html-comment`. Source is inert; it is never inserted into the editor DOM as HTML. |
| Inline HTML and comments | Inline HTML tokens recognized by the CommonMark tokenizer | `inline-html` or `html-comment`. Opening and closing tags are separate atoms, so supported Markdown between them remains editable. |
| Directive containers | Balanced fences of at least three colons with a named or attribute-style opener and a compatible closing colon fence; nested containers are balanced as one outer source atom | `directive-container`. The contents are not parsed as editable Markdown. |
| Directive leaves | A standalone `::name` form with at least one balanced `[...]` or `{...}` payload and no trailing non-whitespace text | `directive-leaf`. |
| Inline directives | A `:name` form with at least one balanced `[...]` or `{...}` payload | `inline-directive`. Supported text around the atom remains editable. |

All CommonMark backtick and tilde fences remain supported generic code blocks, regardless of their info string or whether a CodeMirror language loader exists. They follow the normalized code-block contract; they are not opaque extension containers. The public `unknown-fence` kind is reserved for a future explicitly recognized non-CommonMark fenced extension. Markora does not currently guess that arbitrary punctuation fences are extensions.

For a top-level opaque block, the stored `source` begins at the construct's first source character and ends at the last character of its closing or final line. It excludes that line's terminator and every following blank separator line. Within that boundary, Markora preserves the original BOM, line endings (including CRLF or CR), indentation, delimiter spelling, escapes, and whitespace. Top-level inline atoms preserve their exact original tokenizer span, including an internal CRLF or CR. Inter-block spacing and the document's terminal-newline policy remain serializer-owned, so the text surrounding an opaque atom can still normalize. Opaque nodes parsed inside supported containers can inherit the container tokenizer's marker, indentation, and line-ending normalization; the exact original-source guarantee applies at the document top level.

Opaque nodes render with text-only DOM operations as non-editable atoms. HTML, comments, scripts, styles, and directive payloads are displayed as source and are never executed by the editor. Enabling HTML tokenization is only a classification step; it does not make a raw node a live DOM subtree.

A host can provide a source editor with `onEditOpaqueMarkdown`:

```ts
const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  onEditOpaqueMarkdown({ kind, source, update }) {
    openHostSourceEditor({
      label: kind,
      source,
      onSave(nextSource) {
        if (!update(nextSource)) {
          showSourceConflict();
        }
      },
    });
  },
});
```

The editor exposes an **Edit source** control only when this hook is present. `update(nextSource)` returns `true` when the change is accepted (including an unchanged value) and `false` when the request is stale because the atom was removed, replaced, or changed after the hook opened. A successful update is an undoable editor transaction. It replaces the atom's source under its existing opaque kind; it does not parse, validate, or reclassify the new string. Hosts should provide explicit save/cancel behavior, validate source as their product requires, and handle a `false` result instead of silently overwriting newer content.

## Canonical output

These transformations are intentional and happen on import/export even when the user makes no visual edit.

| Input characteristic | Canonical output |
| --- | --- |
| CRLF or CR line endings in supported parsed syntax | LF |
| Line endings within a top-level recognized opaque block | Retained inside the atom; the separator after the atom is serializer-selected LF |
| Line endings inside a top-level opaque inline span | Retained inside the atom; supported text around it still follows normal paragraph serialization |
| Terminal newline | Removed |
| Excess blank lines between blocks | Serializer-selected block spacing, usually one blank line |
| Soft line break inside a paragraph | A space |
| Two-space hard break | Backslash hard break |
| `-` or `+` bullet marker | `*` |
| Ordered `3)` delimiter | `3.` |
| Task `[X]` | `[x]` |
| Setext heading or closing ATX hashes | Opening ATX hashes |
| Tilde or indented code block | A safe backtick fence, except an info string containing a backtick requires a safe tilde fence |
| `_em_` and `__strong__` | `*em*` and `**strong**` |
| Reference link or image | Inline destination and title at every use |
| Unused reference definition | Removed |
| Angle URL or email autolink | Inline link syntax |
| Character entity such as `&copy;` | Decoded Unicode text |
| Backslash escape | Re-emitted only where the serializer needs an escape |
| Table without outer pipes | Table with leading and trailing pipes |

Interior spaces in ordinary text are generally retained. Leading/trailing paragraph spaces, trailing spaces that carry no hard-break meaning, marker indentation, and escape spelling are not lexical data in this contract.

## Clipboard import and export boundary

Normal paste prefers rich HTML over `text/markdown` because an internal HTML slice can retain schema information that canonical Markdown cannot encode, such as a table body row header. If HTML is absent, `text/markdown` enters through the same per-editor parser, extension codec, and URL sanitizer as other Markdown parsing boundaries. Plain text is never auto-detected as Markdown. Ctrl/Cmd-Shift-V and `commands.pastePlainText()` keep Markdown-looking punctuation literal; `commands.pasteMarkdown()` makes the opposite choice explicit.

Supported external HTML is converted through schema DOM rules. Paragraphs, marks, lists and portable task checkboxes, links, images, code blocks, and tables become the corresponding document nodes. A `language-*` or `lang-*` class on a `<pre><code>` child supplies a conservative code-fence info token. Unsupported DOM, executable attributes, and unsafe built-in URLs are discarded; raw HTML supplied through Markdown is preserved only through the inert opaque-source rules above. This is still not a publishing sanitizer.

Outer copy exposes semantic HTML, canonical Markdown, and a human-readable plain representation when the event clipboard accepts them. Canonical Markdown is the fidelity representation for code fences/languages, table alignment, list/task state, links, images, marks, opaque source, and extension syntax. HTML additionally carries private slice context for same-editor structure. Plain text is intended for human-readable destinations and can omit syntax-only information such as link destinations or code-fence language. Nested code selection is deliberately plain source; select the complete outer code block when fenced Markdown is required. A browser-native range split across active CodeMirror and outer ProseMirror is a safety boundary: Markora emits browser-projected plain text and prevents destructive cut because Firefox/WebKit do not expose one consistent cross-owner range.

A rectangular table-cell selection is exported as semantic table HTML, quoted TSV in `text/plain`, and a complete standalone pipe table in `text/markdown`. Tabs, line breaks, and double quotes inside TSV cells use CSV-style double-quote escaping. Because a standalone pipe table requires a header, the first row of a body-only selection becomes the clipboard Markdown header; this does not change the source table. Cut clears the selected cell contents without deleting rows or columns. When pasting a table or TSV matrix into a cell rectangle, a larger matrix is clipped and a smaller matrix is repeated to fill that rectangle. TSV parsing is limited to 1 MiB and 100 rows by 100 columns. Merged or over-limit table transfers are rejected atomically and emit the recoverable `"table-operation-rejected"` error event.

## Table editing and GFM diagnostics

Table creation, before/after insertion, row/column movement, rectangular deletion/alignment, and exact row/column-count resizing preserve the simple rectangular GFM shape. The first row is always the pinned column-header row. “Resize” means changing logical row or column counts; Markora does not persist pixel column widths in Markdown. Shrinking refuses to discard non-empty cells unless the caller explicitly passes `discardContent: true`.

Rich HTML and trusted extensions or `editor.view` transactions can represent table structures outside the pipe-table dialect. `editor.state.tableIssues()` reports the current live occurrences of:

| Code | GFM fidelity problem |
| --- | --- |
| `ragged-row` | A row does not have the table's required rectangular width. |
| `missing-column-header` | A first-row cell is not a column header. |
| `merged-cell` | A cell has a row or column span. |
| `multi-block-cell` | A cell does not contain exactly one paragraph. |
| `row-header-scope` | A body header has HTML-only row scope. |

Diagnostics contain the table's document position plus zero-based row and optional column coordinates. The query is non-mutating and reports model shapes, not source syntax: it is neither an import rejection path nor a general unsupported-Markdown validator. Hosts that accept rich HTML, custom table extensions, or raw ProseMirror transactions should check it before treating serialized Markdown as the sole stored representation. GFM serialization cannot retain merged cells, multiple/nested blocks, or row-header scope.

## URL and embedded-content policy

`CreateEditorOptions.resources` defines one per-editor stored-URL policy. Markora applies its final sanitizer after Markdown parsing, rich paste (including extension clipboard and raw-plugin slice transforms), input rules, built-in UI and commands, asset-upload results, and runtime URL resolution. A host-approved custom scheme therefore reaches the final policy instead of being discarded by Markdown-it's fixed allowlist, while an earlier paste contribution cannot bypass the clamp.

The defaults are:

- links allow relative URLs plus `http:`, `https:`, `mailto:`, and `tel:`;
- images allow relative URLs plus `http:`, `https:`, and `data:`;
- both reject URL userinfo unless `allowCredentials: true` is explicit; the flag does not control cookies or fetch credentials;
- image `data:` URLs allow exactly AVIF, GIF, JPEG, PNG, and WebP;
- a `data:` URL is limited to 1,048,576 decoded payload bytes and 1,398,358 source characters;
- images load with `crossOrigin: null` and `referrerPolicy: "no-referrer"` unless configured otherwise.

Protocol-relative URLs, backslashes, embedded whitespace or ASCII controls, malformed URLs, and unlisted schemes are rejected; surrounding whitespace is trimmed. `javascript:` and `vbscript:` cannot be enabled. A custom protocol can be listed explicitly; relative URLs can be disabled; and `data:` requires both the protocol and an exact allowed MIME type. The byte limit counts decoded base64 or percent-decoded UTF-8 bytes. Absolute URLs can be canonicalized by the browser URL parser, for example `https://example.com` becomes `https://example.com/`.

A rejected parsed link loses the link mark but keeps its label text. A rejected image node is removed. These outcomes also apply when `markdown`, `reconcileMarkdown()`, or `resetMarkdown()` imports a document under a stricter host policy, so hosts must configure the policy before loading content and must not assume that changing policy later can recover discarded structure.

Runtime URL resolution does not change serialization. `resolveUrl` receives a sanitized stored destination and a `"load"` or `"open"` purpose; its return value is checked again and is used only for that action. Returning `null` denies the action. `loadImage` may then return a policy-checked string or an ephemeral `Blob`; Blob object URLs are display-only and never enter Markdown. Similarly, uploaded files enter the document only through the sanitized URL returned by the host's `resources.assets.upload` callback.

This policy is an editor/import safety boundary, not a publishing boundary or sandbox around raw ProseMirror. Hosts must still validate destinations for their product, authorize resolver/loader/upload requests, and sanitize any later HTML rendering. Trusted extensions, raw `editor.view` transactions, and host callbacks execute with application authority; they must not construct unvalidated URL attrs, and downstream renderers must not treat accepted editor Markdown as pre-sanitized HTML.

Migration from the earlier fixed sanitizer preserves the prior rejection of protocol-relative and unlisted schemes while intentionally tightening other paths. Embedded credentials, ambiguous backslash forms, embedded controls/whitespace, non-raster or unbounded image data, and oversized `data:` payloads that previously survived some insertion paths are now removed consistently. Configure explicit protocols, credential opt-in, data MIME types, and limits before importing a document only when the host has reviewed that broader policy; `javascript:` and `vbscript:` remain impossible to opt into.

## Unsupported syntax policy

This table distinguishes the narrow shapes protected as opaque source from related syntax that is still outside the contract. “Behavior today” for unsupported shapes is observational, not a supported serialization format.

| Construct | Classification | Behavior today |
| --- | --- | --- |
| YAML front matter | Opaque for the recognized document-head shape; otherwise unsupported — unreported | A conservatively bounded document-head block with a mapping-looking key is preserved. Other metadata syntaxes can be interpreted as ordinary Markdown. |
| Footnotes | Unsupported — unreported | Labels and definitions can become ordinary reference links or escaped text; definitions can disappear. |
| Math | Opaque for recognized standalone display math; inline math unsupported — unreported | Standalone `$$` block shapes are preserved. Inline `$...$` and `$$...$$` in prose may survive accidentally as text but have no math fidelity guarantee. |
| GitHub alerts/callouts | Unsupported — unreported | Parsed as an ordinary blockquote; the alert marker is text and source lines can fold together. |
| Raw HTML and comments | Opaque for CommonMark-recognized block and inline shapes | Stored and displayed as inert source atoms, not rendered HTML. Syntax outside the tokenizer's recognized HTML shapes remains unsupported. |
| Directives and container syntax | Opaque for the balanced container, leaf, and inline shapes above; otherwise unsupported — unreported | Recognized shapes are preserved. Unbalanced or different directive dialects can still be treated as ordinary Markdown text. |
| TOC markers such as `[TOC]` | Unsupported — unreported | Treated as literal text and normally backslash-escaped on output. |
| Mermaid and other diagrams | Diagram semantics unsupported; fenced code normalized | A fenced `mermaid` block survives only as a generic code block. Markora does not render or validate the diagram. |
| Other Markdown extensions | Unsupported — unreported | No preservation guarantee unless the construct is fully representable as a supported generic code block or plain text. |

Opaque raw HTML is not executed by the editor because its source is rendered only as text. The serialized Markdown still contains the original HTML or script source. Downstream renderers must apply their own HTML and URL sanitization; editor display safety is not a publishing security boundary.

## Known shape limitations

Even a supported construct must stay within the shapes listed above:

- task items must be flat; nested lists, extra paragraphs, and code blocks inside a task item can drift on reparse;
- escaping an `[x]`-like prefix at the start of a bullet item does not reliably opt out of task conversion;
- adjacent lists distinguished only by bullet marker or ordered delimiter can merge after normalization;
- ordered lists starting at zero normalize incorrectly to one;
- pipe-table rows must match the header width; permissive imports can pad missing cells or discard extras, while live ragged rows created through trusted escape hatches are reported by `state.tableIssues()`;
- table cells must remain unmerged and contain supported inline content in one paragraph; merged, multi-block, and HTML row-header structures are reported but do not round-trip as pipe-table structure;
- bare URLs, `www.` addresses, and bare email addresses remain plain text unless written as CommonMark angle autolinks.

These limitations are outside the semantic round-trip promise. They are candidates for conformance coverage and later editor work, not implicit extensions of the dialect.

## Host integration rules

1. Constrain generated or user-supplied Markdown to this dialect and, when needed, the documented opaque shapes before initial creation, `reconcileMarkdown()`, or `resetMarkdown()`.
2. Treat `getMarkdown()` as normalized output with exact source islands, not the original document string.
3. Do not use raw string equality as the only dirty-state check across initial import.
4. If syntax outside the documented supported and opaque shapes is possible, retain the original separately and provide a recovery or broader source-editing path.
5. Use `onEditOpaqueMarkdown` when users must edit protected source, and handle a stale `update()` result explicitly.
6. Configure `resources` before import when stored URLs need a non-default scheme or data policy; use runtime resolution instead of rewriting stable Markdown for signed/display URLs.
7. If `resources.assets` is enabled, persist upload results in the host service and provide accessible progress, failure, cancel, and retry UI around the headless event/API surface.
8. Call `state.tableIssues()` before persistence when rich HTML, extensions, or advanced ProseMirror transactions can introduce non-GFM table shapes, and retain another representation when any reported construct must survive.
9. Sanitize the final rendering surface independently; inert editor rendering is not an HTML-rendering security boundary.

The characterization tests are in [`markdownDialect.test.ts`](https://github.com/KevinWang15/markora/blob/main/packages/core/test/markdownDialect.test.ts), with representative [golden documents](https://github.com/KevinWang15/markora/tree/main/packages/core/test/fixtures/markdown-roundtrip) and reviewed [opaque-source cases](https://github.com/KevinWang15/markora/tree/main/packages/core/test/fixtures/opaque-markdown). Broader CommonMark/GFM conformance and corpus tests live alongside them in the core test suite.
