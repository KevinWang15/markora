import { afterEach, describe, expect, it } from "vitest";
import {
  createEditor as createRootEditor,
  createMinimalMarkdownEditorPreset,
  defineMarkdownEditorPreset,
  type MarkdownEditor,
} from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import {
  NodeSelection,
  defineMarkdownEditorExtension,
  readMarkdownEditorOpaqueTokenSource,
} from "markora/extension-api";
import {
  createHtmlExtension,
  type HtmlEditRequest,
  type HtmlNodeSnapshot,
} from "../src/index";
import {
  isHtmlDocumentValid,
  isHtmlTransactionAllowed,
} from "../src/source";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const editors: MarkdownEditor[] = [];

function host(child?: Node) {
  const element = document.createElement("div");
  if (child) element.append(child);
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function documentNodes(editor: MarkdownEditor, names: readonly string[]) {
  const nodes: Array<Readonly<{
    kind: unknown;
    name: string;
    position: number;
    source: unknown;
  }>> = [];

  editor.view.state.doc.descendants((node, position) => {
    if (names.includes(node.type.name)) {
      nodes.push({
        kind: node.attrs.kind,
        name: node.type.name,
        position,
        source: node.attrs.source,
      });
    }
  });
  return nodes;
}

function snapshotShape(nodes: readonly HtmlNodeSnapshot[]) {
  return nodes.map(({ display, kind, source }) => ({ display, kind, source }));
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.replaceChildren();
  delete (globalThis as typeof globalThis & { __markoraHtmlExecuted?: boolean })
    .__markoraHtmlExecuted;
});

