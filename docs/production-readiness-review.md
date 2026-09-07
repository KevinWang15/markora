# Production readiness review

Reviewed 2026-09-07 at commit `8bdcd26`. Target: a dependable desktop Markdown writing application with Typora-grade polish.

The repository has a substantial editor foundation: ProseMirror document semantics, lazy CodeMirror fences, explicit resource policies, extension boundaries, teardown handling, and broad interaction tests. The desktop application does not yet provide the same reliability. The highest-value next work is document safety and continuity across editing modes.

The findings and original verification below describe the initial review at `8bdcd26`. The subsequent implementation is recorded in the follow-up section; the original findings remain here as the baseline. Inspection covered the desktop host in detail and selected core, UI, extension, compatibility, performance, and CI paths. Browser probes used Chromium; the built NW.js application was also launched with an isolated profile and temporary documents and tested through CDP. This is not a claim that every line or platform was audited.

## Prioritized findings

### 1. P0 — A completed save can silently discard newer edits

**Confirmed in the built NW.js application through CDP**, as well as the browser renderer with delayed persistence.

Location: [App.tsx](../packages/app/src/App.tsx), lines 265–291, especially 279–283.

Reproduction:

1. Open a document and enter source mode.
2. Edit, start Save, and delay the underlying filesystem write.
3. Type more text before the write completes.
4. Complete the write. The status becomes “Saved,” although the displayed source contains text absent from disk.
5. Choose New. No unsaved-changes dialog appears; the newer text is discarded.

The save continuation unconditionally replaces the current Markdown snapshot with the older saved snapshot and clears dirty state. `SourceEditor` retains its own live document, so the screen and document bookkeeping disagree. Save shortcuts also bypass the toolbar's `saving` disablement, allowing overlapping writes. A pending operation has no document identity check to prevent its completion from affecting another document.

**Fix:** Give each document session an identity and each edit a revision. Save an immutable snapshot. On completion, update only that session's saved baseline; derive dirty state from the latest document. Serialize writes, reject stale completions, and make save-and-close/new verify that the current revision was actually persisted. Test edits during save, repeated shortcuts, switching documents during I/O, cancellation, failure, and completion in reversed order.

### 2. P1 — Disk persistence lacks atomic replacement, conflict checks, and recovery

**Established by code inspection; power-loss behavior was not fault-injected.**

Location: [desktop.ts](../packages/app/src/desktop.ts), lines 185–209; [App.tsx](../packages/app/src/App.tsx), document state and persistence effects.

Saving calls `fs.writeFile(destination, content, "utf8")` directly on the user's document. There is no temporary-file replacement or backup. Document edits live in memory; local storage persists only recents and theme. There is no recovery journal, external-file-change detection, or conflict check before overwriting.

An interrupted overwrite can damage the existing document. A renderer/process crash loses unsaved work. Changes made by another editor or synchronization tool can be overwritten without notice.

**Fix:** Implement an atomic save service with a temporary file in the destination directory, appropriate flushing and replacement behavior per platform, and recoverable backups. Persist revisioned recovery snapshots independently of explicit Save. Track the disk version and detect conflicts before replacing it; provide reload, compare, and save-copy actions. Validate disk-full, access-denied, interrupted-write, external-edit, and crash/restart scenarios with temporary files.

### 3. P1 — Saving an untouched document can change its meaning

**Confirmed in the browser renderer.**

Location: [App.tsx](../packages/app/src/App.tsx), lines 201–228 and 265–277; [Markdown compatibility contract](../packages/core/MARKDOWN_COMPATIBILITY.md).

The desktop host always obtains canonical rich-editor Markdown on Save. It installs none of the optional syntax extensions and provides no fidelity diagnostics or conversion confirmation.

Example imported source:

```markdown
Title
=====

A[^1] &copy;

[^1]: Footnote
```

Saving without editing produces:

```markdown
# Title

A[^1](Footnote) ©

[^1]: Footnote
```

The heading/entity changes are normalization. The footnote reference becoming a link is a semantic change. Core explicitly documents its bounded dialect and normalization; the desktop product currently exposes unrestricted Markdown opening without compensating for that contract.

