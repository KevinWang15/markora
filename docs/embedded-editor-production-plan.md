# Markora Embedded Editor Production Plan

- Status: Complete
- Last updated: 2026-07-19
- Scope: Embeddable `markora`, `markora-ui`, and seven optional `markora-extension-*` packages

## Purpose

This plan records the completed progression from Markora's early-stage editor kernel to a production-minded, Typora-like editing experience embedded inside another product.

The objective is not feature-for-feature desktop Typora parity. The objective is:

> A trustworthy, extensible Markdown editor component with Typora-quality interaction for its published dialect and explicit exact-source fallback for conservatively recognized unsupported forms.

Work was intentionally ordered: each item was completed, verified, and committed before the next began. The sequence could be amended when completed work revealed new evidence, but later features did not bypass earlier safety gates.

## Scope boundaries

### Markora owns

- Markdown parsing, editing, and serialization fidelity
- Cursor, selection, composition, clipboard, and undo/redo behavior
- Headless commands, state, events, lifecycle, and extension contracts
- Optional editor-local overlays and accessibility behavior
- Host callbacks for links, resources, pasted files, and uploaded assets
- Browser compatibility, performance, packaging, and regression assurance

### The embedding host owns

- Persistence, autosave policy, drafts, versioning, and conflict resolution
- Product navigation, authentication, authorization, and analytics
- The surrounding toolbar, menus, layout, and product-specific workflows
- Asset storage and upload implementation behind Markora hooks
- Collaboration, comments, and presence unless added later as extensions

### Explicit non-goals

- Filesystem browsing, tabs, recent files, or workspace management
- Native desktop shells, installers, signing, auto-update, or OS integration
- Built-in PDF, DOCX, EPUB, Pandoc, print, or publishing workflows
- A theme marketplace or full application preferences system
- Bundling MathJax, Mermaid, or other large renderers into the base package

## Product principles

1. **Never silently lose source content.** Unsupported Markdown must be preserved opaquely or rejected explicitly.
2. **Specify the dialect.** “Markdown” is not a sufficient compatibility contract.
3. **Real browsers are the authority.** jsdom remains useful, but it cannot certify contenteditable behavior.
4. **The public API is the product.** Hosts should not need undocumented ProseMirror mutations for normal integrations.
5. **Keep the base editor small.** Advanced syntax and expensive renderers belong in optional extensions.
6. **Measure before optimizing.** Performance, accessibility, and compatibility claims require explicit budgets and tests.
7. **One focused iteration at a time.** Each item ends with tests, verification, documentation, and a reviewable commit.

## Status legend

- `NEXT` — the next item to implement
- `QUEUED` — ordered but not started
- `IN PROGRESS` — currently being implemented
- `BLOCKED` — cannot proceed without an explicit decision or dependency
- `DONE` — acceptance criteria are met and committed

## Release gates

### Gate A — Content safety

Markora can import supported documents without semantic loss and preserve unsupported constructs without destructive reinterpretation.

Required items: `EE-001` through `EE-004`.

### Gate B — Production embed

Markora has a stable host contract, repeatable real-browser assurance, accessible core interactions, and measured performance.

Required items: `EE-005` through `EE-015`.

### Gate C — Typora-quality supported experience

The supported dialect has mature clipboard, table, media, theming, and syntax-extension experiences without increasing the base bundle indiscriminately.

Required items: `EE-016` through `EE-021`, selected according to product needs.

## Ordered work queue

| ID | Status | Size | Outcome |
| --- | --- | --- | --- |
| EE-001 | DONE | S | Fix destructive pipe-table import and add true round-trip coverage |
| EE-002 | DONE | S | Publish the supported Markdown dialect and normalization contract |
| EE-003 | DONE | M | Build the conformance, golden-document, and property-test harness |
| EE-004 | DONE | L | Preserve unsupported Markdown through opaque source nodes |
| EE-005 | DONE | M | Check in a Chromium, Firefox, and WebKit browser regression suite |
| EE-006 | DONE | M | Cover IME, clipboard, drop, touch, RTL, and accessibility behavior |
| EE-007 | DONE | M | Add production embed configuration and lifecycle APIs |
| EE-008 | DONE | M | Separate reconciled external updates from hard document resets |
| EE-009 | DONE | S | Approve a versioned editor and Markdown extension RFC |
| EE-010 | DONE | L | Implement the extension kernel and migrate built-ins onto it |
| EE-011 | DONE | M | Complete the block, list, task, code, and table command surface |
| EE-012 | DONE | M | Add host-controlled URL, resource, and asset insertion hooks |
| EE-013 | DONE | S | Establish document-size, latency, memory, and bundle budgets |
| EE-014 | DONE | M | Remove synchronous full-document serialization from hot typing paths |
| EE-015 | DONE | L | Lazily activate CodeMirror blocks and reduce base bundle cost |
| EE-016 | DONE | M | Make task and overlay interactions keyboard and screen-reader complete |
| EE-017 | DONE | M | Add deliberate Markdown, rich HTML, and plain-text clipboard behavior |
| EE-018 | DONE | L | Add mature table resize, reorder, selection, and keyboard operations |
| EE-019 | DONE | M | Add configurable auto-pairing, shortcuts, and code-language editing |
| EE-020 | DONE | M | Tokenize styling and add dark, high-contrast, reduced-motion, RTL, and i18n support |
| EE-021 | DONE | L | Ship optional front matter, footnote, math, callout, TOC, HTML, and diagram extensions |

Sizes are relative planning aids: `S` is a focused change, `M` spans several related surfaces, and `L` requires an architectural or multi-stage implementation.

## Work item details

### EE-001 — Fix destructive pipe-table import

Status: `DONE` (2026-07-15)

#### Problem

The production codec currently loses ordinary imported table contents. For example:

```md
| H | J |
| --- | --- |
| A | B |
```

currently serializes as:

```md
|  |
|  |
```

The tokenizer/parser configuration around `thead` and `tbody` is the suspected source. Existing table tests exercise constructed ProseMirror nodes and typed table conversion, but the Markdown round-trip fixtures do not include imported tables.

#### Scope

- Correct Markdown table token handling without weakening URL/content sanitization.
- Preserve header/body rows, cell counts, cell text, inline marks, escaped pipes, and column alignment.
- Add imported-table fixtures to the same round-trip path used by real consumers.
- Add a `/__dev` regression fixture that loads a Markdown table, edits a cell, and serializes it.

#### Acceptance criteria

- The reproduction above round-trips with two columns and all four cell values.
- Left, center, right, and default alignment round-trip correctly.
- Escaped pipes and inline code containing pipes remain in their original cells.
- Inline bold, italic, strike, code, and links inside cells retain semantics.
- Ragged pasted HTML table behavior remains structurally valid.
- `pnpm check`, `pnpm build`, and `pnpm pack:smoke` pass.
- The `/__dev` fixture passes a documented CDP verification; it becomes an automated browser case in `EE-005`.

#### Deliverable

One focused commit containing the codec fix, fixtures, tests, and any necessary compatibility note.

#### Completion notes

- The tokenizer now wraps table-cell inline streams in paragraph tokens, matching the existing `block+` cell schema without changing the public API or weakening imported-URL sanitization.
- Imported tables now retain header/body cell types, cell counts, cell text, default/left/center/right alignment, escaped pipes, code spans, bold, italic, strike, and links. The round-trip corpus includes these cases and the exact two-column reproduction.
- Existing ragged pasted-HTML coverage remains green and verifies that the resulting ProseMirror document is structurally valid.
- Compatibility decision: ordinary GFM pipe tables normalize to paragraph-backed cells and normalized pipe-table output. Broader multi-block table-cell fidelity belongs to the dialect and conformance work in `EE-002` and `EE-003`.
- CDP verification against the production-built `/__dev#imported-table-edit` fixture loaded `Name/Status` and `Alpha/Draft`, edited the body cell to `Draft Ready` with browser input events, and read back `| Alpha | Draft Ready |` from the Markdown source dialog. The run reported zero page console errors and zero HTTP errors.
- Final verification: `pnpm check`, `pnpm build`, `pnpm pack:smoke`, and `git diff --check` pass.

### EE-002 — Define the Markdown dialect and fidelity contract

Status: `DONE` (2026-07-15)

#### Goal

Replace broad “round-trip Markdown” claims with a precise public contract.

#### Acceptance criteria

- Document the supported CommonMark/GFM features and Markora-specific extensions.
- Classify each construct as semantic round-trip, lexical round-trip, normalized output, opaque preservation, or unsupported, including its actual error/no-error behavior.
- Document normalization of bullets, whitespace, reference links, escapes, and line endings.
- Add explicit policy for YAML front matter, footnotes, math, callouts, raw HTML, directives, TOC, and diagrams.
- Update README and package documentation to match the verified contract.

#### Completion notes

- The authoritative [Markdown dialect and fidelity contract](../packages/core/MARKDOWN_COMPATIBILITY.md) now ships inside the `markora` package. It defines a CommonMark-derived subset plus pipe tables, strikethrough, and flat task items without claiming full CommonMark/GFM conformance.
- The contract classifies supported semantic/normalized output, records that lexical and opaque guarantees are currently empty, and introduces the evidence-based transitional state `Unsupported — unreported`. This corrects the original “unsupported error” assumption: the current API does not expose a validation or rejection path.
- Normalization of line endings, terminal/blank whitespace, soft/hard breaks, list markers, task case, headings, fences, emphasis, references, entities, escapes, tables, and URLs is explicit and covered by focused characterization tests.
- YAML front matter, footnotes, math, callouts, raw HTML, directives, TOC markers, and diagram semantics have explicit no-preservation policies. Mermaid fences remain generic code, and downstream HTML rendering remains the host's sanitization responsibility.
- Known shape limits discovered during the audit—nested/multi-block tasks, adjacent marker-distinguished lists, ordered lists starting at zero, ragged/multi-block tables, escaped task prefixes, bare GFM autolinks, and data-image asymmetry—are published rather than hidden.
- Root/package READMEs and demo copy now describe normalized output. The demo exposes a `/docs/markdown` compatibility page.
- A CDP production-build check navigated through the new docs link, verified the warning, supported-shape limits, Mermaid policy, normalization matrix, and package-contract URL, with zero page console/network errors.
- Final verification: `pnpm check` (92 tests), `pnpm build`, `pnpm pack:smoke`, and `git diff --check` pass. The pack manifest includes `MARKDOWN_COMPATIBILITY.md`.

### EE-003 — Build the conformance and corpus harness

Status: `DONE` (2026-07-15)

#### Goal

Make content fidelity measurable rather than anecdotal.

#### Acceptance criteria

- Run the relevant CommonMark and GFM examples through parser/serializer assertions.
- Add at least 100 curated real-world documents initially, growing toward 500 before component 1.0.
- Test semantic stability with `parse -> serialize -> parse` invariants.
- Test lexical preservation for constructs promised as lossless.
- Store intentional normalizations as reviewed expected fixtures.
- Produce an actionable failure summary instead of a single opaque snapshot failure.

#### Completion notes

- A versioned, attributed conformance manifest now pins 32 selected CommonMark 0.31.2 examples and 11 GFM 0.29-gfm examples. Each input has an official example URL, reviewed Markora normalization, explicit outcome classification, and adjacent CC BY-SA 4.0 attribution; the suite deliberately characterizes Markora's published dialect rather than claiming full spec compliance.
- All 43 reviewed first-pass outputs pass. Forty-two cases require semantic stability and serializer idempotence; the single known-failing nested-task case asserts its reviewed output without turning the limitation into a guarantee. Stable-but-non-GFM boundary behavior remains covered by semantic assertions.
- The initial corpus contains 100 original, reviewed, multi-block documents across ten embedded-editor categories. Every document passes `parse -> serialize -> parse` ProseMirror JSON equality and canonical serialization idempotence, with unique case IDs that identify the exact category and document on failure.
- A deterministic property suite exercises 128 generated combinations of supported blocks and inline syntax using seed `0x5eed0003`. The shared harness reports case ID, failed stage, first differing JSON path, expected value, and actual value instead of one opaque snapshot diff.
- The published lexical-guarantee manifest is explicitly empty, matching the current compatibility contract. The harness has an opt-in lexical-capture assertion and a self-test, so adding a future byte-preservation promise requires a visible fixture and test change.
- A CDP check against the production-built `/__dev#table-with-inline-marks` fixture verified a 3-row, 2-column table, emphasis, link normalization, inline code and escaped pipes, then read the exact canonical table from the Markdown dialog. Chromium reported zero console errors, runtime exceptions, failed requests, or HTTP errors.
- This iteration changes test and documentation assets only: there is no production API, accessibility behavior, runtime security boundary, or bundle-size change. Official specification excerpts and their licensing notice remain isolated under the test fixtures.
- Final verification: `pnpm check` (374 tests), `pnpm build`, `pnpm pack:smoke`, and `git diff --check` pass.

