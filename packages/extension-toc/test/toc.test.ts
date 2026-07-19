import { afterEach, describe, expect, it } from "vitest";
import {
  createEditor as createRootEditor,
  type MarkdownEditor,
} from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { AllSelection, NodeSelection, TextSelection } from "markora/extension-api";
import {
  createTocExtension,
  defaultTocMessages,
} from "../src/index";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;
const editors: MarkdownEditor[] = [];

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function nodeNames(editor: MarkdownEditor) {
  const names: string[] = [];
  editor.view.state.doc.descendants((node) => {
    names.push(node.type.name);
    return true;
  });
  return names;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.replaceChildren();
  window.location.hash = "";
});

describe.each(entries)("%s TOC extension", (_entry, createEditor) => {
  it("recognizes root markers, normalizes them, and retains fixed points", () => {
    const extension = createTocExtension();
    const source = [
      "[toc]",
      "",
      " # Alpha",
      "",
      "   [ToC]\t",
      "",
      "## Beta",
    ].join("\n");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: source,
    }));
    const handle = editor.extensions.get(extension);
    const canonical = editor.getMarkdown();

    expect(handle.state.getSnapshot()).toEqual({
      headings: [
        { label: "Alpha", level: 1, position: expect.any(Number) },
        { label: "Beta", level: 2, position: expect.any(Number) },
      ],
      tocs: [
        { position: expect.any(Number) },
        { position: expect.any(Number) },
      ],
    });
    expect(canonical.match(/\[TOC\]/g)).toHaveLength(2);
    expect(canonical).not.toMatch(/\[(?:toc|ToC)\]/);
    expect(editor.view.dom.querySelectorAll("nav[data-mdw-toc]")).toHaveLength(2);
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-toc",
      version: "0.0.1",
    });

    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(editor.extensions.get(extension).state.getSnapshot().tocs).toHaveLength(2);
  });

  it("interrupts adjacent paragraphs and wins over Setext/thematic-break parsing", () => {
    const extension = createTocExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "before\n[TOC]\nafter\n\n[TOC]\n---",
    }));

    expect(editor.extensions.get(extension).state.getSnapshot().tocs).toHaveLength(2);
    expect(nodeNames(editor)).toEqual(expect.arrayContaining([
      "paragraph",
      "toc",
      "horizontal_rule",
    ]));
    expect(editor.view.state.doc.textContent).toContain("before");
    expect(editor.view.state.doc.textContent).toContain("after");
    expect(editor.getMarkdown()).toContain("before\n\n[TOC]\n\nafter");
  });

  it("leaves inline, escaped, code, indented, list, quote, and Unicode-padded forms literal", () => {
    const extension = createTocExtension();
    const source = [
      "before [TOC] after",
      "",
      "\\[TOC]",
      "",
      "`[TOC]`",
      "",
      "```md",
      "[TOC]",
      "```",
      "",
      "    [TOC]",
      "",
      "> [TOC]",
      "",
      "- [TOC]",
      "",
      "\u00a0[TOC]",
      "",
      "[ TOC ]",
    ].join("\n");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: source,
    }));

    expect(editor.extensions.get(extension).state.getSnapshot().tocs).toEqual([]);
    expect(nodeNames(editor)).toEqual(expect.arrayContaining([
      "blockquote",
      "bullet_list",
      "code_block",
    ]));
  });

  it("indexes descendant headings and derives image/leaf and untitled labels", () => {
    const extension = createTocExtension({
      messages: {
        untitledHeadingLabel: (level, index) => `Untitled ${index}/${level}`,
      },
    });
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "[TOC]",
        "",
        "# Root *title* ![Logo](https://example.test/logo.png)",
        "",
        "> ## Quoted",
        "",
        "- ### Listed",
        "",
        "####",
      ].join("\n"),
    }));
    const headings = editor.extensions.get(extension).state.getSnapshot().headings;

    expect(headings.map(({ label, level }) => ({ label, level }))).toEqual([
      { label: "Root title Logo", level: 1 },
      { label: "Quoted", level: 2 },
      { label: "Listed", level: 3 },
      { label: "Untitled 4/4", level: 4 },
    ]);
    expect(editor.view.dom.querySelectorAll("[data-mdw-toc-entry]")).toHaveLength(4);
  });
});

