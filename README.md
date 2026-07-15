# markora

![](./banner.png)

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor library built with ProseMirror and CodeMirror. This repository contains the headless editor core, the optional default UI package, and the docs/demo app used for development and verification.

## Packages

- `packages/core` — the npm package published as `markora`
- `packages/ui` — the npm package published as `markora-ui`
- `packages/demo` — the Vite docs site, live playground, and internal regression surface

## Highlights

- Typora-like visual editing with host-owned Markdown input and normalized Markdown output
- Semantic import/edit/export for the documented dialect: a CommonMark-derived subset, pipe tables, strikethrough, and flat task items
- Inert, exact-source atoms for conservatively recognized front matter, display math, HTML, comments, and directives
- Inline marks for bold, italic, code, strike, and links
- Embedded CodeMirror code blocks with lazy-loaded built-in grammars
- Headless command/state APIs plus optional overlays from `markora-ui`
- Safer URL sanitization and managed navigation around tables and code blocks

## Markdown compatibility

Markora is not a byte-for-byte source editor. Supported syntax is serialized to a canonical form. Conservatively recognized front matter, standalone display math, HTML, comments, and directives are preserved as inert source atoms; other unsupported extensions are not guaranteed to be preserved or rejected. Review the [Markdown dialect and fidelity contract](./packages/core/MARKDOWN_COMPATIBILITY.md) before importing existing or generated documents.

Opaque HTML is shown as text and never executed inside the editor, but serialized Markdown still contains its source. Hosts must sanitize any downstream HTML rendering independently. They can provide source editing for opaque atoms through `onEditOpaqueMarkdown`.

## Install

```bash
npm install markora markora-ui
```

`markora-ui` is optional. Install it when you want the built-in link, image, and table overlays.

## Quick start

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const hostElement = document.querySelector("#editor");

if (!hostElement) {
  throw new Error("Editor host not found.");
}

const editor = createEditor({
  element: hostElement,
  markdown: "# Hello Markora",
  ariaLabel: "Document body",
  autofocus: true,
  ui: createDefaultUi(),
  onChangeMode: "animationFrame",
  onChange(nextMarkdown, { origin }) {
    console.log(origin, nextMarkdown);
  },
});

const unsubscribe = editor.subscribe("selection", ({ origin, selection }) => {
  console.log(origin, selection.from, selection.to);
});

// Later, when the host screen unmounts:
unsubscribe();
editor.destroy();
```

`ariaLabel` or `ariaLabelledBy` gives the inner editor its host-specific accessible name. Use `editor.focus()`, `editor.blur()`, and `editor.subscribe(...)` for ordinary lifecycle integration; initial autofocus and selection are configured through `createEditor()` and are not replayed to subscriptions added after creation.

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

`updateOptions()` also accepts `onChange`, `onTransaction`, `onChangeMode`, and `onEditOpaqueMarkdown`. Replacing `onChange` or its batching mode first flushes pending output once through the previous listener, then installs the new configuration. `element`, `markdown`, `initialSelection`, the autofocus action, `ui`, and `codeBlockLanguages` are creation-only.

`focus`, `blur`, `selection`, `update`, and `error` subscriptions return idempotent unsubscribe functions. Selection and update events are synchronous and expose host-facing selection snapshots plus a change `origin`; focus and blur each cross one microtask boundary so host callbacks run outside nested editor focus internals and movement within the composite surface does not produce a false boundary. Update events do not serialize Markdown. Keep using `onChange(markdown, context)` when you need normalized Markdown, optionally batched with `onChangeMode`. `onTransaction(transaction, view, context)` remains available for advanced ProseMirror-aware integrations.

`editor.destroy()` flushes one pending `onChange`, releases all owned resources even if teardown reports an error, and is safe to call more than once. After destruction, `editor.isDestroyed` is `true`, `getMarkdown()` returns the cached final value, and `flushChange()`, `destroy()`, and previously returned unsubscribe functions are no-ops. Other high-level calls throw `MarkdownEditorDestroyedError`; `editor.view` is then a destroyed raw view and must not be used.

## Architecture notes

- `markora` is headless by default: it owns parsing, serialization, commands, state, and embedded code-block editing
- `markora-ui` adds the repo's default link editor, image editor, and table toolbar overlays
- `codeBlockLanguages` lets hosts add or override lazy CodeMirror language loaders
- `editor.commands.reconcileMarkdown(markdown)` is the ordinary authoritative host-update path; it preserves editor state and is silent by default
- `editor.commands.resetMarkdown(markdown)` is an explicit hard reset that resets selection and clears history/plugin state; deprecated `setMarkdown()` remains a hard-reset alias
- `onEditOpaqueMarkdown` lets the host open its own source editor for protected opaque atoms; its guarded update function rejects stale writes
- `editor.flushChange()` forces any pending animation-frame batched Markdown emission to run immediately
- `editor.view` is a version-coupled advanced escape hatch. Inspection and `dispatch()` are supported for advanced integrations; direct `setProps()`, `updateState()`, DOM mutation, or `destroy()` can bypass Markora invariants and events and are outside the public semver contract

## External Markdown updates

Use `editor.commands.reconcileMarkdown(markdown)` when a controlled component, collaboration layer, server response, or source panel supplies a new authoritative snapshot. It parses the snapshot, returns `false` without dispatching when the parsed document is semantically unchanged, and otherwise applies one non-history transaction. The transaction maps the current selection and undo/redo history instead of reconstructing EditorState. Disjoint local history remains usable; an entry overlapping replaced content can map to a no-op or be consumed. Reconciliation is allowed in read-only mode and does not call `onChange` unless `{ emitChange: true }` is explicit.

```ts
const changed = editor.commands.reconcileMarkdown(serverMarkdown);

