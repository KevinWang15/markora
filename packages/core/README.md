# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor built with ProseMirror and CodeMirror. It parses a documented Markdown subset into an editable ProseMirror document and serializes supported content to a predictable canonical form.

## Features

- Semantic import/edit/export for the documented Markdown dialect, with normalized serialization
- Exact, inert source preservation for conservatively recognized front matter, display math, HTML, and directives
- Headings, blockquotes, lists, flat task items, images, code fences, and pipe tables
- Inline marks for bold, italic, code, strike, and links
- Embedded CodeMirror code blocks with language-aware editing
- Lazy-loaded built-in code block languages with host-extensible loaders
- Toolbar-friendly commands for formatting, links, images, and undo/redo
- URL sanitization plus managed navigation around tables and code blocks

## Markdown compatibility

`markdown` and `editor.commands.setMarkdown()` are parsing boundaries. `editor.getMarkdown()` and `onChange` return normalized serialization, not the original document bytes. Conservatively recognized front matter, standalone display math, HTML, comments, and directives are retained as inert opaque source atoms; other unsupported extensions may still be reinterpreted without an error.

Read the complete [Markdown dialect and fidelity contract](./MARKDOWN_COMPATIBILITY.md), which is also included in the published package.

Opaque HTML is displayed as text and never executed inside the editor. Serialized Markdown still contains that source, so downstream HTML rendering must apply its own sanitization.

## Install

```bash
npm install markora

# Optional built-in link/image/table overlays
npm install markora-ui
```

## Quick start

```ts
import { createEditor } from "markora";
import "markora/styles.css";

const hostElement = document.querySelector("#editor");

if (!hostElement) {
  throw new Error("Editor host not found.");
}

const editor = createEditor({
  element: hostElement,
  markdown: "# Hello Markora",
  onChange(nextMarkdown) {
    console.log(nextMarkdown);
  },
});

editor.view.focus();

// Later, when the host view unmounts:
editor.destroy();
```

## Opaque source editing

Opaque atoms are read-only unless the host supplies `onEditOpaqueMarkdown`. Use the hook to open a host-owned source editor:

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

`update(nextSource)` returns `false` if the atom was removed, replaced, or changed while the source editor was open. A successful update is undoable, preserves the atom's existing kind, and does not validate or reclassify the new source. See the compatibility contract for the exact preservation boundary and recognized shapes.

## Optional default UI

`markora` is headless by default. Add `markora-ui` when you want the repo's built-in link editor, image editor, and table toolbar overlays.

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ui: createDefaultUi(),
  onChangeMode: "animationFrame",
  onChange(nextMarkdown) {
    saveDraft(nextMarkdown);
  },
});
```

## Integration notes

A typical integration has four parts:

- import `createEditor` from `markora`
- import `markora/styles.css`
- optionally pass `ui: createDefaultUi()` from `markora-ui`
- destroy the editor instance when the host view unmounts

Host-facing behavior to keep in mind:

- `editor.view` gives you access to the underlying ProseMirror view for focus and DOM event wiring
- `editor.commands.setMarkdown(markdown)` parses supported Markdown and replaces the document
- `editor.commands.setMarkdown(markdown, { emitChange: true })` also re-fires `onChange` with normalized output
- `onTransaction` lets hosts observe editor activity without serializing Markdown on every transaction
- `onEditOpaqueMarkdown` lets a host provide explicit source editing for otherwise read-only opaque atoms
- `onChangeMode: "animationFrame"` smooths larger documents by batching Markdown emission once per frame
- `editor.flushChange()` forces pending batched `onChange` work to run immediately
- the package ships editor base styles, while surrounding layout and product UI remain the host app's responsibility

## Exports

```ts
import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";
import type {
  CodeBlockLanguageRegistry,
  CodeBlockLanguageSupport,
  CreateEditorOptions,
  MarkdownEditor,
  MarkdownEditorCommands,
  MarkdownEditorState,
  MarkdownEditorUi,
  OpaqueMarkdownEditRequest,
  OpaqueMarkdownKind,
  ToolbarButtonState,
  ToolbarState,
} from "markora";
```

## Code block languages

Built-in CodeMirror highlighting and editing grammars for JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell load on demand. You can add or override a grammar with `codeBlockLanguages`:

```ts
import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element: hostElement,
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [
      // Return CodeMirror extensions for your custom fenced language.
    ],
  },
});
```

## API highlights

- `editor.getMarkdown()` returns the current normalized Markdown serialization
- `editor.commands.setMarkdown(markdown, { emitChange })` parses according to the supported dialect and replaces the document
- `onEditOpaqueMarkdown` receives an opaque atom's `kind`, exact `source`, and guarded `update(nextSource)` function
- `editor.commands.toggleMark(...)`, `editor.commands.setLink(...)`, `editor.commands.insertImage(...)`, `editor.commands.undo()`, and `editor.commands.redo()` form the command surface
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a compatibility snapshot
- `editor.ui?.editLink()` and `editor.ui?.editImage()` are the optional namespaced UI entry points when overlays are attached
- `editor.destroy()` tears down the editor view and listeners

## Development

- `pnpm dev` starts the core watcher and demo site together
- `pnpm pack:smoke` verifies the packed `markora` and `markora-ui` tarballs in a tiny Vite consumer app
- `pnpm release:check` dry-runs the core npm tarball and then runs the packed-consumer smoke test
- `pnpm check` builds the workspace, runs typechecks, executes API type tests, smoke-tests Node ESM imports, and runs the shared test suite
