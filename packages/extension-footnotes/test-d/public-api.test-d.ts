import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
import {
  createFootnotesExtension,
  defaultFootnotesMessages,
  footnoteDiagnosticCodes,
  type FootnoteDefinitionSnapshot,
  type FootnoteDefinitionTarget,
  type FootnoteDiagnostic,
  type FootnoteDiagnosticCode,
  type FootnoteReferenceSnapshot,
  type FootnoteRemoveOptions,
  type FootnoteRenameOptions,
  type FootnotesExtension,
  type FootnotesExtensionOptions,
  type FootnotesMessageOverrides,
  type FootnotesMessages,
  type FootnotesSnapshot,
} from "../src/index";

const overrides: FootnotesMessageOverrides = {
  referenceText: (number) => String(number),
};
const options: FootnotesExtensionOptions = { messages: overrides };
const extension: FootnotesExtension = createFootnotesExtension(options);
declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const target: FootnoteDefinitionTarget = { label: "note", occurrence: 1 };
const renameOptions: FootnoteRenameOptions = { references: "rename" };
const removeOptions: FootnoteRemoveOptions = { references: "preserve" };
const insertedReference: boolean = handle.commands.insertReference("note");
const insertedDefinition: boolean = handle.commands.insertDefinition("note");
const renamed: boolean = handle.commands.renameDefinition(
  target,
  "renamed",
  renameOptions,
);
const removed: boolean = handle.commands.removeDefinition(target, removeOptions);
const navigatedForward: boolean = handle.commands.navigateToDefinition("note", 1);
const navigatedBack: boolean = handle.commands.navigateToReference("note", 1);
const snapshot: FootnotesSnapshot = handle.state.getSnapshot();
const definition: FootnoteDefinitionSnapshot | null = handle.state.getDefinition(target);
const references: readonly FootnoteReferenceSnapshot[] = handle.state.getReferences("note");
const diagnostics: readonly FootnoteDiagnostic[] = handle.state.getDiagnostics();
const diagnosticCode: FootnoteDiagnosticCode = footnoteDiagnosticCodes[0];
const messages: FootnotesMessages = defaultFootnotesMessages;
void insertedReference;
void insertedDefinition;
void renamed;
void removed;
void navigatedForward;
void navigatedBack;
void snapshot;
void definition;
void references;
void diagnostics;
void diagnosticCode;
void messages;

// @ts-expect-error Labels must be strings.
handle.commands.insertReference(42);

// @ts-expect-error Rename requires an explicit reference policy.
handle.commands.renameDefinition(target, "renamed", {});

// @ts-expect-error Remove policy cannot silently invent orphan behavior.
handle.commands.removeDefinition(target, { references: "rename" });

// @ts-expect-error Message overrides are restricted to the package contract.
createFootnotesExtension({ messages: { unknownLabel: () => "Unknown" } });
