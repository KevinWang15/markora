# markora-extension-toc

Optional generated table-of-contents nodes for embedded `markora` and
`markora/minimal` editors.

## Install and use

```bash
npm install markora markora-extension-toc
```

Minimal-entry consumers should import `markora/minimal.css` in place of `markora/styles.css` below.

```ts
import { createEditor } from "markora";
import { createTocExtension } from "markora-extension-toc";
import "markora/styles.css";
import "markora-extension-toc/styles.css";

const toc = createTocExtension();

const editor = createEditor({
  element,
  extensions: [toc],
  markdown: "[TOC]\n\n# Introduction\n\n## Details",
});

editor.extensions.get(toc).commands.insert();
```

The extension recognizes a top-level standalone `[toc]` line
case-insensitively. Up to three columns of CommonMark indentation and trailing
ASCII spaces or tabs are accepted and normalized to the canonical marker
`[TOC]`. Effective code-block indentation, escaped or inline markers, and
markers inside prose, code, lists, or blockquotes remain ordinary Markdown.

The live node renders a current outline of semantic level 1 through 6 headings
in document order. Heading text, level, order, insertion, deletion, undo/redo,
reset, and reconciliation update every installed TOC. Activating an entry moves
the editor's model selection to that heading; it never changes the embedding
page URL or depends on global slug IDs. Multiple TOC nodes are supported and
share the same current outline.

Generated entries are presentation only. Persistence and Markdown/plain-text
copy contain `[TOC]`; rich copy contains only inert marker markup. Generated
labels, positions, nesting, controls, and DOM never enter Markdown, clipboard
representations, or undo history.

## Public API

`createTocExtension({ messages? })` returns the exact definition handle used to
obtain typed `commands` and `state` from `editor.extensions`.

Commands:

- `insert()`
- `remove()`

State:

- `canInsert()` and `canRemove()`
- `isActive()`
- `getSnapshot()` for frozen heading and TOC positions

Successful mutations are single extension-origin transactions. Semantic no-ops,
read-only editors, and active composition return `false`.

All package-owned copy can be replaced through a validated partial `messages`
object. This includes unique navigation landmark names, heading-action labels,
the empty state, insertion/removal labels, placement diagnostics, and the
untitled-heading fallback.
`defaultTocMessages` is a frozen export. Styles are an explicit import and
expose `--mdw-toc-*` variables for host theming.

## Persistence

Persist `editor.extensions.manifest` beside Markdown and restore the same
compatible extension set before editing. Without this package, the base editor
treats `[TOC]` as literal text and normally backslash-escapes it during
serialization.
