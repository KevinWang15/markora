# Embedded editor assistive-technology checklist

Run this checklist for release candidates that change input handling, editor DOM, overlays, tasks, tables, managed blocks, focus, or positioning. Keep one record per operating-system, browser, assistive-technology, input-method, and zoom combination.

The automated Chromium/Firefox/WebKit keyboard, accessibility-tree, Shadow DOM, and axe suite is a prerequisite, not a completed run record. Implementation work must leave these boxes blank unless a tester actually performed the named operating-system, browser, assistive-technology, IME, and zoom combination.

## Required matrix

| Platform | Browser | Assistive technology | Minimum input coverage |
| --- | --- | --- | --- |
| Current macOS | Safari | VoiceOver | U.S. keyboard plus Chinese Pinyin and Japanese Romaji IMEs |
| Current Windows | Chrome | NVDA | U.S. keyboard plus Microsoft Pinyin and one dead-key layout |
| Current Windows | Firefox | NVDA | U.S. keyboard plus Korean IME and one dead-key layout |

Record exact versions. Add iOS Safari + VoiceOver and Android Chrome + TalkBack before claiming mobile assistive-technology support for a host product.

## Run record

| Field | Value |
| --- | --- |
| Date / tester |  |
| Markora commit |  |
| Host build / route |  |
| OS and version |  |
| Browser and version |  |
| AT and version |  |
| Keyboard layout / IME |  |
| Zoom / text scale |  |
| Portal and root mode | `body`, local/positioned/transformed, or Shadow DOM |
| Result | `PASS`, `FAIL`, or `BLOCKED` |
| Issue links / notes |  |

## Setup

- [ ] Use a production build, not a development bundle.
- [ ] Give the editor a unique host-provided accessible name and verify it programmatically.
- [ ] Load a fixture containing headings, paragraphs, mixed LTR/RTL text, nested lists, tasks, a link, an image with alt text, a table, a CodeMirror block, preserved source with an Edit hook, and—when the host enables uploads—its progress/failure controls.
- [ ] Confirm the browser console has no errors before beginning.
- [ ] Repeat the relevant overlay checks in the host's real portal mode and, if supported, an open Shadow DOM.

## Editor entry and reading

- [ ] Tab into the editor and hear its unique name, editable state, and multiline purpose.
- [ ] Navigate headings, paragraphs, lists, links, images, tables, code, and preserved-source groups in reading mode.
- [ ] Confirm the task text is not lost when its checkbox control is announced.
- [ ] Confirm image alt text is announced and raw image URLs are not substituted for useful alt text.
- [ ] Confirm authored raw HTML/script text in preserved source is read only as inert text and never executes.

## Composition, dead keys, and Unicode

- [ ] Compose Chinese text, revise the active candidate, and commit with Enter; no Markdown block or mark appears before commit.
- [ ] Compose Japanese text and Korean text across at least two edits per active composition.
- [ ] Compose or paste `![中文](/image.png)`; it remains text while the candidate is active and converts only after commit.
- [ ] Start composition immediately before and after a table, code block, and preserved-source block; a paragraph appears on the intended side and receives the committed text.
- [ ] Use Enter and Escape to navigate IME candidates while a link or image input is focused; the overlay neither saves nor closes.
- [ ] Produce an accented character through a real dead-key sequence and confirm one character and one undo step.
- [ ] Insert an astral emoji, flag, skin-tone emoji, ZWJ family, and combining sequence; move and delete by grapheme without replacement characters or partial surrogate output.

## Tasks

- [ ] Reach every task checkbox by Tab and hear its task text and checked state; toggling changes the state announcement without replacing the task-text name.
- [ ] Toggle with Space, Enter, touch, and the screen reader's default activation command; each action changes state exactly once.
- [ ] Confirm focus remains on the same logical control after toggling, Undo, and Redo, while the contenteditable selection remains unchanged.
- [ ] Switch the editor to read-only and reconcile in a new task; its checkbox is announced disabled and is absent from sequential Tab order.
- [ ] At 200% zoom and with touch exploration, confirm the entire 44-pixel target activates the intended task only.

## Link and image dialogs

- [ ] Open each non-modal dialog from the host's keyboard command and hear its name; focus starts in the selected primary URL input while surrounding page content remains available.
- [ ] Traverse every input and button in visual order.
- [ ] Press Enter on Save, Cancel, Unlink, and Remove; the focused button's own action runs.
- [ ] Press Escape from an input and from a button; the dialog closes without mutation and editor focus/selection returns.
- [ ] Repeat Escape and a successful save while a capture-phase host handler moves focus elsewhere; the host target keeps focus and no stale dialog session reclaims it.
- [ ] Enter an unsafe URL; hear an error tied to the invalid field, then correct it and confirm the error clears.
- [ ] Repeat while the dialog is above, below, and partially constrained by the active visual viewport.

## Table toolbar

