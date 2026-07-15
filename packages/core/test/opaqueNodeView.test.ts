import { afterEach, describe, expect, it } from "vitest";
import { history, undo } from "prosemirror-history";
import { Schema, type Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  createOpaqueNodeViewClass,
  type OpaqueMarkdownEditRequest,
  type OpaqueMarkdownKind,
} from "../src/opaqueNodeView";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0] as const;
      },
    },
    raw_block: {
      atom: true,
      attrs: {
        kind: { default: "unknown-fence" },
        source: { default: "" },
      },
      group: "block",
      isolating: true,
      selectable: true,
      toDOM(node: ProseMirrorNode) {
        return ["div", { "data-raw-block": node.attrs.kind }, node.attrs.source] as const;
      },
    },
    raw_inline: {
      atom: true,
      attrs: {
        kind: { default: "inline-html" },
        source: { default: "" },
      },
      group: "inline",
      inline: true,
      selectable: true,
      toDOM(node: ProseMirrorNode) {
        return ["span", { "data-raw-inline": node.attrs.kind }, node.attrs.source] as const;
      },
    },
    text: { group: "inline" },
  },
});

const editors: EditorView[] = [];

type CreateTestEditorOptions = {
  display?: "block" | "inline";
  kind?: OpaqueMarkdownKind;
  onEdit?: (request: OpaqueMarkdownEditRequest) => void;
  source: string;
};

function createTestEditor(options: CreateTestEditorOptions) {
  const display = options.display ?? "block";
  const nodeType = display === "block" ? schema.nodes.raw_block : schema.nodes.raw_inline;
  const OpaqueNodeView = createOpaqueNodeViewClass({
    display,
    nodeType,
    onEdit: options.onEdit,
  });
  const opaqueNode = nodeType.create({
    kind: options.kind ?? (display === "block" ? "html-block" : "inline-html"),
    source: options.source,
  });
  const doc = display === "block"
    ? schema.nodes.doc.create(null, [opaqueNode, schema.nodes.paragraph.create(null, schema.text("after"))])
    : schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [schema.text("before "), opaqueNode, schema.text(" after")]),
      ]);
  const host = document.createElement("div");
  document.body.append(host);

  const editor = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [history()] }),
    nodeViews: {
      [nodeType.name](node, view, getPos) {
        return new OpaqueNodeView(node, view, getPos);
      },
    },
  });
  editors.push(editor);
  return editor;
}

function findNode(view: EditorView, nodeName: "raw_block" | "raw_inline") {
  let result: { node: ProseMirrorNode; pos: number } | null = null;

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === nodeName) {
      result = { node, pos };
      return false;
    }

    return undefined;
  });

  if (!result) {
    throw new Error(`${nodeName} not found`);
  }

  return result;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("opaque Markdown node view", () => {
  it("renders hostile HTML as text without creating executable elements", () => {
    const source = '</code><script>window.__opaqueExecuted = true</script><img src=x onerror="alert(1)">';
    const editor = createTestEditor({ source });
    const opaqueDom = editor.dom.querySelector<HTMLElement>(".mdw-opaque-block");
    const sourceDom = opaqueDom?.querySelector("code");

    expect(opaqueDom).not.toBeNull();
    expect(sourceDom?.textContent).toBe(source);
    expect(opaqueDom?.querySelector("script")).toBeNull();
    expect(opaqueDom?.querySelector("img")).toBeNull();
    expect(opaqueDom?.getAttribute("aria-label")).toBe("HTML block Markdown source");
    expect(opaqueDom?.getAttribute("aria-label")).not.toContain(source);
    expect(opaqueDom?.querySelector("button")).toBeNull();
  });

  it("exposes an accessible real button and applies a hook update as an undoable transaction", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      kind: "frontmatter",
      source: "---\ntitle: Before\n---",
      onEdit(nextRequest) {
        request = nextRequest;
      },
    });
    const button = editor.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit");

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe("Edit source");
    expect(button?.getAttribute("aria-label")).toBe("Edit Front matter Markdown source");

    button?.click();

    if (!request) {
      throw new Error("Expected the edit hook to receive a request");
    }

    expect(request.kind).toBe("frontmatter");
    expect(request.source).toBe("---\ntitle: Before\n---");
    expect(request.update("---\ntitle: After\n---")).toBe(true);
    expect(findNode(editor, "raw_block").node.attrs.source).toBe("---\ntitle: After\n---");

    expect(undo(editor.state, editor.dispatch)).toBe(true);
    expect(findNode(editor, "raw_block").node.attrs.source).toBe("---\ntitle: Before\n---");
  });

  it("rejects an async edit request after its node is removed", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      source: "<!-- keep me -->",
      kind: "html-comment",
      onEdit(nextRequest) {
        request = nextRequest;
      },
    });

    editor.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")?.click();

    if (!request) {
      throw new Error("Expected the edit hook to receive a request");
    }

    const rawBlock = findNode(editor, "raw_block");
    editor.dispatch(editor.state.tr.delete(rawBlock.pos, rawBlock.pos + rawBlock.node.nodeSize));

    expect(request.update("<!-- too late -->")).toBe(false);
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("rejects an older request after a newer source update", () => {
    const requests: OpaqueMarkdownEditRequest[] = [];
    const editor = createTestEditor({
      source: "$$\nx\n$$",
      kind: "display-math",
      onEdit(request) {
        requests.push(request);
      },
    });
    const button = editor.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")!;

    button.click();
    button.click();

    expect(requests).toHaveLength(2);
    expect(requests[1].update("$$\ny\n$$")).toBe(true);
    expect(requests[0].update("$$\nstale\n$$")).toBe(false);
    expect(findNode(editor, "raw_block").node.attrs.source).toBe("$$\ny\n$$");
  });

  it("uses the live node position after surrounding content moves it", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const editor = createTestEditor({
      source: ":::note\nKeep this\n:::",
      kind: "directive-container",
      onEdit(nextRequest) {
        request = nextRequest;
      },
    });

    editor.dom.querySelector<HTMLButtonElement>(".mdw-opaque-edit")?.click();

    if (!request) {
      throw new Error("Expected the edit hook to receive a request");
    }

    const paragraph = schema.nodes.paragraph.create(null, schema.text("inserted before"));
    editor.dispatch(editor.state.tr.insert(0, paragraph));

    expect(request.update(":::note\nUpdated\n:::")).toBe(true);
    expect(findNode(editor, "raw_block").node.attrs.source).toBe(":::note\nUpdated\n:::");
  });

  it("renders inline opaque source in a safe span and invokes the same edit hook", () => {
    let request: OpaqueMarkdownEditRequest | null = null;
    const source = '<span onclick="alert(1)">';
    const editor = createTestEditor({
      display: "inline",
      source,
      onEdit(nextRequest) {
        request = nextRequest;
      },
    });
    const opaqueDom = editor.dom.querySelector<HTMLElement>("span.mdw-opaque-inline");

    expect(opaqueDom?.querySelector("code")?.textContent).toBe(source);
    expect(opaqueDom?.querySelector("span[onclick]")).toBeNull();

    opaqueDom?.querySelector<HTMLButtonElement>("button")?.click();

    if (!request) {
      throw new Error("Expected the inline edit hook to receive a request");
    }

    expect(request.kind).toBe("inline-html");
    expect(request.update("<mark>")).toBe(true);
    expect(findNode(editor, "raw_inline").node.attrs.source).toBe("<mark>");
  });
});
