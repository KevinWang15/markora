import { jsdomUrl } from "./environment.mjs";
import { readFileSync } from "node:fs";
const { JSDOM } = await import(jsdomUrl);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://pack-smoke.invalid/",
});
const ownerWindow = dom.window;
for (const name of [
  "CompositionEvent",
  "CustomEvent",
  "DOMParser",
  "Element",
  "Event",
  "HTMLElement",
  "KeyboardEvent",
  "MutationObserver",
  "Node",
  "Range",
  "Selection",
  "Text",
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: ownerWindow[name],
  });
}
Object.defineProperties(globalThis, {
  document: { configurable: true, value: ownerWindow.document },
  getComputedStyle: { configurable: true, value: ownerWindow.getComputedStyle.bind(ownerWindow) },
  navigator: { configurable: true, value: ownerWindow.navigator },
  window: { configurable: true, value: ownerWindow },
});
ownerWindow.requestAnimationFrame ??= (callback) => ownerWindow.setTimeout(
  () => callback(ownerWindow.performance.now()),
  0,
);
ownerWindow.cancelAnimationFrame ??= (handle) => ownerWindow.clearTimeout(handle);
globalThis.requestAnimationFrame = ownerWindow.requestAnimationFrame.bind(ownerWindow);
globalThis.cancelAnimationFrame = ownerWindow.cancelAnimationFrame.bind(ownerWindow);
if (!ownerWindow.Range.prototype.getClientRects) {
  ownerWindow.Range.prototype.getClientRects = () => [];
}
if (!ownerWindow.Range.prototype.getBoundingClientRect) {
  ownerWindow.Range.prototype.getBoundingClientRect = () => new ownerWindow.DOMRect();
}

const [
  { createEditor },
  { createEditor: createMinimalEditor },
  alerts,
  frontmatter,
  diagrams,
  footnotes,
  html,
  math,
  toc,
  components,
  { createAtomView, defineMarkdownEditorExtension },
] = await Promise.all([
  import("markora"),
  import("markora/minimal"),
  import("markora-extension-alerts"),
  import("markora-extension-frontmatter"),
  import("markora-extension-diagrams"),
  import("markora-extension-footnotes"),
  import("markora-extension-html"),
  import("markora-extension-math"),
  import("markora-extension-toc"),
  import("markora-extension-components"),
  import("markora/extension-api"),
]);
const SOURCE = "\uFEFF---\r\ntitle: Packed\r\nanchor: &base value\r\ncopy: *base\r\n...";
const corePackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("markora")), "utf8"));
const OPTIONAL_EXTENSION_NAMES = new Set([
  "markora-extension-alerts",
  "markora-extension-frontmatter",
  "markora-extension-diagrams",
  "markora-extension-footnotes",
  "markora-extension-html",
  "markora-extension-math",
  "markora-extension-toc",
  "markora-extension-components",
]);

