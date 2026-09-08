import {
  createFootnotesExtension,
  defaultFootnotesMessages,
  footnoteDiagnosticCodes,
} from "markora-extension-footnotes";
import "markora-extension-footnotes/styles.css";

export const packedFootnotesDefinitions = [
  createFootnotesExtension(),
  createFootnotesExtension({
    messages: { referenceText: (number) => "F" + number },
  }),
];

export const packedFootnotesSurface = [
  defaultFootnotesMessages.referenceText(1),
  footnoteDiagnosticCodes.join(","),
  ...packedFootnotesDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