### EE-004 — Preserve unsupported source opaquely

Status: `DONE` (2026-07-15)

#### Goal

Ensure valid but unsupported Markdown survives visual editing elsewhere in the document.

#### Acceptance criteria

- Introduce raw block and, where necessary, raw inline representations carrying original source.
- Preserve front matter, display math, HTML blocks/comments, directives, and unknown fenced constructs exactly when untouched.
- Provide a safe source editor or host hook for editing opaque constructs.
- Never execute raw HTML or embedded scripts in the editor.
- Add move, copy, delete, undo, paste, and surrounding-edit regressions for opaque nodes.

#### Completion notes

- The schema now has selectable, draggable, atomic `raw_block` and `raw_inline` nodes carrying a canonical opaque kind and source string. The Markdown codec recognizes conservative document-head YAML-like front matter, standalone display math, CommonMark HTML blocks/comments and inline HTML/comments, plus balanced directive containers, leaves, and inline directives.
- The exact-source boundary is explicit and fixture-backed: a top-level raw block retains its BOM, internal LF/CRLF/CR line endings, delimiters, indentation, escapes, and whitespace through the final source line, while excluding that line's terminator and following blank separator. Top-level inline atoms retain their exact original span, including internal legacy line endings. Serializer-owned block spacing and the document terminal newline still normalize.
- Compatibility decision: every CommonMark backtick or tilde fence remains supported generic code for any info string and therefore follows the existing normalized code contract. Balanced non-CommonMark colon fences are retained as directives. The public `unknown-fence` kind is reserved; arbitrary punctuation is not guessed as an extension because that would capture valid prose without a grammar.
- Opaque node views construct only text nodes and never use raw source as HTML, attributes, or executable DOM. Hostile script, image, iframe, style, declaration, CDATA, and comment cases remain inert in node views and clipboard serialization. Serialized Markdown is still untrusted input to downstream renderers, which remain responsible for sanitization.
- Hosts can provide an accessible source dialog through `onEditOpaqueMarkdown({ kind, source, update })`. The guarded update is undoable and returns `false` after deletion, replacement, or a newer edit, preventing a stale dialog from overwriting current content. The dev lab demonstrates this integration with explicit save behavior and focus restoration.
- A reviewed 25-case exact-source manifest covers 13 opaque-block, 3 opaque-inline, and 9 negative detector boundaries. Forty-four new/updated contract tests cover exact serialization, semantic reparse stability, hostile DOM round-trips, text-only rendering, the public hook, stale updates, managed navigation, move, model copy, keyboard delete, undo/redo, rich paste, and surrounding edits.
- CDP verification against the production-built `/__dev#opaque-source` fixture found five block and two inline opaque atoms, kept authored script/HTML out of the editor DOM, confirmed the script never executed, edited front matter through the host hook, edited supported text beside the atoms, and recovered all exact source islands from the Markdown dialog. Chromium reported zero runtime exceptions, console errors, or failed requests.
- Final verification: `pnpm check` (418 tests), `pnpm build`, `pnpm pack:smoke`, and `git diff --check` pass. The packed package includes the updated fidelity contract and the new public types.

### EE-005 — Add a checked-in real-browser matrix

Status: `DONE` (2026-07-15)

#### Goal

Turn the manual Chrome DevTools Protocol audit into a repeatable release gate.

#### Acceptance criteria

- Add Playwright or an equivalent harness for Chromium, Firefox, and WebKit.
- Cover editor creation/destruction, typing rules, marks, history, links, images, tasks, tables, and CodeMirror boundaries.
- Cover responsive overlays, `visualViewport`, positioned/transformed portals, Shadow DOM, and multiple editors.
- Capture console errors, unhandled exceptions, failed requests, and listener leaks as failures.
- Run a small required browser suite in CI and a broader scheduled matrix where appropriate.

#### Completion notes

- Playwright `1.61.1` is pinned at the workspace root with named Chromium, Firefox, and WebKit projects. Tests run against a production-built Vite preview with failure-only screenshots, video, and traces. Browser test types are part of `pnpm check`, while engine installation and execution remain explicit commands.
- The private `/__browser` route provides deferred editor creation, destruction, resets, exact Markdown snapshots, deterministic selection setup, host commands, opaque-source updates, open Shadow DOM, body/local/positioned/transformed portals, narrow viewport placement, multiple independent editors, and per-instance output/counters. It is a demo-only regression surface and does not change either published package API.
- Six required scenarios cover lifecycle/remount and listener cleanup, real heading/mark typing plus undo/redo, link/image/task controls, imported table editing and alignment, CodeMirror editing and boundary exit, and exact inert opaque-source behavior. Six broader scenarios cover multiple-editor isolation, Shadow DOM UI and CodeMirror, local/positioned/transformed responsive overlays with `visualViewport` events, and a transformed responsive table toolbar.
- Every browser case fails on console errors/assertions, uncaught page errors, failed requests, HTTP responses at or above 400, retained editor/overlay DOM, or an unbalanced document/window/`visualViewport` listener delta. The ledger records listeners added after a synchronous editor scope under an explicit unscoped owner, so delayed lazy imports remain visible to teardown checks. Firefox's intentional document-level CodeMirror copy/cut pair is accepted only after a real lazy activation and only when exactly one pair exists; there is no eager warm-up or blanket exemption for later listeners.
- The matrix found and fixed two production interaction bugs. Shadow DOM retargeting closed link/image overlays before their Save clicks; outside-click detection now uses the composed event path. In WebKit, deselecting an image collapsed its source row between task-checkbox `mousedown` and `mouseup`, moving the task and cancelling the click; task activation now occurs on the primary `mousedown` before selection-driven layout can shift.
- Pull requests and pushes run the six required cases in all three engines. A weekly schedule and manual dispatch run the complete three-engine matrix, with isolated engine installation and retained artifacts per job.
- Final local browser verification passed all 36 production-preview cases: 12 scenarios each in Chromium, Firefox, and WebKit, with zero collected runtime/network failures and exact listener cleanup. `pnpm check` (419 tests), `pnpm build`, `pnpm pack:smoke`, and `git diff --check` pass.

### EE-006 — Certify complex input and accessibility paths

Status: `DONE` (2026-07-15)

#### Goal

Cover interaction classes that jsdom and ordinary Latin keyboard tests miss.

#### Acceptance criteria

- Exercise Chinese, Japanese, and Korean composition without premature Markdown conversion.
- Cover dead keys, emoji, surrogate pairs, bidirectional text, and RTL selection.
- Cover rich HTML paste, Markdown paste, plain-text paste, files, and drag/drop.
- Cover touch-sized layouts, virtual keyboards, zoom, and visual viewport movement.
- Add axe checks plus a documented VoiceOver and NVDA keyboard checklist.
- Establish expected behavior for every task, overlay, table control, and managed block boundary.

#### Completion notes

- Composition-tagged transactions no longer atomize provisional image syntax, and composition at a managed-block boundary synchronously creates an editable paragraph in the editor's owner document. Retained browser cases exercise Chinese, Japanese, and Korean composition in ProseMirror and CodeMirror, including provisional image syntax, a managed table boundary, and a real Chromium CDP IME sequence.
- Cross-engine cases cover dead-key events, combining text, astral emoji and surrogate-safe deletion, mixed Hebrew/Arabic/Latin selection, single-line model-owned and wrapped-line native Home/End synchronization, Ctrl+Home/End document boundaries, native vertical/page caret-column stability, and exact single-click caret placement across revealed inline syntax, plus plain/marked LTR and RTL text, rich and plain paste, Markdown-looking text, rich/plain drops, undo, and sanitized imported URLs. A trusted click retains its pre-reveal model coordinate so delimiter layout changes cannot swallow it or preserve a stale range. Adjacent model-caret geometry corrects engine hit-test drift in nested, wrapped, and bidirectional text while admitting only complete grapheme boundaries. A marked single press now defers delimiter reveal until click resolution; after genuine pointer movement, a model-owned range retains that same anchor through nested-mark, link, wrap, and bidi layout changes while existing selected-text transfer stays native. Model-owned triple-click selection also protects its final range from WebKit mouseup defaulting. Wrapped Home/End affinity remains browser-owned while revealed delimiter geometry is excluded from native visual motion. At this iteration, file-bearing paste, dragover, and drop were conservatively rejected in ProseMirror and CodeMirror, including mixed transfers and protected-mode `Files` MIME detection; explicit host upload policy was deferred to and is now delivered by `EE-012`, while deliberate Markdown clipboard MIME behavior remains assigned to `EE-017`.
- Task list items retain list semantics while exposing separate named 44-pixel ARIA checkboxes. Pointer, touch, Space, Enter, native Tab order, and keyboard undo/redo are single-action and focus-safe. Link/image dialogs now preserve native button activation, ignore composition keys, restore focus on Escape, and associate URL validation alerts with their inputs. The table toolbar implements one-stop roving focus, pressed alignment state, predictable focus after mutation, stable coarse-pointer viewport layout, and correct row/column header scope during rich paste and editing; the contract records GFM's inability to serialize HTML-only row-header scope.
- Responsive checks cover coarse pointers, a virtual-keyboard-sized visual viewport, local and transformed portals, and Chromium 200% page scaling. Axe reports no automatic violations in the complete production-built fixture. The host naming/portal obligations, behavior contract, limitations, and repeatable VoiceOver/NVDA/real-IME checklist are documented in `docs/input-accessibility-certification.md` and `docs/assistive-technology-checklist.md`.
- Automated evidence deliberately does not claim real operating-system IME, mobile-keyboard, or assistive-technology certification. Those runs remain release-checklist work; richer managed-boundary announcements, mixed-bidi physical-arrow behavior, and localization/theming are now covered by `EE-016` and `EE-020`.
- Final verification: `pnpm check` passes all 448 unit/conformance tests; `pnpm test:browser` passes 89 production-preview cases with four expected Chromium-only skips across the Firefox/WebKit projects (93 total); its production web server runs `pnpm build`; `pnpm pack:smoke` and `git diff --check` pass.

### EE-007 — Add production embed configuration and lifecycle APIs

Status: `DONE` (2026-07-15)

#### Goal

Let hosts implement standard editor states without reaching into ProseMirror internals.

#### Acceptance criteria

- Support read-only/editable state, placeholder, autofocus/initial selection, DOM attributes, and accessible naming.
- Add typed focus, blur, selection, update, and error subscriptions with unsubscribe behavior.
- Make destroy idempotent and define behavior for calls after destroy.
- Support dynamic updates for options that do not require state reconstruction.
- Keep the lower-level `view` escape hatch while documenting its compatibility boundary.

#### Completion notes

- `createEditor()` now accepts editable/read-only state, placeholder text, autofocus, initial selection targets, copied DOM attributes, and accessible naming. `updateOptions()` changes the non-reconstructive subset plus runtime callbacks without replacing `EditorState`; creation-only boundaries and validation behavior are documented.
- Read-only mode covers ProseMirror, nested CodeMirror editors, task controls, opaque-source controls, commands, history, and optional UI while retaining selection, copy, and host-controlled `commands.setMarkdown()` updates. Placeholder rendering is limited to the canonical empty paragraph.
- Typed focus, blur, selection, update, and recoverable error subscriptions return idempotent unsubscribe functions. Selection/update delivery is synchronous and state-aware; focus/blur cross a microtask boundary around the composite ProseMirror/CodeMirror surface; code-language loaders and extensions also start after the current outer update so host code cannot re-enter a partially mutated view.
- Destruction is idempotent, caches the final Markdown, releases same-host ownership for remounting, drains all owned cleanup even when callbacks fail, and defines stable no-op or `MarkdownEditorDestroyedError` behavior for every high-level post-destroy API. Reentrancy guards stop callbacks, UI controllers, focus work, and nested editor synchronization as soon as destruction begins.
- Public declarations, packed-consumer coverage, the API demo, browser lab, root/core documentation, and the advanced version-coupled `editor.view` boundary were updated. Adversarial lifecycle tests cover callback failure, teardown failure, option accessors, nested updates, stale async work, and state/DOM synchronization.
- Final verification: `pnpm check` passes all 507 unit/conformance tests; `pnpm test:browser:required` passes 58 production-preview cases with two expected non-Chromium CDP skips (60 total); `pnpm test:browser` passes 101 cases with four expected engine-specific skips (105 total), and its web server runs `pnpm build`; `pnpm pack:smoke` and `git diff --check` pass.

