# Markora App

Markora App is the installable, local-first desktop home for the Markora editor. It uses NW.js and keeps document persistence in the desktop host while reusing the `markora` and `markora-ui` packages for editing.

## Product features

- Native Markdown open, save, save-as, launch-with-file, drag-to-open, and single-instance flows
- Unsaved-change protection for new, open, and close actions
- Syntax-highlighted whole-document source mode with `Ctrl+/` or `Cmd+/`
- Outline navigation, recent documents, word and character counts
- Light, dark, and system appearance modes
- Native menus and familiar document shortcuts
- Images copied to a sibling `<document>.assets` directory when a document has been saved
- Self-contained NW.js distributions for the current operating system

## Develop

From the repository root:

```sh
pnpm install
pnpm build:packages
pnpm --filter markora-app dev:nw
```

`dev:nw` builds the renderer and launches the NW.js SDK with remote debugging on port `9223`.

For renderer-only browser work:

```sh
pnpm --filter markora-app dev
```

## Build a distributable application

```sh
pnpm dist:app
```

The application is written to `packages/app/release/<platform>-<architecture>`. On Linux, run `./install.sh` from that platform directory to install Markora for the current user, or launch `Markora` in place. The NW.js runtime is included, so recipients do not need Node.js, pnpm, or NW.js installed.

To cross-build the portable Windows x64 application from any supported host:

```sh
pnpm dist:app:windows
```

The result is `packages/app/release/win-x64/Markora.exe`. Distribute the complete `win-x64` directory because the executable uses the NW.js DLLs and resources beside it. This is a portable application, not an installer.

NW.js is pinned in `scripts/nw.mjs`; upgrading it is an explicit product update rather than an ambient dependency change.

## Document safety

Saves write and flush a temporary file before replacing the destination. The
previous saved version is kept beside the document as `.<filename>.markora-backup`.
If a file changes outside Markora after it was opened or saved, Save refuses to
overwrite it. Reopen it to review the disk version, or use Save As for a separate
copy. Untouched documents retain their original Markdown and line endings.

Unsaved changes are checkpointed to `recovery.json` in the NW.js application data
directory. Source edits are coalesced over 300 ms; rich edits use the editor's idle
change delivery (up to five seconds during continuous typing). After an unexpected
exit, the app offers Restore or Discard recovery. Recovery is a recent checkpoint,
not a guarantee that the final keystroke before a crash reached disk. Normal close
waits for its final checkpoint. The renderer-only browser uses local storage.

The desktop dialect enables semantic footnotes and `[TOC]`. Source and rich views
share a bounded document undo/redo history, including edits made before switching
views. Typing bursts are grouped; explicit view changes separate groups. Rich
history snapshots retain immutable editor nodes, so typing does not require
serializing the document on each keystroke. The outline uses the editor's indexed
heading positions in rich mode and CommonMark source positions in source mode.

Save As copies relative images within the original document folder to the new
folder while keeping the authored URLs unchanged. Existing different images are
never overwritten, and references outside the document folder require saving in
the original folder or using absolute URLs. External HTTP images are not copied.
The app asks before saving table structures that Markdown cannot represent.

Run `pnpm test:app:browser` from the repository root for production-renderer
behavior checks, including CDP input, mode-switch history, exact-source saves,
modal focus, outline navigation, footnotes, and recovery. These run alongside the
unit/typecheck job in CI; native filesystem checks also use isolated NW.js CDP
sessions during development.
