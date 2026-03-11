# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor built with ProseMirror and CodeMirror. It gives you a clean editing surface, round-trip Markdown import/export, and a small host-facing API that is easy to wire into your app.

## Features

- Markdown import/export backed by ProseMirror documents
- Bold, italic, code, strike, links, and images
- Headings, blockquotes, lists, task lists, code fences, and tables
- Embedded CodeMirror code blocks with language-aware editing
- Built-in code block languages load on demand instead of eagerly bundling every grammar
- Table alignment preservation and typed pipe-table conversion
- Toolbar-friendly commands for formatting, undo/redo, links, and images

## Install

```bash
npm install markora markora-ui
```

## Usage

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const editor = createEditor({
  element: document.querySelector("#editor")!,
  markdown: "# Hello Markora",
  ui: createDefaultUi(),
  onChange(markdown) {
    console.log(markdown);
  },
});
```

## Integration notes

`markora` is framework-agnostic. A typical integration has three parts:

- import `createEditor` from `markora`
- import the base stylesheet from `markora/styles.css`
- optionally attach UI from `markora-ui` if you want the built-in link/image/table overlays
- destroy the editor instance when the host view unmounts

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ui: createDefaultUi(),
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
- `editor.commands.setMarkdown(markdown)` is the structured headless update path
- use `editor.commands.setMarkdown(markdown, { emitChange: true })` if you want programmatic updates to trigger `onChange`
- `markora` stays headless by default; install `markora-ui` when you want the built-in link, image, and table overlays
- the package ships editor base styles, while layout and surrounding UI remain the host app's responsibility
- built-in code block languages are lazy-loaded; use `codeBlockLanguages` to add or override language support

## Exports

```ts
import { createEditor } from "markora";
import type {
  CodeBlockLanguageRegistry,
  CodeBlockLanguageSupport,
  CreateEditorOptions,
  MarkdownEditor,
  ToolbarButtonState,
  ToolbarState,
  createDefaultCodeBlockLanguageRegistry,
} from "markora";
```

## Code block languages

Built-in JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell grammars now load on demand. You can add or override support with `codeBlockLanguages`:

```ts
import { createEditor } from "markora";

const editor = createEditor({
  element: hostElement,
  codeBlockLanguages: {
    custom: async () => [/* CodeMirror extensions */],
  },
});
```

## API highlights

- `editor.getMarkdown()` returns the latest Markdown string
- `editor.commands.setMarkdown(markdown, { emitChange })` replaces the document through the structured headless API
- `editor.commands.toggleMark(...)`, `editor.commands.setLink(...)`, `editor.commands.insertImage(...)`, `editor.commands.undo()`, and `editor.commands.redo()` form the headless command surface
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a single derived snapshot
- `editor.ui?.editLink()` and `editor.ui?.editImage()` are the optional namespaced UI entry points when overlays are attached
- `editor.flushChange()` forces pending batched `onChange` work to run immediately

## Development

- `pnpm dev` starts the core watcher and demo site together
- `pnpm pack:smoke` verifies the packed `markora` and `markora-ui` tarballs in a tiny Vite consumer app
- `pnpm release:check` dry-runs the core npm tarball and then runs the packed-consumer smoke test
- `pnpm check` builds the workspace, runs typechecks, executes API type tests, smoke-tests Node ESM imports, and runs the shared test suite
- publish prereleases with `npm publish --tag test`
