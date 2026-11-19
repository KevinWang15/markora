# Element navigation

Horizontal and vertical arrow traversal follow one unified document-order state
machine for inline atoms and structured blocks. Adjacent components always share
one boundary stop between them (two arrows from Component A to Component B):

```text
before A → inside/selected A → between A and B (gap space) → inside/selected B → after B
```

- **Editable blocks** (code blocks, tables, diagrams, blockquotes, alerts,
  footnote definitions) are entered directly at their nearest editable edge on
  arrow traversal (`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`). `Escape`
  from inside an editable block selects it as a whole (`NodeSelection`); `Enter`
  on a whole-selected editable block re-enters it.
- **Atoms** (horizontal rules, frontmatter, block/inline math, TOC, HTML blocks,
  images, footnote references, custom components) select as whole elements
  (`NodeSelection`) when approached from either side, and exit to the shared
  boundary on the next arrow. Selected atoms retain their extension's activation
  behavior (for example, `Enter` edits a formula in place).

The shared boundary is a canonical position, not two states attached to
different nodes. Reversing direction at any stop reverses the transition. Inline
objects use ordinary text selections for boundaries. Where a block adjoins a
paragraph, that paragraph's edge caret is already the boundary; it does not add
another stop. At structural gaps between consecutive blocks or at leading and
trailing document edges, `ManagedBlockCursor` represents the gap space (retaining
its compatibility name and JSON format while canonicalizing neighboring-node
metadata to the same position).

`elementNavigation.ts` owns classification, entry, and both horizontal (`step`)
and vertical (`stepVertical`) document-order transitions. `elementInteraction.ts`
assembles caret traversal, document ranges, and gap input in a fixed order for
both editor entries. It owns whole-element highlighting, vertical edge detection,
`Escape`/`Enter` whole-element switching, and boundary mutations. Renderer DOM
and preview state never dictate outer traversal:
- CodeMirror resolves horizontal/vertical exits from its text and hands them to
  `moveToElementBoundary`.
- Tables retain 2D column-preserving row motion via `moveTableCellVertical` and
  hand top/bottom row exits to `moveToElementBoundary`.
- Math in-place editors exit cleanly on all four arrow edges (`ArrowLeft`,
  `ArrowRight`, `ArrowUp`, `ArrowDown`) and hand block exits to
  `moveToElementBoundary`.
- Plaintext diagram blocks declare `elementNavigation: { textArrows: "custom" }`
  so per-line bidi/grapheme horizontal edge handling stays in the extension while
  outer and vertical traversal stay in core.
- Plain paragraphs retain native browser vertical column preservation and native
  horizontal/bidirectional motion.

Selection changes never modify the document merely because an arrow was pressed.
`Delete`/`Backspace` removes a whole-selected element as one undoable operation.
At a shared block boundary (`ManagedBlockCursor`), deletion targets the neighbor
in the deletion direction. Plain `Backspace` at offset 0 of any editable
component (headings, lists, blockquotes, alerts, code blocks, tables, diagrams,
footnote definitions, and in-place math editors) removes the component wrapper
and rescues its content as ordinary text/paragraphs in one undoable step.

Block types register through the existing `schema.managedBlocks` extension
contract; built-in code blocks, quotes, tables and block atoms participate by
default. Selectable inline atoms participate automatically. Custom editing
surfaces can import `moveToElementBoundary` from `markora/extension-api` to hand
a visual before/after exit to the shared resolver. Node views must preserve
whole-element selection across asynchronous preview/layout updates; those updates
do not own the user's caret.

Shift-arrow document ranges, mouse selection, table cell selection, composition,
and modified word/document navigation retain their respective owners. The
element navigation handler does not intercept those gestures. Tests cover the
Cartesian product of block pairs horizontally and vertically, mixed inline/block
runs, reversal, history and mapping, start-of-component `Backspace` unwrapping,
plus real browser focus, activation, and selection rendering across Chromium and
Firefox.
