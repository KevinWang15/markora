import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as createRootEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  type FrontmatterEditRequest,
} from "../src/index";
import { isFrontmatterPlacementTransactionAllowed } from "../src/source";

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

function hasNode(editor: MarkdownEditor, name: string) {
  let found = false;
  editor.view.state.doc.descendants((node) => {
    found ||= node.type.name === name;
    return !found;
  });
  return found;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.replaceChildren();
});

describe.each(entries)("%s front matter extension", (_, createEditor) => {
  it("claims one Jekyll document-head block and preserves its exact source island", () => {
    const extension = createFrontmatterExtension();
    const source = "\uFEFF---\r\ntitle: Exact\ranchor: &base value\r\ncopy: *base\r...";
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: `${source}\r\nBody`,
    }));
    const handle = editor.extensions.get(extension);

    expect(editor.view.state.doc.firstChild?.type.name).toBe("frontmatter");
    expect(handle.state.getSource()).toBe(source);
    expect(handle.state.getDiagnostics()).toEqual([]);
    expect(editor.getMarkdown()).toBe(`${source}\n\nBody`);
    expect(editor.view.dom.querySelector("[data-mdw-frontmatter-source]")?.textContent)
      .toBe(source);
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-frontmatter",
      version: "0.0.1",
    });
  });

  it("does not claim thematic breaks, unclosed blocks, or non-head metadata", () => {
    const extension = createFrontmatterExtension();
    const thematic = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "---\n\nBody",
    }));
    const unclosed = track(createEditor({
      element: host(),
      extensions: [createFrontmatterExtension()],
      markdown: "---\ntitle: Missing close",
    }));
    const nonHead = track(createEditor({
      element: host(),
      extensions: [createFrontmatterExtension()],
      markdown: "Body\n\n---\ntitle: Late\n---",
    }));

    expect(thematic.extensions.get(extension).state.isPresent()).toBe(false);
    expect(thematic.view.state.doc.firstChild?.type.name).not.toBe("frontmatter");
    expect(hasNode(unclosed, "frontmatter")).toBe(false);
    expect(hasNode(nonHead, "frontmatter")).toBe(false);
  });
});

it("inserts, updates, removes, and undoes front matter as guarded extension transactions", () => {
  const origins: Array<string | undefined> = [];
  const extension = createFrontmatterExtension();
  const editor = track(createRootEditor({
    editable: true,
    element: host(),
    extensions: [extension],
    markdown: "Body",
    onTransaction(_transaction, _view, context) {
      origins.push(context.origin);
    },
  }));
  const handle = editor.extensions.get(extension);
  const first = "---\ntitle: First\n---";
  const second = "---\ntitle: Second\n---";

  expect(handle.state.canInsert()).toBe(true);
  expect(handle.commands.insert(first)).toBe(true);
  expect(handle.commands.insert(first)).toBe(false);
  expect(handle.state.getSource()).toBe(first);
  expect(handle.commands.update(first)).toBe(false);
  expect(handle.commands.update(second)).toBe(true);
  expect(handle.state.getSource()).toBe(second);
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getSource()).toBe(first);
  expect(editor.commands.redo()).toBe(true);
  expect(handle.state.getSource()).toBe(second);
  expect(handle.commands.remove()).toBe(true);
  expect(handle.commands.remove()).toBe(false);
  expect(handle.state.isPresent()).toBe(false);
  expect(origins).toContain("extension:markora-extension-frontmatter");

  editor.updateOptions({ editable: false });
  expect(handle.commands.insert(first)).toBe(false);
  expect(editor.extensions.uiActions[0]?.isEnabled()).toBe(false);
});

