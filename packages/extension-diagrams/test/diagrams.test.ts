import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor as createRootEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { AllSelection, NodeSelection, TextSelection } from "markora/extension-api";
import {
  createDiagramsExtension,
  defaultDiagramMessages,
  diagramDiagnosticCodes,
  diagramKinds,
  diagramRenderErrorCodes,
  type DiagramEditRequest,
} from "../src/index";
import {
  classifyDiagramInfo,
  isDiagramDocumentValid,
  normalizeDiagramInfo,
  normalizeDiagramSource,
} from "../src/source";
import {
  createDiagramFenceTransformRule,
  diagramTokenAttrs,
} from "../src/tokenizer";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const editors: MarkdownEditor[] = [];
const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function expectCommandTypeError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({
      cause: expect.any(TypeError),
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "command",
    });
    return;
  }
  throw new Error("Expected the malformed extension command to throw.");
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.replaceChildren();
});

describe.each(entries)("%s diagram codec", (_entry, createEditor) => {
  it("claims all supported exact case-sensitive first info tokens and retains full info/body", () => {
    const markdown = [
      "~~~mermaid theme=neutral",
      "graph TD; A-->B",
      "~~~",
      "",
      "```geojson viewport=fit",
      '{"type":"Point","coordinates":[0,0]}',
      "```",
      "",
      "```topojson",
      '{"type":"Topology","objects":{}}',
      "```",
      "",
      "```plantuml",
      "@startuml\nAlice -> Bob: hello\n@enduml",
      "```",
      "",
      "```stl binary=false",
      "solid x\nendsolid x",
      "```",
    ].join("\n");
    const extension = createDiagramsExtension();
    const editor = track(createEditor({ element: host(), extensions: [extension], markdown }));
    const nodes = editor.extensions.get(extension).state.getNodes();

    expect(nodes.map(({ info, kind, source }) => ({ info, kind, source }))).toEqual([
      { info: "mermaid theme=neutral", kind: "mermaid", source: "graph TD; A-->B" },
      { info: "geojson viewport=fit", kind: "geojson", source: '{"type":"Point","coordinates":[0,0]}' },
      { info: "topojson", kind: "topojson", source: '{"type":"Topology","objects":{}}' },
      { info: "plantuml", kind: "plantuml", source: "@startuml\nAlice -> Bob: hello\n@enduml" },
      { info: "stl binary=false", kind: "stl", source: "solid x\nendsolid x" },
    ]);
    expect(editor.getMarkdown()).toContain("```mermaid theme=neutral\ngraph TD; A-->B\n```");
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-diagrams",
      version: "0.0.1",
    });
  });

  it("leaves case variants, unknown kinds, and non-first tokens as generic code", () => {
    const extension = createDiagramsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "```Mermaid\nx\n```",
        "",
        "```unknown-diagram\ny\n```",
        "",
        "```json mermaid\nz\n```",
      ].join("\n"),
    }));
    expect(editor.extensions.get(extension).state.getNodes()).toEqual([]);
    const names: string[] = [];
    editor.view.state.doc.descendants((node) => { if (node.isBlock) names.push(node.type.name); });
    expect(names.filter((name) => name === "code_block")).toHaveLength(3);
  });

  it("canonicalizes delimiter spelling and safely lengthens around body runs", () => {
    const extension = createDiagramsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "~~~~~~~~mermaid variant=`strict`",
        "~~~~",
        "~~~~~",
        "~~~~~~~~",
      ].join("\n"),
    }));
    expect(editor.getMarkdown()).toBe([
      "~~~~~~mermaid variant=`strict`",
      "~~~~",
      "~~~~~",
      "~~~~~~",
    ].join("\n"));
    const reparsedExtension = createDiagramsExtension();
    const reparsed = track(createEditor({
      element: host(),
      extensions: [reparsedExtension],
      markdown: editor.getMarkdown(),
    }));
    expect(reparsed.extensions.get(reparsedExtension).state.getNodes()[0]?.source)
      .toBe("~~~~\n~~~~~");
  });

  it("preserves empty and trailing-blank body semantics and closes unclosed fences", () => {
    const extension = createDiagramsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "```mermaid\nline\n\n",
    }));
    expect(editor.extensions.get(extension).state.getNodes()[0]?.source).toBe("line\n");
    expect(editor.getMarkdown()).toBe("```mermaid\nline\n\n```");
  });
});

