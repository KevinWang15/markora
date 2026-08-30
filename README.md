# markora

![Markora logo](./banner.png)

Write Markdown at the speed of thought, inside your product.

`markora` is an embedded Markdown editor toolkit built with ProseMirror and CodeMirror. It provides Typora-style editing without becoming a standalone application: the host owns mounting, persistence, product chrome, network access, and security policy, while Markora owns the editor model, interactions, and predictable Markdown conversion.

## Packages

- `packages/core` — the npm package published as `markora`, including the `minimal` and `extension-api` entries
- `packages/ui` — the npm package published as `markora-ui`
- `packages/extension-alerts` — GitHub-style alerts
- `packages/extension-diagrams` — Mermaid, GeoJSON, TopoJSON, and STL fences
- `packages/extension-footnotes` — GitHub-style footnotes
- `packages/extension-frontmatter` — exact-source YAML front matter
- `packages/extension-html` — exact-source HTML with optional host previews
- `packages/extension-math` — inline and block math with optional host rendering
- `packages/extension-toc` — generated tables of contents
- `packages/demo` — the Vite docs site, live playground, and internal regression surface

## Highlights

- Typora-like visual editing in a host-owned mount, with normalized Markdown output
- Semantic import/edit/export for the documented dialect: a CommonMark-derived subset, pipe tables, strikethrough, and task items
- Inert, exact-source atoms for conservatively recognized front matter, display math, HTML, comments, and directives
- Inline marks for bold, italic, code, strike, and links
- Exact source-text code-fence shells with viewport-lazy CodeMirror editing and lazy-loaded built-in grammars
- Headless command/state APIs plus optional, localizable overlays from `markora-ui`
- Deliberate rich, Markdown, plain-text, table-matrix, and file-transfer clipboard behavior
- Rectangular table selection, matrix clipboard, row/column reordering, dimension controls, and GFM fidelity diagnostics
- Reconciled host updates, idle output delivery, deterministic reset, and complete teardown semantics
- A versioned creation-time extension kernel, seven official optional syntax packages, and an independently bundled minimal entry
- Per-editor URL, image-loading, link-opening, and asynchronous asset-upload policy with secure defaults
- Scoped themes, localization, RTL, forced-colors, reduced-motion, keyboard, and managed-focus support
- Chromium, Firefox, and WebKit release gates plus package-isolation and performance budgets

## Markdown compatibility

Markora is not a byte-for-byte source editor. Supported syntax is serialized to a canonical form. The root entry preserves valid CommonMark link-reference definitions plus conservatively recognized front matter, standalone display math, HTML, comments, and directives as inert source atoms. Reference uses still normalize to inline links, while unused definitions no longer disappear. Other unsupported extensions are not guaranteed to be preserved or rejected. Official extension packages claim their documented forms and give them semantic editing behavior. Review the [Markdown dialect and fidelity contract](./packages/core/MARKDOWN_COMPATIBILITY.md) before importing existing or generated documents.

Opaque HTML is shown as text and never executed inside the editor, but serialized Markdown still contains its source. Hosts must sanitize any downstream HTML rendering independently. They can provide source editing for opaque atoms through `onEditOpaqueMarkdown`.

## Install

```bash
npm install markora markora-ui

# Add only the document syntax your product needs.
npm install markora-extension-footnotes markora-extension-math
```

`markora-ui` is optional. Install it when you want the built-in link, image, code-fence metadata, and table overlays.

### Official optional syntax

| Package | Adds | Entry compatibility | External runtime |
| --- | --- | --- | --- |
| [`markora-extension-frontmatter`](./packages/extension-frontmatter/README.md) | Exact-source YAML-like document-head blocks | Root and minimal | No YAML parser |
| [`markora-extension-footnotes`](./packages/extension-footnotes/README.md) | Semantic references, definitions, diagnostics, and navigation | Root and minimal | None |
| [`markora-extension-math`](./packages/extension-math/README.md) | Semantic inline and block math | Root and minimal | No TeX renderer; host callback optional |
| [`markora-extension-alerts`](./packages/extension-alerts/README.md) | Semantic `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` blockquotes | Root and minimal | None |
| [`markora-extension-toc`](./packages/extension-toc/README.md) | A generated outline backed by `[TOC]` | Root and minimal | None |
| [`markora-extension-html`](./packages/extension-html/README.md) | Exact-source CommonMark HTML atoms and bounded block previews | Root default runtime only | No HTML parser; previews require a host renderer and sanitizer |
| [`markora-extension-diagrams`](./packages/extension-diagrams/README.md) | Semantic Mermaid, GeoJSON, TopoJSON, and STL fences | Root and minimal | No diagram engine; host callbacks optional |