for (const [label, create] of [["root", createEditor], ["minimal", createMinimalEditor]]) {
  const element = ownerWindow.document.createElement("div");
  ownerWindow.document.body.append(element);
  const baseline = create({ element, markdown: "Body" });
  if (baseline.extensions.manifest.preset?.version !== corePackage.version) {
    throw new Error("Packed " + label + " runtime version does not match its npm package.");
  }
  if (baseline.extensions.manifest.extensions.some(({ name }) => (
    OPTIONAL_EXTENSION_NAMES.has(name)
  ))) {
    throw new Error("Packed " + label + " baseline unexpectedly installed an optional extension.");
  }
  baseline.destroy();
  element.replaceChildren();

  let packedAtom;
  let atomSignal;
  let atomCleanups = 0;
  let atomClicks = 0;
  const atomExtension = defineMarkdownEditorExtension({
    name: "pack-smoke-atom",
    version: "1.0.0",
    compatibility: { markora: "^0.1.0", extensionApi: "^1.5.0" },
    schema: {
      nodes: [{
        name: "packed_atom",
        spec: {
          inline: true,
          atom: true,
          group: "inline",
          attrs: { label: { default: "Packed atom" } },
          toDOM: () => ["span"],
        },
      }],
    },
    markdown: { serializer: { nodes: { packed_atom(state, node) { state.text(node.attrs.label); } } } },
    createRuntime: () => ({
      nodeViews: [{
        id: "atom",
        node: "packed_atom",
        create: () => (node, view, getPos) => {
          packedAtom = createAtomView(node, view, getPos, {
            display: "inline",
            label: current => current.attrs.label,
            controls: [{ label: "Edit", onClick: () => { atomClicks += 1; } }],
            render(context) {
              atomSignal = context.signal;
              context.content.textContent = context.node.attrs.label;
              return {
                update(next) { next.content.textContent = next.node.attrs.label; },
                destroy() { atomCleanups += 1; },
              };
            },
          });
          return packedAtom;
        },
      }],
    }),
  });
  const atomMarkdown = "Packed atom";
  const atomEditor = create({ element, extensions: [atomExtension], markdown: "" });
  atomEditor.view.dispatch(atomEditor.view.state.tr.insert(1, atomEditor.view.state.schema.nodes.packed_atom.create()));
  const atomButton = packedAtom.dom.querySelector("button");
  atomButton.click();
  atomEditor.updateOptions({ editable: false });
  const atomRefreshed = packedAtom.refresh();
  if (!atomRefreshed || !atomButton.disabled || atomButton.getAttribute("aria-disabled") !== "true"
    || atomClicks !== 1 || atomSignal.aborted || atomEditor.getMarkdown() !== atomMarkdown
    || !element.querySelector(".mdw-atom-inline .mdw-atom-content")) {
    throw new Error("Packed atom frame failed for " + label);
  }
  atomEditor.destroy();
  if (!atomSignal.aborted || atomCleanups !== 1 || packedAtom.refresh()) {
    throw new Error("Packed atom cleanup failed for " + label);
  }
  element.replaceChildren();

  const card = components.defineComponent({
    name: "packed-card",
    parseProps: value => ({ title: String(value.title) }),
    render: ({ element, props }) => { element.textContent = props.title; },
  });
  const registry = components.createComponentRegistry([card]);
  const componentExtension = components.createComponentsExtension({ registry });
  const componentEditor = create({ element, extensions: [componentExtension], markdown: "" });
  const componentApi = componentEditor.extensions.get(componentExtension);
  if (!componentApi.commands.insert(card, { title: "Packed component" })
    || !element.querySelector('[data-status="ready"]')?.textContent.includes("Packed component")
    || !element.querySelector("section.mdw-component.mdw-atom-block .mdw-atom-content")
    || !componentEditor.getMarkdown().includes("component:packed-card")
    || !componentApi.commands.update(card, { title: "Edited component" })
    || !componentEditor.commands.undo()
    || componentApi.state.getProps(card)?.title !== "Packed component") {
    throw new Error("Packed component API failed for " + label);
  }
  componentEditor.destroy();
  element.replaceChildren();

  const alertsDefinition = alerts.createAlertsExtension({
    messages: { toggleAlert: "Toggle packed alert" },
  });
  const alertsEditor = create({
    element,
    extensions: [alertsDefinition],
    markdown: "> [!warning]\n> Packed alert.",
  });
  const alertsHandle = alertsEditor.extensions.get(alertsDefinition);
  alertsEditor.focus("start");
  const alertsSnapshot = alertsHandle.state.getAlerts();
  if (
    alertsSnapshot.length !== 1
    || alertsSnapshot[0]?.kind !== "warning"
    || alertsHandle.state.getActive()?.kind !== "warning"
    || !alertsHandle.state.isActive()
    || alertsEditor.getMarkdown() !== "> [!WARNING]\n> Packed alert."
    || alertsEditor.view.dom.querySelector("[data-mdw-alert-kind=warning]") === null
    || !alertsEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-alerts"
    ))
  ) {
    throw new Error("Packed alerts " + label + " consumer lost semantic or manifest state.");
  }
  if (
    !alertsHandle.state.canSetKind("caution")
    || !alertsHandle.commands.setKind("caution")
    || alertsHandle.state.canSetKind("caution")
    || alertsEditor.getMarkdown() !== "> [!CAUTION]\n> Packed alert."
    || !alertsEditor.commands.undo()
    || alertsEditor.getMarkdown() !== "> [!WARNING]\n> Packed alert."
    || !alertsHandle.commands.toggle()
    || alertsEditor.getMarkdown() !== "Packed alert."
    || !alertsEditor.commands.undo()
    || alertsHandle.state.getAlerts()[0]?.kind !== "warning"
  ) {
    throw new Error("Packed alerts " + label + " command, state, or history smoke failed.");
  }
  alertsEditor.destroy();
  element.replaceChildren();

  const definition = frontmatter.createFrontmatterExtension();
  const editor = create({
    element,
    extensions: [definition],
    markdown: SOURCE + "\r\nBody",
  });
  const handle = editor.extensions.get(definition);
  if (
    handle.state.getSource() !== SOURCE
    || !element.querySelector(".mdw-frontmatter.mdw-atom-block .mdw-atom-status[role=status]")
    || element.querySelector(".mdw-frontmatter button") !== null
    || editor.getMarkdown() !== SOURCE + "\n\nBody"
    || !editor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-frontmatter"
    ))
  ) {
    throw new Error("Packed front matter " + label + " consumer lost exact source or manifest state.");
  }
  if (!handle.commands.update("---\ntitle: Updated\n---")) {
    throw new Error("Packed front matter " + label + " consumer command failed.");
  }
  if (!editor.commands.undo() || handle.state.getSource() !== SOURCE) {
    throw new Error("Packed front matter " + label + " consumer history failed.");
  }
  editor.destroy();
  element.replaceChildren();

  let diagramRendererCalls = 0;
  const diagramsDefinition = diagrams.createDiagramsExtension({
    renderers: {
      mermaid({ kind, ownerDocument, source }) {
        diagramRendererCalls += 1;
        const output = ownerDocument.createElement("div");
        const label = ownerDocument.createElement("span");
        label.textContent = kind + ":" + source;
        output.append(label);
        return output;
      },
    },
  });
  const diagramsEditor = create({
    element,
    extensions: [diagramsDefinition],
    markdown: "```mermaid theme=neutral\nflowchart LR\nA --> B\n```",
  });
  const diagramsHandle = diagramsEditor.extensions.get(diagramsDefinition);
  const diagramsSnapshot = diagramsHandle.state.getSnapshot();
  const diagram = diagramsSnapshot.nodes[0];
  await new Promise((resolve) => ownerWindow.setTimeout(resolve, 10));
  const renderedDiagram = diagramsHandle.state.getNode(diagram);
  if (
    diagramsSnapshot.nodes.length !== 1
    || diagram?.kind !== "mermaid"
    || diagram.info !== "mermaid theme=neutral"
    || diagram.source !== "flowchart LR\nA --> B"
    || diagramsHandle.state.getKind(diagram) !== "mermaid"
    || diagramRendererCalls !== 1
    || renderedDiagram?.render.status !== "rendered"
    || diagramsEditor.view.dom.querySelector(".mdw-diagram__preview")?.textContent
      !== "mermaid:flowchart LR\nA --> B"
    || diagramsEditor.getMarkdown()
      !== "```mermaid theme=neutral\nflowchart LR\nA --> B\n```"
    || !diagramsEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-diagrams"
    ))
  ) {
    throw new Error("Packed diagrams " + label + " consumer lost semantic or manifest state.");
  }
  if (
    !diagramsHandle.commands.update(diagram, { source: "flowchart TD\nA --> C" })
    || diagramsEditor.getMarkdown()
      !== "```mermaid theme=neutral\nflowchart TD\nA --> C\n```"
    || !diagramsEditor.commands.undo()
    || diagramsEditor.getMarkdown()
      !== "```mermaid theme=neutral\nflowchart LR\nA --> B\n```"
  ) {
    throw new Error("Packed diagrams " + label + " command, source, or history smoke failed.");
  }
  diagramsEditor.destroy();
  element.replaceChildren();

  const footnotesDefinition = footnotes.createFootnotesExtension({
    messages: { referenceText: (number) => "F" + number },
  });
  const footnotesEditor = create({
    element,
    extensions: [footnotesDefinition],
    markdown: "Body",
  });
  const footnotesHandle = footnotesEditor.extensions.get(footnotesDefinition);
  footnotesEditor.focus("end");
  if (
    !footnotesHandle.commands.insertReference("note")
    || !footnotesHandle.commands.insertDefinition("note")
    || footnotesEditor.getMarkdown() !== "Body[^note]\n\n[^note]: "
  ) {
    throw new Error("Packed footnotes " + label + " insertion commands failed.");
  }
  const snapshot = footnotesHandle.state.getSnapshot();
  if (
    snapshot.references.length !== 1
    || snapshot.definitions.length !== 1
    || snapshot.diagnostics.length !== 0
    || footnotesHandle.state.getReferences("note").length !== 1
    || footnotesHandle.state.getDefinition({ label: "note" })?.label !== "note"
    || !footnotesEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-footnotes"
    ))
  ) {
    throw new Error("Packed footnotes " + label + " consumer lost indexed or manifest state.");
  }
  if (
    !footnotesHandle.commands.renameDefinition(
      { label: "note" },
      "renamed",
      { references: "rename" },
    )
    || footnotesHandle.state.getDefinition({ label: "renamed" })?.label !== "renamed"
    || !footnotesEditor.commands.undo()
    || !footnotesHandle.commands.navigateToReference("note")
    || !footnotesHandle.commands.navigateToDefinition("note")
    || !footnotesHandle.commands.removeDefinition(
      { label: "note" },
      { references: "preserve" },
    )
    || footnotesHandle.state.getDiagnostics()[0]?.code !== "unresolved-reference"
    || !footnotesEditor.commands.undo()
  ) {
    throw new Error("Packed footnotes " + label + " command, state, or history smoke failed.");
  }
  footnotesEditor.destroy();

  element.replaceChildren();
  const mathDefinition = math.createMathExtension();
  const mathEditor = create({
    element,
    extensions: [mathDefinition],
    markdown: "Math: $x$\n\n$$\ny\n$$",
  });
  const mathHandle = mathEditor.extensions.get(mathDefinition);
  const mathSnapshot = mathHandle.state.getSnapshot();
  if (
    mathSnapshot.nodes.length !== 2
    || mathSnapshot.nodes[0]?.kind !== "inline"
    || mathSnapshot.nodes[1]?.kind !== "block"
    || mathEditor.getMarkdown() !== "Math: $x$\n\n$$\ny\n$$"
    || !mathEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-math"
    ))
  ) {
    throw new Error("Packed math " + label + " consumer lost semantic or manifest state.");
  }
  if (
    !mathHandle.commands.update(mathSnapshot.nodes[0], "z")
    || mathEditor.getMarkdown() !== "Math: $z$\n\n$$\ny\n$$"
    || !mathEditor.commands.undo()
    || mathEditor.getMarkdown() !== "Math: $x$\n\n$$\ny\n$$"
  ) {
    throw new Error("Packed math " + label + " command or history smoke failed.");
  }
  mathEditor.destroy();

  element.replaceChildren();
  const tocDefinition = toc.createTocExtension({
    messages: {
      goToHeadingLabel: (headingLabel, level, index) =>
        "Go to packed heading " + index + ", level " + level + ": " + headingLabel,
      navigationLabel: (occurrence, total) =>
        "Packed contents " + occurrence + " of " + total,
    },
  });
  const tocEditor = create({
    element,
    extensions: [tocDefinition],
    markdown: "[toc]\n\n# Packed heading\n\n## Packed child\n\n[TOC]",
  });
  const tocHandle = tocEditor.extensions.get(tocDefinition);
  const tocSnapshot = tocHandle.state.getSnapshot();
  const tocNavs = [...tocEditor.view.dom.querySelectorAll("nav[data-mdw-toc]")];
  const secondEntry = tocNavs[0]?.querySelector('[data-mdw-toc-entry="2"]');
  if (
    tocSnapshot.headings.length !== 2
    || tocSnapshot.headings[0]?.label !== "Packed heading"
    || tocSnapshot.headings[0]?.level !== 1
    || tocSnapshot.headings[1]?.label !== "Packed child"
    || tocSnapshot.headings[1]?.level !== 2
    || tocSnapshot.tocs.length !== 2
    || tocEditor.getMarkdown()
      !== "[TOC]\n\n# Packed heading\n\n## Packed child\n\n[TOC]"
    || tocNavs.length !== 2
    || tocNavs[0]?.getAttribute("aria-label") !== "Packed contents 1 of 2"
    || tocNavs[1]?.getAttribute("aria-label") !== "Packed contents 2 of 2"
    || tocNavs.some((nav) => nav.querySelectorAll("[data-mdw-toc-entry]").length !== 2)
    || secondEntry === null
    || !Object.isFrozen(tocSnapshot)
    || !Object.isFrozen(tocSnapshot.headings)
    || !tocEditor.extensions.manifest.extensions.some(({ name }) => (
      name === "markora-extension-toc"
    ))
  ) {
    throw new Error("Packed TOC " + label + " consumer lost semantic, DOM, or manifest state.");
  }
  secondEntry.click();
  if (
    tocEditor.view.state.selection.from !== tocSnapshot.headings[1].position + 1
    || tocEditor.view.dom.querySelector("h1[id], h2[id]") !== null
  ) {
    throw new Error("Packed TOC " + label + " model-position navigation failed.");
  }
  if (
    !tocHandle.state.canInsert()
    || !tocHandle.commands.insert()
    || tocHandle.state.getSnapshot().tocs.length !== 3
    || !tocHandle.state.isActive()
    || !tocHandle.state.canRemove()
    || !tocEditor.commands.undo()
    || tocHandle.state.getSnapshot().tocs.length !== 2
    || !tocEditor.commands.redo()
    || tocHandle.state.getSnapshot().tocs.length !== 3
    || !tocHandle.commands.remove()
    || tocHandle.state.getSnapshot().tocs.length !== 2
    || !tocEditor.commands.undo()
    || tocHandle.state.getSnapshot().tocs.length !== 3
  ) {
    throw new Error("Packed TOC " + label + " command, state, or history smoke failed.");
  }
  tocEditor.destroy();
  element.remove();
}