### EE-008 — Define external update semantics

Status: `DONE` (2026-07-15)

#### Goal

Prevent ordinary host updates from unnecessarily discarding selection, history, and plugin state.

#### Acceptance criteria

- Separate a reconciled document update API from an explicit hard reset.
- Preserve selection and history where the incoming change can be mapped safely.
- Identify transaction origin (`user`, `command`, `external`, `reset`, or extension-defined).
- Prevent controlled-host feedback loops.
- Document conflict behavior when local and external updates race.

#### Completion notes

- `commands.reconcileMarkdown()` now parses an authoritative snapshot, returns `false` for a semantic no-op, and otherwise applies one verified minimal ProseMirror replacement transaction. The transaction maps selection and history, stays out of undo, preserves plugin state and unaffected NodeViews, and is accepted through a private capability while read-only.
- `commands.resetMarkdown()` names the deliberate EditorState reconstruction path. It resets selection and clears history/plugin state even for the same document. Deprecated `setMarkdown()` remains an exact hard-reset alias, including its established lifecycle-error label.
- Change provenance is typed as `user`, `command`, `external`, `reset`, or `extension:${string}`. `onChange`, `onTransaction`, and selection/update events expose it; advanced extensions can tag/read namespaced origins without acquiring the private read-only bypass.
- Controlled echoes terminate because normalized-equivalent reconciliations dispatch nothing and external updates are silent by default. Equal echoes retain pending batched local output; a divergent authoritative update cancels it. Reconciliations run synchronously in invocation order and do not merge or version snapshots, so hosts remain responsible for rejecting stale revisions.
- Root/package documentation, the compatibility contract, API reference, framework examples, source playgrounds, Browser Lab, public declaration tests, and the packed consumer now use the explicit reconcile/reset contract. React, Vue, and Svelte examples reconcile controlled prop updates.
- Regression coverage includes Unicode and structural diff pairs, defensive full-document fallback, selection/history mapping, same-document resets, CodeMirror NodeView identity, read-only authority separation, batching and reentrancy, every origin class, lifecycle compatibility, and packed exports.
- Final verification: `pnpm check` passes all 558 unit/conformance tests; `pnpm test:browser:required` passes 61 production-preview cases with two expected non-Chromium CDP skips (63 total); `pnpm test:browser` passes 104 cases with four expected engine-specific skips (108 total), and its web server runs `pnpm build`; `pnpm pack:smoke` and `git diff --check` pass.

### EE-009 — Approve an extension-system RFC

Status: `DONE` (2026-07-15)

#### Goal

Design the stable customization contract before adding more built-in syntax.

#### Acceptance criteria

- Specify extension composition, ordering, dependency, naming, and conflict rules.
- Cover schema nodes/marks, Markdown tokens, parser/serializer handlers, commands, keymaps, input rules, NodeViews, paste/drop hooks, and UI contributions.
- Define extension storage/state and cleanup lifecycle.
- Define package/version compatibility and failure reporting.
- Prototype at least one block syntax and one inline syntax outside the core package.

#### Completion notes

- The accepted [extension system RFC](./extension-system-rfc.md) versions the API independently; its current additive contract is `1.3.0` and defines a compile-before-mount architecture for schema, Markdown codec, runtime behavior, typed handles, and lifecycle resources.
- The contract now covers branded heterogeneous definitions, exact-object typed lookup, a single inferred per-editor `createRuntime()` boundary, required/optional dependency and order edges, stable tokenizer anchors, compiler-qualified local token IDs, additive schema ownership, deterministic fixed runtime lanes, collision policy, clipboard pipelines, NodeViews, and headless UI actions.
- Per-editor storage, the late-bound state/dispatch/command bridge, reset behavior, phase-owned cleanup scopes, reverse teardown, structured system/extension errors, trusted runtime-only callbacks, persistence manifests, SemVer rules, compatibility adapters, and the separate `markora/minimal` bundle boundary are specified before implementation.
- The private, non-publishable `@markora-internal/extension-rfc-prototype` package implements an external multiline callout block and inline highlight mark using only public Markdown-it/ProseMirror APIs. Ten runtime tests prove semantic round-trip, registration-independent tokenizer precedence, optional fallback composition, host-shaped commands, storage isolation, fixed contribution lanes, key fallback chains, and ownership failures.
- A declaration-only fixture proves inferred command/state/storage handles, a no-storage overload, heterogeneous branded arrays, exact registry lookup, and structural-impostor rejection without casts. The package has no entry point or exports and imports no Markora/private-core module.
- Security, accessibility, persistence, and packaging responsibilities are explicit in the RFC. This iteration changes no shipped editor API, DOM, input, or browser behavior, so browser/CDP and performance measurements are not applicable; `EE-010` must add proportional browser, accessibility, packed-consumer, and minimal-bundle tests when implementing the contract.
- Final verification: `pnpm check` passes all 568 unit/conformance/prototype tests; `pnpm build`, `pnpm pack:smoke`, the private prototype typecheck, its 10 targeted runtime tests, and `git diff --check` pass.

### EE-010 — Implement the extension kernel

Status: `DONE` (2026-07-16)

#### Goal

Move from a fixed editor assembly to the approved composable architecture.

#### Acceptance criteria

- Implement the approved RFC without exposing unstable internal helper modules.
- Migrate tables, tasks, strike, CodeMirror fences, and optional UI through the public extension path where practical.
- Add extension ordering, conflict, cleanup, and API type tests.
- Ensure a minimal editor can omit expensive optional behavior.
- Preserve existing public behavior or provide a documented migration path.

#### Completion notes

- `markora/extension-api` now exposes the versioned definition, preset, schema/Markdown, runtime, lifecycle, error, and exact typed-handle contract without exporting core-private compiler helpers. Public editor/event types moved behind neutral modules, and definitions/presets are validated, snapshotted, branded, and immutable before resolution.
- Each editor compiles an isolated schema/tokenizer/parser/serializer graph. SemVer compatibility, dependencies, conflicts, required/optional order edges, stable topological sorting, schema foundation gaps, tokenizer anchors, parser targets, serializer ownership, managed blocks, and persistence manifests have phase-attributed diagnostics. Invalid contributed schema specs fail before host ownership.
- Per-editor storage, commands, read-only state queries, setup scopes, plugins, input rules, first-true keymaps, NodeViews, outer/nested clipboard pipelines, and headless UI actions now run through deterministic kernel lanes. Return values and NodeView surfaces are validated; NodeView and extension cleanup failures are attributed and cannot prevent later cleanup.
- Lifecycle and security boundaries are enforced around extensions: assembly completes before the host is claimed, setup rollback and reentrant teardown release all ownership, lifecycle signals abort before final serialization, public contexts receive only a frozen codec facade, state queries cannot dispatch, and final URL sanitization runs after extension clipboard/plugins. Read-only and file-transfer policy remains ahead of both outer and nested hooks.
- The default preset names the existing strike, table, task, CodeMirror, and opaque-source behavior as compatibility adapters. Their legacy foundation patches remain where the additive public contract cannot migrate them safely without changing persisted identities or browser behavior; the optional UI remains a compatibility host adapter. These definitions are rejected outside the exact root compatibility runtime so manifests never advertise inactive behavior.
- `markora/minimal` is a genuine separate static graph with the CommonMark document foundation, lifecycle/events/history, links/images, managed plain code blocks, and the extension kernel, while excluding CodeMirror and default-only syntax/runtime modules. Packed-consumer analysis measures the root at 2,298,688 bytes/150 static modules and minimal at 841,401 bytes/118 static modules; formal budgets remain `EE-013` work.
- The private RFC prototype was replaced by public callout-block and highlight-mark examples used by the demo, declaration tests, packed external consumer, and real-browser suite, then deleted. Required browser coverage verifies parse/render/edit/serialize, keyboard behavior, accessible NodeViews/UI actions, cleanup, and exact outer/nested clipboard policy in Chromium, Firefox, and WebKit, including the Chromium CDP IME gate.
- Final verification: `pnpm check` passes 694 unit/conformance tests and all build/type/package ESM checks; `pnpm test:browser:required` passes 70 cases with two expected non-Chromium CDP skips (72 total); `pnpm pack:smoke` passes the independent root/minimal graphs; and `git diff --check` passes.

### EE-011 — Complete the command and state surface

Status: `DONE` (2026-07-16)

#### Goal

Make every supported editing operation accessible to host toolbars and menus.

#### Acceptance criteria

- Add commands for paragraphs, heading levels, blockquotes, lists, tasks, hard breaks, rules, code blocks, and tables.
- Add matching `can` and `isActive` state queries.
- Define consistent focus, selection, history, and boolean-return behavior.
- Add command-level tests independent of the default UI.
- Update API type tests and integration documentation.

#### Completion notes

- The root and minimal entries now expose one typed structural surface for paragraphs, heading levels, blockquotes, bullet and ordered lists, list nesting/lifting, tasks, hard breaks, horizontal rules, fenced code blocks, table insertion and mutation, and history. Existing link/image removal gained matching capability checks, and specialized activity queries cover each durable block, list, task, code, and table state while retaining the generic mark/node queries.
- Schema-bound structural commands are shared by both editor runtimes, and table mutations are shared by public commands and the optional table UI. Public commands use the host-facing focus/origin/history contract, while the built-in table toolbar retains its intentional focus-preserving behavior. The minimal schema supports CommonMark structures and safely reports task/table operations unavailable without importing those optional runtimes.
- Boolean behavior is now consistent: `can` is a dispatch-free dry run; unsupported, read-only, composing, inapplicable, and no-op commands return `false`; successful public editing commands refocus the outer editor; and document changes use one transaction, origin `"command"`, and one ordinary undo step. Activity queries remain observational in read-only and composition states, invalid programmer arguments throw, and destroyed editors preserve the existing lifecycle error contract.
- Task commands preserve the published flat-task dialect by rejecting task nesting/lifting, clearing hidden checked attributes when converting an entire task list, and changing checked state only where task attributes are durable. Table commands validate 1–100 row/column bounds, create a GFM header row, preserve column alignment, promote a remaining row when deleting the header, retain a valid selection, and serialize back into a reparsable table.
- A typed synchronous `state` event now precedes specialized selection/update events for every accepted state transition, including stored-mark-only transactions and hard resets. It carries origin, the current selection, `docChanged`, and `selectionChanged`, giving host toolbars a complete signal without raw ProseMirror transactions or eager Markdown serialization. The demo playground, examples, API page, root README, and package README use and document this integration.
- Headless unit coverage exercises every command family, capability/activity purity, focus, origin, history, round-trip, read-only, minimal-schema, validation, and destruction behavior without `markora-ui`. Declaration tests and the packed consumer cover the new supporting types and both package entries. Retained browser cases exercise external-toolbar focus, tasks/history/events, CodeMirror conversion, accessible round-trippable tables without built-in UI, and Chromium CDP rejection during active IME composition.
- Security policy is unchanged: URL commands still pass through the existing sanitizer, and the structural surface introduces no resource loading. Table header scope and existing keyboard/axe coverage remain green. Packed-consumer analysis measures the root at 2,338,053 bytes/152 static modules and minimal at 889,043 bytes/121 static modules; formal budgets and optimization remain `EE-013` through `EE-015` work.
- Final verification: `pnpm check` passes 709 unit/conformance tests and all build, declaration, browser-type, and package ESM checks; the retained serial all-engine browser run passes 79 cases with two expected non-Chromium CDP skips (81 total); `pnpm pack:smoke` passes the independent root/minimal package graphs; and `git diff --check` passes.

### EE-012 — Add host-controlled resource and asset hooks

Status: `DONE` (2026-07-16)

#### Goal

Support production image/media workflows without making storage a core responsibility.

#### Acceptance criteria

- Make link and image protocol policy host-configurable with secure defaults.
- Add hooks for pasted/dropped files, asynchronous upload, progress, cancellation, retry, and failure.
- Add host-controlled URL resolution, link opening, image loading, and privacy policy.
- Define MIME, size, count, and `data:` URL limits.
- Keep document mutations transactional and undoable after asynchronous completion.

#### Completion notes

