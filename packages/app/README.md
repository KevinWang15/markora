# Markora App

Markora App is the installable, local-first desktop home for the Markora editor. It uses NW.js and keeps document persistence in the desktop host while reusing the `markora` and `markora-ui` packages for editing.

## Product features

- Native Markdown open, save, save-as, launch-with-file, and single-instance flows
- Unsaved-change protection for new, open, and close actions
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