if (changed) {
  console.log("Applied a newer host snapshot");
}
```

A changed reconciliation cancels any pending animation-frame `onChange`, so stale local output cannot fire after the authoritative snapshot. A semantic no-op does not cancel that pending output. Calls are synchronous and resolve in invocation order: every incoming string is a complete authoritative snapshot, so the last changed call wins. Markora does not merge snapshots or compare revisions; a host receiving out-of-order responses must reject stale revisions before calling the editor.

Use `resetMarkdown()` only when switching documents or deliberately discarding transient editor state. A reset rebuilds EditorState, clears undo/redo and plugin state, moves selection to the new document default, and bypasses `onTransaction` because no ProseMirror transaction exists. Selection/update events and an explicitly requested `onChange` carry origin `"reset"`. `setMarkdown()` is retained as a deprecated hard-reset alias for compatibility.

Document activity is classified as `"user"`, `"command"`, `"external"`, `"reset"`, or an extension-owned `"extension:name"`. `onChange` receives the context as its second argument, `onTransaction` as its third, and selection/update subscriptions expose `origin`. `onTransaction` observes dispatch attempts; `onChange` and typed state events reflect accepted state changes. Advanced extensions can tag a transaction with `setMarkdownEditorTransactionOrigin(transaction, "extension:my-plugin")` and inspect it with `getMarkdownEditorTransactionOrigin(transaction)`.

## Roadmap

See the [embedded editor production plan](./docs/embedded-editor-production-plan.md) for the ordered path from the current editor kernel to a production-grade embedded editing component.

The accepted [extension system RFC](./docs/extension-system-rfc.md) defines the creation-time composition, lifecycle, compatibility, and packaging contract targeted by the next kernel iteration.

Hosts preparing a release should also review the [embedded input and accessibility contract](./docs/input-accessibility-certification.md) and run the [assistive-technology checklist](./docs/assistive-technology-checklist.md) on their supported platform matrix.

## Development

```bash
pnpm install
pnpm dev
```

Useful scripts:

- `pnpm dev` — run the core watcher and docs/demo site together
- `pnpm dev:core` — watch the `markora` package only
- `pnpm dev:ui` — watch the `markora-ui` package only
- `pnpm dev:demo` — run the docs/demo site only
- `pnpm build` — build `markora`, `markora-ui`, and the demo app
- `pnpm check` — build packages, run typechecks, verify API types, smoke-test Node ESM imports, and execute the test suite
- `pnpm browser:install` — install the pinned Playwright Chromium, Firefox, and WebKit engines
- `pnpm test:browser:required` — run the compact release-gate browser cases in all three engines
- `pnpm test:browser` — run the complete embedded-editor browser matrix against a production demo build
- `pnpm pack:smoke` — pack `markora` and `markora-ui`, install them into a tiny Vite app, and verify the build
- `pnpm release:check` — dry-run the `markora` tarball and then run the packed-consumer smoke test
- open `/__dev` in the demo app for fixture-driven regression checks while developing the editor itself
- `/__browser` is the private deferred-mount fixture used by Playwright for lifecycle, portal, Shadow DOM, and multi-editor checks

## Publishing

This repo ships two publishable packages: `markora` and `markora-ui`.

```bash
# Validate the core tarball and the packed consumer flow.
pnpm release:check

# Publish a prerelease of markora.
cd packages/core
npm publish --tag test.2026031101

# Publish a matching prerelease of markora-ui.
cd ../ui
npm publish --tag test.2026031101
```

Notes:

- `pnpm release:check` dry-runs the `markora` tarball and smoke-tests a consumer app using both packed packages
- `packages/core/package.json` and `packages/ui/package.json` should stay version-aligned when you release them together
- publish prereleases with a dated tag such as `test.2026031101`
- publish stable releases without the prerelease tag when you are ready for `latest`

## API notes

- `createEditor({ onChangeMode: "animationFrame" })` batches Markdown serialization once per frame
- `createEditor()` is headless by default; pass `ui: createDefaultUi()` from `markora-ui` for the built-in overlays
- `createDefaultUi({ portalRoot })` helps when the editor lives inside a Shadow DOM host
- `editor.updateOptions(...)` changes editable state, placeholder, attributes, and accessible naming without rebuilding editor state or emitting a document update
- `editor.subscribe(...)` exposes typed focus, blur, selection, update, and recoverable runtime error events
- `editor.commands.reconcileMarkdown(...)` applies ordinary authoritative host updates while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(...)` performs an explicit state reset; `setMarkdown(...)` remains a deprecated alias
- change callbacks and selection/update events expose `user`, `command`, `external`, `reset`, or namespaced extension origins
- built-in code block languages cover JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a compatibility snapshot
