/** Engine output is still untrusted. This only removes renderer-specific
 * decoration; the diagram extension (and export sanitizer) enforce safety. */
const plantUmlPalette: Readonly<Record<string, string>> = Object.freeze({
  "#000000": "light-dark(#000000, #f4f4f4)",
  "#181818": "light-dark(#181818, #e8e8e8)",
  "#E2E2F0": "light-dark(#E2E2F0, #343846)",
  "#F1F1F1": "light-dark(#F1F1F1, #2e323c)",
  "#FFFFFF": "light-dark(#FFFFFF, #1b1f28)",
});

export function parseDiagramSvg(svg: string, ownerDocument: Document, plantuml = false): DocumentFragment {
  if (svg.length > 1_048_576) throw new Error("Diagram output exceeds the preview limit.");
  const template = ownerDocument.createElement("template");
  template.innerHTML = svg;
  if (!template.content.querySelector("svg")) throw new Error("Renderer returned no SVG.");
  const annotations = ownerDocument.createTreeWalker(template.content, 128 | 64);
  const remove: Node[] = [];
  while (annotations.nextNode()) remove.push(annotations.currentNode);
  for (const node of remove) node.parentNode?.removeChild(node);
  template.content.querySelectorAll("style, filter").forEach(element => element.remove());
  template.content.querySelectorAll("*").forEach(element => {
    // PlantUML repeats CSS white-space:pre as the legacy XML annotation. The
    // extension deliberately rejects arbitrary namespaced SVG attributes.
    element.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space");
    element.removeAttribute("xml:space");
    // Mermaid sequence lifelines include a numeric internal actor index as a
    // class token. It has no presentation role in the static host preview.
    if (element.hasAttribute("class")) element.setAttribute("class",
      element.getAttribute("class")!.split(/\s+/u).filter(token => !/^\d+$/u.test(token)).join(" "));
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-") || attribute.name === "aria-roledescription"
        || attribute.name === "filter" || attribute.name === "name" || attribute.name === "version") element.removeAttribute(attribute.name);
      else if (plantuml && (attribute.name === "fill" || attribute.name === "stroke")) {
        const color = plantUmlPalette[attribute.value.toUpperCase()];
        if (color) element.setAttribute(attribute.name, color);
      }
    }
    if (element.namespaceURI === "http://www.w3.org/2000/svg") {
      (element as SVGElement).style.removeProperty("filter");
    }
  });
  return ownerDocument.importNode(template.content, true);
}
