import { Fragment } from "react";
import { CodeBlock } from "../components/CodeBlock";
import { DocPageNav } from "../components/DocPageNav";

const apiRows = [
  ["createEditor({ element, markdown, onChange, onTransaction, onChangeMode, ui, codeBlockLanguages })", "Creates the editor view and returns the host API."],
  ["editor.view", "Exposes the underlying ProseMirror view for focus and DOM coordination."],
  ["editor.getMarkdown()", "Returns the current Markdown string."],
  ["editor.commands.setMarkdown(markdown, { emitChange })", "Replaces the document through the structured headless API."],
  ["editor.flushChange()", "Flushes any pending animation-frame batched Markdown emission."],
  ["editor.state.can.* / editor.state.isActive.*", "Lets hosts derive toolbar and feature state without built-in UI."],
  ["editor.getToolbarState()", "Returns a compatibility snapshot for toolbar buttons."],
  [`editor.commands.toggleMark("strong" | "em" | "code" | "strike")`, "Applies inline formatting commands."],
  ["editor.commands.setLink(href) / removeLink()", "Creates or removes links without UI assumptions."],
  ["editor.commands.insertImage({ src, alt, title }) / removeImage()", "Creates or removes images without UI assumptions."],
  ["editor.ui?.editLink() / editor.ui?.editImage()", "Optional namespaced UI entry points when overlays are attached."],
  ["editor.commands.undo() / editor.commands.redo()", "Runs history commands."],
  ["editor.destroy()", "Destroys the editor view and listeners."],
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
  ui: createDefaultUi({ portalRoot: shadowRoot }),
});`;

const languageRegistryCode = `import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element: hostElement,
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [
      // Return CodeMirror extensions for your custom fenced language.
    ],
  },
});`;

const createEditorOptionsType = `type CreateEditorOptions = {
  element: HTMLElement;
  markdown?: string;
  onChange?: (markdown: string) => void;
  onTransaction?: (transaction: Transaction, view: EditorView) => void;
  onChangeMode?: "immediate" | "animationFrame";
  ui?: EditorUiFactory;
  codeBlockLanguages?: CodeBlockLanguageRegistry;
};`;

const markdownEditorType = `type MarkdownEditor = {
  view: EditorView;
  commands: MarkdownEditorCommands;
  state: MarkdownEditorState;
  ui: MarkdownEditorUi | null;
  getMarkdown: () => string;
  flushChange: () => void;
  getToolbarState: () => ToolbarState;
  destroy: () => void;
};`;

const markdownEditorCommandsType = `type MarkdownEditorCommands = {
  setMarkdown: (markdown: string, options?: { emitChange?: boolean }) => void;
  toggleMark: (mark: "strong" | "em" | "code" | "strike") => boolean;
  setLink: (href: string) => boolean;
  removeLink: () => boolean;
  insertImage: (attrs: { src: string; alt?: string | null; title?: string | null }) => boolean;
  removeImage: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
};`;

const markdownEditorStateType = `type MarkdownEditorState = {
  can: {
    toggleMark: (mark: "strong" | "em" | "code" | "strike") => boolean;
    setLink: () => boolean;
    insertImage: () => boolean;
    undo: () => boolean;
    redo: () => boolean;
  };
  isActive: {
    mark: (mark: "strong" | "em" | "code" | "strike" | "link") => boolean;
    node: (node: "image" | "table" | "code_block") => boolean;
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
          <code>createEditor()</code> returns a tight host API: markdown in, markdown out, structured
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
            <li><code>onChange</code> receives serialized Markdown output.</li>
            <li><code>onTransaction</code> lets hosts observe editor activity without forcing serialization.</li>
            <li><code>onChangeMode</code> supports <code>"immediate"</code> and <code>"animationFrame"</code>.</li>
            <li><code>ui</code> and <code>codeBlockLanguages</code> are optional extension points.</li>
          </ul>
        </article>
        <article className="doc-card">
          <span className="card-kicker">Built-in languages</span>
          <h3>Lazy-loaded code-block support</h3>
          <p>
            The default registry covers the languages below and only loads them when a matching fenced
            {" "}block is encountered.
          </p>
          <ul className="check-list compact">
            {builtInLanguages.map((language) => (
              <li key={language}>{language}</li>
            ))}
          </ul>
        </article>
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
        <CodeBlock code={markdownEditorType} language="ts" title="MarkdownEditor" />
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
