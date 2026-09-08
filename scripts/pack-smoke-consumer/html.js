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
} from "markora-extension-html";
import "markora-extension-html/styles.css";

export const packedHtmlDefinitions = [
  createHtmlExtension(),
  createHtmlExtension({
    messages: { showPreview: "Show packed HTML preview" },
  }),
];

export const packedHtmlSurface = [
  HTML_MAX_SOURCE_BYTES,
  HTML_MAX_RENDERED_NODES,
  HTML_MAX_RENDERED_DEPTH,
  HTML_MAX_RENDERED_OUTPUT_BYTES,
  HTML_MAX_ATTRIBUTES_PER_ELEMENT,
  HTML_MAX_CONCURRENT_RENDERS,
  defaultHtmlMessages.blockKindLabel,
  htmlDiagnosticCodes.join(","),
  htmlDisplays.join(","),
  htmlRenderErrorCodes.join(","),
  htmlSourceKinds.join(","),
  ...packedHtmlDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
