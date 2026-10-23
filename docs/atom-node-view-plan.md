# Improvement plan: one shared atom node view

Status: proposed. Follows PR #2 (selection rings follow editor focus).

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
| Block atom | components, block math, block HTML, diagrams, frontmatter, footnote definitions, TOC, core opaque blocks | Yes: the subject of this plan |
| Inline atom | inline math, inline HTML, footnote references, images, core opaque inline | Yes: same primitive, inline frame (phase 4) |
| Editable content | code blocks (CodeMirror), tables, task list items, alerts (container) | No: they own editable content and their own selection rules |

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

Each phase is a separate PR that passes the full browser suite on its own.

1. **Primitive.** Add `createAtomView`, the shared ring rule, and unit tests for event
   ownership, selection classes and destroy. Re-implement `createOpaqueNodeViewClass` on it.
   No extension changes yet.
2. **Components.** Migrate `extension-components`. Its browser tests
   (`tests/browser/components*.spec.ts`) cover editing, history, read-only transitions and,
   since PR #2, the focus-following ring.
3. **Block atoms, one PR each:** frontmatter, TOC, diagrams, block HTML, block math, footnote
   definitions. Each deletes its own `selectNode`/`stopEvent`/`ignoreMutation`, its `isInside`
   copy, and its stylesheet ring rule.
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
- A grep check (or unit test) that no stylesheet outside core contains
  `ProseMirror-selectednode`, and no extension defines `selectNode`, `stopEvent` or `isInside`
  itself.

## Done when

- Every block and inline atom is built on `createAtomView`.
- One selection-ring rule (plus its forced-colors variant) exists, in core.
- The 6 `isInside` copies and the per-view `selectNode` / `deselectNode` / `ignoreMutation`
  implementations are gone.
- Public extension APIs are unchanged, and the browser suite matches the baseline.