it("renders unique labelled navigation, semantic nesting, and localized empty state", () => {
  const extension = createTocExtension({
    messages: {
      emptyState: "Sin encabezados",
      navigationLabel: (occurrence, total) => `Índice ${occurrence}/${total}`,
    },
  });
  const editor = track(createRootEditor({
    attributes: { dir: "rtl", lang: "es" },
    element: host(),
    extensions: [extension],
    markdown: "[TOC]\n\n[TOC]",
  }));
  const navs = [...editor.view.dom.querySelectorAll<HTMLElement>("nav[data-mdw-toc]")];

  expect(navs.map((nav) => nav.getAttribute("aria-label"))).toEqual([
    "Índice 1/2",
    "Índice 2/2",
  ]);
  expect(navs.every((nav) => nav.getAttribute("contenteditable") === "false")).toBe(true);
  expect(navs.map((nav) => nav.querySelector("[data-mdw-toc-empty]")?.textContent))
    .toEqual(["Sin encabezados", "Sin encabezados"]);
  expect(navs[0]?.closest('[dir="rtl"]')).not.toBeNull();

  editor.commands.resetMarkdown([
    "[TOC]",
    "",
    "# One",
    "",
    "### Three",
    "",
    "## Two",
  ].join("\n"));
  const nav = editor.view.dom.querySelector<HTMLElement>("nav[data-mdw-toc]")!;
  const rootList = nav.querySelector<HTMLOListElement>(
    'ol[data-mdw-toc-list="root"]',
  )!;

  expect(rootList.children).toHaveLength(1);
  expect(rootList.querySelectorAll("li")).toHaveLength(3);
  expect(rootList.querySelectorAll('ol[data-mdw-toc-list="nested"]')).toHaveLength(1);
  expect(rootList.querySelectorAll("button[type=button]")).toHaveLength(3);
  const nestedList = rootList.querySelector('ol[data-mdw-toc-list="nested"]');
  expect(nestedList?.textContent).toContain("Three");
  expect(nestedList?.textContent).toContain("Two");
});

it("updates all outlines live while retaining entry DOM for position-only edits", () => {
  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "[TOC]\n\nPreamble\n\n[TOC]\n\n# Alpha\n\nParagraph",
  }));
  const handle = editor.extensions.get(extension);
  const firstEntry = editor.view.dom.querySelector<HTMLButtonElement>(
    '[data-mdw-toc-entry="1"]',
  )!;
  const before = handle.state.getSnapshot().headings[0]!;
  let paragraphTextPosition = 0;

  editor.view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "Preamble") {
      paragraphTextPosition = position;
      return false;
    }
    return true;
  });
  editor.view.dispatch(editor.view.state.tr.insertText("Before ", paragraphTextPosition));
  const mapped = handle.state.getSnapshot().headings[0]!;

  expect(mapped.position).toBeGreaterThan(before.position);
  expect(editor.view.dom.querySelector('[data-mdw-toc-entry="1"]')).toBe(firstEntry);

  editor.view.dispatch(editor.view.state.tr.insertText(
    "Updated",
    mapped.position + 1,
    mapped.position + 1 + "Alpha".length,
  ));
  expect(handle.state.getSnapshot().headings[0]?.label).toBe("Updated");
  expect([...editor.view.dom.querySelectorAll('[data-mdw-toc-entry="1"]')]
    .map((entry) => entry.textContent)).toEqual(["Updated", "Updated"]);

  const updated = handle.state.getSnapshot().headings[0]!;
  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
    updated.position,
    undefined,
    { level: 3 },
  ));
  expect(handle.state.getSnapshot().headings[0]?.level).toBe(3);
  expect([...editor.view.dom.querySelectorAll('[data-mdw-toc-entry="1"]')]
    .every((entry) => entry.getAttribute("data-mdw-toc-level") === "3")).toBe(true);

  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getSnapshot().headings[0]?.level).toBe(1);
  expect(editor.commands.redo()).toBe(true);
  expect(handle.state.getSnapshot().headings[0]?.level).toBe(3);

  expect(editor.commands.reconcileMarkdown(
    "[TOC]\n\n# Reconciled\n\n## Child",
  )).toBe(true);
  expect(handle.state.getSnapshot().headings.map(({ label }) => label)).toEqual([
    "Reconciled",
    "Child",
  ]);
  editor.commands.resetMarkdown("[TOC]\n\n# Reset");
  expect(handle.state.getSnapshot().headings[0]?.label).toBe("Reset");
  expect(editor.view.dom.querySelector('[data-mdw-toc-entry="1"]')?.textContent)
    .toBe("Reset");
});