it("keeps hostile and over-limit YAML inert while exposing bounded diagnostics", () => {
  const extension = createFrontmatterExtension();
  const aliases = Array.from({ length: 51 }, (_, index) => `copy${index}: *base`).join("\n");
  const hostileSource = [
    "---",
    "title: !unsafe value",
    "html: <script>globalThis.__frontmatterExecuted = true</script>",
    "broken: [one, two",
    "base: &base value",
    aliases,
    "---",
  ].join("\n");
  const hostileEditor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: hostileSource,
  }));
  const hostileSnapshot = hostileEditor.extensions.get(extension).state.getSnapshot();
  const hostileCodes = hostileSnapshot?.diagnostics.map(({ code }) => code);

  expect(hostileSnapshot?.source).toBe(hostileSource);
  expect(hostileCodes).toEqual(expect.arrayContaining([
    "alias-limit",
    "custom-tag",
    "unbalanced-flow",
  ]));
  expect(hostileEditor.view.dom.querySelector("script, iframe, object, embed")).toBeNull();
  expect(hostileEditor.getMarkdown()).toBe(hostileSource);

  const overLimitSource = [
    "---",
    "title: !unsafe [",
    `large: ${"x".repeat(FRONTMATTER_MAX_SOURCE_BYTES)}`,
    "---",
  ].join("\n");
  const overLimitEditor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: overLimitSource,
  }));
  const overLimitSnapshot = overLimitEditor.extensions.get(extension).state.getSnapshot();

  expect(overLimitSnapshot?.source).toBe(overLimitSource);
  expect(overLimitSnapshot?.diagnostics.map(({ code }) => code))
    .toEqual(["source-too-large"]);
  expect(overLimitEditor.getMarkdown()).toBe(overLimitSource);
});

it("rejects duplicate and non-head front matter from raw transactions", () => {
  const errors: unknown[] = [];
  const invariantMessage = "Metadata must remain the one document-head block.";
  const extension = createFrontmatterExtension({
    messages: { documentInvariantDiagnostic: invariantMessage },
  });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "---\ntitle: Head\n---\n\nBody",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const node = editor.view.state.schema.nodes.frontmatter.create({
    source: "---\ntitle: Duplicate\n---",
  });
  const before = editor.getMarkdown();

  editor.view.dispatch(editor.view.state.tr.insert(
    editor.view.state.doc.content.size,
    node,
  ));

  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect((errors[0] as { error: Error }).error.message).toBe(invariantMessage);
  expect((errors[0] as { context?: { contribution?: string } }).context?.contribution)
    .toBe("document-invariant");

  const nested = editor.view.state.schema.nodes.blockquote.create(null, node);
  editor.view.dispatch(editor.view.state.tr.insert(
    editor.view.state.doc.content.size,
    nested,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(2);

  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(0, undefined, {
    source: "not a front matter envelope",
  }));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(3);
  expect((errors[2] as { code?: string; context?: { phase?: string } }).code)
    .toBe("EXTENSION_FRONTMATTER_DOCUMENT_INVARIANT");
  expect((errors[2] as { context?: { phase?: string } }).context?.phase)
    .toBe("plugin");
});

it("rejects invalid command envelopes without changing the exact source", () => {
  const errors: Array<{
    code?: string;
    context?: { contribution?: string; phase?: string };
    error?: Error;
  }> = [];
  const invalidMessage = "Metadata needs a complete delimiter envelope.";
  const extension = createFrontmatterExtension({
    messages: { invalidStructureDiagnostic: invalidMessage },
  });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "---\ntitle: Valid\n---\n\nBody",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const before = editor.getMarkdown();

  expect(handle.commands.update("title: Missing delimiters")).toBe(false);
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    code: "EXTENSION_FRONTMATTER_INVALID_SOURCE",
    context: { contribution: "source", phase: "command" },
    error: { message: invalidMessage },
  });
});

it("rejects a second front-matter node from Markdown paste", () => {
  const errors: Array<{ code?: string }> = [];
  const extension = createFrontmatterExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "---\ntitle: Head\n---\n\nBody",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  editor.focus("end");
  const before = editor.getMarkdown();

  expect(editor.commands.pasteMarkdown("---\ntitle: Pasted\n---")).toBe(true);
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.code).toBe("EXTENSION_FRONTMATTER_DOCUMENT_INVARIANT");
});

it("does not traverse the document for unrelated body typing", () => {
  const body = Array.from(
    { length: 200 },
    (_, index) => `Paragraph ${index}`,
  ).join("\n\n");

  for (const withFrontmatter of [false, true]) {
    const extension = createFrontmatterExtension();
    const editor = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: withFrontmatter
        ? `---\ntitle: Fast path\n---\n\n${body}`
        : body,
    }));
    const transaction = editor.view.state.tr.insertText(
      "!",
      editor.view.state.doc.content.size - 1,
    );
    const descendants = vi.spyOn(transaction.doc, "descendants");

    expect(isFrontmatterPlacementTransactionAllowed(
      transaction,
      editor.view.state.schema.nodes.frontmatter,
    )).toBe(true);
    expect(descendants).not.toHaveBeenCalled();
    descendants.mockRestore();
    editor.view.dispatch(transaction);

    expect(editor.getMarkdown()).toMatch(/Paragraph 199!$/);
  }
});

