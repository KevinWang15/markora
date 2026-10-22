import {
  MarkdownEditorDestroyedError,
  createEditor,
  getMarkdownEditorTransactionOrigin,
  setMarkdownEditorTransactionOrigin,
  type CreateEditorOptions,
  type MarkdownEditorActiveNode,
  type MarkdownEditorChangeOrigin,
  type MarkdownEditorCodeBlockOptions,
  type MarkdownEditorCommands,
  type MarkdownEditorEventMap,
  type MarkdownEditorExtensionOrigin,
  type MarkdownEditorHeadingLevel,
  type MarkdownEditorState,
  type MarkdownEditorStateEvent,
  type MarkdownEditorTableAlignment,
  type MarkdownEditorTableInsertOptions,
  type UpdateEditorOptions,
} from "markora";
import { defineComponent, createComponentRegistry, createComponentsExtension } from "markora-extension-components";

const packedCard = defineComponent({
  name: "typed-card",
  parseProps: (value: unknown) => ({ title: String(value) }),
  render: ({ element, props }) => { element.textContent = props.title; },
});
const packedComponents = createComponentsExtension({ registry: createComponentRegistry([packedCard]) });
export function checkComponentTypes(editor: ReturnType<typeof createEditor>) {
  const api = editor.extensions.get(packedComponents);
  const changed: boolean = api.commands.insert(packedCard, { title: "Packed" });
  const title: string | undefined = api.state.getProps(packedCard)?.title;
  return { changed, title };
}
import {
  createEditor as createMinimalEditor,
  type MarkdownEditorActiveNode as MinimalMarkdownEditorActiveNode,
  type MarkdownEditorCodeBlockOptions as MinimalMarkdownEditorCodeBlockOptions,
  type MarkdownEditorCommands as MinimalMarkdownEditorCommands,
  type MarkdownEditorHeadingLevel as MinimalMarkdownEditorHeadingLevel,
  type MarkdownEditorState as MinimalMarkdownEditorState,
  type MarkdownEditorStateEvent as MinimalMarkdownEditorStateEvent,
  type MarkdownEditorTableAlignment as MinimalMarkdownEditorTableAlignment,
  type MarkdownEditorTableInsertOptions as MinimalMarkdownEditorTableInsertOptions,
} from "markora/minimal";
import {
  MARKORA_EXTENSION_API_VERSION,
  closeHistory,
  defineMarkdownEditorExtension,
  sliceMarkdownEditorOriginalSourceLines,
  type AnyMarkdownEditorExtension,
  type Transaction,
} from "markora/extension-api";
import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
  type AlertKind,
  type AlertSnapshot,
  type AlertsCommands,
  type AlertsExtension,
  type AlertsExtensionOptions,
  type AlertsMessageOverrides,
  type AlertsMessages,
  type AlertsState,
} from "markora-extension-alerts";
import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  defaultFrontmatterMessages,
  type FrontmatterDiagnostic,
  type FrontmatterEditRequest,
  type FrontmatterExtension,
  type FrontmatterExtensionOptions,
  type FrontmatterMessages,
  type FrontmatterSnapshot,
} from "markora-extension-frontmatter";
import {
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DIAGRAM_MAX_SOURCE_BYTES,
  DIAGRAM_VIEWPORT_MARGIN,
  createDiagramsExtension,
  defaultDiagramMessages,
  diagramDiagnosticCodes,
  diagramKinds,
  diagramRenderErrorCodes,
  type DiagramCommands,
  type DiagramDiagnostic,
  type DiagramDiagnosticCode,
  type DiagramEditRequest,
  type DiagramExtensionOptions,
  type DiagramInsert,
  type DiagramKind,
  type DiagramMessageOverrides,
  type DiagramMessages,
  type DiagramNodeSnapshot,
  type DiagramNodeTarget,
  type DiagramRenderErrorCode,
  type DiagramRenderer,
  type DiagramRenderRequest,
  type DiagramRenderSnapshot,
  type DiagramRenderStatus,
  type DiagramState,
  type DiagramUpdate,
  type DiagramsExtension,
  type DiagramsSnapshot,
} from "markora-extension-diagrams";
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
} from "markora-extension-footnotes";
import {
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_SOURCE_BYTES,
  createHtmlExtension,
  defaultHtmlMessages,
  htmlDiagnosticCodes,
  htmlDisplays,
  htmlRenderErrorCodes,
  htmlSourceKinds,
  type HtmlCommands,
  type HtmlDiagnostic,
  type HtmlDiagnosticCode,
  type HtmlDisplay,
  type HtmlEditRequest,
  type HtmlExtension,
  type HtmlExtensionOptions,
  type HtmlMessageOverrides,
  type HtmlMessages,
  type HtmlNodeSnapshot,
  type HtmlNodeTarget,
  type HtmlRenderer,
  type HtmlRenderErrorCode,
  type HtmlRenderRequest,
  type HtmlRenderSnapshot,
  type HtmlRenderStatus,
  type HtmlSnapshot,
  type HtmlSourceKind,
  type HtmlState,
} from "markora-extension-html";
import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_SOURCE_BYTES,
  createMathExtension,
  defaultMathMessages,
  mathDiagnosticCodes,
  mathKinds,
  mathRenderErrorCodes,
  type MathDiagnostic,
  type MathEditRequest,
  type MathExtension,
  type MathExtensionOptions,
  type MathMessageOverrides,
  type MathMessages,
  type MathNodeSnapshot,
  type MathNodeTarget,
  type MathRenderRequest,
  type MathRenderer,
  type MathRenderSnapshot,
  type MathSnapshot,
} from "markora-extension-math";
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
} from "markora-extension-toc";
import {
  packedCalloutExtension,
  packedHighlightExtension,
} from "./extensions";

