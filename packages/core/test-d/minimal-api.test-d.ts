import type { EditorView } from "prosemirror-view";
import {
  MarkdownEditorDestroyedError,
  createEditor,
  createMinimalMarkdownEditorPreset,
  defaultMarkdownEditorMessages,
  defineMarkdownEditorExtension,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
  type CreateEditorOptions,
  type MarkdownEditor,
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorCodeBlockRuntimeErrorEvent,
  type MarkdownEditorExtensionHandle,
  type MarkdownEditorMessageOverrides,
  type MarkdownEditorMessages,
  type MarkdownEditorShortcutMap,
  type MarkdownEditorTypingOptions,
  type UpdateEditorOptions,
} from "../src/minimal";
// @ts-expect-error Compiler-only definition records are not part of the minimal public entry.
import type { InternalMarkdownEditorExtensionDefinition } from "../src/minimal";

declare const host: HTMLElement;
const minimalDefaultMessages: MarkdownEditorMessages = defaultMarkdownEditorMessages;
const minimalMessages: MarkdownEditorMessageOverrides = {
  imageLoading: "Chargement de l’image",
};

const extension = defineMarkdownEditorExtension({
  name: "acme-minimal-types",
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
    state: {
      count: () => storage.count,
    },
  }),
});

const options: CreateEditorOptions = {
  ariaLabel: "Document",
  editable: true,
  element: host,
  extensionPreset: createMinimalMarkdownEditorPreset(),
  extensions: [extension],
  markdown: "minimal",
  messages: minimalMessages,
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
  resources: {
    links: { allowedProtocols: ["https:"] },
    images: { referrerPolicy: "no-referrer" },
    assets: {
      upload: ({ file, reportProgress, signal }) => {
        reportProgress(0.5);
        void signal;
        return Promise.resolve({ kind: "link", label: file.name, url: "/asset" });
      },
    },
  },
  shortcuts: {
    "@markora/core/bold": "Alt-b",
  } satisfies MarkdownEditorShortcutMap,
  typing: {
    autoPairs: ["parentheses", "inline-code"],
  } satisfies MarkdownEditorTypingOptions,
};
void minimalDefaultMessages;
const editor: MarkdownEditor = createEditor(options);
const view: EditorView = editor.view;
const handle: MarkdownEditorExtensionHandle<
  { increment: () => boolean },
  { count: () => number },
  { count: number }
> = editor.extensions.get(extension);
const sharedRuntimeErrorType = null as unknown as MarkdownEditorCodeBlockRuntimeErrorEvent;
editor.subscribe("asset", ({ reason, upload }) => {
  const status = upload.status;
  void reason;
  void status;
});
editor.assets.getUploads();
const update: UpdateEditorOptions = {
  ariaLabel: null,
  attributes: null,
  editable: false,
  onChange: null,
  onTransaction: null,
  placeholder: null,
};

handle.commands.increment();
const count: number = handle.state.count();
editor.commands.toggleMark("strike");
editor.commands.pasteMarkdown("# Pasted");
editor.commands.pastePlainText("# Literal");
editor.state.can.pasteMarkdown();
editor.state.can.pastePlainText();
editor.commands.setHeading(2);
editor.commands.toggleBlockquote();
editor.commands.toggleBulletList();
editor.commands.toggleOrderedList();
editor.commands.sinkListItem();
editor.commands.liftListItem();
editor.commands.insertHardBreak();
editor.commands.insertHorizontalRule();
editor.commands.setCodeBlock({ language: "text" });
editor.commands.toggleTaskList();
editor.commands.insertTable({ columns: 2, rows: 2 });
editor.state.can.setHeading(2);
editor.state.can.toggleTaskList();
editor.state.can.insertTable();
editor.state.isActive.heading(2);
editor.state.isActive.taskList();
editor.state.isActive.table();
editor.commands.reconcileMarkdown("external", { emitChange: false });
editor.commands.resetMarkdown("reset", { emitChange: true });
editor.updateOptions(update);
const transaction = setMarkdownEditorTransactionOrigin(
  view.state.tr,
  "extension:acme-minimal-types",
);
const origin: MarkdownEditorChangeOrigin | undefined =
  getMarkdownEditorTransactionOrigin(transaction);
const destroyedError: MarkdownEditorDestroyedError =
  new MarkdownEditorDestroyedError("test the editor");

void count;
void sharedRuntimeErrorType;
void origin;
void destroyedError;
void (null as unknown as InternalMarkdownEditorExtensionDefinition);

editor.destroy();
