# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor built with ProseMirror and CodeMirror. It parses a documented Markdown subset into an editable ProseMirror document and serializes supported content to a predictable canonical form.

## Features

- Semantic import/edit/export for the documented Markdown dialect, with normalized serialization
- Exact, inert source preservation for conservatively recognized front matter, display math, HTML, and directives
- Headings, blockquotes, lists, flat task items, images, code fences, and pipe tables
- Inline marks for bold, italic, code, strike, and links
- Embedded CodeMirror code blocks with language-aware editing
- Lazy-loaded built-in code block languages with host-extensible loaders
- Toolbar-friendly commands for formatting, links, images, and undo/redo
- URL sanitization plus managed navigation around tables and code blocks

## Markdown compatibility

`markdown`, `editor.commands.reconcileMarkdown()`, and `editor.commands.resetMarkdown()` are parsing boundaries. `editor.getMarkdown()` and `onChange` return normalized serialization, not the original document bytes. Conservatively recognized front matter, standalone display math, HTML, comments, and directives are retained as inert opaque source atoms; other unsupported extensions may still be reinterpreted without an error. Deprecated `setMarkdown()` has the same hard-reset behavior as `resetMarkdown()`.

Read the complete [Markdown dialect and fidelity contract](./MARKDOWN_COMPATIBILITY.md), which is also included in the published package.

Opaque HTML is displayed as text and never executed inside the editor. Serialized Markdown still contains that source, so downstream HTML rendering must apply its own sanitization.

## Install

```bash
npm install markora

# Optional built-in link/image/table overlays
npm install markora-ui
```

## Quick start

```ts
import { createEditor } from "markora";
import "markora/styles.css";

const hostElement = document.querySelector("#editor");

if (!hostElement) {
  throw new Error("Editor host not found.");
}

const editor = createEditor({
  element: hostElement,
  markdown: "# Hello Markora",
  ariaLabel: "Document body",
  autofocus: true,
  onChange(nextMarkdown, { origin }) {
    console.log(origin, nextMarkdown);
  },
});

const unsubscribe = editor.subscribe("selection", ({ origin, selection }) => {
  console.log(origin, selection.from, selection.to);
});

// Later, when the host view unmounts:
unsubscribe();
editor.destroy();
```

## Opaque source editing

Opaque atoms are read-only unless the host supplies `onEditOpaqueMarkdown`. Use the hook to open a host-owned source editor:

```ts
const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ariaLabel: "Document body",
  onEditOpaqueMarkdown({ kind, source, update }) {
    openHostSourceEditor({
      label: kind,
      source,
      onSave(nextSource) {
        if (!update(nextSource)) {
          showSourceConflict();
        }
      },
    });
  },
});
```

`update(nextSource)` returns `false` if the atom was removed, replaced, or changed while the source editor was open. A successful update is undoable, preserves the atom's existing kind, and does not validate or reclassify the new source. See the compatibility contract for the exact preservation boundary and recognized shapes.

## Optional default UI

`markora` is headless by default. Add `markora-ui` when you want the repo's built-in link editor, image editor, and table toolbar overlays.

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ariaLabel: "Document body",
  ui: createDefaultUi(),
  onChangeMode: "animationFrame",
  onChange(nextMarkdown, { origin }) {
    saveDraft(nextMarkdown, { origin });
  },
});
```

## Integration notes

A typical integration has four parts:

- import `createEditor` from `markora`
- import `markora/styles.css`
- optionally pass `ui: createDefaultUi()` from `markora-ui`
- destroy the editor instance when the host view unmounts

Host-facing behavior to keep in mind:

- `ariaLabel` or `ariaLabelledBy` gives the inner editor a host-specific accessible name
- `editor.focus()` targets the outer ProseMirror surface; `editor.blur()` blurs whichever owned ProseMirror or CodeMirror surface is active
- `editor.commands.reconcileMarkdown(markdown)` applies an authoritative host snapshot while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(markdown)` explicitly rebuilds editor state; deprecated `setMarkdown()` remains its hard-reset alias
- `editor.subscribe("update", ...)` observes document activity without serializing Markdown; `onTransaction` remains the ProseMirror-aware compatibility hook
- `onEditOpaqueMarkdown` lets a host provide explicit source editing for otherwise read-only opaque atoms
- `onChangeMode: "animationFrame"` smooths larger documents by batching Markdown emission once per frame
- `editor.flushChange()` forces pending batched `onChange` work to run immediately
- the package ships editor base styles, while surrounding layout and product UI remain the host app's responsibility