declare const element: HTMLElement;
declare const transaction: Transaction;

const alertsMessageOverrides: AlertsMessageOverrides = {
  alertLabel: (kind, kindLabel) => kind + ":" + kindLabel,
  invalidDocumentDiagnostic: (kind) => "Invalid packed alert: " + kind,
  toggleAlert: "Toggle packed alert",
};
const alertsOptions: AlertsExtensionOptions = {
  messages: alertsMessageOverrides,
};
const rootAlertsExtension: AlertsExtension = createAlertsExtension(alertsOptions);
const minimalAlertsExtension: AlertsExtension = createAlertsExtension();
const frontmatterOptions: FrontmatterExtensionOptions = {
  messages: { editSource: "Edit packed metadata" },
  onEditSource(request: FrontmatterEditRequest) {
    const source: string = request.source;
    const diagnostics: readonly FrontmatterDiagnostic[] = request.diagnostics;
    const unchanged: boolean = request.update(source);
    void diagnostics;
    void unchanged;
  },
};
const rootFrontmatterExtension: FrontmatterExtension =
  createFrontmatterExtension(frontmatterOptions);
const minimalFrontmatterExtension: FrontmatterExtension =
  createFrontmatterExtension();
const diagramMessages: DiagramMessageOverrides = {
  kindLabel: (kind) => kind.toUpperCase(),
  showPreview: "Preview packed diagram",
};
const diagramRenderer: DiagramRenderer = ({
  info,
  kind,
  ownerDocument,
  signal,
  source,
}: DiagramRenderRequest) => {
  const output = ownerDocument.createElement("div");
  output.textContent = kind + ":" + info + ":" + source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return output;
};
const diagramOptions: DiagramExtensionOptions = {
  messages: diagramMessages,
  onEditSource(request: DiagramEditRequest) {
    const info: string = request.info;
    const kind: DiagramKind = request.kind;
    const render: DiagramRenderSnapshot = request.render;
    const unchanged: boolean = request.update({ info, source: request.source });
    void kind;
    void render;
    void unchanged;
  },
  renderers: { mermaid: diagramRenderer },
};
const rootDiagramsExtension: DiagramsExtension =
  createDiagramsExtension(diagramOptions);
const minimalDiagramsExtension: DiagramsExtension =
  createDiagramsExtension();
const footnotesMessageOverrides: FootnotesMessageOverrides = {
  referenceText: (number) => "F" + number,
};
const footnotesOptions: FootnotesExtensionOptions = {
  messages: footnotesMessageOverrides,
};
const rootFootnotesExtension: FootnotesExtension =
  createFootnotesExtension(footnotesOptions);
const minimalFootnotesExtension: FootnotesExtension =
  createFootnotesExtension();
const htmlMessages: HtmlMessageOverrides = {
  showPreview: "Show packed HTML preview",
  sourceLabel: (kind) => "Packed " + kind + " source",
};
const htmlRenderer: HtmlRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: HtmlRenderRequest) => {
  const output = ownerDocument.createElement("article");
  output.textContent = kind + ": " + source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return output;
};
const htmlOptions: HtmlExtensionOptions = {
  messages: htmlMessages,
  onEditSource(request: HtmlEditRequest) {
    const display: HtmlDisplay = request.display;
    const kind: HtmlSourceKind = request.kind;
    const render: HtmlRenderSnapshot = request.render;
    const unchanged: boolean = request.update(request.source);
    void display;
    void kind;
    void render;
    void unchanged;
  },
  renderer: htmlRenderer,
};
const rootHtmlExtension: HtmlExtension = createHtmlExtension(htmlOptions);
const mathMessages: MathMessageOverrides = {
  showPreview: "Show packed preview",
};
const mathRenderer: MathRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: MathRenderRequest) => {
  const output = ownerDocument.createElement(kind === "inline" ? "span" : "div");
  output.textContent = source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return output;
};
const mathOptions: MathExtensionOptions = {
  messages: mathMessages,
  onEditSource(request: MathEditRequest) {
    const source: string = request.source;
    const render: MathRenderSnapshot = request.render;
    const unchanged: boolean = request.update(source);
    void render;
    void unchanged;
  },
  renderer: mathRenderer,
};
const rootMathExtension: MathExtension = createMathExtension(mathOptions);
const minimalMathExtension: MathExtension = createMathExtension();
const tocMessages: TocMessageOverrides = {
  emptyState: "No packed headings",
  goToHeadingLabel: (label, level, index) =>
    "Packed heading " + index + ", level " + level + ": " + label,
  navigationLabel: (occurrence, total) =>
    "Packed contents " + occurrence + " of " + total,
  untitledHeadingLabel: (level, index) =>
    "Packed untitled " + index + " at level " + level,
};
const tocOptions: TocExtensionOptions = { messages: tocMessages };
const rootTocExtension: TocExtension = createTocExtension(tocOptions);
const minimalTocExtension: TocExtension = createTocExtension();

