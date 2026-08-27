# markora

Write Markdown at the speed of thought, inside your product.

`markora` is a headless, embedded Markdown editor toolkit built with ProseMirror and CodeMirror. It provides Typora-style editing while the host application owns mounting, persistence, product chrome, network access, and security policy. Markora parses a documented Markdown dialect into an editable ProseMirror document and serializes supported content to a predictable canonical form.

## Features

- Semantic import/edit/export for the documented Markdown dialect, with normalized serialization
- Exact, inert source preservation for valid link-reference definitions and conservatively recognized front matter, display math, HTML, and directives
- Headings, blockquotes, lists, task items, images, code fences, and pipe tables
- Inline marks for bold, italic, code, strike, and links
- Exact, lightweight source-text code-fence shells with viewport-lazy CodeMirror editing
- Lazy-loaded CodeMirror runtime and built-in languages with host-extensible loaders
- Toolbar-friendly commands for formatting, links, images, mature table workflows, clipboard modes, and undo/redo
- Per-editor URL/image/navigation/upload policy plus managed navigation around tables and code blocks
- Reconciled host updates, idle Markdown delivery, deterministic reset, and complete teardown semantics
- Creation-time extension composition with seven official optional syntax packages
- Localized, RTL-aware, themeable, keyboard-accessible embedded interactions

## Markdown compatibility

`markdown`, `editor.commands.reconcileMarkdown()`, and `editor.commands.resetMarkdown()` are parsing boundaries. `editor.getMarkdown()` and `onChange` return normalized serialization, not the original document bytes. With the root entry's exact default compatibility preset, Markora retains valid CommonMark link-reference definitions plus conservatively recognized front matter, standalone display math, HTML, comments, and directives as inert source atoms. Reference uses still normalize to inline links, while unused and duplicate definition source no longer disappears. Other unsupported extensions may still be reinterpreted without an error. Official extension packages claim their documented forms and give them semantic behavior. Deprecated `setMarkdown()` has the same hard-reset behavior as `resetMarkdown()`.

Read the complete [Markdown dialect and fidelity contract](./MARKDOWN_COMPATIBILITY.md), which is also included in the published package.

Opaque HTML is displayed as text and never executed inside the editor. Serialized Markdown still contains that source, so downstream HTML rendering must apply its own sanitization.

## Install

```bash
npm install markora

# Optional link, image, code-fence metadata, and table overlays
npm install markora-ui
```

## Quick start

