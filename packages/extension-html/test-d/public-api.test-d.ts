import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
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
} from "../src/index";

const messages: HtmlMessageOverrides = {
  editSource: "Edit source",
  sourceLabel: (kind) => `${kind} source`,
};
const renderer: HtmlRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: HtmlRenderRequest) => {
  const element = ownerDocument.createElement("p");
  element.textContent = `${kind}: ${source}`;
  signal.addEventListener("abort", () => undefined, { once: true });
  return element;
};
const asyncRenderer: HtmlRenderer = async ({ ownerDocument }) => (
  ownerDocument.createDocumentFragment()
);
const options: HtmlExtensionOptions = {
  messages,
  onEditSource(request: HtmlEditRequest) {
    const display: HtmlDisplay = request.display;
    const kind: HtmlSourceKind = request.kind;
    const render: HtmlRenderSnapshot = request.render;
    const updated: boolean = request.update(request.source);
    const removed: boolean = request.remove();
    void display;
    void kind;
    void render;
    void updated;
    void removed;
  },
  renderer,
};
const extension: HtmlExtension = createHtmlExtension(options);
createHtmlExtension({ renderer: asyncRenderer });

declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const commands: HtmlCommands = handle.commands;
const state: HtmlState = handle.state;
const target: HtmlNodeTarget = {
  display: "block",
  identity: 1,
  kind: "html-block",
  position: 0,
  source: "<div>x</div>",
};
const updated: boolean = commands.update(target, "<aside>x</aside>");
const removed: boolean = commands.remove(target);
const toggled: boolean = commands.togglePreview(target);
const retried: boolean = commands.retryPreview(target);
const node: HtmlNodeSnapshot | null = state.getNode(target);
const nodes: readonly HtmlNodeSnapshot[] = state.getNodes("block");
const diagnostics: readonly HtmlDiagnostic[] = state.getDiagnostics();
const renderState: HtmlRenderSnapshot | null = state.getRenderState(target);
const snapshot: HtmlSnapshot = state.getSnapshot();
const display: HtmlDisplay = htmlDisplays[0];
const kind: HtmlSourceKind = htmlSourceKinds[0];
const diagnosticCode: HtmlDiagnosticCode = htmlDiagnosticCodes[0];
const renderCode: HtmlRenderErrorCode = htmlRenderErrorCodes[0];
const renderStatus: HtmlRenderStatus = "rendering";
const defaults: HtmlMessages = defaultHtmlMessages;
const sourceMaximum: 262_144 = HTML_MAX_SOURCE_BYTES;
const concurrentMaximum: 4 = HTML_MAX_CONCURRENT_RENDERS;
const nodeMaximum: 4_096 = HTML_MAX_RENDERED_NODES;
const depthMaximum: 128 = HTML_MAX_RENDERED_DEPTH;
const outputMaximum: 1_048_576 = HTML_MAX_RENDERED_OUTPUT_BYTES;
const attributeMaximum: 64 = HTML_MAX_ATTRIBUTES_PER_ELEMENT;
declare const editRequest: HtmlEditRequest;
const requestRemoved: boolean = commands.remove(editRequest);
const requestNode: HtmlNodeSnapshot | null = state.getNode(editRequest);
void updated;
void removed;
void toggled;
void retried;
void node;
void nodes;
void diagnostics;
void renderState;
void snapshot;
void display;
void kind;
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
void requestRemoved;
void requestNode;

// @ts-expect-error HTML source must be a string.
commands.update(target, 42);

// @ts-expect-error Stale-safe targets require an opaque occurrence identity.
commands.remove({ display: "block", kind: "html-block", position: 0, source: "<p>x</p>" });

// @ts-expect-error Renderer output is owner-document DOM, never an HTML string.
createHtmlExtension({ renderer: () => "<p>x</p>" });

// @ts-expect-error Only exact HTML source kinds are accepted.
const invalidKind: HtmlSourceKind = "script";
void invalidKind;

// @ts-expect-error Message overrides are restricted to the package contract.
createHtmlExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Runtime options use a closed factory surface.
createHtmlExtension({ renderer, unknownOption: true });

// @ts-expect-error Snapshots are immutable.
snapshot.nodes.push(target);
