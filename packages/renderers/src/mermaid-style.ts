const properties = ["fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "font-family", "font-size",
  "font-style", "font-weight", "text-anchor", "dominant-baseline", "opacity"] as const;
const nonInheritedDefaults: Readonly<Record<string, string>> = { opacity: "1", "dominant-baseline": "auto" };

function portableValue(property: string, value: string, document: Document) {
  if (property === "font-family") return value.replace(/["']/gu, "");
  if (property !== "fill" && property !== "stroke") return value;
  const fragment = /^url\(["']?(.*?)["']?\)$/u.exec(value);
  if (fragment) {
    const target = new URL(fragment[1]!, document.baseURI);
    const current = new URL(document.URL);
    if (target.origin === current.origin && target.pathname === current.pathname
      && target.search === current.search && target.hash) return `url(${decodeURIComponent(target.hash)})`;
    return value;
  }
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/u.exec(value);
  if (!rgb || rgb[1] !== rgb[2] || rgb[2] !== rgb[3]) return value;
  const gray = Number(rgb[1]);
  if (gray <= 85) return "currentColor";
  const dark = Math.max(24, Math.min(232, 255 - gray));
  return `light-dark(${value}, rgb(${dark}, ${dark}, ${dark}))`;
}

/** Mermaid returns DOMPurify-sanitized SVG in strict mode. Reuse its temporary
 * layout container to resolve the engine's CSS cascade before removing styles.
 * Copy only static presentation properties; the extension still clamps output.
 * This keeps every diagram family's paint/font rules portable in exports. */
export function inlineMermaidStyles(svg: string, container: HTMLElement): string {
  if (svg.length > 1_048_576) throw new Error("Diagram output exceeds the preview limit.");
  container.innerHTML = svg;
  const root = container.querySelector("svg");
  if (!root) throw new Error("Mermaid returned no SVG.");
  const document = container.ownerDocument;
  const win = document.defaultView!;
  const snapshots = new Map<Element, Map<string, string>>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.namespaceURI !== "http://www.w3.org/2000/svg") continue;
    const style = win.getComputedStyle(element);
    snapshots.set(element, new Map(properties.map(property => [property, style.getPropertyValue(property)])));
  }
  // Read everything before writing so ancestor changes cannot affect capture.
  for (const [element, values] of snapshots) {
    const parent = element.parentElement ? snapshots.get(element.parentElement) : undefined;
    for (const [property, value] of values) {
      if (!value) continue;
      const inherited = nonInheritedDefaults[property] ?? parent?.get(property);
      if (value !== inherited || element.hasAttribute(property)) {
        element.setAttribute(property, portableValue(property, value, document));
      }
      (element as SVGElement).style.removeProperty(property);
    }
  }
  return root.outerHTML;
}