- Both `markora` and `markora/minimal` now accept one creation-time `resources` object and expose the same typed resource/asset API. Link and image policies are immutable and editor-local; parsing, rich paste including extension/plugin slice transforms, typing, UI/commands, runtime resolution, and upload results all converge on the final sanitizer.
- Secure defaults allow relative links plus `http:`, `https:`, `mailto:`, and `tel:`, and relative images plus `http:`, `https:`, and bounded raster `data:` URLs. Credentials require opt-in; protocol-relative destinations, backslashes, embedded controls/whitespace, malformed schemes, `javascript:`, and `vbscript:` remain blocked. Default data policy is AVIF/GIF/JPEG/PNG/WebP, at most 1,048,576 decoded bytes and 1,398,358 source characters.
- Synchronous `resolveUrl` and `openUrl` hooks preserve stored Markdown and modifier-click user activation while reapplying policy to resolved destinations. Async `loadImage` can deny, return a policy-checked string, or return a Blob. Image privacy defaults to no referrer, requests have stale/destroy cancellation, and accepted/stale cleanup plus generated object-URL revocation is exactly-once. Callback failures use the recoverable typed error channel with resolve/open/load/cleanup attribution.
- `resources.assets` adds explicit MIME/size/count policy and a synchronous-or-async host upload callback with a stable ID, transfer source, per-attempt abort signal, and transaction-free progress reporting. Defaults accept the five raster image MIME types, at most 10,485,760 bytes each and 10 files per transfer; MIME wildcards and explicit limits are supported. Invalid, rejected, failed, cancelled, retried, and completed states are observable through immutable `asset` events and `editor.assets` snapshots/actions.
- A transfer retains one mapped insertion anchor. All remaining successful results commit in original order through one `"user"` transaction and one undo step; partial results wait behind failures, and retry/cancel controls determine whether the batch can finish. Async completion does not refocus the editor, progress does not mutate it, and hostile upload results are sanitized before insertion.
- Read-only/composition starts are rejected without invoking the uploader; completion blocked by those transient states remains retryable afterward. Reconciliation maps pending anchors, hard reset aborts with cancellation events, and destroy aborts silently. CodeMirror continues to reject files as a plain-text surface even when the outer editor has an uploader.
- Core remains headless. The accessibility contract now assigns labelled status, restrained live announcements, progress, retry/cancel controls, meaningful alt/link text, and consent/authentication UI to the embedding host. The extension RFC records that core resource policy governs built-in links/images only: trusted custom NodeViews and media nodes retain host authority and require their own audited loading, privacy, cleanup, and accessibility contract.
- Focused unit and declaration coverage spans policy validation, exact data limits, root/minimal isolation, resolve/open/load behavior, Blob cleanup, upload order/history, mapped anchors, rejection, progress, failure/retry/cancel, read-only, reset, destruction, public types, and packed exports. Retained required browser coverage exercises host upload events plus undo/redo, per-editor protocol isolation and host opening, and Chromium CDP assertions that a private stored image URL is never requested when the host proxy loader is active. Trusted CDP file drags additionally certify exact-coordinate outer upload, protected-mode `Files` rejection without byte access, mixed-payload suppression, history without duplicate upload, and zero uploads from active or passive nested code.
- Migration preserves the prior protocol-relative/unlisted-scheme rejection and intentionally tightens other paths: documents that relied on credentials, ambiguous backslash forms, embedded controls/whitespace, unbounded or non-raster image data, or oversized data URLs now lose the rejected link mark/image at import or insertion. Hosts can opt into reviewed protocols, credentials, MIME types, and limits, but cannot enable `javascript:` or `vbscript:`.
- Final verification: `pnpm check` passes with 761 unit/declaration tests; the serial production-preview browser matrix passes 129 cases across Chromium, Firefox, and WebKit with six intentional engine-specific skips; `pnpm pack:smoke` passes at 2,375,887 root-entry bytes/154 static modules and 935,413 minimal-entry bytes/125 static modules; `git diff --check` passes.

### EE-013 — Establish performance and bundle budgets

Status: `DONE` (completed 2026-07-17)

#### Goal

Create reproducible baselines before changing performance-sensitive architecture.

#### Acceptance criteria

- Benchmark initial parse/render, keystroke-to-paint, serialization, memory, and teardown for representative 100 KB, 500 KB, and 1 MB documents.
- Include documents with many code blocks, tables, images, and nested lists.
- Measure a packed consumer rather than only the docs application.
- Record baseline hardware/browser details and variance.
- Set CI warning and failure budgets approved by the project.

#### Completion notes

- A versioned generator creates deterministic 102,400-, 512,000-, and 1,048,576-byte documents containing repeated prose, inline marks, four-level nested lists, tables, fenced code blocks, and host-denied images. Unit tests lock exact sizes, structural counts, determinism, and raw-sample statistics; each report records the resulting fixture hashes.
- The production benchmark installs a fresh packed `markora` tarball into an isolated consumer and uses only public package and extension APIs. It measures synchronous mount, mount-to-presentation, a trusted keydown-to-presentation proxy, direct codec parse/serialize, clean and dirty teardown, and CDP memory/DOM/listener/document deltas. Timing pages and memory browser processes have explicit isolation, deadlines, provenance assertions, and cleanup invariants.
- `performance/baseline.json` retains the approved 3-warmup, 20-timing-sample, 7-memory-sample-per-size local run with raw samples, p90/p95 and variance statistics, browser/hardware/toolchain identity, packed tarball and fixture hashes, stable module provenance, and hashes for every benchmark input. The full measurement contract and rounded results are documented in `docs/performance-budgets.md`.
- `performance/budgets.json` defines reviewed warning/failure ceilings for all runtime and independently built compatibility/minimal bundle metrics. The fixed CI contract uses Ubuntu 24.04, Node 24, pinned pnpm/Chromium, one warmup, five timing samples, three fresh-process memory samples per size, and uploads success or partial failure evidence.
- The approved production graphs measure 1,264,908 B initial plus 570,072 B lazy compatibility JavaScript (154 static modules) and 678,165 B minimal JavaScript with no lazy chunk (126 static modules). Raw/gzip JavaScript, CSS, lazy/total output, and module-count budgets are all enforced.
- The benchmark exposed an infinite ImageView loading-spinner animation retaining roughly 6,200 detached nodes per 100 KiB lifecycle. ImageView now owns and cancels that animation when loading ends or the view is destroyed; all 21 approved teardown lifecycles retain zero DOM nodes, event listeners, and documents after garbage collection.
- Final verification: `pnpm check` passes 772 unit/declaration tests and every build, type, and package ESM check; `pnpm test:browser:required` passes 86 cases with four expected non-Chromium CDP skips (90 total); the full packed baseline passes 60 timing and 21 memory samples; `pnpm perf:ci` passes all 18 bundle-budget checks plus 15 timing and nine memory samples; and `git diff --check` passes.

### EE-014 — Remove full serialization from hot typing paths

Status: `DONE` (completed 2026-07-17)

#### Goal

Keep editing responsive as documents grow.

#### Acceptance criteria

- Provide lazy Markdown snapshots or an explicit save-snapshot API.
- Make update notifications useful without requiring immediate serialization.
- Coalesce or idle-schedule serialization without losing the final state.
- Preserve a synchronous flush path for form submission and teardown.
- Meet the budgets established in `EE-013`.

#### Completion notes

- The public `MarkdownEditorChangeMode` contract now defaults omitted `onChangeMode` to coalesced idle delivery. A 300 ms trailing quiet period keeps sustained typing responsive, while a 5 s absolute deadline prevents continuous input from postponing persistence forever. Scheduling uses the editor's host window, prefers `requestIdleCallback`, falls back through animation frame and task queues, and has a watchdog for throttled hosts. Explicit `"immediate"` and `"animationFrame"` modes remain available for compatibility and specialized integrations.
- Document transactions synchronously update editor state and emit cheap update events without serializing the whole document. The change emitter retains only the latest document/context pair, lazily creates one canonical Markdown snapshot, and preserves identity through the `getMarkdown()` cache. `flushChange()` and teardown synchronously deliver the final dirty state for form submission and lifecycle safety.
- Scheduling is safe across construction-time dispatches, reentrant listeners, serializer/listener failures, mode changes, stale scheduled callbacks, and destruction. Invalid JavaScript mode values throw atomically during creation or configuration updates; extension failures retain their typed recoverable error attribution without double-reporting through the global channel. Root and minimal entries share the same behavior and public type surface.
- Documentation and the React, Vue, Svelte, and playground examples now distinguish cheap update signals from Markdown snapshots, use explicit modes where same-stack or frame delivery is intentional, and show synchronous flushing before form submission. Existing applications that depended on omitted-mode same-stack callbacks must select `"immediate"` explicitly.
- The packed-consumer v2 benchmark pairs fresh explicit-immediate and omitted-default pages. A public extension converts five trusted F8 inputs into ordinary user `insertText("x")` transactions at a checked cadence; the harness requires zero default snapshots during every input task, exactly one delayed final callback, correct origin and byte/character growth, cache identity, canonical serialization, parsed-document equality, and no late teardown callback.
- The full Apple M4 Max/Chromium 149 run retains 20 timing pairs and seven isolated memory samples at each exact fixture size. At 100 KiB, 500 KiB, and 1 MiB, default synchronous p95 is 3.0 ms, 9.7 ms, and 21.1 ms versus 5.4 ms, 121.4 ms, and 460.1 ms for immediate delivery; default presentation p95 is 4.4 ms, 14.0 ms, and 29.8 ms, and final snapshot p95 is 312.5 ms, 440.1 ms, and 738.2 ms. All 21 lifecycles retain zero DOM nodes, listeners, and documents. Raw paired evidence is retained in `performance/ee014-hot-path.json` and the measurement contract is documented in `docs/performance-budgets.md`.
- `pnpm perf:ci` passes every runtime and byte budget. The two focused scheduler/validation modules raise the compatibility graph from 154 to 156 static modules and the minimal graph from 126 to 128, triggering reviewed warnings but remaining below the 157/129 failure ceilings; this visible bundle cost feeds directly into `EE-015`.
- Final verification: `pnpm check` passes 802 unit/declaration tests and every build, type, and package ESM check; `pnpm test:browser:required` passes 86 cases with four expected non-Chromium CDP skips (90 total); `pnpm pack:smoke` and `pnpm perf:ci` pass; and `git diff --check` passes.

### EE-015 — Lazily activate CodeMirror and reduce bundle cost

Status: `DONE` (2026-07-17)

#### Goal

Avoid paying the full code-editor cost for every fence and every consumer.

#### Acceptance criteria

- Avoid eagerly creating a full CodeMirror editor for every offscreen code block.
- Preserve syntax display, selection, copy, search, and transition behavior before activation.
- Keep language grammars in optional lazy chunks with observable load errors.
- Define a slim base entry point if CodeMirror cannot be removed through tree shaking.
- Meet bundle and memory budgets from `EE-013`.

#### Completion notes

- Compatibility code fences now keep one permanent, exact `<pre><code>` source shell in ProseMirror. The shell exposes its language and line numbers, remains natively selectable, copyable, and searchable, and moves through explicit `inactive`, `loading`, `active`, and `error` states without duplicating or reparsing source. Its semantic code element avoids invalid naming/read-only ARIA, and the hidden line-number gutter is refreshed only when the passive presentation is needed.
- One owner-window viewport observer requests activation near the viewport, while a collapsed selection or settled click activates a specific fence with the same logical caret; native drag ranges remain on the passive shell. The pool permits at most eight loading or active editors, retires eligible offscreen editors back to their permanent shells, and retains an interaction-only fallback when `IntersectionObserver` is unavailable.
- The active CodeMirror adapter is a dynamic import outside the compatibility entry's static closure. Built-in language grammars remain separate on-demand chunks, matching host loaders share one cancellable cached resolution, and stale activation/language work cannot retain a destroyed or deactivated view. Runtime and grammar failures use distinct typed recoverable error events while leaving the exact passive source usable.
- Packed-consumer graph checks prove that the compatibility initial closure contains neither the active adapter nor CodeMirror/Lezer, while its lazy closure contains the required editor runtime. `markora/minimal` remains a single emitted JavaScript graph with no CodeMirror/Lezer path and now pairs with `markora/minimal.css`, whose stripped compatibility surface still retains the native managed-code boundary cursor. Every output remains below its reviewed failure budget; total compatibility raw/gzip JavaScript and raw CSS retain visible warning-level headroom signals.
- Interaction coverage exercises ordinary and no-observer activation in Chromium, Firefox, and WebKit; passive drag/range preservation, delayed runtime handoff, and a passive-shell-scoped CDP search in Chromium; document and Shadow DOM focus transfer; host-control, focusout, and public-blur supersession; outer history and Backspace unwrap; read-only and file-transfer policy; and composition beginning before or during lazy resolution. Axe and semantic-ARIA assertions supplement the keyboard, focus, selection, and teardown checks.
- The `packed-embedded-v3` memory probe visits the first, middle, and last fences, starts capacity pressure from a provably cold pool, and requires an exact eight-active/one-inactive split across nine visible shells before its CDP snapshot. Full local evidence is retained in `performance/ee015-lazy-code-blocks.json`; every measured teardown retains zero DOM nodes, event listeners, and documents, and the canonical CI profile passes the activation, memory, latency, and bundle budgets.
- Final verification: `pnpm check` passes 847 tests plus every build, type, declaration, and Node ESM check; `pnpm build` and `pnpm pack:smoke` pass; the required production-preview suite passes 100 cases with 14 intentional engine-specific skips; `pnpm perf:ci` and the full local v3 benchmark pass; and `git diff --check` passes.