## Reconciled updates and hard resets

Use reconciliation for ordinary controlled-component or server-driven updates:

```ts
const changed = editor.commands.reconcileMarkdown(nextMarkdown);
```

The incoming string is parsed before comparison. If its parsed document is semantically equal to the current document, `reconcileMarkdown()` returns `false`, dispatches no transaction, preserves any pending batched local output, and does not emit selection/update events. Otherwise it returns `true` and applies one non-history transaction. The current selection and history are mapped through the change, plugin state is preserved, and a pending animation-frame `onChange` is cancelled so stale local output cannot fire afterward. Disjoint local history remains usable; an entry overlapping replaced content can map to a no-op or be consumed. Reconciliation works while `editable` is `false` and is silent by default; pass `{ emitChange: true }` only when the host intentionally wants `onChange` to receive the authoritative value again.

Reconciliations are synchronous and ordered by invocation. Each call is a complete, authoritative document snapshot, so the last changed call wins when updates overlap. Markora does not merge snapshots, track revisions, or reject stale responses. Hosts with asynchronous reads or writes must gate stale revisions before calling `reconcileMarkdown()`.

`resetMarkdown(markdown, { emitChange? })` is intentionally stronger: it replaces EditorState, resets the selection to the new document default, clears undo/redo and plugin state, and cancels pending batched output. It bypasses `onTransaction` because state replacement does not create a ProseMirror transaction. Typed selection/update events still report origin `"reset"`, and `{ emitChange: true }` emits normalized Markdown with that origin. Use it for switching documents or deliberately discarding transient state. `setMarkdown()` is deprecated but remains an exact hard-reset alias.

## Change origins

Markora identifies dispatched and accepted activity with a `MarkdownEditorChangeOrigin`:

- `"user"` for DOM input and otherwise untagged raw transactions;
- `"command"` for built-in formatting, history, and media commands;
- `"external"` for `reconcileMarkdown()`;
- `"reset"` for state replacement through `resetMarkdown()` or its deprecated alias;
- `` `extension:${string}` `` for a transaction deliberately tagged by a host extension.

`onChange(markdown, context)` exposes the origin in its second argument. `onTransaction(transaction, view, context)` exposes it in its third argument and observes dispatch attempts after editor policy has run; inspect the resulting view state or typed events rather than treating the callback alone as proof of a document change. Selection and update subscription events have an `origin` field and describe accepted state changes. When `onChangeMode` is `"animationFrame"`, normal batched changes report the origin of the latest pending document change.

Advanced ProseMirror extensions can attach a namespaced origin before dispatch and read one later:

```ts
import {
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
} from "markora";

const transaction = setMarkdownEditorTransactionOrigin(
  editor.view.state.tr.insertText("generated"),
  "extension:autocomplete",
);

editor.view.dispatch(transaction);
console.log(getMarkdownEditorTransactionOrigin(transaction));
```

Only non-empty `"extension:name"` values are accepted by the public setter; built-in origins are assigned by Markora. Origins classify where activity entered the editor. They are not proof that a filtered transaction changed state, revision IDs, authorization checks, or a loop-prevention protocol. Controlled hosts should normally leave reconciliations silent rather than echoing every `onChange` back with `{ emitChange: true }`.

## Embed options

The creation options cover common embedded-editor states:

- `editable?: boolean` defaults to `true`.
- `placeholder?: string` supplies guidance while the document is empty.
- `autofocus?: boolean` defaults to `false`.
- `initialSelection?: "start" | "end" | "all" | { anchor: number; head?: number }` sets the initial model selection independently of focus.
- `attributes?: Readonly<Record<string, string>>` applies host attributes to the inner editor DOM.
- `ariaLabel?: string` and `ariaLabelledBy?: string` provide accessible naming. Prefer `ariaLabelledBy` when the host renders a visible label.

Markora supplies textbox-role and multiline defaults. The inner editor's contenteditable/read-only and placeholder attributes are managed values and take precedence over conflicting entries in `attributes`.

Object selection targets use integer ProseMirror positions. Both positions must be within the current document and resolve inside text blocks; invalid targets throw `RangeError` before creation claims the host or before `focus()` changes the selection.

Attribute names are normalized to lowercase and validated before use. Inline event-handler attributes and `nodeName` are rejected; use host event listeners and editor subscriptions for behavior.

