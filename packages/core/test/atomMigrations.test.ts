import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { NodeSelection, TextSelection } from "markora/extension-api";
import { createComponentRegistry, createComponentsExtension } from "../../extension-components/src/index";
import { createDiagramsExtension } from "../../extension-diagrams/src/index";
import { createFootnotesExtension } from "../../extension-footnotes/src/index";
import { createFrontmatterExtension } from "../../extension-frontmatter/src/index";
import { createHtmlExtension } from "../../extension-html/src/index";
import { createMathExtension } from "../../extension-math/src/index";
import { createTocExtension } from "../../extension-toc/src/index";

const editors: MarkdownEditor[] = [];
const markdown = [
  "---\ntitle: Shared atoms\n---",
  "[TOC]",
  "# Overview",
  "```component:chart\n{}\n```",
  "<div>Safe source</div>",
  "$$\nx^2\n$$",
  "Inline $y$ <b>HTML</b> ![image](/image.png) note[^note].",
  "```mermaid\ngraph LR; A-->B\n```",
  "[^note]: Editable definition.",
].join("\n\n");

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe.each([["root", createEditor], ["minimal", createMinimalEditor]] as const)("%s atom migrations", (entry, create) => {
  it("shares atom frames without changing editable node families or Markdown", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = create({
      element,
      markdown,
      extensions: [
        createComponentsExtension({ registry: createComponentRegistry([]) }),
        createFrontmatterExtension(), createTocExtension(),
        ...(entry === "root" ? [createHtmlExtension()] : []),
        createMathExtension(), createFootnotesExtension(), createDiagramsExtension(),
      ],
      resources: { loadImage: () => null },
    });
    editors.push(editor);
    editor.view.focus();
    const original = editor.getMarkdown();
    const atoms = new Set([
      "frontmatter", "toc", "custom_component",
      ...(entry === "root" ? ["html_block", "html_inline"] : []),
      "math_block", "math_inline", "image", "footnote_reference",
    ]);
    const found = new Set<string>();
    editor.view.state.doc.descendants((node, position) => {
      if (!atoms.has(node.type.name)) return;
      found.add(node.type.name);
      const dom = editor.view.nodeDOM(position) as HTMLElement;
      expect(node.isAtom).toBe(true);
      expect(dom.classList.contains("mdw-atom"), `${node.type.name}: ${dom.outerHTML}`).toBe(true);
      expect(dom.getAttribute("contenteditable")).toBe("false");
      expect(dom.querySelectorAll(".mdw-atom-content")).toHaveLength(1);
      expect(dom.querySelectorAll(".mdw-atom-status[role=status]")).toHaveLength(1);
      editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, position)));
      expect((editor.view.nodeDOM(position) as HTMLElement).classList.contains("ProseMirror-selectednode"),
        `${node.type.name}: ${JSON.stringify(editor.view.state.selection.toJSON())}`).toBe(true);
    });
    expect(found).toEqual(atoms);
    for (const type of ["diagram", "footnote_definition"]) {
      expect(editor.view.state.schema.nodes[type].isAtom).toBe(false);
      expect(element.querySelector(`.mdw-${type.replaceAll("_", "-")}`)?.classList.contains("mdw-atom")).toBe(false);
    }
    expect(editor.getMarkdown()).toBe(original);
    editor.view.state.doc.descendants((node, position) => {
      if (node.type.name !== "diagram") return;
      editor.view.dispatch(editor.view.state.tr.insertText("; B-->C", position + node.nodeSize - 1));
      return false;
    });
    expect(editor.getMarkdown()).toContain("graph LR; A-->B; B-->C");
    editor.view.state.doc.descendants((node, position) => {
      if (node.type.name !== "footnote_definition") return;
      const transaction = editor.view.state.tr;
      transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
      editor.view.dispatch(transaction.insertText("Still "));
      return false;
    });
    expect(editor.getMarkdown()).toContain("Still Editable definition.");
  });
});

it("keeps shared NodeView hooks and rings out of migrated atom renderers", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [extension, file] of [
    ["components", "nodeView"], ["frontmatter", "nodeView"], ["toc", "nodeView"],
    ["html", "nodeViews"], ["math", "nodeViews"], ["footnotes", "nodeViews"],
  ]) {
    const source = read(`../../extension-${extension}/src/${file}.ts`)
      .split("export function createFootnoteDefinitionNodeView")[0];
    expect(source, extension).toContain("createAtomView(");
    expect(source, extension).not.toMatch(/\b(?:selectNode|deselectNode|stopEvent|ignoreMutation)\s*\(/);
    const css = read(`../../extension-${extension}/src/styles.css`);
    const selectors = css.match(/[^{}]+\{/g) ?? [];
    expect(selectors.filter(selector => selector.includes("ProseMirror-selectednode")
      && !selector.includes(".mdw-footnote-definition")), extension).toEqual([]);
  }
  const images = read("../src/imageView.ts");
  expect(images).toContain("createAtomView(");
  expect(images).not.toMatch(/\b(?:selectNode|deselectNode|stopEvent|ignoreMutation)\s*\(/);
});
