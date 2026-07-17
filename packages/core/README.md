# markora

Write Markdown at the speed of thought.

`markora` is a Typora-style Markdown editor built with ProseMirror and CodeMirror. It parses a documented Markdown subset into an editable ProseMirror document and serializes supported content to a predictable canonical form.

## Features

- Semantic import/edit/export for the documented Markdown dialect, with normalized serialization
- Exact, inert source preservation for conservatively recognized front matter, display math, HTML, and directives
- Headings, blockquotes, lists, flat task items, images, code fences, and pipe tables
- Inline marks for bold, italic, code, strike, and links
- Exact, lightweight source-text code-fence shells with viewport-lazy CodeMirror editing
- Lazy-loaded CodeMirror runtime and built-in languages with host-extensible loaders
- Toolbar-friendly commands for formatting, links, images, and undo/redo
- Per-editor URL/image/navigation/upload policy plus managed navigation around tables and code blocks

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
    saveDraft(nextMarkdown, { origin });
  },
});

const unsubscribe = editor.subscribe("update", ({ origin }) => {
  markDocumentDirty(origin); // Cheap and synchronous; no Markdown serialization.
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
  onChange(nextMarkdown, { origin }) {
    saveDraft(nextMarkdown, { origin });
  },
});
```

The omitted `onChangeMode` uses the production default, `"idle"`: rapid document changes coalesce, and full Markdown serialization does not run in the synchronous input path. Use `"animationFrame"` only for the prior once-per-frame behavior or `"immediate"` when an integration deliberately requires same-stack serialization and callback delivery.

## Clipboard semantics

The outer editor chooses one inbound representation in this order:

1. A transfer containing any file is wholly owned by `resources.assets`; accompanying HTML, Markdown, and plain text are never inserted.
2. Explicit plain paste, including Ctrl/Cmd-Shift-V, uses `text/plain` literally.
3. Otherwise `text/html` wins. This retains internal ProseMirror slice context and HTML-only semantics such as table row-header scope.
4. Without HTML, `text/markdown` is parsed with this editor's finalized codec and extension syntax.
5. Otherwise `text/plain` remains literal.

Supported HTML is schema-parsed in a detached document, passed through ordered extension transforms, and clamped by the final built-in link/image URL sanitizer. Common `<pre><code class="language-ts">` and `lang-ts` language metadata is retained, as are leading task-list checkbox inputs. Unsupported elements and attributes do not become live host DOM. Raw HTML recognized inside explicit Markdown follows the documented inert opaque-source policy; exported Markdown remains untrusted input to downstream renderers.

For host-owned paste buttons or menus, pass an already-read string to the typed commands:

```ts
if (editor.state.can.pasteMarkdown()) {
  editor.commands.pasteMarkdown(markdownText);
}

