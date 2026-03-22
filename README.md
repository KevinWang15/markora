# markora

![](./banner.png)

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor library built with ProseMirror and CodeMirror. This repository contains the headless editor core, the optional default UI package, and the docs/demo app used for development and verification.

## Packages

- `packages/core` — the npm package published as `markora`
- `packages/ui` — the npm package published as `markora-ui`
- `packages/demo` — the Vite docs site, live playground, and internal regression surface

## Highlights

- Typora-like editing with Markdown as the source of truth
- Round-trip Markdown import/export for headings, quotes, lists, task lists, images, code fences, and tables
- Inline marks for bold, italic, code, strike, and links
- Embedded CodeMirror code blocks with lazy-loaded built-in grammars
- Headless command/state APIs plus optional overlays from `markora-ui`
- Safer URL sanitization and managed navigation around tables and code blocks

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
  ui: createDefaultUi(),
  onChangeMode: "animationFrame",
  onChange(nextMarkdown) {
    console.log(nextMarkdown);
  },
});

editor.view.focus();

// Later, when the host screen unmounts:
editor.destroy();
```

## Architecture notes

- `markora` is headless by default: it owns parsing, serialization, commands, state, and embedded code-block editing
- `markora-ui` adds the repo's default link editor, image editor, and table toolbar overlays
- `codeBlockLanguages` lets hosts add or override lazy CodeMirror language loaders
- `editor.commands.setMarkdown(markdown, { emitChange: true })` is the programmatic update path when you want `onChange` to re-fire
- `editor.flushChange()` forces any pending animation-frame batched Markdown emission to run immediately

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
- `pnpm pack:smoke` — pack `markora` and `markora-ui`, install them into a tiny Vite app, and verify the build
- `pnpm release:check` — dry-run the `markora` tarball and then run the packed-consumer smoke test
- open `/__dev` in the demo app for fixture-driven regression checks while developing the editor itself

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
- built-in code block languages cover JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a compatibility snapshot
