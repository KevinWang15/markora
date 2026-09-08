import { expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { createMarkdownCodec } from "../src/markdownCodec";
import { createFenceInputTransaction } from "../src/fenceInput";

const codec = createMarkdownCodec();
function paragraph(text: string) {
  const doc = codec.schema.nodes.doc.create(null, codec.schema.nodes.paragraph.create(null, codec.schema.text(text)));
  return EditorState.create({ doc, selection: TextSelection.create(doc, 1 + text.length) });
}

it.each([
  ["```", ""], ["```typescript", "typescript"], ["```c++", "c++"],
  ["```c#", "c#"], ["~~~~python", "python"], ["  ```mermaid theme=neutral  ", "mermaid theme=neutral"],
])("uses the Markdown dialect for %s", (fence, info) => {
  const transaction = createFenceInputTransaction(paragraph(fence), fence, codec)!;
  expect(transaction.doc.firstChild?.type.name).toBe("code_block");
  expect(transaction.doc.firstChild?.attrs.params).toBe(info);
  expect(transaction.doc.firstChild?.textContent).toBe("");
  expect(transaction.selection.from).toBe(1);
});

it.each(["``mermaid", "text ```mermaid", "```mer`maid", "```mermaid\ntext", "    ```js"])(
  "does not consume an invalid opening fence %s", fence => {
    expect(createFenceInputTransaction(paragraph(fence), fence, codec)).toBeNull();
  },
);

it("preserves selected text and mid-line carets while converting nested list fences", () => {
  const fence = "```mermaid";
  const state = paragraph(fence);
  for (const selection of [TextSelection.create(state.doc, 2), TextSelection.create(state.doc, 1, 4)]) {
    expect(createFenceInputTransaction(state.apply(state.tr.setSelection(selection)), fence, codec)).toBeNull();
  }
  const { nodes } = codec.schema;
  const doc = nodes.doc.create(null, nodes.bullet_list.create(null, nodes.list_item.create(null, state.doc.firstChild)));
  const nested = EditorState.create({ doc, selection: TextSelection.create(doc, 3 + fence.length) });
  const result = createFenceInputTransaction(nested, fence, codec)!;
  expect(result.doc.firstChild?.firstChild?.firstChild?.type.name).toBe("code_block");
  expect(nested.doc.textContent).toBe(fence);
});

it("replaces only the active paragraph inside a quote", () => {
  const fence = "~~~js";
  const { nodes } = codec.schema;
  const doc = nodes.doc.create(null, [nodes.paragraph.create(null, codec.schema.text("Before")),
    nodes.blockquote.create(null, paragraph(fence).doc.firstChild), nodes.paragraph.create(null, codec.schema.text("After"))]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 10 + fence.length) });
  const result = createFenceInputTransaction(state, fence, codec)!;
  expect(result.doc.child(0).textContent).toBe("Before");
  expect(result.doc.child(1).firstChild?.type.name).toBe("code_block");
  expect(result.doc.child(2).textContent).toBe("After");
});
