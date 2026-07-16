import { Fragment } from "react";
import { CodeBlock } from "../components/CodeBlock";
import { DocPageNav } from "../components/DocPageNav";

const apiRows = [
  ["createEditor(options: CreateEditorOptions)", "Creates the editor view and returns the host API."],
  ["editor.focus(target?) / editor.blur()", "Moves focus without reaching into the raw ProseMirror view."],
  ["editor.subscribe(type, listener)", "Subscribes to typed focus, blur, state, selection, update, asset, or error events and returns an idempotent unsubscribe function."],
  ["editor.updateOptions(options)", "Updates editable state, placeholder, attributes, accessible naming, and callbacks without rebuilding editor state."],
  ["editor.isDestroyed", "Reports whether the high-level editor is no longer active."],
  ["editor.view", "Exposes the version-coupled ProseMirror view for advanced inspection and dispatch."],
  ["editor.getMarkdown()", "Synchronously returns the latest normalized Markdown, serializing lazily and caching it until the document changes."],
  ["editor.commands.reconcileMarkdown(markdown, { emitChange })", "Applies an authoritative host snapshot while mapping selection/history and preserving plugin state; returns whether the parsed document changed."],
  ["editor.commands.resetMarkdown(markdown, { emitChange })", "Explicitly replaces EditorState, resetting selection and clearing history/plugin state."],
  ["editor.commands.setMarkdown(...) (deprecated)", "Retains the historical hard-reset behavior as an alias of resetMarkdown()."],
  ["editor.flushChange()", "Synchronously delivers pending idle or animation-frame Markdown output."],
  ["editor.state.can.* / editor.state.isActive.*", "Lets hosts derive command availability and active structural/formatting state without built-in UI."],
  ["editor.getToolbarState()", "Returns a compatibility snapshot for toolbar buttons."],
  [`editor.commands.toggleMark("strong" | "em" | "code" | "strike")`, "Applies inline formatting commands."],
  ["editor.commands.setLink(href) / removeLink()", "Creates or removes links without UI assumptions."],
  ["editor.commands.insertImage({ src, alt, title }) / removeImage()", "Creates or removes images without UI assumptions."],
  ["editor.assets.getUploads() / cancel(id) / retry(id)", "Observes and controls host-owned pasted or dropped file uploads."],
  ["editor.commands.setParagraph() / setHeading(level) / toggleBlockquote()", "Changes the selected text blocks between paragraphs, heading levels, and blockquotes."],
  ["editor.commands.toggleBulletList() / toggleOrderedList() / sinkListItem() / liftListItem()", "Creates, switches, indents, or outdents list content."],
  ["editor.commands.toggleTaskList() / setTaskChecked(checked)", "Toggles selected task-list items or sets their completion state."],
  ["editor.commands.insertHardBreak() / insertHorizontalRule() / setCodeBlock(options)", "Inserts structural breaks or converts selected text blocks to fenced code."],
  ["editor.commands.insertTable(options) / addTableRow() / addTableColumn()", "Inserts a basic table or adds a row or column after the active cell."],
  ["editor.commands.deleteTableRow() / deleteTableColumn() / setTableColumnAlignment() / deleteTable()", "Deletes or aligns the active table structure without requiring the optional UI."],
  ["editor.ui?.editLink() / editor.ui?.editImage()", "Optional namespaced UI entry points when overlays are attached."],
  ["editor.commands.undo() / editor.commands.redo()", "Runs history commands."],
  ["editor.destroy()", "Idempotently flushes pending output and releases the editor, nested code views, optional UI, listeners, and subscriptions."],
] as const;

const builtInLanguages = [
  "JavaScript and TypeScript",
  "JSON, CSS, HTML, and XML",
  "Markdown and shell",
  "Python, C/C++, Java, and Rust",
] as const;

const portalRootCode = `import { createDefaultUi } from "markora-ui";

const editor = createEditor({
  element: editorMount,
  ariaLabel: "Shadow-root document",
  ui: createDefaultUi({ portalRoot: shadowRoot }),
});`;

const languageRegistryCode = `import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element: hostElement,
  ariaLabel: "Code sample document",
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [
      // Return CodeMirror extensions for your custom fenced language.
    ],
  },
});`;

