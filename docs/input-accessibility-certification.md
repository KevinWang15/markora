# Embedded input and accessibility contract

This document defines the behavior certified by `EE-006` for Markora in an embedded host. It is a baseline contract, not a claim that a headless browser can replace testing with real input methods or assistive technology.

## Host setup required for the baseline

Until `EE-007` adds typed DOM-attribute options, the embedding host must give each editor a unique accessible name through the existing `EditorView` escape hatch:

```ts
const editor = createEditor({ element, markdown });

editor.view.dom.setAttribute("role", "textbox");
editor.view.dom.setAttribute("aria-multiline", "true");
editor.view.dom.setAttribute("aria-label", "Document body");
```

The label must describe the editor's purpose in the host product; a fixed library-provided English label would be wrong for pages with multiple editors and for localized products. The `/__browser` fixture applies this host obligation before running axe.

Hosts that require all interactive content to sit inside a page landmark should pass `createDefaultUi({ portalRoot })` a portal within the appropriate host landmark. The axe fixture uses an editor-local portal so the toolbar and dialogs are assessed in their real host context.

## Input-method and Unicode behavior

| Interaction | Certified behavior | Evidence or boundary |
| --- | --- | --- |
| Chinese, Japanese, and Korean composition | Provisional text remains editable text for the entire active composition. Markdown input rules may run only after composition commits. | Cross-engine composition-event coverage plus a real Chromium CDP `Input.imeSetComposition` regression. Real OS IMEs remain in the manual checklist. |
| Image Markdown during composition | A provisional `![alt](url)` sequence is not replaced by an atomic image NodeView. A committed sequence may convert normally. | Regression for composition-tagged ProseMirror transactions. |
| Managed-block boundary composition | Starting composition before or after a table, code block, or preserved-source block first creates an empty paragraph at that side, giving the browser an editable composition host. | Unit coverage on both sides and real-browser table-boundary coverage. |
| Dead keys | A `Dead` keydown alone does not mutate the document; its committed Unicode output is inserted once. | Cross-engine structural test. Keyboard-layout-specific dead-key sequences remain manual. |
| Emoji and non-BMP text | Astral emoji, flags, skin tones, ZWJ sequences, and combining text serialize without replacement characters or lone UTF-16 surrogates. Backspace removes a complete simple astral character. | Cross-engine browser regression. Extended grapheme behavior is checked manually on each platform. |
| Bidirectional text | Hebrew and Arabic text mixed with Latin and numbers can be selected, read from the DOM selection, and replaced without logical-text corruption. | Cross-engine RTL-host regression. Visual-arrow behavior at mixed-bidi mark and managed-block boundaries is not yet guaranteed; it is tracked for `EE-020`. |

Markora relies on ProseMirror and CodeMirror's native composition pipelines. Project key handlers must not synthesize committed text during composition, and document transforms must honor ProseMirror's composition transaction metadata.

## Clipboard and drag/drop behavior

| Transfer | Current embedded behavior |
| --- | --- |
| ProseMirror-internal rich slice | The schema-backed rich slice wins and preserves supported structure. Imported links and images pass through Markora's URL sanitizer. |
| External `text/html` plus `text/plain` | HTML wins. Supported paragraphs, marks, lists, tables, links, and images are schema-parsed; unsupported or unsafe DOM is discarded rather than executed. |
| `text/plain` | Text is inserted literally. One or more line breaks divide paragraphs; runs of blank lines therefore normalize to a single block boundary. Markdown-looking punctuation is escaped on serialization when needed to preserve literal semantics. |
| `text/markdown` plus `text/plain` | The plain-text representation is used and remains literal. Markora does not yet opt into parsing Markdown from the clipboard. |
| `text/markdown` only | No Markdown-specific behavior is promised. Deliberate MIME precedence, paste-as-Markdown, and Markdown copy output belong to `EE-017`. |
| External text/HTML drop | The drop is schema-parsed at the browser-reported document position and is one undoable edit. |
| File-bearing paste, dragover, or drop | Rejected in both the ProseMirror surface and CodeMirror, including mixed file-and-text transfers. Markora does not read file bytes, the document remains unchanged, and native file insertion or navigation is prevented. Unrelated host-page listeners remain under the host's control. |
| CodeMirror text paste | Consumes plain text only. Rich HTML formatting is not interpreted inside a code block. |

