import { afterEach, describe, expect, it } from "vitest";
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Node as ProseMirrorNode,
  Slice,
} from "prosemirror-model";
import { AllSelection, NodeSelection } from "prosemirror-state";
import { createEditor } from "../src/createEditor";
import type { OpaqueMarkdownEditRequest } from "../src";
import { ManagedBlockCursor, isManagedBlockNodeFromSchema } from "../src/managedBlockCursor";

const editors: Array<ReturnType<typeof createEditor>> = [];

function installDomStubs(targetWindow: Window & typeof globalThis = window) {
  const RangeCtor = targetWindow.Range;

  if (RangeCtor && !RangeCtor.prototype.getClientRects) {
    RangeCtor.prototype.getClientRects = (() => [] as unknown as DOMRectList);
  }

  if (RangeCtor && !RangeCtor.prototype.getBoundingClientRect) {
    RangeCtor.prototype.getBoundingClientRect = (() => new targetWindow.DOMRect()) as () => DOMRect;
  }

  const ElementCtor = targetWindow.Element;

  if (ElementCtor && !ElementCtor.prototype.animate) {
    ElementCtor.prototype.animate = (() => ({
      cancel() {},
      finished: Promise.resolve(),
    })) as typeof Element.prototype.animate;
  }

  if (typeof targetWindow.requestAnimationFrame !== "function") {
    targetWindow.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      targetWindow.setTimeout(() => callback(Date.now()), 16)) as typeof requestAnimationFrame;
  }

  if (typeof targetWindow.cancelAnimationFrame !== "function") {
    targetWindow.cancelAnimationFrame = ((frameId: number) => {
      targetWindow.clearTimeout(frameId);
    }) as typeof cancelAnimationFrame;
  }
}

installDomStubs();

function createHost() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function createTestEditor(options: Omit<Parameters<typeof createEditor>[0], "element">) {
  const editor = createEditor({
    ...options,
    element: createHost(),
  });
  editors.push(editor);
  return editor;
}

function findNodes(editor: ReturnType<typeof createEditor>, nodeName: "raw_block" | "raw_inline") {
  const matches: Array<{ node: ProseMirrorNode; pos: number }> = [];

  editor.view.state.doc.descendants((node, pos) => {
    if (node.type.name === nodeName) {
      matches.push({ node, pos });
      return false;
    }

    return undefined;
  });

  return matches;
}

function findSingleNode(editor: ReturnType<typeof createEditor>, nodeName: "raw_block" | "raw_inline") {
  const matches = findNodes(editor, nodeName);

  if (matches.length !== 1) {
    throw new Error("Expected one " + nodeName + ", found " + matches.length + ".");
  }

  return matches[0];
}

function findText(editor: ReturnType<typeof createEditor>, value: string) {
  let match: { node: ProseMirrorNode; pos: number } | null = null;

  editor.view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === value) {
      match = { node, pos };
      return false;
    }

    return undefined;
  });

  if (!match) {
    throw new Error("Text " + JSON.stringify(value) + " not found.");
  }

  return match;
}

function transformPastedSlice(editor: ReturnType<typeof createEditor>, slice: Slice) {
  let transformed = slice;

  editor.view.someProp("transformPasted", (handler) => {
    transformed = handler(transformed, editor.view, false);
    return undefined;
  });

  return transformed;
}