describe("HTML exact-source codec", () => {
  it("claims exact block, inline, and comment spans including internal CRLF", () => {
    const block = '<div data-kind="exact">\r\nblock\r\n</div>';
    const blockComment = "<!-- block\r\ncomment -->";
    const open = '<span data-label="[a] &amp;">';
    const close = "</span>";
    const inlineComment = "<!-- inline\r\ncomment -->";
    const markdown = [
      block,
      blockComment,
      `Before ${open}inside${close} ${inlineComment} after.`,
    ].join("\r\n\r\n");
    const expected = [
      block,
      blockComment,
      `Before ${open}inside${close} ${inlineComment} after.`,
    ].join("\n\n");
    const extension = createHtmlExtension();
    const editor = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: `${markdown}\r\n`,
    }));
    const handle = editor.extensions.get(extension);

    expect(snapshotShape(handle.state.getNodes())).toEqual([
      { display: "block", kind: "html-block", source: block },
      { display: "block", kind: "html-comment", source: blockComment },
      { display: "inline", kind: "inline-html", source: open },
      { display: "inline", kind: "inline-html", source: close },
      { display: "inline", kind: "html-comment", source: inlineComment },
    ]);
    expect(documentNodes(editor, ["html_block", "html_inline"]))
      .toHaveLength(5);
    expect(editor.getMarkdown()).toBe(expected);
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-html",
      version: "0.0.1",
    });

    const reparsedExtension = createHtmlExtension();
    const reparsed = track(createRootEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: editor.getMarkdown(),
    }));

    expect(snapshotShape(reparsed.extensions.get(reparsedExtension).state.getNodes()))
      .toEqual(snapshotShape(handle.state.getNodes()));
    expect(reparsed.getMarkdown()).toBe(expected);
  });

  it("leaves malformed HTML literal and preserves root opaque source when absent", () => {
    const extension = createHtmlExtension();
    const malformed = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: "Before < not-html > and <!-- unclosed after.",
    }));

    expect(malformed.extensions.get(extension).state.getNodes()).toEqual([]);
    expect(documentNodes(malformed, ["html_block", "html_inline"]))
      .toEqual([]);

    const block = '<section data-value="exact">\r\nBody\r\n</section>';
    const inline = '<mark data-value="exact">';
    const source = `${block}\r\n\r\nBefore ${inline}after.</mark>`;
    const fallback = track(createRootEditor({
      element: host(),
      markdown: source,
    }));
    const opaque = documentNodes(fallback, ["raw_block", "raw_inline"]);

    expect(opaque).toEqual([
      {
        kind: "html-block",
        name: "raw_block",
        position: 0,
        source: block,
      },
      expect.objectContaining({
        kind: "inline-html",
        name: "raw_inline",
        source: inline,
      }),
      expect.objectContaining({
        kind: "inline-html",
        name: "raw_inline",
        source: "</mark>",
      }),
    ]);
    expect(fallback.getMarkdown()).toBe(`${block}\n\nBefore ${inline}after.</mark>`);
    expect(fallback.view.state.schema.nodes.html_block).toBeUndefined();
    expect(fallback.view.state.schema.nodes.html_inline).toBeUndefined();
  });

  it("owns recognized nested HTML while retaining the compatibility normalization boundary", () => {
    const extension = createHtmlExtension();
    const editor = track(createRootEditor({
      element: host(),
      extensions: [extension],
      markdown: "> <div>\r\n> Nested\r\n> </div>",
    }));
    const nodes = editor.extensions.get(extension).state.getNodes("block");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      display: "block",
      kind: "html-block",
      source: "<div>\nNested\n</div>",
    });
    expect(documentNodes(editor, ["raw_block"])).toEqual([]);
    expect(editor.getMarkdown()).toBe("> <div>\n> Nested\n> </div>");
  });

  it("preserves exact opaque metadata for later ordered tokenizer observers", () => {
    const captured: string[] = [];
    const extension = createHtmlExtension();
    const observer = defineMarkdownEditorExtension({
      name: "acme-html-source-observer",
      version: "1.0.0",
      compatibility: {
        extensionApi: "^1.3.0",
        markora: "^0.0.1",
      },
      markdown: {
        tokenizerRules: [{
          id: "observe-claimed-html",
          phase: "core",
          after: ["markora-extension-html/claim"],
          createRule: () => (state) => {
            for (const token of state.tokens) {
              const blockSource = readMarkdownEditorOpaqueTokenSource(token);
              if (blockSource !== null) captured.push(blockSource);

              for (const child of token.children ?? []) {
                const inlineSource = readMarkdownEditorOpaqueTokenSource(child);
                if (inlineSource !== null) captured.push(inlineSource);
              }
            }
          },
        }],
      },
    });
    const block = "<div>\r\nexact\r\n</div>";
    const inline = "<!-- inline\r\nexact -->";

    track(createRootEditor({
      element: host(),
      extensions: [observer, extension],
      markdown: `${block}\r\n\r\nBefore ${inline} after.`,
    }));

    expect(captured).toEqual([block, inline]);
  });
});

it("requires the full codec anchors and works with every root preset", () => {
  const extension = createHtmlExtension();
  const minimalChild = document.createElement("span");
  minimalChild.textContent = "minimal sentinel";
  const customChild = document.createElement("span");
  customChild.textContent = "custom sentinel";
  const minimalHost = host(minimalChild);
  const customHost = host(customChild);
  const customPreset = defineMarkdownEditorPreset({ extensions: [extension] });

  expect(() => createMinimalEditor({
    element: minimalHost,
    extensions: [extension],
    markdown: "<div>unsafe fallback</div>",
  })).toThrow(expect.objectContaining({
    code: "EXTENSION_MISSING_DEPENDENCY",
    extension: "markora-extension-html",
    phase: "tokenizer",
  }));
  const customEditor = track(createRootEditor({
    element: customHost,
    extensionPreset: customPreset,
    markdown: "<div>unsafe fallback</div>",
  }));

  expect(minimalHost.childNodes).toEqual(expect.objectContaining({ length: 1 }));
  expect(minimalHost.firstChild).toBe(minimalChild);
  expect(minimalHost.classList.contains("mdw-host")).toBe(false);
  expect(customHost.classList.contains("mdw-host")).toBe(true);
  expect(customEditor.getMarkdown()).toBe("<div>unsafe fallback</div>");

  const rootMinimalHost = host(document.createTextNode("root minimal sentinel"));
  const rootMinimalEditor = track(createRootEditor({
    element: rootMinimalHost,
    extensionPreset: createMinimalMarkdownEditorPreset(),
    extensions: [createHtmlExtension()],
  }));
  expect(rootMinimalHost.classList.contains("mdw-host")).toBe(true);
  expect(rootMinimalEditor.extensions.has("markora-extension-html")).toBe(true);
});

