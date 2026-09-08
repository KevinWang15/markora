import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MarkdownEditor } from "markora";
import { DocumentController } from "../src/DocumentController";
import { useSourceMode } from "../src/useSourceMode";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const controller = new DocumentController("original");
  const reconcile = vi.fn();
  const focus = vi.fn();
  const issues = vi.fn((): Array<{ message: string }> => []);
  const editor = { view: { composing: false }, commands: { reconcileMarkdown: reconcile },
    state: { tableIssues: issues }, focus, flushChange: vi.fn() } as unknown as MarkdownEditor;
  const onError = vi.fn();
  const options = { controller, editorRef: { current: editor }, sourceEditorRef: { current: null },
    viewportRef: { current: null }, finishEditing: () => true,
    onSourceEntry: (markdown: string) => controller.edit(markdown), onError };
  return { ...renderHook(() => useSourceMode(options)), controller, reconcile, focus, issues, onError };
}

it("keeps source editing active when reconciliation fails and allows retry", () => {
  const { result, controller, reconcile, onError } = setup();
  act(() => result.current.toggleSourceMode());
  controller.edit("changed");
  reconcile.mockImplementationOnce(() => { throw new Error("cannot parse"); });
  act(() => result.current.toggleSourceMode());
  expect(result.current.sourceMode).toBe(true);
  expect(result.current.sourceModeRef.current).toBe(true);
  expect(controller.markdown).toBe("changed");
  expect(onError).toHaveBeenCalledOnce();
  act(() => result.current.toggleSourceMode());
  expect(result.current.sourceMode).toBe(false);
  expect(reconcile).toHaveBeenLastCalledWith("changed");
});

it("requires conversion review before entering source with lossy table structure", () => {
  const { result, issues } = setup();
  issues.mockReturnValue([{ message: "Merged cells" }]);
  act(() => result.current.toggleSourceMode());
  expect(result.current.sourceMode).toBe(false);
  expect(result.current.warning).toBe("Merged cells");
  act(() => { result.current.dismissWarning(); result.current.toggleSourceMode(true); });
  expect(result.current.sourceMode).toBe(true);
  expect(result.current.warning).toBeNull();
});

it("does not let a deferred rich-view focus steal focus after reentering source", () => {
  let frame!: FrameRequestCallback;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
  const { result, focus } = setup();
  act(() => result.current.toggleSourceMode());
  act(() => result.current.toggleSourceMode());
  act(() => result.current.toggleSourceMode());
  act(() => frame(0));
  expect(result.current.sourceMode).toBe(true);
  expect(focus).not.toHaveBeenCalled();
});