const opaqueSourceEditorCode = `const editor = createEditor({
  element: hostElement,
  markdown: initialMarkdown,
  ariaLabel: "Document body",
  onEditOpaqueMarkdown({ kind, source, update }) {
    openSourceDialog({
      title: \`Edit \${kind} source\`,
      source,
      onSave(nextSource) {
        // false means the original node changed or was removed while the dialog was open.
        return update(nextSource);
      },
    });
  },
});`;

const resourcePolicyCode = `const editor = createEditor({
  element,
  resources: {
    links: { allowedProtocols: ["https:", "mailto:"] },
    images: {
      allowedProtocols: ["https:", "data:"],
      allowedDataMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxDataUrlBytes: 1024 * 1024,
      referrerPolicy: "no-referrer",
    },
    resolveUrl({ kind, purpose, url }) {
      return kind === "image" && purpose === "load"
        ? imageProxyUrl(url)
        : url;
    },
    openUrl({ url }) {
      appNavigation.openExternal(url);
    },
    async loadImage({ signal, storedUrl, url }) {
      const blob = await fetch(url, { signal, credentials: "omit" })
        .then((response) => response.blob());
      return { src: blob }; // Markora creates and revokes the object URL.
    },
    assets: {
      allowedMimeTypes: ["image/*"],
      maxFileBytes: 10 * 1024 * 1024,
      maxFiles: 10,
      async upload({ file, reportProgress, signal }) {
        const uploaded = await uploadAsset(file, { reportProgress, signal });
        return { kind: "image", url: uploaded.url, alt: file.name };
      },
    },
  },
});

const stopAssets = editor.subscribe("asset", ({ reason, upload }) => {
  renderUploadStatus({ reason, upload }); // Provide accessible progress/Cancel/Retry UI.
});`;

const eventSubscriptionCode = `const stopSelection = editor.subscribe(
  "selection",
  ({ origin, previousSelection, selection }) => {
    renderSelection(previousSelection, selection, origin);
  },
);

const stopState = editor.subscribe(
  "state",
  ({ docChanged, origin, selection, selectionChanged }) => {
    renderToolbar({ docChanged, origin, selection, selectionChanged });
  },
);

const stopUpdates = editor.subscribe("update", ({ origin }) => {
  scheduleDocumentIndexRefresh(origin);
});

const stopErrors = editor.subscribe("error", ({ code, context, error }) => {
  if (code === "code-block-language-load-failed") {
    reportLanguageFailure(context.language, error);
  }
});

// Later, during host teardown. Each function is safe to call more than once.
function disposeSubscriptions() {
  stopSelection();
  stopState();
  stopUpdates();
  stopErrors();
}`;

const externalUpdatesCode = `// Ordinary controlled/server update: silent by default.
const changed = editor.commands.reconcileMarkdown(nextMarkdown);

// Switching to a different document and deliberately clearing transient state.
editor.commands.resetMarkdown(nextDocumentMarkdown);

// Host-owned revisions must be checked before reconciliation.
if (response.revision > appliedRevision) {
  editor.commands.reconcileMarkdown(response.markdown);
  appliedRevision = response.revision;
}`;

const extensionOriginCode = `import {
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
} from "markora";

const transaction = setMarkdownEditorTransactionOrigin(
  editor.view.state.tr.insertText("completion"),
  "extension:autocomplete",
);

editor.view.dispatch(transaction);
console.log(getMarkdownEditorTransactionOrigin(transaction));`;

const dynamicOptionsCode = `editor.updateOptions({
  editable: false,
  placeholder: null,
  attributes: { "data-document-id": documentId },
  ariaLabel: "Document preview",
  onChange: null,
});`;

const snapshotBoundaryCode = `const stopUpdates = editor.subscribe("update", ({ origin }) => {
  markDocumentDirty(origin); // No Markdown serialization.
});

form.addEventListener("submit", () => {
  editor.flushChange();
  markdownField.value = editor.getMarkdown();
});

// destroy() also flushes pending output and caches the final snapshot.
stopUpdates();
editor.destroy();`;