const htmlElement = ownerWindow.document.createElement("div");
ownerWindow.document.body.append(htmlElement);
const HTML_BLOCK = [
  "<script>",
  "globalThis.__markoraPackedHtmlExecuted = true;",
  "</script>",
].join("\r\n");
const HTML_INLINE = '<img src="/must-not-load.png" onerror="globalThis.__markoraPackedHtmlExecuted = true">';
const HTML_MARKDOWN = HTML_BLOCK + "\r\n\r\nBefore " + HTML_INLINE + " after.";
const htmlDefinition = html.createHtmlExtension({
  renderer({ ownerDocument, signal, source }) {
    const article = ownerDocument.createElement("article");
    article.className = "host-renderer-class";
    article.id = "host-renderer-id";
    article.dataset.hostRenderer = "dropped";
    article.setAttribute("aria-label", "dropped");
    article.setAttribute("role", "document");
    article.title = "Packed sanitized preview";
    const strong = ownerDocument.createElement("strong");
    strong.textContent = source;
    article.append(strong);
    signal.addEventListener("abort", () => undefined, { once: true });
    return article;
  },
});
const htmlEditor = createEditor({
  element: htmlElement,
  extensions: [htmlDefinition],
  markdown: HTML_MARKDOWN,
});
const htmlHandle = htmlEditor.extensions.get(htmlDefinition);
const initialHtmlNodes = htmlHandle.state.getNodes();
if (
  initialHtmlNodes.length !== 2
  || initialHtmlNodes[0]?.display !== "block"
  || initialHtmlNodes[0]?.kind !== "html-block"
  || initialHtmlNodes[0]?.source !== HTML_BLOCK
  || initialHtmlNodes[1]?.display !== "inline"
  || initialHtmlNodes[1]?.kind !== "inline-html"
  || initialHtmlNodes[1]?.source !== HTML_INLINE
  || htmlEditor.getMarkdown() !== HTML_BLOCK + "\n\nBefore " + HTML_INLINE + " after."
  || !htmlEditor.extensions.manifest.extensions.some(({ name }) => (
    name === "markora-extension-html"
  ))
) {
  throw new Error("Packed HTML root consumer lost exact source, atom classification, or manifest state.");
}

