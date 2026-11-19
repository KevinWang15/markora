import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createEditor, type MarkdownEditor } from "../src";
import { forEachChangedNode } from "../src/changedNodes";

const editors: MarkdownEditor[] = [];

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()!.destroy();
  }
  document.body.innerHTML = "";
});

describe("forEachChangedNode", () => {
  it("visits only modified subtrees and skips unchanged siblings", () => {
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}`).join("\n\n");
    const editor = track(createEditor({ element: createHost(), markdown: paragraphs }));
    const oldDoc = editor.view.state.doc;

    const targetPos = oldDoc.content.size - 2;
    const tr = editor.view.state.tr.insertText(" edited", targetPos);
    const newDoc = tr.doc;

    const visitedTypes: string[] = [];
    forEachChangedNode(oldDoc, newDoc, (node) => {
      visitedTypes.push(node.type.name);
      return true;
    });

    expect(visitedTypes).toEqual(["paragraph", "text"]);
  });

  it("visits nothing when the document reference is unchanged", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "Alpha\n\nBeta" }));
    const doc = editor.view.state.doc;
    let count = 0;
    forEachChangedNode(doc, doc, () => {
      count += 1;
    });
    expect(count).toBe(0);
  });

  it("descends into newly inserted blocks and respects false pruning", () => {
    const editor = track(createEditor({ element: createHost(), markdown: "First\n\nSecond" }));
    const oldDoc = editor.view.state.doc;
    const tr = editor.view.state.tr.split(4);
    const newDoc = tr.doc;

    const pruned: Array<{ pos: number; text: string }> = [];
    forEachChangedNode(oldDoc, newDoc, (node, pos) => {
      pruned.push({ pos, text: node.textContent });
      return false;
    });

    expect(pruned.map((entry) => entry.text)).toEqual(["Fir", "st"]);
    for (const entry of pruned) {
      expect(newDoc.nodeAt(entry.pos)?.textContent).toBe(entry.text);
    }
  });
});

describe("incremental standalone image and code-block selection decorations", () => {
  it("maintains mdw-image-standalone incrementally across edits", () => {
    const markdown = [
      "Intro paragraph",
      "",
      "![Chart](https://example.com/chart.png)",
      "",
      "Trailing paragraph",
    ].join("\n");
    const editor = track(createEditor({ element: createHost(), markdown }));
    const imageEl = () => editor.view.dom.querySelector(".mdw-image");

    expect(imageEl()?.classList.contains("mdw-image-standalone")).toBe(true);

    // Edit an unrelated paragraph: standalone image class must remain intact.
    editor.view.dispatch(editor.view.state.tr.insertText(" updated", 16));
    expect(imageEl()?.classList.contains("mdw-image-standalone")).toBe(true);

    // Type text next to the image: no longer standalone.
    let imageEndPos = -1;
    editor.view.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") {
        imageEndPos = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    expect(imageEndPos).toBeGreaterThan(0);
    editor.view.dispatch(editor.view.state.tr.insertText(" caption", imageEndPos));
    expect(imageEl()?.classList.contains("mdw-image-standalone")).toBe(false);

    // Delete the trailing text: standalone class must return.
    editor.view.dispatch(editor.view.state.tr.delete(imageEndPos, imageEndPos + " caption".length));
    expect(imageEl()?.classList.contains("mdw-image-standalone")).toBe(true);
  });

  it("decorates only code blocks overlapped by an outer range selection", () => {
    const markdown = [
      "Before",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "Middle",
      "",
      "```ts",
      "const b = 2;",
      "```",
    ].join("\n");
    const editor = track(createEditor({ element: createHost(), markdown }));

    // Select strictly inside first code block: no outer selection class.
    let firstCodePos = -1;
    let firstCodeSize = 0;
    editor.view.state.doc.descendants((node, pos) => {
      if (node.type.name === "code_block" && firstCodePos < 0) {
        firstCodePos = pos;
        firstCodeSize = node.nodeSize;
        return false;
      }
      return true;
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, firstCodePos + 1, firstCodePos + 6),
      ),
    );
    expect(editor.view.dom.querySelectorAll(".mdw-code-block-outer-selection")).toHaveLength(0);

    // Select from "Before" across the first code block into "Middle": only first code block gets outer selection.
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, 2, firstCodePos + firstCodeSize + 3),
      ),
    );
    expect(editor.view.dom.querySelectorAll(".mdw-code-block-outer-selection")).toHaveLength(1);
  });

  it("reuses reveal marker DOM nodes across keystrokes inside headings and marks", () => {
    const editor = track(createEditor({
      element: createHost(),
      markdown: "## Heading\n\nParagraph with **bold** text",
    }));

    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 4)),
    );
    const headingMarkerBefore = editor.view.dom.querySelector(".mdw-marker-heading");
    expect(headingMarkerBefore?.textContent).toBe("## ");

    editor.view.dispatch(editor.view.state.tr.insertText("x", 4));
    expect(editor.view.dom.querySelector(".mdw-marker-heading")).toBe(headingMarkerBefore);

    let boldStartPos = -1;
    editor.view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "strong")) {
        boldStartPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(boldStartPos).toBeGreaterThan(0);
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, boldStartPos)),
    );
    const boldStartMarkerBefore = editor.view.dom.querySelector(".mdw-marker-strong-start");
    expect(boldStartMarkerBefore?.textContent).toBe("**");

    editor.view.dispatch(editor.view.state.tr.insertText("y", boldStartPos));
    expect(editor.view.dom.querySelector(".mdw-marker-strong-start")).toBe(boldStartMarkerBefore);
  });
});
