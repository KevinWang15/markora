import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import {
  createEditor as createRootEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
} from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    cancel() {},
    finished: Promise.resolve(),
  })) as typeof Element.prototype.animate;
}

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;

describe.each(entries)("%s editor clipboard policy", (_name, createEditor) => {
  it("sanitizes again after structured and raw extension slice transforms", () => {
    const calls: string[] = [];
    const extension = defineMarkdownEditorExtension({
      name: "acme-unsafe-slice",
      version: "1.0.0",
      compatibility: { markora: "^0.1.0", extensionApi: "^1.0.0" },
      createRuntime: ({ schema }) => {
        const unsafeSlice = () => {
          const link = schema.marks.link.create({ href: "javascript:alert(1)" });
          const image = schema.nodes.image.create({ src: "javascript:alert(2)" });
          const paragraph = schema.nodes.paragraph.create(
            null,
            [schema.text("unsafe", [link]), image],
          );
          return new Slice(Fragment.from(paragraph), 0, 0);
        };

        return {
          clipboard: {
            transforms: [{
              id: "inject",
              kind: "slice",
              surface: "outer",
              create: () => () => {
                calls.push("structured");
                return unsafeSlice();
              },
            }],
          },
          plugins: [{
            id: "inject-again",
            create: () => new Plugin({
              props: {
                transformPasted() {
                  calls.push("raw-plugin");
                  return unsafeSlice();
                },
              },
            }),
          }],
        };
      },
    });
    const editor = createEditor({
      element: host(),
      extensions: [extension],
      markdown: "safe",
    });
    editors.push(editor);
    let transformed = Slice.empty;

    editor.view.someProp("transformPasted", (transform) => {
      transformed = transform(transformed, editor.view);
    });

    const paragraph = transformed.content.firstChild;
    expect(calls).toEqual(["structured", "raw-plugin"]);
    expect(paragraph?.textContent).toBe("unsafe");
    expect(paragraph?.firstChild?.marks).toHaveLength(0);
    expect(paragraph?.childCount).toBe(1);
  });
});
