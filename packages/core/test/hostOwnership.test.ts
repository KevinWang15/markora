import { afterEach, describe, expect, it, vi } from "vitest";
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

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }

  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("shared editor host ownership", () => {
  it("blocks a minimal editor while a root editor owns the host and permits remount", () => {
    const host = createHost();
    const rootEditor = track(createRootEditor({ element: host, markdown: "root" }));

    expect(() => createMinimalEditor({ element: host })).toThrow(
      "Markora already has a live editor mounted on this element.",
    );

    rootEditor.destroy();

    const minimalEditor = track(createMinimalEditor({ element: host, markdown: "minimal" }));
    expect(minimalEditor.getMarkdown()).toBe("minimal");
  });

  it("blocks a root editor while a minimal editor owns the host and permits remount", () => {
    const host = createHost();
    const minimalEditor = track(createMinimalEditor({ element: host, markdown: "minimal" }));

    expect(() => createRootEditor({ element: host })).toThrow(
      "Markora already has a live editor mounted on this element.",
    );

    minimalEditor.destroy();

    const rootEditor = track(createRootEditor({ element: host, markdown: "root" }));
    expect(rootEditor.getMarkdown()).toBe("root");
  });

  it("cleans a root extension assembly when a reentrant editor wins the final claim", () => {
    const host = createHost();
    const cleanup = vi.fn();
    let reentrantEditor: MarkdownEditor | undefined;
    const reentrant = defineMarkdownEditorExtension({
      name: "acme-reentrant-host-claim",
      version: "1.0.0",
      compatibility: { markora: "^0.1.0", extensionApi: "^1.0.0" },
      createStorage: ({ lifecycle }) => {
        lifecycle.addCleanup(cleanup);
        return {};
      },
      createRuntime() {
        reentrantEditor = track(createRootEditor({ element: host, markdown: "winner" }));
        return {};
      },
    });

    expect(() => createRootEditor({
      element: host,
      extensions: [reentrant],
      markdown: "loser",
    })).toThrow("Markora already has a live editor mounted on this element.");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(reentrantEditor?.getMarkdown()).toBe("winner");
    expect(host.classList.contains("mdw-host")).toBe(true);

    reentrantEditor?.destroy();

    const remounted = track(createMinimalEditor({ element: host, markdown: "recovered" }));
    expect(remounted.getMarkdown()).toBe("recovered");
  });
});
