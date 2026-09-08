# Architecture and maintenance boundaries

## Package responsibilities

`markora` owns Markdown/model semantics, editing commands, extensions, and embedded
editor lifecycle. `markora/minimal` is a separate feature assembly with the same
foundation contracts and a smaller dependency graph. `markora-ui` owns optional
DOM overlays. Syntax extensions own their schemas, parsing and commands; host
adapters supply dialogs and renderers. React and NW.js stay in host packages.

## Shared editor runtime

Full and minimal assemblies share these internal modules:

- `editorDom`: validated host attributes and DOM focus helpers.
- `editorSelection`: portable selection resolution and snapshots. The full
  assembly adds table selection classification without importing tables into minimal.
- `editorTransactionRuntime`: transaction origin, view update ordering, callback
  error collection, and stale-delivery checks. Full-only CodeMirror history and
  view error collection enter through the `updateView` hook.
- `editorStateEvents`: state, selection, and update event ordering, with a validity
  check between subscribers that may dispatch or destroy synchronously.
- `editorFocus`: composite focus ownership and deferred delivery after native
  editor focus stacks have returned; disposal invalidates queued notifications.
- `proseMirrorCompatibility`: the version-sensitive hidden-selection listener
  workaround. Remove it only when the supported upstream version cleans up that
  listener and the retained-listener regression test passes without the adapter.

Feature-specific command assembly, node views, extension construction and UI
mounting stay in the factories. These still have room for incremental extraction;
do not introduce a universal feature container or import the full assembly from
minimal. `sharedRuntime.test.ts` runs common behavior through both public factories.
Packed-consumer checks enforce the actual dependency boundary.

## Application operations and commands

`DocumentController` owns the document session, application history, save/export
locks, subscribers, and open-request ordering. Its snapshot is stable between
changes and is consumed with `useSyncExternalStore`. A completed save updates only
the originating document's disk baseline; edits made during that save remain dirty.
Replacing a document invalidates pending opens. Operation locks release on success,
cancellation and failure.

React adapters supply editor flushing, resource resolution, native writes, dialogs,
and view restoration. Core history and application history have different jobs:
application history spans source/rich mode and retains rich model snapshots that
Markdown cannot represent. All host history surfaces route through the same action.

`applicationActions` routes toolbar, keyboard, native-menu and context-menu host
actions. Availability is checked again at execution time. Context-menu history
binding walks nested menus and reads current handlers instead of capturing stale
render state. Dialog-specific confirmations call their explicit operations directly.

## Browser harness and CI

`browser-lab/protocol.ts` is the single source contract for the browser fixture and
Playwright. It contains type imports only. The React page mounts a DOM runtime;
`editorAdapter` handles command/snapshot and extension fixture adaptation. Playwright
fixtures derive request and result types from the protocol. Browser typechecking
resolves workspace source rather than requiring generated package declarations.

CI builds the demo once and downloads the same artifact for each browser. The
app browser job reuses the app build produced by `pnpm check`. The explicit
`MARKORA_BROWSER_BUILD=reuse` switch means the caller must have prepared the
appropriate `dist` directory. Ordinary local Playwright commands still build it.
New pushes cancel obsolete browser/performance runs for the same branch.

## Menu interaction

Providers and immutable items remain separate from DOM rendering. Each menu panel
owns its typeahead state; navigation calculations accept explicit indices and time
and are tested without browser timers. Sessions continue to own abort signals,
selection validity, pending commands and overlay teardown. Browser tests cover
focus, nested navigation, clipboard permission races, portals and viewport layout.

## Serialization performance

`markdownSerializerBuffer` isolates the output-writing compatibility boundary with
ProseMirror. It stores chunks plus a two-character suffix so line-ending checks do
not repeatedly flatten the accumulated document. Custom serializers can still
read/write `out`; escaping and block/mark rendering remain upstream. Differential
unit tests cover writer fidelity and the normal Markdown regression suite covers
Markora's dialect and extensions.

Use `pnpm perf:serialization` for a focused, repeatable codec diagnostic. For CPU
profiles, first build core, then run:

```sh
mkdir -p performance-results
node --cpu-prof --cpu-prof-dir=performance-results scripts/profile-serialization.mjs
```

The packed Chromium runtime and memory gates remain the production performance
checks. A faster codec diagnostic alone does not establish browser responsiveness.
