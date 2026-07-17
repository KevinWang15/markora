import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as createRootEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import {
  NodeSelection,
  Selection,
  TextSelection,
} from "markora/extension-api";
import {
  createFootnotesExtension,
  defaultFootnotesMessages,
  type FootnotesSnapshot,
} from "../src/index";
import { analyzeFootnoteSource } from "../src/tokenizer";
import {
  applyFootnoteIndexTransaction,
  buildFootnoteIndex,
  transactionChangesFootnoteStructure,
} from "../src/model";

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

function hasMark(editor: MarkdownEditor, name: string) {
  let found = false;
  editor.view.state.doc.descendants((node) => {
    found ||= node.marks.some((mark) => mark.type.name === name);
    return !found;
  });
  return found;
}

function snapshot(editor: MarkdownEditor, extension: ReturnType<typeof createFootnotesExtension>) {
  return editor.extensions.get(extension).state.getSnapshot();
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.replaceChildren();
});

describe.each(entries)("%s footnotes extension", (_entry, createEditor) => {
  it("round-trips references in headings and canonical multiline definitions", () => {
    const extension = createFootnotesExtension();
    const markdown = [
      "# Heading[^head]",
      "",
      "Body[^note] and again[^note].",
      "",
      "[^note]: First paragraph.",
      "",
      "    Second *paragraph*.",
      "",
      "[^note]: Duplicate definition.",
      "",
      "[^head]: Heading definition.",
    ].join("\n");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown,
    }));
    const first = snapshot(editor, extension);

    expect(first.references.map(({ label }) => label)).toEqual([
      "head",
      "note",
      "note",
    ]);
    expect(first.definitions.map(({ label, occurrence }) => ({ label, occurrence })))
      .toEqual([
        { label: "note", occurrence: 1 },
        { label: "note", occurrence: 2 },
        { label: "head", occurrence: 1 },
      ]);
    expect(first.definitions[0]?.referencePositions).toHaveLength(2);
    expect(first.definitions[1]?.referencePositions).toEqual([]);
    expect(first.diagnostics.map(({ code }) => code)).toEqual([
      "duplicate-definition",
    ]);
    expect(nodeNames(editor)).toContain("footnote_reference");
    expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.view.state.doc.firstChild?.lastChild?.type.name)
      .toBe("footnote_reference");
    const heading = editor.view.state.doc.firstChild!;
    expect(heading.canReplaceWith(
      heading.childCount,
      heading.childCount,
      editor.view.state.schema.nodes.hard_break,
    )).toBe(false);
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(
      editor.view.state.doc,
      heading.nodeSize - 1,
    )));
    expect(editor.state.can.insertHardBreak()).toBe(false);
    expect(editor.commands.insertHardBreak()).toBe(false);
    expect(nodeNames(editor)).not.toContain("hard_break");

    const canonical = editor.getMarkdown();
    expect(canonical).toContain("# Heading[^head]");
    expect(canonical).toContain("[^note]: First paragraph.");
    expect(canonical).toContain("    Second *paragraph*.");
    const reparsedExtension = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));

    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedExtension)).toEqual(first);
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-footnotes",
      version: "0.0.1",
    });
  });

  it("keeps code, escapes, HTML, math, and inline-footnote syntax literal", () => {
    const extension = createFootnotesExtension();
    const markdown = [
      "A code dollar `$open` followed by an ordinary reference[^ordinary].",
      "",
      "Escaped \\[^escaped], code `[^code]`, inline $math [^inline]$, display $$x[^display]$$, and ^[inline].",
      "",
      "<div>",
      "[^html]",
      "</div>",
      "",
      "```md",
      "[^fenced]",
      "```",
      "",
      "$$",
      "",
      "[^math-definition]: not a definition",
      "",
      "$$",
      "",
      "[^ordinary]: Resolves the ordinary reference.",
      "",
      "$$",
      "",
      "[^unmatched]: An unmatched delimiter is ordinary text.",
    ].join("\n");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown,
    }));
    const current = snapshot(editor, extension);

    expect(current.references.map(({ label }) => label)).toEqual(["ordinary"]);
    expect(current.definitions.map(({ label }) => label)).toEqual([
      "ordinary",
      "unmatched",
    ]);
    expect(current.diagnostics).toEqual([]);
    expect(editor.getMarkdown()).toContain("[^ordinary]");
  });

  it("keeps blockquote and nested-list display-math contents non-semantic", () => {
    for (const markdown of [
      [
        "> $$",
        ">",
        "> [^x]",
        ">",
        "> [^x]: not a definition",
        ">",
        "> $$",
        "",
        "Outside[^x].",
      ].join("\n"),
      [
        "- outer",
        "  - $$",
        "",
        "    [^x]",
        "",
        "    [^x]: not a definition",
        "",
        "    $$",
        "",
        "Outside[^x].",
      ].join("\n"),
      [
        "- $$",
        "",
        "\t[^x]",
        "",
        "\t[^x]: not a definition",
        "",
        "\t$$",
        "",
        "Outside[^x].",
      ].join("\n"),
      [
        "1. $$",
        "",
        "[^x]",
        "",
        "[^x]: not a definition",
        "",
        "$$",
        "",
        "Outside[^x].",
      ].join("\n"),
    ]) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));
      const current = snapshot(editor, extension);

      expect(current.references.map(({ label }) => label)).toEqual(["x"]);
      expect(current.definitions).toEqual([]);
      expect(current.diagnostics.map(({ code }) => code))
        .toEqual(["unresolved-reference"]);
    }
  });

  it("does not let inline type-7 HTML swallow following references", () => {
    for (const markdown of [
      "paragraph\n<img>\n[^x]\n\n[^x]: Definition.",
      "$$\n<img>\nText[^x]\n\n[^x]: Definition.",
    ]) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));
      const current = snapshot(editor, extension);

      expect(current.references.map(({ label }) => label)).toEqual(["x"]);
      expect(current.definitions.map(({ label }) => label)).toEqual(["x"]);
      expect(current.diagnostics).toEqual([]);
    }
  });

  it("gives matched math precedence over HTML-looking content", () => {
    for (const markdown of [
      "$$\n<div>\n$$\nOutside[^x]\n\n[^x]: d",
      "$<span> math$ Outside[^x]\n\n[^x]: d",
      "Before $<div>$ after[^x]\n\n[^x]: d",
    ]) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));
      const current = snapshot(editor, extension);

      expect(current.references.map(({ label }) => label)).toEqual(["x"]);
      expect(current.definitions.map(({ label }) => label)).toEqual(["x"]);
      expect(current.diagnostics).toEqual([]);
      const canonical = editor.getMarkdown();
      const reparsedExtension = createFootnotesExtension();
      const reparsed = track(createEditor({
        element: host(),
        extensions: [reparsedExtension],
        markdown: canonical,
      }));
      expect(reparsed.getMarkdown()).toBe(canonical);
      expect(snapshot(reparsed, reparsedExtension).references.map(({ label }) => label))
        .toEqual(["x"]);
      expect(snapshot(reparsed, reparsedExtension).definitions.map(({ label }) => label))
        .toEqual(["x"]);
    }
  });

  it("rescans HTML contexts after matched math", () => {
    for (const [markdown, expectedReferences] of [
      ["$<span>math$ <em>inside[^x]</em></span>\n\n[^x]: d", []],
      ["$<span>math$ outside[^x]</span>\n\n[^x]: d", ["x"]],
    ] as const) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));

      expect(snapshot(editor, extension).references.map(({ label }) => label))
        .toEqual(expectedReferences);
      expect(snapshot(editor, extension).definitions.map(({ label }) => label))
        .toEqual(["x"]);
      const canonical = editor.getMarkdown();
      const reparsedExtension = createFootnotesExtension();
      const reparsed = track(createEditor({
        element: host(),
        extensions: [reparsedExtension],
        markdown: canonical,
      }));
      expect(reparsed.getMarkdown()).toBe(canonical);
      expect(snapshot(reparsed, reparsedExtension).references.map(({ label }) => label))
        .toEqual(expectedReferences);
    }
  });

  it("gives code and math ownership to the earliest opener", () => {
    const mathFirst = "$`math$ Outside[^x]`\n\n[^x]: d";
    const mathFirstExtension = createFootnotesExtension();
    const mathFirstEditor = track(createEditor({
      element: host(),
      extensions: [mathFirstExtension],
      markdown: mathFirst,
    }));

    expect(snapshot(mathFirstEditor, mathFirstExtension).references.map(({ label }) => label))
      .toEqual(["x"]);
    expect(snapshot(mathFirstEditor, mathFirstExtension).definitions.map(({ label }) => label))
      .toEqual(["x"]);
    const mathFirstCanonical = mathFirstEditor.getMarkdown();
    const mathFirstReparsedExtension = createFootnotesExtension();
    const mathFirstReparsed = track(createEditor({
      element: host(),
      extensions: [mathFirstReparsedExtension],
      markdown: mathFirstCanonical,
    }));
    expect(mathFirstReparsed.getMarkdown()).toBe(mathFirstCanonical);
    expect(snapshot(mathFirstReparsed, mathFirstReparsedExtension).references.map(({ label }) => label))
      .toEqual(["x"]);

    const codeFirst = "`code $math$ [^x]`\n\n[^x]: d";
    const codeFirstExtension = createFootnotesExtension();
    const codeFirstEditor = track(createEditor({
      element: host(),
      extensions: [codeFirstExtension],
      markdown: codeFirst,
    }));

    expect(snapshot(codeFirstEditor, codeFirstExtension).references).toEqual([]);
    expect(snapshot(codeFirstEditor, codeFirstExtension).definitions.map(({ label }) => label))
      .toEqual(["x"]);
    const codeFirstCanonical = codeFirstEditor.getMarkdown();
    const codeFirstReparsedExtension = createFootnotesExtension();
    const codeFirstReparsed = track(createEditor({
      element: host(),
      extensions: [codeFirstReparsedExtension],
      markdown: codeFirstCanonical,
    }));
    expect(codeFirstReparsed.getMarkdown()).toBe(codeFirstCanonical);
    expect(snapshot(codeFirstReparsed, codeFirstReparsedExtension).references).toEqual([]);
  });

  it("continues after a code opener invalidated by earlier math", () => {
    const markdown = "$`a$ after $b [^x]$`\n\n[^x]: d";
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown,
    }));

    expect(snapshot(editor, extension).references).toEqual([]);
    expect(snapshot(editor, extension).definitions.map(({ label }) => label))
      .toEqual(["x"]);
    const canonical = editor.getMarkdown();
    const reparsedExtension = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));
    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedExtension).references).toEqual([]);
  });

  it("does not pair display delimiters through code contexts", () => {
    for (const [markdown, expectedReferences] of [
      [
        [
          "    $$",
          "Outside[^x]",
          "$$",
          "",
          "[^x]: Definition.",
        ].join("\n"),
        1,
      ],
      [
        [
          "- ```md",
          "  $$",
          "  ```",
          "Outside[^x]",
          "$$",
          "",
          "[^x]: Definition.",
        ].join("\n"),
        1,
      ],
      [
        [
          "``` bad`",
          "$$",
          "[^x]",
          "$$",
          "",
          "[^x]: Definition.",
        ].join("\n"),
        0,
      ],
    ] as const) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));
      const current = snapshot(editor, extension);

      expect(current.references).toHaveLength(expectedReferences);
      expect(current.definitions.map(({ label }) => label)).toEqual(["x"]);
    }
  });

  it("recognizes definitions after autolinks and blank-line-ended HTML blocks", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "Autolinks <https://example.test/docs> and <writer@example.test>.",
        "",
        "<div>",
        "HTML block without an explicit closing tag.",
        "",
        "Resolved[^note].",
        "",
        "[^note]: Definition after HTML.",
      ].join("\n"),
    }));
    const current = snapshot(editor, extension);

    expect(current.references.map(({ label }) => label)).toEqual(["note"]);
    expect(current.definitions.map(({ label }) => label)).toEqual(["note"]);
    expect(current.diagnostics).toEqual([]);
    expect(editor.getMarkdown()).toContain("[^note]: Definition after HTML.");
  });

  it("recovers valid inline HTML after an unterminated quoted tag", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: '<div " <span>[^x]</span>\n\n[^x]: Definition.',
    }));
    const current = snapshot(editor, extension);

    expect(current.references).toEqual([]);
    expect(current.definitions.map(({ label }) => label)).toEqual(["x"]);
  });

  it("retains outer link marks around references and round-trips them", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "[foo[^n]](https://example.test)\n\n[^n]: Definition.",
    }));
    let referenceMarks: string[] | null = null;

    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "footnote_reference") {
        referenceMarks = node.marks.map((mark) => mark.type.name);
        return false;
      }
      return true;
    });

    expect(referenceMarks).toEqual(["link"]);
    expect(snapshot(editor, extension).references).toHaveLength(1);
    const action = editor.view.dom.querySelector<HTMLElement>(
      ".mdw-footnote-reference__action",
    )!;
    const outerLink = action.closest("a")!;
    let reachedOuterLink = false;
    outerLink.addEventListener("click", (event) => {
      reachedOuterLink = true;
      event.preventDefault();
    }, { once: true });
    const selectionBeforeClick = editor.view.state.selection;
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    expect(action.getAttribute("role")).toBe("note");
    expect(action.tabIndex).toBe(-1);
    expect(action.dispatchEvent(click)).toBe(false);
    expect(reachedOuterLink).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(editor.view.state.selection.eq(selectionBeforeClick)).toBe(true);
    const canonical = editor.getMarkdown();
    const reparsedExtension = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));
    let reparsedReferenceMarks: string[] | null = null;

    reparsed.view.state.doc.descendants((node) => {
      if (node.type.name === "footnote_reference") {
        reparsedReferenceMarks = node.marks.map((mark) => mark.type.name);
        return false;
      }
      return true;
    });

    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(reparsedReferenceMarks).toEqual(["link"]);
    expect(snapshot(reparsed, reparsedExtension)).toEqual(snapshot(editor, extension));
  });

  it("keeps footnote syntax in image descriptions literal and lossless", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "![before `code` *em* [^n] after](https://example.test/a.png)",
        "",
        "[^n]: Definition.",
      ].join("\n"),
    }));
    let alt: string | null = null;

    editor.view.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        alt = typeof node.attrs.alt === "string" ? node.attrs.alt : null;
        return false;
      }
      return true;
    });

    expect(alt).toBe("before code em [^n] after");
    expect(snapshot(editor, extension).references).toEqual([]);
    expect(snapshot(editor, extension).definitions).toHaveLength(1);
    const canonical = editor.getMarkdown();
    expect(canonical).toContain("code em");
    const reparsedExtension = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));
    let reparsedAlt: string | null = null;

    reparsed.view.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        reparsedAlt = typeof node.attrs.alt === "string" ? node.attrs.alt : null;
        return false;
      }
      return true;
    });

    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(reparsedAlt).toBe("before code em [^n] after");
    expect(snapshot(reparsed, reparsedExtension).references).toEqual([]);
  });

  it("leaves ambiguous bracket and backslash labels outside the footnote grammar", () => {
    for (const markdown of [
      "[foo[^a[b]bar](https://example.test)\n\n[^a[b]: Definition.",
      "![foo[^a[b]bar](https://example.test/a.png)\n\n[^a[b]: Definition.",
      "[foo[^a\\]bar](https://example.test)\n\n[^a\\]: Definition.",
      "![foo[^a\\]bar](https://example.test/a.png)\n\n[^a\\]: Definition.",
      "[foo[^a`b]bar`baz](https://example.test)\n\n[^a`b]: Definition.",
      "![foo[^a`b]bar`baz](https://example.test/a.png)\n\n[^a`b]: Definition.",
      "[foo[^a<!--b]bar-->baz](https://example.test)\n\n[^a<!--b]: Definition.",
      "![foo[^a<!--b]bar-->baz](https://example.test/a.png)\n\n[^a<!--b]: Definition.",
    ]) {
      const extension = createFootnotesExtension();
      const editor = track(createEditor({
        element: host(),
        extensions: [extension],
        markdown,
      }));

      expect(snapshot(editor, extension).references).toEqual([]);
      expect(snapshot(editor, extension).definitions).toEqual([]);
      const canonical = editor.getMarkdown();
      const reparsedExtension = createFootnotesExtension();
      const reparsed = track(createEditor({
        element: host(),
        extensions: [reparsedExtension],
        markdown: canonical,
      }));
      expect(reparsed.getMarkdown()).toBe(canonical);
      expect(snapshot(reparsed, reparsedExtension).references).toEqual([]);
      expect(snapshot(reparsed, reparsedExtension).definitions).toEqual([]);
    }
  });

  it("rejects unsafe labels and stabilizes NUL-normalized imported source", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "Body",
    }));
    const handle = editor.extensions.get(extension);

    const invalidLabelFailure = expect.objectContaining({
      cause: expect.objectContaining({
        message: expect.stringMatching(/only Unicode/),
      }),
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "command",
    });
    expect(() => handle.commands.insertReference("a\0b")).toThrow(invalidLabelFailure);
    expect(() => handle.commands.insertDefinition("a\0b")).toThrow(invalidLabelFailure);
    expect(() => handle.commands.insertReference("a[b")).toThrow(/Extension command/);
    expect(() => handle.commands.insertDefinition("a\\b")).toThrow(/Extension command/);
    expect(() => handle.commands.insertReference("a`b")).toThrow(/Extension command/);
    expect(() => handle.commands.insertDefinition("a<b")).toThrow(/Extension command/);
    editor.commands.resetMarkdown("Body[^a\0b].\n\n[^a\0b]: Definition.");
    expect(snapshot(editor, extension).references).toEqual([]);
    expect(snapshot(editor, extension).definitions).toEqual([]);
    const canonical = editor.getMarkdown();
    expect(canonical).toContain("a\uFFFDb");
    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
  });

  it("keeps definition-body math and nested definition markers literal and model-stable", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "[^outer]: $$",
        "",
        "    [^inside-math]",
        "",
        "    $$",
        "",
        "[^literal]: [^inner]: remains literal text",
      ].join("\n"),
    }));
    const current = snapshot(editor, extension);

    expect(current.definitions.map(({ label }) => label)).toEqual([
      "outer",
      "literal",
    ]);
    expect(current.references).toEqual([]);
    expect(nodeNames(editor).filter((name) => name === "footnote_definition"))
      .toHaveLength(2);
    const canonical = editor.getMarkdown();
    const reparsedExtension = createFootnotesExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: canonical,
    }));

    expect(reparsed.getMarkdown()).toBe(canonical);
    expect(snapshot(reparsed, reparsedExtension)).toEqual(current);
  });

  it("maps ordinary edits without repainting retained footnote controls", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "First[^note] and second[^note].\n\n[^note]: Definition.",
    }));
    const before = snapshot(editor, extension);
    const definitionElement = editor.view.dom.querySelector<HTMLElement>(
      "[data-mdw-footnote-definition]",
    )!;
    const secondBackReference = definitionElement.querySelector<HTMLButtonElement>(
      '[data-mdw-footnote-back-reference="2"]',
    )!;
    const nodeTypes = {
      definition: editor.view.state.schema.nodes.footnote_definition,
      reference: editor.view.state.schema.nodes.footnote_reference,
    };
    const currentIndex = buildFootnoteIndex(
      editor.view.state.doc,
      nodeTypes,
      defaultFootnotesMessages,
    );
    const transaction = editor.view.state.tr.insertText("Prefix ", 1);
    const mappedIndex = applyFootnoteIndexTransaction(
      currentIndex,
      transaction,
      nodeTypes,
      defaultFootnotesMessages,
    );

    expect(mappedIndex.renderIdentity).toBe(currentIndex.renderIdentity);
    editor.view.dispatch(transaction);
    const after = snapshot(editor, extension);
    expect(after.references.map(({ position }) => position)).toEqual(
      before.references.map(({ position }) => position + 7),
    );
    expect(after.definitions.map(({ position }) => position)).toEqual(
      before.definitions.map(({ position }) => position + 7),
    );
    expect(editor.view.dom.querySelector("[data-mdw-footnote-definition]"))
      .toBe(definitionElement);
    expect(definitionElement.querySelector('[data-mdw-footnote-back-reference="2"]'))
      .toBe(secondBackReference);

    secondBackReference.click();
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.view.state.selection.from).toBe(after.references[1]!.position);
  });
});