- [ ] Enter the toolbar as one Tab stop and hear “Table controls.”
- [ ] From a table, use Alt+F10 and the host action wired to `editor.ui.editTable()`; each enters the same toolbar without changing the cell selection.
- [ ] Hear “Row,” “Column,” “Alignment,” and “Table” as the four grouping contexts.
- [ ] Use Left/Right, Home, and End to reach all 16 controls without returning to the editor after every action; unavailable movement at an outer edge is disabled and skipped.
- [ ] Hear pressed/not-pressed state for automatic, left, center, and right alignment.
- [ ] With one cell and then a multi-cell rectangle selected, insert before/after, move, and delete rows and columns; confirm the operation covers the expected contiguous range and focus remains on a predictable surviving enabled control.
- [ ] Hear the polite status describe the selected row/column range and each completed toolbar operation without duplicate or overly verbose announcements.
- [ ] Delete the table and confirm focus returns to the editor at a valid position.
- [ ] Press Escape and confirm focus returns without changing the table.
- [ ] Invoke `editor.ui.createTable()`, enter whole-number row and column counts from 1 through 100, and confirm Create, Cancel, and Escape return focus to the invoking control or editor without inserting twice.
- [ ] Open “Resize table,” confirm the fields reflect the current logical dimensions, and verify rejected content-removing shrink operations remain open with an associated alert while a successful resize returns focus predictably.
- [ ] Read header/body relationships in the table and confirm first-row column headers are identified; for pasted HTML row headers, record the live semantics and the documented GFM export limitation.

## Table selection, keyboard, and clipboard

- [ ] Create a rectangular cell selection by pointer drag, Shift-click, and Shift+Arrow from a cell boundary; hear or otherwise verify the same logical range and visible selected-cell state.
- [ ] Press plain Arrow, Escape, Enter, and F2 from a cell rectangle; each returns to a caret without changing cell content. Backspace/Delete clears selected contents without deleting the rows or columns, and Undo restores them once.
- [ ] Use Tab and Shift-Tab through empty, multiline, and nested-block cells. Movement is row-major, stays in the table until its boundary behavior applies, and never traps focus or invokes list indentation inside a cell.
- [ ] From the final cell, press Tab to append one row; repeat at the 100-row limit and confirm navigation exits after the table instead. Cross the first/last row with vertical arrows and confirm the managed before/after boundary is reachable.
- [ ] In multiline and nested content, use Up/Down within interior visual lines before crossing to an adjacent row at the first/last line. Repeat against a shorter imported/ragged row and confirm movement lands in its last available cell without an error.
- [ ] Copy a body-only rectangle and inspect paste targets for semantic table HTML, standalone GFM whose first copied row is the required header, and quoted TSV plain text. Include a tab, line break, and double quote in cell content.
- [ ] Paste smaller and larger table/TSV matrices into a rectangle and confirm repeat/clip behavior fills exactly that selection in one undo step. Cut a rectangle and confirm only cell contents clear after clipboard data is available.
- [ ] If the host permits rich HTML or table extensions, introduce each reported non-GFM shape and verify its save UI gives useful text for `ragged-row`, `missing-column-header`, `merged-cell`, `multi-block-cell`, and `row-header-scope` without relying on color.

## Managed blocks and preserved source

- [ ] Enter and leave CodeMirror with horizontal and vertical arrows; hear enough context to distinguish the code editor from the document editor.
- [ ] Reach both sides of tables, code blocks, and preserved-source blocks; record exactly what the AT announces for the block type and side.
- [ ] From each side, test Enter, text insertion, inward arrow, and Backspace and confirm the documented boundary result.
- [ ] Extend selection from CodeMirror into surrounding document text and back without trapping focus.
- [ ] Reach each preserved-source Edit button, activate it, cancel/save in the host dialog, and confirm focus returns to the same logical block.

## Host upload status

- [ ] Paste and drop an accepted file; hear a concise start status and a meaningful completion without editor focus moving.
- [ ] Confirm each active upload has a persistent file label and named progress indicator whose value remains available without relying on color.
- [ ] Reach Cancel and Retry by keyboard, hear their purpose and associated file, and confirm each action runs once.
- [ ] Trigger MIME, size, count, network, and invalid-result failures; hear actionable text without exposing a sensitive URL or local path.
- [ ] Confirm frequent progress ticks do not flood an assertive live region, and that completed/cancelled rows leave focus in a predictable place.
- [ ] Verify file paste/drop inside CodeMirror is rejected as code-surface input and does not create a misleading upload status.

## Bidirectional text

- [ ] Read and select pure Hebrew and Arabic paragraphs in an RTL host.
- [ ] Read and select mixed strings such as `abc אבג 123 العربية` in both directions.
- [ ] Apply and escape a Markdown mark without losing or reversing logical text.
- [ ] Exercise table and CodeMirror boundary arrows in RTL and record any mismatch between physical arrow direction, visual caret movement, and the resulting logical selection.

## Zoom, virtual keyboard, and responsive layout

- [ ] Repeat the primary flow at 200% and 400% browser zoom without two-dimensional page scrolling for ordinary paragraph content.
- [ ] With an on-screen keyboard visible, focus each overlay input and verify the complete dialog remains reachable by scroll or repositioning.
- [ ] Pan/zoom so `visualViewport.offsetLeft` or `offsetTop` is nonzero; overlays remain inside the visible viewport.
- [ ] Rotate a touch device and confirm controls stay at least 44 CSS pixels and no action fires twice from compatibility mouse events.
- [ ] Enable platform text scaling and confirm labels, error messages, toolbar controls, and task text do not clip.

## Completion rule

A checked box means the named interaction was personally observed and matched [the embedded input and accessibility contract](./input-accessibility-certification.md). For any mismatch, mark the run `FAIL`, capture the smallest Markdown/host configuration that reproduces it, attach the browser/AT versions, and link an issue. A headless keyboard or axe pass is supporting evidence, never a substitute for this record.