```ts
import { createEditor } from "markora";
import "markora/styles.css";

const hostElement = document.querySelector<HTMLElement>("#editor");

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

`markora` is headless by default. Add `markora-ui` when you want the repo's built-in link, image, and code-fence metadata editors plus the table-creation/dimension dialog and table toolbar overlays. `editor.ui.createTable()` opens the creation dialog. The toolbar exposes before/after insertion, row/column movement and deletion, automatic/left/center/right alignment, exact logical resizing, and table deletion; Alt+F10 or `editor.ui.editTable()` moves focus into it from an active table. Hosts can use the same command surface without this package, including `insertTable()` and `resizeTable()`.

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
2. Explicit plain paste, including Ctrl/Cmd-Shift-V, uses `text/plain` literally. URL- and email-shaped text receives a minimal canonical backslash escape so reset cannot silently promote it into an autolink.
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

A rectangular table-cell selection has an explicit matrix contract. `text/plain` is TSV, with cells containing tabs, line breaks, or quotes encoded using CSV-style double-quote escaping. `text/markdown` is a complete standalone GFM table; when a body-only rectangle is copied, its first selected row necessarily becomes the header of that clipboard table. HTML remains a semantic table slice. Cut clears the selected cells without removing their rows or columns. A pasted table or TSV matrix is clipped to a smaller selected rectangle or repeated across a larger one, and the resulting edit is one undo step. TSV table-text parsing is bounded to 1 MiB and 100 rows by 100 columns; a caret table-matrix paste is refused when it would exceed the 100-row or 100-column table bound.

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

### Official optional extensions

Install only the syntax required by the embedding product. None of these packages is included in the root or minimal graph by default, and each package stylesheet is an explicit import.

| Package | Semantic surface | Compatible entry | External runtime |
| --- | --- | --- | --- |
| [`markora-extension-frontmatter`](https://github.com/KevinWang15/markora/tree/main/packages/extension-frontmatter) | Exact-source YAML-like document-head blocks | Root and minimal | No YAML parser |
| [`markora-extension-footnotes`](https://github.com/KevinWang15/markora/tree/main/packages/extension-footnotes) | References, definitions, diagnostics, and navigation | Root and minimal | None |
| [`markora-extension-math`](https://github.com/KevinWang15/markora/tree/main/packages/extension-math) | Inline and block math | Root and minimal | Optional host renderer; no TeX engine |
| [`markora-extension-alerts`](https://github.com/KevinWang15/markora/tree/main/packages/extension-alerts) | GitHub-style alert blockquotes | Root and minimal | None |
| [`markora-extension-toc`](https://github.com/KevinWang15/markora/tree/main/packages/extension-toc) | Generated heading outline backed by `[TOC]` | Root and minimal | None |
| [`markora-extension-html`](https://github.com/KevinWang15/markora/tree/main/packages/extension-html) | Exact-source CommonMark HTML and bounded block previews | Root default runtime only | No HTML parser; previews require a host renderer and sanitizer |
| [`markora-extension-diagrams`](https://github.com/KevinWang15/markora/tree/main/packages/extension-diagrams) | Mermaid, GeoJSON, TopoJSON, and STL fences | Root and minimal | Optional host renderers; no diagram engine |

The HTML extension deliberately rejects `markora/minimal` and a root editor using a custom preset. Every other official package in the table supports both entries. Math, HTML, and diagrams stay fully usable in accessible source mode when no renderer callback is supplied.

Persist `editor.extensions.manifest` beside Markdown that depends on optional syntax, then restore compatible definitions before parsing that document again. The manifest records compatibility identity and ordering; host callbacks, messages, parsers, sanitizers, and renderer engines remain runtime configuration and are not serialized.

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

## Localization

Core-rendered text and accessible names are creation-time configuration through
`createEditor({ messages })`. This includes task fallback names, passive and
active code-block labels, image loading/policy/failure status, preserved-source
labels and actions, and the unnamed uploaded-file fallback.

```ts
import {
  createEditor,
  type MarkdownEditorMessageOverrides,
} from "markora";

const messages = {
  codeBlockPlainTextLabel: "texte brut",
  imageEmptyAltTextLabel: "Image sans texte alternatif",
  imageLoading: "Chargement de l’image",
  taskFallbackLabel: "Tâche",
  opaqueKindLabels: {
    frontmatter: "Métadonnées",
  },
  opaqueSourceLabel: ({ kindLabel }) => `Source Markdown : ${kindLabel}`,
} satisfies MarkdownEditorMessageOverrides;