const createEditorOptionsType = `type MarkdownEditorDomAttributes = Readonly<Record<string, string>>;

type MarkdownEditorSelectionTarget =
  | "all"
  | "end"
  | "start"
  | { anchor: number; head?: number };

type MarkdownEditorChangeOrigin =
  | "user"
  | "command"
  | "external"
  | "reset"
  | \`extension:\${string}\`;

type MarkdownEditorChangeContext = {
  origin: MarkdownEditorChangeOrigin;
};

type MarkdownEditorChangeMode = "idle" | "animationFrame" | "immediate";

type CreateEditorOptions = {
  element: HTMLElement;
  markdown?: string;
  editable?: boolean;
  placeholder?: string;
  autofocus?: boolean;
  initialSelection?: MarkdownEditorSelectionTarget;
  attributes?: MarkdownEditorDomAttributes;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  onChange?: (markdown: string, context: MarkdownEditorChangeContext) => void;
  onTransaction?: (
    transaction: Transaction,
    view: EditorView,
    context: MarkdownEditorChangeContext,
  ) => void;
  onChangeMode?: MarkdownEditorChangeMode;
  onEditOpaqueMarkdown?: (request: OpaqueMarkdownEditRequest) => void;
  ui?: EditorUiFactory;
  codeBlockLanguages?: CodeBlockLanguageRegistry;
};`;

const updateEditorOptionsType = `type UpdateEditorOptions = {
  editable?: boolean;
  placeholder?: string | null;
  attributes?: MarkdownEditorDomAttributes | null;
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  onChange?: ((markdown: string) => void) | null;
  onTransaction?: CreateEditorOptions["onTransaction"] | null;
  onChangeMode?: MarkdownEditorChangeMode;
  onEditOpaqueMarkdown?: ((request: OpaqueMarkdownEditRequest) => void) | null;
};`;

const markdownEditorType = `type MarkdownEditor = {
  readonly isDestroyed: boolean;
  readonly view: EditorView;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  focus: (selection?: MarkdownEditorSelectionTarget) => void;
  blur: () => void;
  updateOptions: (options: UpdateEditorOptions) => void;
  subscribe: <Type extends MarkdownEditorEventName>(
    type: Type,
    listener: MarkdownEditorEventListener<Type>,
  ) => MarkdownEditorUnsubscribe;
  getMarkdown: () => string;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
  destroy: () => void;
};`;

const markdownEditorEventTypes = `type MarkdownEditorSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: "all" | "managed-block" | "node" | "other" | "text";
  to: number;
};

type MarkdownEditorEventMap = {
  focus: { editor: MarkdownEditor; type: "focus"; nativeEvent: FocusEvent };
  blur: { editor: MarkdownEditor; type: "blur"; nativeEvent: FocusEvent };
  selection: {
    editor: MarkdownEditor;
    type: "selection";
    origin: MarkdownEditorChangeOrigin;
    previousSelection: MarkdownEditorSelectionSnapshot;
    selection: MarkdownEditorSelectionSnapshot;
  };
  state: {
    editor: MarkdownEditor;
    type: "state";
    docChanged: boolean;
    origin: MarkdownEditorChangeOrigin;
    selection: MarkdownEditorSelectionSnapshot;
    selectionChanged: boolean;
  };
  update: {
    editor: MarkdownEditor;
    type: "update";
    origin: MarkdownEditorChangeOrigin;
    selection: MarkdownEditorSelectionSnapshot;
  };
  error: {
    editor: MarkdownEditor;
    type: "error";
    code: "code-block-language-load-failed";
    context: { language: string };
    error: unknown;
    recoverable: true;
  };
};

type MarkdownEditorEventName = keyof MarkdownEditorEventMap;
type MarkdownEditorEventListener<Type extends MarkdownEditorEventName> = (
  event: MarkdownEditorEventMap[Type],
) => void;
type MarkdownEditorUnsubscribe = () => void;`;

