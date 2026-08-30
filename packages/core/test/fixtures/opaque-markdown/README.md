# Opaque Markdown fixture contract

`cases.json` is the reviewed, versioned fixture manifest for EE-004 opaque-source preservation. The examples are original test material and contain no production or customer data.

Every case records its complete Markdown input, reviewed whole-document serialization in `expected`, and the ordered opaque nodes expected after parsing. Each opaque-node record deliberately contains only the public fidelity payload under test: `kind` and exact `source`.

The classifications have the following meanings:

- `opaque-block` expects one or more block atoms whose source is emitted without Markdown escaping.
- `opaque-inline` expects inline atoms while supported text and marks around them remain editable and normalize normally.
- `negative` expects no opaque node. Its output is the existing canonical serializer result for supported Markdown or plain text.

For block nodes, `source` starts at the construct's first character and ends at the final character of its last source line. It excludes both that line's terminator and any following blank separator line. Internal line endings remain exact, including CRLF or CR. This convention preserves BOM, indentation, delimiter spelling, and internal whitespace while leaving inter-block separation and the document-wide trailing-newline contract to the serializer. The BOM/CRLF fixture therefore retains CRLF between opaque source lines and uses canonical LF after the closing delimiter.

Inline HTML opening and closing tags are separate `inline-html` nodes so supported content between them remains editable. A top-level inline atom retains its exact original span, including internal CRLF or CR; supported container normalization can still apply outside that boundary. HTML comments use `html-comment` for both block and inline placement. Nested directive containers are represented by one outer `directive-container`; nested source is not duplicated as child opaque-node expectations.

Recognition is deliberately conservative. Front matter is recognized only at the document head. Display math must occupy a standalone line or balanced standalone delimiter lines. Autolinks take precedence over HTML, while currency, angle comparisons, time punctuation, code spans, and fenced-code bodies must not be misclassified.

Valid CommonMark link-reference definitions retain exact source in the root codec while their uses resolve normally. All CommonMark backtick and tilde fences remain supported generic code blocks even when their info strings are unknown to the syntax-highlighting registry or contain extension-style attributes. They retain the published normalized-code contract. `unknown-fence` is reserved for a future explicitly recognized non-CommonMark fenced extension; this fixture version does not invent a detector for arbitrary punctuation.

Raw HTML is source only. Tests and NodeViews must display it using text nodes or `textContent`; no fixture source may be parsed into DOM elements or executed.
