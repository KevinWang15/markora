# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor built with ProseMirror and CodeMirror. It gives you a clean editing surface, round-trip Markdown import/export, and a small host-facing API that is easy to wire into your app.

## Features

- Markdown import/export backed by ProseMirror documents
- Bold, italic, code, strike, links, and images
- Headings, blockquotes, lists, task lists, code fences, and tables
- Embedded CodeMirror code blocks with language-aware editing
- Table alignment preservation and typed pipe-table conversion
- Toolbar-friendly commands for formatting, undo/redo, links, and images

## Install

```bash
npm install markora
```

## Usage

```ts
import { createEditor } from "markora";
import "markora/styles.css";

const editor = createEditor({
  element: document.querySelector("#editor")!,
  markdown: "# Hello Markora",
  onChange(markdown) {
    console.log(markdown);
  },
});
```

## Integration notes

`markora` is framework-agnostic. A typical integration has three parts:

- import `createEditor` from `markora`
- import the base stylesheet from `markora/styles.css`
- destroy the editor instance when the host view unmounts

```ts
import { createEditor } from "markora";
import "markora/styles.css";

const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  onChange(nextMarkdown) {
    console.log(nextMarkdown);
  },
});

editor.view.focus();

return () => {
  editor.destroy();
};
```

- `editor.view` gives you access to the underlying ProseMirror view for focus and DOM event wiring
- `editor.setMarkdown(markdown)` is silent by default, which is useful when syncing external state into the editor
- use `editor.setMarkdown(markdown, { emitChange: true })` if you want programmatic updates to trigger `onChange`
- the package ships editor base styles, while layout and surrounding UI remain the host app's responsibility

## Exports

```ts
import { createEditor } from "markora";
import type {
  CreateEditorOptions,
  MarkdownEditor,
  ToolbarButtonState,
  ToolbarState,
} from "markora";
```

## API highlights

- `editor.getMarkdown()` returns the latest Markdown string
- `editor.setMarkdown(markdown, { emitChange })` replaces the document
- `editor.getToolbarState()` exposes button enable/active states
- `editor.toggleBold()`, `editor.toggleItalic()`, `editor.toggleCode()`, and `editor.toggleStrike()` apply inline formatting
- `editor.setLink(...)`, `editor.insertImage(...)`, `editor.removeLink()`, and `editor.removeImage()` handle media actions
- `editor.flushChange()` forces pending batched `onChange` work to run immediately

## Development

- `pnpm dev` starts the core watcher and demo site together
- `pnpm release:check` builds the package, runs typechecks, and previews the npm tarball
- publish prereleases with `npm publish --tag test`
