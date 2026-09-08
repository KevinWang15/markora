import { jsdomUrl } from "./environment.mjs";
const { JSDOM } = await import(jsdomUrl);

const entrySpecifier = process.argv[2];
if (!entrySpecifier) {
  throw new Error("The all-seven runtime smoke requires a bundled entry specifier.");
}
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

const consumer = await import(entrySpecifier);
const expectedNames = [
  "markora-extension-frontmatter",
  "markora-extension-footnotes",
  "markora-extension-math",
  "markora-extension-alerts",
  "markora-extension-toc",
  "markora-extension-html",
  "markora-extension-diagrams",
];
if (consumer.packedAllSevenNames?.join(":") !== expectedNames.join(":")) {
  throw new Error("The packed all-seven consumer exported the wrong definition order.");
}

const markdown = [
  "\uFEFF---",
  "title: Packed all-seven consumer",
  "---",
  "",
  "[TOC]",
  "",
  "# Combined heading",
  "",
  "> [!NOTE]",
  "> Combined alert.",
  "",
  "Math $x$ and note[^packed] with <span>inline HTML</span>.",
  "",
  "```mermaid theme=neutral",
  "graph TD",
  'A["$inside-diagram$"] --> B',
  "```",
  "",
  "<div>Combined block HTML</div>",
  "",
  "[^packed]: Combined footnote.",
].join("\n");
const host = ownerWindow.document.createElement("div");
ownerWindow.document.body.append(host);
const editor = consumer.mountPackedAllSevenEditor(host, markdown);
const manifestNames = editor.extensions.manifest.extensions
  .map(({ name }) => name)
  .filter((name) => expectedNames.includes(name));
if (
  manifestNames.length !== expectedNames.length
  || new Set(manifestNames).size !== expectedNames.length
  || manifestNames.join(":") !== expectedNames.join(":")
) {
  throw new Error("The packed all-seven root editor manifest order is not deterministic.");
}
const definitions = Object.fromEntries(
  consumer.packedAllSevenDefinitions.map((definition) => [definition.name, definition]),
);
const frontmatter = editor.extensions.get(definitions["markora-extension-frontmatter"]);
const footnotes = editor.extensions.get(definitions["markora-extension-footnotes"]);
const math = editor.extensions.get(definitions["markora-extension-math"]);
const alerts = editor.extensions.get(definitions["markora-extension-alerts"]);
const toc = editor.extensions.get(definitions["markora-extension-toc"]);
const html = editor.extensions.get(definitions["markora-extension-html"]);
const diagrams = editor.extensions.get(definitions["markora-extension-diagrams"]);
const diagram = diagrams.state.getNodes()[0];
if (
  !frontmatter.state.getSource()?.startsWith("\uFEFF---")
  || footnotes.state.getSnapshot().references.length !== 1
  || footnotes.state.getSnapshot().definitions.length !== 1
  || math.state.getNodes().length !== 1
  || alerts.state.getAlerts().length !== 1
  || toc.state.getSnapshot().tocs.length !== 1
  || toc.state.getSnapshot().headings.length !== 1
  || html.state.getNodes().length !== 3
  || !diagram
  || diagram.kind !== "mermaid"
  || diagram.info !== "mermaid theme=neutral"
  || diagram.source !== 'graph TD\nA["$inside-diagram$"] --> B'
) {
  throw new Error("The packed all-seven root editor lost combined syntax ownership.");
}
const canonical = editor.getMarkdown();
if (
  !diagrams.commands.update(diagram, { source: "graph LR\nA --> C" })
  || !editor.getMarkdown().includes("graph LR\nA --> C")
  || !editor.commands.undo()
  || editor.getMarkdown() !== canonical
) {
  throw new Error("The packed all-seven root editor command or history smoke failed.");
}
editor.commands.resetMarkdown(canonical);
if (editor.getMarkdown() !== canonical) {
  throw new Error("The packed all-seven root editor failed its canonical reset round trip.");
}
editor.destroy();
await new Promise((resolve) => ownerWindow.setTimeout(resolve, 0));
if (host.childNodes.length !== 0 || host.classList.contains("mdw-host")) {
  throw new Error("The packed all-seven root editor did not clean up its host.");
}
host.remove();
ownerWindow.close();