Extensions are creation-time configuration. Import each installed package's stylesheet, and persist `editor.extensions.manifest` beside Markdown that depends on optional syntax:

```ts
import { createEditor } from "markora";
import { createFootnotesExtension } from "markora-extension-footnotes";
import { createMathExtension } from "markora-extension-math";
import "markora/styles.css";
import "markora-extension-footnotes/styles.css";
import "markora-extension-math/styles.css";

const extensions = [createFootnotesExtension(), createMathExtension()];
const editor = createEditor({ element: hostElement, markdown, extensions });

saveDocument({
  markdown: editor.getMarkdown(),
  extensionManifest: editor.extensions.manifest,
});
```

Restore a compatible extension set before editing the stored Markdown. Renderer callbacks are host-owned runtime configuration and are not part of the manifest.

## Quick start

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const hostElement = document.querySelector<HTMLElement>("#editor");

if (!hostElement) {
  throw new Error("Editor host not found.");
}

const editor = createEditor({
  element: hostElement,
  markdown: "# Hello Markora",
  ariaLabel: "Document body",
  autofocus: true,
  ui: createDefaultUi(),
  onChange(nextMarkdown, { origin }) {
    saveDraft(nextMarkdown, { origin });
  },
});

const unsubscribe = editor.subscribe("update", ({ origin }) => {
  markDocumentDirty(origin); // Synchronous and does not serialize Markdown.
});

form.addEventListener("submit", () => {
  editor.flushChange(); // Deliver pending idle onChange output now.
  markdownField.value = editor.getMarkdown(); // Latest synchronous snapshot.
});

// Later, when the host screen unmounts:
unsubscribe();
editor.destroy();
```

`ariaLabel` or `ariaLabelledBy` gives the inner editor its host-specific accessible name. `onChange` uses the default `"idle"` mode: document changes coalesce and full Markdown serialization stays out of the synchronous typing path. Idle delivery waits for 300 ms without another document change and retains a five-second first-change deadline, so ordinary typing bursts produce one latest snapshot without starving a continuously edited draft. Use the synchronous `update` event for dirty state and host UI, and call `getMarkdown()` only at an explicit snapshot boundary. Initial autofocus and selection are configured through `createEditor()` and are not replayed to subscriptions added after creation.

## Typing assistance and shortcuts

Typing assistance is explicit and creation-time, so an embedding product chooses its own conventions:

```ts
const editor = createEditor({
  element: hostElement,
  typing: {
    autoPairs: [
      "parentheses",
      "square-brackets",
      "double-quotes",
      "emphasis-asterisks",
      "strong-asterisks",
      "inline-code",
      "strikethrough",
    ],
    wrapSelection: true,
  },
  shortcuts: {
    "@markora/core/bold": "Alt-b",
    "@markora/core/italic": false,
    "@acme/editor/toggle-note": ["Mod-Shift-n", "Alt-n"],
  },
});
```

Auto-pairing is off by default. Enabled pairs remember which closing delimiter Markora generated, so existing source punctuation is never skipped or pair-deleted. Compatible selections are wrapped (or receive the corresponding semantic Markdown mark), and every automatic change participates in normal undo/redo. Pairing and shortcuts stay inert during IME composition. Markdown markers stay literal inside code; active CodeMirror fences receive only the configured bracket and quote pairs.

Built-in shortcut IDs are `@markora/core/bold`, `@markora/core/italic`, `@markora/core/inline-code`, `@markora/core/strikethrough`, `@markora/core/hard-break`, `@markora/core/table-toolbar`, `@markora/core/undo`, and `@markora/core/redo`. Extension keymaps use their qualified contribution ID. A string replaces the default binding, an array supplies an ordered set, and `false` disables it. Remapping or disabling a built-in consumes its former default key so native contenteditable behavior cannot leak through; configured undo/redo bindings also apply inside active CodeMirror blocks.

## Host-controlled resources and uploads

`CreateEditorOptions.resources` keeps storage, authentication, URL routing, and network policy in the embedding application. The option is creation-only and isolated per editor. For example, a host can resolve stored relative URLs at display time, load an image through an authenticated request, and turn pasted files into durable Markdown only after its uploader succeeds:

```ts
const editor = createEditor({
  element: hostElement,
  resources: {
    resolveUrl({ url }) {
      return new URL(url, documentBaseUrl).href;
    },
    loadImage: async ({ url, signal }) => {
      const response = await fetch(url, { signal, credentials: "include" });
      return response.ok ? { src: await response.blob() } : null;
    },
    openUrl({ url }) {
      openTrustedRoute(url);
    },
    assets: {
      async upload({ file, signal, reportProgress }) {
        const url = await uploadAsset(file, { signal, reportProgress });
        return { kind: "image", url };
      },
    },
  },
});