const editor = createEditor({
  element: document.querySelector<HTMLElement>("#editor")!,
  markdown: "- [ ] À faire",
  messages,
});
```

The empty-alt label is exposed only for the image object inside the editable
authoring surface; stored Markdown and the image element's native `alt=""`
remain unchanged. `MarkdownEditorMessages` describes a complete locale,
`MarkdownEditorMessageOverrides` accepts a partial locale with English
fallback, and `defaultMarkdownEditorMessages` exposes the frozen English
defaults. Overrides and nested opaque-kind labels are validated, copied, and
frozen during creation; formatter results must be nonblank. Recreate the editor
to switch locale. Set `lang` and `dir` on the editor's DOM ancestry, and pass a
separate `createDefaultUi({ messages })` locale when using `markora-ui`.
User-authored Markdown, URLs, image metadata, code-fence info, and structured
developer diagnostics are not translated by this surface.

## Theme contract

Every color, type, spacing, radius, focus, motion, and overlay-layer value in
`markora/styles.css`, `markora/minimal.css`, and `markora-ui/styles.css` is
exposed through a documented `--mdw-*` custom property with its previous value
as the fallback. An integration that sets no tokens keeps the compatibility
appearance.

Import `markora/themes.css` to opt into the reference light, dark, automatic,
and higher-contrast palettes. Scope one with `data-mdw-theme="light"`,
`"dark"`, `"auto"`, or `"contrast"` (or the equivalent
`.mdw-theme-*` class). Reduced motion and forced colors are honored
automatically; `.mdw-motion-reduce` and `data-mdw-motion="reduce"` provide an
explicit reduced-motion scope.

Default UI mirrors the active editor's effective `--mdw-*` tokens, theme and
motion scope, color scheme, language, and direction onto body-portaled
overlays. A local `portalRoot` remains useful for host stacking, landmark, and
Shadow DOM ownership. See
the repository's [theme and visual-ownership contract](https://github.com/KevinWang15/markora/blob/main/docs/theme-contract.md)
for the full token table, Shadow DOM guidance, reference behavior, and the
core/default-UI/host responsibility boundary.

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
| Tables | `insertTable`, `addTableRow`, `addTableColumn`, `resizeTable`, `moveTableRow`, `moveTableColumn`, `deleteTableRow`, `deleteTableColumn`, `setTableColumnAlignment`, `deleteTable` | `table`, `tableCellSelection`, `tableColumnAlignment`, generic `node` |
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
- A command that returns `false` does not focus the editor, mutate history, or emit state/update/change activity. Invalid programmer arguments still throw instead of returning `false`: heading levels are integers from 1 through 6; table dimensions are integers from 1 through 100; table insertion sides are `"before"` or `"after"`; row directions are `"up"` or `"down"`; column directions are `"left"` or `"right"`; task values are Boolean; alignments are `"left"`, `"center"`, `"right"`, or `null`; and a code-block language is a string or `null`, trimmed on input, with a normalized limit of 128 characters and no NUL or line-break character. Backticks are legal in the complete fence info string; serialization uses a safe tilde fence for them.

The root compatibility preset supports tasks and tables. Ragged pipe-table source is expanded to its widest authored row on import, with blank cells added instead of discarding extra body cells; expansion is bounded at 65,536 synthesized cells. Task items may contain supported additional blocks and nested bullet or task lists. New tasks are unchecked; `sinkListItem()` and `liftListItem()` preserve checked state while an item remains in a list, and `setTaskChecked(checked)` applies only to task items and returns `false` when the item is already in the requested state.

`insertTable()` defaults to three columns and two total rows, including the header row. Its `rows` and `columns` options accept integers from 1 through 100; a one-row table contains only its header. `addTableRow(side)` and `addTableColumn(side)` default to `"after"`; for a rectangular cell selection they insert before its first row/column or after its last. Deleting, moving, or aligning applies to the selected contiguous rows or columns. Body rows can move without crossing the pinned header row, and columns carry their alignment with them.

`resizeTable({ rows, columns, discardContent })` changes logical row and column counts, not CSS or persisted pixel widths. Supply at least one target dimension. Growth adds empty cells while preserving existing alignments. Shrinking returns `false` if it would remove non-empty cells unless `discardContent: true` explicitly authorizes that data loss. A semantic no-op also returns `false`. Column alignment is `"left"`, `"center"`, `"right"`, or `null`, where `null` restores automatic/default alignment.

Cell rectangles can be selected by pointer drag, Shift-click from a table caret or existing cell selection, or Shift+Arrow at a cell boundary. Plain Arrow, Escape, Enter, or F2 collapses a cell rectangle back to a caret; Backspace/Delete clears its contents. Tab and Shift-Tab traverse cells in row-major order regardless of empty, multiline, or nested block content. Tab from the last cell appends a row unless the table is already at the 100-row limit, in which case navigation moves after the table. Vertical arrows stay within multiline/nested content until the caret reaches the first or last visual line, then move to the same column in the adjacent row; a shorter ragged row uses its last available cell. Crossing the first or last row reaches the managed boundary before or after the table.

Valid GFM output requires a rectangular table, column headers in the first row, unmerged cells, and one paragraph of supported inline content per cell. `editor.state.tableIssues()` scans every live table and returns frozen diagnostics for `"ragged-row"`, `"missing-column-header"`, `"merged-cell"`, `"multi-block-cell"`, and `"row-header-scope"`. Each issue includes the table document position and zero-based row and nullable column coordinates. The query is observational: it does not repair or reject a document, and it is not a general Markdown preflight validator. Call it before persistence when HTML paste, extensions, or advanced `editor.view` transactions may have introduced structures that GFM cannot encode.

`markora/minimal` and the root entry with `createMinimalMarkdownEditorPreset()` expose the same typed methods, so shared host toolbar code does not need a different interface. Because tasks and tables are absent from that schema, their commands and matching `can`/`isActive` checks consistently return `false`, while `tableIssues()` returns an empty frozen list. The minimal preset still supports paragraphs, headings, blockquotes, ordinary bullet and ordered lists (including indent/lift), hard breaks, horizontal rules, and plain code blocks.

Root and minimal share ordinary-list keyboard editing: Enter continues the
current item, Enter on the resulting empty item exits the list, Tab indents an
item when a preceding sibling makes that possible, and Shift-Tab outdents it.
Each edit participates in normal history. Tab remains native when the selection
is outside a list; in root tables it retains the table-navigation behavior
described above, and a focused task checkbox retains native sequential focus.

Root and minimal also share inline-mark boundary exit. At the visible edge of
strong, emphasis, inline-code, link, or available strikethrough text, one plain
physical horizontal-arrow press clears every coincident mark without moving
the model caret; subsequent text is unmarked and mark/link state queries become
inactive. Modified arrows and active composition remain browser-owned.

## Typing ergonomics and keymaps

`CreateEditorOptions.typing` is a copied, creation-time policy. `autoPairs` accepts `parentheses`, `square-brackets`, `braces`, `single-quotes`, `double-quotes`, `emphasis-asterisks`, `emphasis-underscores`, `strong-asterisks`, `strong-underscores`, `inline-code`, and `strikethrough`. It defaults to an empty list. `wrapSelection` defaults to `true`; set it to `false` to leave non-empty selections to the browser/editor's ordinary text-input behavior.

Only generated closers receive skip and empty-pair Backspace behavior. That provenance maps through ordinary edits and undo/redo but is retired after consumption, deletion, reset, or a divergent history branch. Quotes avoid apostrophe-like word interiors, Markdown delimiters use flanking checks, escaped openers remain literal, cross-block/node/table selections are not transformed, and every automated document change is one normal history transaction. All transformations and configurable keymaps reject active composition, including keyboard events marked `isComposing` or key code 229.

Markdown marker assistance is disabled in code marks and code blocks. The lazy CodeMirror runtime independently receives only configured bracket and quote pairs, preserving its initial-bundle boundary. `markora/minimal` supports the same policy for schema features it contains; for example, selecting `strikethrough` has no effect when the minimal schema omits the strike mark.

`CreateEditorOptions.shortcuts` is a copied, creation-time policy that maps stable action IDs to one key, an ordered key array, or `false`. The built-in IDs are:

- `@markora/core/bold`
- `@markora/core/italic`
- `@markora/core/inline-code`
- `@markora/core/strikethrough`
- `@markora/core/hard-break` (compatibility entry)
- `@markora/core/table-toolbar` (compatibility entry)
- `@markora/core/undo`
- `@markora/core/redo`

Compatibility-entry defaults are bold `Mod-b`, italic `Mod-i`, inline code `Mod-e`, strikethrough `Mod-Shift-x`, hard break `Shift-Enter`, table toolbar `Alt-F10`, undo `Mod-z`, and redo `Shift-Mod-z` plus `Mod-y`. The independently bundled `markora/minimal` contributes the bold, italic, inline-code, undo, and redo defaults; its strikethrough action has no default binding, and it has no hard-break or table-toolbar contribution.

An extension keymap's ID is its qualified contribution ID, such as `@acme/editor/toggle-note`. Remapping occurs after extension resolution, retains contribution ordering and first-true chaining, and canonicalizes equivalent modifier spellings. Unknown IDs are retained so one host policy can be assembled before optional extensions are resolved. A remapped or disabled built-in consumes its former default key instead of allowing native contenteditable behavior to leak through. Configured undo/redo bindings also drive active CodeMirror blocks; other action shortcuts remain outer-editor keymaps.

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

`element`, `markdown`, `initialSelection`, the autofocus action, `ui`, `typing`, `shortcuts`, `codeBlockLanguages`, `resources`, `extensionPreset`, and `extensions` are creation-only. Use `commands.reconcileMarkdown()` for ordinary host snapshots or `commands.resetMarkdown()` for an explicit state replacement.

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
- Error events report recoverable code-runtime-load, code-language-load, resource-callback, and table-clipboard rejections plus attributed extension runtime failures. A rejected merged or over-limit table transfer uses `"table-operation-rejected"` with clipboard phase and leaves the document unchanged. A code-runtime failure leaves the exact static source shell usable and reports phase `"runtime"`. Resource events use code `"resource-callback-failed"` with a resolve/open/load/cleanup phase. Extension events use an `EXTENSION_*` code plus `context.phase` and, when known, `context.extension`, `context.contribution`, or `context.participants`. Runtime activation, language loaders, and extensions run outside the current editor state update, so deferred failures use the same event path without re-entering that update.

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

EE-019 leaves existing typing behavior unchanged when `typing` and `shortcuts` are omitted: auto-pairs remain off and the established default key bindings remain active. Existing `EditorUiControllers` implementations remain source-compatible because `codeBlockLanguageEditor` is optional, while structural `MarkdownEditorUi` mocks must add `editCodeBlockLanguage()`. Code-block info commands now accept backticks; serialization may lengthen the fence or choose a tilde fence to preserve the complete info string safely.

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
  MarkdownEditorTableColumnMoveDirection,
  MarkdownEditorTableInsertOptions,
  MarkdownEditorTableInsertSide,
  MarkdownEditorTableIssue,
  MarkdownEditorTableIssueCode,
  MarkdownEditorTableResizeOptions,
  MarkdownEditorTableRowMoveDirection,
  MarkdownEditorTableOperationErrorEvent,
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

With `markora-ui`, the language label is an accessible button and `editor.ui?.editCodeBlockLanguage()` opens the same non-modal editor. It edits the exact complete info string, not only a guessed first language token. Saving changes only `code_block.attrs.params`, keeps the code body and selection, preserves an already-active CodeMirror instance, and reconfigures highlighting through the existing cancelable loader path. A request becomes stale after cancellation, supersession, any body/metadata edit, reset, removal, undo, a read-only transition, or teardown; updates are temporarily rejected during composition, so an overlay cannot overwrite newer state. Headless hosts can continue to call `editor.commands.setCodeBlock({ language })`; custom UI factories may provide the optional `codeBlockLanguageEditor` controller and must call `request.cancel()` when they dismiss a request without saving.

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
- `editor.ui?.editLink()`, `editImage()`, and `editCodeBlockLanguage()` are optional namespaced UI entry points when overlays are attached
- `CreateEditorOptions.resources` owns URL/image/navigation/upload policy and `editor.assets` exposes upload cancellation, retry, and snapshots
- `editor.subscribe(...)` exposes typed focus, blur, state, selection, update, asset, and recoverable error events
- `editor.updateOptions(...)` updates dynamic presentation, editable state, and callbacks without rebuilding EditorState
- `editor.destroy()` performs idempotent teardown and exposes its state through `editor.isDestroyed`

## Development

- `pnpm dev` starts the core, extension, UI, and demo watchers together
- `pnpm pack:smoke` verifies all nine public tarballs plus isolated root, minimal, per-extension, and all-extension consumer graphs
- `pnpm release:check` dry-runs the core npm tarball and then runs the packed-consumer smoke test
- `pnpm check` builds the workspace, runs typechecks, executes API type tests, smoke-tests Node ESM imports, and runs the shared test suite
