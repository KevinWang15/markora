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
- [ ] Hear “Column alignment” as the grouping context for left, center, and right alignment.
- [ ] Use Left/Right, Home, and End to reach all eight controls without returning to the editor after every action.
- [ ] Hear pressed/not-pressed state for left, center, and right alignment.
- [ ] Insert/delete a row and column and confirm focus remains on a predictable surviving control.
- [ ] Delete the table and confirm focus returns to the editor at a valid position.
- [ ] Press Escape and confirm focus returns without changing the table.
- [ ] Read header/body relationships in the table and confirm column headers are identified.

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
