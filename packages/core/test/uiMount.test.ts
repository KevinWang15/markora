import { afterEach, expect, it, vi } from "vitest";
import { createEditor, defineMarkdownEditorExtension, type MarkdownEditor } from "../src";
import { createNoopUiControllers } from "../src/uiTypes";
const editors: MarkdownEditor[] = [];
function host() { const node = document.createElement("div"); document.body.append(node); return node; }
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); });

it("mounts UI after extension setup and unmounts it before the view is destroyed", () => {
  const order: string[] = [];
  const extension = defineMarkdownEditorExtension({ name: "ui-lifecycle-probe", version: "1.0.0",
    compatibility: { markora: "^0.1.0", extensionApi: "^1.0.0" },
    createRuntime: () => ({ setup() { order.push("extension"); } }),
  });
  const editor = createEditor({ element: host(), extensions: [extension], ui: () => ({
    ...createNoopUiControllers(), enabled: true,
    mount(current) {
      expect(current.ui).not.toBeNull(); expect(current.extensions.has(extension)).toBe(true);
      order.push("mount");
      return () => { expect(current.view.isDestroyed).toBe(false); order.push("unmount"); };
    },
  }) }); editors.push(editor);
  editor.destroy(); editor.destroy();
  expect(order).toEqual(["extension", "mount", "unmount"]);
});

it("releases ownership and existing overlays when UI mounting fails", () => {
  const element = host(); const cleanup = vi.fn();
  expect(() => createEditor({ element, ui: () => ({ ...createNoopUiControllers(),
    linkEditor: { open() {}, close() {}, destroy: cleanup },
    mount() { throw new Error("mount failed"); },
  }) })).toThrow("mount failed");
  expect(cleanup).toHaveBeenCalledOnce(); expect(element.querySelector(".ProseMirror")).toBeNull();
  editors.push(createEditor({ element }));
});

it("finishes normal destruction even if the mounted UI cleanup fails", () => {
  const editor = createEditor({ element: host(), ui: () => ({ ...createNoopUiControllers(),
    mount: () => () => { throw new Error("unmount failed"); },
  }) }); editors.push(editor);
  expect(() => editor.destroy()).toThrow("unmount failed");
  expect(editor.view.isDestroyed).toBe(true);
  expect(() => editor.destroy()).not.toThrow();
});

it("immediately releases cleanup returned after reentrant destruction during mount", () => {
  const cleanup = vi.fn();
  const editor = createEditor({ element: host(), ui: () => ({ ...createNoopUiControllers(),
    mount(current) { current.destroy(); return cleanup; },
  }) }); editors.push(editor);
  expect(editor.isDestroyed).toBe(true); expect(cleanup).toHaveBeenCalledOnce();
});
