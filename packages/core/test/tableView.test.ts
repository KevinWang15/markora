import { expect, it } from "vitest";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import { createEditor } from "../src/createEditor";

it("preserves the table scroll surface across edits without leaking UI into serialized HTML", () => {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = createEditor({ element, markdown: "| A | B |\n| --- | --- |\n| one | two |" });
  try {
    const scroller = element.querySelector<HTMLElement>(".mdw-table-scroll")!;
    const table = scroller.querySelector("table")!;
    scroller.scrollLeft = 40;
    editor.commands.reconcileMarkdown("| A | B | C |\n| --- | --- | --- |\n| one | two | three |");
    expect(element.querySelector(".mdw-table-scroll")).toBe(scroller);
    expect(scroller.querySelector("table")).toBe(table);
    expect(scroller.scrollLeft).toBe(40);
    expect(table.style.getPropertyValue("--_mdw-table-columns")).toBe("3");
    expect(DOMParser.fromSchema(editor.view.state.schema).parse(scroller).eq(editor.view.state.doc)).toBe(true);
    const serialized = document.createElement("div");
    serialized.append(DOMSerializer.fromSchema(editor.view.state.schema).serializeFragment(editor.view.state.doc.content));
    expect(serialized.firstElementChild?.tagName).toBe("TABLE");
    expect(serialized.querySelector(".mdw-table-scroll, [style]")).toBeNull();
    expect(serialized.textContent).toBe("ABConetwothree");
  } finally {
    editor.destroy();
    element.remove();
  }
});
