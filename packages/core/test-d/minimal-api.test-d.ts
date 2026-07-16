import type { EditorView } from "prosemirror-view";
import {
  MarkdownEditorDestroyedError,
  createEditor,
  createMinimalMarkdownEditorPreset,
  defineMarkdownEditorExtension,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
  type CreateEditorOptions,
  type MarkdownEditor,
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorExtensionHandle,
  type ToolbarState,
  type UpdateEditorOptions,
} from "../src/minimal";
// @ts-expect-error Compiler-only definition records are not part of the minimal public entry.
import type { InternalMarkdownEditorExtensionDefinition } from "../src/minimal";

declare const host: HTMLElement;

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
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
};
const editor: MarkdownEditor = createEditor(options);
const view: EditorView = editor.view;
const handle: MarkdownEditorExtensionHandle<
  { increment: () => boolean },
  { count: () => number },
  { count: number }
> = editor.extensions.get(extension);
const toolbar: ToolbarState = editor.getToolbarState();
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
void toolbar;
void origin;
void destroyedError;
void (null as unknown as InternalMarkdownEditorExtensionDefinition);

editor.destroy();