it("inserts and removes one top-level marker per guarded undoable command", () => {
  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Paragraph",
  }));
  const handle = editor.extensions.get(extension);

  expect(handle.state.canInsert()).toBe(true);
  expect(handle.state.canRemove()).toBe(false);
  expect(handle.commands.insert()).toBe(true);
  expect(handle.state.isActive()).toBe(true);
  expect(handle.state.canInsert()).toBe(false);
  expect(handle.state.canRemove()).toBe(true);
  expect(handle.commands.insert()).toBe(false);
  expect(editor.getMarkdown()).toContain("[TOC]");
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getSnapshot().tocs).toHaveLength(0);
  expect(editor.commands.redo()).toBe(true);
  expect(handle.state.getSnapshot().tocs).toHaveLength(1);

  expect(handle.commands.remove()).toBe(true);
  expect(handle.state.isActive()).toBe(false);
  expect(handle.commands.remove()).toBe(false);
  expect(handle.state.getSnapshot().tocs).toHaveLength(0);
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getSnapshot().tocs).toHaveLength(1);
  expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);

  editor.updateOptions({ editable: false });
  expect(handle.commands.remove()).toBe(false);
  editor.updateOptions({ editable: true });
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(handle.commands.remove()).toBe(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
});

it("refuses nested insertion and rejects raw nested TOC transactions", () => {
  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> Quoted",
  }));
  const handle = editor.extensions.get(extension);

  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(
    editor.view.state.doc,
    2,
  )));
  expect(handle.state.canInsert()).toBe(false);
  expect(handle.commands.insert()).toBe(false);

  const before = editor.view.state.doc;
  const errors: string[] = [];
  editor.subscribe("error", ({ code }) => errors.push(code));
  editor.view.dispatch(editor.view.state.tr.insert(
    1,
    editor.view.state.schema.nodes.toc.create(),
  ));
  expect(editor.view.state.doc).toBe(before);
  expect(handle.state.getSnapshot().tocs).toEqual([]);
  expect(errors).toContain("EXTENSION_TOC_INVALID_DOCUMENT");
});