editor.commands.pastePlainText(literalText);
```

Markora does not request Clipboard API permission. The embedding host owns asynchronous clipboard reads, user activation, denial UI, and fallbacks. A successful command replaces the retained ProseMirror selection, focuses the editor, has origin `"command"`, and contributes one undo step. Empty input, read-only mode, and active composition return `false`; non-string programmer input throws `TypeError`.

For a non-empty outer selection, copy and cut synchronously attempt these event representations:

- `text/html`: semantic schema HTML with internal `data-pm-slice` context; task items contain disabled portable checkbox inputs, not editor buttons or generated IDs;
- `text/markdown`: canonical Markdown from the same compiled codec, including extension serializers;
- `text/plain`: human-readable text with list/task markers, hard line breaks, tab-separated table cells, and exact code text.

`transformCopied` runs before all three representations are derived. Inbound extension clipboard transforms are not reused on outbound data. Failure to write the optional Markdown MIME leaves HTML/plain copy working. Copy is read-only safe and does not change history or selection. Cut writes first and then performs one `"user"` transaction with `uiEvent: "cut"`; in read-only mode it writes without deleting.

Active CodeMirror and passive code shells remain literal code surfaces: plain text wins unless a configured nested HTML transform explicitly changes the rich representation; otherwise Markdown is preferred to HTML-derived text when plain text is absent. Their native source selection copies plain code so CodeMirror's linewise copy/cut behavior remains intact. Selecting a complete code block through the outer ProseMirror surface produces fenced `text/markdown`. Nested code always rejects files.

A native drag that spans a live CodeMirror DOM owner and the surrounding ProseMirror DOM is not a portable destructive selection: Firefox and WebKit expose mutually inconsistent DOM, CodeMirror, and document-model endpoints, including in Shadow DOM. Markora therefore owns such a cut as plain-text copy and suppresses deletion rather than risk DOM/model divergence. The browser-projected copied substring can vary on that boundary. For exact or destructive behavior, select within the active code editor, within the outer editor, or select the complete code block through the outer surface.

## Resources, links, images, and asset uploads

`CreateEditorOptions.resources` is a creation-only, per-editor policy boundary. It lets the embedding host decide which URLs may be stored in Markdown, how stored URLs resolve at use time, how modifier-click navigation works, how images are fetched, and whether pasted or dropped files may become Markdown. Storage, authentication, and upload transport remain host responsibilities.

### Stored URL policy

The same final sanitizer runs after Markdown parsing, rich paste (including extension clipboard and raw-plugin slice transforms), typing rules, built-in UI, public link/image commands, upload results, and runtime resolution. This prevents an earlier parser or paste transform from bypassing the configured policy.

| Setting | Link default | Image default |
| --- | --- | --- |
| `allowedProtocols` | `http:`, `https:`, `mailto:`, `tel:` | `http:`, `https:`, `data:` |
| `allowRelative` | `true` | `true` |
| `allowCredentials` | `false` | `false` |
| `allowedDataMimeTypes` | none | `image/avif`, `image/gif`, `image/jpeg`, `image/png`, `image/webp` |
| `maxDataUrlBytes` | 1,048,576 | 1,048,576 |
| `maxDataUrlCharacters` | 1,398,358 | 1,398,358 |
| Image privacy | — | `crossOrigin: null`, `referrerPolicy: "no-referrer"` |

`data:` must appear in `allowedProtocols` and its exact MIME type must appear in `allowedDataMimeTypes`; URL-policy MIME entries do not accept wildcards. A data URL accepts a bare MIME type and at most one `;base64` marker, so charset and other metadata parameters are rejected. `maxDataUrlBytes` counts the decoded base64 or percent-decoded UTF-8 payload, while `maxDataUrlCharacters` bounds work before decoding. Both are positive, independent, inclusive limits; a host that permits larger data must review and raise both.

Protocol-relative URLs, backslashes, embedded whitespace or ASCII controls, malformed schemes, and disallowed protocols are rejected; surrounding whitespace is trimmed. `javascript:` and `vbscript:` cannot be enabled. URL userinfo requires the explicit `allowCredentials: true` opt-in; that flag does not control browser cookies or fetch credentials, which remain the host's responsibility through image presentation and loading policy. Other custom schemes are supported when named explicitly. Rejected imported links keep their label as unlinked text, while rejected images are removed; accepted absolute URLs may be canonicalized by the browser URL parser.

The public default constants are `DEFAULT_LINK_PROTOCOLS`, `DEFAULT_IMAGE_PROTOCOLS`, `DEFAULT_IMAGE_DATA_MIME_TYPES`, `DEFAULT_MAX_DATA_URL_BYTES`, and `DEFAULT_MAX_DATA_URL_CHARACTERS`.

This is the supported entry-path contract, not a sandbox around raw ProseMirror. `editor.view` and trusted extension plugins can construct arbitrary transactions outside the typed link/image APIs. Runtime open/load checks still deny an unsafe built-in destination, but hosts and extension authors must not use raw transactions to persist unvalidated URL attrs.

### Resolve, open, and load hooks

Stored Markdown remains stable when the host needs tenant-aware, signed, or authenticated display URLs:

```ts
const editor = createEditor({
  element: hostElement,
  markdown: "[Guide](docs/guide)\n\n![Diagram](asset:diagram-42)",
  resources: {
    links: {
      allowedProtocols: ["https:", "docs:"],
    },
    images: {
      allowedProtocols: ["https:", "asset:"],
      allowRelative: false,
      crossOrigin: "anonymous",
      referrerPolicy: "same-origin",
    },
    resolveUrl({ kind, purpose, url }) {
      return resolveStoredResource({ kind, purpose, storedUrl: url });
    },
    openUrl({ event, kind, storedUrl, url }) {
      openHostResource({ event, kind, storedUrl, resolvedUrl: url });
    },
    async loadImage({ signal, storedUrl, url }) {
      const response = await fetch(url, { signal, credentials: "include" });
      if (!response.ok) return null;
      return {
        src: await response.blob(),
        cleanup: () => releaseImageLease(storedUrl),
      };
    },
  },
});
```

`resolveUrl({ kind, purpose, url })` is synchronous. It receives the sanitized stored URL and a purpose of `"load"` or `"open"`, and returns a candidate runtime URL or `null` to deny the action. The returned string is sanitized again against the same kind-specific policy and is never written back to Markdown.

Ctrl/Cmd-click on a link or image resolves it with purpose `"open"`. `openUrl` then runs synchronously with the original `MouseEvent`, resource kind, stored URL, and resolved URL, preserving the browser user-activation window. Without the hook, Markora uses `window.open(url, "_blank", "noopener,noreferrer")`. A denied or rejected URL is still consumed and is not passed to browser navigation.

Every image resolves with purpose `"load"`. `loadImage` may return a result, `null`, or a promise of either. `null` is an intentional denial. A result supplies `src: string | Blob` and may override `crossOrigin` and `referrerPolicy` or provide `cleanup()`. String results are policy-checked again. Blob results use a Markora-owned object URL, which Markora revokes automatically. The request's `AbortSignal` aborts when the source becomes stale or the NodeView is destroyed; stale async results are ignored. Host cleanup and object-URL revocation each run once when the accepted result is replaced or destroyed, and a stale result's cleanup still runs once.

During the active lifecycle, thrown/rejected resolver, opener, loader, and cleanup failures produce a recoverable `error` event with code `"resource-callback-failed"` and `context.phase` equal to `"resolve"`, `"open"`, `"load"`, or `"cleanup"`. A cleanup failure encountered inside `destroy()` instead joins the teardown error/aggregate while later cleanup still runs. Intentional `null` denial is not an error. Without an error subscriber, active callback failures reach the editor window's global error reporting path.

### File upload contract

File-bearing paste, dragover, and drop are consumed so the browser cannot navigate or insert a local file. They start uploads only when `resources.assets` is present:

```ts
const editor = createEditor({
  element: hostElement,
  resources: {
    assets: {
      allowedMimeTypes: ["image/*", "application/pdf"],
      maxFileBytes: 20 * 1024 * 1024,
      maxFiles: 5,
      async upload({ file, id, reportProgress, signal, source }) {
        const storedUrl = await uploadAsset(file, {
          id,
          onProgress: reportProgress,
          signal,
          source,
        });

        return file.type.startsWith("image/")
          ? { kind: "image", url: storedUrl, alt: file.name }
          : { kind: "link", url: storedUrl, label: file.name };
      },
    },
  },
});