const markdownEditorCommandsType = `type MarkdownEditorMarkdownUpdateOptions = {
  emitChange?: boolean;
};

type MarkdownEditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type MarkdownEditorCodeBlockOptions = { language?: string | null };
type MarkdownEditorTableAlignment = "left" | "center" | "right" | null;
type MarkdownEditorTableInsertOptions = { columns?: number; rows?: number };

type MarkdownEditorCommands = {
  reconcileMarkdown: (
    markdown: string,
    options?: MarkdownEditorMarkdownUpdateOptions,
  ) => boolean;
  resetMarkdown: (
    markdown: string,
    options?: MarkdownEditorMarkdownUpdateOptions,
  ) => void;
  /** @deprecated Use resetMarkdown() or reconcileMarkdown(). */
  setMarkdown: (
    markdown: string,
    options?: MarkdownEditorMarkdownUpdateOptions,
  ) => void;
  toggleMark: (mark: "strong" | "em" | "code" | "strike") => boolean;
  setLink: (href: string) => boolean;
  removeLink: () => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  removeImage: () => boolean;
  setParagraph: () => boolean;
  setHeading: (level: MarkdownEditorHeadingLevel) => boolean;
  toggleBlockquote: () => boolean;
  toggleBulletList: () => boolean;
  toggleOrderedList: () => boolean;
  sinkListItem: () => boolean;
  liftListItem: () => boolean;
  toggleTaskList: () => boolean;
  setTaskChecked: (checked: boolean) => boolean;
  insertHardBreak: () => boolean;
  insertHorizontalRule: () => boolean;
  setCodeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
  insertTable: (options?: MarkdownEditorTableInsertOptions) => boolean;
  addTableRow: () => boolean;
  addTableColumn: () => boolean;
  deleteTableRow: () => boolean;
  deleteTableColumn: () => boolean;
  setTableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
  deleteTable: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
};`;

const markdownEditorStateType = `type MarkdownEditorActiveNode =
  | "blockquote"
  | "bullet_list"
  | "code_block"
  | "hard_break"
  | "heading"
  | "horizontal_rule"
  | "image"
  | "list_item"
  | "ordered_list"
  | "paragraph"
  | "table";

type MarkdownEditorState = {
  can: {
    toggleMark: (mark: "strong" | "em" | "code" | "strike") => boolean;
    setLink: () => boolean;
    removeLink: () => boolean;
    insertImage: () => boolean;
    removeImage: () => boolean;
    setParagraph: () => boolean;
    setHeading: (level: MarkdownEditorHeadingLevel) => boolean;
    toggleBlockquote: () => boolean;
    toggleBulletList: () => boolean;
    toggleOrderedList: () => boolean;
    sinkListItem: () => boolean;
    liftListItem: () => boolean;
    toggleTaskList: () => boolean;
    setTaskChecked: (checked: boolean) => boolean;
    insertHardBreak: () => boolean;
    insertHorizontalRule: () => boolean;
    setCodeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
    insertTable: (options?: MarkdownEditorTableInsertOptions) => boolean;
    addTableRow: () => boolean;
    addTableColumn: () => boolean;
    deleteTableRow: () => boolean;
    deleteTableColumn: () => boolean;
    setTableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
    deleteTable: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
  };
  isActive: {
    mark: (mark: "strong" | "em" | "code" | "strike" | "link") => boolean;
    node: (node: MarkdownEditorActiveNode) => boolean;
    paragraph: () => boolean;
    heading: (level?: MarkdownEditorHeadingLevel) => boolean;
    blockquote: () => boolean;
    bulletList: () => boolean;
    orderedList: () => boolean;
    taskList: () => boolean;
    taskChecked: (checked?: boolean) => boolean;
    hardBreak: () => boolean;
    horizontalRule: () => boolean;
    codeBlock: (options?: MarkdownEditorCodeBlockOptions) => boolean;
    table: () => boolean;
    tableColumnAlignment: (alignment: MarkdownEditorTableAlignment) => boolean;
  };
};`;

const keyboardShortcuts = [
  ["Mod-b", "Bold"],
  ["Mod-i", "Italic"],
  ["Mod-e", "Inline code"],
  ["Mod-Shift-x", "Strikethrough"],
  ["Mod-z", "Undo"],
  ["Shift-Mod-z / Mod-y", "Redo"],
  ["Tab", "Next table cell or indent list"],
  ["Shift-Tab", "Previous table cell or outdent list"],
  ["ArrowUp / ArrowDown", "Navigate table rows"],
  ["Enter", "Split list item or lift empty block"],
  ["Shift-Enter", "Hard break"],
] as const;