**Fix:** Preserve original source for untouched saves. Define and enable the desktop dialect, including the existing footnote extension. Retain recoverable original source, identify unsupported constructs, and offer a source-preserving workflow where rich conversion cannot safely represent a document. Surface table fidelity diagnostics before lossy saves. Test import → no edit → save and source → rich → source using actual user-document fixtures.

### 4. P1 — Source-mode edits erase undo history when returning to rich text

**Confirmed in the browser renderer.**

Location: [App.tsx](../packages/app/src/App.tsx), lines 338–361 and 704–715; [SourceEditor.tsx](../packages/app/src/SourceEditor.tsx), lines 89–133; [createEditor.ts](../packages/core/src/createEditor.ts), lines 1888–1895.

After a source edit, Undo is available. Returning to rich text calls `resetMarkdown`, which creates a fresh ProseMirror state and history. Undo is then unavailable. Re-entering source mode creates a fresh CodeMirror instance, and Undo remains unavailable there too. Earlier rich-text history is also lost when source changes cause a reset.

**Fix:** Treat view changes as presentation changes within one document session. Preserve source-editor state and establish a document history that includes source edits. Map selection and scroll position across views. Simply replacing reset with the current reconcile API is insufficient: that API deliberately marks external transactions `addToHistory: false`. Verify repeated source/rich transitions with edits and multi-step undo/redo.

### 5. P1 — Relative images use the wrong document directory

**Confirmed in the built NW.js application through CDP.**

Location: [App.tsx](../packages/app/src/App.tsx), lines 212 and 249–256; [imageView.ts](../packages/core/src/imageView.ts), lines 121–124 and 261–263.

Opening `/tmp/markora-review-native/a/test.md` containing `![test](picture.svg)`, with a valid sibling SVG, produced an image URL under `chrome-extension://…/picture.svg`, with zero natural width and an error state.

`replaceDocument` resets the editor before changing `pathRef`. Image node views synchronously resolve URLs during reset, using the old document path or null. Updating the ref afterward does not refresh existing image views; they reload when their stored `src` changes. Reusing the same relative URL across documents also needs explicit invalidation.

**Fix:** Commit the document and its resource base together. Recreate or invalidate resource views when the document identity/base changes. Cover first open, switching between directories with identical relative image names, and Save As. Save As also needs a policy for rebasing or copying relative assets when the destination directory changes; current code writes Markdown alone.

### 6. P2 — The unsaved-changes dialog does not behave as a modal

**Confirmed by keyboard probes.**

Location: [App.tsx](../packages/app/src/App.tsx), lines 750–786.

The dialog declares `aria-modal="true"` and initially focuses Save, but Tab leaves the dialog and reaches the sidebar and other background controls. Escape does not dismiss it. There is no focus trap, background inertness, or explicit focus restoration. Save remains available inside the dialog while its asynchronous action is running.

**Fix:** Use a correctly managed native dialog or a reusable accessible modal implementation. Keep focus inside it, make background content inert, support Escape/Cancel and focus restoration, and prevent duplicate pending actions. Test these behaviors in the desktop host, including screen-reader use; core overlay tests do not cover this dialog.

### 7. P2 — Outline entries can navigate to the wrong heading

**Confirmed in the browser renderer.**

Location: [document.ts](../packages/app/src/document.ts), lines 39–80; [App.tsx](../packages/app/src/App.tsx), lines 531–537.

For `First\n=====\n\n## Second\n`, the rich editor renders two headings, but the outline lists only “Second.” Clicking “Second” scrolls to “First.” The host's regular-expression parser omits Setext headings, while navigation indexes into every rendered heading.

Additional confirmed cases: `# C#` becomes “C” in the outline; a triple-backtick line incorrectly closes a four-backtick fence in the outline parser, creating phantom headings and hiding later real ones.

**Fix:** Build the outline from the editor's parsed document using stable positions/identities. Reuse dialect-aware parsing and source positions for source mode. Avoid matching two independently generated lists by index. Include Setext, nested headings, escaped punctuation, differing fence lengths, and duplicate heading names.