Read-only mode keeps selection and copy available, while blocking user input, built-in UI mutations, formatting commands, history commands, and ordinary document-changing `view.dispatch()` transactions. Host-controlled `reconcileMarkdown()` and `resetMarkdown()` remain available so a preview can receive new content. This is an interaction mode, not an authorization boundary: trusted host code can still replace content through those APIs, and unsupported raw state replacement can bypass the policy.

`autofocus` and the initial selection are creation actions. Subscriptions added after `createEditor()` returns do not replay them.

## Dynamic options

Use `updateOptions()` for configuration that does not require EditorState reconstruction:

```ts
editor.updateOptions({
  editable: false,
  placeholder: null,
  attributes: { "data-document-id": documentId },
  ariaLabel: "Document preview",
  onChange: null,
});
```

The method accepts `editable`, `placeholder`, `attributes`, `ariaLabel`, `ariaLabelledBy`, `onChange`, `onTransaction`, `onChangeMode`, and `onEditOpaqueMarkdown`. Nullable fields clear their current value. Changing `onChange` or `onChangeMode` first flushes pending output once through the previous listener, then installs the new listener/mode. Callback and presentation changes do not rebuild EditorState or emit an `update` event.

`element`, `markdown`, `initialSelection`, the autofocus action, `ui`, and `codeBlockLanguages` are creation-only. Use `commands.reconcileMarkdown()` for ordinary host snapshots or `commands.resetMarkdown()` for an explicit state replacement.

## Typed events

`subscribe()` accepts `"focus"`, `"blur"`, `"selection"`, `"update"`, or `"error"` and returns an idempotent unsubscribe function:

```ts
const stopSelection = editor.subscribe("selection", ({ origin, previousSelection, selection }) => {
  console.log(origin, previousSelection.from, selection.from);
});

const stopUpdates = editor.subscribe("update", ({ origin, selection }) => {
  renderToolbar(selection, { origin });
});

const stopErrors = editor.subscribe("error", ({ code, context, error, recoverable }) => {
  if (code === "code-block-language-load-failed") {
    reportLanguageFailure(context.language, error, recoverable);
  }
});
```

- Focus and blur events expose `nativeEvent`. The focus boundary includes the outer ProseMirror surface and nested CodeMirror editors, so moving between them does not create a false blur/focus pair. Both events cross one microtask boundary: focus waits for the browser and nested editor's focus stack to finish, while blur waits until the next focused element can be checked.
- Selection events provide `previousSelection`, `selection`, and `origin`. Each host snapshot contains `anchor`, `head`, `from`, `to`, `empty`, and `kind`.
- Selection and update events fire synchronously, with selection before update for the same accepted state change. Both expose the accepted change's `origin`. Update events contain the current selection, neither Markdown nor a ProseMirror transaction, and are not affected by `onChangeMode`; call `event.editor.getMarkdown()` only when that subscriber actually needs a snapshot.
- Error events currently report recoverable code-language-load failures with a stable `code`, `context.language`, and the original `error`. Language loaders and extensions run after the current editor state update completes, so synchronous failures use the same event path without re-entering that update.

If a recoverable runtime failure has no error subscriber, Markora forwards it to the editor window's global error reporting path rather than silently swallowing it.

`onChange` and `onTransaction` remain supported. Use `onChange(markdown, context)` for normalized Markdown output, `update` for a cheap host-facing document signal, and `onTransaction(transaction, view, context)` only when an advanced integration needs ProseMirror transaction details.

## Destruction and post-destroy behavior

`destroy()` flushes one pending batched `onChange`, tears down the editor, nested code editors, optional UI, listeners, and subscriptions, and completes cleanup even when a teardown callback reports an error. It is idempotent.

After destruction:

- `editor.isDestroyed` is `true`.
- `editor.getMarkdown()` returns the cached final Markdown.
- `editor.flushChange()`, repeated `destroy()`, and unsubscribe functions returned before destruction are no-ops.
- Every other high-level call throws `MarkdownEditorDestroyedError`.
- `editor.view` refers to the destroyed raw ProseMirror view and must not be used.

## Advanced `view` escape hatch

`editor.view` remains available for version-coupled integrations. State/DOM inspection and `view.dispatch()` are supported as advanced usage. Direct `view.setProps()`, `view.updateState()`, DOM mutation, or `view.destroy()` can bypass lifecycle guards, configuration, and typed events; those operations and ProseMirror internals are outside Markora's semver compatibility boundary.

