# Markdown dialect and fidelity contract

Status: current `markora` `0.0.x` behavior, verified on 2026-07-15.

This contract applies to Markdown passed through `createEditor({ markdown })` or `editor.commands.setMarkdown()` and returned by `editor.getMarkdown()` or `onChange`.

## Read this before storing arbitrary Markdown

Markora is a structured editor, not a byte-preserving source editor. Import parses Markdown into a ProseMirror document immediately, and export writes a canonical representation of that document. Calling `getMarkdown()` without making an edit can therefore return different text from the input.

The current dialect is a CommonMark-derived subset plus GFM-style pipe tables, strikethrough, and flat task-list items. It is not a claim of full CommonMark or GFM conformance.

Only use serialized Markora output as the sole stored copy when input is constrained to the supported dialect and the normalizations below are acceptable. The current release has:

- no byte-for-byte lexical round-trip guarantee;
- no opaque node that preserves unsupported source;
- no preflight validator or structured unsupported-syntax error.

Unsupported constructs can be reinterpreted, flattened, escaped, or dropped without an exception. Hosts accepting arbitrary Markdown should retain the original source, validate it before import, or offer a raw-source path until opaque preservation is implemented.

## Fidelity labels

| Label | Meaning | Current guarantee |
| --- | --- | --- |
| Semantic round-trip | The represented editor structure and content survive `parse -> serialize -> parse`. Source spelling is not promised. | Available only for the supported shapes below. |
| Lexical round-trip | Original bytes, markers, escapes, whitespace, and reference definitions survive. | None. |
| Normalized output | The construct is supported semantically and exported in Markora's canonical spelling. | This is the normal guarantee for supported syntax. |
| Opaque preservation | Unsupported source is retained verbatim without being interpreted. | None. Planned in `EE-004`. |
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
| Code blocks | Indented blocks and backtick or tilde fences, with an optional info string | Code text and the info string are semantic content. Output uses a safe backtick fence; the original fence character and length are not retained. |
| Emphasis and strong | CommonMark `*`/`_` and `**`/`__` forms | Normalized to `*emphasis*` and `**strong**`. |
| Inline code | CommonMark code spans | Code text is semantic content; delimiter length and padding normalize as needed. |
| Strikethrough | `~~text~~` | Markora/GFM-style extension with normalized `~~` markers. |
| Hard breaks | Backslash or two-space line breaks | Normalized to a backslash followed by LF. A soft line break is not a hard break. |
| Links | Inline links, CommonMark angle autolinks, and full/collapsed reference links, with optional titles | Normalized to inline links. Reference labels, definitions, and autolink spelling are not retained. Bare GFM URL/email autolinks are not enabled. |
| Images | Inline and reference images with alt text and optional titles | Normalized to inline image syntax after URL sanitization. Markdown import supports the raster data-URL subset described below. |
| Pipe tables | Rectangular header/delimiter/body tables, optional outer pipes, alignment colons, and supported inline cell content | Normalized to outer pipes and `---` dividers. Default, left, center, and right alignment are retained. Literal pipes, including pipes in code spans, must be escaped. |

Code-block language loading affects only the embedded CodeMirror experience. Any fenced info string is accepted as generic code metadata even when no language package or renderer exists.

## Canonical output

These transformations are intentional and happen on import/export even when the user makes no visual edit.

| Input characteristic | Canonical output |
| --- | --- |
| CRLF or CR line endings | LF |
| Terminal newline | Removed |
| Excess blank lines between blocks | Serializer-selected block spacing, usually one blank line |
| Soft line break inside a paragraph | A space |
| Two-space hard break | Backslash hard break |
| `-` or `+` bullet marker | `*` |
| Ordered `3)` delimiter | `3.` |
| Task `[X]` | `[x]` |
| Setext heading or closing ATX hashes | Opening ATX hashes |
| Tilde or indented code block | Backtick fence |
| `_em_` and `__strong__` | `*em*` and `**strong**` |
| Reference link or image | Inline destination and title at every use |
| Unused reference definition | Removed |
| Angle URL or email autolink | Inline link syntax |
| Character entity such as `&copy;` | Decoded Unicode text |
| Backslash escape | Re-emitted only where the serializer needs an escape |
| Table without outer pipes | Table with leading and trailing pipes |

