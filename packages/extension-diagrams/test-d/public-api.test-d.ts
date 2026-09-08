import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
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
  type DiagramRenderer,
  type DiagramRenderErrorCode,
  type DiagramRenderRequest,
  type DiagramRenderSnapshot,
  type DiagramRenderStatus,
  type DiagramsExtension,
  type DiagramsSnapshot,
  type DiagramState,
  type DiagramUpdate,
} from "../src/index";

const messages: DiagramMessageOverrides = {
  showPreview: "Preview diagram",
  sourceLabel: (kind, info) => `${kind}: ${info}`,
};
const renderer: DiagramRenderer = ({
  info,
  kind,
  ownerDocument,
  signal,
  source,
}: DiagramRenderRequest) => {
  const svg = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.textContent = `${kind}:${info}:${source}`;
  signal.addEventListener("abort", () => undefined, { once: true });
  return svg;
};
const options: DiagramExtensionOptions = {
  messages,
  onEditSource(request: DiagramEditRequest) {
    const kind: DiagramKind = request.kind;
    const render: DiagramRenderSnapshot = request.render;
    const converted: boolean = request.convert("geojson");
    const updated: boolean = request.update({ info: request.info, source: request.source });
    const restored: boolean = request.restoreCodeBlock();
    const removed: boolean = request.remove();
    void kind;
    void render;
    void converted;
    void updated;
    void restored;
    void removed;
  },
  renderers: { mermaid: renderer, geojson: async ({ ownerDocument }) => ownerDocument.createDocumentFragment() },
};
const extension: DiagramsExtension = createDiagramsExtension(options);

declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const commands: DiagramCommands = handle.commands;
const state: DiagramState = handle.state;
const target: DiagramNodeTarget = {
  identity: 1,
  info: "mermaid theme=neutral",
  kind: "mermaid",
  position: 0,
  source: "graph TD",
};
const insertion: DiagramInsert = { info: "mermaid", source: "graph TD" };
const update: DiagramUpdate = { source: "graph LR" };
const inserted: boolean = commands.insert(insertion);
const converted: boolean = commands.convert(target, "geojson");
const convertedCode: boolean = commands.convertCodeBlock("stl");
const updated: boolean = commands.update(target, update);
const restored: boolean = commands.restoreCodeBlock(target);
const removed: boolean = commands.remove(target);
const toggled: boolean = commands.togglePreview(target);
const retried: boolean = commands.retryPreview(target);
const node: DiagramNodeSnapshot | null = state.getNode(target);
const nodes: readonly DiagramNodeSnapshot[] = state.getNodes("mermaid");
const kind: DiagramKind | null = state.getKind(target);
const diagnostics: readonly DiagramDiagnostic[] = state.getDiagnostics();
const renderState: DiagramRenderSnapshot | null = state.getRenderState(target);
const snapshot: DiagramsSnapshot = state.getSnapshot();
const diagnosticCode: DiagramDiagnosticCode = diagramDiagnosticCodes[0];
const renderCode: DiagramRenderErrorCode = diagramRenderErrorCodes[0];
const renderStatus: DiagramRenderStatus = "rendering";
const defaults: DiagramMessages = defaultDiagramMessages;
const sourceMaximum: 262_144 = DIAGRAM_MAX_SOURCE_BYTES;
const concurrentMaximum: 4 = DIAGRAM_MAX_CONCURRENT_RENDERS;
const nodeMaximum: 4_096 = DIAGRAM_MAX_RENDERED_NODES;
const depthMaximum: 128 = DIAGRAM_MAX_RENDERED_DEPTH;
const outputMaximum: 1_048_576 = DIAGRAM_MAX_RENDERED_OUTPUT_BYTES;
const attributeMaximum: 64 = DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT;
const viewportMargin: "800px" = DIAGRAM_VIEWPORT_MARGIN;
const firstKind: DiagramKind = diagramKinds[0];
declare const editRequest: DiagramEditRequest;
const requestRemoved: boolean = commands.remove(editRequest);
void inserted;
void insertion;
void converted;
void convertedCode;
void updated;
void update;
void restored;
void removed;
void toggled;
void retried;
void node;
void nodes;
void kind;
void diagnostics;
void renderState;
void snapshot;
void diagnosticCode;
void renderCode;
void renderStatus;
void defaults;
void sourceMaximum;
void concurrentMaximum;
void nodeMaximum;
void depthMaximum;
void outputMaximum;
void attributeMaximum;
void viewportMargin;
void firstKind;
void requestRemoved;

// @ts-expect-error Insertion requires a complete string info/source object.
commands.insert({ info: "mermaid", source: 42 });

// @ts-expect-error Diagram kinds are a closed supported vocabulary.
commands.convert(target, "unknown-diagram");

// @ts-expect-error Stale-safe targets require an opaque occurrence identity.
commands.remove({ info: "mermaid", kind: "mermaid", position: 0, source: "x" });

// @ts-expect-error Renderer output is owner-document DOM, never an HTML/SVG string.
createDiagramsExtension({ renderers: { mermaid: () => "<svg></svg>" } });

// @ts-expect-error Message overrides are restricted to the diagram contract.
createDiagramsExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Runtime options use a closed factory surface.
createDiagramsExtension({ renderers: { mermaid: renderer }, unknownOption: true });

// @ts-expect-error Snapshots are immutable.
snapshot.nodes.push(target);
