import { expect, it } from "vitest";
import {
  createEditor as createMinimalEditor,
  type MarkdownEditor,
} from "markora/minimal";
import { createTocExtension } from "../src/index";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const TOC_COUNT = 16;
const HEADING_COUNT = 128;
const LIVE_ENTRY_COUNT = TOC_COUNT * HEADING_COUNT;

function workloadSource(firstHeading = "Heading 1") {
  const markers = Array.from(
    { length: TOC_COUNT },
    (_, index) => index % 2 === 0 ? "[toc]" : "   [ToC]\t",
  ).join("\n\n");
  const headings = Array.from({ length: HEADING_COUNT }, (_, index) => {
    const level = index % 6 + 1;
    const label = index === 0 ? firstHeading : `Heading ${index + 1}`;
    return `${"#".repeat(level)} ${label}`;
  }).join("\n\n");

  return `Preamble\n\n${markers}\n\n${headings}`;
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

  if (found < 0) {
    throw new RangeError(`Missing workload text ${JSON.stringify(text)}.`);
  }

  return found;
}

it("bounds a shared 16-TOC by 128-heading source-only workload", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const observedTransactions: Array<Readonly<{
    docChanged: boolean;
    origin: string;
  }>> = [];
  const extension = createTocExtension();
  const started = performance.now();
  let editor: MarkdownEditor | undefined;

  try {
    editor = createMinimalEditor({
      element: host,
      extensions: [extension],
      markdown: workloadSource(),
      onTransaction(transaction, _view, context) {
        observedTransactions.push(Object.freeze({
          docChanged: transaction.docChanged,
          origin: context.origin,
        }));
      },
    });
    const activeEditor = editor;
    const handle = activeEditor.extensions.get(extension);
    const initial = handle.state.getSnapshot();
    const canonical = activeEditor.getMarkdown();
    const initialEntries = [
      ...activeEditor.view.dom.querySelectorAll<HTMLElement>(
        "[data-mdw-toc-entry]",
      ),
    ];

    expect(initial.tocs).toHaveLength(TOC_COUNT);
    expect(initial.headings).toHaveLength(HEADING_COUNT);
    expect(initialEntries).toHaveLength(LIVE_ENTRY_COUNT);
    expect(canonical.match(/^\[TOC\]$/gm)).toHaveLength(TOC_COUNT);
    expect(canonical).not.toMatch(/^\s*\[(?:toc|ToC)\]\s*$/m);

    const prefixPosition = textPosition(activeEditor, "Preamble");
    const firstHeadingPosition = initial.headings[0]!.position;
    const firstTocPosition = initial.tocs[0]!.position;
    activeEditor.view.dispatch(
      activeEditor.view.state.tr.insertText("Expanded ", prefixPosition),
    );
    const mapped = handle.state.getSnapshot();
    const mappedEntries = [
      ...activeEditor.view.dom.querySelectorAll<HTMLElement>(
        "[data-mdw-toc-entry]",
      ),
    ];

    expect(mapped.headings[0]!.position).toBeGreaterThan(firstHeadingPosition);
    expect(mapped.tocs[0]!.position).toBeGreaterThan(firstTocPosition);
    expect(mappedEntries).toHaveLength(LIVE_ENTRY_COUNT);
    expect(mappedEntries.every((entry, index) => entry === initialEntries[index]))
      .toBe(true);
    // The user's edit is the sole dispatch. Mapping the shared index and
    // retaining 2,048 entry nodes must not create refresh transactions.
    expect(observedTransactions).toEqual([{
      docChanged: true,
      origin: "user",
    }]);

    const firstHeading = mapped.headings[0]!;
    activeEditor.view.dispatch(activeEditor.view.state.tr.insertText(
      "Renamed heading",
      firstHeading.position + 1,
      firstHeading.position + 1 + firstHeading.label.length,
    ));
    const renamedEntries = [
      ...activeEditor.view.dom.querySelectorAll<HTMLElement>(
        '[data-mdw-toc-entry="1"]',
      ),
    ];

    expect(handle.state.getSnapshot().headings[0]?.label).toBe("Renamed heading");
    expect(renamedEntries).toHaveLength(TOC_COUNT);
    expect(renamedEntries.every(({ textContent }) => (
      textContent === "Renamed heading"
    ))).toBe(true);
    expect(activeEditor.view.dom.querySelectorAll("[data-mdw-toc-entry]"))
      .toHaveLength(LIVE_ENTRY_COUNT);
    expect(observedTransactions).toHaveLength(2);

    expect(activeEditor.commands.reconcileMarkdown(
      workloadSource("Reconciled heading"),
    )).toBe(true);
    expect(handle.state.getSnapshot().headings[0]?.label)
      .toBe("Reconciled heading");
    expect(activeEditor.view.dom.querySelectorAll("[data-mdw-toc-entry]"))
      .toHaveLength(LIVE_ENTRY_COUNT);

    activeEditor.commands.resetMarkdown(workloadSource("Reset heading"));
    expect(handle.state.getSnapshot().headings[0]?.label).toBe("Reset heading");
    expect(activeEditor.view.dom.querySelectorAll("[data-mdw-toc-entry]"))
      .toHaveLength(LIVE_ENTRY_COUNT);
    expect(activeEditor.getMarkdown().match(/^\[TOC\]$/gm))
      .toHaveLength(TOC_COUNT);

    const detachedNavigation = activeEditor.view.dom.querySelector<HTMLElement>(
      "nav[data-mdw-toc]",
    )!;
    const detachedEntry = detachedNavigation.querySelector<HTMLButtonElement>(
      "[data-mdw-toc-entry]",
    )!;
    const transactionCountBeforeDestroy = observedTransactions.length;

    activeEditor.destroy();
    editor = undefined;

    expect(host.querySelector("[data-mdw-toc]")).toBeNull();
    expect(document.body.contains(detachedNavigation)).toBe(false);
    expect(detachedNavigation.querySelector("[data-mdw-toc-entry]")).toBeNull();
    expect(() => detachedEntry.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }))).not.toThrow();
    expect(observedTransactions).toHaveLength(transactionCountBeforeDestroy);

    // This is intentionally a broad regression ceiling, not a microbenchmark.
    // It includes parse, 2,048-entry DOM creation, mapped typing, a full outline
    // refresh, reconciliation, reset, and teardown on a shared CI worker.
    expect(performance.now() - started).toBeLessThan(20_000);
  } finally {
    editor?.destroy();
    host.remove();
  }
}, 30_000);