const stopAssets = editor.subscribe("asset", ({ reason, upload }) => {
  renderUploadStatus(upload.id, reason, upload.progress, upload.error);
});
```

By default, links accept relative URLs and `http:`, `https:`, `mailto:`, and `tel:`; images accept relative URLs, `http:`, `https:`, and bounded raster `data:` URLs. Credentials, protocol-relative URLs, backslashes, controls, `javascript:`, and `vbscript:` are rejected. Image `data:` payloads are limited to 1,048,576 decoded bytes and 1,398,358 source characters, and their MIME type must be AVIF, GIF, JPEG, PNG, or WebP.

File paste/drop remains blocked unless `resources.assets` is configured. Its defaults are the same five image MIME types, 10,485,760 bytes per file, and 10 files per transfer. Upload progress is event-only and does not mutate the document. A successful transfer batch is inserted in original order through one transaction and one undo step; failures remain available through `editor.assets.getUploads()`, `retry(id)`, and `cancel(id)`. Hosts must render accessible progress, failure, retry, and cancel controls. Nested CodeMirror blocks continue to reject files because their clipboard is a plain-text code surface.

See the package [resource and asset contract](./packages/core/README.md#resources-links-images-and-asset-uploads) for callback, privacy, cleanup, read-only, reset, and teardown semantics.

## Clipboard interoperability

Normal outer-editor paste uses a deliberate fidelity order: file-bearing transfers go to the configured asset policy; rich HTML wins when present; otherwise `text/markdown` is parsed through the editor's compiled dialect; otherwise `text/plain` stays literal. Rich HTML is parsed into the schema in a detached document and then sanitized, rather than inserted into the live host DOM. Ctrl/Cmd-Shift-V keeps the conventional plain-text behavior. URL- or email-shaped plain text is serialized with a minimal backslash escape so a later reset cannot silently promote it into an autolink.

An embedded host can offer explicit actions without reading or writing through the version-coupled ProseMirror view:

```ts
await navigator.clipboard.readText().then((text) => {
  editor.commands.pasteMarkdown(text); // Parse as Markdown.
});

pastePlainButton.addEventListener("click", () => {
  editor.commands.pastePlainText(hostClipboardText); // Keep syntax literal.
});
```

The host owns Clipboard API permission and UI. Both commands replace the retained model selection, create one undo step, use origin `"command"`, and return `false` when empty, read-only, composing, or otherwise unavailable. Matching `editor.state.can.pasteMarkdown()` and `pastePlainText()` queries are side-effect free.

Copy and cut synchronously offer semantic `text/html`, canonical `text/markdown`, and human-readable `text/plain` when the browser's event clipboard permits them. The HTML retains private ProseMirror slice context for faithful same-editor paste, while task items use portable disabled checkbox markup instead of live editor controls. A failed custom-MIME write does not prevent HTML/plain copy. Cut performs one undoable deletion after writing the representations; read-only cut behaves as copy. Nested active and passive code editors remain literal plain-code surfaces, while selecting a whole code block in the outer editor includes its fence and language in Markdown output. Firefox and WebKit can expose contradictory native ranges when a drag crosses a live CodeMirror/outer-editor boundary; Markora suppresses destructive cut for that split range, so users should cut within one surface or select the whole code block through the outer editor.

## Host toolbars and command state

The headless API covers inline marks, links and images, paragraphs and headings, blockquotes, bullet/ordered/task lists, list indentation, hard breaks and rules, fenced code blocks, tables, and undo/redo. Build host UI from `editor.state` and refresh it from the `state` event, which also catches stored-mark changes that do not modify the document:

```ts
const quoteButton = document.querySelector<HTMLButtonElement>("#quote");
const undoButton = document.querySelector<HTMLButtonElement>("#undo");