const stopAssets = editor.subscribe("asset", ({ reason, upload }) => {
  updateAccessibleUploadUi(reason, upload);
});
```

The default upload limits are the five raster image MIME types above, 10,485,760 bytes per file, and 10 files per transfer. `allowedMimeTypes` accepts exact values plus subtype and global wildcards such as `image/*` and `*/*`; an empty `File.type` is rejected. `maxFileBytes` and `maxFiles` are positive integers, `maxFiles` cannot exceed 100, and a batch exceeding the count is rejected as a whole before individual MIME/size checks. `DEFAULT_ASSET_MIME_TYPES`, `DEFAULT_MAX_ASSET_FILE_BYTES`, and `DEFAULT_MAX_ASSET_FILES` expose these defaults.

The frozen upload request contains the `File`, stable upload `id`, transfer `source` (`"paste"` or `"drop"`), a per-attempt `AbortSignal`, and `reportProgress(number)`. Progress must be finite and inclusive from 0 through 1. Reporting progress emits an asset event but does not dispatch a ProseMirror transaction or serialize Markdown. The upload may complete synchronously or asynchronously and returns either an image result (`url`, optional `alt`/`title`) or a link result (`url`, optional `label`/`title`). URLs pass through the corresponding stored policy; omitted image alt text and link labels default to the file name, with `"Uploaded file"` used when a link has neither a label nor a non-empty file name.

Subscribe to `"asset"` for reasons `"started"`, `"progress"`, `"failed"`, `"retried"`, `"completed"`, `"cancelled"`, and `"rejected"`. Each event contains an immutable file/upload snapshot and a status of `"uploading"`, `"failed"`, `"completed"`, `"cancelled"`, or `"rejected"`. Failure codes distinguish `file-too-large`, `insertion-blocked`, `invalid-result`, `too-many-files`, `unsupported-file-type`, and `upload-failed`.

`editor.assets.getUploads()` returns current uploading and failed snapshots. `cancel(id)` aborts and removes a retained upload; `retry(id)` gives a failed upload a new signal while retaining its ID and mapped insertion anchor. Both return `false` when the requested transition is unavailable and throw on non-string IDs. These methods and `getUploads()` follow the normal destroyed-editor contract.

A multi-file transfer waits until every remaining member succeeds, then inserts all results in original transfer order through one `"user"` transaction and one undo step. Async completion does not steal focus. The insertion anchor maps through intervening editor and reconciliation transactions. If one member fails, successful members remain pending; retry the failure, or cancel it to allow the remaining ready members to commit together. Invalid results and anchors that no longer accept the returned nodes fail without partially inserting the batch.

Starting a transfer while read-only or during composition produces rejected snapshots and never calls the uploader. If completion is blocked because the editor became read-only or composing, uploads remain failed and can be retried after it becomes editable and non-composing; other insertion-blocked errors can require cancellation or host recovery. `resetMarkdown()` and its deprecated alias abort retained uploads and emit `"cancelled"`; `reconcileMarkdown()` preserves and maps them; `destroy()` aborts them silently before subscriptions are cleared. The outer ProseMirror surface owns this upload flow. Nested CodeMirror blocks always reject files and remain plain-text clipboard surfaces, even when assets are configured.

Core is headless: it exposes no upload toast, live region, progress bar, retry button, or confirmation UI. A conforming host must announce meaningful failures/completion, expose labelled cancel/retry controls, avoid noisy announcements for every progress tick, and keep status available without relying on color alone. The host also owns authentication prompts, privacy consent, offline policy, and upload persistence.

## Extensions and the minimal entry

The root entry uses Markora's compatibility preset, preserving tables, tasks,
strike-through, opaque source, CodeMirror fences, and the existing optional UI
adapter. Add public extensions with the `extensions` option; definitions are
validated and compiled before the host element is claimed.

Extension packages should define their schema, Markdown codec, commands, state,
plugins, NodeViews, clipboard behavior, and headless UI actions through
`markora/extension-api`. That entry also re-exports the supported Markdown-it
and ProseMirror constructors so packages do not accidentally install duplicate
runtime identities. Published extensions should peer-depend on a compatible
`markora` version.

Extension contexts receive a frozen public codec facade containing only the
final schema plus `parse()` and `serialize()`. State queries are observational:
attempting to dispatch directly or through `runCommand()` while a query is
running throws an attributed extension error. Keeping captured extension
storage unchanged inside a query remains the extension author's responsibility.

Clipboard contributions can target the outer ProseMirror editor,
`nested-code` CodeMirror editors, or `both`. Nested code is a plain-text
surface: consumed paste/drop handlers run before ordered HTML-to-text and text
transforms, while read-only and file policy always run first. The configured
asset hook owns files in the outer editor; nested code always rejects them. It has
no ProseMirror `Slice` stage, so a `slice` transform cannot target only
`nested-code`; with `surface: "both"`, that slice transform runs outer-only.

```ts
import { createEditor } from "markora/minimal";
import { defineMarkdownEditorExtension } from "markora/extension-api";
import "markora/minimal.css";