const editor = createEditor({
  ariaLabel: "Packed editor",
  autofocus: true,
  editable: true,
  element,
  extensions: [
    rootAlertsExtension,
    rootFrontmatterExtension,
    rootDiagramsExtension,
    rootFootnotesExtension,
    rootHtmlExtension,
    rootMathExtension,
    rootTocExtension,
  ],
  initialSelection: "end",
  onChange(markdown, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void markdown;
    void origin;
  },
  onTransaction(transaction, view, context) {
    const origin: MarkdownEditorChangeOrigin = context.origin;
    void transaction;
    void view;
    void origin;
  },
  placeholder: "Start writing",
  resources: {
    links: { allowedProtocols: ["https:", "acme:"] },
    images: { maxDataUrlBytes: 4096, referrerPolicy: "no-referrer" },
    resolveUrl: ({ url }) => url,
    openUrl: ({ url }) => { void url; },
    loadImage: ({ url }) => ({ src: url }),
    assets: {
      allowedMimeTypes: ["image/*"],
      maxFileBytes: 4096,
      maxFiles: 2,
      upload: ({ file, reportProgress }) => {
        reportProgress(1);
        return { kind: "image", alt: file.name, url: "/packed.png" };
      },
    },
  },
});
const externalExtensions: readonly AnyMarkdownEditorExtension[] = [
  packedCalloutExtension,
  packedHighlightExtension,
  minimalAlertsExtension,
  minimalFrontmatterExtension,
  minimalDiagramsExtension,
  minimalFootnotesExtension,
  minimalMathExtension,
  minimalTocExtension,
];
const minimalEditor = createMinimalEditor({
  element,
  extensions: externalExtensions,
  markdown: ":::note\nPacked ==extension== consumer.\n:::",
  resources: { links: { allowRelative: false } },
});
const headingLevel: MarkdownEditorHeadingLevel = 3;
const codeBlockOptions: MarkdownEditorCodeBlockOptions = { language: "ts" };
const tableAlignment: MarkdownEditorTableAlignment = null;
const tableInsertOptions: MarkdownEditorTableInsertOptions = { columns: 3, rows: 2 };
const activeNode: MarkdownEditorActiveNode = "paragraph";
const minimalHeadingLevel: MinimalMarkdownEditorHeadingLevel = headingLevel;
const minimalCodeBlockOptions: MinimalMarkdownEditorCodeBlockOptions = codeBlockOptions;
const minimalTableAlignment: MinimalMarkdownEditorTableAlignment = tableAlignment;
const minimalTableInsertOptions: MinimalMarkdownEditorTableInsertOptions = tableInsertOptions;
const minimalActiveNode: MinimalMarkdownEditorActiveNode = activeNode;
const rootCommands: MarkdownEditorCommands = editor.commands;
const rootState: MarkdownEditorState = editor.state;
const minimalCommands: MinimalMarkdownEditorCommands = minimalEditor.commands;
const minimalState: MinimalMarkdownEditorState = minimalEditor.state;
const rootAlertsHandle = editor.extensions.get(rootAlertsExtension);
const minimalAlertsHandle = minimalEditor.extensions.get(minimalAlertsExtension);
const rootFrontmatterHandle = editor.extensions.get(rootFrontmatterExtension);
const minimalFrontmatterHandle = minimalEditor.extensions.get(minimalFrontmatterExtension);
const rootDiagramsHandle = editor.extensions.get(rootDiagramsExtension);
const minimalDiagramsHandle = minimalEditor.extensions.get(minimalDiagramsExtension);
const rootFootnotesHandle = editor.extensions.get(rootFootnotesExtension);
const minimalFootnotesHandle = minimalEditor.extensions.get(minimalFootnotesExtension);
const rootHtmlHandle = editor.extensions.get(rootHtmlExtension);
const rootMathHandle = editor.extensions.get(rootMathExtension);
const minimalMathHandle = minimalEditor.extensions.get(minimalMathExtension);
const rootTocHandle = editor.extensions.get(rootTocExtension);
const minimalTocHandle = minimalEditor.extensions.get(minimalTocExtension);
const alertsCommands: AlertsCommands = rootAlertsHandle.commands;
const alertsState: AlertsState = minimalAlertsHandle.state;
const alertsMessages: AlertsMessages = defaultAlertsMessages;
const alertKind: AlertKind = alertKinds[0];
const alertLabel: string = alertsMessages.alertLabel(
  alertKind,
  alertsMessages.noteKindLabel,
);
const invalidAlertDiagnostic: string = alertsMessages.invalidDocumentDiagnostic("danger");
const alerts: readonly AlertSnapshot[] = rootAlertsHandle.state.getAlerts();
const activeAlert: AlertSnapshot | null = minimalAlertsHandle.state.getActive();
const wrappedAlert: boolean = rootAlertsHandle.commands.wrap("warning");
const toggledAlert: boolean = minimalAlertsHandle.commands.toggle();
const changedAlertKind: boolean = rootAlertsHandle.commands.setKind("caution");
const unwrappedAlert: boolean = minimalAlertsHandle.commands.unwrap();
const canWrapAlert: boolean = rootAlertsHandle.state.canWrap("important");
const canToggleAlert: boolean = minimalAlertsHandle.state.canToggle("tip");
const canSetAlertKind: boolean = rootAlertsHandle.state.canSetKind("warning");
const canUnwrapAlert: boolean = minimalAlertsHandle.state.canUnwrap();
const alertIsActive: boolean = rootAlertsHandle.state.isActive();
const rootFrontmatterSnapshot: FrontmatterSnapshot | null =
  rootFrontmatterHandle.state.getSnapshot();