if (!quoteButton || !undoButton) {
  throw new Error("Toolbar buttons not found.");
}

function renderToolbar() {
  quoteButton.setAttribute("aria-pressed", String(editor.state.isActive.blockquote()));
  quoteButton.disabled = !editor.state.can.toggleBlockquote();
  undoButton.disabled = !editor.state.can.undo();
}

quoteButton.addEventListener("click", () => editor.commands.toggleBlockquote());
undoButton.addEventListener("click", () => editor.commands.undo());

const stopToolbar = editor.subscribe("state", renderToolbar);
renderToolbar();
```

`state.can.*` is a pure dry run: it does not dispatch, focus, add history, or emit events. Interactive commands and their `can` checks return `false` while read-only, during active IME composition, when the operation is unavailable, or when it would be a no-op; `state.isActive.*` remains observational in those modes. A successful interactive command focuses the editor. A successful document-changing command other than undo/redo is tagged with origin `"command"` and contributes one undoable history step, while a failed command leaves focus, history, and events untouched.

The root entry supports task items and tables. Task items can contain supported additional blocks and nested bullet or task lists; `sinkListItem()` and `liftListItem()` retain checked state while the item remains in a list. Tables default to three columns and two total rows (the first is the header), and explicit row/column counts must be integers from 1 through 100. `markora/minimal` exposes the same typed task/table methods for portable host code, but those commands and related `can`/`isActive` checks return `false` because the syntax is absent.

## Embed configuration and lifecycle

`createEditor()` accepts host-facing configuration without requiring ProseMirror access:

- `editable` defaults to `true`; read-only mode still permits selection and copy, while blocking user, UI, formatting, and history mutations. Host-controlled `editor.commands.reconcileMarkdown()` and `resetMarkdown()` remain available.
- `placeholder` supplies empty-editor guidance.
- `autofocus` defaults to `false`, and `initialSelection` accepts `"start"`, `"end"`, `"all"`, or `{ anchor, head? }`.
- Object selection targets use in-range integer ProseMirror positions that resolve inside text blocks.
- `attributes` are lowercased and applied to the inner editor DOM. Markora-managed contenteditable, read-only, and placeholder attributes take precedence; inline event-handler attributes and `nodeName` are rejected.
- `ariaLabel` and `ariaLabelledBy` provide accessible naming. Prefer `ariaLabelledBy` when the host already renders a visible label.

Options that do not reconstruct editor state can change in place:

```ts
editor.updateOptions({
  editable: false,
  placeholder: null,
  ariaLabel: "Document preview",
  attributes: { "data-document-id": documentId },
  onChange: null,
});
```

`updateOptions()` also accepts `onChange`, `onTransaction`, and `onEditOpaqueMarkdown`. Replacing `onChange` first flushes pending output once through the previous listener, then installs the new configuration. `element`, `markdown`, `initialSelection`, the autofocus action, `ui`, `typing`, `shortcuts`, `codeBlockLanguages`, `messages`, `resources`, and extension configuration are creation-only.

`focus`, `blur`, `state`, `selection`, `update`, `asset`, and `error` subscriptions return idempotent unsubscribe functions. State, selection, and update events are synchronous and expose host-facing selection snapshots plus a change `origin`; `state` fires for every accepted state transition and adds `docChanged` and `selectionChanged`, while `selection` and `update` are limited to those respective changes. Focus and blur each cross one microtask boundary so host callbacks run outside nested editor focus internals and movement within the composite surface does not produce a false boundary. Asset events describe upload lifecycle without requiring Markdown serialization or a document transaction. Update events do not serialize Markdown. Use the default idle `onChange(markdown, context)` for coalesced normalized output, or call `getMarkdown()` synchronously only when a save/export boundary needs the latest snapshot. `onTransaction(transaction, view, context)` remains available for advanced ProseMirror-aware integrations.

`editor.flushChange()` synchronously delivers the latest pending `onChange`; `editor.getMarkdown()` synchronously serializes the current document on demand and reuses that result until the document changes. `editor.destroy()` performs the same final flush, caches the latest Markdown, releases all owned resources even if teardown reports an error, and is safe to call more than once. After destruction, `editor.isDestroyed` is `true`, `getMarkdown()` returns the cached final value, and `flushChange()`, `destroy()`, and previously returned unsubscribe functions are no-ops. Other high-level calls throw `MarkdownEditorDestroyedError`; `editor.view` is then a destroyed raw view and must not be used.

## Architecture notes

- `markora` is headless by default: it owns parsing, serialization, commands, state, and embedded code-block editing
- `markora-ui` adds the repo's default link, image, and code-fence metadata editors plus the table creation/dimension dialog and table toolbar overlays
- Code fences keep an exact selectable/searchable source shell in the document; CodeMirror activates near the viewport or for caret/edit interactions, while native range selection can remain on the shell and host-extensible `codeBlockLanguages` loaders run only after activation
- `editor.commands.reconcileMarkdown(markdown)` is the ordinary authoritative host-update path; it preserves editor state and is silent by default
- `editor.commands.resetMarkdown(markdown)` is an explicit hard reset that resets selection and clears history/plugin state
- `onEditOpaqueMarkdown` lets the host open its own source editor for protected opaque atoms; its guarded update function rejects stale writes
- `onChange` uses coalesced idle delivery
- `editor.getMarkdown()` is the synchronous lazy save/export snapshot, and `editor.flushChange()` forces pending `onChange` delivery
- `editor.view` is a version-coupled advanced escape hatch. Inspection and `dispatch()` are supported for advanced integrations; direct `setProps()`, `updateState()`, DOM mutation, or `destroy()` can bypass Markora invariants and events and are outside the public semver contract
- `resources` configures per-editor stored-URL policy, runtime URL resolution/opening, async image loading, privacy attributes, and optional file upload; `editor.assets` controls retained uploads
- `messages` localizes core-rendered text and accessible names at editor creation; `markora-ui` has a separate complete message contract for its optional overlays
- `markora/extension-api` is the supported constructor/type boundary for external schema, Markdown, command, state, plugin, NodeView, clipboard, and UI-action contributions
- `markora/minimal` plus `markora/minimal.css` keeps the extension kernel and basic CommonMark editing in a separate static graph and stylesheet without CodeMirror or default-only syntax modules
- every shipped visual value is available through the documented `--mdw-*` token contract; optional `markora/themes.css` provides scoped light, dark, automatic, and contrast reference palettes while forced colors and reduced motion remain automatic

## External Markdown updates

Use `editor.commands.reconcileMarkdown(markdown)` when a controlled component, collaboration layer, server response, or source panel supplies a new authoritative snapshot. It parses the snapshot, returns `false` without dispatching when the parsed document is semantically unchanged, and otherwise applies one non-history transaction. The transaction maps the current selection and undo/redo history instead of reconstructing EditorState. Disjoint local history remains usable; an entry overlapping replaced content can map to a no-op or be consumed. Reconciliation is allowed in read-only mode and does not call `onChange` unless `{ emitChange: true }` is explicit.

```ts
const changed = editor.commands.reconcileMarkdown(serverMarkdown);

