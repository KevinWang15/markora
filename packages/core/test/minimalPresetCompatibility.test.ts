import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultMarkdownEditorPreset,
  createEditor,
  createMinimalMarkdownEditorPreset,
  defineMarkdownEditorPreset,
  type MarkdownEditor,
} from "../src";
import { createEditor as createMinimalEntryEditor } from "../src/minimal";

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("minimal preset through the compatibility entry", () => {
  it("uses the minimal dialect without promising a minimal bundle graph", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = createEditor({
      element,
      extensionPreset: createMinimalMarkdownEditorPreset(),
      markdown: "~~plain~~\n\n| not | table |\n\n```js\nconst value = 1;\n```",
    });
    editors.push(editor);

    expect(editor.view.state.schema.marks.strike).toBeUndefined();
    expect(editor.view.state.schema.nodes.table).toBeUndefined();
    expect(editor.view.dom.querySelector(".cm-editor")).toBeNull();
    expect(editor.commands.toggleMark("strike")).toBe(false);
    expect(editor.extensions.manifest.preset?.name).toBe("markora/minimal");
  });

  it("rejects compatibility-only definitions outside the exact default runtime", () => {
    const defaultPreset = createDefaultMarkdownEditorPreset();
    const anonymousPreset = defineMarkdownEditorPreset({
      extensions: defaultPreset.extensions,
    });
    const rootHost = document.createElement("div");
    const minimalHost = document.createElement("div");
    document.body.append(rootHost, minimalHost);

    expect(() => createEditor({
      element: rootHost,
      extensionPreset: anonymousPreset,
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INCOMPATIBLE",
      phase: "resolve",
    }));
    expect(() => createMinimalEntryEditor({
      element: minimalHost,
      extensionPreset: defaultPreset,
    })).toThrow(expect.objectContaining({
      code: "EXTENSION_INCOMPATIBLE",
      phase: "resolve",
    }));
    expect(rootHost.classList.contains("mdw-host")).toBe(false);
    expect(minimalHost.classList.contains("mdw-host")).toBe(false);
  });
});