it("bounds adversarial nested definition-like input without recursive parsing", () => {
  const extension = createFootnotesExtension();
  const nestedSource = Array.from(
    { length: 1_500 },
    (_, index) => `[^nested-${index}]: `,
  ).join("") + "tail";
  const editor = track(createMinimalEditor({
    element: host(),
    extensions: [extension],
    markdown: nestedSource,
  }));

  expect(snapshot(editor, extension).definitions).toHaveLength(1);
  expect(editor.getMarkdown()).toContain("nested-1499");
});

it("bounds deeply nested and unterminated HTML source analysis", () => {
  const cases = [
    {
      protected: true,
      source: `${"<div>".repeat(16_000)}[^x]${"</div>".repeat(16_000)}`,
    },
    {
      protected: false,
      source: `${"<div ".repeat(8_000)}[^x]`,
    },
    {
      protected: false,
      source: `${Array.from(
        { length: 1_000 },
        (_, index) => `${"`".repeat(index + 1)}a`,
      ).join("")}[^x]`,
    },
  ];

  for (const { protected: expectedProtected, source } of cases) {
    const started = performance.now();
    const analysis = analyzeFootnoteSource(source);
    const elapsed = performance.now() - started;
    const marker = source.indexOf("[^x]");
    const markerProtected = analysis.protectedRanges.some(({ end, start }) => (
      start <= marker && marker < end
    ));

    expect(markerProtected).toBe(expectedProtected);
    expect(elapsed).toBeLessThan(3_000);
  }
});

