# Element selection and navigation

Document selection belongs to the outer editor. Editing inside an embedded
surface belongs to that surface. Both the full and minimal editor assemblies use
`elementSelection.ts` to enforce this distinction.

## Keyboard and pointer behavior

- Plain arrows retain the existing navigation into and out of code, tables,
  diagrams, and inline atoms. A selected inline atom has a visible selection
  outline; a second arrow moves past it.
- When Shift-selection starts in prose, crossing an embedded block includes that
  block and preserves the original anchor. Reverse arrows shrink the same range.
  Consecutive embedded blocks are included one at a time.
- Selection starting inside CodeMirror, a table, or diagram source keeps that
  surface's existing text or cell selection behavior.
- Dragging a document range across a diagram does not reveal its source or move
  the surrounding paragraphs. Source is revealed when the selection anchor is
  inside the diagram, including an ordinary editing caret.
- Shift-click on an atomic preview extends the document selection. A plain click
  on math still opens its in-place TeX editor. Buttons and source inputs retain
  their own pointer handling.
- Fully selected embedded blocks and inline atoms have a shared selection
  outline, including previews whose renderer disables native text selection.
- Leading and trailing atomic blocks can be included without requiring a blank
  paragraph. Delete, Backspace, typing, copying, and Undo use the model range,
  including endpoints that cannot hold an ordinary text caret.
- An unmodified arrow collapses a boundary range toward that arrow's end. A
  caret after a terminal block can insert a paragraph when the user types.
  Navigation itself does not add paragraphs.

## Architecture

`isManagedBlockNodeFromSchema` defines the shared boundary policy: block atoms,
registered managed blocks, and the built-in code/table/raw surfaces. Extensions
participate through their existing node schema and `managedBlocks` registration;
core does not import or enumerate extension implementations.

`DocumentRangeSelection` represents nonempty ranges with an endpoint outside an
inline-content parent. Text-only ranges continue to use `TextSelection`. Its
mapping, JSON representation, bookmarks, copied slice, and replacement behavior
integrate with ProseMirror transactions and history. It remains an internal
selection type; public selection snapshots classify it as `other`.

A managed caret beside an atomic block has a zero-height editable DOM decoration.
This prevents Chromium from relocating an otherwise unrepresentable terminal
caret during selection synchronization. The decoration contains no document
content. `beforeinput` routes text through the existing text-input handlers so
browser normalization cannot silently exclude a selected atom or discard typing
at a block boundary. Composition starts by preparing the selected model range;
ongoing composition remains owned by the native input surface.

Boundary caret styling uses the common managed-block class, including custom
extension blocks. Full and minimal stylesheet packaging checks enforce its
presence.

## Verification

`tests/browser/element-interaction.required.spec.ts` exercises document and
Shadow DOM hosts, both editor entries, forward/backward and vertical selections,
mouse drag geometry, Shift-click, consecutive atoms, deletion, replacement,
boundary typing, and Undo. Chromium arrows, text insertion, and drag events use
Chrome DevTools Protocol. The same behavior runs in Firefox and WebKit with
Playwright input. Existing diagram and navigation suites cover editing inside
surfaces, bidi movement, and grapheme boundaries.

`documentRangeSelection.test.ts` checks selection serialization, bookmark mapping,
copying, deletion and real history restoration. `elementSelection.test.ts` checks
anchor ownership, registered custom surfaces, enclosing containers, consecutive
blocks, terminal boundaries, collapse, typing and composition/modifier guards.
The HTML extension also applies its existing selected-node outline when its node
view is selected.

Synthetic composition checks do not certify physical IMEs or assistive
technologies; retain the separate platform validation checklist.

## Audit result — 2026-09-08

- Packed-consumer smoke checks and all bundle failure ceilings passed without
  changing budgets; minimal retains its isolated dependency graph.
- Workspace checks passed with 1,655 unit tests; the final focused unit pass
  covered 84 selection, managed-cursor, and diagram tests.
- The final Chromium/Firefox/WebKit interaction and bidi suite passed 127 checks
  with two platform-specific skips. The desktop browser suite passed 34 checks.
- The broad Chromium suite passed 292 checks with one skip and one intermittent
  math-menu output failure (`x^2` remained after editing to `y^3`). That check
  passed three immediate isolated reruns and the later 43-check clipboard,
  HTML, math and context-menu regression pass. This does not establish the cause
  of the intermittent failure; keep investigating it if it recurs.
- Separate CDP mouse drags across math, diagrams, HTML, tables, code, alerts,
  horizontal rules and TOC blocks deleted precisely the intended text and block
  range. The public playground also passed real KaTeX/code selection and deletion
  checks. Screenshots were inspected for selection visibility and stable layout.

Local audit screenshots and logs are under the ignored
`performance-results/interaction-audit/` directory. The checked-in browser tests
reproduce the interaction regressions without depending on those artifacts.