Interior spaces in ordinary text are generally retained. Leading/trailing paragraph spaces, trailing spaces that carry no hard-break meaning, marker indentation, and escape spelling are not lexical data in this contract.

## URL and embedded-content policy

Imported and pasted link/image attributes are sanitized after parsing:

- links allow relative URLs plus `http:`, `https:`, `mailto:`, and `tel:`;
- images created through commands allow relative URLs plus `http:`, `https:`, and `data:`;
- Markdown image import applies Markdown-it's narrower `data:image/(gif|png|jpeg|webp);...` rule, so other data-image forms have no round-trip guarantee;
- protocol-relative URLs, malformed URLs, and other schemes are rejected;
- a rejected parsed link loses the link mark but keeps its label text;
- a rejected image node is removed;
- absolute URLs can be canonicalized by the browser URL parser, for example `https://example.com` becomes `https://example.com/`.

Syntax the Markdown tokenizer itself refuses as a link can remain escaped literal text rather than following the parsed-link behavior. Hosts must still validate URLs and sanitize any later HTML rendering according to their own security policy.

## Unsupported syntax policy

The constructs below have no semantic, lexical, or opaque fidelity guarantee. “Behavior today” explains observed `0.0.x` behavior; it is not a supported serialization format.

| Construct | Classification | Behavior today |
| --- | --- | --- |
| YAML front matter | Unsupported — unreported | Delimiters and fields can become thematic breaks, headings, paragraphs, or lists. Metadata structure is lost. |
| Footnotes | Unsupported — unreported | Labels and definitions can become ordinary reference links or escaped text; definitions can disappear. |
| Inline and display math | Unsupported — unreported | Simple inline delimiters may survive accidentally as text. Multiline display math folds into paragraph text. |
| GitHub alerts/callouts | Unsupported — unreported | Parsed as an ordinary blockquote; the alert marker is text and source lines can fold together. |
| Raw HTML and comments | Unsupported — unreported | HTML parsing is disabled, so source becomes editor text rather than DOM. Multiline blocks normalize whitespace and are not opaque. |
| Directives and container syntax | Unsupported — unreported | Treated as paragraph text; multiline structure and escapes can change. |
| TOC markers such as `[TOC]` | Unsupported — unreported | Treated as literal text and normally backslash-escaped on output. |
| Mermaid and other diagrams | Diagram semantics unsupported; fenced code normalized | A fenced `mermaid` block survives only as a generic code block. Markora does not render or validate the diagram. |
| Other Markdown extensions | Unsupported — unreported | No preservation guarantee unless the construct is fully representable as a supported generic code block or plain text. |

Raw HTML is not executed by the editor because it is parsed as text. That does not make serialized Markdown safe to render as HTML elsewhere: downstream renderers must apply their own HTML and URL sanitization.

## Known shape limitations

Even a supported construct must stay within the shapes listed above:

- task items must be flat; nested lists, extra paragraphs, and code blocks inside a task item can drift on reparse;
- escaping an `[x]`-like prefix at the start of a bullet item does not reliably opt out of task conversion;
- adjacent lists distinguished only by bullet marker or ordered delimiter can merge after normalization;
- ordered lists starting at zero normalize incorrectly to one;
- pipe-table rows should match the header width; missing cells can be padded and extra cells can be discarded;
- table cells should contain supported inline content in one paragraph; multi-block cells do not round-trip as pipe-table structure;
- bare URLs, `www.` addresses, and bare email addresses remain plain text unless written as CommonMark angle autolinks.

These limitations are outside the semantic round-trip promise. They are candidates for conformance coverage and later editor work, not implicit extensions of the dialect.

## Host integration rules

1. Constrain generated or user-supplied Markdown to this dialect before calling `setMarkdown()`.
2. Treat `getMarkdown()` as normalized output, not the original source string.
3. Do not use raw string equality as the only dirty-state check across initial import.
4. If unsupported input is possible, retain the original separately and provide a recovery or source-editing path.
5. Sanitize the final rendering surface independently; editor import sanitization is not an HTML-rendering security boundary.

The characterization tests are in [`markdownDialect.test.ts`](https://github.com/KevinWang15/markora/blob/main/packages/core/test/markdownDialect.test.ts), with representative [golden documents](https://github.com/KevinWang15/markora/tree/main/packages/core/test/fixtures/markdown-roundtrip). Broader CommonMark/GFM conformance and corpus testing is tracked by `EE-003`.