const extension = defineMarkdownEditorExtension({
  name: "@acme/counter",
  version: "1.0.0",
  compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
  createStorage: () => ({ count: 0 }),
  createRuntime: ({ storage }) => ({
    commands: {
      increment: () => {
        storage.count += 1;
        return true;
      },
    },
    state: { count: () => storage.count },
  }),
});

const editor = createEditor({
  element: hostElement,
  extensions: [extension],
  markdown: "Small by default",
});

editor.extensions.get(extension).commands.increment();
console.log(editor.extensions.manifest);
```

`markora/minimal` is a separate static bundle graph. It keeps the CommonMark
document foundation, basic editing, lifecycle policy, events, history, links,
images, and the extension kernel, while omitting tables, tasks, strike-through,
opaque source, CodeMirror, and the default UI. Fenced code remains editable as a
plain ProseMirror code block. Compatibility-only options such as `ui`,
`codeBlockLanguages`, and `onEditOpaqueMarkdown` have no built-in surface in
this entry. Passing `createMinimalMarkdownEditorPreset()` to the root entry
selects minimal runtime behavior, but only importing `markora/minimal` provides
the static JavaScript bundle-isolation guarantee. Pair that entry with
`markora/minimal.css` to omit compatibility-only table, task, opaque-source,
and CodeMirror selectors as well;
`markora/styles.css` remains the compatibility-full stylesheet.

The definitions inside `createDefaultMarkdownEditorPreset()` name adapters
owned by the root compatibility runtime. The exact preset works with the root
entry; copying those definitions into an anonymous preset or passing them to
`markora/minimal` throws `EXTENSION_INCOMPATIBLE` instead of publishing a
manifest for behavior that is not active.

Extension sets are creation-only. Persist `editor.extensions.manifest` beside
Markdown that depends on non-default syntax, and destroy/recreate the editor to
change definitions or configuration. The complete versioning, ordering,
ownership, lifecycle, security, and persistence contract is documented in the
repository's extension-system RFC.

## Integration notes

A typical integration has four parts:

- import `createEditor` from `markora`
- import `markora/styles.css`
- optionally pass `ui: createDefaultUi()` from `markora-ui`
- destroy the editor instance when the host view unmounts

Host-facing behavior to keep in mind:

- `ariaLabel` or `ariaLabelledBy` gives the inner editor a host-specific accessible name
- compatibility task items expose a stable native button with checkbox semantics, a task-text accessible name, separate checked state, exact-once Space/Enter activation, and native disabled behavior in read-only mode
- `editor.focus()` targets the outer ProseMirror surface; `editor.blur()` blurs whichever owned ProseMirror or CodeMirror surface is active, and lazy activation or boundary-exit work does not reclaim focus after that blur or after a host control takes it
- `editor.commands.reconcileMarkdown(markdown)` applies an authoritative host snapshot while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(markdown)` explicitly rebuilds editor state; deprecated `setMarkdown()` remains its hard-reset alias
- `editor.commands.pasteMarkdown(text)` and `pastePlainText(text)` give host-owned clipboard UI an explicit parsing choice without reaching through `editor.view`
- `editor.subscribe("state", ...)` refreshes host controls for every accepted state transition, including stored-mark-only changes; `update` remains the document-change-only signal and `onTransaction` the ProseMirror-aware compatibility hook
- `resources` configures stored and runtime URL policy, image loading/privacy, link opening, and optional paste/drop upload; `editor.assets` controls retained upload attempts
- `editor.subscribe("asset", ...)` drives host-owned progress, cancellation, retry, failure, and completion UI without polling Markdown
- `onEditOpaqueMarkdown` lets a host provide explicit source editing for otherwise read-only opaque atoms
- `onChangeMode` defaults to coalesced `"idle"` delivery; `"animationFrame"` and `"immediate"` retain their explicit legacy timing
- `editor.getMarkdown()` is a lazy synchronous save/export snapshot, and `editor.flushChange()` forces pending `onChange` work to run immediately
- the package ships editor base styles, while surrounding layout and product UI remain the host app's responsibility

## Markdown snapshots and change delivery

`editor.getMarkdown()` is the explicit synchronous snapshot boundary. It serializes the latest document on demand, then reuses that string until the document changes. Calling it from a synchronous `update` listener is supported, but deliberately puts full-document serialization back into the typing path; use the event itself for dirty flags, toolbar state, indexing queues, and other work that does not need Markdown yet.

`onChange(markdown, context)` remains the convenience path for normalized output. Its delivery mode is a `MarkdownEditorChangeMode`:

- `"idle"` is the default. It waits for a 300 ms trailing quiet period, coalesces every intervening change, and serializes the latest pending document outside the synchronous state-update path. A five-second deadline measured from the first pending change prevents indefinite starvation during continuous input.
- `"animationFrame"` preserves the previous once-per-frame batching behavior.
- `"immediate"` serializes and invokes the callback in the same stack as the accepted change. Use it only when that timing is required.

Pending delivery always keeps the latest document and change origin. A changed authoritative reconciliation or reset cancels stale local output; a semantic reconciliation no-op preserves it. Changing `onChange` or `onChangeMode` through `updateOptions()` first flushes pending output through the old configuration.

Form submission, an explicit Save action, export, and other boundaries that must observe current data can flush synchronously:

