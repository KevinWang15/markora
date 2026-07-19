# markora-extension-frontmatter

Optional exact-source YAML front matter for embedded Markora editors. The
package works with both `markora` and `markora/minimal`; it is never included in
either default editor graph.

## Install and use

```bash
npm install markora markora-extension-frontmatter
```

Minimal-entry consumers should import `markora/minimal.css` in place of `markora/styles.css` below.

```ts
import { createEditor } from "markora";
import { createFrontmatterExtension } from "markora-extension-frontmatter";
import "markora/styles.css";
import "markora-extension-frontmatter/styles.css";

const frontmatter = createFrontmatterExtension({
  onEditSource({ source, update }) {
    openMetadataEditor({
      source,
      save(nextSource) {
        if (!update(nextSource)) showSourceConflict();
      },
    });
  },
});

const editor = createEditor({
  element: document.querySelector<HTMLElement>("#editor")!,
  extensions: [frontmatter],
  markdown: "---\ntitle: Embedded\n---\n\n# Document",
});

const handle = editor.extensions.get(frontmatter);
handle.commands.update("---\ntitle: Updated\n---");
console.log(handle.state.getSnapshot());
```

The tokenizer claims one document-head Jekyll-style block with an optional BOM,
a `---` opener, at least one mapping-looking key, and a `---` or `...` closer.
Its source island retains authored BOM, CRLF/CR/LF, comments, anchors, aliases,
indentation, and delimiter spelling. Separators around the block remain owned by
Markora's document serializer.

Source is always inert text. This package does not construct YAML objects,
resolve aliases, execute tags, load resources, or insert source through an HTML
sink. Bounded lexical diagnostics flag oversized input, custom tags, excessive
aliases/nesting, tab indentation, and unbalanced flow brackets without
rewriting source. Once the UTF-8 source limit is exceeded, inspection stops
with only the size diagnostic instead of scanning the unbounded remainder. A
command or host edit that omits the required delimiter
envelope is rejected instead of creating a node that could not be reparsed.
`FRONTMATTER_MAX_SOURCE_BYTES` is fixed at 65,536 UTF-8 bytes.
These diagnostics are safety-oriented heuristics, not general YAML syntax or
schema validation; syntactically invalid YAML may have no package diagnostic.
Hosts that require validation can inspect the inert source in `onEditSource`.

The optional `onEditSource` hook is a host-owned editor handoff. Its `update()`
and `remove()` functions return `false` when the request became stale, the
editor is read-only, or composition is active. Updating a current request with
its unchanged source succeeds as a no-op; an actual change is one undoable
extension transaction. No form, YAML parser, or standalone UI is bundled.

Import `markora-extension-frontmatter/styles.css` explicitly. Package tokens
use the `--mdw-frontmatter-*` prefix and fall back to Markora's public design
tokens; hosts may override them within their embed scope.

Hosts that persist front-matter Markdown must also persist
`editor.extensions.manifest` and restore a compatible extension definition
before editing it.
