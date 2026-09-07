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

The desktop dialect enables semantic footnotes, `[TOC]`, math, and diagram fences. Source and rich views
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


## Manual Windows and macOS builds

In GitHub, open **Actions → Build desktop binaries → Run workflow**. Choose
`windows-x64`, `macos-arm64` (Apple Silicon), `macos-x64` (Intel), or `all`.
The default builds Windows only. This workflow has only `workflow_dispatch`:
commits, pull requests, tags, and schedules never start binary builds.

Each selected target builds on its native runner, verifies the packaged manifest
and renderer entry, and checks that the native process stays running through
startup. The normal NW.js runtime omits DevTools; this launch check does not
certify UI behavior. Detailed CDP checks live in the separate app browser suite. Successful jobs upload a ZIP and SHA-256
checksum under the run's **Artifacts** section. Artifacts expire after seven days;
download them before then. ZIP contents include the NW.js runtime. Extract the
complete Windows folder before running `Markora.exe`; the Mac ZIP contains
`Markora.app` and preserves its permissions and framework symlinks.

Windows builds have no publisher signature. Mac builds are ad-hoc signed after
packaging, without Developer ID signing or notarization. These are testable
portable builds; trusted public distribution still needs signing credentials.
The existing browser and performance workflows keep their separate triggers.

Source and rich views retain their own caret and scroll positions when switching.
Entering source mode asks for consent if the current table structure cannot be
represented by Markdown; cancelling leaves the rich document intact. Accepted
source edits remain undoable back to the rich snapshot.

Word counts and source outlines run in a coalescing worker. Stale outline entries
are disabled until current positions arrive. See
[desktop performance measurements](../../docs/desktop-performance.md) for the
100 KB–1 MB source-typing comparison and reproduction command.

## Find, previews, and export

- **Find and replace** (`Ctrl/Cmd+F` or `Ctrl/Cmd+H`) searches the active view. Rich
  searches cross formatting marks within a text block; source searches include
  Markdown syntax. Matching is literal, with case and Unicode whole-word options.
  Replace all is one document undo step. Searches report a 10,000-match limit and
  disable Replace all when exceeded; up to 1,000 matches plus the active result
  are highlighted to bound decoration work.
- Inline/block math uses a locally bundled, lazy-loaded KaTeX parser and native
  MathML. Mermaid uses a lazy-loaded local renderer with strict security and SVG
  labels. Source-edit controls retain the extension's stale-target protection.
  Configuration directives and active/unsupported SVG output fall back to source;
  GeoJSON, TopoJSON and STL remain editable source without a preview renderer.
- **Export HTML** writes a static, sanitized document with inline styles, MathML,
  rendered Mermaid (or source on rendering failure), and embedded native local
  images. Remote images remain remote. Local image embedding accepts PNG, JPEG,
  GIF, WebP and SVG, with a 20 MB limit per image. Missing local files report an
  error. Export preserves the active document's path, saved baseline and history.
- **File → Export → PDF…** (or **Export PDF** in the toolbar) in the desktop app writes the same document to the chosen PDF
  path using Chromium printing and an atomic file replacement. Browser previews
  show **Print / Save as PDF** and open their print dialog. Editor tools, search
  highlights and source-mode chrome are excluded; current source edits are included.

Renderer configuration follows the official [KaTeX options](https://katex.org/docs/options),
[Mermaid API](https://mermaid.js.org/config/usage.html), and
[Chromium printing protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF).
The native PDF path uses the internal `chrome.debugger` transport (also available
in normal NW.js) without opening a remote debugging port. It avoids a reproducible
NW.js 0.115.0 legacy print-preview crash, including on a minimal standalone page.
The packaged app sets Chromium's `--silent-debugger-extension-api` option in its
[NW.js manifest](https://docs.nwjs.io/References/Manifest%20Format/#chromium-args)
so this internal printing connection does not show a browser debugging banner.
This option is scoped to the Markora runtime; it does not change the user's browser.
The native File menu is available on Windows, Linux and macOS, with both PDF and
HTML exports using the same actions as the toolbar. Export actions stay disabled
while an export is running.

## Native behavior checks

The manual binary workflow has an optional **behavior_checks** checkbox (off by default). It packages a separate NW.js SDK runtime from the same production
renderer, runs `scripts/native-behavior.mjs` over CDP on the selected runner, and
uploads a JSON report, screenshot and runtime log. Downloadable binaries continue
using the normal runtime. No Windows/macOS build runs on pushes, PRs or schedules.

The checks cover native command-line opening, relative image loading, math,
atomic saves and backups, edits during a delayed save, Save As with asset copying,
find/replace and undo, native HTML/PDF output, recovery and unsaved-close handling.
Only file chooser interaction is substituted; filesystem writes and the
Chromium PDF renderer are real. Unicode insertion is synthetic and does **not** certify
OS IME, VoiceOver/NVDA or native chooser accessibility. Those remain human checks
in the [assistive technology checklist](../../docs/assistive-technology-checklist.md).

For a local diagnostic build after `pnpm build:app`:

```sh
node packages/app/scripts/nw.mjs build linux x64 sdk
node packages/app/scripts/native-behavior.mjs linux x64
```

Use `win x64`, `osx arm64` or `osx x64` on the corresponding host. Linux needs a
display (for example `xvfb-run -a` in a headless environment).

PDF exports use the selected theme’s colors, typography, headings, tables, and code surfaces. System appearance is resolved when export starts. Dark themes retain their dark paper background. Exporting from source mode uses the latest source without changing document history or saved state.
