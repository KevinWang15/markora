# markora-extension-math

Optional semantic inline and block math for embedded Markora editors. The
package works with both `markora` and `markora/minimal`; it is never included in
either default editor graph and does not bundle a TeX renderer.

## Install and use

```bash
npm install markora markora-extension-math
```

Minimal-entry consumers should import `markora/minimal.css` in place of `markora/styles.css` below.

```ts
import { createEditor } from "markora";
import {
  createMathExtension,
  type MathRenderRequest,
} from "markora-extension-math";
import "markora/styles.css";
import "markora-extension-math/styles.css";

const math = createMathExtension({
  renderer({ kind, source, ownerDocument, signal }: MathRenderRequest) {
    const output = ownerDocument.createElement(kind === "inline" ? "span" : "div");
    output.textContent = renderTrustedMathAsText(source, signal);
    return output;
  },

});

const editor = createEditor({
  element: document.querySelector<HTMLElement>("#editor")!,
  extensions: [math],
  markdown: "Inline $x^2$ and a block:\n\n$$\n\\sum_i x_i\n$$",
});

const handle = editor.extensions.get(math);
handle.commands.editSelection("inline"); // insert and immediately edit at the caret

const first = handle.state.getNodes()[0];
if (first) handle.commands.update(first, "x^3");
```

`renderer` and `onEditSource` are optional host callbacks captured by the
extension definition. They are runtime-only configuration, do not enter the
extension manifest, and require recreating the editor when changed. The exact
definition object passed to `createEditor()` provides the typed command and
state handle.

## In-place TeX editing

With no `onEditSource` override, clicking a formula opens its syntax-highlighted
TeX source in the document. Tab to a formula and press Enter to edit with the
keyboard. Source input uses a native textarea, with a non-interactive highlighted
mirror; clipboard, selection, Undo/Redo and IME remain native. Highlighting uses
text nodes, never source HTML, and follows the active theme. No React or additional
editor runtime is required, including with `markora/minimal`.

Valid source edits update the model immediately. Click outside or press Escape to
render; Escape keeps edits. Ctrl/Cmd+Enter or Tab moves into surrounding prose;
Shift+Tab moves backwards. Enter alone finishes inline math and inserts a newline
in display math. Clearing a formula removes it on exit. Invalid TeX stays in the
model and falls back to visible source when rendering fails. A temporary input
that cannot use Markdown math delimiters (for example, multiline inline source)
is retained as ordinary text on exit, so no entered source is silently lost.

`commands.edit(target)` focuses an existing formula using the usual stale-target
checks. `commands.editSelection(kind = "block")` edits an exactly selected formula,
or inserts a new one at the selection and focuses its source. The default display
source is empty; new inline math starts with `{}`, selected for replacement.
`commands.finishEditing()` commits active input before a host saves or exports
without a pointer click (for example, from a native menu). It returns `false` while IME
composition is active; defer the operation in that case.
Read-only state, external replacement and destruction dispose of active input.
The optional `onEditSource` callback remains an explicit custom-editor override.

## Markdown and source fidelity

Inline math uses `$expression$` on one source line. The expression is non-empty,
does not begin or end with whitespace, and must round-trip through one complete
single-dollar shell. The opening delimiter cannot immediately follow an ASCII
letter or digit; the closing delimiter cannot immediately precede one. Escaped
dollars, code, unmatched delimiters, currency-like text, and inline `$$...$$`
remain ordinary Markdown.

Block math accepts a complete standalone `$$expression$$` line or expression
lines between standalone `$$` delimiters. It always serializes canonically:

```md
$$
expression
$$
```

Block expression line endings normalize to LF. Source characters otherwise
remain model data; renderer output is presentation-only and is never written to
Markdown, clipboard output, history, or extension storage. Code spans, code
blocks, generic fenced code, and exact raw-HTML source are not reinterpreted as
math. With this package absent, the root entry retains its existing
opaque standalone-display fallback; inline math and the minimal entry have no
preservation guarantee.

Dollar signs that remain ordinary literal text serialize as `\$`. This
canonical escape is intentional: reparsing serialized Markdown cannot turn
literal text into a semantic math node. Math node serializers bypass that
literal-text escape only for their validated canonical `$...$` or `$$` shell,
so semantic math stays semantic across a parse/serialize cycle.

