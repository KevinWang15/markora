import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { sanitizeDiagramRendererOutput } from "../../extension-diagrams/src/renderer";
import { parseDiagramSvg } from "../src/svg";

it("adapts real PlantUML metadata without relaxing the diagram safety boundary", () => {
  const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/plantuml.svg"), "utf8");
  const output = sanitizeDiagramRendererOutput(parseDiagramSvg(svg, document, true), document);
  const host = document.createElement("div");
  host.append(output);
  expect(host.textContent).toContain("Hello");
  expect(host.querySelector("svg text")?.getAttribute("fill")).toBe("light-dark(#000000, #f4f4f4)");
  expect(host.innerHTML).not.toContain("plantuml-src");
  expect(host.innerHTML).not.toContain("xml:space");
});

it("leaves active renderer output for the extension to reject", () => {
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>Active</div></foreignObject></svg>',
  ]) expect(() => sanitizeDiagramRendererOutput(parseDiagramSvg(svg, document), document)).toThrow();
});

it("adapts real Mermaid sequence output to the existing strict SVG contract", () => {
  const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/mermaid.svg"), "utf8");
  const output = sanitizeDiagramRendererOutput(parseDiagramSvg(svg, document), document);
  expect(output.textContent).toContain("Mermaid");
});

it.each(["er", "mindmap", "gantt"])("adapts real Mermaid %s output without relaxing active-content checks", name => {
  const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), `fixtures/mermaid-${name}.svg`), "utf8");
  const host = document.createElement("div");
  host.append(sanitizeDiagramRendererOutput(parseDiagramSvg(svg, document), document));
  expect(host.querySelector("svg")).not.toBeNull();
  const ids = [...host.querySelectorAll("[id]")].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it("preserves local references across duplicate and Unicode IDs and namespaces separate exports", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="节点"/><g id="节点"/></defs><use href="#节点"/><path stroke="url(#节点)"/></svg>';
  const first = parseDiagramSvg(source, document);
  const second = parseDiagramSvg(source, document);
  const id = first.querySelector("[id]")!.id;
  expect(first.querySelectorAll("[id]")).toHaveLength(1);
  expect(first.querySelector("use")!.getAttribute("href")).toBe(`#${id}`);
  expect(first.querySelector("path")!.getAttribute("stroke")).toBe(`url(#${id})`);
  expect(second.querySelector("[id]")!.id).not.toBe(id);
  expect(() => sanitizeDiagramRendererOutput(first, document)).not.toThrow();
  for (const href of ["#missing", "https://example.com/image.svg#icon"]) {
    expect(() => sanitizeDiagramRendererOutput(parseDiagramSvg(source.replace('href="#节点"', `href="${href}"`), document), document)).toThrow();
  }
});
