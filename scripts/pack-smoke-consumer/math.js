import {
  MATH_MAX_CONCURRENT_RENDERS,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_SOURCE_BYTES,
  createMathExtension,
  defaultMathMessages,
  mathDiagnosticCodes,
} from "markora-extension-math";
import "markora-extension-math/styles.css";

export const packedMathDefinitions = [
  createMathExtension(),
  createMathExtension({
    messages: { showPreview: "Show packed math preview" },
  }),
];

export const packedMathSurface = [
  MATH_MAX_SOURCE_BYTES,
  MATH_MAX_RENDERED_NODES,
  MATH_MAX_RENDERED_OUTPUT_BYTES,
  MATH_MAX_CONCURRENT_RENDERS,
  defaultMathMessages.inlineKindLabel,
  mathDiagnosticCodes.join(","),
  ...packedMathDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
