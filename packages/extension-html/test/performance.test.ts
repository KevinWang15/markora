import { expect, it, vi } from "vitest";
import {
  createEditor,
  type MarkdownEditor,
} from "markora";
import { createHtmlExtension } from "../src/index";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const HTML_ATOM_COUNT = 512;

function workloadSource(preamble = "Preamble") {
  const atoms = Array.from(
    { length: HTML_ATOM_COUNT },
    (_, index) => `<div data-index="${index}">Atom ${index}</div>`,
  );
  return [preamble, ...atoms].join("\n\n");
}

function textPosition(editor: MarkdownEditor, text: string) {
  let found = -1;
  editor.view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === text) {
      found = position;
      return false;
    }
    return found < 0;
  });
  if (found < 0) throw new RangeError(`Missing workload text ${JSON.stringify(text)}.`);
  return found;
}

it("bounds a 512-atom source-only HTML workload without renderer work during typing", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const renderer = vi.fn(() => document.createElement("div"));
  const extension = createHtmlExtension({ renderer });
  const started = performance.now();
  let editor: MarkdownEditor | undefined;

  try {
    editor = createEditor({
      element: host,
      extensions: [extension],
      markdown: workloadSource(),
    });
    const activeEditor = editor;
    const handle = activeEditor.extensions.get(extension);
    const initialViews = [
      ...activeEditor.view.dom.querySelectorAll<HTMLElement>("[data-mdw-html]"),
    ];

    expect(handle.state.getNodes("block")).toHaveLength(HTML_ATOM_COUNT);
    expect(initialViews).toHaveLength(HTML_ATOM_COUNT);
    expect(activeEditor.getMarkdown()).toBe(workloadSource());
    expect(renderer).not.toHaveBeenCalled();

    const position = textPosition(activeEditor, "Preamble");
    const transaction = activeEditor.view.state.tr.insertText("Expanded ", position);
    const positionLookups = vi.spyOn(transaction.doc, "nodeAt");
    activeEditor.view.dispatch(transaction);
    // Typing must not resolve a document position separately for every HTML
    // NodeView or identity entry. Those sibling searches become quadratic.
    expect(positionLookups.mock.calls.length).toBeLessThan(HTML_ATOM_COUNT / 4);
    positionLookups.mockRestore();
    const mappedViews = [
      ...activeEditor.view.dom.querySelectorAll<HTMLElement>("[data-mdw-html]"),
    ];

    expect(mappedViews).toHaveLength(HTML_ATOM_COUNT);
    expect(mappedViews.every((view, index) => view === initialViews[index])).toBe(true);
    expect(handle.state.getNodes("block")).toHaveLength(HTML_ATOM_COUNT);
    expect(activeEditor.getMarkdown()).toBe(workloadSource("Expanded Preamble"));
    expect(renderer).not.toHaveBeenCalled();

    expect(activeEditor.commands.reconcileMarkdown(workloadSource("Reconciled")))
      .toBe(true);
    expect(handle.state.getNodes("block")).toHaveLength(HTML_ATOM_COUNT);
    expect(activeEditor.getMarkdown()).toBe(workloadSource("Reconciled"));

    activeEditor.commands.resetMarkdown(workloadSource("Reset"));
    expect(handle.state.getNodes("block")).toHaveLength(HTML_ATOM_COUNT);
    expect(activeEditor.getMarkdown()).toBe(workloadSource("Reset"));

    const detachedView = activeEditor.view.dom.querySelector<HTMLElement>("[data-mdw-html]")!;
    activeEditor.destroy();
    editor = undefined;

    expect(host.querySelector("[data-mdw-html]")).toBeNull();
    expect(document.body.contains(detachedView)).toBe(false);
    expect(detachedView.querySelector("[data-mdw-html-preview]")?.childNodes)
      .toHaveLength(0);
    expect(renderer).not.toHaveBeenCalled();

    // This is a deliberately broad regression ceiling, not a microbenchmark.
    // It covers parse, 512 NodeViews, exact serialization, mapped typing,
    // reconciliation, hard reset, and teardown on a shared CI worker.
    expect(performance.now() - started).toBeLessThan(20_000);
  } finally {
    editor?.destroy();
    host.remove();
  }
}, 30_000);