### EE-016 — Complete keyboard and screen-reader interactions

Status: `DONE` (2026-07-17)

#### Goal

Make the supported UI operable without pointer-coordinate assumptions.

#### Acceptance criteria

- Replace or augment the task pseudo-checkbox hit zone with a keyboard-operable semantic control.
- Define non-modal popover/dialog semantics, focus movement, Escape, Enter, and focus restoration.
- Make table controls reachable and understandable through keyboard and screen readers.
- Preserve contenteditable selection while interacting with controls.
- Pass the automated and manual checks established in `EE-006`.

#### Completion notes

- Compatibility task items now render through a stable native `<button type="button" role="checkbox">` NodeView. The task text is its stable accessible name, checked state remains separate in `aria-checked`, read-only state uses native and ARIA disabled semantics, and checked/text updates, undo, and redo preserve the same control. Space, Enter, pointer, touch-compatible, and assistive-technology-style activation produce exactly one transaction without changing the ProseMirror selection or reclaiming focus from a synchronous host handoff.
- The compatibility NodeView is owner-document and ShadowRoot safe, adds no per-item listeners or deferred refocus work, and yields to an explicit extension-provided `list_item` NodeView. Read-only reconciliation constructs an immediately disabled control instead of leaving a newly inserted task in the Tab order.
- Link and image editors are explicitly named non-modal dialogs. Opening selects the primary URL, Enter follows native input/button behavior, Escape cancels, composition keys are ignored, validation remains associated with the invalid input, and outside-pointer dismissal preserves the chosen host target. Session/version guards keep synchronous command callbacks from closing a replacement dialog or restoring focus over an intervening host action; teardown is idempotent and releases the exact captured visual-viewport listeners.
- The table UI is a named horizontal toolbar with a single roving Tab stop and a named column-alignment group. Arrow keys plus Home/End traverse all controls, alignment buttons expose pressed state, structural actions keep predictable surviving-button focus, and Escape or table deletion returns to the editor only when the host has not moved focus elsewhere. Primary pointer interaction preserves the contenteditable selection, while read-only transitions and destruction close the surface safely.
- Retained tests cover exact transaction and selection behavior, native and assistive-technology-style task activation, read-only reconciliation, dialog validation/reentrancy/outside dismissal, table mutations, deep focus restoration, foreign DOM realms, document and Shadow DOM roots, and axe. The required production-preview matrix passes 109 cases in Chromium, Firefox, and WebKit with 14 intentional engine-specific skips.
- The accessibility contract and manual VoiceOver/NVDA checklist now describe the delivered semantics and focus-handoff rules. Automated keyboard, accessibility-tree, and axe evidence deliberately does not mark an operating-system assistive-technology run complete; release candidates and embedding hosts must still record the required real AT matrix rather than treating headless automation as certification.
- Performance and package gates remain within the `EE-013` failure budgets. The packed graph reports 811,335 raw / 223,571 gzip initial compatibility JavaScript, 1,890,063 raw / 562,393 gzip total JavaScript, and 16,827 raw / 3,260 gzip CSS; the minimal graph is unchanged. `pnpm perf:ci` passes all latency, memory, teardown, and bundle checks with zero retained nodes, listeners, or documents.
- Final verification: `pnpm check` passes 866 tests plus every build, type, declaration, and Node ESM check; `pnpm build`, `pnpm pack:smoke`, and `pnpm perf:ci` pass; the required production-preview suite passes 109 cases with 14 intentional engine-specific skips; and `git diff --check` passes.

### EE-017 — Add deliberate clipboard semantics

Status: `DONE` (2026-07-17)

#### Goal

Interoperate predictably with rich editors, code editors, and Markdown tools.

#### Acceptance criteria

- Support explicit paste-as-Markdown/plain-text behavior.
- Convert supported rich HTML into safe semantic Markdown.
- Put useful HTML and Markdown/plain-text representations on copy where browser permissions allow.
- Preserve code, tables, lists, links, whitespace, and line breaks across supported clipboard paths.
- Route pasted files through `EE-012` asset hooks.

#### Completion notes

- Both compatibility and minimal entries now expose typed `commands.pasteMarkdown(text)` and `pastePlainText(text)` operations with matching side-effect-free `state.can` queries. They replace the retained selection, focus after a successful edit, use the existing command origin, wait for outer or active-CodeMirror composition, and form an isolated undo step. Markdown-looking literal text remains model-stable after serialization.
- Automatic outer paste has an explicit policy: file-bearing transfers remain wholly owned by the `EE-012` asset gate; explicit plain paste stays literal; rich HTML wins otherwise; Markdown MIME is parsed only when HTML is absent; and ordinary plain text is never guessed to be Markdown. The compiled codec, ordered extension transforms, paste handlers, and final URL sanitizer run once in their documented lanes, with structured transform failures reported once and aborted without partial insertion.
- Supported detached HTML import retains paragraphs, marks, links, images, lists and portable leading task checkboxes, tables and header scope, code blocks, and conservative `language-*`/`lang-*` fence metadata in both package entries. Hostile raw HTML remains inert or discarded according to the opaque-source and URL policies; no clipboard HTML is attached to the live host DOM for parsing.
- Outer copy/cut offers semantic HTML with private slice context, canonical Markdown, and useful plain text with task/list markers, line breaks, tab-separated table cells, and exact code text. Task HTML uses portable disabled checkbox inputs instead of live controls or generated IDs. Optional custom-MIME write failure leaves HTML/plain copy intact, and cut deletes only after a successful base write in one isolated history step.
- Active CodeMirror and passive code shells share literal text/Markdown/HTML fallback semantics, nested extension ordering, file rejection, and isolated history. Trusted Chromium CDP and Firefox certify that a native drag within one CodeMirror moves the exact plain selection by default and copies it under the platform copy modifier, always with CodeMirror focus and one-step outer history. Transfers to a live sibling, a passive sibling that activates after insertion, or another editor's active CodeMirror copy the exact payload without mutating the independent source; same-editor history is one step and cross-editor destination history remains isolated. Trusted rich Control-drag copies also preserve semantic marks across Chromium, Firefox, and WebKit. Outer-rich-text drags into either code surface remain literal exact-coordinate copies; active code selects the inserted range while the passive shell retains its mapped caret. Reverse drags follow source ownership: active CodeMirror copies its plain selection into the rich surface, while passive code moves within the outer document. A discovered active-code focus split is repaired at native `dragend`, after the outer drop selection exists, without overriding a synchronous host focus handoff. Chromium CDP and Firefox retain the active-source regressions; passive reverse dragging also passes WebKit, whose Playwright driver does not emit `dragstart` for live active-CodeMirror selections. Firefox/WebKit split-owner drag ranges are explicitly a copy-only safety boundary: Markora prevents native cross-surface cut mutation rather than allowing DOM/model divergence, and the stable Firefox document/Shadow regression is retained.
- The production-preview suite covers typed commands, rich/Markdown/plain precedence, semantic copy/cut, CDP-observed synchronous clipboard representations, hostile Markdown, URL clamps, file routing, public extensions, active/passive code copy/cut/paste, composition, document/Shadow roots, and split-cut safety. The complete required Chromium/Firefox/WebKit matrix passes 141 cases with 18 intentional engine/capability skips; the Firefox split-cut case also passed three repeated runs.
- Bundle growth was reduced through shared nested-transfer parsing, shared code-language DOM parsing, and portable schema HTML. `pnpm pack:smoke` passes at 820,593 raw / 225,857 gzip initial compatibility JavaScript, 1,899,595 raw / 564,692 gzip total JavaScript, and 690,669 raw / 194,743 gzip minimal JavaScript, without moving any failure ceiling. `pnpm perf:ci` passes every 100 KiB, 500 KiB, and 1 MiB timing, hot-path, memory, bounded-editor, and zero-retention check.
- Final verification: `pnpm check` passes 890 tests plus every build, type, declaration, browser-type, and Node ESM check; the required browser suite passes 141 cases with 18 intentional skips; `pnpm pack:smoke`, `pnpm perf:ci`, and `git diff --check` pass.

### EE-018 — Mature table editing

Status: `DONE` (2026-07-17)

#### Goal

Move beyond basic insertion/deletion/alignment toward a production table workflow.

#### Acceptance criteria

- Add table creation and resizing controls.
- Add row/column reordering and before/after insertion choices.
- Add multi-cell selection and predictable copy/paste behavior.
- Define keyboard navigation for empty, multiline, nested, and ragged cells.
- Preserve valid GFM output or report constructs that GFM cannot represent.

#### Completion notes

- The root compatibility entry now uses a lifecycle-safe rectangular cell-selection and table-editing layer. The independently bundled minimal entry retains the same typed host surface while leaving table commands unavailable and does not import `prosemirror-tables` or Markora's table-editing/fidelity bridges.
- The typed table surface now includes before/after row and column insertion, contiguous row/column movement, exact row/column-count resizing, rectangular delete/alignment operations, `tableCellSelection()` activity, and `tableIssues()` fidelity diagnostics. The first row remains the pinned GFM column-header row. Shrinking refuses to remove non-empty cells unless the host explicitly sets `discardContent: true`; “resize” in this iteration means logical table dimensions, not persisted pixel widths.
- Rectangular copy offers semantic HTML, quoted TSV plain text, and a valid standalone GFM table. Rectangular cut clears only the selected cells, and table paste clips or repeats a parsed matrix to the selected rectangle. Built-in creation, dimension changes, and caret matrix paste enforce 100-row/100-column limits; TSV table-text parsing is additionally capped at 1 MiB. Merged or over-limit transfers are rejected atomically through the typed recoverable-error channel.
- The optional UI work now groups row, column, alignment, and table actions; exposes insertion side and movement choices; skips disabled boundary actions in its roving focus order; and uses a polite status to describe the rectangle and completed mutation. `editor.ui.createTable()` and the toolbar Resize action share an owner-document/Shadow DOM-safe numeric dimension dialog with 1–100 bounds, validation, command-rejection feedback, and focus-safe submit/cancel/Escape/read-only/destroy behavior.
- The fidelity scanner reports ragged rows, missing column headers, merged cells, multi-block cells, and HTML-only row-header scope without mutating the document. Simple rectangular, single-paragraph tables retain canonical GFM output.
- The required production-preview matrix passes 148 cases with 20 intentional engine/capability skips across Chromium, Firefox, and WebKit. Retained coverage includes document and Shadow roots, pointer/keyboard rectangular selection, matrix clipboard behavior, structural mutations, validated creation/resizing, roving toolbar focus, axe, read-only/composition boundaries, teardown, and Chromium CDP mouse/key/clipboard input. The matrix found and fixed WebKit's button-focus handoff after a successful resize.
- `pnpm pack:smoke` passes at 886,734 raw / 243,163 gzip initial compatibility JavaScript, 1,965,736 raw / 581,998 gzip total JavaScript, 18,479 raw / 3,474 gzip CSS, and 151 static modules. Minimal remains one 700,726 raw / 197,151 gzip static chunk with 129 modules and no table-editing runtime. Only the crossed root byte failure ceilings were raised; all warning, lazy, module-count, and minimal ceilings remain unchanged so the accepted cost stays visible.
- Final verification: `pnpm check` passes 910 tests plus every build, type, declaration, browser-type, and Node ESM check; `pnpm test:browser:required` passes 148 cases with 20 intentional skips; `pnpm pack:smoke`, `pnpm perf:ci`, and `git diff --check` pass. The performance run passes every 100 KiB, 500 KiB, and 1 MiB latency, hot-path, bounded-editor, memory, teardown, and zero-retention check.