function pressKey(editor: ReturnType<typeof createEditor>, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

  return editor.view.someProp("handleKeyDown", (handler) => (
    handler(editor.view, event) ? true : undefined
  )) === true;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("opaque Markdown editor operations", () => {
  it("retains exact raw block source while surrounding supported text is edited", () => {
    const source = "<!-- first\r\nsecond **literal** -->";
    const editor = createTestEditor({
      markdown: "Before\n\n" + source + "\n\nAfter",
    });
    const before = findText(editor, "Before");

    editor.view.dispatch(
      editor.view.state.tr.insertText("!", before.pos + before.node.nodeSize),
    );

    expect(findSingleNode(editor, "raw_block").node.attrs).toMatchObject({
      kind: "html-comment",
      source,
    });
    expect(editor.getMarkdown()).toBe("Before!\n\n" + source + "\n\nAfter");
  });

  it("moves a raw block without changing its kind or source", () => {
    const source = "$$\nx + y\n$$";
    const editor = createTestEditor({
      markdown: "Alpha\n\n" + source + "\n\nOmega",
    });
    const rawBlock = findSingleNode(editor, "raw_block");
    let transaction = editor.view.state.tr.delete(
      rawBlock.pos,
      rawBlock.pos + rawBlock.node.nodeSize,
    );

    transaction = transaction.insert(transaction.doc.content.size, rawBlock.node);
    editor.view.dispatch(transaction);

    const moved = findSingleNode(editor, "raw_block");
    expect(moved.node.attrs).toMatchObject({ kind: "display-math", source });
    expect(moved.pos).toBeGreaterThan(findText(editor, "Omega").pos);
    expect(editor.getMarkdown()).toBe("Alpha\n\nOmega\n\n" + source);
  });

  it("copies a raw block as a model slice without changing its exact source", () => {
    const source = ":::note\nKeep [this] literal\n:::";
    const editor = createTestEditor({
      markdown: "Alpha\n\n" + source + "\n\nOmega",
    });
    const rawBlock = findSingleNode(editor, "raw_block");
    const copiedSlice = editor.view.state.doc.slice(
      rawBlock.pos,
      rawBlock.pos + rawBlock.node.nodeSize,
    );

    editor.view.dispatch(
      editor.view.state.tr.insert(editor.view.state.doc.content.size, copiedSlice.content),
    );

    expect(findNodes(editor, "raw_block").map(({ node }) => node.attrs.source)).toEqual([
      source,
      source,
    ]);
    expect(editor.getMarkdown()).toBe("Alpha\n\n" + source + "\n\nOmega\n\n" + source);
  });

  it("deletes a raw block and restores its exact source through undo and redo", () => {
    const source = "<div data-value=\"[raw]\">\nBody\n</div>";
    const editor = createTestEditor({
      markdown: "Before\n\n" + source + "\n\nAfter",
    });
    const rawBlock = findSingleNode(editor, "raw_block");
    const isManagedBlock = (node: ProseMirrorNode | null | undefined): node is ProseMirrorNode => (
      isManagedBlockNodeFromSchema(editor.view.state.schema, node)
    );

    editor.view.dispatch(editor.view.state.tr.setSelection(
      ManagedBlockCursor.create(editor.view.state.doc, rawBlock.pos, "before", isManagedBlock)!,
    ));
    expect(pressKey(editor, "ArrowRight")).toBe(true);
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.view.state.selection.from).toBe(rawBlock.pos);

    editor.view.dispatch(editor.view.state.tr.setSelection(
      ManagedBlockCursor.create(editor.view.state.doc, rawBlock.pos, "after", isManagedBlock)!,
    ));
    expect(pressKey(editor, "Backspace")).toBe(true);

    expect(findNodes(editor, "raw_block")).toEqual([]);
    expect(editor.getMarkdown()).toBe("Before\n\nAfter");

    expect(editor.commands.undo()).toBe(true);
    expect(findSingleNode(editor, "raw_block").node.attrs.source).toBe(source);
    expect(editor.getMarkdown()).toBe("Before\n\n" + source + "\n\nAfter");

    expect(editor.commands.redo()).toBe(true);
    expect(findNodes(editor, "raw_block")).toEqual([]);
    expect(editor.getMarkdown()).toBe("Before\n\nAfter");
  });

  it("round-trips block and inline opaque source through a rich DOM slice paste", () => {
    const inlineOpen = "<span data-label=\"[a] &amp;\">";
    const inlineClose = "</span>";
    const blockSource = "<!-- first\r\nsecond **literal** -->";
    const markdown = [
      "Before " + inlineOpen + "**inside**" + inlineClose + ".",
      "",
      blockSource,
      "",
      "After",
    ].join("\n");
    const sourceEditor = createTestEditor({ markdown });
    const destinationEditor = createTestEditor({ markdown: "Replace me" });
    const serialized = DOMSerializer.fromSchema(sourceEditor.view.state.schema).serializeFragment(
      sourceEditor.view.state.doc.content,
      { document },
    );
    const container = document.createElement("div");
    container.append(serialized);

    const parsedSlice = ProseMirrorDOMParser.fromSchema(destinationEditor.view.state.schema).parseSlice(
      container,
      { preserveWhitespace: "full" },
    );
    const pastedSlice = transformPastedSlice(destinationEditor, parsedSlice);
    const transaction = destinationEditor.view.state.tr
      .setSelection(new AllSelection(destinationEditor.view.state.doc))
      .replaceSelection(pastedSlice);

    destinationEditor.view.dispatch(transaction);

    expect(findSingleNode(destinationEditor, "raw_block").node.attrs).toMatchObject({
      kind: "html-comment",
      source: blockSource,
    });
    expect(findNodes(destinationEditor, "raw_inline").map(({ node }) => node.attrs.source)).toEqual([
      inlineOpen,
      inlineClose,
    ]);
    expect(destinationEditor.getMarkdown()).toBe(markdown);
  });

  it("applies a source-editor request as an undoable change and emits canonical Markdown", () => {
    const before = "---\ntitle: Before\n---";
    const after = "---\ntitle: After\n---";
    const changes: string[] = [];
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      markdown: before + "\n\nBody",
      onChange(markdown) {
        changes.push(markdown);
      },
      onEditOpaqueMarkdown(nextRequest) {
        request = nextRequest;
      },
    });

    editor.view.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")?.click();

    if (!request) {
      throw new Error("Expected the source edit hook to receive a request.");
    }

    expect(request.kind).toBe("frontmatter");
    expect(request.source).toBe(before);
    expect(request.update(after)).toBe(true);
    expect(editor.getMarkdown()).toBe(after + "\n\nBody");
    expect(changes).toEqual([after + "\n\nBody"]);

    expect(editor.commands.undo()).toBe(true);
    expect(findSingleNode(editor, "raw_block").node.attrs.source).toBe(before);
    expect(changes).toEqual([
      after + "\n\nBody",
      before + "\n\nBody",
    ]);

    expect(editor.commands.redo()).toBe(true);
    expect(findSingleNode(editor, "raw_block").node.attrs.source).toBe(after);
    expect(changes).toEqual([
      after + "\n\nBody",
      before + "\n\nBody",
      after + "\n\nBody",
    ]);
  });

  it("rejects a stale source-edit request after setMarkdown replaces its node", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      markdown: "---\ntitle: Before\n---\n\nBody",
      onEditOpaqueMarkdown(nextRequest) {
        request = nextRequest;
      },
    });

    editor.view.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")?.click();

    if (!request) {
      throw new Error("Expected the source edit hook to receive a request.");
    }

    editor.commands.setMarkdown("Replacement");

    expect(request.update("---\ntitle: Stale\n---")).toBe(false);
    expect(editor.getMarkdown()).toBe("Replacement");
    expect(findNodes(editor, "raw_block")).toEqual([]);
  });

  it("rejects a stale source-edit request after its node is deleted", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      markdown: "$$\nx\n$$\n\nBody",
      onEditOpaqueMarkdown(nextRequest) {
        request = nextRequest;
      },
    });

    editor.view.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")?.click();

    if (!request) {
      throw new Error("Expected the source edit hook to receive a request.");
    }

    const rawBlock = findSingleNode(editor, "raw_block");
    editor.view.dispatch(
      editor.view.state.tr.delete(rawBlock.pos, rawBlock.pos + rawBlock.node.nodeSize),
    );

    expect(request.update("$$\nstale\n$$")).toBe(false);
    expect(editor.getMarkdown()).toBe("Body");
  });
});