it("keeps supported fences generic when the package is absent in root and minimal", () => {
  for (const createEditor of [createRootEditor, createMinimalEditor]) {
    const editor = track(createEditor({ element: host(), markdown: "~~~mermaid\ngraph TD\n~~~" }));
    expect(editor.view.state.doc.firstChild?.type.name).toBe("code_block");
    expect(editor.getMarkdown()).toBe("```mermaid\ngraph TD\n```");
  }
});

it.each(entries)("%s copies a whole diagram as a canonical plain fence and a body selection as text", (_entry, createEditor) => {
  const extension = createDiagramsExtension();
  const editor = track(createEditor({
    element: host(),
    extensions: [extension],
    markdown: "```mermaid theme=copy\ngraph TD; A-->B\n```",
  }));
  const whole = NodeSelection.create(editor.view.state.doc, 0);
  const expected = "```mermaid theme=copy\ngraph TD; A-->B\n```";

  expect(editor.view.serializeForClipboard(whole.content()).text).toBe(expected);

  const partial = TextSelection.create(editor.view.state.doc, 1, 6);
  expect(editor.view.serializeForClipboard(partial.content()).text).toBe("graph");
});

it.each(entries)("%s reveals source for editing while keeping outer document selections stable", async (_entry, createEditor) => {
  const extension = createDiagramsExtension({
    renderers: {
      mermaid: ({ ownerDocument }) => ownerDocument.createElement("div"),
    },
  });
  const editor = track(createEditor({
    element: host(),
    extensions: [extension],
    markdown: "Before\n\n```mermaid\ngraph TD\n```\n\nAfter",
  }));
  const node = editor.extensions.get(extension).state.getNodes()[0]!;
  const sourceShell = editor.view.dom.querySelector<HTMLElement>(
    ".mdw-diagram__source-shell",
  )!;
  const source = sourceShell.querySelector<HTMLElement>(
    ".mdw-diagram__source",
  )!;
  expect(source.dir).toBe("auto");
  await vi.waitFor(() => {
    expect(editor.extensions.get(extension).state.getNode(node)?.render.status)
      .toBe("rendered");
  });
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(true);

  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, node.position + 1),
  ));
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(false);

  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, 1),
  ));
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(true);

  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, 1, editor.view.state.doc.content.size - 1),
  ));
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(true);

  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, 1, node.position + 2),
  ));
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(true);
  editor.view.dispatch(editor.view.state.tr.setSelection(
    TextSelection.create(editor.view.state.doc, node.position + 2, 1),
  ));
  expect(sourceShell.classList.contains("mdw-diagram__source-shell--visually-hidden"))
    .toBe(false);
});

it("normalizes source, validates complete info, and publishes frozen vocabulary", () => {
  expect(normalizeDiagramSource("a\r\nb\rc\0d")).toBe("a\nb\nc\uFFFDd");
  expect(normalizeDiagramInfo("  mermaid  theme=dark  ")).toBe("mermaid  theme=dark");
  expect(classifyDiagramInfo("mermaid  theme=dark")).toBe("mermaid");
  expect(classifyDiagramInfo("Mermaid")).toBeNull();
  expect(() => normalizeDiagramInfo("mermaid\nother")).toThrow();
  expect(Object.isFrozen(defaultDiagramMessages)).toBe(true);
  expect(diagramKinds).toEqual(["mermaid", "plantuml", "geojson", "topojson", "stl"]);
  expect(diagramDiagnosticCodes).toEqual(["source-too-large"]);
  expect(diagramRenderErrorCodes).toContain("unsafe-output");
});