it("updates, removes, undoes, and rejects stale or read-only source operations", () => {
  const origins: Array<string | undefined> = [];
  const errors: Array<{ code?: string }> = [];
  let editRequest: HtmlEditRequest | undefined;
  const initialBlock = "<div>First</div>";
  const updatedBlock = "<section>Second</section>";
  const extension = createHtmlExtension({
    onEditSource(request) {
      editRequest = request;
    },
  });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `${initialBlock}\n\nBefore <mark>inside</mark>.`,
    onTransaction(_transaction, _view, context) {
      origins.push(context.origin);
    },
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const initial = handle.state.getNodes("block")[0]!;
  const editButton = editor.view.dom.querySelector<HTMLButtonElement>(
    '[data-mdw-html-display="block"] button',
  );

  editButton?.click();
  expect(editRequest).toMatchObject({
    display: "block",
    kind: "html-block",
    source: initialBlock,
  });
  const request = editRequest!;
  expect(handle.state.getNode(request)).toMatchObject({
    identity: request.identity,
    source: initialBlock,
  });
  expect(handle.commands.update(request, initialBlock)).toBe(false);
  expect(handle.commands.update(initial, initialBlock)).toBe(false);
  expect(handle.commands.update(initial, updatedBlock)).toBe(true);
  expect(handle.state.getNodes("block")[0]?.source).toBe(updatedBlock);
  expect(editor.getMarkdown()).toContain(updatedBlock);
  expect(editRequest?.update("<aside>stale</aside>")).toBe(false);
  expect(editRequest?.remove()).toBe(false);
  const staleErrorCount = errors.length;
  expect(handle.commands.update(initial, "ordinary stale text")).toBe(false);
  expect(errors).toHaveLength(staleErrorCount);
  expect(origins).toContain("extension:markora-extension-html");

  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getNodes("block")[0]?.source).toBe(initialBlock);
  expect(editor.commands.redo()).toBe(true);
  expect(handle.state.getNodes("block")[0]?.source).toBe(updatedBlock);

  const updated = handle.state.getNodes("block")[0]!;
  expect(handle.commands.update(updated, "ordinary text")).toBe(false);
  expect(errors.at(-1)?.code).toBe("EXTENSION_HTML_INVALID_SOURCE");
  expect(handle.state.getNodes("block")[0]?.source).toBe(updatedBlock);

  expect(handle.commands.remove(updated)).toBe(true);
  expect(handle.state.getNodes("block")).toEqual([]);
  expect(editor.commands.undo()).toBe(true);
  const restored = handle.state.getNodes("block")[0]!;
  expect(restored.source).toBe(updatedBlock);

  editor.updateOptions({ editable: false });
  const readOnlyErrorCount = errors.length;
  expect(handle.commands.update(restored, "ordinary read-only text")).toBe(false);
  expect(errors).toHaveLength(readOnlyErrorCount);
  expect(handle.commands.update(restored, "<aside>Read only</aside>")).toBe(false);
  expect(handle.commands.remove(restored)).toBe(false);
  expect(handle.commands.togglePreview(restored)).toBe(false);
  expect(handle.commands.retryPreview(restored)).toBe(false);
  expect(handle.state.getNodes("block")[0]?.source).toBe(updatedBlock);
});