### EE-019 — Add configurable typing ergonomics

Status: `DONE` (2026-07-17)

#### Goal

Provide Typora-like typing assistance without hard-coding product preferences.

#### Acceptance criteria

- Add configurable bracket, quote, and Markdown-marker auto-pairing.
- Support wrapping selected text with compatible delimiters.
- Make code-fence language editable and update highlighting safely.
- Expose a configurable shortcut/keymap layer through the extension system.
- Verify IME and undo behavior for every automatic transformation.

#### Completion notes

- `CreateEditorOptions.typing` is a copied, opt-in policy for braces, parentheses, square brackets, quotes, emphasis/strong markers, inline code, and strikethrough. Compatible selections wrap literally or toggle the matching semantic mark. Generated closer provenance is bounded, maps through ordinary edits and undo/redo, survives inactive CodeMirror teardown/reactivation and metadata-only code-block changes, and is retired on consumption, deletion, reset, or divergent edits so pre-existing source punctuation is never skipped or pair-deleted.
- Outer ProseMirror typing and the lazy active CodeMirror adapter share the configured bracket/quote rules while respecting their different schemas. Both are read-only and composition safe, cooperate with input rules, preserve one-step history, and keep pair provenance across backspace, undo/redo, offscreen deactivation, and later activation. Markdown-marker assistance remains disabled in code.
- `CreateEditorOptions.shortcuts` remaps stable qualified built-in IDs and qualified extension keymap IDs with a string, ordered array, or `false`. Resolution preserves contribution order and first-true chaining, canonicalizes modifier aliases, consumes removed default bindings to prevent native contenteditable fallthrough, and applies configured undo/redo keys inside active CodeMirror blocks.
- The code-block language badge is now an accessible action backed by `editor.ui.editCodeBlockLanguage()` and an optional host `codeBlockLanguageEditor`. The default non-modal editor changes the exact complete fence info string while preserving body, selection, history, and an already-active CodeMirror instance. Cancellation, supersession, node edits/removal, read-only transitions, composition, thrown/rejected opens, focus reentrancy, closed Shadow DOM retargeting, and teardown all invalidate stale requests safely.
- Code-fence serialization now lengthens the delimiter beyond body runs and chooses tildes when info contains a backtick. Normalization rejects source states that CommonMark cannot represent exactly, and language registry lookup ignores inherited object properties. The independently bundled minimal entry retains the same typing, shortcut, and safe-serialization policy without importing the UI, CodeMirror, or Lezer runtime.
- The required production-preview matrix passes 158 cases with 22 intentional engine/capability skips across Chromium, Firefox, and WebKit. Retained coverage exercises real keyboard input in document and Shadow roots, selection wrapping, generated-pair deletion/undo/reactivation, shortcut remap/disable and CodeMirror history keys, exact language metadata, read-only/focus behavior, and Chromium CDP IME composition.
- `pnpm pack:smoke` passes at 918,441 raw / 250,699 gzip initial compatibility JavaScript, 1,084,626 / 340,391 lazy JavaScript, 2,003,067 / 591,090 total JavaScript, 19,261 / 3,568 CSS, and 154 static modules. Minimal remains one 722,201 / 202,812 static chunk with 132 modules and unchanged 4,728 / 1,218 CSS. Only crossed failure ceilings were raised; all warnings and passing lazy/minimal-CSS ceilings remain unchanged so the reviewed cost stays visible.
- Final verification: `pnpm check` passes 964 tests plus every build, type, declaration, browser-type, and Node ESM check; `pnpm test:browser:required` passes 158 cases with 22 intentional skips; `pnpm pack:smoke`, `pnpm perf:ci`, and `git diff --check` pass. The performance run passes every 100 KiB, 500 KiB, and 1 MiB latency, hot-path, bounded-editor, memory, teardown, and zero-retention check.

### EE-020 — Add a theme, localization, and RTL contract

Status: `DONE` (2026-07-17)

#### Goal

Let Markora fit production design systems and international products.

#### Acceptance criteria

- Replace hard-coded colors and dimensions with documented CSS custom properties.
- Provide reference light, dark, high-contrast, and reduced-motion behavior.
- Make all default UI text and accessible labels injectable.
- Support logical CSS properties and test RTL layout/selection.
- Document which visual responsibilities belong to core, default UI, and host.

#### Completion notes

- Core and default-UI styling now consume a documented public `--mdw-*` custom-property contract instead of private colors and dimensions. Core owns document semantics, the optional default UI owns its controls and overlays, and the host owns scope, inherited typography, `lang`, `dir`, and product composition. Layout uses logical properties throughout the supported surface.
- `markora/themes.css` is an optional, separately exported reference asset with light, dark, automatic color-scheme, and high-contrast scopes. Core and UI styles also provide forced-colors and reduced-motion behavior without requiring that reference asset, and the theme contract documents every public token, scope, ownership boundary, and override rule.
- `CreateEditorOptions.messages` and `createDefaultUi({ messages })` expose separate, typed localization contracts with frozen English defaults and copied partial overrides. All editor-owned visible text, status announcements, accessible labels, validation messages, and table-operation formatters flow through those contracts. Invalid override shapes, unknown keys, blank labels, and invalid formatter results fail explicitly; the embedding host remains responsible for setting semantically correct `lang` and `dir` values.
- Body-portaled default-UI overlays mirror the effective per-editor token set, nearest theme and motion scopes, `color-scheme`, language, and computed direction. The expensive token mirror is cached per editor while live direction, selection-anchor geometry, relevant ancestor mutations, media-query changes, and reparenting between scopes invalidate the semantic environment, so nested light/dark/contrast scopes, document roots, and open Shadow DOM embeddings remain isolated while overlays are open.
- Physical left/right motion at mark, managed-table, and active-CodeMirror boundaries now probes native browser selection movement and safely restores the live DOM selection before applying a model transition. One outward step escapes every coincident nested mark boundary atomically, so typing cannot leak a subset of the prior formatting. Native select-all, system-clipboard copy/cut/paste, coordinate-accurate external drops, and trusted internal dragging also retain the correct outer/CodeMirror ownership, strong/link semantics, image atoms, synchronized selection, and one-step history. Multi-block drags are certified in both position-mapping directions, including open paragraph-edge joins, nested list-item preservation, and a slice enclosing a warm managed code block. Cross-editor drags are independently certified between the root and minimal entries in both document and Shadow roots: they copy rich-inline and closed multi-block slices at the destination coordinate while preserving the source and isolating undo/redo to the destination. This preserves visual caret behavior for RTL and mixed-bidi content; the default toolbar likewise maps physical arrows and boundary states in RTL.
- Retained browser coverage exercises localization, body portals, nested themes, forced-color media, reduced motion, pure RTL, mixed bidi, tables, marks, and CodeMirror in Chromium, Firefox, and WebKit with no EE-020 engine skips. Chromium and Firefox assert the actual Windows forced-color presentation overrides; WebKit records its macOS platform boundary after the emulated media query matches. Automatic theme and motion preferences are verified through a direct Chromium DevTools Protocol session as well as the cross-engine media API.
- Packaging keeps the reference themes out of the imported JavaScript/CSS graph unless the host requests them. The compatibility entry measures 936,371 raw / 255,135 gzip initial JavaScript, 1,084,827 / 340,496 lazy JavaScript, 2,021,198 / 595,631 total JavaScript, 36,017 / 5,470 CSS, and 157 static modules. The minimal entry remains one 727,038 / 204,217 JavaScript chunk with no lazy CodeMirror graph, plus 11,460 / 2,365 CSS and 134 modules. Only newly crossed failure ceilings were raised; every warning ceiling and every failure ceiling not crossed by EE-020 remain unchanged.
- Final verification: `pnpm check` passes 980 tests plus all builds, type/declaration checks, browser types, and the Node ESM smoke test. `pnpm test:browser:required` passes 176 cases with 22 intentional pre-existing engine/capability skips; its 18 focused EE-020 cases pass across Chromium, Firefox, and WebKit with no skips. `pnpm pack:smoke`, `pnpm perf:ci`, and `git diff --check` pass, and the performance run clears every 100 KiB, 500 KiB, and 1 MiB latency, memory, teardown, and zero-retention gate.

### EE-021 — Ship advanced syntax as optional extensions

Status: `DONE` (2026-07-19)

#### Goal

Broaden document compatibility without turning the base editor into a monolith.

The normative package, dialect, fidelity, renderer, security, accessibility,
and verification decisions are frozen in the
[advanced-syntax extension contract](./advanced-syntax-contract.md).

#### Sub-item status

| Sub-item | Status | Package or outcome |
| --- | --- | --- |
| Foundation | DONE | Exact-source claim points plus optional-package build, type, pack, browser, and bundle gates |
| YAML front matter | DONE | `markora-extension-frontmatter` |
| Footnotes | DONE | `markora-extension-footnotes` |
| Inline and block math | DONE | `markora-extension-math` |
| GitHub-style alerts | DONE | `markora-extension-alerts` |
| Generated TOC | DONE | `markora-extension-toc` |
| Sanitized raw HTML | DONE | `markora-extension-html` |
| Mermaid and GitHub diagrams | DONE | `markora-extension-diagrams` |

#### Progress notes

- The first foundation checkpoint accepts the
  [advanced-syntax contract](./advanced-syntax-contract.md), advances the
  extension API additively to `1.1.0`, exposes private-metadata-backed exact
  source line slices to public tokenizer rules, and publishes stable root and
  minimal tokenizer anchors. Host-rendered extension actions now also inherit
  the editor's read-only state.
- The source-range module moves the packed compatibility graph from 157 to 158
  static modules and the minimal graph from 134 to 135. Their measured byte
  deltas are 1,351 raw / 191 gzip bytes and 847 raw / 194 gzip bytes,
  respectively. Only those two crossed module-count failure ceilings increase
  by one; all warning ceilings and byte failure ceilings remain unchanged.
- The optional-package harness now discovers `packages/extension-*` for build,
  declaration, Node ESM, and package-local test gates. The packed-consumer check
  installs each tarball without workspace-source fallback, compiles the public
  API, executes root and minimal editors in an isolated DOM, proves optional
  syntax is absent from both baseline manifests and bundles, and measures a
  feature-only graph against per-package budgets.
- `markora-extension-frontmatter` owns one atomic, exact-source YAML envelope at
  document position zero in either root or minimal. It preserves BOMs, delimiter
  spelling, comments, anchors, indentation, and mixed line endings; exposes
  typed insert, update, remove, snapshot, diagnostic, and stale-safe host-edit
  surfaces; and rejects invalid placement or envelope mutations atomically.
  YAML stays inert: bounded lexical diagnostics never construct YAML objects,
  resolve aliases or tags, perform network work, or bundle a renderer.
- The front-matter NodeView is keyboard-operable, localized, read-only aware,
  forced-colors/reduced-motion safe, and explicitly styled through
  host-overridable logical CSS tokens. Exact Markdown and useful plain-text
  clipboard output, one-step history, composition guards, external
  reconciliation, stale edit handoff, document invariants, and hostile/oversize
  input all have retained coverage. Unrelated body transactions neither rescan
  the document invariant nor repaint unchanged exact-source DOM; head-touching
  and front-matter-bearing mutations still receive full validation.
- The packed feature graph is one 92,370 raw / 24,188 gzip JavaScript chunk with
  no lazy chunks, plus one 2,548 raw / 800 gzip CSS file and 97 statically
  traversed modules. It contains no sibling extension, YAML parser, CodeMirror,
  renderer, root-editor, minimal-editor, or default-UI graph, while neither
  baseline entry contains front-matter code or styles. Raw JavaScript, gzip
  JavaScript, and raw CSS cross their deliberately retained warning lines but
  remain below unchanged failure ceilings; all other feature budgets pass.
- Final verification for this sub-item: `pnpm check` passes all builds,
  declaration/API checks, Node ESM smokes, browser types, and 1,012 unit tests;
  `pnpm test:browser:required` passes 183 cases across Chromium, Firefox, and
  WebKit with 24 intentional capability skips; the focused front-matter matrix
  passes seven cases with two Chromium-CDP-only skips. `pnpm pack:smoke`,
  `pnpm perf:ci`, syntax checking of the release harness, and `git diff --check`
  pass. Every 100 KiB, 500 KiB, and 1 MiB latency, memory, teardown, and
  zero-retention performance gate remains green.