const frontmatterMessages: FrontmatterMessages = defaultFrontmatterMessages;
const frontmatterMaximum: number = FRONTMATTER_MAX_SOURCE_BYTES;
const insertedFrontmatter: boolean = rootFrontmatterHandle.commands.insert(
  "---\ntitle: Packed\n---",
);
const updatedFrontmatter: boolean = minimalFrontmatterHandle.commands.update(
  "---\ntitle: Minimal\n---",
);
const diagramTarget: DiagramNodeTarget = {
  identity: 1,
  info: "mermaid theme=neutral",
  kind: "mermaid",
  position: 0,
  source: "graph TD\nA --> B",
};
const diagramCommands: DiagramCommands = rootDiagramsHandle.commands;
const diagramState: DiagramState = minimalDiagramsHandle.state;
const diagramSnapshot: DiagramsSnapshot = rootDiagramsHandle.state.getSnapshot();
const diagramNode: DiagramNodeSnapshot | null =
  diagramState.getNode(diagramTarget);
const diagramNodes: readonly DiagramNodeSnapshot[] =
  rootDiagramsHandle.state.getNodes("mermaid");
const diagramKind: DiagramKind | null = diagramState.getKind(diagramTarget);
const diagramDiagnostics: readonly DiagramDiagnostic[] =
  rootDiagramsHandle.state.getDiagnostics();
const diagramRender: DiagramRenderSnapshot | null =
  diagramState.getRenderState(diagramTarget);
const diagramInsert: DiagramInsert = {
  info: "geojson preview=packed",
  source: '{"type":"Point","coordinates":[0,0]}',
};
const insertedDiagram: boolean = rootDiagramsHandle.commands.insert(diagramInsert);
const convertedDiagram: boolean =
  minimalDiagramsHandle.commands.convert(diagramTarget, "stl");
const convertedCodeBlock: boolean =
  rootDiagramsHandle.commands.convertCodeBlock("topojson");
const restoredCodeBlock: boolean =
  minimalDiagramsHandle.commands.restoreCodeBlock(diagramTarget);
const diagramUpdate: DiagramUpdate = {
  info: "mermaid theme=dark",
  source: "graph LR\nA --> B",
};
const updatedDiagram: boolean = diagramCommands.update(diagramTarget, diagramUpdate);
const removedDiagram: boolean = diagramCommands.remove(diagramTarget);
const toggledDiagram: boolean = diagramCommands.togglePreview(diagramTarget);
const retriedDiagram: boolean = diagramCommands.retryPreview(diagramTarget);
const publicDiagramMessages: DiagramMessages = defaultDiagramMessages;
const diagramDiagnosticCode: DiagramDiagnosticCode = diagramDiagnosticCodes[0];
const diagramRenderErrorCode: DiagramRenderErrorCode = diagramRenderErrorCodes[0];
const diagramRenderStatus: DiagramRenderStatus = "rendering";
const diagramLimits: readonly number[] = [
  DIAGRAM_MAX_SOURCE_BYTES,
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
];
const diagramViewportMargin: string = DIAGRAM_VIEWPORT_MARGIN;
const footnoteTarget: FootnoteDefinitionTarget = { label: "note", occurrence: 1 };
const footnoteRenameOptions: FootnoteRenameOptions = { references: "rename" };
const footnoteRemoveOptions: FootnoteRemoveOptions = { references: "preserve" };
const footnotesSnapshot: FootnotesSnapshot = rootFootnotesHandle.state.getSnapshot();
const footnoteDefinition: FootnoteDefinitionSnapshot | null =
  rootFootnotesHandle.state.getDefinition(footnoteTarget);
