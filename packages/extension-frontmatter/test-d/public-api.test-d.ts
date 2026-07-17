import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  defaultFrontmatterMessages,
  type FrontmatterDiagnostic,
  type FrontmatterEditRequest,
  type FrontmatterExtension,
  type FrontmatterExtensionOptions,
  type FrontmatterMessageOverrides,
  type FrontmatterMessages,
  type FrontmatterSnapshot,
} from "../src/index";

const overrides: FrontmatterMessageOverrides = {
  editSource: "Edit metadata",
};
const options: FrontmatterExtensionOptions = {
  messages: overrides,
  onEditSource(request: FrontmatterEditRequest) {
    const source: string = request.source;
    const diagnostics: readonly FrontmatterDiagnostic[] = request.diagnostics;
    const updated: boolean = request.update(source);
    const removed: boolean = request.remove();
    void diagnostics;
    void updated;
    void removed;
  },
};
const extension: FrontmatterExtension = createFrontmatterExtension(options);
declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const source: string | null = handle.state.getSource();
const snapshot: FrontmatterSnapshot | null = handle.state.getSnapshot();
const messages: FrontmatterMessages = defaultFrontmatterMessages;
const maximum: number = FRONTMATTER_MAX_SOURCE_BYTES;
const inserted: boolean = handle.commands.insert();
const insertedSource: boolean = handle.commands.insert("---\ntitle: Typed\n---");
const updated: boolean = handle.commands.update("---\ntitle: Updated\n---");
const removed: boolean = handle.commands.remove();
void source;
void snapshot;
void messages;
void maximum;
void inserted;
void insertedSource;
void updated;
void removed;

// @ts-expect-error Front matter source must be a string.
handle.commands.update(42);

// @ts-expect-error Message overrides are restricted to the package contract.
createFrontmatterExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Source-editor callbacks receive one typed request.
createFrontmatterExtension({ onEditSource(source: string) { void source; } });