Image descriptions are always plain alt text, not a nested semantic-math
surface. Math-looking content and inline formatting inside an image description
are flattened to the image's literal alt value; dollar signs are then escaped
in canonical Markdown. For example, `![formula $x$ and **bold**](image.png)` has
the plain alt value `formula $x$ and bold` and serializes as
`![formula \$x\$ and bold](image.png)`.

## Commands and state

The installed definition exposes source commands and frozen snapshots:

```ts
const handle = editor.extensions.get(math);

handle.commands.insertInline("x + y");
handle.commands.insertBlock("\\int_0^1 x\\,dx");

const node = handle.state.getNodes("block")[0];
if (node) {
  handle.state.getRenderState(node);
  handle.commands.update(node, "\\int_0^2 x\\,dx");
}

handle.state.getSnapshot();
handle.state.getDiagnostics();

// Obtain a fresh snapshot before each later mutation. Targets are deliberately
// stale-safe, so a successful update invalidates the previous target.
const current = handle.state.getNodes("block")[0];
if (current) handle.commands.togglePreview(current);

const sameNode = handle.state.getNodes("block")[0];
if (sameNode) handle.commands.retryPreview(sameNode);

const convertible = handle.state.getNodes("block")[0];
if (convertible) handle.commands.convert(convertible, "inline");

const inlineNodes = handle.state.getNodes("inline");
const removable = inlineNodes[inlineNodes.length - 1];
if (removable) handle.commands.remove(removable);
```

Targets contain an opaque runtime node identity plus the node's kind, current
document position, and source. Obtain them from package state instead of
constructing or persisting them. An identity follows an unchanged occurrence
when edits before it move its position, while replacement, reset, and source
mutation invalidate older targets. A stale target returns `false` rather than
mutating a different, even source-identical, node. Successful source mutations
are one undoable extension transaction; semantic no-ops, read-only editors,
active composition, invalid source, and invalid conversions return `false`.
Inline-to-block conversion is available only where the surrounding text block
can be replaced without discarding other content.

The optional `onEditSource` handoff receives stale-safe `update()`, `remove()`,
and `convert()` functions. Its source remains complete and accessible when no
renderer exists or a render fails.

## Rendering, safety, and limits

A renderer receives inert source, the math kind, the editor's owner `Document`,
and a fresh `AbortSignal`. It returns a disconnected owner-document `Node` or
`DocumentFragment`, synchronously or asynchronously. HTML strings,
`TrustedHTML`, connected nodes, and wrong-document nodes are rejected. Markora
clones and clamps returned DOM before attachment; executable or network-capable
HTML, SVG, MathML, event attributes, active controls, custom elements, and CSS
URL loads are not accepted. The default policy performs no network request and
opens no link.

Source changes, retry, preview deactivation, reset, reconciliation, node
removal, and editor destruction abort the preceding generation. Late results
cannot commit or announce. Rendering is queued outside transactions and the
synchronous typing path, block previews activate near the viewport, and one
node's failure does not block siblings.

The package fixes per-node source, rendered-node, rendered-output, and
per-editor concurrency limits. Oversized source remains editable and serializes
unchanged, but it is not rendered and receives a recoverable diagnostic. The
source fallback is always the accessible representation; preview DOM never
becomes the sole accessible name.

## Clipboard and styles

Markdown and plain-text copy use the canonical `$...$` or `$$` shell. Rich HTML
contains only inert semantic source markup, never renderer DOM, status UI,
listeners, or preview controls. A valid rich copy reparses as the same semantic
node; ordinary plain paste remains plain text.

Import `markora-extension-math/styles.css` explicitly. Package selectors use
stable `mdw-math` hooks, and public custom properties use the `--mdw-math-*`
prefix with Markora design-token fallbacks. The styles inherit the editor's
language, writing direction, and typography; use logical properties; wrap
actions and status at narrow or 200%-zoom layouts; and include forced-colors
and reduced-motion behavior. Renderer-specific typography or engine CSS remains
the host's responsibility.

Hosts that persist math Markdown must store `editor.extensions.manifest` beside
the document and restore a compatible extension definition before editing it.