const footnoteReferences: readonly FootnoteReferenceSnapshot[] =
  rootFootnotesHandle.state.getReferences("note");
const footnoteDiagnostics: readonly FootnoteDiagnostic[] =
  rootFootnotesHandle.state.getDiagnostics();
const footnoteDiagnosticCode: FootnoteDiagnosticCode = footnoteDiagnosticCodes[0];
const footnotesMessages: FootnotesMessages = defaultFootnotesMessages;
const insertedFootnoteReference: boolean =
  rootFootnotesHandle.commands.insertReference("note");
const insertedFootnoteDefinition: boolean =
  minimalFootnotesHandle.commands.insertDefinition("note");
const navigatedToFootnoteDefinition: boolean =
  rootFootnotesHandle.commands.navigateToDefinition("note", 1);
const navigatedToFootnoteReference: boolean =
  rootFootnotesHandle.commands.navigateToReference("note", 1);
const renamedFootnote: boolean = rootFootnotesHandle.commands.renameDefinition(
  footnoteTarget,
  "renamed",
  footnoteRenameOptions,
);
const removedFootnote: boolean = minimalFootnotesHandle.commands.removeDefinition(
  footnoteTarget,
  footnoteRemoveOptions,
);
const htmlTarget: HtmlNodeTarget = {
  display: "block",
  identity: 1,
  kind: "html-block",
  position: 0,
  source: "<div>packed</div>",
};
const htmlCommands: HtmlCommands = rootHtmlHandle.commands;
const htmlState: HtmlState = rootHtmlHandle.state;
const htmlSnapshot: HtmlSnapshot = htmlState.getSnapshot();
const htmlNode: HtmlNodeSnapshot | null = htmlState.getNode(htmlTarget);
const htmlNodes: readonly HtmlNodeSnapshot[] = htmlState.getNodes("block");
const htmlDiagnostics: readonly HtmlDiagnostic[] = htmlState.getDiagnostics();
const htmlRender: HtmlRenderSnapshot | null = htmlState.getRenderState(htmlTarget);
const updatedHtml: boolean = htmlCommands.update(htmlTarget, "<aside>packed</aside>");
const removedHtml: boolean = htmlCommands.remove(htmlTarget);
const toggledHtml: boolean = htmlCommands.togglePreview(htmlTarget);
const retriedHtml: boolean = htmlCommands.retryPreview(htmlTarget);
const publicHtmlMessages: HtmlMessages = defaultHtmlMessages;
const htmlDisplay: HtmlDisplay = htmlDisplays[0];
const htmlSourceKind: HtmlSourceKind = htmlSourceKinds[0];
const htmlDiagnosticCode: HtmlDiagnosticCode = htmlDiagnosticCodes[0];
const htmlRenderErrorCode: HtmlRenderErrorCode = htmlRenderErrorCodes[0];
const htmlRenderStatus: HtmlRenderStatus = "rendering";
const htmlLimits: readonly number[] = [
  HTML_MAX_SOURCE_BYTES,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
];
const mathTarget: MathNodeTarget = {
  identity: 1,
  kind: "inline",
  position: 1,
  source: "x",
};
const mathSnapshot: MathSnapshot = rootMathHandle.state.getSnapshot();
const mathNodes: readonly MathNodeSnapshot[] = minimalMathHandle.state.getNodes();
const mathDiagnostics: readonly MathDiagnostic[] = rootMathHandle.state.getDiagnostics();
const mathRender: MathRenderSnapshot | null = rootMathHandle.state.getRenderState(mathTarget);
const insertedInlineMath: boolean = rootMathHandle.commands.insertInline("x");
const insertedBlockMath: boolean = minimalMathHandle.commands.insertBlock("x\ny");
const updatedMath: boolean = rootMathHandle.commands.update(mathTarget, "y");
const removedMath: boolean = rootMathHandle.commands.remove(mathTarget);
const convertedMath: boolean = rootMathHandle.commands.convert(mathTarget, "block");
const toggledMath: boolean = rootMathHandle.commands.togglePreview(mathTarget);
const retriedMath: boolean = rootMathHandle.commands.retryPreview(mathTarget);
const publicMathMessages: MathMessages = defaultMathMessages;
const mathLimits: readonly number[] = [
  MATH_MAX_SOURCE_BYTES,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_CONCURRENT_RENDERS,
];
const mathKind = mathKinds[0];
const mathDiagnosticCode = mathDiagnosticCodes[0];
const mathRenderErrorCode = mathRenderErrorCodes[0];
const tocCommands: TocCommands = rootTocHandle.commands;
const tocState: TocState = minimalTocHandle.state;
const tocSnapshot: TocSnapshot = rootTocHandle.state.getSnapshot();
const tocHeadings: readonly TocHeadingSnapshot[] = tocSnapshot.headings;
const tocNodes: readonly TocNodeSnapshot[] = tocSnapshot.tocs;
const tocHeading: TocHeadingSnapshot = {
  label: "Packed heading",
  level: 2,
  position: 1,
};
const tocNode: TocNodeSnapshot = { position: 0 };
const tocHeadingLevel: TocHeadingLevel = tocHeading.level;
const tocPublicMessages: TocMessages = defaultTocMessages;
const tocNavigationLabel: string = tocPublicMessages.navigationLabel(1, 2);
const tocEntryLabel: string = tocPublicMessages.goToHeadingLabel(
  tocHeading.label,
  tocHeading.level,
  1,
);
const insertedToc: boolean = rootTocHandle.commands.insert();
const removedToc: boolean = minimalTocHandle.commands.remove();
const canInsertToc: boolean = rootTocHandle.state.canInsert();
const canRemoveToc: boolean = minimalTocHandle.state.canRemove();
const tocIsActive: boolean = rootTocHandle.state.isActive();
const closedTransaction: Transaction = closeHistory(transaction);
void alertsCommands;
void alertsState;
void alertsMessages;
void alertKind;
void alertLabel;
void invalidAlertDiagnostic;
void alerts;
void activeAlert;
void wrappedAlert;
void toggledAlert;
void changedAlertKind;
void unwrappedAlert;
void canWrapAlert;
void canToggleAlert;
void canSetAlertKind;
void canUnwrapAlert;
void alertIsActive;
void rootFrontmatterSnapshot;
void frontmatterMessages;
void frontmatterMaximum;
void insertedFrontmatter;
void updatedFrontmatter;
void diagramCommands;
void diagramState;
void diagramSnapshot;
void diagramNode;
void diagramNodes;
void diagramKind;
void diagramDiagnostics;
void diagramRender;
void diagramInsert;
void insertedDiagram;
void convertedDiagram;
void convertedCodeBlock;
void restoredCodeBlock;
void diagramUpdate;
void updatedDiagram;
void removedDiagram;
void toggledDiagram;
void retriedDiagram;
void publicDiagramMessages;
void diagramDiagnosticCode;
void diagramRenderErrorCode;
void diagramRenderStatus;
void diagramLimits;
void diagramViewportMargin;
void footnotesSnapshot;
void footnoteDefinition;
void footnoteReferences;
void footnoteDiagnostics;
void footnoteDiagnosticCode;
void footnotesMessages;
void insertedFootnoteReference;
void insertedFootnoteDefinition;
void navigatedToFootnoteDefinition;
void navigatedToFootnoteReference;
void renamedFootnote;
void removedFootnote;
void htmlCommands;
void htmlState;
void htmlSnapshot;
void htmlNode;
void htmlNodes;
void htmlDiagnostics;
void htmlRender;
void updatedHtml;
void removedHtml;
void toggledHtml;
void retriedHtml;
void publicHtmlMessages;
void htmlDisplay;
void htmlSourceKind;
void htmlDiagnosticCode;
void htmlRenderErrorCode;
void htmlRenderStatus;
void htmlLimits;
void mathSnapshot;
void mathNodes;
void mathDiagnostics;
void mathRender;
void insertedInlineMath;
void insertedBlockMath;
void updatedMath;
void removedMath;
void convertedMath;
void toggledMath;
void retriedMath;
void publicMathMessages;
void mathLimits;
void mathKind;
void mathDiagnosticCode;
void mathRenderErrorCode;
void tocCommands;
void tocState;
void tocSnapshot;
void tocHeadings;
void tocNodes;
void tocHeading;
void tocNode;
void tocHeadingLevel;
void tocPublicMessages;
void tocNavigationLabel;
void tocEntryLabel;
void insertedToc;
void removedToc;
void canInsertToc;
void canRemoveToc;
void tocIsActive;
void closedTransaction;

