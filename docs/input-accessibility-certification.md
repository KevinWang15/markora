# Embedded input and accessibility contract

This document defines the input behavior certified by `EE-006`, the typed host setup added by `EE-007`, the headless resource/upload obligations added by `EE-012`, and the passive/lazy code-block behavior added by `EE-015` for Markora in an embedded host. It is a baseline contract, not a claim that a headless browser can replace testing with real input methods or assistive technology.

## Host setup required for the baseline

The embedding host must give each editor a unique accessible name through the typed `ariaLabel` or `ariaLabelledBy` option:

```ts
const editor = createEditor({
  element,
  markdown,
  ariaLabel: "Document body",
});
```

When the host already renders a visible label, reference it instead of repeating its text:

```ts
const editor = createEditor({
  element,
  markdown,
  ariaLabelledBy: "document-body-label",
});
```

The label must describe the editor's purpose in the host product; a fixed library-provided English label would be wrong for pages with multiple editors and for localized products. Markora supplies textbox-role and multiline defaults; hosts claiming this baseline must not replace them without equivalent assistive-technology validation. Its contenteditable/read-only state and placeholder metadata take precedence over conflicts in the general `attributes` option. The `/__browser` fixture applies this host obligation before running axe.

Use `editor.focus()` and `editor.blur()` for ordinary focus management. Inactive code fences remain exact source text inside the outer editing surface. Placing a caret or starting an edit activates CodeMirror and transfers the same logical selection; a native range selection can remain on the passive shell so drag selection and copy are not disrupted. Typed focus and blur subscriptions treat the outer editing surface and active nested CodeMirror editors as one focus boundary, so activation does not produce a false blur/focus pair. Delayed activation and boundary-exit work must not reclaim focus after `editor.blur()` or a host control takes it. Portaled optional UI remains outside that core boundary and follows the dialog/toolbar focus behavior below.

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
| File-bearing paste, dragover, or drop in ProseMirror | Native file insertion/navigation and mixed-transfer text insertion are always prevented. Without `resources.assets`, files are consumed without reading bytes. With the hook, policy-accepted files start host uploads and are inserted only after the complete remaining batch succeeds. Rejected/failed attempts do not change the document. Unrelated host-page listeners remain under the host's control. |
| Nested-code text paste/drop, in the passive shell or active CodeMirror | Consumes text only. Rich HTML formatting is not interpreted inside a code block; configured nested-code transforms may derive replacement text. |
| File-bearing paste, dragover, or drop in nested code | Always rejected, even when `resources.assets` is configured. Nested code remains a plain-text surface and never uploads files. |

Before CodeMirror activates, the permanent code-fence shell is a native
`<code>` element within the named outer textbox, not a second interactive
textbox. Paste/drop applies the same nested-code text transforms and file
rejection policy through an outer-document transaction. Native selection,
copy, and page search operate on its exact text without forcing activation;
activation mounts the advanced editor from the same ProseMirror document text
rather than parsing copied HTML.

The outer upload contract is explicitly host-controlled. Its defaults accept AVIF, GIF, JPEG, PNG, and WebP, at most 10,485,760 bytes per file and 10 files per transfer. Upload progress does not mutate the document. Successful multi-file results enter in transfer order as one undoable transaction; a failure prevents partial insertion and remains available for retry or cancellation. Read-only and active-composition transfers are rejected before the host uploader runs. A hard reset aborts uploads with cancellation events, while destruction aborts silently during teardown.

### Host-owned upload accessibility

Core is headless and deliberately creates no upload progress widget. A host that enables `resources.assets` must subscribe to `"asset"` and provide an accessible status surface:

- Announce upload start, meaningful failure, cancellation, and completion without moving editor focus. Do not send every high-frequency progress tick through an assertive live region.
- Give each retained upload a persistent text label derived from user-visible file context, not only an internal ID, and expose progress in text or with a correctly named progress indicator. Status must not rely on color alone.
- Expose keyboard-operable, visibly labelled cancel and retry controls when the corresponding `editor.assets` transition is available. Keep focus predictable when a control removes its upload row.
- Render the documented rejection/failure code in product language and retain enough context for recovery. Do not announce a batch as inserted while another member is failed or pending.
- Supply meaningful image alt text and link labels in upload results. Markora's file-name fallback preserves a usable string but is not a substitute for product-specific alternative text.
- Place status UI and any authentication, consent, conflict, or retry dialog inside an appropriate host landmark/portal and include them in the product's axe and manual assistive-technology matrix.

`editor.assets.getUploads()` is suitable for reconstructing current uploading/failed rows after host UI rerender. Asset events are lifecycle notifications rather than editor state events: progress causes no `state`/`update` event, while the final successful insertion does. Cancellation, reset, read-only transitions, and teardown should be tested with the same keyboard/focus discipline as other host controls.

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
- Host `openUrl` behavior must preserve an equivalent accessible navigation affordance; Ctrl/Cmd-click is an enhancement, not a replacement for an ordinary labelled link. Hosts that replace image loading should preserve meaningful `alt` text and expose a useful failure state without leaking authentication details.

### Table controls

- The table toolbar is a named `toolbar` with one Tab stop. Left/Right arrows move between buttons; Home/End move to the first/last button; Escape returns focus to the editor.
- Alignment buttons expose `aria-pressed`. Non-destructive operations retain toolbar focus; deleting the table returns focus to the editor.
- Every editor-owned toolbar target is at least 44 by 44 CSS pixels for coarse pointers.
- GFM and typed pipe-table headers expose column-header semantics and `scope="col"`. Explicit `scope="row"` or `scope="col"` from pasted HTML is preserved while that table is edited, and column insertion does not turn mixed body rows into column headers. GFM Markdown cannot encode row-header scope, so serialization followed by reload normalizes that extra HTML-only semantic information.

### Managed blocks

- Tables, lazily activated CodeMirror code blocks, and preserved-source blocks have keyboard-reachable before/after boundaries.
- From a boundary, Enter inserts an adjacent paragraph, text input inserts a paragraph containing that text, Backspace follows the documented remove/insert behavior, and the inward arrow re-enters the managed block.
- CodeMirror owns editing and selection while focused; boundary exit returns focus to the outer ProseMirror surface only while focus remains inside the composite editor, and preserves an intervening host focus or blur handoff.
- Preserved-source Edit buttons are real buttons and invoke only the host source-edit hook.
- Visual boundary position is currently stronger than screen-reader announcement. Rich live announcements and complete mixed-bidi physical-arrow behavior remain tracked in `EE-016` and `EE-020`; the manual checklist records current AT output rather than assuming it.

## Mobile viewport and zoom expectations

- Editor-owned inputs and buttons have a minimum 44 CSS-pixel target under coarse pointers.
- Link, image, and table overlays clamp to the active `visualViewport`, listen for its resize and scroll events, and remain usable after a viewport-height reduction that models an on-screen keyboard.
- Responsive behavior is automated at 320–360 CSS pixels. Chromium additionally runs a 200% CDP page-scale check.
- Real iOS/Android virtual keyboards, pinch zoom, magnification, and browser chrome movement must be run through the manual checklist because desktop headless emulation does not create an operating-system keyboard.

## Automated accessibility gate

The Playwright matrix runs axe against production-built fixtures covering headings, a task, link, image, table and toolbar, a passive code-fence shell, active CodeMirror, and preserved source. Axe is supplemented by explicit keyboard, focus, accessible-name/state, target-size, composition, selection, and teardown assertions. Automatic results do not waive the VoiceOver and NVDA checklist in [assistive-technology-checklist.md](./assistive-technology-checklist.md).