const inputRulesList = [
  ["# through ###### + space", "Headings 1\u20136"],
  ["> + space", "Blockquote"],
  ["-, *, + + space", "Bullet list"],
  ["1. + space", "Ordered list"],
  ["``` + language + space/enter", "Code block"],
  ["**text**", "Bold"],
  ["*text*", "Italic"],
  ["`text`", "Inline code"],
  ["~~text~~", "Strikethrough"],
  ["[text](url)", "Link"],
  ["![alt](url)", "Image"],
  ["[ ] or [x] + space", "Task list (inside bullet list)"],
] as const;

export function ApiPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">API overview</span>
        <h2>Small surface area, enough control for real apps.</h2>
        <p>
          <code>createEditor()</code> returns a tight host API: Markdown in, normalized Markdown out, structured
          {" "}commands and state, plus optional UI hooks when you attach <code>markora-ui</code>.
        </p>
      </section>

      <section className="panel doc-panel">
        <div className="api-table">
          <div className="api-table-head">Method</div>
          <div className="api-table-head">What it does</div>
          {apiRows.map(([method, description]) => (
            <Fragment key={method}>
              <code className="api-cell api-method">{method}</code>
              <div className="api-cell">{description}</div>
            </Fragment>
          ))}
        </div>
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">CreateEditor options</span>
          <h3>Wire only the pieces you need</h3>
          <ul className="check-list compact">
            <li><code>element</code> is required and owns the mounted editor view.</li>
            <li><code>markdown</code> seeds the initial document content.</li>
            <li><code>editable</code> defaults to <code>true</code>; read-only mode preserves selection, copy, and host reconciliation/reset while blocking user/UI/format/history mutations.</li>
            <li><code>placeholder</code>, <code>autofocus</code>, and <code>initialSelection</code> configure the initial surface. Object selection targets are in-range integer ProseMirror positions inside text blocks.</li>
            <li><code>attributes</code>, <code>ariaLabel</code>, and <code>ariaLabelledBy</code> configure the inner editor DOM and accessible name.</li>
            <li><code>onChange</code> receives serialized Markdown output plus its change origin. Omitted <code>onChangeMode</code> defaults to coalesced idle delivery.</li>
            <li><code>onTransaction</code> lets hosts observe transaction dispatch attempts and their origin without forcing serialization.</li>
            <li><code>onChangeMode</code> supports default <code>"idle"</code>, once-per-frame <code>"animationFrame"</code>, and same-stack <code>"immediate"</code> delivery.</li>
            <li><code>onEditOpaqueMarkdown</code> opens a host-owned source editor for inert unsupported syntax.</li>
            <li><code>resources</code> configures stored URL policy, resolution/open/load hooks, image privacy, and optional file uploads. It is creation-only because it defines document validity.</li>
            <li><code>ui</code> and <code>codeBlockLanguages</code> are optional extension points.</li>
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Built-in languages</span>
          <h3>Lazy-loaded code-block editing</h3>
          <p>
            The default registry provides CodeMirror editing and highlighting for the languages below,
            {" "}loading a grammar only when a matching fenced block is encountered.
          </p>
          <ul className="check-list compact">
            {builtInLanguages.map((language) => (
              <li key={language}>{language}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Resources and assets</span>
        <h2>Keep navigation, network access, and storage host-owned.</h2>
        <p>
          Stored link and image URLs are validated at every built-in ingress. The resolver can deny or rewrite a URL
          {" "}without changing Markdown; the opener retains synchronous user activation; and the image loader receives an
          {" "}<code>AbortSignal</code> and may return a URL or <code>Blob</code>. File paste/drop remains rejected unless an
          {" "}<code>assets.upload</code> hook is present. A transfer preserves file order and inserts in one undoable transaction
          {" "}after every accepted file succeeds; failed jobs remain available through <code>editor.assets.retry()</code>.
        </p>
        <p>
          Asset events are headless. The embedding app owns an accessible named progress indicator, failure announcement,
          {" "}and keyboard-operable Cancel/Retry controls. Nested CodeMirror file transfers remain rejected.
        </p>
        <CodeBlock code={resourcePolicyCode} language="ts" title="Host resource policy and upload pipeline" />
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Typed subscriptions</span>
          <h3>Observe the editor without serializing</h3>
          <p>
            Focus, blur, state, selection, and update events expose host-facing activity. The synchronous <code>state</code>
            {" "}event runs first for an accepted editor-state transition and is the preferred toolbar refresh signal; it carries
            {" "}<code>docChanged</code>, <code>selectionChanged</code>, the current selection, and its origin without Markdown or
            {" "}a ProseMirror transaction. A specialized selection event follows when the selection changed, and an update event
            {" "}follows when the document changed. Focus and blur each cross one microtask boundary so callbacks run outside nested
            {" "}editor focus internals and movement within the composite surface does not create a false boundary. Error events report recoverable code-language-load failures;
            {" "}loaders and extensions run after the current editor update completes. Initial focus and selection actions are
            {" "}not replayed to subscriptions added after creation; call <code>event.editor.getMarkdown()</code> only
            {" "}when a particular listener intentionally needs a synchronous serialized snapshot.
          </p>
          <CodeBlock code={eventSubscriptionCode} language="ts" title="Subscriptions" />
        </article>
        <article className="doc-card">
          <span className="card-kicker">Dynamic configuration</span>
          <h3>Change options without rebuilding state</h3>
          <p>
            <code>updateOptions()</code> changes editable state, presentation attributes, accessible naming, and callbacks.
            {" "}It does not reconstruct EditorState or emit a document update. Idle is the default change mode; changing <code>onChange</code> or its mode
            {" "}first flushes pending output once through the previous listener. The mount element, initial Markdown,
            {" "}initial focus/selection actions, UI factory, and language registry remain creation-only. Use
            {" "}<code>reconcileMarkdown()</code> or <code>resetMarkdown()</code> for later document values.
          </p>
          <CodeBlock code={dynamicOptionsCode} language="ts" title="Runtime options" />
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Markdown snapshots</span>
        <h2>Keep typing cheap; serialize at an explicit boundary.</h2>
        <p>
          The default idle <code>onChange</code> coalesces rapid changes outside the synchronous editor update.
          {" "}Use the synchronous <code>update</code> event for dirty state and other work that does not need Markdown.
          {" "}<code>getMarkdown()</code> is the lazy synchronous save/export snapshot; <code>flushChange()</code> first
          {" "}delivers any pending callback when a form submission or explicit Save action cannot wait. Destruction performs
          {" "}the same final flush and keeps the final snapshot readable afterward.
        </p>
        <CodeBlock code={snapshotBoundaryCode} language="ts" title="Synchronous save boundary" />
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">External updates</span>
          <h3>Reconcile ordinary snapshots; reset deliberately</h3>
          <p>
            <code>reconcileMarkdown()</code> is silent by default and returns <code>false</code> for a strict semantic no-op.
            {" "}A changed update maps selection/history and preserves plugin state, including in read-only mode. Disjoint
            {" "}local history remains usable; overlapping entries may map to a no-op or be consumed. It also
            {" "}cancels pending idle or animation-frame output; a no-op leaves that output alone. <code>resetMarkdown()</code> rebuilds
            {" "}EditorState and bypasses <code>onTransaction</code>. Deprecated <code>setMarkdown()</code> remains its alias.
          </p>
          <p>
            Calls run synchronously in invocation order. Each incoming string is a complete authoritative snapshot, so the
            {" "}last changed call wins. Markora provides no merge or revision protocol; the host must reject stale responses.
          </p>
          <CodeBlock code={externalUpdatesCode} language="ts" title="Host document updates" />
        </article>
        <article className="doc-card">
          <span className="card-kicker">Change origins</span>
          <h3>Trace where accepted activity entered</h3>
          <p>
            Change callbacks and state/selection/update events report <code>user</code>, <code>command</code>, <code>external</code>,
            {" "}<code>reset</code>, or a namespaced extension origin. <code>onTransaction</code> also reports origins for dispatch
            {" "}attempts, so it is not proof that policy accepted a state change. Origins are not revision IDs or authorization checks.
          </p>
          <CodeBlock code={extensionOriginCode} language="ts" title="Extension transaction origin" />
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Lifecycle boundary</span>
        <h2>Teardown runs once; repeated calls are no-ops.</h2>
        <p>
          Destruction synchronously caches the latest Markdown, flushes one pending <code>onChange</code>, and releases every owned resource even when teardown
          {" "}reports an error. It also clears subscriptions. Afterward, <code>isDestroyed</code> is true,
          {" "}<code>getMarkdown()</code> returns the cached final value, and <code>flushChange()</code>, repeated destroy,
          {" "}and old unsubscribe functions are no-ops. Other high-level calls throw
          {" "}<code>MarkdownEditorDestroyedError</code>.
        </p>
        <p>
          The raw <code>view</code> is a version-coupled advanced escape hatch. Inspection and <code>dispatch()</code> are
          {" "}supported advanced usage; direct <code>setProps()</code>, <code>updateState()</code>, DOM mutation,
          {" "}or <code>destroy()</code> can bypass Markora invariants and events and are outside the semver contract.
        </p>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Opaque source editor</span>
        <h2>Keep unsupported syntax inert and host-controlled.</h2>
        <p>
          Recognized front matter, display math, HTML, comments, and directives are displayed as text-only
          {" "}opaque nodes. Supply an accessible dialog through <code>onEditOpaqueMarkdown</code> when users
          {" "}need to edit that source. A stale <code>update()</code> returns <code>false</code> without changing the document.
        </p>
        <CodeBlock code={opaqueSourceEditorCode} language="ts" title="Host source hook" />
      </section>

      <section className="docs-grid docs-grid-two">
        <article className="doc-card">
          <span className="card-kicker">Optional UI</span>
          <h3>Use built-in overlays when they help</h3>
          <p>
            Pass <code>createDefaultUi()</code> for default link, image, and table controls. Use
            {" "}<code>portalRoot</code> when the editor lives in a Shadow DOM host.
          </p>
          <CodeBlock code={portalRootCode} language="ts" title="Shadow DOM host" />
        </article>
        <article className="doc-card">
          <span className="card-kicker">Custom languages</span>
          <h3>Extend the registry for app-specific fences</h3>
          <p>
            Merge your own entries with <code>createDefaultCodeBlockLanguageRegistry()</code> when you
            {" "}need extra fenced-code support.
          </p>
          <CodeBlock code={languageRegistryCode} language="ts" title="Code block languages" />
        </article>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Type signatures</span>
        <h2>Exported TypeScript types at a glance.</h2>
        <p>
          These are the key types exported from <code>markora</code>. Use them to
          {" "}type your host integration and get full editor-state autocomplete.
        </p>
        <CodeBlock code={createEditorOptionsType} language="ts" title="CreateEditorOptions" />
        <CodeBlock code={updateEditorOptionsType} language="ts" title="UpdateEditorOptions" />
        <CodeBlock code={markdownEditorType} language="ts" title="MarkdownEditor" />
        <CodeBlock code={markdownEditorEventTypes} language="ts" title="MarkdownEditorEventMap" />
        <CodeBlock code={markdownEditorCommandsType} language="ts" title="MarkdownEditorCommands" />
        <CodeBlock code={markdownEditorStateType} language="ts" title="MarkdownEditorState" />
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Keyboard shortcuts</span>
        <h2>Keys and input rules the editor handles out of the box.</h2>
        <p>
          <code>Mod</code> is <code>Cmd</code> on macOS and <code>Ctrl</code> on other platforms.
          {" "}Input rules trigger as you type and match the pattern.
        </p>

        <div className="api-table">
          <div className="api-table-head">Shortcut</div>
          <div className="api-table-head">Action</div>
          {keyboardShortcuts.map(([shortcut, action]) => (
            <Fragment key={shortcut}>
              <code className="api-cell api-method">{shortcut}</code>
              <div className="api-cell">{action}</div>
            </Fragment>
          ))}
        </div>
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Input rules</span>
        <h2>Markdown patterns recognized while typing.</h2>

        <div className="api-table">
          <div className="api-table-head">Pattern</div>
          <div className="api-table-head">Result</div>
          {inputRulesList.map(([pattern, result]) => (
            <Fragment key={pattern}>
              <code className="api-cell api-method">{pattern}</code>
              <div className="api-cell">{result}</div>
            </Fragment>
          ))}
        </div>
      </section>

      <DocPageNav />
    </div>
  );
}
