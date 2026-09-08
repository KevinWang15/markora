/** Engine output is still untrusted. This only removes renderer-specific
 * decoration; the diagram extension (and export sanitizer) enforce safety. */
const plantUmlPalette: Readonly<Record<string, string>> = Object.freeze({
  "#000000": "light-dark(#000000, #f4f4f4)",
  "#181818": "light-dark(#181818, #e8e8e8)",
  "#E2E2F0": "light-dark(#E2E2F0, #343846)",
  "#F1F1F1": "light-dark(#F1F1F1, #2e323c)",
  "#FFFFFF": "light-dark(#FFFFFF, #1b1f28)",
});
let sequence = 0;

function normalizeIdentifiers(root: DocumentFragment) {
  const prefix = `markora-svg-${++sequence}-`;
  const ids = new Map<string, string>();
  for (const element of root.querySelectorAll("[id]")) {
    const original = element.id;
    // Mermaid mind maps repeat node/gradient IDs. Browser fragment resolution
    // uses the first occurrence; preserve that meaning and remove later IDs.
    if (ids.has(original)) element.removeAttribute("id");
    else {
      const id = `${prefix}${ids.size}`;
      ids.set(original, id);
      element.id = id;
    }
  }
  for (const element of root.querySelectorAll("*")) for (const attribute of [...element.attributes]) {
    let value = attribute.value;
    if (attribute.localName === "href" && value.startsWith("#") && ids.has(value.slice(1))) {
      value = `#${ids.get(value.slice(1))}`;
    } else if (attribute.name === "aria-labelledby" || attribute.name === "aria-describedby") {
      value = value.split(/\s+/u).map(id => ids.get(id) ?? id).join(" ");
    } else if (value.includes("url(")) {
      value = value.replace(/url\(\s*(["']?)#([^"'()\s]+)\1\s*\)/gu,
        (match, _quote: string, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
    }
    // Keep external/unresolved references intact for the final clamp to reject.
    if (value !== attribute.value) attribute.value = value;
  }
}

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
  normalizeIdentifiers(template.content);
  template.content.querySelectorAll("*").forEach(element => {
    // PlantUML repeats CSS white-space:pre as the legacy XML annotation. The
    // extension deliberately rejects arbitrary namespaced SVG attributes.
    element.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space");
    element.removeAttribute("xml:space");
    // Mermaid sequence lifelines include a numeric internal actor index as a
    // class token. It has no presentation role in the static host preview.
    if (element.hasAttribute("class")) element.setAttribute("class",
      element.getAttribute("class")!.split(/\s+/u)
        .filter(token => !/^(?:\d+|width-\d+(?:\.\d+)?)$/u.test(token)).join(" "));
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-") || attribute.name === "aria-roledescription"
        || attribute.name === "filter" || attribute.name === "name" || attribute.name === "version") element.removeAttribute(attribute.name);
      else if (plantuml && (attribute.name === "fill" || attribute.name === "stroke")) {
        const color = plantUmlPalette[attribute.value.toUpperCase()];
        if (color) element.setAttribute(attribute.name, color);
      }
    }
    if (element.namespaceURI === "http://www.w3.org/2000/svg") {
      // Mermaid ER output includes literal "normal" and "undefined" in style
      // attributes. They are invalid CSS placeholders, not declarations.
      const style = element.getAttribute("style");
      if (style) element.setAttribute("style", style.split(";")
        .filter(part => !/^(?:normal|undefined)$/u.test(part.trim())).join(";"));
      (element as SVGElement).style.removeProperty("filter");
    }
  });
  return ownerDocument.importNode(template.content, true);
}