it("derives repeated, unresolved, case-sensitive, and duplicate diagnostics without mutation", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: [
      "One[^same], two[^same], missing[^Missing], lower[^missing].",
      "",
      "[^same]: First.",
      "",
      "[^same]: Second.",
      "",
      "[^missing]: Lowercase only.",
    ].join("\n"),
  }));
  const handle = editor.extensions.get(extension);
  const before = editor.getMarkdown();
  const current = handle.state.getSnapshot();

  expect(current.references.map(({ label, number, occurrence }) => ({
    label,
    number,
    occurrence,
  }))).toEqual([
    { label: "same", number: 1, occurrence: 1 },
    { label: "same", number: 1, occurrence: 2 },
    { label: "Missing", number: 2, occurrence: 1 },
    { label: "missing", number: 3, occurrence: 1 },
  ]);
  expect(current.diagnostics.map(({ code, label, occurrence }) => ({
    code,
    label,
    occurrence,
  }))).toEqual([
    { code: "unresolved-reference", label: "Missing", occurrence: 1 },
    { code: "duplicate-definition", label: "same", occurrence: 2 },
  ]);
  expect(handle.state.getDiagnostics()).toBe(current.diagnostics);
  expect(handle.state.getReferences("same")).toEqual(current.references.slice(0, 2));
  expect(handle.state.getDefinition({ label: "same", occurrence: 2 }))
    .toEqual(current.definitions[1]);
  expect(editor.getMarkdown()).toBe(before);
  expect(Object.isFrozen(current)).toBe(true);
  expect(Object.isFrozen(current.references)).toBe(true);
  expect(Object.isFrozen(current.diagnostics[0])).toBe(true);
});