- `markora-extension-footnotes` provides semantic reference and block-definition
  nodes in both root and minimal editors, canonical multiline serialization,
  exact case-sensitive safe labels, repeated-reference and duplicate-definition
  snapshots, typed insert/rename/remove/navigation commands, one-step history,
  composition/read-only guards, and whole-document invariants. Contributed
  inline nodes are valid in headings while unrepresentable heading hard breaks
  remain rejected by schema and command guards.
- Context recognition is bounded and deterministic across escaped markers,
  images, links, code spans/blocks, HTML, inline/display math, blockquotes,
  nested lists, and definition bodies. Overlapping inline constructs use the
  earliest valid opener; a provisional context pass, chained math discovery,
  final context rescan, and narrowly scoped Markdown-it shield preserve that
  ownership without changing ordinary Markdown fallback. Invalid labels and
  nested definition markers remain literal, and imported NUL is retained as the
  parser's literal U+FFFD replacement rather than silently folded or normalized.
- Localized logical-property NodeViews expose editor-scoped accessible
  relationships, visible duplicate status in addition to color, forced-color
  and reduced-motion behavior, bounded keyboard navigation, and read-only
  operation. A standalone resolved live reference is interactive; an unresolved
  reference consumes activation safely; a marker inside a link is noninteractive
  and leaves pointer/keyboard ownership to the outer link. Rich clipboard HTML
  uses truthful noninteractive note semantics, while Markdown/plain output and
  whole or nested partial definition copies remain self-contained and collision
  safe on paste.
- The index rebuilds only when footnote structure changes. Position-only
  transactions map the immutable snapshot in stable order, retain render
  identity, avoid NodeView repaint, and resolve navigation against current
  positions. Chromium DevTools Protocol medians for ordinary typing with
  500/1,000/2,000/4,000 references plus definitions improved from
  43.2/90.9/218.7/616.7 ms to 10.4/19.3/39.4/108.0 ms in root and from
  38.9/91.3/215.2/574.3 ms to 8.4/19.6/36.8/101.6 ms in minimal. The remaining
  O(N) snapshot-position remap at very large counts is recorded as a scaling
  risk, not a release blocker; the retained browser gate mounts and reconciles
  1,000 references plus 1,000 definitions within its five-second bound.
- The packed feature graph is one 127,247 raw / 32,403 gzip JavaScript chunk
  with no lazy chunks, plus 3,762 raw / 932 gzip CSS and 98 static modules. The
  deliberately retained 116,000 raw / 29,000 gzip warning lines still expose
  the size debt. Only the crossed JavaScript failure ceilings move from
  125,000 / 32,000 to 140,000 / 36,000; CSS, module, lazy, and all warning
  ceilings remain unchanged.
- Final verification for footnotes: package tests pass 55 cases in root and
  minimal; `pnpm check` passes all builds, declaration/API checks, Node ESM
  smokes, browser types, and 1,067 unit tests; the focused browser matrix passes
  18/18 across Chromium, Firefox, and WebKit; and
  `pnpm test:browser:required` passes 201 cases with 24 intentional capability
  skips. `pnpm pack:smoke`, `pnpm perf:ci`, release-harness syntax/JSON checks,
  and `git diff --check` pass. Every performance threshold through 1 MiB is
  green. Independent review additionally passes 500 randomized canonical
  round trips and adversarial scanner bounds, with no release blocker found.
- `markora-extension-math` provides semantic inline and block atoms in both
  root and minimal editors. Canonical single-dollar inline and double-dollar
  block serialization has fixed-point literal-dollar escaping, deterministic
  precedence with footnotes and opaque syntax, source-only semantic clipboard
  output, image-alt flattening, whole-document invariants, and typed
  insert/update/convert/remove, preview, snapshot, diagnostic, and host-edit
  surfaces. Runtime-only target identities prevent stale handles from claiming
  identical siblings after move, replacement, history, or reconciliation.
- The additive literal-delimiter escape hook advances the public extension API
  from `1.1.0` to `1.2.0`; math requires `^1.2.0` so an older host cannot accept
  the definition while silently omitting its fixed-point dollar escaping.
  Front matter and footnotes continue to require only their original `^1.1.0`
  source-range/tokenizer contract and remain compatible with the new host.
- Preview rendering is optional and entirely host supplied; no TeX renderer is
  bundled. The bounded manager limits concurrency and output size, defers block
  work outside the viewport and all work during composition, aborts stale
  generations, and retains source on missing, failed, or rejected output.
  Renderer DOM is cloned into the editor only after owner-document, connected
  node, active-content, URL, attribute, element-count, depth, and byte checks.
  Source, Markdown, accessibility text, and clipboard data never depend on a
  successful preview.
- Localized logical-property NodeViews expose the permanent authored source to
  assistive technology, keep action controls outside the `math` role, preserve
  keyboard, RTL, read-only, forced-color, and reduced-motion behavior, and show
  failures through text and diagnostic styling. Unrelated edits reuse the
  immutable identity index and do not repaint math UI; structural transactions
  rebuild only when needed, validate every intermediate step document, and the
  render scheduler performs constant rather than per-target composition reads.
- The packed feature graph is one 137,462 raw / 35,683 gzip JavaScript chunk
  with no lazy chunks, plus 5,790 raw / 1,356 gzip CSS and 99 static modules.
  It contains no renderer engine or sibling extension and remains absent from
  both baseline bundles. Measurement-derived warning lines expose the current
  size while failure ceilings retain roughly 9–11% headroom; root and minimal
  remain at their reviewed 158/135 static-module ceilings.
- Final verification for math: package tests pass 76 cases; `pnpm check` passes
  every build, declaration/API check, Node ESM smoke, browser typecheck, and
  1,143 unit/integration tests. The focused production-browser matrix passes 25
  cases across Chromium, Firefox, and WebKit with two expected non-Chromium CDP
  skips, including a real Chromium DevTools Protocol edit/copy path and Axe.
  The complete required matrix passes 226 cases with 26 intentional capability
  skips. `pnpm pack:smoke`, `pnpm perf:ci`, release-harness syntax/JSON checks,
  and `git diff --check` pass; every performance threshold through 1 MiB is
  green. Independent review found and closed stale-target, multi-step invariant,
  serializer escaping, accessibility-role, error-style, repaint, and scheduler
  scaling defects before release.
- The pre-existing core Markdown-it nesting defect is closed independently of
  the footnote package. Root and minimal now round-trip 127 recursively nested
  list items under a shared structural budget, retain a higher parser safety
  ceiling, and reject deeper input atomically before either codec can return a
  partially truncated document. A production-built three-engine regression
  edits the deepest item of a 100-level list, using raw Chromium CDP input in
  Chromium; focused tests cover the exact boundary, parser-ceiling overflow,
  construction cleanup, external-update atomicity, and continued editor use.
  Packed bundle/module isolation and the core plus all-seven 100 KiB–1 MiB
  Chromium performance and zero-retention budgets remain green.
- Root and minimal preserve distinct adjacent bullet and ordered list nodes by
  alternating canonical markers only at their shared boundary, and retain an
  ordered-list start of zero. Focused semantic-idempotence cases cover nested
  tight lists and task-looking input; a production-built three-engine check
  edits through Chromium CDP and native Firefox/WebKit input, resets from the
  serialized Markdown, and verifies that list counts, starts, and output remain
  stable.
- Compatibility task recognition now uses authored inline token source before
  escape and entity resolution, so only literal task markers gain interactive
  state; empty tasks reparse, while escaped and entity-produced prefixes remain
  ordinary text. Two-space structural continuation indentation makes nested
  tasks, additional paragraphs, and code blocks semantically idempotent, and
  public sink/lift commands now match keyboard indentation while preserving
  checked state. A production-built three-engine regression edits the mixed
  structure through Chromium CDP and native Firefox/WebKit input, then resets
  and verifies the same text, task controls, nesting, blocks, and Markdown.
- `markora-extension-alerts` provides semantic GitHub blockquote alerts in root
  and minimal for note, tip, important, warning, and caution. A lightweight
  authored-marker claim runs before the foundation blockquote rule, while a
  namespaced core promotion deliberately reuses Markdown-it's complete lazy-line
  and nested-container state machine. Case and horizontal marker whitespace
  normalize, marker-only nodes retain an editable empty paragraph without a
  terminal newline, and authored no-blank Setext headings or thematic breaks
  are recovered after Markdown-it look-behind. Malformed, escaped, formatted,
  titled, indented-code, non-first-line, non-ASCII-padded, and demo-directive
  forms remain ordinary fallback Markdown.
- Typed wrap, toggle, set-kind, and unwrap commands preserve selection and body
  content in one extension-origin undo step, with read-only, composition, and
  semantic-no-op guards. Capability queries and frozen position snapshots expose
  active/document state. Changed-range validation rejects invalid kinds in every
  intermediate raw transaction document, and the serializer fails defensively
  rather than coercing malformed nodes.
- Static clipboard DOM and a stable live NodeView share truthful semantic
  `aside` structure. Kind changes retain the same editable content DOM; visible
  localized kind text and a formatter-owned accessible name identify every kind
  independently of color. Logical host-overridable CSS covers RTL, contrast,
  forced colors, reduced motion, and selected-node focus. The package bundles no
  renderer, performs no network work, and keeps whole-alert Markdown/plain/rich
  clipboard representations semantic while partial body selections stay local.
- Non-paragraph first body blocks receive a canonical bare quoted separator, so
  thematic breaks and extension-contributed footnote definitions cannot merge
  into the marker. The shared pipe-table serializer now emits every line through
  its enclosing delimiter, fixing table fidelity in ordinary quotes and alerts.
- The packed feature graph is one 108,546 raw / 28,440 gzip JavaScript chunk
  with no lazy chunks, plus 2,064 raw / 728 gzip CSS and 96 static modules. It
  contains no sibling extension or renderer engine and remains absent from both
  baseline bundles. Measurement-derived warning lines expose current size while
  failure ceilings retain roughly 9–11% headroom; root and minimal budgets do
  not move.
- Final verification for alerts: package tests pass 62 cases; `pnpm check`
  passes every build, declaration/API check, Node ESM smoke, browser typecheck,
  and 1,206 unit/integration tests. The focused production-browser matrix passes
  13 cases across Chromium, Firefox, and WebKit with two expected non-Chromium
  CDP skips, including a real Chromium DevTools Protocol edit/copy path and Axe.
  The complete required matrix passes 239 cases with 28 intentional capability
  skips. `pnpm pack:smoke`, `pnpm perf:ci`, frozen offline installation,
  release-harness syntax/JSON checks, and `git diff --check` pass. All failure
  thresholds through 1 MiB pass with zero retained nodes, listeners, or
  documents; the current run has one non-failing 500 KiB parse-variance warning.
  Independent review found and closed thematic-break, Setext-heading, nested
  table, footnote-boundary, and partial-copy defects; its 95-case supported-body
  scan found no fixed-point failures and no release blockers remain.
- `markora-extension-toc` owns a case-insensitive standalone top-level `[TOC]`
  marker in root and minimal, with canonical `[TOC]` persistence and explicit
  fallback for escaped, embedded, code, over-indented, list, blockquote,
  internally spaced, and non-ASCII-padded forms. Multiple markers are allowed;
  nested semantic markers are rejected in every intermediate raw transaction
  document and again at serialization.
- One immutable per-editor index derives level-one through level-six headings
  from model text, image alternatives, and contributed leaf text. It maps
  positions without repainting retained entry DOM for ordinary edits and
  rebuilds only when heading semantics or TOC count/order may change. All live
  TOCs refresh after heading text, level, order, insertion, deletion, history,
  reconciliation, and hard reset. The retained source-only workload creates 16
  TOCs over 128 headings (2,048 entry buttons), preserves every entry node on a
  pre-heading text edit, updates all copies on a heading edit, reconciles,
  resets, and tears down within a broad 20-second CI ceiling; the current local
  test completes its measured body in roughly 0.3 seconds.
- The stable live NodeView exposes unique occurrence-aware navigation landmark
  names, native nested lists and buttons, localized empty and untitled states,
  logical RTL styling, forced-color and reduced-motion treatment, and
  position-based pointer/Enter/Space activation. It adds no slugs or heading
  IDs, never changes the embedding URL, remains navigable in read-only mode,
  and suppresses activation during composition. Generated labels, lists,
  controls, and positions remain derived presentation and never enter Markdown,
  clipboard data, history, or the semantic marker node.
