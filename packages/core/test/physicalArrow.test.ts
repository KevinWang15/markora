import { expect, it, vi } from "vitest";
import type { EditorView } from "prosemirror-view";
import { createEditor } from "../src/createEditor";
import { probeVisualRangeMotion } from "../src/physicalArrow";

it.each(["left", "right"] as const)("recognizes a wrapped table's native %s exit and restores the caret", direction => {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = createEditor({ element, markdown: "| A | B |\n| --- | --- |\n| one | two |" });
  try {
    const view = editor.view as EditorView & {
      domSelection(): Selection;
      domSelectionRange(): Pick<Selection, "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset">;
    };
    const table = element.querySelector("table")!;
    table.style.direction = "rtl";
    const paragraph = table.querySelector("p")!;
    const original = {
      anchorNode: paragraph.firstChild!, anchorOffset: 0,
      focusNode: paragraph.firstChild!, focusOffset: 0,
    };
    let target: Node = table;
    const selection = {
      ...original,
      caretBidiLevel: 0,
      modify() {
        selection.focusNode = target;
        selection.focusOffset = 0;
        selection.caretBidiLevel = 1;
      },
      collapse(node: Node, offset: number) {
        selection.anchorNode = selection.focusNode = node;
        selection.anchorOffset = selection.focusOffset = offset;
      },
    };
    vi.spyOn(view, "domSelection").mockReturnValue(selection as unknown as Selection);
    vi.spyOn(view, "domSelectionRange").mockImplementation(() => selection);
    const end = view.state.doc.firstChild!.nodeSize;
    expect(probeVisualRangeMotion(view, direction, 0, end)).toBe(direction === "left" ? "after" : "before");
    expect(selection).toMatchObject({ ...original, caretBidiLevel: 0 });

    for (const content of [table.tBodies[0]!, paragraph]) {
      target = content;
      expect(probeVisualRangeMotion(view, direction, 0, end)).toBe("inside");
      expect(selection).toMatchObject({ ...original, caretBidiLevel: 0 });
    }
  } finally {
    vi.restoreAllMocks();
    editor.destroy();
    element.remove();
  }
});