it("normalizes labels without Unicode folding and preserves complex supported blocks", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: [
      "Unicode[^  Café au lait  ] and decomposed[^Café].",
      "",
      "[^Café au lait]: - first",
      "    - second",
      "",
      "    > quoted block",
      "",
      "[^Café]: ```js",
      "    const answer = 42;",
      "    ```",
      "",
      "[^empty]:",
      "",
      "[ordinary]: https://example.test",
      "",
      "An [ordinary] reference link.",
    ].join("\n"),
  }));
  const current = snapshot(editor, extension);

  expect(current.references.map(({ label }) => label)).toEqual([
    "Café au lait",
    "Café",
  ]);
  expect(current.definitions.map(({ label }) => label)).toEqual([
    "Café au lait",
    "Café",
    "empty",
  ]);
  expect(current.references[0]?.number).not.toBe(current.references[1]?.number);
  expect(current.diagnostics).toEqual([]);
  expect(nodeNames(editor)).toContain("bullet_list");
  expect(nodeNames(editor)).toContain("blockquote");
  expect(nodeNames(editor)).toContain("code_block");
  expect(hasMark(editor, "link")).toBe(true);
  const canonical = editor.getMarkdown();
  const reparsedExtension = createFootnotesExtension();
  const reparsed = track(createRootEditor({
    element: host(),
    extensions: [reparsedExtension],
    markdown: canonical,
  }));
  expect(reparsed.getMarkdown()).toBe(canonical);
  expect(snapshot(reparsed, reparsedExtension)).toEqual(current);
});