it("retains controller-backed commands across hard reset and uses valid inline DOM", () => {
  const extension = createHtmlExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Before <span>inside</span>.\n\n<div>Before</div>",
  }));
  const errors: Array<{ code?: string }> = [];
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const inline = editor.view.dom.querySelector<HTMLElement>(
    '[data-mdw-html-display="inline"]',
  );

  expect(inline?.querySelector("div")).toBeNull();
  editor.commands.resetMarkdown("<section>After reset</section>");
  const resetTarget = handle.state.getNodes("block")[0]!;
  expect(handle.commands.togglePreview(resetTarget)).toBe(true);
  expect(handle.state.getRenderState(resetTarget)).toEqual({
    enabled: true,
    errorCode: "renderer-missing",
    status: "error",
  });
  expect(errors.at(-1)?.code).toBe("EXTENSION_HTML_RENDERER_MISSING");
  expect(handle.commands.togglePreview(resetTarget)).toBe(true);
});

it("never nests inline HTML action buttons inside a link mark", () => {
  const extension = createHtmlExtension({ onEditSource() {} });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "[<em>linked</em>](https://example.com)",
  }));
  const inline = editor.extensions.get(extension).state.getNodes("inline")[0]!;
  const link = editor.view.dom.querySelector<HTMLAnchorElement>("a");

  expect(link?.querySelectorAll('[data-mdw-html-display="inline"]'))
    .toHaveLength(2);
  expect(link?.querySelector("button")).toBeNull();
  editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(
    editor.view.state.doc,
    inline.position,
  )));
  expect(link?.querySelector("button")).toBeNull();
});

it("adopts equal-document resets while aborting the prior render generation", async () => {
  const pending: Array<{
    resolve(node: Node): void;
    signal: AbortSignal;
    source: string;
  }> = [];
  const extension = createHtmlExtension({
    renderer: ({ ownerDocument, signal, source }) => new Promise<Node>((resolve) => {
      pending.push({ resolve, signal, source });
    }),
  });
  const source = "<div>same</div>";
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: source,
  }));
  const handle = editor.extensions.get(extension);
  const waitFor = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Timed out waiting for an HTML renderer generation.");
  };

  await waitFor(() => pending.length === 1);
  const before = handle.state.getNodes("block")[0]!;
  editor.commands.resetMarkdown(source);
  await waitFor(() => pending.length === 2);
  const after = handle.state.getNodes("block")[0]!;

  expect(after.identity).not.toBe(before.identity);
  expect(pending[0]?.signal.aborted).toBe(true);
  expect(handle.commands.togglePreview(before)).toBe(false);
  expect(handle.state.getNode(after)?.source).toBe(source);

  const stale = document.createElement("p");
  stale.textContent = "stale";
  pending[0]!.resolve(stale);
  await Promise.resolve();
  await Promise.resolve();
  expect(editor.view.dom.querySelector("[data-mdw-html-preview] p"))
    .toBeNull();

  const current = document.createElement("p");
  current.textContent = "current";
  pending[1]!.resolve(current);
  await waitFor(() => handle.state.getRenderState(after)?.status === "rendered");
  expect(editor.view.dom.querySelector("[data-mdw-html-preview] p")?.textContent)
    .toBe("current");
});

it("rejects invalid HTML nodes in every intermediate transaction document", () => {
  const errors: Array<{ code?: string; context?: { phase?: string } }> = [];
  const extension = createHtmlExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Body",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const before = editor.view.state.doc;
  const blockType = editor.view.state.schema.nodes.html_block;
  const invalid = blockType.create({
    kind: "html-block",
    source: "not HTML",
  });
  const position = before.content.size;

  editor.view.dispatch(editor.view.state.tr.insert(position, invalid));
  expect(editor.view.state.doc).toBe(before);
  expect(errors.at(-1)).toMatchObject({
    code: "EXTENSION_HTML_DOCUMENT_INVARIANT",
    context: { phase: "plugin" },
  });

  const intermediateOnly = editor.view.state.tr.insert(position, invalid);
  intermediateOnly.delete(position, position + invalid.nodeSize);
  editor.view.dispatch(intermediateOnly);
  expect(editor.view.state.doc).toBe(before);
  expect(errors).toHaveLength(2);

  const valid = blockType.create({
    kind: "html-comment",
    source: "<div>kind mismatch</div>",
  });
  editor.view.dispatch(editor.view.state.tr.insert(position, valid));
  expect(editor.view.state.doc).toBe(before);
  expect(errors).toHaveLength(3);
});