it("navigates duplicate headings by current model position without URL or slug IDs", () => {
  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "[TOC]\n\n# Duplicate\n\n# Duplicate",
  }));
  const handle = editor.extensions.get(extension);
  const [first, second] = handle.state.getSnapshot().headings;
  const firstButton = editor.view.dom.querySelector<HTMLButtonElement>(
    '[data-mdw-toc-entry="1"]',
  )!;
  const secondButton = editor.view.dom.querySelector<HTMLButtonElement>(
    '[data-mdw-toc-entry="2"]',
  )!;

  secondButton.click();
  expect(editor.view.state.selection.from).toBe(second!.position + 1);
  expect(window.location.hash).toBe("");
  expect(editor.view.dom.querySelector("h1[id], h2[id], h3[id]")).toBeNull();

  firstButton.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
  }));
  expect(editor.view.state.selection.from).toBe(first!.position + 1);

  editor.updateOptions({ editable: false });
  secondButton.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: " ",
  }));
  expect(editor.view.state.selection.from).toBe(second!.position + 1);
  expect(handle.commands.insert()).toBe(false);

  editor.updateOptions({ editable: true });
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(editor.view.composing).toBe(true);
  const selectionDuringComposition = editor.view.state.selection;
  firstButton.click();
  expect(editor.view.state.selection).toBe(selectionDuringComposition);
  secondButton.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
  }));
  expect(editor.view.state.selection).toBe(selectionDuringComposition);
  expect(window.location.hash).toBe("");
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
});

it("copies only the semantic marker and never generated outline DOM", () => {
  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "[TOC]\n\n# Secret generated label\n\n## Child label",
  }));
  const toc = editor.extensions.get(extension).state.getSnapshot().tocs[0]!;
  editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(
    editor.view.state.doc,
    toc.position,
  )));
  const copied = editor.view.serializeForClipboard(
    editor.view.state.selection.content(),
  );

  expect(copied.text).toBe("[TOC]");
  expect(copied.dom.textContent).toBe("[TOC]");
  expect(copied.dom.querySelector("div[data-mdw-toc]")).not.toBeNull();
  expect(copied.dom.querySelector("nav, ol, button, [data-mdw-toc-entry]")).toBeNull();
  expect(copied.dom.textContent).not.toContain("Secret generated label");

  editor.view.dispatch(editor.view.state.tr.setSelection(
    new AllSelection(editor.view.state.doc),
  ));
  const wholeDocument = editor.view.serializeForClipboard(
    editor.view.state.selection.content(),
  );
  const wholeText = wholeDocument.dom.textContent ?? "";

  expect(wholeDocument.text.match(/Secret generated label/g)).toHaveLength(1);
  expect(wholeDocument.text.match(/Child label/g)).toHaveLength(1);
  expect(wholeText.match(/Secret generated label/g)).toHaveLength(1);
  expect(wholeText.match(/Child label/g)).toHaveLength(1);
  expect(wholeDocument.dom.querySelector(
    "nav, ol, button, [data-mdw-toc-entry], [data-mdw-toc-occurrence]",
  )).toBeNull();
  expect(editor.getMarkdown()).toBe("[TOC]\n\n# Secret generated label\n\n## Child label");
});

it("validates options/messages and freezes public snapshots", () => {
  expect(Object.isFrozen(defaultTocMessages)).toBe(true);
  expect(() => createTocExtension(null as never)).toThrow(TypeError);
  expect(() => createTocExtension({ unknown: true } as never)).toThrow(
    'Unknown TOC extension option "unknown".',
  );
  expect(() => createTocExtension({ messages: [] as never })).toThrow(TypeError);
  expect(() => createTocExtension({ messages: { emptyState: "" } })).toThrow(
    'TOC message "emptyState" must be a non-empty string.',
  );

  const extension = createTocExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "[TOC]\n\n# Heading",
  }));
  const snapshot = editor.extensions.get(extension).state.getSnapshot();

  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.headings)).toBe(true);
  expect(Object.isFrozen(snapshot.headings[0])).toBe(true);
  expect(Object.isFrozen(snapshot.tocs)).toBe(true);
  expect(Object.isFrozen(snapshot.tocs[0])).toBe(true);
  expect(editor.extensions.uiActions).toEqual(expect.arrayContaining([
    expect.objectContaining({
      defaultLabel: "Insert table of contents",
      id: "markora-extension-toc/insert",
    }),
    expect.objectContaining({
      defaultLabel: "Remove table of contents",
      id: "markora-extension-toc/remove",
    }),
  ]));
});