it("runs insert, rename, remove, navigation, undo, and redo as guarded typed commands", () => {
  const origins: Array<string | undefined> = [];
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Body",
    onTransaction(_transaction, _view, context) {
      origins.push(context.origin);
    },
  }));
  const handle = editor.extensions.get(extension);
  editor.focus("end");

  expect(handle.commands.insertReference(" note ")).toBe(true);
  expect(handle.commands.insertDefinition("note")).toBe(true);
  expect(handle.commands.insertDefinition("note")).toBe(false);
  expect(editor.getMarkdown()).toBe("Body[^note]\n\n[^note]: ");
  expect(handle.state.getDiagnostics()).toEqual([]);

  expect(handle.commands.renameDefinition(
    { label: "note" },
    "renamed",
    { references: "preserve" },
  )).toBe(true);
  expect(handle.state.getDiagnostics().map(({ code }) => code))
    .toEqual(["unresolved-reference"]);
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getDiagnostics()).toEqual([]);

  expect(handle.commands.renameDefinition(
    { label: "note" },
    "renamed",
    { references: "rename" },
  )).toBe(true);
  expect(editor.getMarkdown()).toBe("Body[^renamed]\n\n[^renamed]: ");
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getMarkdown()).toBe("Body[^note]\n\n[^note]: ");
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getMarkdown()).toBe("Body[^renamed]\n\n[^renamed]: ");

  expect(handle.commands.navigateToReference("renamed")).toBe(true);
  expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
  expect(handle.commands.navigateToReference("renamed")).toBe(false);
  expect(handle.commands.navigateToDefinition("renamed")).toBe(true);
  const definition = handle.state.getDefinition({ label: "renamed" })!;
  expect(editor.view.state.selection.from).toBeGreaterThan(definition.position);
  expect(editor.view.state.selection.to)
    .toBeLessThan(definition.position + editor.view.state.doc.nodeAt(definition.position)!.nodeSize);

  expect(handle.commands.removeDefinition(
    { label: "renamed" },
    { references: "preserve" },
  )).toBe(true);
  expect(handle.state.getDiagnostics().map(({ code }) => code))
    .toEqual(["unresolved-reference"]);
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getDiagnostics()).toEqual([]);
  expect(handle.commands.removeDefinition(
    { label: "renamed" },
    { references: "remove" },
  )).toBe(true);
  expect(editor.getMarkdown()).toBe("Body");
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getMarkdown()).toBe("Body[^renamed]\n\n[^renamed]: ");
  expect(origins).toContain("extension:markora-extension-footnotes");

  expect(handle.commands.renameDefinition(
    { label: "renamed" },
    "renamed",
    { references: "rename" },
  )).toBe(false);
  editor.updateOptions({ editable: false });
  expect(handle.commands.removeDefinition(
    { label: "renamed" },
    { references: "remove" },
  )).toBe(false);
  editor.updateOptions({ editable: true });
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(handle.commands.renameDefinition(
    { label: "renamed" },
    "composing",
    { references: "rename" },
  )).toBe(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
});

