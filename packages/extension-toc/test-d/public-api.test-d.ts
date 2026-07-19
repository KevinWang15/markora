import {
  createEditor as createRootEditor,
  type MarkdownEditor as RootMarkdownEditor,
} from "markora";
import {
  createEditor as createMinimalEditor,
  type MarkdownEditor as MinimalMarkdownEditor,
} from "markora/minimal";
import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
import {
  createTocExtension,
  defaultTocMessages,
  type TocCommands,
  type TocExtension,
  type TocExtensionOptions,
  type TocHeadingLevel,
  type TocHeadingSnapshot,
  type TocMessageOverrides,
  type TocMessages,
  type TocNodeSnapshot,
  type TocSnapshot,
  type TocState,
} from "../src/index";

const messageOverrides: TocMessageOverrides = {
  emptyState: "No outline entries",
  goToHeadingLabel: (label, level, index) => (
    `Go to ${label}, level ${level}, entry ${index}`
  ),
  insertToc: "Insert outline",
  invalidPlacementDiagnostic: "Outline markers must be top-level blocks.",
  navigationLabel: (occurrence, total) => `Outline ${occurrence} of ${total}`,
  removeToc: "Remove outline",
  untitledHeadingLabel: (level, index) => `Heading ${index}, level ${level}`,
};
const options: TocExtensionOptions = { messages: messageOverrides };
const extension: TocExtension = createTocExtension(options);
const defaultMessages: TocMessages = defaultTocMessages;

declare const registry: MarkdownEditorExtensionRegistry;
const registryHandle = registry.get(extension);
const registryCommands: TocCommands = registryHandle.commands;
const registryState: TocState = registryHandle.state;

declare const rootHost: HTMLElement;
declare const minimalHost: HTMLElement;
const rootEditor: RootMarkdownEditor = createRootEditor({
  element: rootHost,
  extensions: [extension],
  markdown: "[TOC]\n\n# Root heading",
});
const minimalEditor: MinimalMarkdownEditor = createMinimalEditor({
  element: minimalHost,
  extensions: [extension],
  markdown: "[TOC]\n\n## Minimal heading",
});
const rootHandle = rootEditor.extensions.get(extension);
const minimalHandle = minimalEditor.extensions.get(extension);
const rootCommands: TocCommands = rootHandle.commands;
const rootState: TocState = rootHandle.state;
const minimalCommands: TocCommands = minimalHandle.commands;
const minimalState: TocState = minimalHandle.state;

const inserted: boolean = rootCommands.insert();
const removed: boolean = rootCommands.remove();
const minimalInserted: boolean = minimalCommands.insert();
const minimalRemoved: boolean = minimalCommands.remove();
const canInsert: boolean = rootState.canInsert();
const canRemove: boolean = rootState.canRemove();
const active: boolean = rootState.isActive();
const minimalActive: boolean = minimalState.isActive();
const snapshot: TocSnapshot = rootState.getSnapshot();
const headings: readonly TocHeadingSnapshot[] = snapshot.headings;
const tocNodes: readonly TocNodeSnapshot[] = snapshot.tocs;
const heading: TocHeadingSnapshot = headings[0];
const tocNode: TocNodeSnapshot = tocNodes[0];
const headingLabel: string = heading.label;
const headingLevel: TocHeadingLevel = heading.level;
const headingPosition: number = heading.position;
const tocPosition: number = tocNode.position;
const levelOne: TocHeadingLevel = 1;
const levelSix: TocHeadingLevel = 6;
const landmarkLabel: string = defaultMessages.navigationLabel(1, 2);
const entryLabel: string = defaultMessages.goToHeadingLabel("Root heading", 1, 1);
const untitledLabel: string = defaultMessages.untitledHeadingLabel(2, 3);

void registryCommands;
void registryState;
void inserted;
void removed;
void minimalInserted;
void minimalRemoved;
void canInsert;
void canRemove;
void active;
void minimalActive;
void snapshot;
void headings;
void tocNodes;
void headingLabel;
void headingLevel;
void headingPosition;
void tocPosition;
void levelOne;
void levelSix;
void landmarkLabel;
void entryLabel;
void untitledLabel;

// @ts-expect-error Factory options are a closed object contract.
createTocExtension({ messages: messageOverrides, unknownOption: true });

// @ts-expect-error Factory options cannot be null.
createTocExtension(null);

// @ts-expect-error Message overrides are restricted to package-owned copy.
createTocExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Formatter overrides must return text.
createTocExtension({ messages: { navigationLabel: () => 42 } });

// @ts-expect-error String message overrides cannot be formatter functions.
createTocExtension({ messages: { emptyState: () => "Empty" } });

// @ts-expect-error Navigation formatter arguments are numeric.
defaultMessages.navigationLabel("first", 2);

// @ts-expect-error Heading levels are closed to one through six.
const invalidLevel: TocHeadingLevel = 7;
void invalidLevel;

// @ts-expect-error Commands accept no source or positioning arguments.
rootCommands.insert("[TOC]");

// @ts-expect-error Commands accept no target arguments.
rootCommands.remove({ position: tocPosition });

// @ts-expect-error Snapshot heading arrays are immutable.
snapshot.headings.push(heading);

// @ts-expect-error Snapshot collections cannot be replaced.
snapshot.headings = [];

// @ts-expect-error Snapshot TOC arrays are immutable.
snapshot.tocs.push(tocNode);

// @ts-expect-error Heading snapshots are immutable.
heading.label = "Changed";

// @ts-expect-error TOC node snapshots are immutable.
tocNode.position = 0;

// @ts-expect-error Default messages are immutable.
defaultTocMessages.emptyState = "Changed";

// @ts-expect-error Normalized factory options are immutable at the type boundary.
options.messages = undefined;

// @ts-expect-error Command maps are immutable host handles.
rootCommands.insert = () => false;