it("supports insertion, stale-safe update/kind conversion, removal, and one-step undo", () => {
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({ element: host(), extensions: [extension], markdown: "before" }));
  const handle = editor.extensions.get(extension);

  expect(handle.commands.insert({ info: "mermaid theme=neutral", source: "graph TD" })).toBe(true);
  let node = handle.state.getNodes()[0]!;
  expect(handle.commands.update(node, { source: "graph LR" })).toBe(true);
  expect(handle.commands.update(node, { source: "stale" })).toBe(false);
  node = handle.state.getNodes()[0]!;
  expect(handle.commands.convert(node, "geojson")).toBe(true);
  node = handle.state.getNodes()[0]!;
  expect(node.info).toBe("geojson theme=neutral");
  expect(node.kind).toBe("geojson");
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getNodes()[0]?.kind).toBe("mermaid");
  node = handle.state.getNodes()[0]!;
  expect(handle.commands.remove(node)).toBe(true);
  expect(handle.state.getNodes()).toEqual([]);
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getNodes()).toHaveLength(1);
});

it("converts the selected generic code block and restores it without moving its text selection", () => {
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```javascript strict=true\nconst value = 1\n```",
  }));
  const handle = editor.extensions.get(extension);
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 7)));
  const before = editor.view.state.selection.from;

  expect(handle.commands.convertCodeBlock("mermaid")).toBe(true);
  expect(editor.view.state.selection.from).toBe(before);
  let node = handle.state.getNodes()[0]!;
  expect(node.info).toBe("mermaid strict=true");
  expect(node.source).toBe("const value = 1");
  expect(handle.commands.restoreCodeBlock(node)).toBe(true);
  expect(editor.view.state.selection.from).toBe(before);
  expect(editor.view.state.doc.firstChild?.type.name).toBe("code_block");
  expect(editor.view.state.doc.firstChild?.attrs.params).toBe("mermaid strict=true");
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getNodes()).toHaveLength(1);
});

it("does not convert only the first code block in a multi-block selection", () => {
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```javascript\nconst value = 1\n```\n\nAfter",
  }));
  const before = editor.getMarkdown();

  editor.view.dispatch(editor.view.state.tr.setSelection(
    new AllSelection(editor.view.state.doc),
  ));

  expect(editor.extensions.get(extension).commands.convertCodeBlock("mermaid"))
    .toBe(false);
  expect(editor.getMarkdown()).toBe(before);
  expect(editor.extensions.get(extension).state.getNodes()).toEqual([]);
});

it("guards commands in read-only and composition modes and rejects no-ops", () => {
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```mermaid\ngraph TD\n```",
  }));
  const handle = editor.extensions.get(extension);
  const node = handle.state.getNodes()[0]!;
  expect(handle.commands.convert(node, "mermaid")).toBe(false);
  expect(handle.commands.update(node, { source: node.source })).toBe(false);
  editor.updateOptions({ editable: false });
  expect(handle.commands.remove(node)).toBe(false);
  expect(handle.commands.togglePreview(node)).toBe(false);
});

it("reports semantic-invalid info without mutation and throws for malformed command inputs", () => {
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```mermaid\ngraph TD\n```",
  }));
  const handle = editor.extensions.get(extension);
  const before = editor.getMarkdown();
  const beforeSelection = editor.view.state.selection;
  const errors: string[] = [];
  let transactions = 0;
  editor.subscribe("error", (event) => errors.push(event.error.code));
  editor.subscribe("transaction", () => { transactions += 1; });

  expect(handle.commands.insert({ info: "unknown-diagram", source: "A-->B" }))
    .toBe(false);
  expect(handle.commands.update(handle.state.getNodes()[0]!, { info: "mermaid\ninvalid" }))
    .toBe(false);
  expect(errors).toEqual([
    "EXTENSION_DIAGRAM_INVALID_INFO",
    "EXTENSION_DIAGRAM_INVALID_INFO",
  ]);
  expect(editor.getMarkdown()).toBe(before);
  expect(editor.view.state.selection.eq(beforeSelection)).toBe(true);
  expect(transactions).toBe(0);

  expectCommandTypeError(() => handle.commands.insert({ info: 42, source: "x" } as never));
  expectCommandTypeError(() => handle.commands.insert({ info: "unknown-diagram", source: 42 } as never));
  expectCommandTypeError(() => handle.commands.insert({
    info: "mermaid",
    source: "x",
    unknown: true,
  } as never));
  expectCommandTypeError(() => handle.commands.update(
    handle.state.getNodes()[0]!,
    null as never,
  ));
  expectCommandTypeError(() => handle.commands.update(
    handle.state.getNodes()[0]!,
    { info: 42 } as never,
  ));
  expectCommandTypeError(() => handle.commands.update(
    handle.state.getNodes()[0]!,
    { info: "unknown-diagram", source: 42 } as never,
  ));
  expect(editor.getMarkdown()).toBe(before);
  expect(transactions).toBe(0);
});

