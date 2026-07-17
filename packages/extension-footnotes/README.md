# markora-extension-footnotes

Optional semantic GitHub-style footnotes for embedded Markora editors. The
package works with both `markora` and `markora/minimal`; it is never included in
either default editor graph.

```ts
import { createEditor } from "markora";
import { createFootnotesExtension } from "markora-extension-footnotes";
import "markora/styles.css";
import "markora-extension-footnotes/styles.css";

const footnotes = createFootnotesExtension({
  messages: {
    referenceText: (number) => String(number),
  },
});

const editor = createEditor({
  element: document.querySelector("#editor")!,
  extensions: [footnotes],
  markdown: [
    "Text with a reference.[^note]",
    "",
    "[^note]: Footnote text.",
  ].join("\n"),
});

const handle = editor.extensions.get(footnotes);
console.log(handle.state.getSnapshot());
```

## Syntax and labels

A reference is `[^label]` outside code, HTML, math, escaped text, and image
descriptions. A reference inside an ordinary Markdown link label remains
semantic and retains the surrounding link, but its marker is noninteractive:
the outer link exclusively owns pointer and keyboard activation. Footnote-looking
syntax in an image description stays literal and canonicalizes through the
image's plain alt text. A definition starts at a block boundary with
`[^label]:`. The first definition block can start after the colon; later blocks
and lines use four literal ASCII spaces of continuation indentation. A tab does
not substitute for those four spaces. Empty definitions are supported and
serialize canonically as `[^label]: `. A definition marker inside another
definition's body remains literal text rather than creating a nested semantic
definition.

Labels are normalized with JavaScript `String.prototype.trim()`. After trimming,
a label must be non-empty and contain only Unicode letters, combining marks, or
numbers; ASCII space; `_`, `-`, `.`, `/`, `:`, or `#`; and ASCII single or
double quotes (`'` and `"`). This is a deliberate safe allowlist. Every other
character is invalid, including U+0000, brackets, backslash, backtick, and HTML
or math delimiters such as `<`, `>`, and `$`. Matching remains exact, with no
Unicode normalization or case folding, so `Note` and `note` are different
labels. Markdown import first
applies Markdown-it's U+0000-to-U+FFFD source normalization. Because U+FFFD is
also outside the label grammar, that footnote-looking source remains literal;
canonical Markdown retains U+FFFD and reparses stably.

Footnotes use semantic canonical Markdown rather than exact-source islands.
References serialize as `[^label]`; definition continuations use four spaces;
line endings and other supported Markdown spelling follow Markora's canonical
serializer.

## Resolution and diagnostics

The first definition for a label in document order is the primary definition
and resolves every matching reference. Later definitions remain in the model
and Markdown, receive one `duplicate-definition` diagnostic each, and expose no
back-reference controls. Duplicate status is shown in visible label text as well
as diagnostic color, so it never depends on color alone. Every reference without
a primary definition receives its own `unresolved-reference` diagnostic.
Repeated references and diagnostics are ordered by their live document
positions.

Import, Markdown paste, and rich paste preserve label collisions. They do not
silently merge, discard, or rename a colliding definition; the first definition
continues to resolve the label and later definitions are diagnosed.

## Commands and state

The exact installed definition provides a typed handle:

```ts
const handle = editor.extensions.get(footnotes);

handle.commands.insertReference("note");
handle.commands.insertDefinition("note");
handle.commands.navigateToDefinition("note");
handle.commands.navigateToReference("note", 2);

handle.commands.renameDefinition(
  { label: "note", occurrence: 1 },
  "renamed",
  { references: "rename" },
);

handle.commands.removeDefinition(
  { label: "renamed" },
  { references: "preserve" },
);
```

Definition targets use a one-based `occurrence`; omitting it selects the first
definition with that label. Rename and removal require an explicit reference
policy:

- `{ references: "preserve" }` on rename changes only the targeted definition;
  references keep the old label and may become unresolved.
- `{ references: "rename" }` changes the targeted definition and every
  reference carrying its old label.
- `{ references: "preserve" }` on removal deletes only the targeted definition;
  references remain and either resolve to the next definition or become
  unresolved.
- `{ references: "remove" }` deletes the targeted definition and every
  reference carrying its label. Other duplicate definitions remain represented.

Collisions created by these operations follow the same first-definition and
diagnostic rules as imported collisions. Successful mutations are single,
undoable extension transactions. Mutating and typed navigation commands return
`false` while the editor is read-only or composing, when their target is absent,
or on a semantic no-op.

State queries expose frozen definition/reference snapshots and pure diagnostics:

```ts
handle.state.getSnapshot();
handle.state.getDiagnostics();
handle.state.getDefinition({ label: "note", occurrence: 2 });
handle.state.getReferences("note");
```

## Clipboard, accessibility, and security

Whole definitions and selections inside a definition body copy as
self-contained semantic HTML and canonical Markdown. A partial body selection
retains its definition label and wrapper instead of becoming an ambiguous bare
fragment, so its Markdown remains independently parseable. This closure also
applies when the definition is contained by a blockquote or list. Pasting a
whole semantic definition from a cursor inside another definition lifts the
pasted definition to a sibling after the containing definition. Any other rich
paste or raw transaction that would create a nested `footnote_definition`, or a
code-marked semantic `footnote_reference`, is rejected atomically; the
whole-definition lift is the semantic-paste exception.

Rich clipboard HTML represents a footnote reference as noninteractive semantic
note text and emits no `tabindex`. Only the live editor NodeView may promote a
resolved standalone marker to an interactive link; clipboard markup never
claims listeners or navigation that it does not carry.

References, primary definitions, and their back-reference controls receive
editor-scoped opaque DOM IDs. Authored labels are never used as global IDs.
Relationships remain isolated across multiple editors and open Shadow DOM.
Reference and back-reference controls move the editor's model selection; they
do not navigate the embedding page, and this in-document navigation remains
available in read-only mode. Duplicate definitions deliberately expose no
back-reference controls. A standalone unresolved reference consumes Enter and
Space without moving selection or allowing the page to scroll. A reference
inside a link is removed from the tab order and leaves all activation to the
outer link.

The package has no renderer callback or rendering dependency. It creates
semantic DOM in the editor's owner document with DOM/text operations, never
interprets a label as HTML or a URL, and performs no network work. Package-owned
visible text and accessible names use the validated `messages` formatters.
Ordinary non-footnote edits use an ordered, position-only index remap and retain
the existing render identity, so retained footnote controls are not repainted.

Import `markora-extension-footnotes/styles.css` explicitly. Package tokens use
the `--mdw-footnotes-*` prefix and fall back to Markora's public design tokens;
hosts may override them within their embed scope. Hosts that persist footnote
Markdown must also persist `editor.extensions.manifest` and restore a compatible
extension definition before editing it.