### 8. P1 release gate — Desktop behavior is largely outside automated coverage

**Established by test and CI inspection; current test results are recorded below.**

Location: [desktop tests](../packages/app/test/document.test.ts), [Playwright configuration](../playwright.config.ts), [browser workflow](../.github/workflows/browser.yml), [performance workflow](../.github/workflows/performance.yml).

The app has five document-helper tests. Existing browser suites exercise the demo/lab and editor components, not the desktop application. Neither workflow directly runs the full `pnpm check`/Vitest suite, although browser and package/performance smoke coverage is substantial. Consequently, the confirmed desktop failures coexist with hundreds of passing editor browser checks.

**Fix:** Add a required unit/typecheck job and desktop host integration tests. Use a deterministic persistence adapter for operation-order tests, plus NW.js CDP tests against real temporary files. Add packaged launch/open/save/close coverage on supported operating systems. Keep the existing core browser matrix.

The diagrams performance unit test also checks a 20-second budget while using Vitest's default 5-second test timeout. It timed out in the unrestricted parallel run and passed individually. Align the test timeout with the intended budget and run performance checks under controlled concurrency.

## Further improvements toward a finished writing application

- **Complete common writing workflows.** The desktop source currently has no app-owned find/replace, print/export, folder navigation, or focus/typewriter mode. Prioritize find/replace across both editor surfaces, reliable document navigation, and export/print. Add these as explicit desktop features with keyboard and selection behavior defined.
- **Use the existing extension investment in the app.** Footnotes, math, diagrams, alerts, and TOC exist as packages but are not configured by the desktop host. Choose a coherent supported dialect and supply appropriate renderers and source-edit interactions. Front matter and other opaque atoms need an easy editing path.
- **Keep statistics off the typing path.** Source mode calls `doc.toString()` and updates React on every document change. That synchronously recomputes the outline, full-document `Intl.Segmenter` word count, and character count. Defer/coalesce derived statistics, use incremental state where justified, and profile the actual desktop source and rich views on representative 100 KB, 500 KB, and 1 MB documents. This is an inspection finding, not a fresh latency measurement.
- **Measure the whole desktop experience.** Existing performance budgets target packed editor consumers. A 1 MB default-idle key-to-presentation failure threshold of 350 ms is too permissive as a desired typing experience; distinguish a regression ceiling from a responsiveness target. Track document opening, continuous typing, source toggles, save, and recovery on specified hardware. Existing `performance-results/benchmark.json` contains failures but comes from an earlier dirty revision; it is not evidence of current performance.
- **Make async resource work visible.** The app configures asset uploads but does not subscribe to asset events for progress, failures, retry, or cancellation. Surface these states and retain insertion ownership if the user changes documents during a file picker or copy operation.
- **Consolidate lifecycle logic incrementally.** `createEditor.ts` is 3,162 lines and `minimalEditor.ts` is 2,060, with parallel lifecycle, dispatch, event, command, and option-update implementations. Shared helpers already exist, but the remaining duplication makes fixes easy to apply to one entry only. Extract shared lifecycle/event machinery behind the existing contract tests while preserving minimal-bundle isolation. Split the 799-line desktop component into document session/persistence, command routing, and view components.
- **Finish platform and accessibility validation.** The repository's manual assistive-technology checklist remains unchecked. Complete real IME, screen-reader, native file-dialog, keyboard-layout, and platform packaging checks. Audit native subscription cleanup: `onOpenPath` currently returns a no-op unsubscriber and the close handler has no removal path, which matters under React StrictMode/remounts. No Windows/macOS or real screen-reader certification was performed in this review.

## Verification and evidence