it("rejects raw invalid diagram attrs while retaining the last valid document", () => {
  const errors: string[] = [];
  const extension = createDiagramsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```mermaid\ngraph TD\n```",
  }));
  editor.subscribe("error", (event) => errors.push(event.error.code));
  const node = editor.extensions.get(extension).state.getNodes()[0]!;
  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(node.position, undefined, {
    info: "Mermaid",
    kind: "mermaid",
  }));
  expect(editor.extensions.get(extension).state.getNodes()[0]?.info).toBe("mermaid");
  expect(errors).toContain("EXTENSION_DIAGRAM_INVALID_DOCUMENT");
  expect(isDiagramDocumentValid(editor.view.state.doc, editor.view.state.schema.nodes.diagram)).toBe(true);
});

it("hands off one current source edit request and invalidates it after a change", () => {
  let request: DiagramEditRequest | null = null;
  const extension = createDiagramsExtension({ onEditSource: (value) => { request = value; } });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "```mermaid\ngraph TD\n```",
  }));
  const button = host().ownerDocument.querySelector<HTMLButtonElement>(".mdw-diagram__action");
  button?.click();
  expect(request?.source).toBe("graph TD");
  expect(request?.update({ source: "graph LR" })).toBe(true);
  expect(request?.remove()).toBe(false);
});

it("validates options and message overrides without invoking accessors", () => {
  expect(() => createDiagramsExtension({ unknown: true } as never)).toThrow(/Unknown diagram extension option/);
  expect(() => createDiagramsExtension({ renderers: { mermaid: "bad" } as never })).toThrow(/must be a function/);
  expect(() => createDiagramsExtension({ messages: { showPreview: " " } })).toThrow(/non-empty/);
  let invoked = false;
  const renderers = {} as Record<string, unknown>;
  Object.defineProperty(renderers, "mermaid", { enumerable: true, get() { invoked = true; return () => document.createElement("div"); } });
  expect(() => createDiagramsExtension({ renderers: renderers as never })).toThrow(/data property/);
  expect(invoked).toBe(false);
});

it("claims through hostile token metadata without invoking accessors or proxies", () => {
  let getterCalls = 0;
  const accessorToken = {
    info: "mermaid theme=neutral",
    tag: "code",
    type: "fence",
  } as Record<string, unknown>;
  Object.defineProperty(accessorToken, "meta", {
    configurable: false,
    get() {
      getterCalls += 1;
      throw new Error("must not run");
    },
  });
  const proxyToken = {
    info: "geojson",
    meta: new Proxy({}, { ownKeys() { throw new Error("must not enumerate"); } }),
    tag: "code",
    type: "fence",
  };
  const infoAccessor = { tag: "code", type: "fence" } as Record<string, unknown>;
  Object.defineProperty(infoAccessor, "info", {
    configurable: true,
    get() {
      getterCalls += 1;
      return "stl";
    },
  });
  const rule = createDiagramFenceTransformRule("qualified-diagram");

  expect(() => rule({ tokens: [accessorToken, proxyToken, infoAccessor] } as never)).not.toThrow();
  expect(getterCalls).toBe(0);
  expect(accessorToken.type).toBe("qualified-diagram");
  expect(proxyToken.type).toBe("qualified-diagram");
  expect(infoAccessor.type).toBe("fence");
  expect(diagramTokenAttrs(accessorToken as never)).toEqual({
    info: "mermaid theme=neutral",
    kind: "mermaid",
  });
  expect(diagramTokenAttrs(proxyToken as never)).toEqual({ info: "geojson", kind: "geojson" });
});
