# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor library built with ProseMirror and CodeMirror. This repository contains the publishable editor package plus a docs/demo app for developing and testing the editor in the browser.

## What’s in this repo

- `packages/core` — the npm package published as `markora`
- `packages/demo` — the Vite demo and documentation site

## Highlights

- Typora-like editing with Markdown as the source of truth
- Headings, blockquotes, lists, task lists, code fences, images, and tables
- Inline marks for bold, italic, code, strike, and links
- Table alignment preservation and typed pipe-table conversion
- Embedded CodeMirror code blocks with language-aware editing
- Lazy-loaded built-in code block languages with host-extensible loaders
- Managed block navigation around tables and code blocks
- Safer URL sanitization for links and images

## Install

```bash
npm install markora markora-ui
```

## Quick start

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

## Development

```bash
pnpm install
pnpm dev
```

Useful scripts:

- `pnpm dev` — run the core watcher and the demo site together
- `pnpm dev:core` — watch the package build only
- `pnpm dev:demo` — run the demo site only
- `pnpm build` — build the package and demo
- `pnpm check` — build packages, run typechecks, verify public API types, smoke-test Node ESM imports, and execute the test suite
- `pnpm pack:smoke` — pack `markora` and `markora-ui`, install them into a tiny Vite app, and verify the build
- `pnpm test` — run the Vitest suite

## Publishing

The npm package is defined in `packages/core`.

```bash
pnpm release:check
cd packages/core
npm publish --tag test
```

Notes:

- `pnpm release:check` dry-runs the core tarball and runs a packed-consumer smoke test for `markora` + `markora-ui`
- publish prereleases with `--tag test` so they do not become `latest`
- when you are ready for a stable release, publish without the test tag

### Publish checklist

```bash
# from the repo root
pnpm release:check

# make sure you are logged in to npm
npm whoami

# publish a prerelease from the package directory
cd packages/core
npm publish --tag test.2026030901
```

- `packages/core/package.json` controls the published package name and version
- publish prereleases with a dated tag like `test.2026030901`
- install that prerelease with `npm install markora@test.2026030901`
- publish the stable release without a prerelease tag when ready

## API notes

- `createEditor({ onChangeMode: "animationFrame" })` batches Markdown serialization once per frame
- `createEditor()` is headless by default; pass `ui: createDefaultUi()` from `markora-ui` for the built-in overlays
- `codeBlockLanguages` lets hosts add or override lazy CodeMirror language loaders
- relative link and image URLs stay relative when stored or re-serialized
- `editor.commands.setMarkdown(markdown)` is the structured headless update path
- `editor.commands.setMarkdown(markdown, { emitChange: true })` re-emits `onChange` after a programmatic update
- `onTransaction` lets hosts observe editor transactions without forcing serialization on every change
- `editor.flushChange()` forces any pending batched `onChange` emission to run immediately
