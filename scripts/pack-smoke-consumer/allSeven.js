import {
  createEditor,
} from "markora";
import "markora/styles.css";
import {
  packedAlertsDefinitions,
} from "./alerts.js";
import {
  packedDiagramDefinitions,
} from "./diagrams.js";
import {
  packedFootnotesDefinitions,
} from "./footnotes.js";
import {
  packedFrontmatterDefinitions,
} from "./frontmatter.js";
import {
  packedHtmlDefinitions,
} from "./html.js";
import {
  packedMathDefinitions,
} from "./math.js";
import {
  packedTocDefinitions,
} from "./toc.js";

export const packedAllSevenDefinitions = Object.freeze([
  packedFrontmatterDefinitions[0],
  packedFootnotesDefinitions[0],
  packedMathDefinitions[0],
  packedAlertsDefinitions[0],
  packedTocDefinitions[0],
  packedHtmlDefinitions[0],
  packedDiagramDefinitions[0],
]);

export const packedAllSevenNames = packedAllSevenDefinitions.map(({ name }) => name);

export function mountPackedAllSevenEditor(element, markdown) {
  return createEditor({
    element,
    extensions: packedAllSevenDefinitions,
    markdown,
  });
}