```ts
form.addEventListener("submit", () => {
  editor.flushChange();
  markdownField.value = editor.getMarkdown();
});
```

`flushChange()` delivers a pending callback at most once; `getMarkdown()` returns the latest snapshot whether or not an `onChange` callback is configured. `destroy()` performs the same final flush and caches the latest Markdown before releasing editor resources, so `getMarkdown()` remains available after teardown.

## Commands and state

The headless command surface operates on the current model selection; a host does not need to inspect or mutate ProseMirror state directly.

| Area | Commands | Activity checks |
| --- | --- | --- |
| Host Markdown | `reconcileMarkdown`, `resetMarkdown`, deprecated `setMarkdown` | — |
| Clipboard | `pasteMarkdown`, `pastePlainText` | `pasteMarkdown`, `pastePlainText` |
| Inline and media | `toggleMark`, `setLink`, `removeLink`, `insertImage`, `removeImage` | `mark`, generic `node` |
| Text and blocks | `setParagraph`, `setHeading`, `toggleBlockquote`, `insertHardBreak`, `insertHorizontalRule`, `setCodeBlock` | `paragraph`, `heading`, `blockquote`, `hardBreak`, `horizontalRule`, `codeBlock`, generic `node` |
| Lists and tasks | `toggleBulletList`, `toggleOrderedList`, `sinkListItem`, `liftListItem`, `toggleTaskList`, `setTaskChecked` | `bulletList`, `orderedList`, `taskList`, `taskChecked`, generic `node` |
| Tables | `insertTable`, `addTableRow`, `addTableColumn`, `deleteTableRow`, `deleteTableColumn`, `setTableColumnAlignment`, `deleteTable` | `table`, `tableColumnAlignment`, generic `node` |
| History | `undo`, `redo` | — |

Every interactive Boolean command has a same-named `editor.state.can.*` check. Link and image capability checks take no payload because they test only whether the current selection can accept the operation. `editor.state.isActive.*` is observational: use the specialized checks in the table, `isActive.mark(mark)` for `"strong"`, `"em"`, `"code"`, `"strike"`, or `"link"`, and `isActive.node(node)` for a generic node query.

Here is a compact host-toolbar pattern:

```ts
const quoteButton = document.querySelector<HTMLButtonElement>("#quote");
const undoButton = document.querySelector<HTMLButtonElement>("#undo");

if (!quoteButton || !undoButton) {
  throw new Error("Toolbar buttons not found.");
}

function renderToolbar() {
  quoteButton.setAttribute("aria-pressed", String(editor.state.isActive.blockquote()));
  quoteButton.disabled = !editor.state.can.toggleBlockquote();
  undoButton.disabled = !editor.state.can.undo();
}

quoteButton.addEventListener("click", () => editor.commands.toggleBlockquote());
undoButton.addEventListener("click", () => editor.commands.undo());

const stopToolbar = editor.subscribe("state", renderToolbar);
renderToolbar();
```

The command contract is designed for toolbar and keyboard integrations:

- `state.can.*` performs a pure dry run. It does not dispatch, focus, add history, or emit an event. It returns `false` in read-only mode, while an IME composition is active, when a feature is absent, when the selection is inapplicable, or when the operation would be a no-op.
- `state.isActive.*` remains available and accurate in read-only mode and during composition.
- A successful interactive command focuses the outer editor. A successful built-in interactive document-changing command other than undo/redo is one transaction with origin `"command"` and contributes one undoable history step. A successful stored-mark-only command emits `state` with `docChanged: false` and does not emit `update`.
- A command that returns `false` does not focus the editor, mutate history, or emit state/update/change activity. Invalid programmer arguments still throw instead of returning `false`: heading levels are integers from 1 through 6; table dimensions are integers from 1 through 100; task values are Boolean; alignments are `"left"`, `"center"`, `"right"`, or `null`; and a code-block language is a string or `null`, trimmed on input, with a normalized limit of 128 characters and no line break or backtick.

The root compatibility preset supports tasks and tables. Tasks are deliberately flat: task items are direct bullet-list children, new tasks are unchecked, and `sinkListItem()`/`liftListItem()` return `false` for them rather than creating unsupported nesting. `setTaskChecked(checked)` applies only to task items and returns `false` when the item is already in the requested state.

`insertTable()` defaults to three columns and two total rows, including the header row. Its `rows` and `columns` options accept integers from 1 through 100; a one-row table contains only its header. Column alignment is `"left"`, `"center"`, `"right"`, or `null`, where `null` restores the default alignment.

`markora/minimal` and the root entry with `createMinimalMarkdownEditorPreset()` expose the same typed methods, so shared host toolbar code does not need a different interface. Because tasks and tables are absent from that schema, their commands and matching `can`/`isActive` checks consistently return `false`. The minimal preset still supports paragraphs, headings, blockquotes, ordinary bullet and ordered lists (including indent/lift), hard breaks, horizontal rules, and plain code blocks.

## Reconciled updates and hard resets

Use reconciliation for ordinary controlled-component or server-driven updates:

```ts
const changed = editor.commands.reconcileMarkdown(nextMarkdown);
```

