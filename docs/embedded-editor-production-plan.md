# Markora Embedded Editor Production Plan

- Status: Active
- Last updated: 2026-07-16
- Scope: Embeddable Markdown editor packages (`markora` and `markora-ui`) only

## Purpose

This plan closes the gap between Markora's current early-stage editor kernel and a production-grade, Typora-like editing experience embedded inside another product.

The objective is not feature-for-feature desktop Typora parity. The objective is:

> A trustworthy, extensible GFM editor component with Typora-quality interaction for supported syntax and lossless preservation for everything else.

Work is intentionally ordered. We will complete, verify, and commit one item before starting the next one. The sequence may be amended when a completed item reveals new evidence, but a later feature must not bypass an earlier safety gate.

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
| EE-011 | NEXT | M | Complete the block, list, task, code, and table command surface |
| EE-012 | QUEUED | M | Add host-controlled URL, resource, and asset insertion hooks |
| EE-013 | QUEUED | S | Establish document-size, latency, memory, and bundle budgets |
| EE-014 | QUEUED | M | Remove synchronous full-document serialization from hot typing paths |
| EE-015 | QUEUED | L | Lazily activate CodeMirror blocks and reduce base bundle cost |
| EE-016 | QUEUED | M | Make task and overlay interactions keyboard and screen-reader complete |
| EE-017 | QUEUED | M | Add deliberate Markdown, rich HTML, and plain-text clipboard behavior |
| EE-018 | QUEUED | L | Add mature table resize, reorder, selection, and keyboard operations |
| EE-019 | QUEUED | M | Add configurable auto-pairing, shortcuts, and code-language editing |
| EE-020 | QUEUED | M | Tokenize styling and add dark, high-contrast, reduced-motion, RTL, and i18n support |
| EE-021 | QUEUED | L | Ship optional front matter, footnote, math, callout, TOC, HTML, and diagram extensions |

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
- Every browser case fails on console errors/assertions, uncaught page errors, failed requests, HTTP responses at or above 400, retained editor/overlay DOM, or an unbalanced document/window/`visualViewport` listener delta. A one-time headless CodeMirror warm-up makes its intentional Firefox document-level copy/cut workaround part of the baseline without exempting later editor-owned listeners.
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
- Cross-engine cases cover dead-key events, combining text, astral emoji and surrogate-safe deletion, mixed Hebrew/Arabic/Latin selection, rich and plain paste, Markdown-looking text, rich/plain drops, undo, and sanitized imported URLs. File-bearing paste, dragover, and drop are conservatively rejected in ProseMirror and CodeMirror, including mixed transfers and protected-mode `Files` MIME detection; explicit host upload policy remains assigned to `EE-012`, and deliberate Markdown clipboard MIME behavior remains assigned to `EE-017`.
- Task list items retain list semantics while exposing separate named 44-pixel ARIA checkboxes. Pointer, touch, Space, Enter, native Tab order, and keyboard undo/redo are single-action and focus-safe. Link/image dialogs now preserve native button activation, ignore composition keys, restore focus on Escape, and associate URL validation alerts with their inputs. The table toolbar implements one-stop roving focus, pressed alignment state, predictable focus after mutation, stable coarse-pointer viewport layout, and correct row/column header scope during rich paste and editing; the contract records GFM's inability to serialize HTML-only row-header scope.
- Responsive checks cover coarse pointers, a virtual-keyboard-sized visual viewport, local and transformed portals, and Chromium 200% page scaling. Axe reports no automatic violations in the complete production-built fixture. The host naming/portal obligations, behavior contract, limitations, and repeatable VoiceOver/NVDA/real-IME checklist are documented in `docs/input-accessibility-certification.md` and `docs/assistive-technology-checklist.md`.
- Automated evidence deliberately does not claim real operating-system IME, mobile-keyboard, or assistive-technology certification. Those runs remain release-checklist work; richer managed-boundary announcements, mixed-bidi physical-arrow behavior, and localization/theming remain assigned to `EE-016` and `EE-020`.
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

- The accepted [extension system RFC](./extension-system-rfc.md) versions the API independently at `1.0.0` and defines a compile-before-mount architecture for schema, Markdown codec, runtime behavior, typed handles, and lifecycle resources.
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

Status: `NEXT`

#### Goal

Make every supported editing operation accessible to host toolbars and menus.

#### Acceptance criteria

- Add commands for paragraphs, heading levels, blockquotes, lists, tasks, hard breaks, rules, code blocks, and tables.
- Add matching `can` and `isActive` state queries.
- Define consistent focus, selection, history, and boolean-return behavior.
- Add command-level tests independent of the default UI.
- Update API type tests and integration documentation.

### EE-012 — Add host-controlled resource and asset hooks

Status: `QUEUED`

#### Goal

Support production image/media workflows without making storage a core responsibility.

#### Acceptance criteria