if (changed) {
  console.log("Applied a newer host snapshot");
}
```

A changed reconciliation cancels any pending `onChange`, so stale local output cannot fire after the authoritative snapshot. A semantic no-op does not cancel that pending output. Calls are synchronous and resolve in invocation order: every incoming string is a complete authoritative snapshot, so the last changed call wins. Markora does not merge snapshots or compare revisions; a host receiving out-of-order responses must reject stale revisions before calling the editor.

Use `resetMarkdown()` only when switching documents or deliberately discarding transient editor state. A reset rebuilds EditorState, clears undo/redo and plugin state, moves selection to the new document default, and bypasses `onTransaction` because no ProseMirror transaction exists. State and any applicable selection/update events, plus an explicitly requested `onChange`, carry origin `"reset"`.

Document activity is classified as `"user"`, `"command"`, `"external"`, `"reset"`, or an extension-owned `"extension:name"`. `onChange` receives the context as its second argument, `onTransaction` as its third, and state/selection/update subscriptions expose `origin`. `onTransaction` observes dispatch attempts; `onChange` and typed state events reflect accepted state changes. Advanced extensions can tag a transaction with `setMarkdownEditorTransactionOrigin(transaction, "extension:my-plugin")` and inspect it with `getMarkdownEditorTransactionOrigin(transaction)`.

## Production contracts

The implemented [extension system RFC](./docs/extension-system-rfc.md) defines creation-time composition, lifecycle, version validation, and packaging. The [performance budgets](./docs/performance-budgets.md) define the packed runtime and bundle gates. Package-level examples and minimal-entry guidance live in the [`markora` README](./packages/core/README.md#extensions-and-the-minimal-entry).

Hosts preparing a release should also review the [embedded input and accessibility contract](./docs/input-accessibility-certification.md) and run the [assistive-technology checklist](./docs/assistive-technology-checklist.md) on their supported platform matrix.

Compatibility task controls are stable native buttons with checkbox semantics. The optional link/image UI and table creation/resize UI use named non-modal dialogs, and the grouped table toolbar has one roving Tab stop, skips unavailable movement actions, and announces rectangular selection/mutation status; all preserve an explicit host focus handoff. The real VoiceOver/NVDA checklist remains a host release obligation even when the automated browser and axe gates pass.

## Development

```bash
pnpm install
pnpm dev
```

Useful scripts:

- `pnpm dev` — prepare package outputs, then run the core, extension, UI, and docs/demo watchers together
- `pnpm dev:core` — watch the `markora` package only
- `pnpm dev:ui` — watch the `markora-ui` package only
- `pnpm dev:demo` — run the docs/demo site only
- `pnpm build` — build `markora`, all seven extension packages, `markora-ui`, and the demo app
- `pnpm check` — build packages, run typechecks, verify API types, smoke-test Node ESM imports, and execute the test suite
- `pnpm browser:install` — install the pinned Playwright Chromium, Firefox, and WebKit engines
- `pnpm test:browser:required` — run the compact release-gate browser cases in all three engines
- `pnpm test:browser` — run the complete embedded-editor browser matrix against a production demo build
- `pnpm pack:smoke` — pack all nine public packages and verify isolated, minimal, per-extension, and all-extension consumer graphs
- `pnpm release:check` — dry-run the `markora` tarball and then run the complete packed-consumer smoke test
- open `/__dev` in the demo app for fixture-driven regression checks while developing the editor itself
- `/__browser` is the private deferred-mount fixture used by Playwright for lifecycle, portal, Shadow DOM, and multi-editor checks

## Publishing

This repo ships nine publishable packages: `markora`, `markora-ui`, and the seven `markora-extension-*` packages listed above.

```bash
# Validate the core tarball and the packed consumer flow.
pnpm release:check