function exerciseStructuralSurface(
  commands: MarkdownEditorCommands,
  state: MarkdownEditorState,
  values: {
    activeNode: MarkdownEditorActiveNode;
    codeBlockOptions: MarkdownEditorCodeBlockOptions;
    headingLevel: MarkdownEditorHeadingLevel;
    tableAlignment: MarkdownEditorTableAlignment;
    tableInsertOptions: MarkdownEditorTableInsertOptions;
  },
) {
  const commandResults: boolean[] = [
    commands.setParagraph(),
    commands.setHeading(values.headingLevel),
    commands.toggleBlockquote(),
    commands.toggleBulletList(),
    commands.toggleOrderedList(),
    commands.sinkListItem(),
    commands.liftListItem(),
    commands.toggleTaskList(),
    commands.setTaskChecked(true),
    commands.insertHardBreak(),
    commands.insertHorizontalRule(),
    commands.setCodeBlock(values.codeBlockOptions),
    commands.insertTable(values.tableInsertOptions),
    commands.addTableRow(),
    commands.addTableColumn(),
    commands.deleteTableRow(),
    commands.deleteTableColumn(),
    commands.setTableColumnAlignment(values.tableAlignment),
    commands.deleteTable(),
  ];
  const canResults: boolean[] = [
    state.can.removeLink(),
    state.can.removeImage(),
    state.can.setParagraph(),
    state.can.setHeading(values.headingLevel),
    state.can.toggleBlockquote(),
    state.can.toggleBulletList(),
    state.can.toggleOrderedList(),
    state.can.sinkListItem(),
    state.can.liftListItem(),
    state.can.toggleTaskList(),
    state.can.setTaskChecked(false),
    state.can.insertHardBreak(),
    state.can.insertHorizontalRule(),
    state.can.setCodeBlock(values.codeBlockOptions),
    state.can.insertTable(values.tableInsertOptions),
    state.can.addTableRow(),
    state.can.addTableColumn(),
    state.can.deleteTableRow(),
    state.can.deleteTableColumn(),
    state.can.setTableColumnAlignment(values.tableAlignment),
    state.can.deleteTable(),
  ];
  const activeResults: boolean[] = [
    state.isActive.node(values.activeNode),
    state.isActive.paragraph(),
    state.isActive.heading(),
    state.isActive.heading(values.headingLevel),
    state.isActive.blockquote(),
    state.isActive.bulletList(),
    state.isActive.orderedList(),
    state.isActive.taskList(),
    state.isActive.taskChecked(),
    state.isActive.taskChecked(false),
    state.isActive.hardBreak(),
    state.isActive.horizontalRule(),
    state.isActive.codeBlock(),
    state.isActive.codeBlock(values.codeBlockOptions),
    state.isActive.table(),
    state.isActive.tableColumnAlignment(values.tableAlignment),
  ];
  void commandResults;
  void canResults;
  void activeResults;
}