- Make link and image protocol policy host-configurable with secure defaults.
- Add hooks for pasted/dropped files, asynchronous upload, progress, cancellation, retry, and failure.
- Add host-controlled URL resolution, link opening, image loading, and privacy policy.
- Define MIME, size, count, and `data:` URL limits.
- Keep document mutations transactional and undoable after asynchronous completion.

### EE-013 — Establish performance and bundle budgets

Status: `QUEUED`

#### Goal

Create reproducible baselines before changing performance-sensitive architecture.

#### Acceptance criteria

- Benchmark initial parse/render, keystroke-to-paint, serialization, memory, and teardown for representative 100 KB, 500 KB, and 1 MB documents.
- Include documents with many code blocks, tables, images, and nested lists.
- Measure a packed consumer rather than only the docs application.
- Record baseline hardware/browser details and variance.
- Set CI warning and failure budgets approved by the project.

### EE-014 — Remove full serialization from hot typing paths

Status: `QUEUED`

#### Goal

Keep editing responsive as documents grow.

#### Acceptance criteria

- Provide lazy Markdown snapshots or an explicit save-snapshot API.
- Make update notifications useful without requiring immediate serialization.
- Coalesce or idle-schedule serialization without losing the final state.
- Preserve a synchronous flush path for form submission and teardown.
- Meet the budgets established in `EE-013`.

### EE-015 — Lazily activate CodeMirror and reduce bundle cost

Status: `QUEUED`

#### Goal

Avoid paying the full code-editor cost for every fence and every consumer.

#### Acceptance criteria

- Avoid eagerly creating a full CodeMirror editor for every offscreen code block.
- Preserve syntax display, selection, copy, search, and transition behavior before activation.
- Keep language grammars in optional lazy chunks with observable load errors.
- Define a slim base entry point if CodeMirror cannot be removed through tree shaking.
- Meet bundle and memory budgets from `EE-013`.

### EE-016 — Complete keyboard and screen-reader interactions

Status: `QUEUED`

#### Goal

Make the supported UI operable without pointer-coordinate assumptions.

#### Acceptance criteria

- Replace or augment the task pseudo-checkbox hit zone with a keyboard-operable semantic control.
- Define non-modal popover/dialog semantics, focus movement, Escape, Enter, and focus restoration.
- Make table controls reachable and understandable through keyboard and screen readers.
- Preserve contenteditable selection while interacting with controls.
- Pass the automated and manual checks established in `EE-006`.

### EE-017 — Add deliberate clipboard semantics

Status: `QUEUED`

#### Goal

Interoperate predictably with rich editors, code editors, and Markdown tools.

#### Acceptance criteria

- Support explicit paste-as-Markdown/plain-text behavior.
- Convert supported rich HTML into safe semantic Markdown.
- Put useful HTML and Markdown/plain-text representations on copy where browser permissions allow.
- Preserve code, tables, lists, links, whitespace, and line breaks across supported clipboard paths.
- Route pasted files through `EE-012` asset hooks.

### EE-018 — Mature table editing

Status: `QUEUED`

#### Goal

Move beyond basic insertion/deletion/alignment toward a production table workflow.

#### Acceptance criteria

- Add table creation and resizing controls.
- Add row/column reordering and before/after insertion choices.
- Add multi-cell selection and predictable copy/paste behavior.
- Define keyboard navigation for empty, multiline, nested, and ragged cells.
- Preserve valid GFM output or report constructs that GFM cannot represent.

### EE-019 — Add configurable typing ergonomics

Status: `QUEUED`

#### Goal

Provide Typora-like typing assistance without hard-coding product preferences.

#### Acceptance criteria

- Add configurable bracket, quote, and Markdown-marker auto-pairing.
- Support wrapping selected text with compatible delimiters.
- Make code-fence language editable and update highlighting safely.
- Expose a configurable shortcut/keymap layer through the extension system.
- Verify IME and undo behavior for every automatic transformation.

### EE-020 — Add a theme, localization, and RTL contract

Status: `QUEUED`

#### Goal

Let Markora fit production design systems and international products.

#### Acceptance criteria

- Replace hard-coded colors and dimensions with documented CSS custom properties.
- Provide reference light, dark, high-contrast, and reduced-motion behavior.
- Make all default UI text and accessible labels injectable.
- Support logical CSS properties and test RTL layout/selection.
- Document which visual responsibilities belong to core, default UI, and host.

### EE-021 — Ship advanced syntax as optional extensions

Status: `QUEUED`

#### Goal

Broaden document compatibility without turning the base editor into a monolith.

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

`EE-001` through `EE-010` are complete. Gate A's content-safety requirements are satisfied, and the browser, complex-input, accessibility, host-lifecycle, external-update, and extension-kernel foundations for Gate B are established.

The next iteration is `EE-011 — Complete the command and state surface`.