# Publish a prerelease of markora.
cd packages/core
npm publish --tag test.2026031101

# Publish a matching prerelease of markora-ui.
cd ../ui
npm publish --tag test.2026031101

# Repeat from each extension package directory included in this release.
```

Notes:

- `pnpm release:check` dry-runs the `markora` tarball and smoke-tests consumer graphs using all nine packed packages
- keep `markora`, `markora-ui`, extension versions, and extension peer ranges compatible when releasing them together
- publish prereleases with a dated tag such as `test.2026031101`
- publish stable releases without the prerelease tag when you are ready for `latest`

## API notes

- `onChange` coalesces Markdown serialization away from synchronous input
- `editor.getMarkdown()` returns the latest normalized snapshot synchronously, while `editor.flushChange()` forces pending callback delivery for form submission or another save boundary
- `createEditor()` is headless by default; pass `ui: createDefaultUi()` from `markora-ui` for the built-in overlays
- `createDefaultUi({ portalRoot })` helps when the editor lives inside a Shadow DOM host
- `editor.updateOptions(...)` changes editable state, placeholder, attributes, and accessible naming without rebuilding editor state or emitting a document update
- `editor.subscribe(...)` exposes typed focus, blur, state, selection, update, asset-lifecycle, and recoverable runtime error events
- `editor.commands.reconcileMarkdown(...)` applies ordinary authoritative host updates while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(...)` performs an explicit state reset
- change callbacks and state/selection/update events expose `user`, `command`, `external`, `reset`, or namespaced extension origins
- built-in code block languages cover JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
