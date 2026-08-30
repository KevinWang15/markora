# markora-extension-html

Optional exact-source CommonMark HTML atoms for embedded Markora editors, with
host-sanitized block previews when a renderer is configured.

## Install and use

```bash
npm install markora markora-extension-html
```

```ts
import { createEditor } from "markora";
import { createHtmlExtension } from "markora-extension-html";
import "markora/styles.css";
import "markora-extension-html/styles.css";

const html = createHtmlExtension({
  onEditSource(request) {
    openSourceEditor({
      source: request.source,
      onRemove: request.remove,
      onSave: request.update,
    });
  },
  renderer: async ({ ownerDocument, signal, source }) => {
    // Parse and sanitize `source` under your product policy. Honor `signal` for
    // expensive work, and create only detached, network-inert owner DOM.
    const safeText = await renderHtmlUnderProductPolicy(source, signal);
    const output = ownerDocument.createElement("p");
    output.textContent = safeText;
    return output;
  },
});

const editor = createEditor({
  element,
  extensions: [html],
  markdown,
});

const unsubscribeErrors = editor.subscribe("error", (event) => {
  reportEditorError(event.error);
});

const handle = editor.extensions.get(html);
const snapshot = handle.state.getSnapshot();
```

## Source contract

This package requires the root `markora` entry's exact HTML tokenizer anchors.
`markora/minimal` rejects it with an attributed `EXTENSION_MISSING_DEPENDENCY`
error before claiming the editor host. Root presets do not change those anchors.

The extension claims only HTML block, inline HTML, and comment tokens already
recognized by Markora's CommonMark tokenizer. Top-level and inline hydrated
source is exact. HTML inside a supported container keeps the core opaque-source
limitation: container indentation, markers, and line endings may have
normalized before the package claims it. Inline opening and closing tags remain
separate atoms. Inline HTML and all comments are always source-only; only
non-comment block HTML can show a preview.

Update and remove calls are stale-safe. Targets include an opaque occurrence
identity plus their current position, placement, kind, and exact source. An
update is accepted only when its source reparses as exactly one HTML atom in the
same block or inline placement; the kind is then rederived. Store the extension
manifest from `editor.extensions.manifest` with persisted Markdown and restore
the same compatible extension set before editing it.

## Renderer security boundary

No HTML parser or sanitizer is bundled. The renderer is trusted host code and
remains responsible for parsing and sanitizing authored HTML under the
product's policy. It must not attach its result, start resource loads, navigate,
or use raw HTML sinks while constructing output. Return a detached `Node` or
`DocumentFragment` created by the supplied `ownerDocument`; strings and foreign
or connected nodes are rejected.

Markora manually reconstructs approved output into fresh DOM as a second clamp.
Version 1 has no URL policy and therefore permits no links, URLs, media, forms,
styles, classes, IDs, custom elements, SVG, or MathML. It also bounds authored
preview source to 256 KiB, output to 4,096 nodes, depth 128, 1 MiB, and 64
attributes per element, with at most four concurrent renders. Work is
task-queued, viewport-gated for blocks, deferred during composition, and aborted
when its source, node, preview state, or editor lifecycle becomes stale.

The authored source shell is always the accessible and serializable
representation. Preview DOM is derived, inert, hidden from assistive
technology, and excluded from model state, history, Markdown, and all clipboard
representations. Renderer failures leave source intact and are reported through
the editor's recoverable error channel.

When migrating an editor that used core `onEditOpaqueMarkdown` for raw HTML,
move that UI to this extension's `onEditSource` callback. Once installed, the
package owns those HTML atoms and their typed update validation.