exerciseStructuralSurface(rootCommands, rootState, {
  activeNode,
  codeBlockOptions,
  headingLevel,
  tableAlignment,
  tableInsertOptions,
});
exerciseStructuralSurface(minimalCommands, minimalState, {
  activeNode: minimalActiveNode,
  codeBlockOptions: minimalCodeBlockOptions,
  headingLevel: minimalHeadingLevel,
  tableAlignment: minimalTableAlignment,
  tableInsertOptions: minimalTableInsertOptions,
});
const staticDefinition = defineMarkdownEditorExtension({
  name: "@pack-smoke/static",
  version: "1.0.0",
  compatibility: { markora: "^0.1.0", extensionApi: "^1.0.0" },
});
const callbackOptions: CreateEditorOptions = {
  element,
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, view) {
    void transaction;
    void view;
  },
};
const options: UpdateEditorOptions = {
  editable: false,
  onChange(markdown) {
    void markdown;
  },
  onTransaction(transaction, view) {
    void transaction;
    void view;
  },
  placeholder: null,
};
editor.updateOptions(options);
const unsubscribe = editor.subscribe("selection", (event: MarkdownEditorEventMap["selection"]) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  event.selection.kind satisfies "all" | "managed-block" | "node" | "other" | "table-cell" | "text";
  void origin;
});
const unsubscribeUpdate = editor.subscribe("update", (event: MarkdownEditorEventMap["update"]) => {
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void origin;
});
const unsubscribeState = editor.subscribe("state", (event: MarkdownEditorStateEvent) => {
  const docChanged: boolean = event.docChanged;
  const selectionChanged: boolean = event.selectionChanged;
  const origin: MarkdownEditorChangeOrigin = event.origin;
  void docChanged;
  void selectionChanged;
  void origin;
});
const unsubscribeMinimalState = minimalEditor.subscribe("state", (event: MinimalMarkdownEditorStateEvent) => {
  const docChanged: boolean = event.docChanged;
  const selectionChanged: boolean = event.selectionChanged;
  void docChanged;
  void selectionChanged;
});
const unsubscribeAsset = editor.subscribe("asset", (event: MarkdownEditorEventMap["asset"]) => {
  const status = event.upload.status;
  void status;
});
editor.assets.getUploads();
const reconciled: boolean = editor.commands.reconcileMarkdown("# Reconciled");
editor.commands.resetMarkdown("# Reset", { emitChange: true });
const extensionOrigin: MarkdownEditorExtensionOrigin = "extension:pack-smoke";
const taggedTransaction = setMarkdownEditorTransactionOrigin(
  editor.view.state.tr,
  extensionOrigin,
);
const transactionOrigin: MarkdownEditorChangeOrigin | undefined =
  getMarkdownEditorTransactionOrigin(taggedTransaction);