it("targets duplicate definitions explicitly and preserves collision semantics", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: [
      "Text[^note].",
      "",
      "[^note]: First.",
      "",
      "[^note]: Second.",
    ].join("\n"),
  }));
  const handle = editor.extensions.get(extension);

  expect(handle.commands.renameDefinition(
    { label: "note", occurrence: 2 },
    "other",
    { references: "preserve" },
  )).toBe(true);
  expect(handle.state.getDiagnostics()).toEqual([]);
  expect(handle.state.getDefinition({ label: "note" })?.referencePositions)
    .toHaveLength(1);
  expect(handle.state.getDefinition({ label: "other" })?.referencePositions)
    .toEqual([]);
  expect(handle.commands.removeDefinition(
    { label: "other" },
    { references: "preserve" },
  )).toBe(true);
  expect(handle.state.getReferences("note")).toHaveLength(1);

  expect(editor.commands.pasteMarkdown("[^note]: Pasted collision.")).toBe(true);
  expect(handle.state.getDiagnostics().map(({ code }) => code))
    .toContain("duplicate-definition");
  expect(handle.state.getDefinition({ label: "note", occurrence: 2 }))
    .not.toBeNull();
});

it("renders editor-scoped accessible relationships and navigates them in read-only mode", () => {
  const messages = {
    backReferenceLabel: (label: string, _number: number, occurrence: number) => (
      `Retour ${occurrence}: ${label}`
    ),
    definitionText: (label: string, number: number) => `Note ${number}: ${label}`,
    referenceText: (number: number) => `N${number}`,
  };
  const firstExtension = createFootnotesExtension({ messages });
  const first = track(createRootEditor({
    element: host(),
    extensions: [firstExtension],
    markdown: [
      "First[^note] and second[^note].",
      "",
      "[^note]: Definition.",
      "",
      "[^note]: Duplicate.",
    ].join("\n"),
  }));
  const secondExtension = createFootnotesExtension({ messages });
  const second = track(createRootEditor({
    element: host(),
    extensions: [secondExtension],
    markdown: "Other[^note].\n\n[^note]: Other definition.",
  }));
  const referenceActions = [...first.view.dom.querySelectorAll<HTMLElement>(
    ".mdw-footnote-reference__action",
  )];
  const definitions = [...first.view.dom.querySelectorAll<HTMLElement>(
    ".mdw-footnote-definition",
  )];
  const firstDefinition = definitions[0]!;
  const duplicateDefinition = definitions[1]!;

  expect(referenceActions).toHaveLength(2);
  expect(referenceActions[0]?.textContent).toBe("N1");
  expect(referenceActions[0]?.getAttribute("aria-controls")).toBe(firstDefinition.id);
  expect(firstDefinition.id).not.toBe("");
  expect(second.view.dom.querySelector(".mdw-footnote-definition")?.id)
    .not.toBe(firstDefinition.id);
  expect(duplicateDefinition.dataset.mdwFootnoteState).toBe("duplicate");
  expect(duplicateDefinition.querySelector(".mdw-footnote-definition__label")?.textContent)
    .toContain("Duplicate definition");
  expect(duplicateDefinition.querySelector(".mdw-footnote-definition__backrefs")?.hidden)
    .toBe(true);

  first.updateOptions({ editable: false });
  referenceActions[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const firstSnapshot = snapshot(first, firstExtension);
  const primary = firstSnapshot.definitions[0]!;
  expect(first.view.state.selection.from).toBeGreaterThan(primary.position);

  const backReferences = [...firstDefinition.querySelectorAll<HTMLButtonElement>(
    ".mdw-footnote-definition__backref",
  )];
  expect(backReferences).toHaveLength(2);
  expect(backReferences[1]?.getAttribute("aria-label")).toBe("Retour 2: note");
  backReferences[1]!.click();
  expect(first.view.state.selection).toBeInstanceOf(NodeSelection);
  expect(first.view.state.selection.from).toBe(firstSnapshot.references[1]?.position);

  first.updateOptions({ editable: true });
  first.view.focus();
  first.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  referenceActions[0]!.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    key: "Enter",
  }));
  expect(first.view.state.selection.from).toBe(firstSnapshot.references[1]?.position);
  first.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
});

it("consumes unresolved reference keyboard activation without moving selection", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Missing[^missing].",
  }));
  editor.updateOptions({ editable: false });
  const action = editor.view.dom.querySelector<HTMLElement>(
    ".mdw-footnote-reference__action",
  )!;
  const before = editor.view.state.selection;

  expect(action.getAttribute("aria-disabled")).toBe("true");
  for (const key of ["Enter", " "]) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    });
    expect(action.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.view.state.selection.eq(before)).toBe(true);
  }
});

it("keeps definition navigation bounded when its body has no text selection", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Reference[^rule].\n\n[^rule]: ---\n\nFollowing paragraph.",
  }));
  const handle = editor.extensions.get(extension);
  const definition = handle.state.getDefinition({ label: "rule" })!;

  expect(handle.commands.navigateToDefinition("rule")).toBe(true);
  expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.view.state.selection.from).toBe(definition.position);
});