- `pnpm check`: builds, typechecks, and configured import smoke steps completed; initial unit run had **1,490 passed, 1 timeout** across 85 files. The timed-out diagrams performance test passed individually in approximately 1.2 seconds.
- Required Chromium browser suite: **228 passed, 1 skipped, 1 failed**. Failure: `Android CDP fallback expires after editor state changes`, expecting `alpha` but receiving `alph` during the composition-start cancellation scenario. An isolated three-repeat run produced two failures and one pass. This is an unresolved, intermittent gate failure; the test dispatches input and composition through separate browser calls around a 60 ms fallback, so a real Android defect is not established by this result alone.
- Full unit rerun with `pnpm exec vitest run --maxWorkers=4`: **1,491 passed across all 85 files** in 43.57 seconds. After rebuilding the demo, the Android cancellation test failed all three further repetitions with the same `alpha` → `alph` result.
- A focused Android-user-agent probe that dispatched `beforeinput` and `compositionstart` in the same browser turn preserved `alpha` in **10/10 repetitions**. This supports investigating test/event ordering first; it does not replace real-device validation or resolve the failing release gate.
- Focused Chromium probes confirmed save bookkeeping, source history loss, modal focus escape, no-edit conversion, and outline mismatch.
- Built NW.js `0.115.0` on Linux, isolated profile, temporary files, CDP: confirmed save data loss and broken relative image resolution. The write delay was injected at the filesystem API boundary; the eventual write used the real filesystem.
- Full Firefox/WebKit, fresh performance certification, Windows/macOS, power-loss fault injection, and real assistive technology were not run.

Raw session artifacts are available locally under `/tmp/markora-review-*`, including `markora-review-probes.json`, `markora-review-outline.json`, `markora-review-native/results.json`, screenshots, scripts, and test logs. The primary browser failure trace is in the workspace's `test-results` directory.

Recommended implementation order: fix revision-safe saves and resource context; add atomic persistence and recovery; preserve source fidelity and undo; establish desktop release tests; then improve navigation, accessibility, performance, and writing features. Each phase should have explicit behavior tests before expanding scope.


## Implementation follow-up — 2026-09-07

The confirmed desktop defects now have fixes and regression coverage:

- `2b5859d`: document identities and revision-aware save completion preserve edits made during I/O, serialize saves, and retain untouched source bytes.
- `c0de084`: atomic replacement, previous-version backups, external-change checks, ordered recovery checkpoints, resource refresh, native modal behavior, and native listener cleanup.
- `a135780`: shared source/rich undo and redo, semantic footnotes and TOC, model-based outline navigation, and deferred document statistics.
- `6172e8d`: the final app follow-up preserves relative images on Save As, resolves encoded resource names, surfaces asset/editor errors, asks before lossy table saves, and prevents closing over edits made during the final recovery write. Source reconciliation retains the existing rich view; history shortcuts respect active composition.
- CI now runs the complete unit/build/typecheck/import-smoke checks and a separate production-app Chromium suite. The Android fallback cancellation test dispatches each invalidating event in the same browser turn as the pending deletion, eliminating its race with the 60 ms timer. The diagram performance test's runner timeout now accommodates its existing 20-second budget, with bounded unit concurrency.

Native validation used the built NW.js application on Linux with isolated profiles and temporary files. CDP checks exercised real atomic save/backup/conflict behavior, delayed-save edits, first-open and switched-directory images, Save As with encoded image filenames and copied assets, recovery after renderer reload, modal Tab/Escape behavior, and late edits during the final close checkpoint. The Save As destination was supplied at the native picker boundary; the file writes and image copies used the real filesystem.

Final local verification: `pnpm check` passed, including **1,509 unit tests across 90 files**, builds, type checks, and import smoke checks. The production-app Chromium suite passed **8/8** checks, including direct restoration of rich table snapshots during undo. The required Chromium suite passed **229** checks with **1 existing skip**; its previously failing Android cancellation case now passes. The final rich-undo adjustment also passed the app type check and production build. The Android input file also passed all **21** cases across three repetitions.

Remaining release work includes native Windows/macOS and real assistive-technology/IME validation, power-loss and filesystem-specific durability testing, packaged launch/open/save/close automation, full desktop performance measurements, and the additional writing workflows listed above. Conflict checks minimize accidental external overwrites but do not provide a cross-process filesystem lock. Recovery retains a recent checkpoint, and the application still uses its documented bounded Markdown dialect. These changes address the confirmed defects; they are not certification of complete Typora parity.
