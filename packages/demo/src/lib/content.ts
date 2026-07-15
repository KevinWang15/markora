export const quickStartCode = `import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const hostElement = document.querySelector("#editor");

if (!hostElement) {
  throw new Error("Editor host not found.");
}

const editor = createEditor({
  element: hostElement,
  markdown: "# Hello Markora",
  ui: createDefaultUi(),
  onChangeMode: "animationFrame",
  onChange(nextMarkdown) {
    console.log(nextMarkdown);
  },
});`;

export const installCommand = "npm install markora markora-ui";

export const initialMarkdown = [
  "# Markora",
  "",
  "Write Markdown at the speed of thought.",
  "",
  "- [x] Typora-like surface",
  "- [x] Tables with alignment",
  "- [x] Code blocks with syntax-aware editing",
  "",
  "| Feature | Why it matters |",
  "| :--- | :--- |",
  "| Documented Markdown subset | Predictable normalized storage |",
  "| Managed cursors | Better movement around tables and code blocks |",
  "| Compact API | Easy to wire into your app |",
  "",
  "```ts",
  "const ship = (feature: string) => console.log(`Ship ${feature}`);",
  "ship('great editing UX');",
  "```",
].join("\n");

export const docsNavigation = [
  {
    title: "Getting started",
    path: "/docs/getting-started",
  },
  {
    title: "Markdown contract",
    path: "/docs/markdown",
  },
  {
    title: "API overview",
    path: "/docs/api",
  },
  {
    title: "Examples",
    path: "/docs/examples",
  },
  {
    title: "Playground demo",
    path: "/demo",
  },
] as const;


export const devLabExamples = [
  {
    slug: "codeblock-after-list",
    description: "List items followed by a fenced code block to verify cursor movement and serialization.",
    markdown: [
      "# Code block after list",
      "",
      "- alpha",
      "- beta",
      "- gamma",
      "",
      "```ts",
      "const items = ['alpha', 'beta', 'gamma'];",
      "console.log(items.join(', '));",
      "```",
    ].join("\n"),
  },
  {
    slug: "table-with-inline-marks",
    description: "Pipe table with emphasis, links, and code spans to verify semantic preservation and normalized serialization.",
    markdown: [
      "| Column | Value |",
      "| :--- | ---: |",
      "| *Alpha* | [Docs](https://example.com) |",
      "| `a\\|b` | escaped \\| pipe |",
    ].join("\n"),
  },
  {
    slug: "imported-table-edit",
    description: "Imported pipe table to verify cell editing and Markdown serialization without data loss.",
    markdown: [
      "| Name | Status |",
      "| --- | --- |",
      "| Alpha | Draft |",
    ].join("\n"),
  },
  {
    slug: "tasks-and-image",
    description: "Task lists plus an image node to validate overlays and media serialization.",
    markdown: [
      "# Tasks and media",
      "",
      "- [x] finished task",
      "- [ ] pending task",
      "",
      "![Alt text](https://example.com/image.png)",
    ].join("\n"),
  },
  {
    slug: "quote-nested-list",
    description: "Blockquote with nested list content to exercise block parsing and navigation.",
    markdown: [
      "> Shipping notes",
      ">",
      "> - item one",
      ">   - nested item",
      "> - item two",
      "",
      "Regular paragraph after quote.",
    ].join("\n"),
  },
  {
    slug: "opaque-source",
    description: "Front matter, math, HTML, comments, and directives rendered as inert exact-source nodes beside supported Markdown.",
    markdown: [
      "---",
      "title: Opaque source safety",
      "feature: EE-004",
      "---",
      "",
      "# Opaque source safety",
      "",
      "Supported **Markdown** stays editable around the preserved source.",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "<script>globalThis.__markoraRawScriptExecuted = true;</script>",
      "",
      "<!-- keep **literal markers** exactly -->",
      "",
      ":::note",
      "Do not reinterpret :inside[the container].",
      ":::",
      "",
      "Inline <span data-label=\"[raw]\">HTML</span> remains inert.",
      "",
      "```unregistered-language",
      "generic code fences remain supported code",
      "```",
    ].join("\n"),
  },
] as const;
