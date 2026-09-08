# Maintenance review — 2026-09-08

Scope: source-level unused-code checks for core, default UI, app, demo, React host
adapters, and selected extensions; call-site inspection of the recent math work;
and a review of application and editor assembly boundaries. This is a targeted
maintenance review, not a complete audit of every package or external consumer.

## Completed removal pass

- Removed uncalled list/selection helpers, unused imports and local bindings in
  core, plus an unused table-navigation dependency and its test stubs.
- Removed an unused math-render scheduling predicate and diagram selection state
  that was assigned but never read. Diagram selection styling remains DOM-owned.
- Made the always-present math edit button non-nullable and removed dead guards.
- Enabled unused-local and unused-parameter errors in the core, math, and diagram
  source configurations so existing build/typecheck CI enforces the cleanup.

Public extension hooks such as `onEditSource` remain supported. The repository's
in-place editor uses a different default path, but external hosts can still use
that hook. No runtime behavior change is intended by this removal pass.

Validation of this removal pass: `pnpm check` passed all builds, type checks,
import smoke checks, and 1,633 unit tests. The focused Chromium suite passed
35 checks covering list editing, code-block activation, ragged/rectangular tables,
and math, including CDP behavior checks. The previously failing app caret test
passed 12 local repetitions; this does not resolve its CI failure.

## CI follow-up requiring investigation

The previous implementation commit `e70875a` deployed Pages successfully, but its
[desktop run](https://github.com/KevinWang15/markora/actions/runs/34188013003)
failed one inline-math insertion assertion: `Formula: .$E=mc^2$ more` was produced
instead of `Formula: $E=mc^2$ more.`. The test presses ArrowLeft immediately before
Shift+F10. The menu captures the current ProseMirror selection in a capture-phase
keydown handler. Investigate native/model selection synchronization and the test's
document-open readiness before deciding whether this is a test race or a product
bug. Do not weaken the expected caret position.

The [performance run](https://github.com/KevinWang15/markora/actions/runs/34188013098)
failed the 100 KiB codec-parse and dirty-teardown maxima (78.03 ms and 72.985 ms,
respectively, against 50 ms limits). Larger-document failure ceilings passed.
This does not establish a cause: compare raw samples and profile the failing
paths before attributing it to runner variance or changing limits. These failures
were on the previous commit, before this removal pass.

## Follow-up priorities

### 1. Separate desktop operations from React presentation

[App.tsx](../packages/app/src/App.tsx) still owns recovery startup, save/export
adapters, source/rich transitions, history restoration, search, native bindings,
and dialog presentation. `DocumentController` already provides a useful boundary;
continue it with focused adapters for document editing and desktop operations.

For example, `finishRichInput` is a render-local function captured by multiple
callbacks, while the values it currently reads are stable refs or extension
instances. This works today but makes future dependency changes easy to miss.
Give those operations explicit stable dependencies. Preserve revision-safe saves,
composition guards, source fidelity, and source/rich Undo in the existing app tests.

### 2. Reduce editor-factory assembly responsibilities

[createEditor.ts](../packages/core/src/createEditor.ts) and
[minimalEditor.ts](../packages/core/src/minimalEditor.ts) still mix feature
assembly, commands, lifecycle setup, and selection behavior. The nested
`createSchemaRuntimeHelpers` in the full factory exposes a large helper object;
unused returned helpers survived until this review removed them.

Extract cohesive schema-dependent helpers and lifecycle bindings incrementally.
Use explicit dependencies and keep full-only tables/default UI out of minimal.
Preserve packed-consumer dependency tests alongside shared-runtime tests; file
splitting alone does not establish a better boundary.

### 3. Separate math edit sessions from render presentation

[nodeViews.ts](../packages/extension-math/src/nodeViews.ts) owns both render state
and the source-edit session: validation, transactions, history grouping, empty or
invalid-source replacement, and exit selection. `sourceEditor.ts` already isolates
native input and highlighting. A focused edit-session controller would make the
remaining transition rules easier to review without mixing them with DOM styling.

Keep the two delegated shell listeners, on-demand input listeners, composition
behavior, history semantics, and renderer cancellation. Math and diagram rendering
have different policies; avoid merging their managers solely because code looks
similar. Recheck listener and retained-resource budgets after any extraction.

### 4. Narrow the private dialog API

[Dialog.tsx](../packages/react-ui/src/Dialog.tsx) retains `content`, `variant`,
custom `icon`, and `initialFocus` options with no current callers after the math
modal removal. These options also retain editor-variant styles. Decide whether
[SourceDialog.tsx](../packages/app/src/SourceDialog.tsx) should use the editor
layout, or remove those options and styles together. Verify modal focus and
source-dialog layout before changing this shared UI.
