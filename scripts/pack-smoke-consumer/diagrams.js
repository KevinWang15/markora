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
} from "markora-extension-diagrams";
import "markora-extension-diagrams/styles.css";

export const packedDiagramDefinitions = [
  createDiagramsExtension(),
  createDiagramsExtension({
    messages: {
      kindLabel: (kind) => kind.toUpperCase(),
      showPreview: "Preview packed diagram",
    },
    renderers: {},
  }),
];

export const packedDiagramSurface = [
  DIAGRAM_MAX_SOURCE_BYTES,
  DIAGRAM_MAX_ATTRIBUTES_PER_ELEMENT,
  DIAGRAM_MAX_RENDERED_NODES,
  DIAGRAM_MAX_RENDERED_DEPTH,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_VIEWPORT_MARGIN,
  diagramKinds.join(","),
  diagramDiagnosticCodes.join(","),
  diagramRenderErrorCodes.join(","),
  defaultDiagramMessages.sourceLabel("mermaid", "mermaid theme=neutral"),
  Object.keys(defaultDiagramMessages).sort().join(","),
  ...packedDiagramDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