let preview = null;
for (let attempt = 0; attempt < 100; attempt += 1) {
  preview = htmlEditor.view.dom.querySelector("[data-mdw-html-preview]");
  if (preview?.querySelector("article > strong")) break;
  await new Promise((resolve) => ownerWindow.setTimeout(resolve, 10));
}
const sanitizedArticle = preview?.querySelector("article");
if (
  !sanitizedArticle
  || sanitizedArticle.textContent !== HTML_BLOCK
  || sanitizedArticle.title !== "Packed sanitized preview"
  || sanitizedArticle.hasAttribute("class")
  || sanitizedArticle.hasAttribute("id")
  || sanitizedArticle.hasAttribute("data-host-renderer")
  || sanitizedArticle.hasAttribute("aria-label")
  || sanitizedArticle.hasAttribute("role")
  || preview.getAttribute("aria-hidden") !== "true"
  || !preview.hasAttribute("inert")
  || htmlEditor.view.dom.querySelector("script, img, iframe, object, embed") !== null
  || globalThis.__markoraPackedHtmlExecuted !== undefined
) {
  throw new Error("Packed HTML root consumer failed the inert, clamped renderer smoke.");
}

const initialBlock = initialHtmlNodes[0];
const UPDATED_HTML_BLOCK = '<section data-packed="updated">\r\nUpdated\r\n</section>';
if (
  !htmlHandle.commands.update(initialBlock, UPDATED_HTML_BLOCK)
  || htmlHandle.state.getNodes("block")[0]?.source !== UPDATED_HTML_BLOCK
  || htmlEditor.getMarkdown() !== UPDATED_HTML_BLOCK + "\n\nBefore " + HTML_INLINE + " after."
  || !htmlEditor.commands.undo()
  || htmlHandle.state.getNodes("block")[0]?.source !== HTML_BLOCK
  || htmlEditor.getMarkdown() !== HTML_BLOCK + "\n\nBefore " + HTML_INLINE + " after."
) {
  throw new Error("Packed HTML root consumer command, exact-source, or history smoke failed.");
}
htmlEditor.destroy();
htmlElement.remove();
delete globalThis.__markoraPackedHtmlExecuted;

const minimalHtmlElement = ownerWindow.document.createElement("div");
const minimalHtmlSentinel = ownerWindow.document.createElement("span");
minimalHtmlSentinel.textContent = "minimal HTML sentinel";
minimalHtmlElement.append(minimalHtmlSentinel);
ownerWindow.document.body.append(minimalHtmlElement);
let minimalHtmlError;
try {
  const unexpectedEditor = createMinimalEditor({
    element: minimalHtmlElement,
    extensions: [html.createHtmlExtension()],
    markdown: "<div>must not be claimed</div>",
  });
  unexpectedEditor.destroy();
} catch (error) {
  minimalHtmlError = error;
}
if (
  minimalHtmlError?.code !== "EXTENSION_MISSING_DEPENDENCY"
  || minimalHtmlError?.extension !== "markora-extension-html"
  || minimalHtmlError?.phase !== "tokenizer"
  || minimalHtmlElement.firstChild !== minimalHtmlSentinel
  || minimalHtmlElement.childNodes.length !== 1
  || minimalHtmlElement.classList.contains("mdw-host")
) {
  throw new Error("Packed HTML minimal consumer was not rejected before host claim.");
}
minimalHtmlElement.remove();

ownerWindow.close();