unsubscribe();
unsubscribeUpdate();
unsubscribeState();
unsubscribeMinimalState();
unsubscribeAsset();
editor.focus("start");
editor.blur();
editor.destroy();
minimalEditor.destroy();
MARKORA_EXTENSION_API_VERSION satisfies "1.4.0";
const unavailableSourceSlice: string | null =
  sliceMarkdownEditorOriginalSourceLines({}, 0, 1);
void new MarkdownEditorDestroyedError("focus the editor");
void staticDefinition;
void callbackOptions;
void reconciled;
void transactionOrigin;
void unavailableSourceSlice;
// @ts-expect-error Alert commands reject unsupported kinds.
rootAlertsHandle.commands.wrap("danger");
// @ts-expect-error Alert factory options reject undeclared keys.
createAlertsExtension({ unknownOption: true });
// @ts-expect-error Alert messages reject undeclared keys.
createAlertsExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error The public alert kind tuple is immutable.
alertKinds.push("note");
// @ts-expect-error Public alert snapshot arrays are immutable.
alerts.push({ kind: "note", position: 0 });
// @ts-expect-error Front matter source commands only accept strings.
rootFrontmatterHandle.commands.update(42);
// @ts-expect-error Front matter messages reject undeclared keys.
createFrontmatterExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error Diagram kinds are a closed public union.
const invalidDiagramKind: DiagramKind = "unknown-diagram";
// @ts-expect-error Diagram insert source must be a string.
rootDiagramsHandle.commands.insert({ info: "mermaid", source: 42 });
// @ts-expect-error Diagram targets require their stale-safe occurrence identity.
rootDiagramsHandle.commands.remove({
  info: "mermaid",
  kind: "mermaid",
  position: 0,
  source: "graph TD",
});
// @ts-expect-error Diagram renderers return owner-document DOM, never strings.
createDiagramsExtension({ renderers: { mermaid: () => "<svg></svg>" } });
// @ts-expect-error Diagram messages reject undeclared keys.
createDiagramsExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error Public diagram snapshot arrays are immutable.
diagramSnapshot.nodes.push(diagramTarget);
void invalidDiagramKind;
// @ts-expect-error Footnote labels must be strings.
rootFootnotesHandle.commands.insertReference(42);
// @ts-expect-error Footnote rename requires an explicit reference policy.
rootFootnotesHandle.commands.renameDefinition(footnoteTarget, "renamed", {});
// @ts-expect-error Footnote remove policies cannot invent orphan behavior.
minimalFootnotesHandle.commands.removeDefinition(footnoteTarget, { references: "rename" });
// @ts-expect-error Footnote messages reject undeclared keys.
createFootnotesExtension({ messages: { unknownLabel: () => "Unknown" } });
// @ts-expect-error HTML source commands accept strings only.
rootHtmlHandle.commands.update(htmlTarget, 42);
// @ts-expect-error HTML targets require an opaque occurrence identity.
rootHtmlHandle.commands.remove({
  display: "block",
  kind: "html-block",
  position: 0,
  source: "<div>packed</div>",
});
// @ts-expect-error HTML renderers return owner-document DOM, never strings.
createHtmlExtension({ renderer: () => "<p>packed</p>" });
// @ts-expect-error HTML messages reject undeclared keys.
createHtmlExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error HTML source kinds are a closed public union.
const invalidHtmlKind: HtmlSourceKind = "script";
// @ts-expect-error Public HTML snapshots are immutable.
htmlSnapshot.nodes.push(htmlTarget);
void invalidHtmlKind;
// @ts-expect-error Math source commands accept strings only.
rootMathHandle.commands.insertInline(42);
// @ts-expect-error Math targets require their stale-safe source identity.
rootMathHandle.commands.remove({ kind: "inline", position: 1 });
// @ts-expect-error Math renderers return DOM, not HTML strings.
createMathExtension({ renderer: () => "<span>x</span>" });
// @ts-expect-error Math messages reject undeclared keys.
createMathExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error TOC commands accept no marker or position arguments.
rootTocHandle.commands.insert("[TOC]");
// @ts-expect-error TOC remove targets are selected through editor state.
minimalTocHandle.commands.remove({ position: 0 });
// @ts-expect-error TOC factory options reject undeclared keys.
createTocExtension({ unknownOption: true });
// @ts-expect-error TOC messages reject undeclared keys.
createTocExtension({ messages: { unknownLabel: "Unknown" } });
// @ts-expect-error TOC navigation formatter arguments are numeric.
defaultTocMessages.navigationLabel("first", 2);
// @ts-expect-error TOC heading levels are closed to one through six.
const invalidTocHeadingLevel: TocHeadingLevel = 7;
// @ts-expect-error Public TOC heading arrays are immutable.
tocSnapshot.headings.push(tocHeading);
// @ts-expect-error Public TOC node snapshots are immutable.
tocNode.position = 2;
void invalidTocHeadingLevel;
