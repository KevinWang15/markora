# Improvement plan: one shared atom node view

Status: all true-atom migrations implemented on `feat/atom-node-view-primitive`,
based on `main` after PR #2 (selection rings follow editor focus).

## Phases 2–4 implementation

- Components, frontmatter, TOC, block/inline HTML, block/inline math, footnote
  references, and core images now compose `createAtomView`. Their existing
  controllers retain parsing, rendering, navigation, editing, history, and
  cancellation; the primitive owns the NodeView hooks and lifetime listeners.
- Semantic frame tags, optional inline headers, visible status, and a selection
  notification preserve existing accessibility and selected-only source UI.
  Extension-specific selection CSS is removed; TOC's color token remains an
  alias to the shared ring token.
- Frontmatter uses the shared frame even without a host edit callback, so its
  read-only source presentation keeps the same selection behavior. The edit
  button remains absent unless `onEditSource` is supplied.
- The original proposal incorrectly classified **diagrams and footnote
  definitions** as atoms. Both have editable `contentDOM` and non-atom schemas.
  They stay in the editable-content family; their mutation and event ownership
  cannot safely use the atom primitive. No schema or typing behavior is changed.
- Migrated extensions declare extension API `^1.5.0`; their exported consumer
  APIs, Markdown formats, and renderer contracts are unchanged. Release
  preparation targets `markora@0.1.2` and components `0.0.3`; the five unpublished
  migrated extensions retain `0.0.1`. All six require core `^0.1.2` in both npm
  peer dependencies and runtime compatibility metadata.

### Phases 2–4 verification (2026-10-23)

- `umask 0022; pnpm check`: **127 test files / 1,881 tests passed**, including
  builds, public API checks, and browser typechecks. The new integration tests
  exercise every migrated family and preserve editable diagrams and footnotes;
  an architecture test prevents duplicated atom hooks and selection CSS.