it("rebuilds diagnostics and relationships after reset and reconciliation", () => {
  const extension = createFootnotesExtension();
  const editor = track(createMinimalEditor({
    element: host(),
    extensions: [extension],
    markdown: "Missing[^note].",
  }));
  const handle = editor.extensions.get(extension);

  expect(handle.state.getDiagnostics().map(({ code }) => code))
    .toEqual(["unresolved-reference"]);
  expect(editor.commands.reconcileMarkdown(
    "Resolved[^note].\n\n[^note]: Reconciled.",
  )).toBe(true);
  expect(handle.state.getDiagnostics()).toEqual([]);
  expect(handle.state.getReferences("note")).toHaveLength(1);
  editor.commands.resetMarkdown(
    "Twice[^note][^note].\n\n[^note]: Reset.\n\n[^note]: Duplicate.",
  );
  expect(handle.state.getReferences("note")).toHaveLength(2);
  expect(handle.state.getDiagnostics().map(({ code }) => code))
    .toEqual(["duplicate-definition"]);
  expect(handle.state.getDefinition({ label: "note" })?.referencePositions)
    .toHaveLength(2);
});

it("serializes whole and partial definition selections as self-contained clipboard data", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Text[^note].\n\n[^note]: Definition body.",
  }));
  const definition = snapshot(editor, extension).definitions[0]!;
  const doc = editor.view.state.doc;
  editor.view.dispatch(editor.view.state.tr.setSelection(
    NodeSelection.create(doc, definition.position),
  ));
  const whole = editor.view.serializeForClipboard(editor.view.state.selection.content());

  expect(whole.text).toBe("[^note]: Definition body.");
  expect(whole.dom.querySelector("[data-mdw-footnote-definition]")).not.toBeNull();

  const partialFrom = definition.position + 2;
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(
    editor.view.state.doc,
    partialFrom,
    partialFrom + "Definition".length,
  )));
  const partial = editor.view.serializeForClipboard(editor.view.state.selection.content());

  expect(partial.slice.openStart).toBe(0);
  expect(partial.slice.openEnd).toBe(0);
  expect(partial.text).toBe("[^note]: Definition");
  expect(partial.dom.querySelector("[data-mdw-footnote-definition]")).not.toBeNull();
});

it("serializes reference clipboard HTML as truthful noninteractive semantics", () => {
  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Text[^note].\n\n[^note]: Definition body.",
  }));
  const reference = snapshot(editor, extension).references[0]!;
  editor.view.dispatch(editor.view.state.tr.setSelection(
    NodeSelection.create(editor.view.state.doc, reference.position),
  ));
  const copied = editor.view.serializeForClipboard(
    editor.view.state.selection.content(),
  );
  const action = copied.dom.querySelector<HTMLElement>(
    ".mdw-footnote-reference__action",
  )!;

  expect(action.getAttribute("role")).toBe("note");
  expect(action.hasAttribute("tabindex")).toBe(false);
  expect(action.textContent).toBe("[^note]");
});

describe.each(entries)("%s nested footnote clipboard", (_entry, createEditor) => {
  it.each([
    {
      container: "blockquote",
      copiedText: "[^note]: Quoted body",
      markdown: "> [^note]: Quoted body text.",
      selectedText: "Quoted body",
    },
    {
      container: "list",
      copiedText: "[^note]: Listed body",
      markdown: "* [^note]: Listed body text.",
      selectedText: "Listed body",
    },
  ])("closes a partial definition inside a $container", ({
    copiedText,
    markdown,
    selectedText,
  }) => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown,
    }));
    let from = -1;

    editor.view.state.doc.descendants((node, position) => {
      const offset = node.isText ? node.text?.indexOf(selectedText) ?? -1 : -1;

      if (offset >= 0) {
        from = position + offset;
        return false;
      }
      return from < 0;
    });
    expect(from).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(
      editor.view.state.doc,
      from,
      from + selectedText.length,
    )));

    const copied = editor.view.serializeForClipboard(
      editor.view.state.selection.content(),
    );

    expect(copied.slice.openStart).toBe(0);
    expect(copied.slice.openEnd).toBe(0);
    expect(copied.text).toBe(copiedText);
    expect(copied.dom.querySelector("[data-mdw-footnote-definition]")).not.toBeNull();
  });

  it("closes a nested partial selection ending at the definition body boundary", () => {
    const extension = createFootnotesExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "* [^note]: Prefix boundary",
    }));
    const selectedText = "boundary";
    const definition = snapshot(editor, extension).definitions[0]!;
    const definitionNode = editor.view.state.doc.nodeAt(definition.position)!;
    let from = -1;

    editor.view.state.doc.descendants((node, position) => {
      const offset = node.isText ? node.text?.indexOf(selectedText) ?? -1 : -1;

      if (offset >= 0) {
        from = position + offset;
        return false;
      }
      return from < 0;
    });
    expect(from).toBeGreaterThanOrEqual(0);

    const partialSelection = editor.view.state.doc.slice(
      from,
      definition.position + definitionNode.nodeSize - 1,
      true,
    );
    expect(partialSelection.openStart).toBeGreaterThan(partialSelection.openEnd);

    const copied = editor.view.serializeForClipboard(partialSelection);

    expect(copied.slice.openStart).toBe(0);
    expect(copied.slice.openEnd).toBe(0);
    expect(copied.text).toBe("[^note]: boundary");
    expect(copied.dom.querySelector("[data-mdw-footnote-definition]")).not.toBeNull();
  });
});