The incoming string is parsed before comparison. If its parsed document is semantically equal to the current document, `reconcileMarkdown()` returns `false`, dispatches no transaction, preserves any pending batched local output, and does not emit state/selection/update events. Otherwise it returns `true` and applies one non-history transaction. The current selection and history are mapped through the change, plugin state is preserved, and pending idle or animation-frame `onChange` output is cancelled so stale local Markdown cannot fire afterward. Disjoint local history remains usable; an entry overlapping replaced content can map to a no-op or be consumed. Reconciliation works while `editable` is `false` and is silent by default; pass `{ emitChange: true }` only when the host intentionally wants `onChange` to receive the authoritative value again.

Reconciliations are synchronous and ordered by invocation. Each call is a complete, authoritative document snapshot, so the last changed call wins when updates overlap. Markora does not merge snapshots, track revisions, or reject stale responses. Hosts with asynchronous reads or writes must gate stale revisions before calling `reconcileMarkdown()`.

`resetMarkdown(markdown, { emitChange? })` is intentionally stronger: it replaces EditorState, resets the selection to the new document default, clears undo/redo and plugin state, and cancels pending batched output. It bypasses `onTransaction` because state replacement does not create a ProseMirror transaction. A `state` event and any applicable selection/update events report origin `"reset"`, and `{ emitChange: true }` emits normalized Markdown with that origin. Use it for switching documents or deliberately discarding transient state. `setMarkdown()` is deprecated but remains an exact hard-reset alias.

## Change origins

Markora identifies dispatched and accepted activity with a `MarkdownEditorChangeOrigin`:

- `"user"` for DOM input and otherwise untagged raw transactions;
- `"command"` for built-in formatting, history, and media commands;
- `"external"` for `reconcileMarkdown()`;
- `"reset"` for state replacement through `resetMarkdown()` or its deprecated alias;
- `` `extension:${string}` `` for a transaction deliberately tagged by a host extension.

`onChange(markdown, context)` exposes the origin in its second argument. `onTransaction(transaction, view, context)` exposes it in its third argument and observes dispatch attempts after editor policy has run; inspect the resulting view state or typed events rather than treating the callback alone as proof of a document change. State, selection, and update subscription events have an `origin` field and describe accepted state changes. In idle and animation-frame modes, coalesced output reports the origin of the latest pending document change.

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
- `resources?: MarkdownEditorResourceOptions` sets the immutable per-editor URL, image, navigation, and upload policy described above.

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

The method accepts `editable`, `placeholder`, `attributes`, `ariaLabel`, `ariaLabelledBy`, `onChange`, `onTransaction`, `onChangeMode`, and `onEditOpaqueMarkdown`. Nullable fields clear their current value. `onChangeMode` accepts `"idle"` (the default), `"animationFrame"`, or `"immediate"`. Changing `onChange` or `onChangeMode` first flushes pending output once through the previous listener, then installs the new listener/mode. Callback and presentation changes do not rebuild EditorState or emit an `update` event.

`element`, `markdown`, `initialSelection`, the autofocus action, `ui`, `codeBlockLanguages`, `resources`, `extensionPreset`, and `extensions` are creation-only. Use `commands.reconcileMarkdown()` for ordinary host snapshots or `commands.resetMarkdown()` for an explicit state replacement.

## Typed events

`subscribe()` accepts `"focus"`, `"blur"`, `"state"`, `"selection"`, `"update"`, `"asset"`, or `"error"` and returns an idempotent unsubscribe function:

```ts
const stopState = editor.subscribe(
  "state",
  ({ docChanged, origin, selection, selectionChanged }) => {
    syncHostControls(editor.state, { docChanged, origin, selection, selectionChanged });
  },
);

const stopSelection = editor.subscribe("selection", ({ origin, previousSelection, selection }) => {
  console.log(origin, previousSelection.from, selection.from);
});

const stopUpdates = editor.subscribe("update", ({ origin, selection }) => {
  markDocumentDirty(selection, { origin });
});

const stopAssets = editor.subscribe("asset", ({ reason, upload }) => {
  updateAccessibleUploadUi(reason, upload);
});

const stopErrors = editor.subscribe("error", ({ code, context, error, recoverable }) => {
  if (code === "code-block-language-load-failed") {
    reportLanguageFailure(context.language, error, recoverable);
  } else if (code === "code-block-runtime-load-failed") {
    reportCodeEditorFailure(context.language, error, recoverable);
  }
});
```

- Focus and blur events expose `nativeEvent`. The focus boundary includes the outer ProseMirror surface and nested CodeMirror editors, so moving between them does not create a false blur/focus pair. Both events cross one microtask boundary: focus waits for the browser and nested editor's focus stack to finish, while blur waits until the next focused element can be checked.
- State events fire synchronously for every accepted state transition, including stored-mark-only formatting and hard resets. They expose `origin`, the current `selection`, `docChanged`, and `selectionChanged`; subscribe to this event to keep host toolbars current.
- Selection events provide `previousSelection`, `selection`, and `origin`. Each host snapshot contains `anchor`, `head`, `from`, `to`, `empty`, and `kind`.
- State, selection, and update events are ordered state first, then selection when the selection changed, then update when the document changed. Update events contain the accepted change's `origin` and current selection, neither Markdown nor a ProseMirror transaction, and are not affected by `onChangeMode`; call `event.editor.getMarkdown()` only when that subscriber intentionally needs a synchronous snapshot.
- Asset events report upload lifecycle independently of ProseMirror state; only successful batch insertion subsequently produces ordinary state/update/change activity.
- Error events report recoverable code-runtime-load, code-language-load, and resource-callback failures plus attributed extension runtime failures. A code-runtime failure leaves the exact static source shell usable and reports phase `"runtime"`. Resource events use code `"resource-callback-failed"` with a resolve/open/load/cleanup phase. Extension events use an `EXTENSION_*` code plus `context.phase` and, when known, `context.extension`, `context.contribution`, or `context.participants`. Runtime activation, language loaders, and extensions run outside the current editor state update, so deferred failures use the same event path without re-entering that update.