it("keeps quoted, commented, and block-scalar YAML syntax out of lexical diagnostics", () => {
  const extension = createFrontmatterExtension();
  const source = [
    "---",
    "title: Kevin's release",
    "double: \"literal !unsafe *alias [\"",
    "single: 'literal '' quote {'",
    "comment: value # !unsafe *alias [",
    "script: |",
    "  !unsafe *alias [",
    "  { still inert text",
    "flow: [{ name: value }]",
    "---",
  ].join("\n");
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: source,
  }));

  expect(editor.extensions.get(extension).state.getDiagnostics()).toEqual([]);
  expect(editor.getMarkdown()).toBe(source);
});

it("does not claim general YAML validity or repaint unchanged exact source", () => {
  const extension = createFrontmatterExtension({ onEditSource() {} });
  const source = "---\nvalue: [one,,two]\nquote: \"unterminated\n---";
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `${source}\n\nBody`,
  }));
  const sourceElement = editor.view.dom.querySelector<HTMLElement>(
    "[data-mdw-frontmatter-source]",
  );
  const renderedText = sourceElement?.firstChild;

  expect(editor.extensions.get(extension).state.getDiagnostics()).toEqual([]);
  expect(renderedText?.textContent).toBe(source);

  editor.view.dispatch(editor.view.state.tr.setMeta("frontmatter-test", true));
  expect(sourceElement?.firstChild).toBe(renderedText);

  editor.view.dispatch(editor.view.state.tr.insertText(
    "!",
    editor.view.state.doc.content.size - 1,
  ));
  expect(sourceElement?.firstChild).toBe(renderedText);
  expect(editor.getMarkdown()).toBe(`${source}\n\nBody!`);

  expect(editor.extensions.get(extension).commands.update(
    "---\nvalue: changed\n---",
  )).toBe(true);
  expect(sourceElement?.firstChild).not.toBe(renderedText);
});

it("provides a localized, read-only-aware, stale-safe host edit handoff", () => {
  const errors: unknown[] = [];
  const requests: FrontmatterEditRequest[] = [];
  const onEditSource = vi.fn((request: FrontmatterEditRequest) => requests.push(request));
  const extension = createFrontmatterExtension({
    messages: {
      editSource: "Edit metadata",
      insertFrontmatter: "Add metadata",
      kindLabel: "Document metadata",
      invalidStructureDiagnostic: "Metadata needs delimiters.",
      sourceLabel: "Document metadata source",
    },
    onEditSource,
  });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "---\ntitle: First\n---\n\nBody",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const region = editor.view.dom.querySelector<HTMLElement>("[data-mdw-frontmatter]");
  const button = region?.querySelector<HTMLButtonElement>("button");

  expect(region?.getAttribute("aria-label")).toBe("Document metadata source");
  expect(button?.textContent).toBe("Edit metadata");
  button?.click();
  expect(onEditSource).toHaveBeenCalledTimes(1);
  expect(requests[0]?.source).toBe("---\ntitle: First\n---");
  expect(requests[0]?.update(requests[0]!.source)).toBe(true);
  expect(requests[0]?.update("title: Missing envelope")).toBe(false);
  expect(errors).toHaveLength(1);
  expect((errors[0] as { error: Error }).error.message).toBe("Metadata needs delimiters.");
  expect(requests[0]?.update("---\ntitle: Second\n---")).toBe(true);
  expect(requests[0]?.update("---\ntitle: Stale\n---")).toBe(false);
  expect(requests[0]?.update("title: Invalid stale request")).toBe(false);
  expect(errors).toHaveLength(1);
  expect(editor.extensions.get(extension).state.getSource()).toBe(
    "---\ntitle: Second\n---",
  );

  editor.updateOptions({ editable: false });
  expect(button?.disabled).toBe(true);
  button?.click();
  expect(onEditSource).toHaveBeenCalledTimes(1);

  editor.updateOptions({ editable: true });
  expect(button?.disabled).toBe(false);
  button?.click();
  expect(requests[1]?.remove()).toBe(true);
  expect(requests[1]?.remove()).toBe(false);
});

it("validates factory options and message overrides before editor creation", () => {
  expect(() => createFrontmatterExtension({ messages: { sourceLabel: "" } }))
    .toThrow(/non-empty string/);
  expect(() => createFrontmatterExtension({ unknown: true } as never))
    .toThrow(/Unknown front matter extension option/);
  expect(() => createFrontmatterExtension({ onEditSource: "bad" } as never))
    .toThrow(/must be a function/);
});