it("lifts a whole-definition paste out of the current definition", () => {
  const extension = createFootnotesExtension();
  const original = "Text[^note].\n\n[^note]: Definition body.";
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: original,
  }));
  editor.view.dispatch(editor.view.state.tr.setSelection(
    Selection.atEnd(editor.view.state.doc),
  ));
  const values = new Map([
    ["text/markdown", "[^note]: Pasted collision."],
    ["text/plain", "[^note]: Pasted collision."],
  ]);
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      files: { length: 0 },
      getData: (type: string) => values.get(type) ?? "",
      items: [{ kind: "string" }],
      types: [...values.keys()],
    },
  });

  expect(editor.view.dom.dispatchEvent(event)).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(snapshot(editor, extension).definitions).toHaveLength(2);
  expect(snapshot(editor, extension).diagnostics.map(({ code }) => code))
    .toEqual(["duplicate-definition"]);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getMarkdown()).toBe(original);
});

it("rejects invalid raw labels and avoids full-document scans for ordinary typing", () => {
  const errors: Array<{ code?: string; error?: Error }> = [];
  const extension = createFootnotesExtension({
    messages: {
      invalidDocumentDiagnostic: (label) => `Invalid label: ${label || "empty"}`,
    },
  });
  const body = Array.from({ length: 200 }, (_, index) => `Paragraph ${index}`).join("\n\n");
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `Start[^note].\n\n${body}\n\n[^note]: Definition.`,
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const reference = snapshot(editor, extension).references[0]!;
  const referenceNode = editor.view.state.doc.nodeAt(reference.position)!;
  const before = editor.getMarkdown();

  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
    reference.position,
    referenceNode.type,
    { ...referenceNode.attrs, label: " " },
    referenceNode.marks,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.code).toBe("EXTENSION_FOOTNOTES_INVALID_DOCUMENT");
  expect(errors[0]?.error?.message).toBe("Invalid label: empty");

  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
    reference.position,
    referenceNode.type,
    { ...referenceNode.attrs, label: "a\0b" },
    referenceNode.marks,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(2);
  expect(errors[1]?.code).toBe("EXTENSION_FOOTNOTES_INVALID_DOCUMENT");
  expect(errors[1]?.error?.message).toContain("Invalid label:");

  const codeMark = editor.view.state.schema.marks.code.create();
  editor.view.dispatch(editor.view.state.tr.addMark(
    reference.position,
    reference.position + 1,
    codeMark,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(3);
  expect(errors[2]?.error?.message).toContain("cannot carry a code mark");

  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(
    reference.position,
    referenceNode.type,
    referenceNode.attrs,
    [codeMark],
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(4);
  expect(errors[3]?.error?.message).toContain("cannot carry a code mark");

  const definitionType = editor.view.state.schema.nodes.footnote_definition;
  const paragraphType = editor.view.state.schema.nodes.paragraph;
  const nestedDefinition = definitionType.create(
    { label: "inner" },
    paragraphType.create(null, editor.view.state.schema.text("Nested body")),
  );
  const outerDefinition = definitionType.create(
    { label: "outer" },
    nestedDefinition,
  );
  editor.view.dispatch(editor.view.state.tr.insert(
    editor.view.state.doc.content.size,
    outerDefinition,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(5);
  expect(errors[4]?.error?.message).toContain("cannot be nested");

  const transaction = editor.view.state.tr.insertText("!", 1);
  const nodeTypes = {
    definition: editor.view.state.schema.nodes.footnote_definition,
    reference: editor.view.state.schema.nodes.footnote_reference,
  };
  const currentIndex = buildFootnoteIndex(
    editor.view.state.doc,
    nodeTypes,
    defaultFootnotesMessages,
  );
  const descendants = vi.spyOn(transaction.doc, "descendants");
  expect(transactionChangesFootnoteStructure(transaction, nodeTypes)).toBe(false);
  applyFootnoteIndexTransaction(
    currentIndex,
    transaction,
    nodeTypes,
    defaultFootnotesMessages,
  );
  expect(descendants).not.toHaveBeenCalled();
  descendants.mockRestore();
  editor.view.dispatch(transaction);
  expect(editor.getMarkdown()).toMatch(/^!Start/);
});

it("validates labels, targets, policies, options, and formatter output", () => {
  expect(Object.isFrozen(defaultFootnotesMessages)).toBe(true);
  expect(() => createFootnotesExtension({ unknown: true } as never))
    .toThrow(/Unknown footnotes extension option/);
  expect(() => createFootnotesExtension({ messages: { referenceText: "bad" } as never }))
    .toThrow(/must be a formatter function/);
  expect(() => createFootnotesExtension({ messages: new Date() as never }))
    .toThrow(/plain partial message object/);
  expect(() => createFootnotesExtension({ messages: { referenceText: () => "" } }))
    .toThrow(/must return a non-empty string/);

  const extension = createFootnotesExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Body",
  }));
  const handle = editor.extensions.get(extension);

  expect(() => handle.commands.insertReference(" ")).toThrow(/Extension command/);
  expect(() => handle.commands.insertDefinition("bad]label")).toThrow(/Extension command/);
  expect(() => handle.state.getDefinition({ label: "note", occurrence: 0 }))
    .toThrow(/Extension state query/);
  expect(() => handle.commands.renameDefinition(
    { label: "note" },
    "other",
    {} as never,
  )).toThrow(/Extension command/);
  expect(() => handle.commands.removeDefinition(
    { label: "note" },
    { references: "rename" } as never,
  )).toThrow(/Extension command/);
});
