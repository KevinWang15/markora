import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
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
  type MathCommands,
  type MathDiagnostic,
  type MathDiagnosticCode,
  type MathEditRequest,
  type MathExtension,
  type MathExtensionOptions,
  type MathKind,
  type MathMessageOverrides,
  type MathMessages,
  type MathNodeSnapshot,
  type MathNodeTarget,
  type MathRenderErrorCode,
  type MathRenderer,
  type MathRenderRequest,
  type MathRenderSnapshot,
  type MathRenderStatus,
  type MathSnapshot,
  type MathState,
} from "../src/index";

const messages: MathMessageOverrides = {
  editSource: "Edit formula",
  previewLabel: (kind) => `${kind} formula preview`,
};
const renderer: MathRenderer = ({
  kind,
  ownerDocument,
  signal,
  source,
}: MathRenderRequest) => {
  const element = ownerDocument.createElement(kind === "inline" ? "span" : "div");
  element.textContent = source;
  signal.addEventListener("abort", () => undefined, { once: true });
  return element;
};
const asyncRenderer: MathRenderer = async ({ ownerDocument }) => (
  ownerDocument.createDocumentFragment()
);
const options: MathExtensionOptions = {
  messages,
  onEditSource(request: MathEditRequest) {
    const kind: MathKind = request.kind;
    const position: number = request.position;
    const source: string = request.source;
    const render: MathRenderSnapshot = request.render;
    const updated: boolean = request.update(source);
    const removed: boolean = request.remove();
    const converted: boolean = request.convert(kind);
    void position;
    void render;
    void updated;
    void removed;
    void converted;
  },
  renderer,
};
const extension: MathExtension = createMathExtension(options);
createMathExtension({ renderer: asyncRenderer });

declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const commands: MathCommands = handle.commands;
const state: MathState = handle.state;
const target: MathNodeTarget = {
  identity: 1,
  kind: "inline",
  position: 1,
  source: "x",
};
const insertedInline: boolean = commands.insertInline("x");
const insertedBlock: boolean = commands.insertBlock("x\ny");
const editing: boolean = commands.edit(target);
const editingSelection: boolean = commands.editSelection("block");
const finishedEditing: boolean = commands.finishEditing();
const updated: boolean = commands.update(target, "y");
const removed: boolean = commands.remove(target);
const converted: boolean = commands.convert(target, "block");
const toggled: boolean = commands.togglePreview(target);
const retried: boolean = commands.retryPreview(target);
const node: MathNodeSnapshot | null = state.getNode(target);
const nodes: readonly MathNodeSnapshot[] = state.getNodes("inline");
const diagnostics: readonly MathDiagnostic[] = state.getDiagnostics();
const renderState: MathRenderSnapshot | null = state.getRenderState(target);
const snapshot: MathSnapshot = state.getSnapshot();
const kind: MathKind = mathKinds[0];
const diagnosticCode: MathDiagnosticCode = mathDiagnosticCodes[0];
const renderCode: MathRenderErrorCode = mathRenderErrorCodes[0];
const renderStatus: MathRenderStatus = "rendering";
const defaults: MathMessages = defaultMathMessages;
const maximum: 65_536 = MATH_MAX_SOURCE_BYTES;
const maximumConcurrentRenders: 4 = MATH_MAX_CONCURRENT_RENDERS;
const maximumRenderedNodes: 4_096 = MATH_MAX_RENDERED_NODES;
const maximumRenderedOutputBytes: 1_048_576 = MATH_MAX_RENDERED_OUTPUT_BYTES;
const renderStatuses = [
  "source",
  "offscreen",
  "queued",
  "rendering",
  "rendered",
  "error",
  "source-too-large",
] as const satisfies readonly MathRenderStatus[];
void insertedInline;
void insertedBlock;
void updated;
void removed;
void converted;
void toggled;
void retried;
void node;
void nodes;
void diagnostics;
void renderState;
void snapshot;
void kind;
void diagnosticCode;
void renderCode;
void renderStatus;
void defaults;
void maximum;
void maximumConcurrentRenders;
void maximumRenderedNodes;
void maximumRenderedOutputBytes;
void renderStatuses;

// @ts-expect-error Math source must be a string.
commands.insertInline(42);

// @ts-expect-error Conversion kind is closed to inline and block.
commands.convert(target, "display");

// @ts-expect-error Stale-safe targets require their opaque node identity.
commands.remove({ kind: "inline", position: 1 });

// @ts-expect-error Renderers return owner-document DOM, never HTML strings.
createMathExtension({ renderer: () => "<span>x</span>" });

// @ts-expect-error Render status names are a closed contract.
const invalidRenderStatus: MathRenderStatus = "complete";
void invalidRenderStatus;

// @ts-expect-error Message overrides are restricted to the package contract.
createMathExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Runtime-only options still use the frozen factory surface.
createMathExtension({ renderer, unknownOption: true });

// @ts-expect-error Snapshots are immutable.
snapshot.nodes.push({ identity: 1, kind: "inline", position: 1, source: "x", render: {
  enabled: true,
  errorCode: null,
  status: "source",
} });