- Typed insert/remove commands, capability and active queries, frozen heading
  and marker snapshots, validated frozen messages, explicit CSS, root/minimal
  declaration coverage, Node ESM smoke, and packed-consumer runtime coverage
  ship independently of every sibling extension. The packed feature graph is
  one 93,257 raw / 24,448 gzip JavaScript chunk with no lazy chunks, plus one
  3,401 raw / 1,018 gzip CSS file and 98 static modules. It contains no renderer
  engine and remains absent from the root and minimal baseline graphs.
- Final verification for generated TOC: package tests pass 45 cases; `pnpm check`
  passes every build, declaration/API check, Node ESM smoke, browser
  typecheck, and 1,251 unit/integration tests. The focused production-browser
  matrix passes 13 cases across Chromium, Firefox, and WebKit with two expected
  non-Chromium CDP skips; the complete required matrix passes 252 cases with 30
  intentional engine/capability skips. Coverage includes real Chromium CDP
  activation/copy, whole-document clipboard isolation, composition-suppressed
  navigation, forced-color presentation, reduced motion, Shadow DOM, RTL, and
  Axe. `pnpm pack:smoke`, `pnpm perf:ci`, frozen offline installation,
  release-harness syntax/JSON checks, and `git diff --check` pass. Every 100 KiB,
  500 KiB, and 1 MiB latency, memory, teardown, and zero-retention failure gate
  passes. Independent source review found no lifecycle, codec, command,
  accessibility, security, or embedded-mode blocker; adversarial review found
  and closed the three browser-coverage gaps above.
- `markora-extension-html` requires the additive `^1.3.0` extension API and its
  dependency-free exact opaque-token source reader. It claims recognized
  CommonMark HTML blocks, inline HTML, and comments as owned atoms in the
  compatibility root runtime only; minimal and incompatible custom runtimes
  fail resolution with `EXTENSION_INCOMPATIBLE` before any host claim or
  mutation. Top-level lexical islands preserve their exact source, including
  internal CRLF line endings, while recognized nested HTML retains the
  documented compatibility normalization boundary. Opening and closing inline
  HTML tokens remain separate atoms rather than being merged across content.
- Frozen typed state, snapshots, diagnostics, update/remove/toggle/retry
  commands, and host-edit handoff all use stale-safe occurrence identities.
  Whole-document invariants validate every intermediate transaction document,
  including zero-map attribute and mark steps; an update preserves one token at
  the same placement. Reset, reconciliation, history, removal, preview toggles,
  and destruction invalidate or abort late render generations, while
  composition defers rendering without surrendering source ownership.
- Authored HTML is always inert source text. Only non-comment block HTML is
  preview eligible, and the optional host renderer must return a detached
  same-owner-document `Node` or `DocumentFragment`, never a string or
  `TrustedHTML`. The package copies a strict static HTML allowlist into fresh
  DOM, drops active, URL-bearing, presentation, identity, ARIA, and data
  surfaces, rejects foreign or connected output, and bundles no parser or
  renderer engine. Its inert, `aria-hidden`, pointer-disabled preview is bounded
  to 256 KiB of source, 4,096 rendered nodes, depth 128, 1 MiB of output, 64
  attributes per element, four concurrent jobs, and viewport activation.
  Missing, failed, rejected, stale, or oversized output leaves the exact source
  authoritative and visible with bounded diagnostics.
- The permanent source remains exposed to assistive technology even while a
  preview is visible. Localized labels, status, and actions retain keyboard,
  read-only, IME, logical RTL, reflow, forced-color, and reduced-motion
  behavior; inline HTML inside links adds no nested action or navigation.
  Markdown and plain-text clipboard output always contain authored source and
  never derived preview DOM.
- Retained required-browser coverage exercises exact block, inline, and comment
  source in document and Shadow roots; root-only preclaim rejection; hostile,
  missing, failed, and stale renderers; lifecycle generations; commands, paste,
  host edits, history, read-only and composition guards; localized RTL/reflow;
  link nesting; source-only clipboard; and accessibility across Chromium,
  Firefox, and WebKit. Chromium DevTools Protocol additionally performs a real
  edit and source-only copy, and the accessibility path includes Axe.
- Packed tarball evidence covers files, exports, styles, provenance, public
  types, Node ESM, exact root-runtime update/undo, safe rendering, intentional
  minimal preclaim rejection, and bundle isolation. The feature graph is one
  258,459 raw / 81,858 gzip JavaScript chunk with zero lazy chunks, plus one
  4,863 raw / 1,227 gzip CSS file and 99 static modules. It contains no renderer
  engine or sibling optional extension, remains absent from the baseline root
  and minimal graphs, passes its roughly 10%-headroom feature budgets, and does
  not change either baseline budget.
- The retained source-only workload mounts 512 block HTML atoms, preserves exact
  parse/serialization, retains every NodeView across ordinary preamble typing,
  performs no synchronous renderer call, and exercises reconciliation, hard
  reset, and teardown under a broad 20-second CI ceiling. The measured body
  completes below 0.7 seconds in the current full-suite and package-only runs;
  separate pressure tests enforce viewport activation, four-job concurrency,
  output limits, cancellation, and stale-result cleanup.
- Final verification for sanitized HTML: package tests pass 64 cases;
  `pnpm check` passes every build, declaration/API check, Node ESM smoke,
  browser typecheck, and 1,318 unit/integration tests. The focused
  production-browser matrix passes 28 cases across Chromium, Firefox, and
  WebKit with two expected non-Chromium CDP skips; the complete required matrix
  passes 280 cases with 32 intentional engine/capability skips. `pnpm build`,
  `pnpm pack:smoke`, `pnpm perf:ci`, frozen offline installation, the core
  release dry-run, release-harness syntax/JSON checks, and `git diff --check`
  pass. Every performance failure threshold through 1 MiB passes with zero
  retained nodes, listeners, or documents, and the HTML source contains no raw
  DOM parsing/injection sink. Independent source, security, package, and
  browser reviews found and closed the transaction-invariant, stale-generation,
  composition, link-nesting, accessibility, hostile-output, retry, and package
  isolation gaps; no remaining sub-item blocker was found.
- `markora-extension-diagrams` claims exactly the case-sensitive `mermaid`,
  `geojson`, `topojson`, and `stl` fence kinds in both root and minimal
  runtimes. Complete normalized info and body source remain editable model data;
  unsupported or mixed-case kinds remain ordinary code. Typed insert, update,
  remove, retry, preview, kind-conversion, generic-code conversion, snapshot,
  diagnostic, and stale-safe host-edit APIs preserve selection and history.
  Serialization and whole-node clipboard output use a canonical collision-safe
  fence, while partial source selections remain ordinary text.
- Rendering remains optional host presentation: the package includes no
  Mermaid, map, 3D, worker, or network engine. Per-editor work activates within
  an 800-pixel viewport margin, caps at four concurrent callbacks, rejects
  source above 256 KiB and output above 1 MiB/4,096 nodes/depth 128/64
  attributes, and aborts stale jobs across edits, toggles, removal, reset,
  reconciliation, and teardown. A fresh HTML/SVG clamp permits only inert
  detached owner-document DOM, scopes every local ID/reference, rejects active
  or external content and indirect CSS values, and leaves source authoritative
  after every failure.
- The permanent localized source is exposed to assistive technology and becomes
  visually available whenever a caret or range enters or spans it. Physical
  Arrow and Shift+Arrow boundaries resolve the first or last plaintext line
  with Unicode bidi P3 semantics, default neutral lines to LTR, and preserve
  combining and ZWJ grapheme clusters across LTR, RTL, and mixed multiline
  blocks; previews remain inert and `aria-hidden`. Retained browser coverage exercises document and
  Shadow roots, all four renderers, viewport/concurrency pressure, hostile and
  stale output, commands, host edits, native source editing, canonical
  clipboard, read-only/composition behavior, localized RTL/reflow, Axe, and
  cleanup across Chromium, Firefox, and WebKit. Chromium CDP independently
  performs a real contenteditable edit and native source-only copy.
- A retained all-seven composition case mounts front matter, footnotes, math,
  alerts, TOC, sanitized HTML, and all four diagram kinds together, then proves
  deterministic manifests, claim isolation, canonical clipboard output,
  reset/reconciliation, and zero cleanup collisions. The packed performance
  workload uses the same seven independently installed tarballs at exact
  100 KiB, 500 KiB, and 1 MiB sizes, with five timing samples and three
  fresh-browser memory lifecycles per size; it separately gates ordinary,
  structural-footnote, TOC-heading, diagram-removal, renderer-pressure, and
  destroy paths.
- Packed diagrams measure 140,346 raw / 36,197 gzip JavaScript with no lazy
  chunks, 3,698 raw / 1,004 gzip CSS, and 99 static modules. The two deliberately
  tight JavaScript warning bands remain visible while every failure ceiling
  passes. The installed all-seven graph measures 1,176,840 / 315,639 gzip
  initial JavaScript, 1,088,605 / 340,993 gzip lazy JavaScript, 2,265,445 /
  656,632 gzip total JavaScript, 54,546 / 7,612 gzip CSS, and 202 modules, all
  below warning ceilings. Neither graph contains a renderer engine or
  workspace-source fallback, and neither changes a root or minimal baseline
  budget.
- The approved all-seven local run records maximum mount times of 107.7, 756.0,
  and 1,312.4 ms and maximum ordinary-edit times of 5.2, 27.3, and 46.6 ms at
  100 KiB, 500 KiB, and 1 MiB. Mounted tracked-memory medians are 11.09, 52.79,
  and 107.01 MB; maximum retained tracked memory is 192,073, 203,889, and
  242,117 bytes. All nine fresh-process memory lifecycles retain zero nodes,
  listeners, and documents, while exact offscreen activation, four-job
  concurrency, bounded output failure, and removal/reset/failed-create/destroy
  cleanup evidence pass. The run keeps advisory timing and variability warnings
  visible while clearing every hard budget.
- Final verification for diagrams and the all-seven integration: the package's
  44 tests pass; `pnpm check` passes 1,362 tests plus every build, declaration,
  API, ESM, and browser-type gate; and the required browser matrix records 320
  passes with 34 intentional engine/capability skips out of 354 cases. Focused
  diagram boundary and hostile-renderer coverage passes across Chromium,
  Firefox, and WebKit. `pnpm perf:ci`, the frozen package-consumer checks, the
  core release dry-run, syntax/JSON checks, and `git diff --check` pass.
  Independent contract, security, bidi-boundary, packaging, and performance
  audits found no remaining blocker.

#### Recommended order

1. YAML front matter
2. Footnotes
3. Inline and block math
4. GitHub-style callouts/alerts
5. Generated TOC nodes
6. Sanitized raw HTML editing/preview
7. Mermaid and other diagram previews

#### Acceptance criteria

- Each feature is independently installable and tree-shakable.
- Source remains preserved when the rendering dependency is absent or fails.
- Expensive or executable renderers are isolated and governed by host security policy.
- Each extension ships codec, command, browser, accessibility, and package-consumer tests.

## Definition of done for every iteration

An item is `DONE` only when all applicable requirements below are met:

- The problem and compatibility decision are documented.
- Regression tests fail before the change and pass afterward.
- Browser-facing behavior has a retained real-browser test, or a documented CDP check until the `EE-005` harness is available.
- Public API changes include type tests and migration notes.
- Accessibility and security implications were reviewed.
- Performance-sensitive changes were measured against established budgets.
- `pnpm check` passes.
- `pnpm build` passes when build output is affected.
- `pnpm pack:smoke` passes when package output or exports are affected.
- `git diff --check` passes.
- The work lands in one focused, reviewable commit.
- This document is updated with the item status and any resulting plan changes.

## Completed iterations

`EE-001` through `EE-021` are complete. Gate A's content-safety requirements,
Gate B's production-embed requirements, and Gate C's Typora-quality supported
experience requirements are satisfied. Gate C includes keyboard/screen-reader,
deliberate clipboard, mature table, configurable typing, theme, localization,
bidirectional-text, and independently packaged advanced-syntax behavior.
Completed work includes the browser, complex-input, accessibility,
host-lifecycle, external-update, extension-kernel, headless command/state,
host-controlled resource, performance-budget, responsive-snapshot, lazy
code-editor, semantic embedded-control, rich/Markdown/plain clipboard,
production table-editing, host-configurable typing/keymap,
design-system/internationalization, exact-source extension, front-matter,
footnote, math, alert, generated-TOC, sanitized-HTML, diagram, and all-seven
integration foundations. No planned iteration remains in this document.