it("rejects zero-map attribute and mark steps that violate HTML invariants", () => {
  const errors: Array<{ code?: string }> = [];
  const extension = createHtmlExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "<div>valid</div>\n\nBefore <span>inside</span>.",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const handle = editor.extensions.get(extension);
  const block = handle.state.getNodes("block")[0]!;
  const inline = handle.state.getNodes("inline")[0]!;
  const before = editor.view.state.doc;

  editor.view.dispatch(editor.view.state.tr.setNodeAttribute(
    block.position,
    "source",
    "not HTML",
  ));
  expect(editor.view.state.doc).toBe(before);
  expect(errors.at(-1)?.code).toBe("EXTENSION_HTML_DOCUMENT_INVARIANT");

  const intermediateOnly = editor.view.state.tr
    .setNodeAttribute(block.position, "source", "still not HTML")
    .setNodeAttribute(block.position, "source", block.source);
  editor.view.dispatch(intermediateOnly);
  expect(editor.view.state.doc).toBe(before);
  expect(errors).toHaveLength(2);

  const code = editor.view.state.schema.marks.code.create();
  const marked = editor.view.state.tr.addMark(
    inline.position,
    inline.position + 1,
    code,
  );
  expect(marked.doc.nodeAt(inline.position)?.marks).toContainEqual(code);
  const types = {
    block: editor.view.state.schema.nodes.html_block,
    code: editor.view.state.schema.marks.code,
    inline: editor.view.state.schema.nodes.html_inline,
  };
  expect(isHtmlDocumentValid(marked.doc, types)).toBe(false);
  expect(isHtmlTransactionAllowed(marked, types)).toBe(false);
  editor.view.dispatch(marked);
  expect(editor.view.state.doc).toBe(before);
  expect(errors).toHaveLength(3);
});

it("renders authored HTML only as text and copies only the inert source shell", () => {
  const script = [
    "<script>",
    "globalThis.__markoraHtmlExecuted = true",
    "</script>",
  ].join("\n");
  const inline = '<img src="/must-not-load.png" onerror="globalThis.__markoraHtmlExecuted = true">';
  const extension = createHtmlExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: `${script}\n\nBefore ${inline} after.`,
  }));
  const handle = editor.extensions.get(extension);

  expect((globalThis as typeof globalThis & { __markoraHtmlExecuted?: boolean })
    .__markoraHtmlExecuted).toBeUndefined();
  expect(editor.view.dom.querySelector("script, img, iframe, object, embed"))
    .toBeNull();
  expect(editor.view.dom.querySelector('[data-mdw-html-display="block"] [data-mdw-html-source]')
    ?.textContent).toBe(script);
  expect(editor.view.dom.querySelector('[data-mdw-html-display="inline"] [data-mdw-html-source]')
    ?.textContent).toBe(inline);
  expect(editor.getMarkdown()).toBe(`${script}\n\nBefore ${inline} after.`);

  for (const target of handle.state.getNodes()) {
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(
      editor.view.state.doc,
      target.position,
    )));
    const copied = editor.view.serializeForClipboard(
      editor.view.state.selection.content(),
    );
    const shell = copied.dom.querySelector<HTMLElement>(
      `[data-mdw-html][data-mdw-html-display="${target.display}"]`,
    );

    expect(copied.text).toBe(target.source);
    expect(shell).not.toBeNull();
    expect(shell?.querySelector("[data-mdw-html-source]")?.textContent)
      .toBe(target.source);
    expect(copied.dom.querySelector(
      "script, img, iframe, object, embed, button, [data-mdw-html-preview]",
    )).toBeNull();
  }
});