If a recoverable runtime failure has no error subscriber, Markora forwards it to the editor window's global error reporting path rather than silently swallowing it.

Migration note: hosts with exhaustive `MarkdownEditorErrorCode` switches must
handle the new `"code-block-runtime-load-failed"` case. It means advanced code
editing could not activate; the Markdown document and static code source remain
available.

`onChange` and `onTransaction` remain supported. Use the default idle `onChange(markdown, context)` for coalesced normalized Markdown output, `state` for host UI, `update` for a cheap document-only signal, and `onTransaction(transaction, view, context)` only when an advanced integration needs ProseMirror transaction details.

## Destruction and post-destroy behavior

`destroy()` synchronously serializes and caches the latest document, flushes one pending idle or animation-frame `onChange`, aborts image loads and uploads, runs accepted image-result cleanup, tears down the editor, nested code editors, optional UI, listeners, and subscriptions, and completes cleanup even when a teardown callback reports an error. Upload cancellation is silent during teardown. It is idempotent.

After destruction:

- `editor.isDestroyed` is `true`.
- `editor.getMarkdown()` returns the cached final Markdown.
- `editor.flushChange()`, repeated `destroy()`, and unsubscribe functions returned before destruction are no-ops.
- Every other high-level call throws `MarkdownEditorDestroyedError`.
- `editor.view` refers to the destroyed raw ProseMirror view and must not be used.

## Advanced `view` escape hatch

`editor.view` remains available for version-coupled integrations. State/DOM inspection and `view.dispatch()` are supported as advanced usage. Direct `view.setProps()`, `view.updateState()`, DOM mutation, or `view.destroy()` can bypass lifecycle guards, configuration, and typed events; those operations and ProseMirror internals are outside Markora's semver compatibility boundary.

### Migration note

Existing one-argument `onChange` and two-argument `onTransaction` callbacks remain source-compatible because the context parameters are trailing. Omitted `onChangeMode` now selects `"idle"`; integrations that require the previous same-stack callback and exception behavior must set `onChangeMode: "immediate"`, while those requiring the prior once-per-frame batching can set `"animationFrame"`. `setMarkdown()` remains callable but is deprecated; replace it with `resetMarkdown()` when the hard reset was intentional, or with `reconcileMarkdown()` for ordinary controlled/external updates. Prefer `editor.focus()`, `editor.blur()`, `editor.updateOptions()`, and typed subscriptions over direct view mutation. Integrations that hand-build structural `MarkdownEditor` mocks must add the new commands and lifecycle members or type the mock as `Pick<MarkdownEditor, ...>`.

The unified resource policy preserves the prior rejection of protocol-relative and unlisted schemes while intentionally tightening other URL behavior. Existing documents or commands that depend on embedded credentials, backslashes, embedded whitespace/control characters, unrestricted image `data:` forms, or data payloads above the published limits now lose the unsafe link mark or image at an import/insertion boundary. Configure explicit custom protocols, credential opt-in, MIME types, and limits only after reviewing the host threat model. `javascript:` and `vbscript:` remain impossible to enable. Integrations that structurally mock `MarkdownEditor` must also add `assets`, and event-name switches must handle `"asset"` plus resource callback errors.

## Exports

```ts
import {
  DEFAULT_ASSET_MIME_TYPES,
  DEFAULT_IMAGE_DATA_MIME_TYPES,
  DEFAULT_IMAGE_PROTOCOLS,
  DEFAULT_LINK_PROTOCOLS,
  DEFAULT_MAX_ASSET_FILE_BYTES,
  DEFAULT_MAX_ASSET_FILES,
  DEFAULT_MAX_DATA_URL_BYTES,
  DEFAULT_MAX_DATA_URL_CHARACTERS,
  createDefaultCodeBlockLanguageRegistry,
  createDefaultMarkdownEditorPreset,
  createEditor,
  createMinimalMarkdownEditorPreset,
  defineMarkdownEditorExtension,
  defineMarkdownEditorPreset,
  getMarkdownEditorTransactionOrigin,
  MARKORA_EXTENSION_API_VERSION,
  MarkdownEditorDestroyedError,
  MarkdownEditorExtensionError,
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
  MarkdownEditorAssets,
  MarkdownEditorAssetEvent,
  MarkdownEditorAssetEventReason,
  MarkdownEditorAssetFileSnapshot,
  MarkdownEditorAssetInsertionKind,
  MarkdownEditorAssetTransferKind,
  MarkdownEditorAssetUploadError,
  MarkdownEditorAssetUploadErrorCode,
  MarkdownEditorAssetUploadOptions,
  MarkdownEditorAssetUploadRequest,
  MarkdownEditorAssetUploadResult,
  MarkdownEditorAssetUploadSnapshot,
  MarkdownEditorAssetUploadStatus,
  MarkdownEditorBlurEvent,
  MarkdownEditorBuiltinChangeOrigin,
  MarkdownEditorChangeMode,
  MarkdownEditorChangeContext,
  MarkdownEditorChangeOrigin,
  MarkdownEditorCodeBlockOptions,
  MarkdownEditorCommands,
  MarkdownEditorDomAttributes,
  MarkdownEditorErrorCode,
  MarkdownEditorErrorEvent,
  MarkdownEditorEventListener,
  MarkdownEditorEventMap,
  MarkdownEditorEventName,
  MarkdownEditorFocusEvent,
  MarkdownEditorHeadingLevel,
  MarkdownEditorExtensionOrigin,
  MarkdownEditorMark,
  MarkdownEditorMarkdownUpdateOptions,
  MarkdownEditorImageLoadRequest,
  MarkdownEditorImageLoadResult,
  MarkdownEditorImagePolicy,
  MarkdownEditorOpenUrlRequest,
  MarkdownEditorResolveUrlRequest,
  MarkdownEditorResourceErrorEvent,
  MarkdownEditorResourceErrorPhase,
  MarkdownEditorResourceKind,
  MarkdownEditorResourceOptions,
  MarkdownEditorResourcePurpose,
  MarkdownEditorSelectionEvent,
  MarkdownEditorSelectionKind,
  MarkdownEditorSelectionSnapshot,
  MarkdownEditorSelectionTarget,
  MarkdownEditorState,
  MarkdownEditorStateEvent,
  MarkdownEditorTableAlignment,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorUi,
  MarkdownEditorUnsubscribe,
  MarkdownEditorUpdateEvent,
  MarkdownEditorUrlPolicy,
  OpaqueMarkdownEditRequest,
  OpaqueMarkdownKind,
  ToolbarButtonState,
  ToolbarState,
  UpdateEditorOptions,
} from "markora";
```

