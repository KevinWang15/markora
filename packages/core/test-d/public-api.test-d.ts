import { createEditor, createDefaultCodeBlockLanguageRegistry, type CodeBlockLanguageRegistry, type CreateEditorOptions, type EditorUiFactory, type MarkdownEditor, type MarkdownEditorActiveMark, type MarkdownEditorActiveNode, type MarkdownEditorCommands, type MarkdownEditorMark, type MarkdownEditorState, type MarkdownEditorUi, type ToolbarState } from "../src/index";
import type { EditorView } from "prosemirror-view";

declare const hostElement: HTMLElement;

const options: CreateEditorOptions = { element: hostElement };
const editor = createEditor(options);
const typedEditor: MarkdownEditor = editor;
const view: EditorView = editor.view;
const commands: MarkdownEditorCommands = editor.commands;
const stateApi: MarkdownEditorState = editor.state;
const toolbarState: ToolbarState = editor.getToolbarState();
const editorUi: MarkdownEditorUi | null = editor.ui;

const mark: MarkdownEditorMark = "strong";
commands.toggleMark(mark);
commands.setMarkdown("# Hello", { emitChange: true });
commands.setLink("https://example.com");
commands.insertImage({ src: "/image.png", alt: "demo", title: null });
commands.removeLink();
commands.removeImage();
commands.undo();
commands.redo();

stateApi.can.toggleMark("em");
stateApi.can.setLink();
stateApi.can.insertImage();
stateApi.can.undo();
stateApi.can.redo();

const activeMark: MarkdownEditorActiveMark = "link";
stateApi.isActive.mark(activeMark);
const activeNode: MarkdownEditorActiveNode = "code_block";
stateApi.isActive.node(activeNode);

editor.ui?.editLink();
editor.ui?.editImage();
editor.destroy();

const registry: CodeBlockLanguageRegistry = {
  custom: async () => [],
};
const defaultRegistry = createDefaultCodeBlockLanguageRegistry();
const maybeSupport = defaultRegistry.javascript;

if (typeof maybeSupport === "function") {
  void maybeSupport();
}

const uiFactory: EditorUiFactory = (_options) => ({
  enabled: true,
  clearSelectionAnchor() {},
  createSelectionAnchor() {
    return hostElement;
  },
  imageEditor: {
    open() {},
    close() {},
    destroy() {},
  },
  linkEditor: {
    open() {},
    close() {},
    destroy() {},
  },
  tableToolbar: {
    update() {},
    destroy() {},
  },
});

const optionsWithUi: CreateEditorOptions = {
  element: hostElement,
  ui: uiFactory,
  codeBlockLanguages: registry,
};

void typedEditor;
void view;
void toolbarState;
void editorUi;
void optionsWithUi;

// @ts-expect-error link is active-only, not toggleable
commands.toggleMark("link");

// @ts-expect-error paragraph is not part of the public active-node surface
stateApi.isActive.node("paragraph");

// @ts-expect-error underline is not part of the public active-mark surface
stateApi.isActive.mark("underline");

// @ts-expect-error element is required
const invalidOptions: CreateEditorOptions = {};

void invalidOptions;

// @ts-expect-error flat aliases were removed from the public API
editor.setMarkdown("next");
// @ts-expect-error flat aliases were removed from the public API
editor.toggleBold();
// @ts-expect-error flat aliases were removed from the public API
editor.setLink("https://example.com");
// @ts-expect-error flat aliases were removed from the public API
editor.editLink();
// @ts-expect-error flat aliases were removed from the public API
editor.undo();