File rejection is intentionally conservative. `EE-012` will add explicit host callbacks, MIME/size/count policy, asynchronous upload, cancellation, and transactional insertion. Until that API exists, local files are never treated as editor content.

## Editor-owned interaction expectations

### Tasks

- A task remains an HTML list item, so list structure and editable task text are preserved.
- Its separate checkbox control is at least 44 by 44 CSS pixels, is reachable by Tab, is named from the task text, and exposes `aria-checked`.
- Tab and Shift-Tab use native sequential focus order and never invoke the editor's list indent/outdent shortcuts.
- Primary pointer activation happens before selection-driven layout changes can move the control.
- Space and Enter toggle exactly once, keep usable focus, and create an undoable document transaction; keyboard undo/redo restores the replacement checkbox's focus when that same task state changes.

### Link and image editors

- Each overlay is a named non-modal dialog. Opening moves focus to and selects the primary URL input.
- Enter from a text input saves; native Enter/Space behavior on Save, Cancel, Unlink, and Remove activates the focused button itself.
- Escape from any child cancels and restores editor focus.
- Enter and Escape are ignored by the dialog while an IME composition is active.
- Invalid URLs retain focus, set `aria-invalid`, and expose an associated alert message; entering a new value clears the error.
- Outside-pointer dismissal does not steal focus from the element the user chose.

### Table controls

- The table toolbar is a named `toolbar` with one Tab stop. Left/Right arrows move between buttons; Home/End move to the first/last button; Escape returns focus to the editor.
- Alignment buttons expose `aria-pressed`. Non-destructive operations retain toolbar focus; deleting the table returns focus to the editor.
- Every editor-owned toolbar target is at least 44 by 44 CSS pixels for coarse pointers.
- GFM and typed pipe-table headers expose column-header semantics and `scope="col"`. Explicit `scope="row"` or `scope="col"` from pasted HTML is preserved while that table is edited, and column insertion does not turn mixed body rows into column headers. GFM Markdown cannot encode row-header scope, so serialization followed by reload normalizes that extra HTML-only semantic information.

### Managed blocks

- Tables, CodeMirror code blocks, and preserved-source blocks have keyboard-reachable before/after boundaries.
- From a boundary, Enter inserts an adjacent paragraph, text input inserts a paragraph containing that text, Backspace follows the documented remove/insert behavior, and the inward arrow re-enters the managed block.
- CodeMirror owns editing and selection while focused; boundary exit returns focus to the outer ProseMirror surface.
- Preserved-source Edit buttons are real buttons and invoke only the host source-edit hook.
- Visual boundary position is currently stronger than screen-reader announcement. Rich live announcements and complete mixed-bidi physical-arrow behavior remain tracked in `EE-016` and `EE-020`; the manual checklist records current AT output rather than assuming it.

## Mobile viewport and zoom expectations

- Editor-owned inputs and buttons have a minimum 44 CSS-pixel target under coarse pointers.
- Link, image, and table overlays clamp to the active `visualViewport`, listen for its resize and scroll events, and remain usable after a viewport-height reduction that models an on-screen keyboard.
- Responsive behavior is automated at 320–360 CSS pixels. Chromium additionally runs a 200% CDP page-scale check.
- Real iOS/Android virtual keyboards, pinch zoom, magnification, and browser chrome movement must be run through the manual checklist because desktop headless emulation does not create an operating-system keyboard.

## Automated accessibility gate

The Playwright matrix runs axe against a production-built fixture containing headings, a task, link, image, table and toolbar, CodeMirror, and preserved source. Axe is supplemented by explicit keyboard, focus, accessible-name/state, target-size, composition, selection, and teardown assertions. Automatic results do not waive the VoiceOver and NVDA checklist in [assistive-technology-checklist.md](./assistive-technology-checklist.md).