## Code block languages

The compatibility entry initially renders every fence as an exact, lightweight source-text shell with its language label and line numbers. This permanent shell stays selectable, copyable, searchable, and synchronized with the ProseMirror document without loading CodeMirror. A shared per-editor viewport observer keeps the settled CodeMirror pool bounded to eight editors near the viewport. Placing a caret or starting an edit in an inactive fence also activates it; a native range selection remains on the shell so drag selection and copy are not disrupted. An offscreen editor returns to its shell after a short idle delay when it no longer owns focus, selection, or composition. Browsers without `IntersectionObserver` retain the shell and activate on caret or edit interaction.

The inactive shell deliberately presents plain source rather than running a second syntax engine. Syntax highlighting and advanced code editing begin when the CodeMirror runtime activates. The runtime is outside the compatibility entry's initial JavaScript graph, and the built-in grammars for JavaScript, TypeScript, JSON, CSS, HTML, XML, Markdown, Python, C/C++, Java, Rust, and shell remain separate on-demand chunks. You can add or override a grammar with `codeBlockLanguages`:

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

Markora invokes language loaders only after a block activates and installs their CodeMirror extensions after the current outer-editor update completes. Multiple blocks in the same editor share the cached result for a language. A block removed, deactivated, or superseded before deferred work starts does not apply stale support. Runtime chunk/construction failures emit `"code-block-runtime-load-failed"`; grammar failures emit `"code-block-language-load-failed"`. Both are recoverable error events and leave exact plain source available.

## API highlights

- `editor.getMarkdown()` returns the current normalized Markdown serialization
- `onChangeMode` defaults to coalesced `"idle"` delivery; `"animationFrame"` and `"immediate"` remain explicit alternatives
- `editor.flushChange()` synchronously drains pending callback output for submit/save boundaries and teardown does so automatically
- `editor.commands.reconcileMarkdown(markdown, { emitChange })` applies an authoritative snapshot while mapping selection/history and preserving plugin state
- `editor.commands.resetMarkdown(markdown, { emitChange })` explicitly rebuilds EditorState; `setMarkdown()` remains a deprecated hard-reset alias
- change callbacks, transaction callbacks, and state/selection/update events expose a typed origin
- `onEditOpaqueMarkdown` receives an opaque atom's `kind`, exact `source`, and guarded `update(nextSource)` function
- `editor.commands` covers inline/media editing, paragraphs and headings, blockquotes, ordinary and task lists, breaks and rules, code blocks, tables, and undo/redo
- `editor.state.can.*` and `editor.state.isActive.*` expose host-friendly capability and activity checks
- `editor.getToolbarState()` remains available for toolbar integrations that prefer a compatibility snapshot
- `editor.ui?.editLink()` and `editor.ui?.editImage()` are the optional namespaced UI entry points when overlays are attached
- `CreateEditorOptions.resources` owns URL/image/navigation/upload policy and `editor.assets` exposes upload cancellation, retry, and snapshots
- `editor.subscribe(...)` exposes typed focus, blur, state, selection, update, asset, and recoverable error events
- `editor.updateOptions(...)` updates dynamic presentation, editable state, and callbacks without rebuilding EditorState
- `editor.destroy()` performs idempotent teardown and exposes its state through `editor.isDestroyed`

## Development

- `pnpm dev` starts the core watcher and demo site together
- `pnpm pack:smoke` verifies the packed `markora` and `markora-ui` tarballs, public extension declarations, and independent root/minimal bundle graphs in a tiny Vite consumer app
- `pnpm release:check` dry-runs the core npm tarball and then runs the packed-consumer smoke test
- `pnpm check` builds the workspace, runs typechecks, executes API type tests, smoke-tests Node ESM imports, and runs the shared test suite