### Migration note

Existing one-argument `onChange` and two-argument `onTransaction` callbacks remain source-compatible because the new context parameters are trailing. `setMarkdown()` remains callable but is deprecated; replace it with `resetMarkdown()` when the hard reset was intentional, or with `reconcileMarkdown()` for ordinary controlled/external updates. Prefer `editor.focus()`, `editor.blur()`, `editor.updateOptions()`, and typed subscriptions over direct view mutation. Integrations that hand-build structural `MarkdownEditor` mocks must add the new commands and lifecycle members or type the mock as `Pick<MarkdownEditor, ...>`.

## Exports

```ts
import {
  createDefaultCodeBlockLanguageRegistry,
  createEditor,
  getMarkdownEditorTransactionOrigin,
  MarkdownEditorDestroyedError,
  setMarkdownEditorTransactionOrigin,
} from "markora";
import type {
  CodeBlockLanguageRegistry,
  CodeBlockLanguageSupport,
  CreateEditorOptions,
  EditorUiFactory,
  MarkdownEditor,
  MarkdownEditorActiveMark,
  MarkdownEditorActiveNode,
  MarkdownEditorBlurEvent,
  MarkdownEditorBuiltinChangeOrigin,
  MarkdownEditorChangeContext,
  MarkdownEditorChangeOrigin,
  MarkdownEditorCommands,
  MarkdownEditorDomAttributes,
  MarkdownEditorErrorCode,
  MarkdownEditorErrorEvent,
  MarkdownEditorEventListener,
  MarkdownEditorEventMap,
  MarkdownEditorEventName,
  MarkdownEditorFocusEvent,
  MarkdownEditorExtensionOrigin,
  MarkdownEditorMark,
  MarkdownEditorMarkdownUpdateOptions,
  MarkdownEditorSelectionEvent,
  MarkdownEditorSelectionKind,
  MarkdownEditorSelectionSnapshot,
  MarkdownEditorSelectionTarget,
  MarkdownEditorState,
  MarkdownEditorUi,
  MarkdownEditorUnsubscribe,
  MarkdownEditorUpdateEvent,
  OpaqueMarkdownEditRequest,
  OpaqueMarkdownKind,
  ToolbarButtonState,
  ToolbarState,
  UpdateEditorOptions,
} from "markora";
```

## Code block languages

Built-in CodeMirror highlighting and editing grammars for JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell load on demand. You can add or override a grammar with `codeBlockLanguages`:

```ts
import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element: hostElement,
  ariaLabel: "Document body",
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [
      // Return CodeMirror extensions for your custom fenced language.
    ],
  },
});
```

Markora invokes language loaders and installs their CodeMirror extensions after the current outer-editor update completes. A block removed or superseded before that deferred work starts does not invoke its loader.

## API highlights

- `editor.getMarkdown()` returns the current normalized Markdown serialization
- `editor.commands.reconcileMarkdown(markdown, { emitChange })` applies an authoritative snapshot while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(markdown, { emitChange })` explicitly rebuilds EditorState; `setMarkdown()` remains a deprecated hard-reset alias
- change callbacks, transaction callbacks, and selection/update events expose a typed origin
- `onEditOpaqueMarkdown` receives an opaque atom's `kind`, exact `source`, and guarded `update(nextSource)` function
- `editor.commands.toggleMark(...)`, `editor.commands.setLink(...)`, `editor.commands.insertImage(...)`, `editor.commands.undo()`, and `editor.commands.redo()` form the command surface
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a compatibility snapshot
- `editor.ui?.editLink()` and `editor.ui?.editImage()` are the optional namespaced UI entry points when overlays are attached
- `editor.subscribe(...)` exposes typed focus, blur, selection, update, and recoverable error events
- `editor.updateOptions(...)` updates dynamic presentation, editable state, and callbacks without rebuilding EditorState
- `editor.destroy()` performs idempotent teardown and exposes its state through `editor.isDestroyed`

## Development

- `pnpm dev` starts the core watcher and demo site together
- `pnpm pack:smoke` verifies the packed `markora` and `markora-ui` tarballs in a tiny Vite consumer app
- `pnpm release:check` dry-runs the core npm tarball and then runs the packed-consumer smoke test
- `pnpm check` builds the workspace, runs typechecks, executes API type tests, smoke-tests Node ESM imports, and runs the shared test suite