- `pnpm release:check`: **passed**, including packed consumer execution,
  package isolation, and bundle budgets. Only standalone math's JavaScript
  ceilings change in these phases; measured costs and headroom are documented
  in [performance budgets](./performance-budgets.md#bundle-contract).
- Focused Chromium, Firefox, and WebKit run: **40 passed / 2 skipped**. This
  covers shared frames, focus, read-only state, forced colors, custom-component
  editing/history, native math editing, IME, and clipboard ownership. The two
  skips are the Chromium-only CDP component case in the other engines.
- Full required browser suite: **951 passed / 87 skipped / 30 failed** versus
  `main` at `80c1106`: **935 / 87 / 28**, with 18 added cases across both rounds
  of this work. Twenty-seven failures match baseline; its WebKit foundation
  typing timeout does not recur. Three additional WebKit failures (image/rule
  boundaries, list continuation, and visual range selection) each pass **three
  times on both frozen builds** in one-worker follow-ups. No reproducible
  migration-only failure was found. The full browser gate remains non-green;
  unrelated failures and timeout policy are unchanged.
- Three Chromium CDP screenshots (edited chart, settings, and forced-colors
  atom frames) were inspected and uploaded to the requested transfer session
  `111111` with proxy variables unset.

### Release preparation verification (2026-10-23)

- Frozen-lockfile installation and `pnpm check` pass with the release metadata:
  **127 test files / 1,887 tests**, including six new package/runtime version and
  minimum-core compatibility checks.
- `pnpm release:check` passes with the new versions and peer requirements.
- All seven release tarballs come from that successful packed-consumer run.
  Their SHA-256 checksums and `npm publish --dry-run` checks pass. Publication
  order and artifact preparation commands are in the [publishing guide](../README.md#publishing).
- Nothing was published. The full browser gate described above remains
  non-green; release preparation does not waive those failures.

## Phase 1 implementation

- The public helper ships through `markora/extension-api` as additive API 1.5.0.
  Its [implemented contract](./extension-system-rfc.md#shared-atom-node-views)
  supersedes the design sketch below: contexts carry the ProseMirror node rather
  than an unchecked generic attributes cast, plus stable DOM slots and an abort
  signal. Rendering is synchronous; async work remains extension-owned.
- Core opaque block and inline views use the helper. Their exact source,
  localization, stale edit guards, and history behavior are retained.
- Both core stylesheets include the shared frame and focus-following ring. Opaque
  selection changes visually from a border/box-shadow to a 2px outline with a
  2px offset. `--mdw-atom-selection-color` customizes its color; forced-colors uses
  system `Highlight`. No extension stylesheet changes in this phase.
- Unit, public type, packed-consumer, and real-browser tests exercise the helper,
  including iframe owner documents, read-only refresh, cleanup, Shadow DOM,
  focus transitions, and forced colors.

### Phase 1 verification (2026-10-23)

Baseline: `main` at `80c1106`. Browser runs use separate frozen production demo
builds, four workers, no retries, and the installed Chromium, Firefox, and WebKit.

- `umask 0022; pnpm check`: 126 test files, 1,873 tests passed, with all build,
  public API, browser type, and workspace checks passing. The umask matches the
  existing desktop persistence test's file-mode assumption.
- `pnpm release:check`: packed consumer types/runtime, package isolation, shared
  styles in both entries, and bundle budgets passed. The minimal-only budget
  adjustment is recorded in [performance budgets](./performance-budgets.md).
- The focused opaque browser suite passes all 12 cases across the three engines,
  including Chromium CDP forced-colors emulation.
- Full required browser suite: baseline **935 passed / 87 skipped / 28 failed**;
  phase 1 **940 passed / 87 skipped / 32 failed**, including nine added cases.
  All 28 baseline failures remain. The extra Firefox vertical-navigation timeout
  reproduces three times on each build. The three extra WebKit failures (empty
  structural-block clicks, list continuation, and page navigation) each pass
  twice on both builds in isolated follow-up runs. No reproducible feature-only
  failure was found; the overall browser gate is still not green. Unrelated
  navigation/layout failures and timeout policy are unchanged.

## Problem

Markora's extension architecture is sound. Extensions contribute through one typed API
(`extensionApi.ts`), built-in features ship as extensions on that same API, and custom
components are declared (name, props parsing, render, edit) without writing a ProseMirror
node view.

The layer below that is not shared. Every atom (a node with no editable content, rendered
by a node view) re-implements the same plumbing:

- `selectNode` / `deselectNode` toggling `ProseMirror-selectednode`: 11 implementations.
- `stopEvent` deciding which events belong to the atom's own controls: about 9.
- An `isInside(target, element)` helper: 6 copies (`extension-footnotes`, `extension-html`,
  `extension-frontmatter`, `extension-diagrams`, `extension-math`, and core's
  `isEventTargetInside`).
- `ignoreMutation`, `destroy`, `contentEditable = "false"`, accessible labels and a polite
  status live region, written by hand in each view.
- A selection-ring rule in 8 stylesheets, which have already drifted: some use
  `--mdw-color-focus`, some `--mdw-color-accent`, one a box-shadow, with different offsets.

Core has a shared helper, `createOpaqueNodeViewClass` (`packages/core/src/opaqueNodeView.ts`),
but only core uses it.

PR #2 shows the cost. The selection ring stayed visible after the editor lost focus, and the
fix had to edit 8 stylesheets because there was no single place to make it.

## Goal

One implementation per kind of node view. A fix to selection, focus, event ownership or
accessibility lands once and applies to every atom, built-in or custom. No change in
behaviour, Markdown output or public API for extension users, except where noted.

## Node view families

Share only within a family. Forcing these onto one base would make the code worse.

| Family | Members | Shared? |
|---|---|---|
| Block atom | components, block math, block HTML, frontmatter, TOC, core opaque blocks | Yes: the subject of this plan |
| Inline atom | inline math, inline HTML, footnote references, images, core opaque inline | Yes: same primitive, inline frame (phase 4) |
| Editable content | code blocks (CodeMirror), tables, task list items, alerts, diagrams, footnote definitions | No: they own editable content and their own selection rules |

## Design

### `createAtomView` (core)

A core primitive that owns the behaviour every atom needs. Extensions supply only what
differs.

```ts
interface AtomViewSpec<Attrs> {
  // Block atoms render a frame with a header; inline atoms render a span.
  display: "block" | "inline";
  // Accessible name for the atom, from its attributes.
  label(attrs: Attrs): string;
  // Builds the atom's content inside the frame. Returns an update hook (or false to
  // recreate) and a cleanup.
  render(context: AtomRenderContext<Attrs>): AtomRendering<Attrs>;
  // Header controls (block atoms). Events inside them belong to the atom, not the editor.
  controls?: readonly AtomControl[];
  // Other regions whose events the atom handles itself (an inline source editor, a preview
  // with its own interactions).
  ownsEvents?: (target: Node) => boolean;
}
```

The primitive provides, once:

- the frame: `contentEditable = "false"`, a stable class (`mdw-atom`, plus `mdw-atom-block` or
  `mdw-atom-inline`), the header slot and controls slot, `aria-label`, and a status live region
- selection: `selectNode` / `deselectNode` toggling `ProseMirror-selectednode`
- event ownership: `stopEvent` returns true for events inside `controls` or `ownsEvents`; one
  `isInside` helper
- `ignoreMutation` for everything inside the frame
- `destroy`, which calls the rendering's cleanup and releases registrations
- read-only transitions (controls disabled with `aria-disabled` when the editor isn't editable)

### One selection-ring rule

Core's stylesheet defines the ring once, keyed on the shared class:

```css
.mdw-host .ProseMirror.ProseMirror-focused .mdw-atom.ProseMirror-selectednode {
  outline: var(--mdw-selection-ring-width, 2px) solid var(--mdw-color-focus, #0969da);
  outline-offset: var(--mdw-selection-ring-offset, 2px);
}
```

plus its forced-colors variant. Extensions delete their own ring rules. An extension that
needs a different ring colour sets a variable on its atom, as `--mdw-alert-selection-color`
and `--mdw-toc-selection-color` do today; it does not write a second rule.

This standardizes the ring's look, which changes slightly for the extensions that drift
today. Call that out in the release notes.

### Components extension

`extension-components` builds its node view on `createAtomView`. Its public API
(`defineComponent`, `createComponentRegistry`, `createComponentsExtension`) is unchanged.
`nodeView.ts` (about 290 lines) should shrink to the component-specific parts: props
parsing, the source form, and the preview mount.

## Phases

The original sequencing is retained below. At the user's request, the remaining
phases are implemented together in the dedicated worktree, with focused tests
and a final baseline comparison rather than separate commits or PRs.

1. **Primitive.** Add `createAtomView`, the shared ring rule, and unit tests for event
   ownership, selection classes and destroy. Re-implement `createOpaqueNodeViewClass` on it.
   No extension changes yet.
2. **Components.** Migrate `extension-components`. Its browser tests
   (`tests/browser/components*.spec.ts`) cover editing, history, read-only transitions and,
   since PR #2, the focus-following ring.
3. **Block atoms:** frontmatter, TOC, block HTML, block math. Each deletes its own
   `selectNode`/`stopEvent`/`ignoreMutation` and its stylesheet ring rule. Diagrams
   and footnote definitions are editable-content exceptions, not atom migrations.
4. **Inline atoms:** inline math, inline HTML, footnote references, images. These need the
   inline frame and must keep the arrow-key behaviour in `docs/element-interaction-contract.md`
   (a selected inline atom shows a ring; a second arrow moves past it).

## Risks

- **Event ownership is subtle per atom.** Math has an inline source editor, TOC has entry
  buttons, HTML has a preview with its own interactions. Each migration must keep exactly which
  events reach ProseMirror. Map each atom's current `stopEvent` to `controls` / `ownsEvents`
  and test pointer, keyboard and IME input inside those regions.
- **Inline atoms and navigation.** The element-navigation and atomic-boundary browser suites
  (`element-navigation`, `atomic-boundary`, `element-interaction`) must stay green.
- **Ring appearance.** The unified rule changes some extensions' ring colour or offset (see
  above).

## Verification

- `pnpm check`, which includes the vitest suite, typechecks and builds.
- `pnpm test:browser:required` in Chromium, Firefox and WebKit, comparing against `main`. On
  the host where this plan was written, 11 Chromium `@required` tests and one vitest test
  (`packages/app/test/persistence.test.ts`) already fail on a clean `main`. Settle those first,
  or record them as the baseline, so new failures are visible.
- An architecture test that migrated atom views do not duplicate the shared
  selection/event/mutation hooks or selection-ring CSS. Editable-content views
  are explicitly excluded, rather than weakening the primitive to fit them.

## Done when

- Every block and inline atom is built on `createAtomView`.
- One selection-ring rule (plus its forced-colors variant) exists, in core.
- Atom-specific `isInside` copies and per-view `selectNode` / `deselectNode` /
  `ignoreMutation` implementations are gone; editable-content hooks remain.
- Public extension APIs are unchanged, and the browser suite matches the baseline.
