# Element navigation

Horizontal traversal follows one state machine for inline objects and structured
blocks. A node is either approached from a boundary, selected as a whole, or left
at the next boundary:

```text
before A → selected A → between A and B → selected B → after B
```

The shared boundary is a position, not two states attached to different nodes.
Reversing direction at any stop reverses the transition. Inline objects use
ordinary text selections for boundaries. Where a block adjoins a paragraph, that
paragraph's edge caret is already the boundary; it does not add another stop.
At structural gaps, `ManagedBlockCursor` retains its compatibility name and JSON
format but canonicalizes neighboring-node metadata to the same position.

`elementNavigation.ts` owns classification and document-order transitions.
`elementInteraction.ts` assembles caret traversal, document ranges, and gap input
in a fixed order for both editor entries. It owns whole-element highlighting,
explicit entry into editable content, and boundary mutations. Renderer DOM and preview
state do not determine traversal. CodeMirror resolves visual exits from its text
and hands their direction to the same outer boundary resolver. Native editable
content retains browser visual/bidirectional movement until it exits an element.

Click or Enter enters editable content. Escape selects the containing element.
Selected atoms retain their extension's activation behavior (for example, Enter edits a formula). Selection changes never
modify the document or open renderer controls merely because an arrow was pressed.
Delete/Backspace removes a selected element as one undoable operation. At a shared
block boundary, deletion targets the neighbor in the deletion direction.

Block types register through the existing `schema.managedBlocks` extension
contract; built-in code blocks, quotes, tables and block atoms participate by
default. Selectable inline atoms participate automatically. Ordinary text,
formatting marks, and hard breaks retain native text navigation. A custom editable
element must be selectable and expose normal text selection or an activation
command. Custom editing surfaces can import `moveToElementBoundary` from
`markora/extension-api` to hand a visual before/after exit to the shared resolver.
A node with its own text-arrow handler declares
`elementNavigation: { textArrows: "custom" }` on its NodeSpec (typed by
`ElementNavigationSpec`). Core then delegates arrows only while editing inside
that node. This preserves plaintext line direction and grapheme behavior without
letting source editors intercept outer traversal.
Node views must preserve whole-element selection across asynchronous
preview/layout updates; those updates do not own the user's caret.

Shift-arrow document ranges, mouse selection, table cell selection, composition,
and modified word/document navigation retain their respective owners. The
horizontal element handler does not intercept those gestures. Tests cover the
Cartesian product of block pairs, mixed inline/block runs, reversal, history and
mapping, plus real browser focus, activation, and selection rendering.
